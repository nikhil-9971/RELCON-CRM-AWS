const express = require("express");
const router = express.Router();
const { LoginLog, AuditTrail, EmailLog } = require("../models/AuditLog");
const verifyToken = require("../middleware/authMiddleware");

function requireAdmin(req, res, next) {
  if (String(req.user?.role || "").toLowerCase() !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

// Get Login Logs
router.get("/loginLogs", verifyToken, requireAdmin, async (req, res) => {
  try {
    const logs = await LoginLog.find().sort({ loginTime: -1 }).limit(500);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch login logs" });
  }
});

// Get Audit Trails
router.get("/auditTrails", verifyToken, requireAdmin, async (req, res) => {
  try {
    const trails = await AuditTrail.find().sort({ timestamp: -1 }).limit(500);
    res.json(trails);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch audit trails" });
  }
});

module.exports = router;

// ✅ Get Email Logs
router.get("/emailLogs", verifyToken, requireAdmin, async (req, res) => {
  try {
    const logs = await EmailLog.find().sort({ sentAt: -1 }).limit(500);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch email logs" });
  }
});
