const express = require("express");

const DailyPlan = require("../models/DailyPlan");
const Status = require("../models/Status");
const JioBPStatus = require("../models/jioBPStatus");
const BPCLStatus = require("../models/BPCLStatus");
const MaterialRequirement = require("../models/MaterialRequirement");
const MaterialRequestBuilder = require("../models/MaterialRequestBuilder");
const Task = require("../models/Task");
const verifyToken = require("../middleware/authMiddleware");
const { isAdminUser } = require("../utils/accessScope");

const router = express.Router();

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeDate(value = "") {
  return String(value || "").slice(0, 10);
}

function dateFromQuery(value = "") {
  const date = normalizeDate(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function escapeRegex(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dayRange(date = "") {
  return {
    start: new Date(`${date}T00:00:00.000+05:30`),
    end: new Date(`${date}T23:59:59.999+05:30`),
  };
}

function dateTimeValue(value, fallbackDate = "") {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = normalizeText(value);
  if (!text && fallbackDate) return new Date(`${fallbackDate}T00:00:00.000+05:30`);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00.000+05:30`);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinDay(value, date) {
  const parsed = dateTimeValue(value);
  if (!parsed) return false;
  const { start, end } = dayRange(date);
  return parsed >= start && parsed <= end;
}

function planFrom(record = {}) {
  return record.planId && typeof record.planId === "object" ? record.planId : {};
}

function engineerKey(value = "") {
  return normalizeText(value).toLowerCase();
}

function ensureEngineer(summaryMap, name = "") {
  const engineer = normalizeText(name) || "Unassigned";
  const key = engineerKey(engineer);
  if (!summaryMap.has(key)) {
    summaryMap.set(key, {
      engineer,
      plansSubmitted: 0,
      statusesFilled: 0,
      materialRequests: 0,
      tasksClosed: 0,
      pendingStatus: 0,
      pendingTasks: 0,
      totalActivity: 0,
    });
  }
  return summaryMap.get(key);
}

function addActivity(timeline, summaryMap, activity) {
  const engineer = normalizeText(activity.engineer) || "Unassigned";
  const row = ensureEngineer(summaryMap, engineer);
  row.totalActivity += 1;
  if (activity.kind === "plan") row.plansSubmitted += 1;
  if (activity.kind === "status") row.statusesFilled += 1;
  if (activity.kind === "material") row.materialRequests += 1;
  if (activity.kind === "taskClosed") row.tasksClosed += 1;
  timeline.push({
    engineer,
    kind: activity.kind,
    label: activity.label,
    time: activity.time ? activity.time.toISOString() : "",
    visitDate: activity.visitDate || "",
    roCode: activity.roCode || "",
    roName: activity.roName || "",
    region: activity.region || "",
    phase: activity.phase || "",
    title: activity.title || "",
    subtitle: activity.subtitle || "",
    status: activity.status || "",
    sourceId: activity.sourceId ? String(activity.sourceId) : "",
    link: activity.link || "",
  });
}

router.get("/engineerActivity", verifyToken, async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Admin access required." });
    }

    const date = dateFromQuery(req.query.date);
    const engineer = normalizeText(req.query.engineer);
    const engineerRegex = engineer ? new RegExp(`^${escapeRegex(engineer)}$`, "i") : null;
    const { start, end } = dayRange(date);
    const summaryMap = new Map();
    const timeline = [];

    const planQuery = {
      $or: [
        { createdAt: { $gte: start, $lte: end } },
        { date },
      ],
    };
    if (engineerRegex) planQuery.engineer = engineerRegex;

    const materialQuery = {
      $or: [
        { createdAt: { $gte: start, $lte: end } },
        { date },
        { materialRequestDate: date },
      ],
    };
    if (engineerRegex) materialQuery.engineer = engineerRegex;

    const taskQuery = {
      $or: [
        { createdAt: { $gte: start, $lte: end } },
        { date },
        { followUpDates: date },
        { mailDate: date },
      ],
    };
    if (engineerRegex) taskQuery.engineer = engineerRegex;

    const [plans, hpclStatuses, rbmlStatuses, bpclStatuses, materialRequirements, materialBuilders, tasks] = await Promise.all([
      DailyPlan.find(planQuery).sort({ createdAt: -1 }).lean(),
      Status.find({ createdAt: { $gte: start, $lte: end } }).populate("planId").sort({ createdAt: -1 }).lean(),
      JioBPStatus.find({ createdAt: { $gte: start, $lte: end } }).populate("planId").sort({ createdAt: -1 }).lean(),
      BPCLStatus.find({ createdAt: { $gte: start, $lte: end } }).populate("planId").sort({ createdAt: -1 }).lean(),
      MaterialRequirement.find(materialQuery).sort({ createdAt: -1 }).lean(),
      MaterialRequestBuilder.find(materialQuery).sort({ createdAt: -1 }).lean(),
      Task.find(taskQuery).sort({ createdAt: -1 }).lean(),
    ]);

    for (const plan of plans) {
      const activityTime = dateTimeValue(plan.createdAt, plan.date);
      addActivity(timeline, summaryMap, {
        kind: "plan",
        label: "Plan Submitted",
        time: activityTime,
        visitDate: normalizeDate(plan.date),
        engineer: plan.engineer,
        roCode: plan.roCode,
        roName: plan.roName,
        region: plan.region,
        phase: plan.phase,
        title: plan.purpose || plan.issueType || "Daily Plan",
        subtitle: plan.issueType || "",
        status: plan.completionStatus || "Planned",
        sourceId: plan._id,
        link: "dataView.html",
      });
    }

    const statusSources = [
      { rows: hpclStatuses, label: "HPCL Status Filled", title: (row) => row.workCompletion || "HPCL Visit Status", link: "statusRecords.html" },
      { rows: rbmlStatuses, label: "RBML Status Filled", title: (row) => row.status || row.solution || "RBML Visit Status", link: "jioBPreport.html" },
      { rows: bpclStatuses, label: "BPCL Status Filled", title: (row) => `Class 1: ${row.class1DeviceCount || 0}, Class 2: ${row.class2DeviceCount || 0}`, link: "bpclStatusreport.html" },
    ];

    for (const source of statusSources) {
      for (const status of source.rows) {
        const plan = planFrom(status);
        const statusEngineer = normalizeText(plan.engineer);
        if (engineerRegex && !engineerRegex.test(statusEngineer)) continue;
        addActivity(timeline, summaryMap, {
          kind: "status",
          label: source.label,
          time: dateTimeValue(status.createdAt, plan.date),
          visitDate: normalizeDate(plan.date),
          engineer: statusEngineer,
          roCode: plan.roCode,
          roName: plan.roName,
          region: plan.region,
          phase: plan.phase,
          title: source.title(status),
          subtitle: plan.issueType || plan.purpose || "",
          status: status.isVerified ? "Verified" : "Submitted",
          sourceId: status._id,
          link: source.link,
        });
      }
    }

    const allMaterials = [
      ...materialRequirements.map((row) => ({ row, link: "materialrequirement.html" })),
      ...materialBuilders.map((row) => ({ row, link: "materialrequestbuilder.html" })),
    ];
    for (const { row, link } of allMaterials) {
      const activityTime = dateTimeValue(row.createdAt, row.materialRequestDate || row.date);
      addActivity(timeline, summaryMap, {
        kind: "material",
        label: "Material Requested",
        time: activityTime,
        visitDate: normalizeDate(row.date || row.materialRequestDate),
        engineer: row.engineer || row.createdByName,
        roCode: row.roCode,
        roName: row.roName,
        region: row.region,
        phase: row.phase,
        title: row.materialSummary || row.material || row.materialRequirementType || "Material Request",
        subtitle: row.materialDispatchStatus || row.deliveryStatus || row.requestMode || "",
        status: row.materialDispatchStatus || row.deliveryStatus || "Requested",
        sourceId: row._id,
        link,
      });
    }

    for (const task of tasks) {
      const isClosed = ["resolved", "done", "closed"].includes(normalizeText(task.status).toLowerCase());
      const taskEngineer = normalizeText(task.engineer || task.completedBy || task.assignedTo);
      ensureEngineer(summaryMap, taskEngineer);
      if (!isClosed) {
        const row = ensureEngineer(summaryMap, taskEngineer);
        row.pendingTasks += 1;
        continue;
      }

      const closedDate = Array.isArray(task.followUpDates) && task.followUpDates.includes(date)
        ? date
        : (normalizeDate(task.mailDate) || normalizeDate(task.createdAt));
      if (normalizeDate(closedDate) !== date && !isWithinDay(task.createdAt, date)) continue;

      addActivity(timeline, summaryMap, {
        kind: "taskClosed",
        label: "Task Closed",
        time: dateTimeValue(closedDate || task.createdAt, date),
        visitDate: normalizeDate(task.date),
        engineer: taskEngineer,
        roCode: task.roCode,
        roName: task.roName,
        region: task.region,
        phase: task.customer,
        title: task.subject || task.issueType || task.issue || "Task",
        subtitle: task.closureSummary || task.replyStatus || "",
        status: task.status,
        sourceId: task._id,
        link: "taskManager.html",
      });
    }

    const datePlans = await DailyPlan.find({
      date,
      ...(engineerRegex ? { engineer: engineerRegex } : {}),
    }).select("_id engineer").lean();

    if (datePlans.length) {
      const statusPlanIds = new Set([
        ...(await Status.find({ planId: { $in: datePlans.map((p) => p._id) } }).distinct("planId")).map(String),
        ...(await JioBPStatus.find({ planId: { $in: datePlans.map((p) => p._id) } }).distinct("planId")).map(String),
        ...(await BPCLStatus.find({ planId: { $in: datePlans.map((p) => p._id) } }).distinct("planId")).map(String),
      ]);
      for (const plan of datePlans) {
        const row = ensureEngineer(summaryMap, plan.engineer);
        if (!statusPlanIds.has(String(plan._id))) row.pendingStatus += 1;
      }
    }

    const engineers = [...summaryMap.values()]
      .sort((a, b) => b.totalActivity - a.totalActivity || a.engineer.localeCompare(b.engineer));

    const totals = engineers.reduce((acc, row) => {
      acc.plansSubmitted += row.plansSubmitted;
      acc.statusesFilled += row.statusesFilled;
      acc.materialRequests += row.materialRequests;
      acc.tasksClosed += row.tasksClosed;
      acc.pendingStatus += row.pendingStatus;
      acc.pendingTasks += row.pendingTasks;
      return acc;
    }, { plansSubmitted: 0, statusesFilled: 0, materialRequests: 0, tasksClosed: 0, pendingStatus: 0, pendingTasks: 0 });

    timeline.sort((a, b) => String(b.time).localeCompare(String(a.time)));

    res.json({
      success: true,
      date,
      totals: {
        ...totals,
        totalActivity: timeline.length,
        activeEngineers: engineers.filter((row) => row.totalActivity > 0).length,
      },
      engineers,
      timeline,
    });
  } catch (err) {
    console.error("[EngineerActivity] GET /engineerActivity:", err);
    res.status(500).json({ success: false, message: "Failed to load engineer activity", error: err.message });
  }
});

module.exports = router;
