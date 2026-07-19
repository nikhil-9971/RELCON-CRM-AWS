const express = require("express");
const router = express.Router();
const Task = require("../models/Task");
const authMiddleware = require("../middleware/authMiddleware");
const { isAdminUser, scopeByEngineer, canAccessEngineerRecord } = require("../utils/accessScope");
const {
  sendTaskNotificationEmail,
  sendTaskClosureEmail,
  sendTaskEscalationEmail,
  sendCustomTaskEmail,
  buildTaskSubject,
  getTaskPriority,
  getTaskDefaultAssignee,
  detectTaskIssueType,
  getTaskCustomer,
  getTaskAgingDays,
  processPendingTaskEscalations,
} = require("../services/mailer");

function normalizeTaskPayload(body = {}, currentTask = null) {
  const payload = {
    statusId: body.statusId ?? currentTask?.statusId ?? "",
    roCode: String(body.roCode ?? currentTask?.roCode ?? "").trim(),
    region: String(body.region ?? currentTask?.region ?? "").trim(),
    roName: String(body.roName ?? currentTask?.roName ?? "").trim(),
    date: String(body.date ?? currentTask?.date ?? "").slice(0, 10),
    engineer: String(body.engineer ?? currentTask?.engineer ?? "").trim(),
    customer: String(body.customer ?? currentTask?.customer ?? "").trim() || "HPCL",
    issue: String(body.issue ?? currentTask?.issue ?? "").trim(),
    issueType: String(body.issueType ?? currentTask?.issueType ?? "").trim(),
    emailContent: String(body.emailContent ?? currentTask?.emailContent ?? "").trim(),
    customerEmail: String(body.customerEmail ?? currentTask?.customerEmail ?? "").trim(),
    ccEmails: String(body.ccEmails ?? currentTask?.ccEmails ?? "").trim(),
    status: String(body.status ?? currentTask?.status ?? "Pending").trim() || "Pending",
    replyStatus: String(body.replyStatus ?? currentTask?.replyStatus ?? "No Response").trim() || "No Response",
    mailReply: String(body.mailReply ?? currentTask?.mailReply ?? "").trim(),
    mailDate: String(body.mailDate ?? currentTask?.mailDate ?? "").slice(0, 10),
    nextFollowUpDate: String(body.nextFollowUpDate ?? currentTask?.nextFollowUpDate ?? "").slice(0, 10),
    closureSummary: String(body.closureSummary ?? currentTask?.closureSummary ?? "").trim(),
    completedBy: String(body.completedBy ?? currentTask?.completedBy ?? "").trim(),
    assignedTo: String(body.assignedTo ?? currentTask?.assignedTo ?? currentTask?.completedBy ?? "").trim(),
    slaDays: Number(body.slaDays ?? currentTask?.slaDays ?? 2) || 2,
    earthingStatus: String(body.earthingStatus ?? currentTask?.earthingStatus ?? "").trim(),
    dgStatus: String(body.dgStatus ?? currentTask?.dgStatus ?? "").trim(),
    voltageReading: String(body.voltageReading ?? currentTask?.voltageReading ?? "").trim(),
    duOffline: String(body.duOffline ?? currentTask?.duOffline ?? "").trim(),
    duRemark: String(body.duRemark ?? currentTask?.duRemark ?? "").trim(),
    duDependency: String(body.duDependency ?? currentTask?.duDependency ?? "").trim(),
    tankOffline: String(body.tankOffline ?? currentTask?.tankOffline ?? "").trim(),
    tankRemark: String(body.tankRemark ?? currentTask?.tankRemark ?? "").trim(),
    tankDependency: String(body.tankDependency ?? currentTask?.tankDependency ?? "").trim(),
  };

  payload.customer = getTaskCustomer(payload);
  payload.issueType = detectTaskIssueType(payload);
  payload.priority = String(body.priority ?? currentTask?.priority ?? getTaskPriority(payload)).trim() || getTaskPriority(payload);
  payload.assignedTo = payload.assignedTo || getTaskDefaultAssignee(payload);
  payload.subject = String(body.subject ?? currentTask?.subject ?? buildTaskSubject(payload, "action")).trim() || buildTaskSubject(payload, "action");

  return payload;
}

function mergeTaskMeta(task) {
  const obj = task.toObject ? task.toObject() : { ...task };
  const agingDays = getTaskAgingDays(obj);
  const overdue = !["Resolved", "Done"].includes(obj.status) && agingDays > Number(obj.slaDays || 2);
  return {
    ...obj,
    agingDays,
    overdue,
    currentSubject: buildTaskSubject(obj, "action"),
    closureSubject: buildTaskSubject(obj, "closure"),
    escalationSubject: buildTaskSubject(obj, "escalation"),
    computedPriority: getTaskPriority(obj),
    computedIssueType: detectTaskIssueType(obj),
    computedCustomer: getTaskCustomer(obj),
  };
}

async function appendFollowUpIfNeeded(task, { status, followUp }) {
  const today = new Date().toISOString().split("T")[0];
  if (!Array.isArray(task.followUpDates)) task.followUpDates = [];

  if ((status === "Resolved" || status === "Follow-up" || followUp === true) && !task.followUpDates.includes(today)) {
    task.followUpDates.push(today);
  }
}

// GET /getTasks
router.get("/getTasks", authMiddleware, async (req, res) => {
  try {
    const tasks = await Task.find(scopeByEngineer(req.user, "engineer")).sort({ createdAt: -1 });
    res.json(tasks.map(mergeTaskMeta));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// POST /addTask
router.post("/addTask", authMiddleware, async (req, res) => {
  try {
    const payload = normalizeTaskPayload(req.body);
    if (!payload.roCode || !payload.engineer) {
      return res.status(400).json({ error: "RO Code and Engineer are required" });
    }

    const task = new Task(payload);
    await appendFollowUpIfNeeded(task, { status: payload.status, followUp: req.body.followUp });
    await task.save();
    res.status(201).json({ message: "Task added", task: mergeTaskMeta(task) });
  } catch (err) {
    console.error("addTask error:", err);
    res.status(500).json({ error: "Failed to add task" });
  }
});

// PUT /updateTask/:id
router.put("/updateTask/:id", authMiddleware, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const payload = normalizeTaskPayload(req.body, task);
    Object.assign(task, payload);

    if (payload.status === "Resolved" || payload.status === "Done") {
      task.replyStatus = req.body.replyStatus || task.replyStatus || "Resolved";
      task.priority = "Low";
    }

    if (req.body.subject !== undefined) {
      task.subject = String(req.body.subject || "").trim() || buildTaskSubject(task, "action");
    }

    if (req.body.mailHistory && Array.isArray(req.body.mailHistory)) {
      task.mailHistory = req.body.mailHistory;
    }

    await appendFollowUpIfNeeded(task, { status: payload.status, followUp: req.body.followUp });
    await task.save();
    res.json({ message: "Task updated", task: mergeTaskMeta(task) });
  } catch (err) {
    console.error("updateTask error:", err);
    res.status(500).json({ error: "Failed to update task" });
  }
});

router.get("/getTask/:id", authMiddleware, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!canAccessEngineerRecord(req.user, task.engineer) && !canAccessEngineerRecord(req.user, task.assignedTo)) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.json(mergeTaskMeta(task));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch task" });
  }
});

router.post("/sendTaskMail/:id", authMiddleware, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const payload = normalizeTaskPayload(req.body, task);
    Object.assign(task, payload);
    await task.save();

    const result = await sendTaskNotificationEmail({
      task,
      to: req.body.to || task.customerEmail,
      cc: req.body.cc || task.ccEmails,
      note: `Triggered by ${req.user?.username || "system"}`,
    });

    task.status = "Mailed";
    task.mailDate = task.mailDate || new Date().toISOString().slice(0, 10);
    task.lastMailSubject = result.subject;
    task.replyStatus = task.replyStatus || "Awaiting Reply";
    await appendFollowUpIfNeeded(task, { status: task.status, followUp: true });
    await task.save();

    res.json({ message: "Task mail sent", result, task: mergeTaskMeta(task) });
  } catch (err) {
    console.error("sendTaskMail error:", err);
    res.status(500).json({ error: err.message || "Failed to send task mail" });
  }
});

// Admin-only composer: saves the edited draft on the task and sends it directly from CRM.
router.post("/sendCustomTaskMail/:id", authMiddleware, async (req, res) => {
  try {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Only administrators can send edited task emails." });
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.status !== "Pending") return res.status(400).json({ error: "Only pending tasks can be mailed from the task composer." });

    const subject = String(req.body.subject || "").trim();
    const emailContent = String(req.body.emailContent || "").trim();
    const customerEmail = String(req.body.to || task.customerEmail || "").trim();
    const ccEmails = String(req.body.cc || "").trim();
    if (!subject || !emailContent || !customerEmail) {
      return res.status(400).json({ error: "Recipient, subject, and email message are required." });
    }

    task.subject = subject;
    task.customEmailSubject = subject;
    task.customEmailTemplate = emailContent;
    task.customerEmail = customerEmail;
    task.ccEmails = ccEmails;
    const result = await sendCustomTaskEmail({
      task,
      to: customerEmail,
      cc: ccEmails,
      subject,
      body: emailContent,
      note: `Custom email sent by ${req.user?.username || "admin"}`,
    });

    task.status = "Mailed";
    task.mailDate = new Date().toISOString().slice(0, 10);
    task.lastMailSubject = result.subject;
    task.replyStatus = "Awaiting Reply";
    await appendFollowUpIfNeeded(task, { status: task.status, followUp: true });
    await task.save();
    res.json({ message: "Custom task mail sent", result, task: mergeTaskMeta(task) });
  } catch (err) {
    console.error("sendCustomTaskMail error:", err);
    res.status(500).json({ error: err.message || "Failed to send custom task mail" });
  }
});

router.post("/sendTaskClosureMail/:id", authMiddleware, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const payload = normalizeTaskPayload(req.body, task);
    Object.assign(task, payload);
    if (req.body.closureSummary !== undefined) {
      task.closureSummary = String(req.body.closureSummary || "").trim();
    }
    await task.save();

    const result = await sendTaskClosureEmail({
      task,
      to: req.body.to || task.customerEmail,
      cc: req.body.cc || task.ccEmails,
      note: `Closure triggered by ${req.user?.username || "system"}`,
    });

    task.status = "Resolved";
    task.replyStatus = "Resolved";
    task.completedBy = task.completedBy || req.user?.username || "";
    task.priority = "Low";
    task.lastMailSubject = result.subject;
    await appendFollowUpIfNeeded(task, { status: "Resolved", followUp: true });
    await task.save();

    res.json({ message: "Task closure mail sent", result, task: mergeTaskMeta(task) });
  } catch (err) {
    console.error("sendTaskClosureMail error:", err);
    res.status(500).json({ error: err.message || "Failed to send closure mail" });
  }
});

router.post("/escalateTask/:id", authMiddleware, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const result = await sendTaskEscalationEmail({
      task,
      to: req.body.to || task.customerEmail,
      cc: req.body.cc || task.ccEmails,
      note: `Escalated by ${req.user?.username || "system"}`,
    });

    task.status = task.status === "Pending" ? "Follow-up" : task.status;
    task.escalatedAt = new Date();
    task.escalatedLevel = Number(task.escalatedLevel || 0) + 1;
    task.lastMailSubject = result.subject;
    const next = new Date();
    next.setDate(next.getDate() + 2);
    task.nextFollowUpDate = next.toISOString().slice(0, 10);
    await appendFollowUpIfNeeded(task, { status: task.status, followUp: true });
    await task.save();

    res.json({ message: "Task escalated", result, task: mergeTaskMeta(task) });
  } catch (err) {
    console.error("escalateTask error:", err);
    res.status(500).json({ error: err.message || "Failed to escalate task" });
  }
});

router.post("/runTaskEscalations", authMiddleware, async (req, res) => {
  try {
    const result = await processPendingTaskEscalations();
    res.json(result);
  } catch (err) {
    console.error("runTaskEscalations error:", err);
    res.status(500).json({ error: err.message || "Failed to run escalations" });
  }
});

router.delete("/deleteTask/:id", authMiddleware, async (req, res) => {
  await Task.findByIdAndDelete(req.params.id);
  res.json({ message: "Task deleted" });
});

module.exports = router;
