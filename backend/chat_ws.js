const WebSocket = require("ws");
const url = require("url");
const jwt = require("jsonwebtoken");
const Chat = require("./models/Chat");
const User = require("./models/User");

const JWT_SECRET = process.env.JWT_SECRET || "relcon-secret-key";
const DM_RETENTION_DAYS = 15;

function getDmExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + DM_RETENTION_DAYS);
  return expiresAt;
}

// username -> set of sockets
const clients = new Map();

function verifyToken(token) {
  try {
    const cleanToken = token.replace(/^Bearer\s+/i, "");
    try {
      return jwt.verify(cleanToken, JWT_SECRET);
    } catch {
      return jwt.decode(cleanToken); // Fallback for testing with production token
    }
  } catch {
    return null;
  }
}

async function isActiveSocketUser(payload) {
  const username = String(payload?.username || "").trim();
  const email = String(payload?.email || "").trim();
  const engineerName = String(payload?.engineerName || payload?.name || "").trim();
  const queries = [];
  if (username) queries.push({ username });
  if (email) queries.push({ email });
  if (engineerName) queries.push({ engineerName });
  if (!queries.length) return true;
  const user = await User.findOne({ $or: queries }, "isActive").lean();
  return !user || user.isActive !== false;
}

function broadcastPresence() {
  // Build list of currently online users
  const users = Array.from(clients.keys()).map((name) => ({
    name,          // ✅ used by frontend presenceOnlineSet
    engineerName: name,
    online: true,
  }));

  const payload = { type: "presence", users };

  for (const conns of clients.values()) {
    for (const s of conns) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify(payload));
      }
    }
  }
}

function setupWebsocket(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    const parsed = url.parse(request.url, true);
   // ✅ Only allow /ws
    if (!parsed.pathname.startsWith("/ws")) {
      socket.destroy();
      return;
    } 
    const token = parsed.query.token;
    const payload = verifyToken(token);
    let active = false;
    try {
      active = Boolean(payload) && await isActiveSocketUser(payload);
    } catch {
      active = false;
    }
    if (!active) {
      socket.destroy();
      return;
    }
    const username = (
      payload.engineerName ||
      payload.name ||
      payload.username ||
      ""
    ).trim();

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.user = username;
      ws.meetingOnly = Boolean(payload.meetingOnly);
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    const user = ws.user;
    if (!clients.has(user)) clients.set(user, new Set());
    clients.get(user).add(ws);

    // Notify the new socket
    ws.send(JSON.stringify({ type: "system", text: `✅ Connected as ${user}` }));

    // Broadcast updated presence to everyone
    broadcastPresence();

    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // Client asking for current presence explicitly
      if (msg.type === "get_presence") {
        if (ws.meetingOnly) {
          ws.send(JSON.stringify({ type: "presence", users: [{ name: user, engineerName: user, online: true }] }));
          return;
        }
        const users = Array.from(clients.keys()).map((name) => ({
          name,
          engineerName: name,
          online: true,
        }));
        ws.send(JSON.stringify({ type: "presence", users }));
        return;
      }

      if (msg.type === "typing") {
        if (ws.meetingOnly) return;
        const payload = { type: "typing", from: user };
        for (const [username, conns] of clients.entries()) {
          if (username === user) continue;
          for (const s of conns) {
            if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify(payload));
          }
        }
        return;
      }

      if (msg.type === "ping") {
        if (ws.meetingOnly) return;
        const payload = {
          type: "ping",
          from: user,
          to: msg.to,
          channel: msg.channel,
          text: String(msg.text || "Ping").slice(0, 160),
          createdAt: new Date().toISOString(),
        };
        const payloadStr = JSON.stringify(payload);
        if (msg.channel) {
          for (const [username, conns] of clients.entries()) {
            if (username === user) continue;
            for (const s of conns) {
              if (s.readyState === WebSocket.OPEN) s.send(payloadStr);
            }
          }
          return;
        }
        if (msg.to && msg.to !== user && clients.has(msg.to)) {
          for (const s of clients.get(msg.to)) {
            if (s.readyState === WebSocket.OPEN) s.send(payloadStr);
          }
        }
        if (clients.has(user)) {
          for (const s of clients.get(user)) {
            if (s.readyState === WebSocket.OPEN) s.send(payloadStr);
          }
        }
        return;
      }

      if (msg.type === "call_signal") {
        const payload = {
          type: "call_signal",
          signalType: msg.signalType,
          callId: msg.callId,
          from: user,
          to: msg.to,
          channel: msg.channel,
          mediaKind: msg.mediaKind,
          sdp: msg.sdp,
          candidate: msg.candidate,
          reason: msg.reason,
          sharedBy: msg.sharedBy,
          raised: msg.raised,
        };
        const payloadStr = JSON.stringify(payload);

        if (msg.channel) {
          for (const [username, conns] of clients.entries()) {
            if (username === user && msg.signalType === "offer") continue;
            for (const s of conns) {
              if (s.readyState === WebSocket.OPEN) s.send(payloadStr);
            }
          }
          return;
        }

        if (clients.has(user)) {
          for (const s of clients.get(user)) {
            if (s.readyState === WebSocket.OPEN) s.send(payloadStr);
          }
        }
        if (msg.to && msg.to !== user && clients.has(msg.to)) {
          for (const s of clients.get(msg.to)) {
            if (s.readyState === WebSocket.OPEN) s.send(payloadStr);
          }
        }
        return;
      }

      // ✅ Handle message delete broadcast
      if (msg.type === "delete_message") {
        if (ws.meetingOnly) return;
        const payload = JSON.stringify({ type: "message_deleted", messageId: msg.messageId });
        for (const conns of clients.values()) {
          for (const s of conns) {
            if (s.readyState === WebSocket.OPEN) s.send(payload);
          }
        }
        return;
      }

      // 📦 Handle group chat (channels)
      if (msg.type === "group") {
        if (ws.meetingOnly) return;
        const channelName = msg.channel || "group";
        const messageDoc = await Chat.create({
          from: user,
          to: channelName,
          roomId: channelName,
          text: msg.text,
          delivered: true,
          read: false,
          replyTo: msg.replyTo || null,
        });

        const payloadMessage = {
          type: "group",
          channel: channelName,
          from: user,
          text: msg.text,
          createdAt: messageDoc.createdAt,
          replyTo: msg.replyTo || null,
        };

        for (const conns of clients.values()) {
          for (const s of conns) {
            if (s.readyState === WebSocket.OPEN) {
              s.send(JSON.stringify(payloadMessage));
            }
          }
        }
      }

      // 📦 Handle Direct Message (DM)
      if (msg.type === "dm") {
        if (ws.meetingOnly) return;
        const roomId = [user, msg.to].sort().join("__");
        const messageDoc = await Chat.create({
          from: user,
          to: msg.to,
          roomId: roomId,
          text: msg.text,
          delivered: true,
          read: false,
          replyTo: msg.replyTo || null,
          expiresAt: getDmExpiryDate(),
        });

        const payloadMessage = {
          type: "dm",
          from: user,
          to: msg.to,
          text: msg.text,
          createdAt: messageDoc.createdAt,
          replyTo: msg.replyTo || null,
        };

        const payloadStr = JSON.stringify(payloadMessage);

        if (clients.has(user)) {
          for (const s of clients.get(user)) {
            if (s.readyState === WebSocket.OPEN) s.send(payloadStr);
          }
        }
        if (msg.to !== user && clients.has(msg.to)) {
          for (const s of clients.get(msg.to)) {
            if (s.readyState === WebSocket.OPEN) s.send(payloadStr);
          }
        }
      }
    });

    ws.on("close", () => {
      if (clients.has(user)) {
        clients.get(user).delete(ws);
        if (clients.get(user).size === 0) clients.delete(user);
      }
      broadcastPresence();
    });
  });
}

function broadcastToAll(message) {
  const data = JSON.stringify(message);
  for (const conns of clients.values()) {
    for (const s of conns) {
      if (s.readyState === WebSocket.OPEN) s.send(data);
    }
  }
}



module.exports = { setupWebsocket, broadcastToAll };
