const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const BPCLStatus = require("../models/BPCLStatus");
const DailyPlan = require("../models/DailyPlan");
const authMiddleware = require("../middleware/authMiddleware");
const {
  sendVerificationCorrectionEmail,
  sendPendingStatusConfirmationToAdmins,
} = require("../services/mailer");
const { clearCacheByPrefix } = require("../utils/cache");
const { isAdminUser, canAccessEngineerRecord } = require("../utils/accessScope");

function clearStatusDependentCaches() {
  clearCacheByPrefix("daily-plans:");
}

// BPCL visit status is a complete visit report. Do not allow partially-filled
// reports to be created through the UI or directly through the API.
function validateCompleteBpclStatus(payload = {}) {
  const missing = [];
  const hasValue = (value) => String(value ?? "").trim() !== "";
  const requireField = (field, label) => {
    if (!hasValue(payload[field])) missing.push(label);
  };
  const requireDeviceDetails = (countField, devicesField, label) => {
    const count = Number(payload[countField]);
    const devices = Array.isArray(payload[devicesField]) ? payload[devicesField] : [];
    if (!Number.isInteger(count) || count < 0) {
      missing.push(`${label} count`);
      return;
    }
    if (devices.length !== count || devices.some((device) => !hasValue(device))) {
      missing.push(`${label} device details`);
    }
  };

  requireField("class1DeviceCount", "Class-1 with GSM device count");
  requireField("class1WithoutSimCount", "Class-1 without GSM device count");
  requireField("class2DeviceCount", "Class-2 device count");
  requireDeviceDetails("class1DeviceCount", "class1Devices", "Class-1 with GSM");
  requireDeviceDetails("class1WithoutSimCount", "class1WithoutSimDevices", "Class-1 without GSM");
  requireDeviceDetails("class2DeviceCount", "class2Devices", "Class-2");

  if (!["YES", "NO"].includes(String(payload.relconAtgProvided || "").toUpperCase())) {
    missing.push("RELCON ATG provided");
  }
  if (String(payload.relconAtgProvided || "").toUpperCase() === "YES") {
    requireField("relconAtgCount", "RELCON ATG count");
    requireDeviceDetails("relconAtgCount", "relconAtgDetails", "RELCON ATG");
  }

  [
    ["jioSimNumber", "JIO SIM number"],
    ["airtelSimNumber", "Airtel SIM number"],
    ["mpdOffline", "MPD offline status"],
    ["mpdDependency", "MPD dependency"],
    ["mpdRemark", "MPD offline reason"],
    ["tankOffline", "Tank offline status"],
    ["tankDependency", "Tank dependency"],
    ["tankRemark", "Tank offline reason"],
    ["spareUsed", "material used"],
    ["activeSpare", "used material name and code"],
    ["faultySpare", "faulty material name and code"],
    ["spareRequirment", "material requirement"],
    ["spareRequirmentname", "material requirement name"],
  ].forEach(([field, label]) => requireField(field, label));

  return missing;
}

function buildVerificationChanges(oldDoc = {}, newDoc = {}) {
  return Object.keys(newDoc)
    .filter((field) => !["_id", "__v", "planId", "createdAt", "updatedAt", "verificationEditLog"].includes(field))
    .map((field) => ({
      field,
      before: oldDoc[field] == null ? "" : Array.isArray(oldDoc[field]) ? oldDoc[field].join(", ") : String(oldDoc[field]),
      after: newDoc[field] == null ? "" : Array.isArray(newDoc[field]) ? newDoc[field].join(", ") : String(newDoc[field]),
    }))
    .filter((change) => change.before !== change.after);
}

/* -------------------------------------------------
   CREATE / UPDATE BPCL STATUS
------------------------------------------------- */
router.post("/saveBPCLStatus", authMiddleware, async (req, res) => {
  try {
    const { planId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Plan ID",
      });
    }

    const missingFields = validateCompleteBpclStatus(req.body);
    if (missingFields.length) {
      return res.status(400).json({
        success: false,
        message: `Please complete all mandatory BPCL status fields: ${missingFields.join(", ")}`,
        missingFields,
      });
    }

    let status = await BPCLStatus.findOne({ planId });
    const isNewStatus = !status;

    if (status) {
      Object.assign(status, req.body);
    } else {
      status = new BPCLStatus({
        ...req.body,
        createdBy: req.user?.username || "unknown",
      });
    }

    const savedStatus = await status.save();

    // ✅ Mark plan as BPCL status saved (CONSISTENT FLAGS)
    await DailyPlan.findByIdAndUpdate(planId, {
      bpclStatusSaved: true,
      statusSaved: true,
    });
    clearStatusDependentCaches();

    const updatedPlan = await DailyPlan.findById(planId);
    if (isNewStatus) {
      sendPendingStatusConfirmationToAdmins({
        customer: "BPCL",
        plan: updatedPlan?.toObject ? updatedPlan.toObject() : (updatedPlan || {}),
        actorName: updatedPlan?.engineer || req.user?.engineerName || req.user?.username || "",
      }).catch((mailErr) => console.error("BPCL pending status confirmation email error:", mailErr?.message || mailErr));
    }

    res.status(200).json({
      success: true,
      message: "✅ BPCL Status saved successfully",
      data: savedStatus,
    });
  } catch (err) {
    console.error("❌ Error saving BPCL status:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* -------------------------------------------------
   GET BPCL STATUS BY PLAN ID (JSON ONLY)
------------------------------------------------- */
router.get("/getBPCLStatusByPlan/:planId", authMiddleware, async (req, res) => {
  try {
    const { planId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Plan ID",
      });
    }

    const status = await BPCLStatus.findOne({ planId })
      .populate("planId")
      .lean(); // 🔥 jsPDF friendly

    if (!status) {
      return res.status(404).json({
        success: false,
        message: "BPCL Status not found",
      });
    }

    res.status(200).json(status); // ✅ JSON ONLY
  } catch (err) {
    console.error("❌ Error fetching BPCL status:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* -------------------------------------------------
   GET ALL BPCL STATUS (ADMIN)
------------------------------------------------- */
router.get("/getAllBPCLStatus", authMiddleware, async (req, res) => {
  try {
    const statuses = await BPCLStatus.find({})
      .populate("planId")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json(
      statuses.filter((status) => isAdminUser(req.user) || canAccessEngineerRecord(req.user, status.planId?.engineer))
    );
  } catch (err) {
    console.error("❌ Error fetching BPCL statuses:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* -------------------------------------------------
   UPDATE BPCL STATUS
------------------------------------------------- */
router.put("/updateBPCLStatus/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ObjectId",
      });
    }

    const oldData = await BPCLStatus.findById(id);
    if (!oldData) {
      return res.status(404).json({
        success: false,
        message: "Record not found",
      });
    }

    // 🔒 Verified lock
    if (oldData.isVerified && req.user?.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Verified records can only be updated by admin",
      });
    }

    const updated = await BPCLStatus.findByIdAndUpdate(id, req.body, {
      new: true,
    });
    clearStatusDependentCaches();

    if (!oldData?.isVerified && req.user?.role === "admin") {
      const verificationChanges = buildVerificationChanges(oldData.toObject(), updated.toObject());
      if (verificationChanges.length) {
        await BPCLStatus.findByIdAndUpdate(id, {
          verificationEditLog: {
            editedBy: req.user?.username || "unknown",
            editedAt: new Date(),
            changes: verificationChanges,
            notificationSentAt: null,
          },
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "BPCL Status updated",
      data: updated,
    });
  } catch (err) {
    console.error("❌ Error updating BPCL status:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* -------------------------------------------------
   VERIFY BPCL STATUS (ADMIN ONLY)
------------------------------------------------- */
router.put("/verifyBPCLStatus/:id", authMiddleware, async (req, res) => {
  try {
    const adminRemark = String(req.body?.adminRemark || "").trim();
    if (req.user?.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const updated = await BPCLStatus.findByIdAndUpdate(
      req.params.id,
      {
        isVerified: true,
        verifiedBy: req.user.username,
        verifiedAt: new Date(),
        ...(adminRemark ? { "verificationEditLog.adminRemark": adminRemark } : {}),
      },
      { new: true },
    ).populate("planId");

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Record not found",
      });
    }

    const plan = updated.planId || {};
    const correctionLog = updated.verificationEditLog || {};
    if (((Array.isArray(correctionLog.changes) && correctionLog.changes.length) || correctionLog.adminRemark) && !correctionLog.notificationSentAt) {
      await sendVerificationCorrectionEmail({
        category: "BPCL",
        engineerName: plan.engineer || "",
        roCode: plan.roCode || "",
        roName: plan.roName || "",
        visitDate: plan.date || "",
        correctedBy: correctionLog.editedBy || req.user?.username || "admin",
        changes: correctionLog.changes,
        adminRemark: correctionLog.adminRemark || adminRemark,
      });

      await BPCLStatus.findByIdAndUpdate(req.params.id, {
        "verificationEditLog.notificationSentAt": new Date(),
      });
    }

    res.status(200).json({
      success: true,
      message: "✅ BPCL Status verified",
      data: updated,
    });
  } catch (err) {
    console.error("❌ Error verifying BPCL status:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* -------------------------------------------------
   DELETE BPCL STATUS
------------------------------------------------- */
router.delete("/deleteBPCLStatus/:id", authMiddleware, async (req, res) => {
  try {
    const status = await BPCLStatus.findById(req.params.id);
    if (!status) {
      return res.status(404).json({
        success: false,
        message: "Record not found",
      });
    }

    await BPCLStatus.findByIdAndDelete(req.params.id);

    // 🔄 Reset plan flags
    await DailyPlan.findByIdAndUpdate(status.planId, {
      bpclStatusSaved: false,
      statusSaved: false,
    });
    clearStatusDependentCaches();

    res.status(200).json({
      success: true,
      message: "BPCL Status deleted",
    });
  } catch (err) {
    console.error("❌ Error deleting BPCL status:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* -------------------------------------------------
   GET LATEST VERIFIED STATUS BY RO CODE (FOR AUTO-FILL)
------------------------------------------------- */
router.get(
  "/getLatestVerifiedByRoCode/:roCode",
  authMiddleware,
  async (req, res) => {
    try {
      const { roCode } = req.params;

      // 1. पहले इस RO Code से जुड़े सभी DailyPlans ढूँढें
      const plans = await DailyPlan.find({ roCode }).select("_id");
      const planIds = plans.map((p) => p._id);

      // 2. इन Plans में से वो BPCLStatus ढूँढें जो Verified हो और सबसे लेटेस्ट हो
      const status = await BPCLStatus.findOne({
        planId: { $in: planIds },
        isVerified: true,
      })
        .sort({ createdAt: -1 }) // सबसे नया पहले
        .lean();

      if (!status) {
        return res.status(404).json({
          success: false,
          message: "No verified record found for this RO Code",
        });
      }

      res.status(200).json(status);
    } catch (err) {
      console.error("❌ Error fetching verified status:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

module.exports = router;
