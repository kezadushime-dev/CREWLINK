const socket = io();

const DEFAULT_RTC_CONFIGURATION = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

const screens = {
  welcome: document.querySelector("#welcomeScreen"),
  create: document.querySelector("#createScreen"),
  join: document.querySelector("#joinScreen"),
  room: document.querySelector("#roomScreen")
};

const appShell = document.querySelector(".app-shell");

const state = {
  roomId: "",
  eventName: "",
  name: "",
  speaker: null,
  users: [],
  microphoneReady: false,
  role: "",
  directorCameraStatus: false,
  directorName: "Director",
  crewJoinUrl: "",
  messages: [],
  activeTab: "home",
  unreadMessages: 0,
  relayConfigured: false
};

const connectionStatus = document.querySelector("#connectionStatus");
const toast = document.querySelector("#toast");
const speakerPanel = document.querySelector("#speakerPanel");
const speakerLabel = document.querySelector("#speakerLabel");
const speakerName = document.querySelector("#speakerName");
const talkButton = document.querySelector("#talkButton");
const talkInstruction = document.querySelector("#talkInstruction");
const talkState = document.querySelector("#talkState");
const audioNote = document.querySelector("#audioNote");
const voiceMeter = document.querySelector("#voiceMeter");
const voiceMeterBars = voiceMeter.querySelectorAll("span");
const directorCameraStatus = document.querySelector("#directorCameraStatus");
const directorCameraLabel = document.querySelector("#directorCameraLabel");
const directorCameraToggle = document.querySelector("#directorCameraToggle");
const directorCameraToggleLabel = document.querySelector("#directorCameraToggleLabel");
const directorDashboardKicker = document.querySelector("#directorDashboardKicker");
const directorSharePanel = document.querySelector("#directorSharePanel");
const shareRoomId = document.querySelector("#shareRoomId");
const shareLink = document.querySelector("#shareLink");
const copyInvite = document.querySelector("#copyInvite");
const bottomNav = document.querySelector("#bottomNav");
const roomTabButtons = document.querySelectorAll("[data-room-tab]");
const themeToggle = document.querySelector("#themeToggle");
const themeIcon = document.querySelector("#themeIcon");
const themeLabel = document.querySelector("#themeLabel");
const chatPanel = document.querySelector("#chatPanel");
const chatMessages = document.querySelector("#chatMessages");
const chatInput = document.querySelector("#chatInput");
const chatOnline = document.querySelector("#chatOnline");
const chatBadge = document.querySelector("#chatBadge");
const peerConnections = new Map();
const remoteAudioElements = new Map();
const pendingCandidates = new Map();
let localStream = null;
let rtcConfiguration = DEFAULT_RTC_CONFIGURATION;
let audioContext = null;
let microphoneSource = null;
let microphoneAnalyser = null;
let voiceMeterData = null;
let voiceMeterFrame = null;
let toastTimer;
let requestedToTalk = false;
let isTalking = false;
let audioLinkError = "";

function showScreen(name) {
  Object.entries(screens).forEach(([screenName, element]) => {
    const active = screenName === name;
    element.classList.toggle("hidden", !active);
    element.setAttribute("aria-hidden", String(!active));
  });
}

function setTheme(theme) {
  const isLight = theme === "light";
  document.body.dataset.theme = isLight ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]').content = isLight ? "#edf4fb" : "#071426";
  themeIcon.textContent = isLight ? "☀" : "☾";
  themeLabel.textContent = isLight ? "Light" : "Dark";

  try {
    window.localStorage.setItem("crewlink-theme", document.body.dataset.theme);
  } catch (error) {}
}

function restoreTheme() {
  try {
    setTheme(window.localStorage.getItem("crewlink-theme") || "dark");
  } catch (error) {
    setTheme("dark");
  }
}

function renderBottomNav() {
  const inRoom = Boolean(state.roomId && state.role);
  bottomNav.classList.toggle("hidden", !inRoom);
  roomTabButtons.forEach((button) => {
    const isActive = button.dataset.roomTab === state.activeTab;
    button.classList.toggle("is-active", isActive);
    button.toggleAttribute("aria-current", isActive);
  });
  chatBadge.textContent = state.unreadMessages;
  chatBadge.classList.toggle("hidden", state.unreadMessages === 0);
}

function setActiveTab(tab) {
  if (!state.roomId || !["home", "chat"].includes(tab)) {
    return;
  }

  state.activeTab = tab;
  const isChat = tab === "chat";
  screens.room.classList.toggle("showing-chat", isChat);
  chatPanel.classList.toggle("hidden", !isChat);
  if (isChat) {
    state.unreadMessages = 0;
    requestAnimationFrame(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
      chatInput.focus();
    });
  }
  renderBottomNav();
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4200);
}

function normaliseRoomId(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
}

function initials(name) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function setLocalAudioEnabled(enabled) {
  localStream?.getAudioTracks().forEach((track) => {
    track.enabled = enabled;
  });
}

function connectedPeerCount() {
  return [...peerConnections.values()].filter((connection) => connection.connectionState === "connected").length;
}

function roomPeerCount() {
  return state.users.filter((user) => user.id !== socket.id).length;
}

function resetVoiceMeter() {
  voiceMeter.classList.remove("is-speaking");
  voiceMeterBars.forEach((bar) => bar.style.setProperty("--wave-level", ".16"));
}

function updateVoiceMeter() {
  if (!microphoneAnalyser || !voiceMeterData) {
    resetVoiceMeter();
    return;
  }

  microphoneAnalyser.getByteFrequencyData(voiceMeterData);
  let total = 0;
  voiceMeterBars.forEach((bar, index) => {
    const dataIndex = Math.min(voiceMeterData.length - 1, 1 + index * 3);
    const level = isTalking ? voiceMeterData[dataIndex] / 255 : .16;
    total += level;
    bar.style.setProperty("--wave-level", String(Math.max(.13, level)));
  });

  voiceMeter.classList.toggle("is-speaking", isTalking && total / voiceMeterBars.length > .06);
  voiceMeterFrame = window.requestAnimationFrame(updateVoiceMeter);
}

function setUpVoiceMeter() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor || !localStream || microphoneAnalyser) {
    return;
  }

  try {
    audioContext = new AudioContextConstructor();
    microphoneSource = audioContext.createMediaStreamSource(localStream);
    microphoneAnalyser = audioContext.createAnalyser();
    microphoneAnalyser.fftSize = 64;
    microphoneAnalyser.smoothingTimeConstant = .72;
    voiceMeterData = new Uint8Array(microphoneAnalyser.frequencyBinCount);
    microphoneSource.connect(microphoneAnalyser);
    updateVoiceMeter();
  } catch (error) {
    resetVoiceMeter();
  }
}

async function resumeAudioPlayback() {
  if (audioContext?.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (error) {}
  }

  await Promise.all([...remoteAudioElements.values()].map((audio) => audio.play().catch(() => undefined)));
}

async function loadRtcConfiguration() {
  try {
    const response = await fetch("/api/webrtc-config", { cache: "no-store" });
    const configuration = await response.json();
    if (response.ok && Array.isArray(configuration.iceServers) && configuration.iceServers.length > 0) {
      rtcConfiguration = { iceServers: configuration.iceServers };
      state.relayConfigured = Boolean(configuration.relayConfigured);
    }
  } catch (error) {
    rtcConfiguration = DEFAULT_RTC_CONFIGURATION;
    state.relayConfigured = false;
  }
}

function updateTalkButton() {
  const speaker = state.speaker;
  const someoneElseIsTalking = speaker && speaker.id !== socket.id;
  const peerCount = roomPeerCount();
  const audioLinkPending = peerCount > 0 && connectedPeerCount() < peerCount;
  talkButton.disabled = !state.microphoneReady || Boolean(someoneElseIsTalking) || audioLinkPending;
  let status = "READY";

  if (audioLinkError && peerCount > 0) {
    status = "LINK ERROR";
    talkInstruction.textContent = "Audio link could not connect";
    audioNote.textContent = audioLinkError;
  } else if (isTalking) {
    status = "ON AIR";
    talkInstruction.textContent = "Your voice is live";
  } else if (!state.microphoneReady) {
    status = "MIC OFF";
    talkInstruction.textContent = "Microphone access is required to talk";
  } else if (someoneElseIsTalking) {
    status = "BUSY";
    talkInstruction.textContent = `${speaker.name} is speaking`;
  } else if (audioLinkPending) {
    status = "LINKING";
    talkInstruction.textContent = "Connecting audio to crew…";
    audioNote.textContent = state.relayConfigured
      ? "Securing your audio link to the crew."
      : "Connecting directly. A TURN relay is needed when mobile networks block direct audio.";
  } else if (requestedToTalk && !isTalking) {
    status = "CONNECTING";
    talkInstruction.textContent = "Requesting channel…";
  } else {
    talkInstruction.textContent = "Tap to talk to everyone";
  }

  talkState.textContent = status;
  talkButton.setAttribute("aria-pressed", String(isTalking));
}

function renderUsers() {
  const crewList = document.querySelector("#crewList");
  document.querySelector("#crewCount").textContent = state.users.length;
  chatOnline.textContent = `${state.users.length} online`;
  crewList.replaceChildren(...state.users.map((user) => {
    const member = document.createElement("article");
    member.className = `crew-member${state.speaker?.id === user.id ? " is-speaking" : ""}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = initials(user.name);

    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = user.name;
    const status = document.createElement("small");
    status.textContent = state.speaker?.id === user.id ? "Speaking now" : "Ready";
    details.append(name, status);

    const role = document.createElement("span");
    role.className = `role-badge${user.role === "Director" ? " director" : ""}`;
    role.textContent = user.role;
    member.append(avatar, details, role);
    return member;
  }));
  updateTalkButton();
}

function chatTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function renderChatMessages() {
  if (state.messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "No messages yet. Start the conversation.";
    chatMessages.replaceChildren(empty);
    return;
  }

  const messageElements = state.messages.map((message) => {
    const article = document.createElement("article");
    const isOwnMessage = message.senderId === socket.id;
    article.className = `chat-message${isOwnMessage ? " is-own" : ""}`;

    const meta = document.createElement("div");
    const sender = document.createElement("strong");
    sender.textContent = isOwnMessage ? "You" : message.name;
    const detail = document.createElement("span");
    detail.textContent = `${message.role || "Crew"} · ${chatTime(message.sentAt)}`;
    meta.append(sender, detail);

    const body = document.createElement("p");
    body.textContent = message.text;
    article.append(meta, body);
    return article;
  });

  chatMessages.replaceChildren(...messageElements);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderSpeaker() {
  const speaker = state.speaker;
  speakerPanel.classList.toggle("speaking", Boolean(speaker));

  if (speaker) {
    speakerLabel.textContent = speaker.role === "Director" ? "Director has priority" : "Live on channel";
    speakerName.textContent = `${speaker.name} is speaking`;
  } else {
    speakerLabel.textContent = "Channel clear";
    speakerName.textContent = "Tap to talk";
  }

  updateTalkButton();
  renderUsers();
}

function renderDirectorCameraStatus() {
  const director = state.users.find((user) => user.role === "Director");
  const directorName = director?.name || state.directorName || "Director";
  const isOnCamera = state.directorCameraStatus;

  directorCameraStatus.classList.toggle("is-on-camera", isOnCamera);
  directorCameraLabel.textContent = isOnCamera
    ? `${directorName} is on camera`
    : `${directorName} is off camera`;

  const isDirector = state.role === "Director";
  directorCameraToggle.classList.toggle("hidden", !isDirector);
  directorCameraToggle.setAttribute("aria-pressed", String(isOnCamera));
  directorCameraToggleLabel.textContent = isOnCamera
    ? "Mark myself off camera"
    : "Mark myself on camera";
}

function crewJoinLink() {
  const { hostname, origin } = window.location;

  if (state.crewJoinUrl) {
    return state.crewJoinUrl;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "Finding Wi-Fi link…";
  }

  return origin;
}

async function loadCrewJoinLink() {
  const { hostname, origin } = window.location;

  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    state.crewJoinUrl = origin;
    renderRoleLayout();
    return;
  }

  try {
    const response = await fetch("/api/connection-info");
    const data = await response.json();
    state.crewJoinUrl = data.crewUrl || "";
  } catch (error) {
    state.crewJoinUrl = "";
  }

  renderRoleLayout();
}

function renderRoleLayout() {
  const isDirector = state.role === "Director";
  const isCrew = state.role === "Crew";

  appShell.classList.toggle("is-director-dashboard", isDirector);
  appShell.classList.toggle("is-crew-phone", isCrew);
  directorDashboardKicker.classList.toggle("hidden", !isDirector);
  directorSharePanel.classList.toggle("hidden", !isDirector);
  shareRoomId.textContent = state.roomId || "ROOM";
  shareLink.textContent = crewJoinLink();
  renderBottomNav();
}

async function copyEventInvite() {
  if (state.role !== "Director") {
    return;
  }

  const invite = `Join ${state.eventName || "CrewLink event"}\nRoom ID: ${state.roomId}\nOpen: ${crewJoinLink()}`;

  if (crewJoinLink() === "Finding Wi-Fi link…") {
    showToast("Your Wi-Fi link is loading. Try again in a moment.");
    return;
  }

  try {
    await navigator.clipboard.writeText(invite);
    showToast("Event details copied. Send them to your crew.");
  } catch (error) {
    showToast("Copy is unavailable here. Share the room ID and crew link shown above.");
  }
}

async function prepareMicrophone() {
  if (state.microphoneReady) {
    return true;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    audioNote.textContent = "This browser does not support microphone access.";
    showToast("This browser cannot access the microphone.");
    return false;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    setLocalAudioEnabled(false);
    state.microphoneReady = true;
    setUpVoiceMeter();
    audioNote.textContent = "Microphone ready. Tap TALK to start and stop your voice.";
    updateTalkButton();
    return true;
  } catch (error) {
    state.microphoneReady = false;
    audioNote.textContent = "Microphone unavailable. Allow access in your browser, then rejoin the room.";
    showToast("Microphone access was not granted. You can still join, but you cannot talk.");
    return false;
  }
}

function getRemoteAudioElement(peerId) {
  let audio = remoteAudioElements.get(peerId);
  if (!audio) {
    audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;
    audio.volume = 1;
    audio.dataset.peerId = peerId;
    document.body.append(audio);
    remoteAudioElements.set(peerId, audio);
  }
  return audio;
}

function closePeerConnection(peerId) {
  pendingCandidates.delete(peerId);
  const connection = peerConnections.get(peerId);
  if (connection) {
    connection.onicecandidate = null;
    connection.ontrack = null;
    connection.onconnectionstatechange = null;
    connection.close();
    peerConnections.delete(peerId);
  }

  const audio = remoteAudioElements.get(peerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    remoteAudioElements.delete(peerId);
  }

  updateTalkButton();
}

function closeAllPeerConnections() {
  [...peerConnections.keys()].forEach(closePeerConnection);
}

function createPeerConnection(peerId) {
  const existingConnection = peerConnections.get(peerId);
  if (existingConnection) {
    return existingConnection;
  }

  const connection = new RTCPeerConnection(rtcConfiguration);
  peerConnections.set(peerId, connection);

  localStream?.getTracks().forEach((track) => {
    connection.addTrack(track, localStream);
  });

  connection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit("webrtc-ice-candidate", { targetId: peerId, candidate });
    }
  };

  connection.ontrack = ({ streams }) => {
    const stream = streams[0];
    if (!stream) {
      return;
    }

    const audio = getRemoteAudioElement(peerId);
    if (audio.srcObject !== stream) {
      audio.srcObject = stream;
      audio.play().catch(() => {
        audioNote.textContent = "Tap TALK once to allow incoming crew audio.";
      });
    }
  };

  connection.onconnectionstatechange = () => {
    if (connection.connectionState === "connected") {
      audioLinkError = "";
      audioNote.textContent = "Audio link ready. Tap TALK to start and stop your voice.";
    }

    if (connection.connectionState === "failed") {
      audioLinkError = state.relayConfigured
        ? "Audio relay failed. Check your network and rejoin the room."
        : "This network blocked direct audio. Add TURN relay settings in Render, then rejoin the room.";
      showToast("Audio link failed. Check the note below TALK.");
      closePeerConnection(peerId);
    }

    updateTalkButton();
  };

  return connection;
}

async function addPendingCandidates(peerId, connection) {
  const candidates = pendingCandidates.get(peerId) || [];
  pendingCandidates.delete(peerId);

  for (const candidate of candidates) {
    await connection.addIceCandidate(candidate);
  }
}

async function createOffer(peerId) {
  const connection = createPeerConnection(peerId);
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  socket.emit("webrtc-offer", {
    targetId: peerId,
    description: connection.localDescription
  });
}

async function handleOffer({ senderId, description }) {
  const connection = createPeerConnection(senderId);
  await connection.setRemoteDescription(description);
  await addPendingCandidates(senderId, connection);
  const answer = await connection.createAnswer();
  await connection.setLocalDescription(answer);
  socket.emit("webrtc-answer", {
    targetId: senderId,
    description: connection.localDescription
  });
}

async function handleAnswer({ senderId, description }) {
  const connection = peerConnections.get(senderId);
  if (!connection) {
    return;
  }

  await connection.setRemoteDescription(description);
  await addPendingCandidates(senderId, connection);
}

async function handleIceCandidate({ senderId, candidate }) {
  const connection = peerConnections.get(senderId);
  if (!connection || !connection.remoteDescription) {
    const candidates = pendingCandidates.get(senderId) || [];
    candidates.push(candidate);
    pendingCandidates.set(senderId, candidates);
    return;
  }

  await connection.addIceCandidate(candidate);
}

async function startTalking() {
  if (!state.roomId || !state.microphoneReady || talkButton.disabled || requestedToTalk) {
    return;
  }

  await resumeAudioPlayback();
  requestedToTalk = true;
  updateTalkButton();
  socket.emit("talk-started");
}

function stopTalking() {
  if (!requestedToTalk && !isTalking) {
    return;
  }

  requestedToTalk = false;
  isTalking = false;
  setLocalAudioEnabled(false);
  talkButton.classList.remove("is-talking");
  socket.emit("talk-stopped");
  updateTalkButton();
}

function toggleTalking() {
  if (requestedToTalk || isTalking) {
    stopTalking();
  } else {
    startTalking();
  }
}

function releaseMicrophone() {
  if (voiceMeterFrame) {
    window.cancelAnimationFrame(voiceMeterFrame);
    voiceMeterFrame = null;
  }
  microphoneSource?.disconnect();
  microphoneAnalyser?.disconnect();
  audioContext?.close().catch(() => undefined);
  audioContext = null;
  microphoneSource = null;
  microphoneAnalyser = null;
  voiceMeterData = null;
  resetVoiceMeter();
  setLocalAudioEnabled(false);
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  state.microphoneReady = false;
}

async function enterRoom(event, roomDetails) {
  event.preventDefault();
  state.name = roomDetails.name();
  state.roomId = normaliseRoomId(roomDetails.roomId());
  state.eventName = roomDetails.eventName?.() || "";
  await Promise.all([prepareMicrophone(), loadRtcConfiguration()]);
  socket.emit(roomDetails.event, {
    roomId: state.roomId,
    name: state.name,
    eventName: state.eventName
  });
}

document.querySelector("#showCreate").addEventListener("click", () => showScreen("create"));
document.querySelector("#showJoin").addEventListener("click", () => showScreen("join"));
document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => showScreen("welcome")));

document.querySelectorAll(".room-input").forEach((input) => {
  input.addEventListener("input", () => {
    input.value = normaliseRoomId(input.value);
  });
});

document.querySelector("#createForm").addEventListener("submit", (event) => enterRoom(event, {
  event: "create-event",
  eventName: () => document.querySelector("#createEventName").value.trim(),
  name: () => document.querySelector("#createName").value.trim(),
  roomId: () => document.querySelector("#createRoom").value
}));

document.querySelector("#joinForm").addEventListener("submit", (event) => enterRoom(event, {
  event: "join-event",
  name: () => document.querySelector("#joinName").value.trim(),
  roomId: () => document.querySelector("#joinRoom").value
}));

document.querySelector("#leaveRoom").addEventListener("click", () => {
  stopTalking();
  socket.disconnect();
  closeAllPeerConnections();
  releaseMicrophone();
  state.roomId = "";
  state.users = [];
  state.speaker = null;
  state.role = "";
  state.directorCameraStatus = false;
  state.directorName = "Director";
  state.crewJoinUrl = "";
  state.messages = [];
  state.activeTab = "home";
  state.unreadMessages = 0;
  screens.room.classList.remove("showing-chat");
  chatPanel.classList.add("hidden");
  renderChatMessages();
  renderDirectorCameraStatus();
  renderRoleLayout();
  loadCrewJoinLink();
  showScreen("welcome");
  socket.connect();
});

talkButton.addEventListener("click", toggleTalking);
document.addEventListener("pointerdown", () => {
  resumeAudioPlayback();
}, { passive: true });
roomTabButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.roomTab));
});
themeToggle.addEventListener("click", () => {
  setTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});
document.querySelector("#chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !state.roomId) {
    return;
  }

  socket.emit("send-chat-message", { text });
  chatInput.value = "";
});
directorCameraToggle.addEventListener("click", () => {
  socket.emit("director-camera-status", {
    isOnCamera: !state.directorCameraStatus
  });
});
copyInvite.addEventListener("click", copyEventInvite);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopTalking();
  }
});
window.addEventListener("beforeunload", () => {
  stopTalking();
  closeAllPeerConnections();
  releaseMicrophone();
});

socket.on("connect", () => {
  connectionStatus.textContent = "Connected to CrewLink";
  connectionStatus.classList.add("connected");
});

socket.on("disconnect", () => {
  connectionStatus.textContent = "Connection lost — reconnecting";
  connectionStatus.classList.remove("connected");
  stopTalking();
  closeAllPeerConnections();
});

socket.on("room-joined", (data) => {
  state.roomId = data.roomId;
  state.eventName = data.eventName;
  state.role = data.role;
  state.directorCameraStatus = data.directorCameraStatus;
  state.activeTab = "home";
  state.unreadMessages = 0;
  audioLinkError = "";
  document.querySelector("#roomId").textContent = `ROOM · ${data.roomId}`;
  document.querySelector("#eventTitle").textContent = data.eventName;
  showScreen("room");
  renderSpeaker();
  renderDirectorCameraStatus();
  renderRoleLayout();
  setActiveTab("home");
});

socket.on("room-error", showToast);
socket.on("talk-denied", (message) => {
  requestedToTalk = false;
  isTalking = false;
  setLocalAudioEnabled(false);
  talkButton.classList.remove("is-talking");
  updateTalkButton();
  showToast(message);
});
socket.on("users-updated", (users) => {
  state.users = users;
  renderUsers();
  renderDirectorCameraStatus();
});
socket.on("chat-history", (messages) => {
  state.messages = Array.isArray(messages) ? messages : [];
  renderChatMessages();
});
socket.on("chat-message", (message) => {
  if (!message?.id || state.messages.some((existing) => existing.id === message.id)) {
    return;
  }

  state.messages.push(message);
  if (message.senderId !== socket.id && state.activeTab !== "chat") {
    state.unreadMessages += 1;
  }
  renderChatMessages();
  renderBottomNav();
});
socket.on("director-camera-status-updated", (data) => {
  state.directorCameraStatus = data.isOnCamera;
  state.directorName = data.directorName;
  renderDirectorCameraStatus();
});
socket.on("speaker-updated", (speaker) => {
  state.speaker = speaker;
  isTalking = Boolean(speaker && speaker.id === socket.id && requestedToTalk && state.microphoneReady);
  setLocalAudioEnabled(isTalking);
  talkButton.classList.toggle("is-talking", isTalking);
  renderSpeaker();
});
socket.on("webrtc-peers", (peerIds) => {
  peerIds.forEach((peerId) => {
    createOffer(peerId).catch(() => showToast("Could not connect audio to one crew member."));
  });
});
socket.on("webrtc-offer", (payload) => {
  handleOffer(payload).catch(() => showToast("Could not answer an audio connection."));
});
socket.on("webrtc-answer", (payload) => {
  handleAnswer(payload).catch(() => showToast("Could not complete an audio connection."));
});
socket.on("webrtc-ice-candidate", (payload) => {
  handleIceCandidate(payload).catch(() => showToast("Could not exchange audio connection details."));
});
socket.on("peer-left", closePeerConnection);

restoreTheme();

window.addEventListener("offline", () => {
  connectionStatus.textContent = "You are offline";
  connectionStatus.classList.remove("connected");
  showToast("You are offline. Reconnect to use your crew room.");
});

window.addEventListener("online", () => {
  connectionStatus.textContent = "Back online — reconnecting";
  showToast("You are back online.");
});
