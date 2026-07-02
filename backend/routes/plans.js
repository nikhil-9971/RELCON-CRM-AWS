const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const DailyPlan = require("../models/DailyPlan");
const Status = require("../models/Status");
const verifyToken = require("../middleware/authMiddleware");
const JioBPStatus = require("../models/jioBPStatus");
const BPCLStatus = require("../models/BPCLStatus");
const {
  sendDailyPlanCompletionSummaryToNikhil,
  sendLateDataViewEntryAlert,
} = require("../services/mailer");
const {
  clearCacheByPrefix,
  getOrSetCache,
  makeCacheKey,
  sendCachedJson,
} = require("../utils/cache");

const User = require("../models/User");
const DAILY_PLAN_CACHE_TTL_MS = 2 * 60 * 1000;

function clearDailyPlanCaches() {
  clearCacheByPrefix("daily-plans:");
  clearCacheByPrefix("romaster:amc-count-status");
}

const HPCL_AMC_PHASES = [
  "HPCL/Phase-X",
  "HPCL/Phase-IX",
  "HPCL/Phase-XI",
  "HPCL/Phase-XII",
  "HPCL/Phase-XIII",
];
const HPCL_AMC_VISIT_TYPES = ["PM Visit", "Issue & PM Visit", "ATG & PM Visit"];
const DEFAULT_HPCL_AMC_START_DATE = "2026-07-01";
const DEFAULT_HPCL_AMC_END_DATE = "2026-09-30";
const EXCLUDED_PURPOSE_SUGGESTIONS = ["", "NO PLAN", "IN LEAVE"];

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeDate(value = "") {
  return String(value || "").slice(0, 10);
}

function formatDateForMessage(value = "") {
  const isoDate = normalizeDate(value);
  if (!isoDate) return "";
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString("en-GB");
}

function sanitizeDailyPlanUpdatePayload(body = {}) {
  const blockedFields = new Set([
    "_id",
    "__v",
    "createdAt",
    "updatedAt",
    "statusSaved",
    "jioBPStatusSaved",
  ]);
  const payload = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (blockedFields.has(key)) continue;
    payload[key] = value === null || value === undefined ? "" : value;
  }
  return payload;
}

async function getHPCLAMCValidationResult({
  roCode,
  phase,
  issueType,
  startDate,
  endDate,
  excludePlanId,
}) {
  if (!HPCL_AMC_PHASES.includes(normalizeText(phase))) {
    return { isValid: true };
  }

  if (normalizeText(issueType) === "POWER ON OR SAT") {
    return { isValid: true };
  }

  const normalizedRoCode = normalizeText(roCode).toUpperCase();
  const normalizedIssueType = normalizeText(issueType);
  const isAMCVisit = HPCL_AMC_VISIT_TYPES.includes(normalizedIssueType);
  const windowStart = normalizeDate(startDate) || DEFAULT_HPCL_AMC_START_DATE;
  const windowEnd = normalizeDate(endDate) || DEFAULT_HPCL_AMC_END_DATE;

  const query = {
    roCode: normalizedRoCode,
    issueType: { $in: HPCL_AMC_VISIT_TYPES },
    date: { $gte: windowStart, $lte: windowEnd },
  };

  if (excludePlanId) {
    query._id = { $ne: excludePlanId };
  }

  const roPlans = await DailyPlan.find(query).sort({ date: -1, createdAt: -1 }).lean();

  if (roPlans.length === 0 && !isAMCVisit) {
    return {
      isValid: false,
      message: "AMC Pending — Please select Issue & PM Visit or PM Visit.",
    };
  }

  if (roPlans.length > 0 && isAMCVisit) {
    const latest = roPlans[0];
    const visitDate = formatDateForMessage(latest.date);
    const engineerName = normalizeText(latest.engineer);
    const engineerNote = engineerName ? ` by ${engineerName}` : "";
    return {
      isValid: false,
      message: `AMC already done on ${visitDate}${engineerNote}. Please select Issue Visit.`,
      latestPlan: {
        date: normalizeDate(latest.date),
        engineer: engineerName,
        issueType: normalizeText(latest.issueType),
      },
    };
  }

  return { isValid: true };
}

// ✅ Save Daily Plan
router.post("/saveDailyPlan", async (req, res) => {
  try {
    const validation = await getHPCLAMCValidationResult(req.body || {});
    if (!validation.isValid) {
      return res.status(400).json(validation);
    }

    const plan = new DailyPlan(req.body);
    await plan.save();
    clearDailyPlanCaches();
    sendLateDataViewEntryAlert({
      category: "Daily Plan Entry",
      plan: plan?.toObject ? plan.toObject() : plan,
      submittedBy: plan.engineer || "",
      createdAt: plan.createdAt || new Date(),
    }).catch((mailErr) => console.error("Late daily plan data view entry alert failed:", mailErr?.message || mailErr));
    sendDailyPlanCompletionSummaryToNikhil({ dateISO: plan.date })
      .catch((mailErr) => console.error("Daily plan completion summary trigger failed:", mailErr?.message || mailErr));
    res.json({ ok: true, message: "✅ Plan saved!" });
  } catch (error) {
    res.status(500).send("❌ Error saving plan: " + error.message);
  }
});

router.get("/validateHPCLAMC", async (req, res) => {
  try {
    const validation = await getHPCLAMCValidationResult(req.query || {});
    res.json(validation);
  } catch (error) {
    console.error("Error validating HPCL AMC:", error);
    res.status(500).json({ isValid: true });
  }
});

router.get("/purposeSuggestions", async (req, res) => {
  try {
    const q = normalizeText(req.query.q).toUpperCase();
    const regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = {
      purpose: { $nin: EXCLUDED_PURPOSE_SUGGESTIONS },
    };

    if (q) {
      match.purpose = {
        ...match.purpose,
        $regex: regexEscape(q),
        $options: "i",
      };
    }

    const suggestions = await DailyPlan.aggregate([
      { $match: match },
      {
        $project: {
          purpose: {
            $trim: {
              input: { $toUpper: { $ifNull: ["$purpose", ""] } },
            },
          },
          createdAt: 1,
        },
      },
      { $match: { purpose: { $nin: EXCLUDED_PURPOSE_SUGGESTIONS } } },
      { $group: { _id: "$purpose", lastUsedAt: { $max: "$createdAt" } } },
      { $sort: { lastUsedAt: -1, _id: 1 } },
      { $limit: 40 },
      { $project: { _id: 0, purpose: "$_id" } },
    ]);

    res.json({ suggestions: suggestions.map((item) => item.purpose) });
  } catch (error) {
    console.error("Error fetching purpose suggestions:", error);
    res.status(500).json({ suggestions: [] });
  }
});

// ✅ Check for Duplicate Daily Plan by roCode and date
router.get("/checkDuplicate", async (req, res) => {
  try {
    const { roCode, date, engineer } = req.query;
    if (!roCode || !date)
      return res.status(400).send("Missing roCode or date or engineer");

    const duplicate = await DailyPlan.findOne({
      roCode: roCode.toUpperCase().trim(),
      date: date.trim(),
      engineer: engineer.trim(),
    });

    if (duplicate) {
      res.json({ duplicate: true });
    } else {
      res.json({ duplicate: false });
    }
  } catch (err) {
    console.error("Error checking duplicate:", err);
    res.status(500).send("Server error");
  }
});

// ✅ Get All Plans with statusSaved flag
router.get("/getDailyPlans", verifyToken, async (req, res) => {
  const { role, engineerName } = req.user;

  try {
    const result = await getOrSetCache(makeCacheKey("daily-plans:list", { role, engineerName }), DAILY_PLAN_CACHE_TTL_MS, async () => {
      const plans =
        role === "admin"
          ? await DailyPlan.find({}).lean()
          : await DailyPlan.find({ engineer: engineerName }).lean();

      const statusList = await Status.find({}).lean();
      const statusMap = new Map(
        statusList.map((s) => [s.planId.toString(), true])
      );

      const jioStatusList = await JioBPStatus.find({}).lean();
      const jioStatusMap = new Map(
        jioStatusList.map((s) => [s.planId.toString(), true])
      );

      return plans.map((plan) => ({
        ...plan,
        statusSaved: statusMap.has(plan._id.toString()),
        jioBPStatusSaved: jioStatusMap.has(plan._id.toString()),
      }));
    });
    sendCachedJson(res, result);
  } catch (err) {
    res.status(500).send("Server error");
  }
});

// ✅ NEW: Get a single Daily Plan by ID
router.get("/getPlanById/:id", async (req, res) => {
  try {
    const plan = await DailyPlan.findById(req.params.id);
    if (!plan) return res.status(404).send("Plan not found");

    // ✅ Enrich with status flags
    const statusExists = await Status.exists({ planId: plan._id });
    const jioStatusExists = await JioBPStatus.exists({ planId: plan._id });
    const bpclStatusExists = await BPCLStatus.exists({ planId: plan._id });

    const planObj = plan.toObject();
    planObj.statusSaved = !!statusExists;
    planObj.jioBPStatusSaved = !!jioStatusExists;
    planObj.bpclStatusSaved = !!bpclStatusExists;

    res.json(planObj);
  } catch (err) {
    console.error("Error in /getPlanById/:id:", err);
    res.status(500).send("Server error");
  }
});

// ✅ NEW: Get status record by plan ID
router.get("/getStatusByPlan/:id", async (req, res) => {
  try {
    const status = await Status.findOne({ planId: req.params.id });
    if (!status) return res.status(404).send("Status not found");
    res.json(status);
  } catch (err) {
    res.status(500).send("Server error");
  }
});

//Plan edit
router.put("/updateDailyPlan/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).send("Invalid Daily Plan ID");
    }
    const payload = sanitizeDailyPlanUpdatePayload(req.body);
    const validation = await getHPCLAMCValidationResult({
      ...payload,
      excludePlanId: req.params.id,
    });
    if (!validation.isValid) {
      return res.status(400).json(validation);
    }

    const updated = await DailyPlan.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true, runValidators: true });
    if (!updated) return res.status(404).send("Plan not found");
    clearDailyPlanCaches();
    res.json({ ok: true, message: "Record updated", data: updated });
  } catch (err) {
    console.error("Error updating plan:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

router.delete("/deleteDailyPlan/:id", async (req, res) => {
  const id = req.params.id;
  try {
    await DailyPlan.deleteOne({ _id: id }); // Adjust model name as needed
    clearDailyPlanCaches();
    res.status(200).json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

//Completion Status added
router.put("/updateCompletion/:id", async (req, res) => {
  try {
    const { completionStatus } = req.body;
    const updated = await DailyPlan.findByIdAndUpdate(
      req.params.id,
      { completionStatus },
      { new: true }
    );
    if (!updated) return res.status(404).send("Plan not found");
    clearDailyPlanCaches();
    res.send("✅ Completion status updated");
  } catch (err) {
    res.status(500).send("Server error");
  }
});

// ✅ Get empId by engineer name
router.get("/getEmpId/:engineerName", async (req, res) => {
  try {
    const { engineerName } = req.params;
    const user = await User.findOne({ engineerName: engineerName.trim() });
    if (user) {
      res.json({ empId: user.empId || "" });
    } else {
      res.status(404).json({ empId: "" });
    }
  } catch (err) {
    console.error("❌ Error fetching empId:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get Last Visit by RO Code
router.get("/getLastVisit/:roCode", async (req, res) => {
  try {
    const { roCode } = req.params;

    // Find latest plan by roCode (sorted by date descending)
    const lastVisit = await DailyPlan.findOne({
      roCode: roCode.toUpperCase().trim(),
    }).sort({ date: -1 });

    if (!lastVisit) {
      return res.json({ lastDate: "", lastPurpose: "" });
    }

    res.json({
      lastDate: lastVisit.date,
      lastPurpose: lastVisit.purpose,
    });
  } catch (err) {
    console.error("❌ Error fetching last visit:", err);
    res.status(500).send("Server error");
  }
});

// This should be in plans.js or your backend route file
// server.js
router.get("/getSimDetails/:roCode", async (req, res) => {
  try {
    const { roCode } = req.params;

    const result = await Status.aggregate([
      {
        $lookup: {
          from: "dailyplans", // 👈 dailyPlan collection name
          localField: "planId", // status.planId
          foreignField: "_id", // dailyPlan._id
          as: "plan",
        },
      },
      { $unwind: "$plan" },
      {
        $match: {
          "plan.roCode": roCode.trim().toUpperCase(),
        },
      },

      {
        $project: {
          sim1Number: 1,
          sim1Provider: 1,
          sim2Number: 1,
          sim2Provider: 1,
          iemiNumber: 1,
        },
      },
    ]);

    if (result.length === 0) {
      return res.json({
        sim1Number: "",
        sim1Provider: "",
        sim2Number: "",
        sim2Provider: "",
        iemiNumber: "",
      });
    }

    res.json(result[0]);
  } catch (err) {
    console.error("Error in getSimDetails:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
