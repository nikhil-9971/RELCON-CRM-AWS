const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");

const ROMaster = require("../models/ROMaster");
const DailyPlan = require("../models/DailyPlan");
const Status = require("../models/Status");
const JioBPStatus = require("../models/jioBPStatus");
const BPCLStatus = require("../models/BPCLStatus");
const Incident = require("../models/Incident");
const Task = require("../models/Task");
const MaterialRequirement = require("../models/MaterialRequirement");
const { isAdminUser, scopeByEngineer } = require("../utils/accessScope");

function normalizeRoCode(value = "") {
  return String(value || "").trim().toUpperCase();
}

function regexExact(value = "") {
  const escaped = String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

function pickDate(...values) {
  for (const value of values) {
    if (!value) continue;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    const text = String(value || "").trim();
    if (!text) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return text;
  }
  return "";
}

function planFrom(record = {}) {
  return record.planId && typeof record.planId === "object" ? record.planId : {};
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, raw]) => raw !== undefined && raw !== null && String(raw).trim() !== "")
  );
}

function createEvent({ type, label, date, title, subtitle, status, sourceId, details = {}, tone = "blue" }) {
  return {
    type,
    label,
    date: date || "",
    title: title || label || "Timeline Event",
    subtitle: subtitle || "",
    status: status || "",
    sourceId: sourceId ? String(sourceId) : "",
    tone,
    details: compactObject(details),
  };
}

router.get("/roTimeline/:roCode", verifyToken, async (req, res) => {
  try {
    const roCode = normalizeRoCode(req.params.roCode);
    if (!roCode) return res.status(400).json({ error: "RO code is required" });

    const roRegex = regexExact(roCode);
    const admin = isAdminUser(req.user);
    const roScope = { roCode: roRegex };
    const planScope = { ...roScope, ...scopeByEngineer(req.user, "engineer") };
    const incidentScope = { ...roScope, ...scopeByEngineer(req.user, "assignEngineer") };
    const taskScope = { ...roScope, ...scopeByEngineer(req.user, "engineer") };
    const materialScope = { ...roScope, ...scopeByEngineer(req.user, "engineer") };

    const [master, plans, incidents, tasks, materialRequirements] = await Promise.all([
      ROMaster.findOne({ roCode: roRegex }).lean(),
      DailyPlan.find(planScope).sort({ date: -1, createdAt: -1 }).lean(),
      Incident.find(incidentScope).sort({ incidentDate: -1 }).lean(),
      Task.find(taskScope).sort({ createdAt: -1 }).lean(),
      MaterialRequirement.find(materialScope).sort({ date: -1, createdAt: -1 }).lean(),
    ]);

    const planIds = plans.map((plan) => plan._id).filter(Boolean);
    const [hpclStatuses, rbmlStatuses, bpclStatuses] = planIds.length
      ? await Promise.all([
          Status.find({ planId: { $in: planIds } }).populate("planId").sort({ createdAt: -1 }).lean(),
          JioBPStatus.find({ planId: { $in: planIds } }).populate("planId").sort({ createdAt: -1 }).lean(),
          BPCLStatus.find({ planId: { $in: planIds } }).populate("planId").sort({ createdAt: -1 }).lean(),
        ])
      : [[], [], []];

    const events = [];

    for (const plan of plans) {
      events.push(createEvent({
        type: "plan",
        label: "Daily Plan",
        date: pickDate(plan.date, plan.createdAt),
        title: `${plan.phase || "Plan"} | ${plan.issueType || plan.purpose || "Visit"}`,
        subtitle: `${plan.engineer || "Engineer"}${plan.region ? ` | ${plan.region}` : ""}`,
        status: plan.completionStatus || plan.incidentStatus || "",
        sourceId: plan._id,
        tone: "blue",
        details: {
          visitDate: plan.date,
          engineer: plan.engineer,
          empId: plan.empId,
          phase: plan.phase,
          issueType: plan.issueType,
          incidentId: plan.incidentId,
          purpose: plan.purpose,
          arrivalTime: plan.arrivalTime,
          leaveTime: plan.leaveTime,
          whatDone: plan.whatDone,
        },
      }));
    }

    for (const status of hpclStatuses) {
      const plan = planFrom(status);
      events.push(createEvent({
        type: "hpcl-status",
        label: "HPCL Status",
        date: pickDate(plan.date, status.createdAt),
        title: status.isVerified ? "HPCL status verified" : "HPCL status submitted",
        subtitle: `${plan.engineer || ""}${status.workCompletion ? ` | ${status.workCompletion}` : ""}`,
        status: status.isVerified ? "Verified" : "Unverified",
        sourceId: status._id,
        tone: status.isVerified ? "green" : "orange",
        details: {
          engineer: plan.engineer,
          visitDate: plan.date,
          spareUsed: status.spareUsed,
          activeSpare: status.activeSpare,
          faultySpare: status.faultySpare,
          spareRequirement: status.spareRequirment,
          requiredSpare: status.spareRequirmentname,
          earthingStatus: status.earthingStatus,
          voltageReading: status.voltageReading,
          duOffline: status.duOffline,
          duDependency: status.duDependency,
          tankOffline: status.tankOffline,
          tankDependency: status.tankDependency,
          oms03: status.oms03,
        },
      }));
    }

    for (const status of rbmlStatuses) {
      const plan = planFrom(status);
      events.push(createEvent({
        type: "rbml-status",
        label: "JioBP/RBML Status",
        date: pickDate(plan.date, status.createdAt),
        title: status.isVerified ? "JioBP status verified" : "JioBP status submitted",
        subtitle: `${plan.engineer || ""}${status.status ? ` | ${status.status}` : ""}`,
        status: status.isVerified ? "Verified" : "Unverified",
        sourceId: status._id,
        tone: status.isVerified ? "green" : "purple",
        details: {
          engineer: plan.engineer,
          visitDate: plan.date,
          hpsdId: status.hpsdId,
          diagnosis: status.diagnosis,
          solution: status.solution,
          activeMaterialUsed: status.activeMaterialUsed,
          usedMaterialDetails: status.usedMaterialDetails,
          faultyMaterialDetails: status.faultyMaterialDetails,
          spareRequired: status.spareRequired,
          materialRequirement: status.materialRequirement,
          oms03: status.oms03,
        },
      }));
    }

    for (const status of bpclStatuses) {
      const plan = planFrom(status);
      events.push(createEvent({
        type: "bpcl-status",
        label: "BPCL Status",
        date: pickDate(plan.date, status.createdAt),
        title: status.isVerified ? "BPCL status verified" : "BPCL status submitted",
        subtitle: `${plan.engineer || ""} | Class 1: ${status.class1DeviceCount || 0}, Class 2: ${status.class2DeviceCount || 0}`,
        status: status.isVerified ? "Verified" : "Unverified",
        sourceId: status._id,
        tone: status.isVerified ? "green" : "teal",
        details: {
          engineer: plan.engineer,
          visitDate: plan.date,
          class1DeviceCount: status.class1DeviceCount,
          class1Devices: Array.isArray(status.class1Devices) ? status.class1Devices.join(", ") : "",
          class2DeviceCount: status.class2DeviceCount,
          class2Devices: Array.isArray(status.class2Devices) ? status.class2Devices.join(", ") : "",
          relconAtgProvided: status.relconAtgProvided,
          relconAtgCount: status.relconAtgCount,
          relconAtgDetails: Array.isArray(status.relconAtgDetails) ? status.relconAtgDetails.join(", ") : "",
          jioSimNumber: status.jioSimNumber,
          airtelSimNumber: status.airtelSimNumber,
        },
      }));
    }

    for (const incident of incidents) {
      events.push(createEvent({
        type: "incident",
        label: "Incident",
        date: pickDate(incident.incidentDate, incident.createdAt),
        title: `${incident.incidentId || "Incident"} | ${incident.status || "Pending"}`,
        subtitle: incident.complaintRemark || incident.closeRemark || "",
        status: incident.status || "",
        sourceId: incident._id,
        tone: String(incident.status || "").toLowerCase() === "close" ? "green" : "red",
        details: {
          incidentId: incident.incidentId,
          incidentDate: incident.incidentDate,
          assignedEngineer: incident.assignEngineer,
          complaintRemark: incident.complaintRemark,
          closeRemark: incident.closeRemark,
          incidentcloseDate: incident.incidentcloseDate,
        },
      }));
    }

    for (const task of tasks) {
      events.push(createEvent({
        type: "task",
        label: "Task",
        date: pickDate(task.mailDate, task.createdAt, task.date),
        title: `${task.issueType || "Task"} | ${task.status || "Pending"}`,
        subtitle: task.issue || task.subject || "",
        status: task.status || "",
        sourceId: task._id,
        tone: ["Resolved", "Done"].includes(task.status) ? "green" : "orange",
        details: {
          engineer: task.engineer,
          customer: task.customer,
          priority: task.priority,
          replyStatus: task.replyStatus,
          assignedTo: task.assignedTo,
          mailDate: task.mailDate,
          nextFollowUpDate: task.nextFollowUpDate,
          closureSummary: task.closureSummary,
        },
      }));
    }

    for (const material of materialRequirements) {
      const lineSummary = Array.isArray(material.lineItems) && material.lineItems.length
        ? material.lineItems.map((item) => `${item.materialName || item.materialType || "Material"} x${item.quantity || 1}`).join(", ")
        : "";
      events.push(createEvent({
        type: "material",
        label: "Material",
        date: pickDate(material.date, material.materialRequestDate, material.createdAt),
        title: `${material.materialSummary || material.material || lineSummary || "Material Requirement"}`,
        subtitle: `${material.materialDispatchStatus || material.deliveryStatus || "Pending"}${material.engineer ? ` | ${material.engineer}` : ""}`,
        status: material.materialDispatchStatus || material.deliveryStatus || "",
        sourceId: material._id,
        tone: String(material.materialDispatchStatus || material.deliveryStatus || "").toLowerCase().includes("dispatch") ? "green" : "purple",
        details: {
          engineer: material.engineer,
          customer: material.customer,
          materialType: material.materialType,
          quantity: material.quantity,
          materialDispatchStatus: material.materialDispatchStatus,
          materialRequestDate: material.materialRequestDate,
          challanNumber: material.challanNumber,
          docketNumber: material.docketNumber,
          dispatchDate: material.dispatchDate,
          deliveryStatus: material.deliveryStatus,
          materialReceivedDate: material.materialReceivedDate,
          poNumber: material.poNumber,
          lineItems: lineSummary,
        },
      }));
    }

    events.sort((a, b) => {
      const ad = new Date(a.date).getTime();
      const bd = new Date(b.date).getTime();
      return (Number.isNaN(bd) ? 0 : bd) - (Number.isNaN(ad) ? 0 : ad);
    });

    res.json({
      roCode,
      master: (admin || events.length) ? master || null : null,
      summary: {
        plans: plans.length,
        hpclStatuses: hpclStatuses.length,
        rbmlStatuses: rbmlStatuses.length,
        bpclStatuses: bpclStatuses.length,
        incidents: incidents.length,
        tasks: tasks.length,
        materials: materialRequirements.length,
        totalEvents: events.length,
      },
      events,
    });
  } catch (err) {
    console.error("RO timeline error:", err);
    res.status(500).json({ error: "Failed to build RO timeline", details: err.message });
  }
});

module.exports = router;
