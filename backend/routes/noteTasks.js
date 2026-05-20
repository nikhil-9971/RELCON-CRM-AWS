const express = require("express");
const mongoose = require("mongoose");
const NoteTask = require("../models/NoteTask");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const VALID_STATUSES = new Set(["open", "in-progress", "done", "archived"]);
const VALID_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function currentAdminName(user = {}) {
  return String(user.engineerName || user.username || user.name || "Admin").trim();
}

function currentAdminUserId(user = {}) {
  return String(user.id || user._id || user.userId || user.username || "").trim();
}

function buildOwnerQuery(user = {}) {
  const adminUserId = currentAdminUserId(user);
  const adminName = currentAdminName(user);
  if (adminUserId) return { adminUserId };
  return { adminName };
}

function normalizePayload(body = {}, user = {}, current = {}) {
  const status = String(body.status ?? current.status ?? "open").trim().toLowerCase();
  const priority = String(body.priority ?? current.priority ?? "medium").trim().toLowerCase();
  return {
    adminName: current.adminName || currentAdminName(user),
    adminUserId: current.adminUserId || currentAdminUserId(user),
    title: String(body.title ?? current.title ?? "").trim(),
    note: String(body.note ?? current.note ?? "").trim(),
    status: VALID_STATUSES.has(status) ? status : "open",
    priority: VALID_PRIORITIES.has(priority) ? priority : "medium",
    dueDate: String(body.dueDate ?? current.dueDate ?? "").slice(0, 10),
    reminderTime: String(body.reminderTime ?? current.reminderTime ?? "").slice(0, 5),
    category: String(body.category ?? current.category ?? "").trim(),
    pinned: Boolean(body.pinned ?? current.pinned ?? false),
  };
}

router.get("/noteTasks", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const query = buildOwnerQuery(req.user);
    if (req.query.status && req.query.status !== "all") query.status = String(req.query.status).toLowerCase();
    if (req.query.priority && req.query.priority !== "all") query.priority = String(req.query.priority).toLowerCase();
    if (req.query.dueDate) query.dueDate = String(req.query.dueDate).slice(0, 10);

    const rows = await NoteTask.find(query)
      .sort({ pinned: -1, dueDate: 1, priority: -1, updatedAt: -1 })
      .lean();

    res.json(rows);
  } catch (err) {
    console.error("noteTasks list error:", err);
    res.status(500).json({ error: "Failed to fetch notes tasks" });
  }
});

router.post("/noteTasks", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const payload = normalizePayload(req.body, req.user);
    if (!payload.title) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (payload.status === "done") payload.completedAt = new Date();
    const row = await NoteTask.create(payload);
    res.status(201).json({ message: "Note task saved", row });
  } catch (err) {
    console.error("noteTasks create error:", err);
    res.status(500).json({ error: "Failed to save note task" });
  }
});

router.put("/noteTasks/:id", authMiddleware, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid note task id" });
    }

    const current = await NoteTask.findOne({ _id: req.params.id, ...buildOwnerQuery(req.user) });
    if (!current) return res.status(404).json({ error: "Note task not found" });

    const payload = normalizePayload(req.body, req.user, current.toObject());
    if (!payload.title) {
      return res.status(400).json({ error: "Title is required" });
    }

    const wasDone = current.status === "done";
    const isDone = payload.status === "done";
    const previousReminderKey = `${current.dueDate || ""} ${current.reminderTime || ""}`;
    const nextReminderKey = `${payload.dueDate || ""} ${payload.reminderTime || ""}`;
    const reminderReset = previousReminderKey !== nextReminderKey
      ? { reminderEmailSentAt: null, reminderEmailSentKey: "", reminderEmailRecipient: "" }
      : {};
    Object.assign(current, payload, {
      completedAt: isDone ? (wasDone ? current.completedAt : new Date()) : null,
      ...reminderReset,
    });
    await current.save();
    res.json({ message: "Note task updated", row: current });
  } catch (err) {
    console.error("noteTasks update error:", err);
    res.status(500).json({ error: "Failed to update note task" });
  }
});

router.delete("/noteTasks/:id", authMiddleware, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid note task id" });
    }
    const deleted = await NoteTask.findOneAndDelete({ _id: req.params.id, ...buildOwnerQuery(req.user) });
    if (!deleted) return res.status(404).json({ error: "Note task not found" });
    res.json({ message: "Note task deleted" });
  } catch (err) {
    console.error("noteTasks delete error:", err);
    res.status(500).json({ error: "Failed to delete note task" });
  }
});

module.exports = router;
