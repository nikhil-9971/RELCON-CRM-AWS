const express = require("express");
const mongoose = require("mongoose");
const DailyWorksheet = require("../models/DailyWorksheet");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function currentAdminName(user = {}) {
  return String(user.engineerName || user.username || user.name || "Admin").trim();
}

function normalizeTime(value = "") {
  return String(value || "").slice(0, 5);
}

function calculateDurationMinutes(startTime, endTime) {
  const [sh, sm] = normalizeTime(startTime).split(":").map(Number);
  const [eh, em] = normalizeTime(endTime).split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  const start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (end < start) end += 24 * 60;
  return Math.max(0, end - start);
}

function normalizeWorksheetPayload(body = {}, user = {}, current = {}) {
  const startTime = normalizeTime(body.startTime ?? current.startTime);
  const endTime = normalizeTime(body.endTime ?? current.endTime);
  const legacyDescription = [current.workTitle, current.workDetails].filter(Boolean).join(" - ");
  return {
    date: String(body.date ?? current.date ?? "").slice(0, 10),
    adminName: current.adminName || currentAdminName(user),
    adminUserId: current.adminUserId || String(user.id || user._id || user.userId || user.username || ""),
    workDescription: String(body.workDescription ?? current.workDescription ?? legacyDescription ?? "").trim(),
    startTime,
    endTime,
    durationMinutes: calculateDurationMinutes(startTime, endTime),
  };
}

router.get("/dailyWorksheet", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const query = {};
    if (req.query.date) query.date = String(req.query.date).slice(0, 10);
    if (req.query.mine === "true") query.adminName = currentAdminName(req.user);
    const rows = await DailyWorksheet.find(query).sort({ date: -1, startTime: 1, createdAt: -1 }).lean();
    res.json(rows);
  } catch (err) {
    console.error("dailyWorksheet list error:", err);
    res.status(500).json({ error: "Failed to fetch worksheet entries" });
  }
});

router.post("/dailyWorksheet", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const payload = normalizeWorksheetPayload(req.body, req.user);
    if (!payload.date || !payload.workDescription) {
      return res.status(400).json({ error: "Date and work description are required" });
    }
    const row = await DailyWorksheet.create(payload);
    res.status(201).json({ message: "Worksheet entry saved", row });
  } catch (err) {
    console.error("dailyWorksheet create error:", err);
    res.status(500).json({ error: "Failed to save worksheet entry" });
  }
});

router.put("/dailyWorksheet/:id", authMiddleware, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid worksheet entry id" });
    }
    const current = await DailyWorksheet.findById(req.params.id);
    if (!current) return res.status(404).json({ error: "Worksheet entry not found" });
    const payload = normalizeWorksheetPayload(req.body, req.user, current.toObject());
    if (!payload.date || !payload.workDescription) {
      return res.status(400).json({ error: "Date and work description are required" });
    }
    Object.assign(current, payload);
    await current.save();
    res.json({ message: "Worksheet entry updated", row: current });
  } catch (err) {
    console.error("dailyWorksheet update error:", err);
    res.status(500).json({ error: "Failed to update worksheet entry" });
  }
});

router.delete("/dailyWorksheet/:id", authMiddleware, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid worksheet entry id" });
    }
    await DailyWorksheet.findByIdAndDelete(req.params.id);
    res.json({ message: "Worksheet entry deleted" });
  } catch (err) {
    console.error("dailyWorksheet delete error:", err);
    res.status(500).json({ error: "Failed to delete worksheet entry" });
  }
});

module.exports = router;
