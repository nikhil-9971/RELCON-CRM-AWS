const express = require("express");
const router = express.Router();
const CRMNotification = require("../models/CRMNotification");
const verifyToken = require("../middleware/authMiddleware");

function getCurrentUsername(req) {
  return String(req.user?.username || "").trim().toLowerCase();
}

router.get("/notifications", verifyToken, async (req, res) => {
  try {
    const username = getCurrentUsername(req);
    if (!username) return res.status(401).json({ error: "Unauthorized" });

    const limit = Math.min(Number(req.query.limit || 30) || 30, 100);
    const notifications = await CRMNotification.find({ recipientUsername: username })
      .sort({ isRead: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ notifications });
  } catch (err) {
    console.error("notifications list error:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.get("/notifications/unread-count", verifyToken, async (req, res) => {
  try {
    const username = getCurrentUsername(req);
    if (!username) return res.status(401).json({ error: "Unauthorized" });

    const count = await CRMNotification.countDocuments({
      recipientUsername: username,
      isRead: false,
    });

    res.json({ count });
  } catch (err) {
    console.error("notifications unread count error:", err);
    res.status(500).json({ error: "Failed to fetch notification count" });
  }
});

router.put("/notifications/:id/read", verifyToken, async (req, res) => {
  try {
    const username = getCurrentUsername(req);
    if (!username) return res.status(401).json({ error: "Unauthorized" });

    const notification = await CRMNotification.findOneAndUpdate(
      { _id: req.params.id, recipientUsername: username },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) return res.status(404).json({ error: "Notification not found" });
    res.json({ notification });
  } catch (err) {
    console.error("notification mark read error:", err);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

router.put("/notifications/read-all", verifyToken, async (req, res) => {
  try {
    const username = getCurrentUsername(req);
    if (!username) return res.status(401).json({ error: "Unauthorized" });

    const result = await CRMNotification.updateMany(
      { recipientUsername: username, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({ updated: result.modifiedCount || 0 });
  } catch (err) {
    console.error("notifications mark all read error:", err);
    res.status(500).json({ error: "Failed to mark notifications as read" });
  }
});

module.exports = router;
