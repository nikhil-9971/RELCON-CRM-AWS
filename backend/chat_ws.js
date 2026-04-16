const WebSocket = require("ws");
const url = require("url");
const jwt = require("jsonwebtoken");
const Chat = require("./models/Chat");

const JWT_SECRET = process.env.JWT_SECRET || "relcon-secret-key";

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

  server.on("upgrade", (request, socket, head) => {
    const parsed = url.parse(request.url, true);
    const token = parsed.query.token;
    const payload = verifyToken(token);
    if (!payload) {
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
        const users = Array.from(clients.keys()).map((name) => ({
          name,
          engineerName: name,
          online: true,
        }));
        ws.send(JSON.stringify({ type: "presence", users }));
        return;
      }

      if (msg.type === "typing") {
        const payload = { type: "typing", from: user };
        for (const [username, conns] of clients.entries()) {
          if (username === user) continue;
          for (const s of conns) {
            if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify(payload));
          }
        }
        return;
      }

      // ✅ Handle message delete broadcast
      if (msg.type === "delete_message") {
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
        const roomId = [user, msg.to].sort().join("__");
        const messageDoc = await Chat.create({
          from: user,
          to: msg.to,
          roomId: roomId,
          text: msg.text,
          delivered: true,
          read: false,
          replyTo: msg.replyTo || null,
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

server.on("upgrade", (request, socket, head) => {
  const parsed = url.parse(request.url, true);

  // ✅ IMPORTANT: Only allow /ws
  if (!parsed.pathname.startsWith("/ws")) {
    socket.destroy();
    return;
  }

  const token = parsed.query.token;
  const payload = verifyToken(token);

  if (!payload) {
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
    wss.emit("connection", ws, request);
  });
});

module.exports = { setupWebsocket, broadcastToAll };
