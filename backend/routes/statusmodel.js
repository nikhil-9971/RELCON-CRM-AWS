const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Status = require("../models/Status");
const { AuditTrail } = require("../models/AuditLog");
const jwt = require("jsonwebtoken");

// models required at top
const Task = require("../models/Task");
const DailyPlan = require("../models/DailyPlan"); // if not already imported
const { sendVerificationCorrectionEmail } = require("../services/mailer");

const verifyToken = require("../middleware/authMiddleware");

const SECRET = process.env.JWT_SECRET || "relcon-secret-key";

// ✅ Utility: Email content generator
function generateEmailContent({
  roName,
  roCode,
  date,
  earthingStatus,
  voltageReading,
  duOffline,
  duRemark,
  duDependency,
  tankOffline,
  tankRemark,
  tankDependency,
}) {
  let observations = [];

  if (earthingStatus === "NOT OK") {
    observations.push(`⚡Earthing is NOT OK (${voltageReading || "N/A"})`);
  }

  if (
    duOffline &&
    duOffline !== "ALL OK" &&
    (duDependency === "HPCL" || duDependency === "BOTH")
  ) {
    let duLine = `⛽ DU Offline Count: ${duOffline}`;
    if (duRemark) {
      duLine += `\n   🔹 Remark: ${duRemark}`;
    }
    observations.push(duLine);
  }

  if (
    tankOffline &&
    tankOffline !== "ALL OK" &&
    (tankDependency === "HPCL" || tankDependency === "BOTH")
  ) {
    let tankLine = `🛢️ Tank Offline Count: ${tankOffline}`;
    if (tankRemark) {
      tankLine += `\n   🔹 Remark: ${tankRemark}`;
    }
    observations.push(tankLine);
  }

  const observationText = observations.length
    ? observations.join("\n")
    : "➡️ No major issues reported.";

  let email = `Dear Sir/Ma'am,\n\nDuring the recent visit on dated ${date} at ${roName} (RO Code: ${roCode}), the engineer observed:\n\n${observationText}`;

  if (earthingStatus === "NOT OK") {
    email += `\n\nNote: We request to resolve earthing issue at most priority basis. If any automation device failure due to earthing issue then it will be replaced on chargeable basis. `;
  }

  email += `\n\nPlease resolve HPCL dependencies at the earliest and confirm on mail after resolution.`;

  return email;
}

// Save Status Route
router.post("/saveStatus", async (req, res) => {
  try {
    const {
      planId,
      probeMake,
      probeSize,
      lowProductLock,
      highWaterSet,
      duSerialNumber,
      dgStatus,
      connectivityType,
      sim1Provider,
      sim1Number,
      sim2Provider,
      sim2Number,
      iemiNumber,
      bosVersion,
      fccVersion,
      wirelessSlave,
      sftpConfig,
      adminPassword,
      workCompletion,
      spareUsed,
      activeSpare,
      faultySpare,
      spareRequirment,
      spareRequirmentname,
      earthingStatus,
      voltageReading,
      duOffline,
      duDependency,
      duRemark,
      tankOffline,
      tankDependency,
      tankRemark,
      bosIP,
      fccIP,
      locationField,
    } = req.body;

    const savedStatus = await Status.findOneAndUpdate(
      { planId },
      {
        planId,
        probeMake,
        probeSize,
        lowProductLock,
        highWaterSet,
        duSerialNumber,
        dgStatus,
        connectivityType,
        sim1Provider,
        sim1Number,
        sim2Provider,
        sim2Number,
        iemiNumber,
        bosVersion,
        fccVersion,
        wirelessSlave,
        sftpConfig,
        adminPassword,
        workCompletion,
        spareUsed,
        activeSpare,
        faultySpare,
        spareRequirment,
        spareRequirmentname,
        earthingStatus,
        voltageReading,
        duOffline,
        duDependency,
        duRemark,
        tankOffline,
        tankDependency,
        tankRemark,
        bosIP,
        fccIP,
        locationField,
      },
      { upsert: true, new: true },
    );

    // ✅ Mark DailyPlan as statusSaved = true
    await DailyPlan.findByIdAndUpdate(planId, { statusSaved: true });

    res.send("Status saved");
  } catch (err) {
    res.status(500).send("Server error: " + err.message);
  }
});

// New Api added for Status record fetch
router.get("/getMergedStatusRecords", verifyToken, async (req, res) => {
  try {
    const statusRecords = await Status.find().populate("planId");
    const merged = await Promise.all(
      statusRecords.map(async (record) => {
        const plan = record.planId || {};
        const status = record || {};
        const taskExists = await Task.exists({ statusId: status._id });
        return {
          _id: status._id?.toString() || "",
          planId: status.planId?._id?.toString() || "",
          engineer: plan.engineer || "",
          zone: plan.zone || "",
          region: plan.region || "",
          phase: plan.phase || "",
          roCode: plan.roCode || "",
          roName: plan.roName || "",
          date: plan.date || "",
          amcQtr: plan.amcQtr || "",
          purpose: plan.purpose || "",
          probeMake: status.probeMake || "",
          probeSize: status.probeSize || "",
          lowProductLock: status.lowProductLock || "",
          highWaterSet: status.highWaterSet || "",
          duSerialNumber: status.duSerialNumber || "",
          dgStatus: status.dgStatus || "",
          connectivityType: status.connectivityType || "",
          sim1Provider: status.sim1Provider || "",
          sim1Number: status.sim1Number || "",
          sim2Provider: status.sim2Provider || "",
          sim2Number: status.sim2Number || "",
          iemiNumber: status.iemiNumber || "",
          bosVersion: status.bosVersion || "",
          fccVersion: status.fccVersion || "",
          wirelessSlave: status.wirelessSlave || "",
          sftpConfig: status.sftpConfig || "",
          adminPassword: status.adminPassword || "",
          workCompletion: status.workCompletion || "",
          spareUsed: status.spareUsed || "",
          activeSpare: status.activeSpare || "",
          faultySpare: status.faultySpare || "",
          spareRequirment: status.spareRequirment || "",
          spareRequirmentname: status.spareRequirmentname || "",
          earthingStatus: status.earthingStatus || "",
          voltageReading: status.voltageReading || "",
          duOffline: status.duOffline || "",
          duDependency: status.duDependency || "",
          duRemark: status.duRemark || "",
          tankOffline: status.tankOffline || "",
          tankDependency: status.tankDependency || "",
          tankRemark: status.tankRemark || "",
          bosIP: status.bosIP || "",
          fccIP: status.fccIP || "",
          locationField: status.locationField || "",
          isVerified: status.isVerified || false,
          taskGenerated: !!taskExists,
          oms03: status.oms03 || "No",
        };
      })
    );
    res.json(merged);
  } catch (err) {
    console.error("getMergedStatusRecords error:", err);
    res.status(500).send("Server error: " + err.message);
  }
});

// ✅ Alias for DB Explorer
router.get("/getStatusRecords", verifyToken, async (req, res) => {
  try {
    const statusRecords = await Status.find().populate("planId");
    const merged = await Promise.all(
      statusRecords.map(async (record) => {
        const plan = record.planId || {};
        const status = record || {};
        const taskExists = await Task.exists({ statusId: status._id });
        return {
          _id: status._id?.toString() || "",
          planId: status.planId?._id?.toString() || "",
          engineer: plan.engineer || "",
          zone: plan.zone || "",
          region: plan.region || "",
          phase: plan.phase || "",
          roCode: plan.roCode || "",
          roName: plan.roName || "",
          date: plan.date || "",
          amcQtr: plan.amcQtr || "",
          purpose: plan.purpose || "",
          probeMake: status.probeMake || "",
          probeSize: status.probeSize || "",
          lowProductLock: status.lowProductLock || "",
          highWaterSet: status.highWaterSet || "",
          duSerialNumber: status.duSerialNumber || "",
          dgStatus: status.dgStatus || "",
          connectivityType: status.connectivityType || "",
          sim1Provider: status.sim1Provider || "",
          sim1Number: status.sim1Number || "",
          sim2Provider: status.sim2Provider || "",
          sim2Number: status.sim2Number || "",
          iemiNumber: status.iemiNumber || "",
          bosVersion: status.bosVersion || "",
          fccVersion: status.fccVersion || "",
          wirelessSlave: status.wirelessSlave || "",
          sftpConfig: status.sftpConfig || "",
          adminPassword: status.adminPassword || "",
          workCompletion: status.workCompletion || "",
          spareUsed: status.spareUsed || "",
          activeSpare: status.activeSpare || "",
          faultySpare: status.faultySpare || "",
          spareRequirment: status.spareRequirment || "",
          spareRequirmentname: status.spareRequirmentname || "",
          earthingStatus: status.earthingStatus || "",
          voltageReading: status.voltageReading || "",
          duOffline: status.duOffline || "",
          duDependency: status.duDependency || "",
          duRemark: status.duRemark || "",
          tankOffline: status.tankOffline || "",
          tankDependency: status.tankDependency || "",
          tankRemark: status.tankRemark || "",
          bosIP: status.bosIP || "",
          fccIP: status.fccIP || "",
          locationField: status.locationField || "",
          isVerified: status.isVerified || false,
          taskGenerated: !!taskExists,
          oms03: status.oms03 || "No",
        };
      })
    );
    res.json(merged);
  } catch (err) {
    res.status(500).send("Server error: " + err.message);
  }
});

// Update status by _id
// 🔧 Utility: compare and return only changed fields
function getChangedFields(oldDoc, newDoc) {
  const before = {};
  const after = {};

  for (const key in newDoc) {
    if (JSON.stringify(oldDoc[key]) !== JSON.stringify(newDoc[key])) {
      before[key] = oldDoc[key];
      after[key] = newDoc[key];
    }
  }

  return { before, after };
}

function buildVerificationChanges(before = {}, after = {}) {
  return Object.keys(after)
    .filter((field) => !["_id", "__v", "planId", "createdAt", "verificationEditLog"].includes(field))
    .map((field) => ({
      field,
      before: before[field] == null ? "" : String(before[field]),
      after: after[field] == null ? "" : String(after[field]),
    }))
    .filter((change) => change.before !== change.after);
}

router.put("/updateStatus/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  if (!id || id === "undefined") {
    return res.status(400).send("Invalid ID provided.");
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).send("Invalid ObjectId format.");
    }

    const oldData = await Status.findById(id).populate("planId");

    // ✅ Prevent update if already verified and user is not nikhil.trivedi
    if (oldData?.isVerified && req.user?.username !== "nikhil.trivedi") {
      return res
        .status(403)
        .send("Verified records can only be updated by Nikhil.");
    }

    const allowedFields = [
      "probeMake",
      "probeSize",
      "lowProductLock",
      "highWaterSet",
      "duSerialNumber",
      "dgStatus",
      "connectivityType",
      "sim1Provider",
      "sim1Number",
      "sim2Provider",
      "sim2Number",
      "iemiNumber",
      "bosVersion",
      "fccVersion",
      "wirelessSlave",
      "sftpConfig",
      "adminPassword",
      "workCompletion",
      "spareUsed",
      "activeSpare",
      "faultySpare",
      "spareRequirment",
      "spareRequirmentname",
      "earthingStatus",
      "voltageReading",
      "duOffline",
      "duDependency",
      "duRemark",
      "tankOffline",
      "tankDependency",
      "tankRemark",
      "bosIP",
      "fccIP",
      "locationField",
      "isVerified",
      "taskGenerated",
      "oms03",
    ];

    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const updated = await Status.findByIdAndUpdate(id, updates, {
      new: true,
    }).populate("planId");

    if (!updated) return res.status(404).send("Status not found");

    const { before, after } = getChangedFields(
      oldData.toObject(),
      updated.toObject(),
    );

    const plan = updated.planId || {};
    const roCode = plan.roCode || "N/A";
    const roName = plan.roName || "N/A";
    const visitDate = plan.date || "N/A";
    const engineerName = plan.engineer || "N/A";

    await AuditTrail.create({
      modifiedBy: req.user?.username || "unknown",
      action: "edit",
      recordType: "status",
      before,
      after,
      roCode,
      roName,
      visitDate,
      engineerName,
    });

    if (!oldData?.isVerified && req.user?.role === "admin") {
      const verificationChanges = buildVerificationChanges(before, after);
      if (verificationChanges.length) {
        await Status.findByIdAndUpdate(id, {
          verificationEditLog: {
            editedBy: req.user?.username || "unknown",
            editedAt: new Date(),
            changes: verificationChanges,
            notificationSentAt: null,
          },
        });
      }
    }

    res.send("Status updated");
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).send("Update error: " + err.message);
  }
});

// Delete status by _id

router.delete("/deleteStatus/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  if (!id || id === "undefined") {
    return res.status(400).send("Invalid ID provided.");
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).send("Invalid ObjectId format.");
    }

    const oldData = await Status.findById(id).populate("planId");

    if (!oldData) return res.status(404).send("Status not found");

    const plan = oldData.planId || {};
    const roCode = plan.roCode || "N/A";
    const roName = plan.roName || "N/A";
    const visitDate = plan.date || "N/A";
    const engineerName = plan.engineer || "N/A";

    const deleted = await Status.findByIdAndDelete(id);

    await AuditTrail.create({
      modifiedBy: req.user?.username || "unknown",
      action: "delete",
      recordType: "status",
      before: oldData.toObject(),
      after: null,
      roCode,
      roName,
      visitDate,
      engineerName,
    });

    res.send("Status deleted");
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).send("Delete error: " + err.message);
  }
});

// ✅ VERIFY a status by ID
// ✅ VERIFY a status by ID
router.put("/verifyStatus/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  if (!id || id === "undefined") {
    return res.status(400).send("Invalid ID provided.");
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).send("Invalid ObjectId format.");
    }

    const updated = await Status.findByIdAndUpdate(
      id,
      { isVerified: true },
      { new: true },
    ).populate("planId");

    if (!updated) return res.status(404).send("Status not found");

    const plan = updated.planId || {};
    const roCode = plan.roCode || "N/A";
    const roName = plan.roName || "N/A";
    const visitDate = plan.date || "N/A";
    const engineerName = plan.engineer || "N/A";

    await AuditTrail.create({
      modifiedBy: req.user?.username || "unknown",
      action: "verify",
      recordType: "status",
      before: { isVerified: false },
      after: { isVerified: true },
      roCode,
      roName,
      visitDate,
      engineerName,
    });

    const correctionLog = updated.verificationEditLog || {};
    if (Array.isArray(correctionLog.changes) && correctionLog.changes.length && !correctionLog.notificationSentAt) {
      await sendVerificationCorrectionEmail({
        category: "HPCL",
        engineerName,
        roCode,
        roName,
        visitDate,
        correctedBy: correctionLog.editedBy || req.user?.username || "admin",
        changes: correctionLog.changes,
      });

      await Status.findByIdAndUpdate(id, {
        "verificationEditLog.notificationSentAt": new Date(),
      });
    }

    // ✅ Task Generation — only if admin + anurag.mishra
    const {
      earthingStatus,
      duOffline,
      voltageReading,
      duRemark,
      duDependency,
      tankOffline,
      tankRemark,
      tankDependency,
    } = updated;

    let taskCreated = false;

    if (
      (earthingStatus === "NOT OK" ||
        (duOffline &&
          duOffline !== "ALL OK" &&
          (duDependency === "HPCL" || duDependency === "BOTH")) ||
        (tankOffline &&
          tankOffline !== "ALL OK" &&
          (tankDependency === "HPCL" || tankDependency === "BOTH"))) &&
      req.user?.username === "anurag.mishra" &&
      req.user?.role === "admin"
    ) {
      const issues = [];
      if (earthingStatus === "NOT OK") issues.push("Earthing NOT OK");
      if (
        duOffline &&
        duOffline !== "ALL OK" &&
        (duDependency === "HPCL" || duDependency === "BOTH")
      )
        issues.push(`DU Offline: ${duOffline}`);
      if (
        tankOffline &&
        tankOffline !== "ALL OK" &&
        (tankDependency === "HPCL" || tankDependency === "BOTH")
      )
        issues.push(`Tank Offline: ${tankOffline}`);

      const issueSummary = issues.join(" + ");

      const task = new Task({
        statusId: updated._id,
        roCode: plan.roCode,
        region: plan.region,
        roName: plan.roName,
        date: plan.date,
        engineer: plan.engineer,
        issue: issueSummary,
        emailContent: generateEmailContent({
          roName: plan.roName,
          roCode: plan.roCode,
          date: plan.date,
          earthingStatus,
          voltageReading,
          duOffline,
          duRemark,
          duDependency,
          tankOffline,
          tankRemark,
          tankDependency,
        }),
        earthingStatus,
        voltageReading,
        duOffline,
        duDependency,
        duRemark,
        tankOffline,
        tankRemark,
        tankDependency,
      });

      await task.save();
      taskCreated = true;

      // ✅ Save taskGenerated: true in Status
      await Status.findByIdAndUpdate(updated._id, { taskGenerated: true });
    }

    res.send(
      taskCreated
        ? "Status verified successfully and task generated"
        : "Status verified successfully",
    );
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).send("Verify error: " + err.message);
  }
});

/* -------------------------------------------------
   GET LATEST VERIFIED HPCL STATUS BY RO CODE
------------------------------------------------- */
router.get("/getLatestVerifiedHPCLByRoCode/:roCode", async (req, res) => {
  try {
    const { roCode } = req.params;

    // 1. इस RO Code के सभी DailyPlans ढूंढें
    const plans = await DailyPlan.find({ roCode }).select("_id");
    const planIds = plans.map((p) => p._id);

    // 2. सबसे लेटेस्ट Verified स्टेटस ढूंढें
    const lastVerified = await Status.findOne({
      planId: { $in: planIds },
      isVerified: true,
    })
      .sort({ createdAt: -1 })
      .select("probeMake probeSize") // हमें सिर्फ ये दो फील्ड्स चाहिए
      .lean();

    if (!lastVerified) {
      return res
        .status(404)
        .json({ success: false, message: "No verified record found" });
    }

    res.json(lastVerified);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
