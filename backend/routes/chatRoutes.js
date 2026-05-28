const express = require("express");
const router = express.Router();
const Chat = require("../models/Chat");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

function currentChatUser(req) {
  return String(req.user?.engineerName || req.user?.name || req.user?.username || "").trim();
}

function canDeleteForEveryone(message, user) {
  if (!message || !user) return false;
  const current = currentChatUser({ user });
  const role = String(user.role || "").toLowerCase();
  return role === "admin" || String(message.from || "").trim() === current;
}

// Send a message (fallback if not using WS)
router.post("/send", async (req, res) => {
  try {
    const { from, to, text, replyTo } = req.body;
    const roomId = [from, to].sort().join("__");
    const message = await Chat.create({
      from,
      to,
      text,
      roomId,
      delivered: true,
      replyTo: replyTo || null,
    }); // via REST consider delivered
    res.status(201).json(message);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Message sending failed.", details: err.message });
  }
});

// Get history for a room (between two users)
router.get("/history/:user1/:user2", authMiddleware, async (req, res) => {
  const { user1, user2 } = req.params;
  const roomId = [user1, user2].sort().join("__");
  const currentUser = currentChatUser(req);
  try {
    const messages = await Chat.find({
      roomId,
      deletedForEveryoneAt: null,
      deletedFor: { $ne: currentUser },
    }).sort({ createdAt: 1 }).lean();
    res.json(messages);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Fetching chat history failed.", details: err.message });
  }
});

// Mark all from->to as read
router.post("/mark-read", async (req, res) => {
  const { from, to } = req.body; // mark messages in room where to is current user
  const roomId = [from, to].sort().join("__");
  try {
    const result = await Chat.updateMany({ roomId, to, read: false }, { read: true });
    res.json({ success: true, modifiedCount: result.modifiedCount || 0 });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to mark as read.", details: err.message });
  }
});

router.get("/unread-count", authMiddleware, async (req, res) => {
  try {
    const currentUser = String(req.user?.engineerName || req.user?.username || "").trim();
    if (!currentUser) return res.json({ count: 0 });
    const count = await Chat.countDocuments({
      to: currentUser,
      roomId: { $ne: "group" },
      read: false,
      deletedForEveryoneAt: null,
      deletedFor: { $ne: currentUser },
    });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch unread count.", details: err.message });
  }
});

// chatRoutes.js
router.get("/history/group", async (req, res) => {
  try {
    // Get all messages (both user and system) in chronological order
    const allMessages = await Chat.find({
      roomId: "group",
      deletedForEveryoneAt: null,
    })
      .sort({ createdAt: 1 }) // Ensure chronological order
      .lean();

    // Process messages to handle system messages properly
    const processedMessages = allMessages.map((msg) => {
      if (msg.system && msg.text) {
        // ⚡ Convert system message text → html so frontend renders table formatting
        const txt = typeof msg.text === "string" ? msg.text : "";
        if (/<table[\s\S]*<\/table>/i.test(txt)) {
          return {
            ...msg,
            html: txt,
            text: undefined, // Remove text since we're using html
          };
        }
      }
      return msg;
    });

    res.json(processedMessages);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to load chat", details: err.message });
  }
});

// ✅ Get generic channel history
router.get("/history/channel/:channelName", authMiddleware, async (req, res) => {
  const { channelName } = req.params;
  const currentUser = currentChatUser(req);
  try {
    const messages = await Chat.find({
      roomId: channelName,
      deletedForEveryoneAt: null,
      deletedFor: { $ne: currentUser },
    })
      .sort({ createdAt: 1 })
      .lean();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Failed to load history", details: err.message });
  }
});

router.post("/delete-for-me/:messageId", authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const currentUser = currentChatUser(req);
    if (!currentUser) return res.status(401).json({ error: "User not found in token" });

    const message = await Chat.findById(messageId);
    if (!message || message.deletedForEveryoneAt) return res.status(404).json({ error: "Message not found" });
    const participants = new Set([String(message.from || "").trim(), String(message.to || "").trim()]);
    if (!participants.has(currentUser) && message.roomId !== "group") {
      return res.status(403).json({ error: "You cannot delete this message" });
    }

    await Chat.updateOne({ _id: messageId }, { $addToSet: { deletedFor: currentUser } });
    res.json({ success: true, message: "Message deleted for you" });
  } catch (err) {
    console.error("Error deleting message for user:", err);
    res.status(500).json({ error: "Failed to delete message for you", details: err.message });
  }
});

// Delete message for everyone. Senders can delete their own messages; admins can delete any message.
router.delete("/delete/:messageId", authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const currentUser = currentChatUser(req);
    const message = await Chat.findById(messageId);
    if (!message || message.deletedForEveryoneAt) {
      return res.status(404).json({ error: "Message not found" });
    }
    if (!canDeleteForEveryone(message, req.user)) {
      return res.status(403).json({ error: "Only the sender or admin can delete this message for everyone" });
    }

    await Chat.updateOne(
      { _id: messageId },
      { $set: { deletedForEveryoneAt: new Date(), deletedBy: currentUser } }
    );

    const { broadcastToAll } = require("../chat_ws");
    if (broadcastToAll) {
      broadcastToAll({
        type: "message_deleted",
        messageId: messageId,
      });
    }

    res.json({ success: true, message: "Message deleted for everyone" });
  } catch (err) {
    console.error("Error deleting message:", err);
    res
      .status(500)
      .json({ error: "Failed to delete message", details: err.message });
  }
});

router.get("/userlist", authMiddleware, async (req, res) => {
  try {
    const users = await User.find({}, "username engineerName").lean();
    const list = users.map((u) => u.engineerName || u.username);
    res.json([...new Set(list)].sort()); // remove duplicates, sort alphabetically
  } catch (err) {
    res.status(500).json({ error: "Failed to get user list" });
  }
});

// ✅ Get All Chats for DB Explorer
router.get("/getAll", authMiddleware, async (req, res) => {
  try {
    const chats = await Chat.find().sort({ createdAt: -1 }).lean();
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

module.exports = router;
