const express = require("express");
const router = express.Router();
const Task = require("../models/Task");
const authMiddleware = require("../middleware/authMiddleware");

// ✅ GET /getTasks - return all tasks
router.get("/getTasks", authMiddleware, async (req, res) => {
  try {
    const tasks = await Task.find().sort({ createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// ✅ PUT /updateTask/:id - update task fields or track follow-ups
router.put("/updateTask/:id", authMiddleware, async (req, res) => {
  const { status, mailDate, completedBy, mailReply, followUp } = req.body;

  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    if (status) task.status = status;
    if (mailDate) task.mailDate = mailDate;
    if (completedBy) task.completedBy = completedBy;
    if (mailReply) task.mailReply = mailReply;

    // Track follow-up dates
    const today = new Date().toISOString().split("T")[0];
    if (!task.followUpDates) task.followUpDates = [];

    if (
      (status === "Resolved" || followUp === true) &&
      !task.followUpDates.includes(today)
    ) {
      task.followUpDates.push(today);
    }

    await task.save();
    res.json({ message: "Task updated", task });
  } catch (err) {
    res.status(500).json({ error: "Failed to update task" });
  }
});

router.get("/getTask/:id", authMiddleware, async (req, res) => {
  const task = await Task.findById(req.params.id);
  res.json(task);
});

router.delete("/deleteTask/:id", authMiddleware, async (req, res) => {
  await Task.findByIdAndDelete(req.params.id);
  res.json({ message: "Task deleted" });
});

module.exports = router;
