const express = require("express");
const router = express.Router();
const Chat = require("../models/Chat");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const DM_RETENTION_DAYS = 15;

function getDmExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + DM_RETENTION_DAYS);
  return expiresAt;
}

// Send a message (fallback if not using WS)
router.post("/send", async (req, res) => {
  try {
    const { from, to, text } = req.body;
    const roomId = [from, to].sort().join("__");
    const message = await Chat.create({
      from,
      to,
      text,
      roomId,
      delivered: true,
      expiresAt: getDmExpiryDate(),
    }); // via REST consider delivered
    res.status(201).json(message);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Message sending failed.", details: err.message });
  }
});

// Get history for a room (between two users)
router.get("/history/:user1/:user2", async (req, res) => {
  const { user1, user2 } = req.params;
  const roomId = [user1, user2].sort().join("__");
  try {
    const messages = await Chat.find({ roomId }).sort({ createdAt: 1 }).lean();
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
    await Chat.updateMany({ roomId, to, read: false }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to mark as read.", details: err.message });
  }
});

// chatRoutes.js
router.get("/history/group", async (req, res) => {
  try {
    // Get all messages (both user and system) in chronological order
    const allMessages = await Chat.find({
      roomId: "group",
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
  try {
    const messages = await Chat.find({ roomId: channelName })
      .sort({ createdAt: 1 })
      .lean();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Failed to load history", details: err.message });
  }
});

// Delete message endpoint (admin only)
router.delete("/delete/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;

    // Get user from token to check admin role
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // Verify token and get user
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user is admin
    const user = await User.findById(decoded.userId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Only admins can delete messages" });
    }

    // Find and delete the message
    const message = await Chat.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Delete the message
    await Chat.findByIdAndDelete(messageId);

    // Broadcast deletion to all connected clients
    const { broadcastToAll } = require("../chat_ws");
    if (broadcastToAll) {
      broadcastToAll({
        type: "message_deleted",
        messageId: messageId,
      });
    }

    res.json({ success: true, message: "Message deleted successfully" });
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
