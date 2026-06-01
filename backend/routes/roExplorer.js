const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const { isAdminUser } = require("../utils/accessScope");

const ROMaster = require("../models/ROMaster");
const DailyPlan = require("../models/DailyPlan");
const Status = require("../models/Status");
const JioBPStatus = require("../models/jioBPStatus");
const BPCLStatus = require("../models/BPCLStatus");
const ATGStatus = require("../models/atgStatus");
const Incident = require("../models/Incident");
const Task = require("../models/Task");
const MaterialRequirement = require("../models/MaterialRequirement");
const MaterialRequestBuilder = require("../models/MaterialRequestBuilder");
const CRMNotification = require("../models/CRMNotification");
const { AuditTrail } = require("../models/AuditLog");

function normalizeRoCode(value = "") {
  return String(value || "").trim().toUpperCase();
}

function regexExact(value = "") {
  const escaped = String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value || null));
}

async function readCollection({ key, label, model, query, sort = {}, populate = null }) {
  let finder = model.find(query).sort(sort);
  if (populate) finder = finder.populate(populate);
  const records = await finder.lean();
  return {
    key,
    label,
    count: records.length,
    truncated: false,
    records: plain(records),
  };
}

router.get("/roExplorer/:roCode", verifyToken, async (req, res) => {
  try {
    if (!isAdminUser(req.user || {})) {
      return res.status(403).json({ error: "RO Explorer is available only for admin users." });
    }

    const roCode = normalizeRoCode(req.params.roCode);
    if (!roCode) return res.status(400).json({ error: "RO code is required." });

    const roRegex = regexExact(roCode);
    const plans = await DailyPlan.find({ roCode: roRegex }).sort({ date: -1, createdAt: -1 }).lean();
    const planIds = plans.map((plan) => plan._id).filter(Boolean);

    const collections = await Promise.all([
      readCollection({
        key: "roMaster",
        label: "RO Master",
        model: ROMaster,
        query: { roCode: roRegex },
        sort: { roCode: 1 },
      }),
      Promise.resolve({
        key: "dailyPlans",
        label: "Daily Plans",
        count: plans.length,
        truncated: false,
        records: plain(plans),
      }),
      readCollection({
        key: "hpclStatus",
        label: "HPCL Status Records",
        model: Status,
        query: planIds.length ? { planId: { $in: planIds } } : { _id: { $exists: false } },
        sort: { createdAt: -1 },
        populate: "planId",
      }),
      readCollection({
        key: "jioBpStatus",
        label: "JioBP/RBML Status Records",
        model: JioBPStatus,
        query: planIds.length ? { planId: { $in: planIds } } : { _id: { $exists: false } },
        sort: { createdAt: -1 },
        populate: "planId",
      }),
      readCollection({
        key: "bpclStatus",
        label: "BPCL Status Records",
        model: BPCLStatus,
        query: planIds.length ? { planId: { $in: planIds } } : { _id: { $exists: false } },
        sort: { createdAt: -1 },
        populate: "planId",
      }),
      readCollection({
        key: "atgStatus",
        label: "ATG Status Records",
        model: ATGStatus,
        query: planIds.length ? { planId: { $in: planIds } } : { _id: { $exists: false } },
        sort: { createdAt: -1 },
        populate: "planId",
      }),
      readCollection({
        key: "incidents",
        label: "Incidents",
        model: Incident,
        query: { roCode: roRegex },
        sort: { incidentDate: -1 },
      }),
      readCollection({
        key: "tasks",
        label: "Tasks",
        model: Task,
        query: { roCode: roRegex },
        sort: { createdAt: -1 },
      }),
      readCollection({
        key: "materialRequirements",
        label: "Material Requirements",
        model: MaterialRequirement,
        query: { roCode: roRegex },
        sort: { date: -1, createdAt: -1 },
      }),
      readCollection({
        key: "materialRequests",
        label: "Material Request Builder",
        model: MaterialRequestBuilder,
        query: { roCode: roRegex },
        sort: { date: -1, createdAt: -1 },
      }),
      readCollection({
        key: "notifications",
        label: "CRM Notifications",
        model: CRMNotification,
        query: { roCode: roRegex },
        sort: { createdAt: -1 },
      }),
      readCollection({
        key: "auditTrails",
        label: "Audit Trails",
        model: AuditTrail,
        query: {
          $or: [
            { roCode: roRegex },
            { "before.roCode": roRegex },
            { "after.roCode": roRegex },
          ],
        },
        sort: { timestamp: -1 },
      }),
    ]);

    const summary = {
      totalRecords: collections.reduce((sum, item) => sum + item.count, 0),
      collectionsWithData: collections.filter((item) => item.count > 0).length,
      planIds: planIds.map((id) => String(id)),
    };

    res.json({ roCode, summary, collections });
  } catch (err) {
    console.error("RO Explorer error:", err);
    res.status(500).json({ error: "Failed to fetch RO data.", details: err.message });
  }
});

module.exports = router;
