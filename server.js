const path = require("path");
const http = require("http");
const os = require("os");
const express = require("express");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const app = express();
const server = http.createServer(app);
const clientOrigins = String(process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const io = new Server(server, clientOrigins.length > 0 ? {
  cors: {
    origin: clientOrigins,
    methods: ["GET", "POST"]
  }
} : {});
const rooms = new Map();
const REQUEST_TYPES = new Set(["battery", "backup", "camera"]);
const REQUEST_RESPONSES = new Set(["yes", "wait", "cancel"]);
const MAX_COVER_IMAGE_LENGTH = 700000;

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));

function localNetworkAddress() {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((network) => network && network.family === "IPv4" && !network.internal);
  const privateAddress = addresses.find((network) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(network.address));

  return (privateAddress || addresses[0])?.address || null;
}

app.get("/api/connection-info", (request, response) => {
  const address = localNetworkAddress();

  response.json({
    crewUrl: address ? `http://${address}:${PORT}` : null
  });
});

app.get("/api/health", (request, response) => {
  response.status(200).json({ status: "ok" });
});

function turnUrls() {
  return String(process.env.TURN_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

app.get("/api/webrtc-config", (request, response) => {
  const urls = turnUrls();
  const username = String(process.env.TURN_USERNAME || "").trim();
  const credential = String(process.env.TURN_CREDENTIAL || "").trim();
  const relayConfigured = urls.length > 0 && Boolean(username && credential);
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];

  if (relayConfigured) {
    iceServers.push({ urls, username, credential });
  }

  response.json({ iceServers, relayConfigured });
});

function normaliseRoomId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);
}

function normaliseName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function normaliseChatMessage(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 400);
}

function normaliseCoverImage(value) {
  const image = typeof value === "string" ? value.trim() : "";
  if (image.length > MAX_COVER_IMAGE_LENGTH) {
    return "";
  }

  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(image) ? image : "";
}

function usersIn(roomId) {
  const room = rooms.get(roomId);
  return room ? [...room.users.values()] : [];
}

function broadcastUsers(roomId) {
  io.to(roomId).emit("users-updated", usersIn(roomId));
}

function requestsIn(room) {
  return [...room.crewRequests.values()].sort((first, second) => second.updatedAt - first.updatedAt);
}

function broadcastDirectorRequests(room) {
  const requests = requestsIn(room);
  room.users.forEach((user, socketId) => {
    if (user.role === "Director") {
      io.to(socketId).emit("crew-requests-updated", requests);
    }
  });
}

function canSignalPeer(socket, targetId) {
  const room = rooms.get(socket.data.roomId);
  return Boolean(room && typeof targetId === "string" && room.users.has(targetId));
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) {
    return;
  }

  const room = rooms.get(roomId);
  socket.leave(roomId);

  if (room) {
    io.to(roomId).except(socket.id).emit("peer-left", socket.id);

    if (socket.data.role === "Director" && room.directorCameraStatus) {
      room.directorCameraStatus = false;
      io.to(roomId).emit("director-camera-status-updated", {
        directorId: socket.id,
        directorName: socket.data.name,
        isOnCamera: false
      });
    }

    room.users.delete(socket.id);
    if (room.activeSpeaker?.id === socket.id) {
      room.activeSpeaker = null;
      io.to(roomId).emit("speaker-updated", null);
    }

    if (room.users.size === 0) {
      rooms.delete(roomId);
    } else {
      broadcastUsers(roomId);
    }
  }

  socket.data.roomId = null;
}

function joinRoom(socket, roomId, name, role) {
  const room = rooms.get(roomId);
  const peerIds = [...room.users.keys()];

  socket.join(roomId);
  socket.data.roomId = roomId;
  socket.data.name = name;
  socket.data.role = role;

  room.users.set(socket.id, {
    id: socket.id,
    name,
    role
  });

  socket.emit("room-joined", {
    roomId,
    eventName: room.eventName,
    role,
    directorCameraStatus: room.directorCameraStatus,
    coverImage: room.coverImage
  });
  if (role === "Director") {
    socket.emit("crew-requests-updated", requestsIn(room));
  } else {
    socket.emit("crew-request-statuses", requestsIn(room).filter((request) => request.requesterId === socket.id));
  }
  socket.emit("chat-history", room.messages);
  socket.emit("webrtc-peers", peerIds);
  broadcastUsers(roomId);
}

io.on("connection", (socket) => {
  socket.on("create-event", (payload = {}) => {
    const roomId = normaliseRoomId(payload.roomId);
    const name = normaliseName(payload.name);
    const eventName = normaliseName(payload.eventName) || "Untitled event";
    const coverImage = normaliseCoverImage(payload.coverImage);

    if (!roomId || !name) {
      socket.emit("room-error", "Enter your name and a room ID.");
      return;
    }

    if (rooms.has(roomId)) {
      socket.emit("room-error", "That room ID is already in use. Choose another one.");
      return;
    }

    leaveCurrentRoom(socket);
    rooms.set(roomId, {
      eventName,
      coverImage,
      users: new Map(),
      activeSpeaker: null,
      directorCameraStatus: false,
      messages: [],
      crewRequests: new Map()
    });
    joinRoom(socket, roomId, name, "Director");
  });

  socket.on("join-event", (payload = {}) => {
    const roomId = normaliseRoomId(payload.roomId);
    const name = normaliseName(payload.name);

    if (!roomId || !name) {
      socket.emit("room-error", "Enter your name and the room ID.");
      return;
    }

    if (!rooms.has(roomId)) {
      socket.emit("room-error", "Event not found. Check the room ID and try again.");
      return;
    }

    leaveCurrentRoom(socket);
    joinRoom(socket, roomId, name, "Crew");
  });

  socket.on("talk-started", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room) {
      return;
    }

    const user = room.users.get(socket.id);
    if (!user) {
      return;
    }

    const speaker = {
      id: user.id,
      name: user.name,
      role: user.role
    };

    if (room.activeSpeaker?.id === speaker.id) {
      return;
    }

    if (room.activeSpeaker && room.activeSpeaker.id !== speaker.id) {
      if (speaker.role !== "Director") {
        const message = room.activeSpeaker.role === "Director"
          ? "The director is speaking."
          : `${room.activeSpeaker.name} is already speaking.`;
        socket.emit("talk-denied", message);
        return;
      }
    }

    room.activeSpeaker = speaker;
    io.to(roomId).emit("speaker-updated", speaker);
  });

  socket.on("talk-stopped", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || room.activeSpeaker?.id !== socket.id) {
      return;
    }

    room.activeSpeaker = null;
    io.to(roomId).emit("speaker-updated", null);
  });

  socket.on("director-camera-status", ({ isOnCamera } = {}) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || socket.data.role !== "Director") {
      return;
    }

    room.directorCameraStatus = Boolean(isOnCamera);
    io.to(roomId).emit("director-camera-status-updated", {
      directorId: socket.id,
      directorName: socket.data.name,
      isOnCamera: room.directorCameraStatus
    });
  });

  socket.on("crew-request", ({ type } = {}) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || socket.data.role !== "Crew" || !REQUEST_TYPES.has(type) || !room.users.has(socket.id)) {
      return;
    }

    const now = Date.now();
    const request = {
      id: `${socket.id}:${type}`,
      requesterId: socket.id,
      requesterName: socket.data.name,
      type,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };

    room.crewRequests.set(request.id, request);
    socket.emit("crew-request-updated", request);
    broadcastDirectorRequests(room);
  });

  socket.on("respond-to-crew-request", ({ requestId, response } = {}) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || socket.data.role !== "Director" || !REQUEST_RESPONSES.has(response)) {
      return;
    }

    const request = room.crewRequests.get(requestId);
    if (!request) {
      return;
    }

    request.status = response;
    request.updatedAt = Date.now();
    io.to(request.requesterId).emit("crew-request-updated", request);
    broadcastDirectorRequests(room);
  });

  socket.on("send-chat-message", ({ text } = {}) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    const messageText = normaliseChatMessage(text);

    if (!room || !messageText || !room.users.has(socket.id)) {
      return;
    }

    const message = {
      id: `${Date.now()}-${socket.id}`,
      senderId: socket.id,
      name: socket.data.name,
      role: socket.data.role,
      text: messageText,
      sentAt: Date.now()
    };

    room.messages.push(message);
    if (room.messages.length > 100) {
      room.messages.splice(0, room.messages.length - 100);
    }

    io.to(roomId).emit("chat-message", message);
  });

  socket.on("webrtc-offer", ({ targetId, description } = {}) => {
    if (!canSignalPeer(socket, targetId) || description?.type !== "offer") {
      return;
    }

    io.to(targetId).emit("webrtc-offer", {
      senderId: socket.id,
      description
    });
  });

  socket.on("webrtc-answer", ({ targetId, description } = {}) => {
    if (!canSignalPeer(socket, targetId) || description?.type !== "answer") {
      return;
    }

    io.to(targetId).emit("webrtc-answer", {
      senderId: socket.id,
      description
    });
  });

  socket.on("webrtc-ice-candidate", ({ targetId, candidate } = {}) => {
    if (!canSignalPeer(socket, targetId) || !candidate) {
      return;
    }

    io.to(targetId).emit("webrtc-ice-candidate", {
      senderId: socket.id,
      candidate
    });
  });

  socket.on("disconnect", () => leaveCurrentRoom(socket));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`CrewLink is ready at http://localhost:${PORT}`);
});
