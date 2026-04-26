/**
 * ══════════════════════════════════════════════════════
 *  RELCON CRM — Attendance Routes
 *  File: routes/attendance.js
 *  
 *  Mount in server.js:
 *    const attendance = require("./routes/attendance");
 *    app.use("/attendance", attendance);
 *
 *  MongoDB Collection: "attendances"
 *  Required Middleware: verifyToken (from auth.js)
 * ══════════════════════════════════════════════════════
 */

const express = require("express");
const router = express.Router();
const { verifyToken, requireRole } = require("./auth"); // adjust path
const Attendance = require("../models/Attendance");    // adjust path

/* ─────────────────────────────────────────────
   HELPER: today's ISO date string
───────────────────────────────────────────── */
function todayStr(){
  return new Date().toISOString().split("T")[0];
}

/* ─────────────────────────────────────────────
   ROUTES
───────────────────────────────────────────── */

/**
 * POST /attendance
 * Submit attendance (Engineer: own only | Admin: any engineer)
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const { engineerName, username, date, status, remarks } = req.body;
    const role = (req.user.role || "").toLowerCase();

    // Engineers can only submit for themselves
    const submitterName = req.user.engineerName || req.user.username;
    if (role !== "admin" && engineerName !== submitterName) {
      return res.status(403).json({ success: false, message: "You can only submit your own attendance." });
    }

    const record = await Attendance.create({
      engineerName: engineerName || submitterName,
      username: username || req.user.username,
      date: date || todayStr(),
      status: status || "Present",
      remarks: remarks || "",
      markedBy: submitterName,
    });

    res.status(201).json({ success: true, message: "Attendance marked.", attendance: record });
  } catch (err) {
    // Duplicate key = already submitted
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "Attendance already submitted for this date." });
    }
    res.status(500).json({ success: false, message: "Server error.", details: err.message });
  }
});

/**
 * GET /attendance/mine
 * Engineer: fetch own attendance records
 * Admin: also returns own records (use /all for all users)
 */
router.get("/mine", verifyToken, async (req, res) => {
  try {
    const name = req.user.engineerName || req.user.username;
    const records = await Attendance.find({ engineerName: name }).sort({ date: -1 }).lean();
    res.json(records);
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch records.", details: err.message });
  }
});

/**
 * GET /attendance/all
 * Admin only: fetch all attendance records
 * Supports query filters: ?from=YYYY-MM-DD&to=YYYY-MM-DD&engineer=name&status=Present
 */
router.get("/all", verifyToken, requireRole(["admin"]), async (req, res) => {
  try {
    const { from, to, engineer, status } = req.query;
    const filter = {};

    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to)   filter.date.$lte = to;
    }
    if (engineer) filter.engineerName = { $regex: engineer, $options: "i" };
    if (status)   filter.status = status;

    const records = await Attendance.find(filter).sort({ date: -1 }).lean();
    res.json(records);
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch records.", details: err.message });
  }
});

/**
 * PUT /attendance/:id
 * Admin only: update any attendance record
 */
router.put("/:id", verifyToken, requireRole(["admin"]), async (req, res) => {
  try {
    const { status, date, remarks } = req.body;
    const updated = await Attendance.findByIdAndUpdate(
      req.params.id,
      { status, date, remarks },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: "Record not found." });
    res.json({ success: true, message: "Attendance updated.", attendance: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: "Update failed.", details: err.message });
  }
});

/**
 * DELETE /attendance/:id
 * Admin only: delete an attendance record
 */
router.delete("/:id", verifyToken, requireRole(["admin"]), async (req, res) => {
  try {
    const deleted = await Attendance.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Record not found." });
    res.json({ success: true, message: "Record deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Delete failed.", details: err.message });
  }
});

module.exports = router;
