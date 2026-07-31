const socket = io();

const DEFAULT_RTC_CONFIGURATION = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

const REQUEST_LABELS = {
  battery: "Battery",
  backup: "Backup",
  camera: "Change camera view"
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
  relayConfigured: false,
  coverImage: "",
  crewRequests: [],
  requestStatuses: {},
  directorScreenSharing: false
};

const connectionStatus = document.querySelector("#connectionStatus");
const toast = document.querySelector("#toast");
const speakerPanel = document.querySelector("#speakerPanel");
const speakerLabel = document.querySelector("#speakerLabel");
const speakerName = document.querySelector("#speakerName");
const eventCover = document.querySelector("#eventCover");
const directorLiveOverview = document.querySelector("#directorLiveOverview");
const performanceRing = document.querySelector("#performanceRing");
const performanceValue = document.querySelector("#performanceValue");
const metricCrewOnline = document.querySelector("#metricCrewOnline");
const metricAudioLinks = document.querySelector("#metricAudioLinks");
const metricOnAir = document.querySelector("#metricOnAir");
const metricLiveWindow = document.querySelector("#metricLiveWindow");
const performanceDiagram = document.querySelector("#performanceDiagram");
const directorScreenShare = document.querySelector("#directorScreenShare");
const directorScreenStatus = document.querySelector("#directorScreenStatus");
const toggleScreenShare = document.querySelector("#toggleScreenShare");
const screenPreview = document.querySelector("#screenPreview");
const toggleScreenFloat = document.querySelector("#toggleScreenFloat");
const screenPreviewDrag = document.querySelector("#screenPreviewDrag");
const screenPreviewResize = document.querySelector("#screenPreviewResize");
const directorScreenVideo = document.querySelector("#directorScreenVideo");
const crewLiveView = document.querySelector("#crewLiveView");
const crewScreenStatus = document.querySelector("#crewScreenStatus");
const crewScreenNote = document.querySelector("#crewScreenNote");
const crewScreenVideo = document.querySelector("#crewScreenVideo");
const talkButton = document.querySelector("#talkButton");
const talkInstruction = document.querySelector("#talkInstruction");
const talkState = document.querySelector("#talkState");
const audioNote = document.querySelector("#audioNote");
const volumeControl = document.querySelector("#volumeControl");
const voiceMeter = document.querySelector("#voiceMeter");
const voiceMeterBars = voiceMeter.querySelectorAll("span");
const directorCameraStatus = document.querySelector("#directorCameraStatus");
const directorCameraLabel = document.querySelector("#directorCameraLabel");
const directorCameraToggle = document.querySelector("#directorCameraToggle");
const directorCameraToggleLabel = document.querySelector("#directorCameraToggleLabel");
const directorDashboardKicker = document.querySelector("#directorDashboardKicker");
const openInvite = document.querySelector("#openInvite");
const cancelEvent = document.querySelector("#cancelEvent");
const inviteDialog = document.querySelector("#inviteDialog");
const closeInvite = document.querySelector("#closeInvite");
const shareRoomId = document.querySelector("#shareRoomId");
const shareLink = document.querySelector("#shareLink");
const copyInvite = document.querySelector("#copyInvite");
const crewQuickRequests = document.querySelector("#crewQuickRequests");
const crewRequestButtons = document.querySelectorAll("[data-crew-request]");
const directorRequests = document.querySelector("#directorRequests");
const directorRequestList = document.querySelector("#directorRequestList");
const directorRequestCount = document.querySelector("#directorRequestCount");
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
const screenSenders = new Map();
const pendingCandidates = new Map();
let localStream = null;
let localScreenStream = null;
let remoteScreenStream = null;
let remoteScreenPeerId = "";
let isScreenPreviewFloating = false;
let screenPreviewPointerAction = null;
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

function saveSession() {
  if (!state.roomId || !state.role || !state.name) return;
  try {
    sessionStorage.setItem("crewlink-session", JSON.stringify({
      roomId: state.roomId,
      name: state.name,
      role: state.role,
      eventName: state.eventName,
      activeTab: state.activeTab
    }));
  } catch (error) {}
}

function clearSession() {
  try { sessionStorage.removeItem("crewlink-session"); } catch (error) {}
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem("crewlink-session");
    return raw ? JSON.parse(raw) : null;
  } catch (error) { return null; }
}

function showScreen(name) {
  Object.entries(screens).forEach(([screenName, element]) => {
    const active = screenName === name;
    element.classList.toggle("hidden", !active);
    element.classList.toggle("screen--active", active);
    element.setAttribute("aria-hidden", String(!active));
  });
  appShell.classList.toggle("is-welcome-view", name === "welcome");
  appShell.classList.toggle("is-form-view", name === "create" || name === "join");
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
  const desktopDashboard = state.role === "Director" && window.matchMedia("(min-width: 760px)").matches;
  bottomNav.classList.toggle("hidden", !inRoom || desktopDashboard);
  roomTabButtons.forEach((button) => {
    const isActive = button.dataset.roomTab === state.activeTab;
    button.classList.toggle("is-active", isActive);
    button.toggleAttribute("aria-current", isActive);
  });
  chatBadge.textContent = state.unreadMessages;
  chatBadge.classList.toggle("hidden", state.unreadMessages === 0);
}

function renderEventCover() {
  const hasCover = Boolean(state.coverImage);
  eventCover.classList.toggle("hidden", !hasCover);
  eventCover.style.backgroundImage = hasCover ? `url("${state.coverImage}")` : "";
  appShell.classList.toggle("has-event-cover", hasCover);
}

function renderCrewQuickRequests() {
  const isCrew = state.role === "Crew";
  crewQuickRequests.classList.toggle("hidden", !isCrew);

  crewRequestButtons.forEach((button) => {
    const type = button.dataset.crewRequest;
    const status = state.requestStatuses[type]?.status || "ask";
    const statusLabel = status === "pending" ? "SENT" : status.toUpperCase();
    button.disabled = status === "pending";
    button.classList.remove("is-pending", "is-yes", "is-wait", "is-cancel");
    if (status !== "ask") {
      button.classList.add(`is-${status}`);
    }
    button.querySelector("b").textContent = statusLabel;
  });
}

function renderDirectorRequests() {
  const isDirector = state.role === "Director";
  directorRequests.classList.toggle("hidden", !isDirector);
  if (!isDirector) {
    return;
  }

  const requests = Array.isArray(state.crewRequests) ? state.crewRequests : [];
  directorRequestCount.textContent = requests.filter((request) => request.status === "pending").length;
  directorRequestList.replaceChildren();

  if (requests.length === 0) {
    const empty = document.createElement("p");
    empty.className = "director-request-empty";
    empty.textContent = "No crew requests yet.";
    directorRequestList.append(empty);
    return;
  }

  requests.forEach((request) => {
    const card = document.createElement("article");
    card.className = "director-request-card";
    const header = document.createElement("header");
    const details = document.createElement("div");
    const label = document.createElement("p");
    label.textContent = REQUEST_LABELS[request.type]?.toUpperCase() || "CREW REQUEST";
    const name = document.createElement("h4");
    name.textContent = request.requesterName;
    const status = document.createElement("span");
    status.className = "director-request-status";
    status.textContent = request.status === "pending" ? "NEEDS REPLY" : request.status.toUpperCase();
    details.append(label, name);
    header.append(details, status);
    card.append(header);

    if (request.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "director-request-actions";
      ["yes", "wait", "cancel"].forEach((response) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.requestId = request.id;
        button.dataset.response = response;
        button.textContent = response.toUpperCase();
        actions.append(button);
      });
      card.append(actions);
    }

    directorRequestList.append(card);
  });
}

function sendCrewRequest(type) {
  if (state.role !== "Crew" || !state.roomId || !REQUEST_LABELS[type]) {
    return;
  }

  state.requestStatuses[type] = { type, status: "pending" };
  renderCrewQuickRequests();
  socket.emit("crew-request", { type });
}

function renderDirectorPerformance() {
  const isDirector = state.role === "Director";
  directorLiveOverview.classList.toggle("hidden", !isDirector);
  if (!isDirector) {
    return;
  }

  const crew = state.users.filter((user) => user.role === "Crew");
  const linkedCrew = crew.filter((user) => peerConnections.get(user.id)?.connectionState === "connected");
  const linkPercentage = crew.length === 0 ? 100 : Math.round((linkedCrew.length / crew.length) * 100);

  performanceRing.style.setProperty("--performance", `${linkPercentage}%`);
  performanceValue.textContent = `${linkPercentage}%`;
  metricCrewOnline.textContent = String(crew.length);
  metricAudioLinks.textContent = `${linkedCrew.length}/${crew.length}`;
  metricOnAir.textContent = state.speaker ? state.speaker.name : "CLEAR";
  metricLiveWindow.textContent = localScreenStream || state.directorScreenSharing ? "LIVE" : "READY";

  // push a new data point and keep last 20
  if (!renderDirectorPerformance._history) renderDirectorPerformance._history = [];
  renderDirectorPerformance._history.push(linkPercentage);
  if (renderDirectorPerformance._history.length > 20) renderDirectorPerformance._history.shift();
  const history = renderDirectorPerformance._history;

  // redraw SVG path from real history
  const svgEl = directorLiveOverview.querySelector(".performance-chart svg");
  const chartStrong = directorLiveOverview.querySelector(".performance-chart strong");
  if (svgEl && history.length > 1) {
    const W = 300, H = 78, pad = 6;
    const pts = history.map((v, i) => [
      Math.round((i / (history.length - 1)) * W),
      Math.round(H - pad - ((v / 100) * (H - pad * 2)))
    ]);
    const line = pts.map((p, i) => (i === 0 ? `M${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`)).join(" ");
    const fill = `${line} L${pts[pts.length-1][0]} ${H} L0 ${H} Z`;
    svgEl.querySelector("path:first-of-type").setAttribute("d", fill);
    svgEl.querySelector("path:last-of-type").setAttribute("d", line);
    chartStrong.textContent = linkPercentage === 100 ? "Stable live connection" : linkPercentage > 50 ? "Partial crew linked" : "Low crew connection";
  }

  performanceDiagram.replaceChildren();

  if (crew.length === 0) {
    const empty = document.createElement("span");
    empty.className = "performance-node";
    empty.textContent = "Waiting for crew phones";
    performanceDiagram.append(empty);
    return;
  }

  crew.forEach((user) => {
    const node = document.createElement("span");
    const linked = peerConnections.get(user.id)?.connectionState === "connected";
    node.className = `performance-node${linked ? " is-linked" : ""}${state.speaker?.id === user.id ? " is-speaking" : ""}`;
    node.textContent = state.speaker?.id === user.id ? `${user.name} · TALKING` : user.name;
    performanceDiagram.append(node);
  });
}

function renderScreenShare() {
  const isDirector = state.role === "Director";
  const isCrew = state.role === "Crew";
  const isSharing = Boolean(localScreenStream);
  const hasRemoteScreen = Boolean(remoteScreenStream);

  directorScreenShare.classList.toggle("hidden", !isDirector);
  directorScreenStatus.textContent = isSharing ? "LIVE" : "OFF";
  directorScreenStatus.classList.toggle("is-live", isSharing);
  toggleScreenShare.textContent = isSharing ? "Stop window capture" : "Start window capture";
  toggleScreenShare.classList.toggle("is-sharing", isSharing);
  screenPreview.classList.toggle("hidden", !isSharing);
  if (!isSharing) {
    isScreenPreviewFloating = false;
    resetScreenPreviewPlacement();
  }
  screenPreview.classList.toggle("is-floating", isScreenPreviewFloating);
  toggleScreenFloat.setAttribute("aria-pressed", String(isScreenPreviewFloating));
  toggleScreenFloat.textContent = isScreenPreviewFloating ? "Dock view" : "Float view";
  if (directorScreenVideo.srcObject !== localScreenStream) {
    directorScreenVideo.srcObject = localScreenStream;
  }

  const showCrewView = isCrew && (state.directorScreenSharing || hasRemoteScreen);
  crewLiveView.classList.toggle("hidden", !showCrewView);
  crewLiveView.classList.toggle("has-video", hasRemoteScreen);
  crewScreenStatus.textContent = state.directorScreenSharing ? "LIVE" : "OFF";
  crewScreenStatus.classList.toggle("is-live", state.directorScreenSharing);
  crewScreenNote.textContent = hasRemoteScreen
    ? "The director is sharing a live window."
    : state.directorScreenSharing
      ? "Connecting to the director’s shared window…"
      : "The director is not sharing a window.";
  if (crewScreenVideo.srcObject !== remoteScreenStream) {
    crewScreenVideo.srcObject = remoteScreenStream;
  }
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
  saveSession();
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
  talkButton.disabled = !state.microphoneReady || Boolean(someoneElseIsTalking);
  let status = "READY";

  if (audioLinkError && peerCount > 0) {
    status = "LINK ERROR";
    talkInstruction.textContent = "Audio link could not connect";
    audioNote.textContent = audioLinkError;
  } else if (isTalking && audioLinkPending) {
    status = "LINKING";
    talkInstruction.textContent = "Sending while audio connects";
    audioNote.textContent = state.relayConfigured
      ? "Your microphone is active while the crew audio link finishes connecting."
      : "Your microphone is active. If nobody hears you, add TURN relay settings in Render.";
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
    talkInstruction.textContent = "Connecting audio to crew — tap TALK to test";
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
  renderDirectorPerformance();
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
  openInvite.classList.toggle("hidden", !isDirector);
  cancelEvent.classList.toggle("hidden", !isDirector);
  if (!isDirector && inviteDialog.open) {
    inviteDialog.close();
  }
  shareRoomId.textContent = state.roomId || "ROOM";
  shareLink.textContent = crewJoinLink();
  renderEventCover();
  renderCrewQuickRequests();
  renderDirectorRequests();
  renderDirectorPerformance();
  renderScreenShare();
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
    showToast("Copy is unavailable here. Share the room ID and crew link shown in this popup.");
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
    audio.volume = Number(volumeControl.value) / 100;
    audio.dataset.peerId = peerId;
    document.body.append(audio);
    remoteAudioElements.set(peerId, audio);
  }
  return audio;
}

function setCrewVolume() {
  const volume = Number(volumeControl.value) / 100;
  remoteAudioElements.forEach((audio) => {
    audio.volume = volume;
  });
}

async function syncScreenTrack(peerId, connection) {
  const screenTrack = localScreenStream?.getVideoTracks()[0] || null;
  const sender = screenSenders.get(peerId);

  if (sender) {
    await sender.replaceTrack(screenTrack);
    return;
  }

  if (screenTrack && localScreenStream) {
    screenSenders.set(peerId, connection.addTrack(screenTrack, localScreenStream));
  }
}

async function renegotiateScreenShare() {
  await Promise.all([...peerConnections.entries()].map(async ([peerId, connection]) => {
    if (connection.signalingState === "closed") {
      return;
    }

    await syncScreenTrack(peerId, connection);
    await createOffer(peerId);
  }));
}

function clearRemoteScreen(peerId = "") {
  if (peerId && remoteScreenPeerId !== peerId) {
    return;
  }

  remoteScreenPeerId = "";
  remoteScreenStream = null;
  renderScreenShare();
}

function setRemoteScreen(peerId, stream, track) {
  remoteScreenPeerId = peerId;
  remoteScreenStream = stream;
  track.addEventListener("ended", () => clearRemoteScreen(peerId), { once: true });
  renderScreenShare();
  crewScreenVideo.play().catch(() => undefined);
}

async function startScreenShare() {
  if (state.role !== "Director" || !state.roomId) {
    return;
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast("Window capture is not supported in this browser.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 24, max: 30 } },
      audio: false
    });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
      showToast("No window was selected to share.");
      return;
    }

    localScreenStream = stream;
    track.addEventListener("ended", () => stopScreenShare(), { once: true });
    renderScreenShare();
    socket.emit("director-screen-status", { isSharing: true });
    await renegotiateScreenShare();
    showToast("Your window is now live for the crew.");
  } catch (error) {
    if (error?.name !== "NotAllowedError") {
      showToast("Could not start window capture. Try again.");
    }
  }
}

async function stopScreenShare(announce = true, shouldRenegotiate = true) {
  if (!localScreenStream) {
    return;
  }

  const stream = localScreenStream;
  localScreenStream = null;
  stream.getTracks().forEach((track) => track.stop());
  renderScreenShare();
  if (announce && state.roomId) {
    socket.emit("director-screen-status", { isSharing: false });
  }

  if (!shouldRenegotiate) {
    return;
  }

  try {
    await renegotiateScreenShare();
  } catch (error) {}
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
  screenSenders.delete(peerId);

  const audio = remoteAudioElements.get(peerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    remoteAudioElements.delete(peerId);
  }

  clearRemoteScreen(peerId);
  updateTalkButton();
  renderDirectorPerformance();
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
  const screenTrack = localScreenStream?.getVideoTracks()[0];
  if (screenTrack && localScreenStream) {
    screenSenders.set(peerId, connection.addTrack(screenTrack, localScreenStream));
  }

  connection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit("webrtc-ice-candidate", { targetId: peerId, candidate });
    }
  };

  connection.ontrack = ({ streams, track }) => {
    const stream = streams[0];
    if (!stream) {
      return;
    }

    if (track.kind === "video") {
      setRemoteScreen(peerId, stream, track);
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
    renderDirectorPerformance();
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

function readSelectedCoverImage() {
  const file = document.querySelector("#createCoverImage").files[0];
  if (!file) {
    return Promise.resolve("");
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    showToast("Choose a JPG, PNG, or WebP cover image.");
    return Promise.reject(new Error("Unsupported cover image type"));
  }

  if (file.size > 450 * 1024) {
    showToast("Choose a cover image smaller than 450 KB.");
    return Promise.reject(new Error("Cover image is too large"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the cover image"));
    reader.readAsDataURL(file);
  });
}

async function enterRoom(event, roomDetails) {
  event.preventDefault();
  state.name = roomDetails.name();
  state.roomId = normaliseRoomId(roomDetails.roomId());
  state.eventName = roomDetails.eventName?.() || "";
  let coverImage = "";

  try {
    coverImage = roomDetails.coverImage ? await roomDetails.coverImage() : "";
  } catch (error) {
    return;
  }

  await Promise.all([prepareMicrophone(), loadRtcConfiguration()]);
  socket.emit(roomDetails.event, {
    roomId: state.roomId,
    name: state.name,
    eventName: state.eventName,
    coverImage
  });
}

document.querySelector("#showCreate").addEventListener("click", () => showScreen("create"));
document.querySelector("#showJoin").addEventListener("click", () => showScreen("join"));
document.querySelectorAll("[data-landing-action]").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.landingAction));
});
document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => showScreen("welcome")));

document.querySelectorAll(".room-input").forEach((input) => {
  input.addEventListener("input", () => {
    input.value = normaliseRoomId(input.value);
  });
});

document.querySelector("#createForm").addEventListener("submit", (event) => enterRoom(event, {
  event: "create-event",
  coverImage: readSelectedCoverImage,
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
  if (inviteDialog.open) {
    inviteDialog.close();
  }
  clearSession();
  stopScreenShare(false, false);
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
  state.coverImage = "";
  state.crewRequests = [];
  state.requestStatuses = {};
  state.directorScreenSharing = false;
  clearRemoteScreen();
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

cancelEvent.addEventListener("click", () => {
  if (state.role !== "Director" || !state.roomId) {
    return;
  }

  const eventLabel = state.eventName || "this event";
  if (window.confirm(`Cancel ${eventLabel}? Everyone in the room will be sent back to the home page.`)) {
    socket.emit("cancel-event");
  }
});

talkButton.addEventListener("click", toggleTalking);
volumeControl.addEventListener("input", setCrewVolume);
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
toggleScreenShare.addEventListener("click", () => {
  if (localScreenStream) {
    stopScreenShare();
  } else {
    startScreenShare();
  }
});
toggleScreenFloat.addEventListener("click", () => {
  isScreenPreviewFloating = !isScreenPreviewFloating;
  renderScreenShare();
});
crewRequestButtons.forEach((button) => {
  button.addEventListener("click", () => sendCrewRequest(button.dataset.crewRequest));
});
directorRequestList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-request-id]");
  if (!button || state.role !== "Director") {
    return;
  }

  socket.emit("respond-to-crew-request", {
    requestId: button.dataset.requestId,
    response: button.dataset.response
  });
});
openInvite.addEventListener("click", () => {
  if (state.role === "Director") {
    inviteDialog.showModal();
  }
});
closeInvite.addEventListener("click", () => inviteDialog.close());
inviteDialog.addEventListener("click", (event) => {
  if (event.target === inviteDialog) {
    inviteDialog.close();
  }
});
copyInvite.addEventListener("click", copyEventInvite);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopTalking();
  }
});
window.addEventListener("beforeunload", () => {
  stopScreenShare(false, false);
  stopTalking();
  closeAllPeerConnections();
  releaseMicrophone();
});
window.addEventListener("resize", renderBottomNav);

socket.on("connect", () => {
  connectionStatus.textContent = "Connected to CrewLink";
  connectionStatus.classList.add("connected");

  const session = loadSession();
  if (session?.roomId && session?.name && session?.role) {
    state.name = session.name;
    state.eventName = session.eventName || "";
    state.activeTab = ["home", "chat"].includes(session.activeTab) ? session.activeTab : "home";
    // Re-prepare mic and RTC config, then rejoin
    Promise.all([prepareMicrophone(), loadRtcConfiguration()]).then(() => {
      const rejoinEvent = session.role === "Director" ? "create-event" : "join-event";
      socket.emit(rejoinEvent, {
        roomId: session.roomId,
        name: session.name,
        eventName: session.eventName || "",
        coverImage: ""
      });
    });
  }
});

socket.on("disconnect", () => {
  connectionStatus.textContent = "Connection lost — reconnecting";
  connectionStatus.classList.remove("connected");
  stopTalking();
  stopScreenShare(false, false);
  closeAllPeerConnections();
});

socket.on("room-joined", (data) => {
  state.roomId = data.roomId;
  state.eventName = data.eventName;
  state.role = data.role;
  state.directorCameraStatus = data.directorCameraStatus;
  state.directorScreenSharing = Boolean(data.directorScreenSharing);
  state.coverImage = data.coverImage || "";
  state.crewRequests = [];
  state.requestStatuses = {};
  state.activeTab = ["home", "chat"].includes(state.activeTab) ? state.activeTab : "home";
  state.unreadMessages = 0;
  audioLinkError = "";
  document.querySelector("#roomId").textContent = `ROOM · ${data.roomId}`;
  document.querySelector("#eventTitle").textContent = data.eventName;
  showScreen("room");
  renderSpeaker();
  renderDirectorCameraStatus();
  renderRoleLayout();
  setActiveTab(state.activeTab);
  saveSession();
});

socket.on("director-offline", () => {
  if (state.role === "Director") return;
  showToast("Director has disconnected. Waiting for them to return…");
  connectionStatus.textContent = "Director offline — waiting";
  connectionStatus.classList.remove("connected");
});

socket.on("director-returned", () => {
  if (state.role === "Director") return;
  showToast("Director is back online.");
  connectionStatus.textContent = "Connected to CrewLink";
  connectionStatus.classList.add("connected");
});

socket.on("event-ended", () => {
  clearSession();
  showToast("The event has been cancelled by the director.");
  stopScreenShare(false, false);
  stopTalking();
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
  state.coverImage = "";
  state.crewRequests = [];
  state.requestStatuses = {};
  state.directorScreenSharing = false;
  clearRemoteScreen();
  state.activeTab = "home";
  state.unreadMessages = 0;
  screens.room.classList.remove("showing-chat");
  chatPanel.classList.add("hidden");
  renderChatMessages();
  renderDirectorCameraStatus();
  renderRoleLayout();
  loadCrewJoinLink();
  showScreen("welcome");
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
socket.on("crew-requests-updated", (requests) => {
  state.crewRequests = Array.isArray(requests) ? requests : [];
  renderDirectorRequests();
});
socket.on("crew-request-statuses", (requests) => {
  state.requestStatuses = (Array.isArray(requests) ? requests : []).reduce((statuses, request) => {
    statuses[request.type] = request;
    return statuses;
  }, {});
  renderCrewQuickRequests();
});
socket.on("crew-request-updated", (request) => {
  if (!request?.type) {
    return;
  }

  state.requestStatuses[request.type] = request;
  renderCrewQuickRequests();
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
socket.on("director-screen-status-updated", (data) => {
  state.directorScreenSharing = Boolean(data.isSharing);
  if (!state.directorScreenSharing) {
    clearRemoteScreen();
  }
  renderScreenShare();
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
