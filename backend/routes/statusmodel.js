const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Status = require("../models/Status");
const CRMNotification = require("../models/CRMNotification");
const { AuditTrail } = require("../models/AuditLog");
const jwt = require("jsonwebtoken");

// models required at top
const Task = require("../models/Task");
const DailyPlan = require("../models/DailyPlan"); // if not already imported
const {
  sendVerificationCorrectionEmail,
  buildTaskSubject,
  getTaskPriority,
  getTaskDefaultAssignee,
  detectTaskIssueType,
  getTaskCustomer,
  sendStatusRequirementAlertToAdmins,
  sendStatusMaterialUsageAlertToAdmins,
} = require("../services/mailer");

const verifyToken = require("../middleware/authMiddleware");
const { clearCacheByPrefix } = require("../utils/cache");
const { isAdminUser, canAccessEngineerRecord } = require("../utils/accessScope");

const SECRET = process.env.JWT_SECRET || "relcon-secret-key";

function clearStatusDependentCaches() {
  clearCacheByPrefix("daily-plans:");
}

function getOptionalUserFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return {};

  const token = authHeader.split(" ")[1];
  try {
    return jwt.verify(token, SECRET) || {};
  } catch (err) {
    return jwt.decode(token) || {};
  }
}

function isNikhilAdmin(user = {}) {
  return String(user.role || "").toLowerCase() === "admin" &&
    String(user.username || "").toLowerCase() === "nikhil.trivedi";
}

function isAnuragAdmin(user = {}) {
  return String(user.role || "").toLowerCase() === "admin" &&
    String(user.username || "").toLowerCase() === "anurag.mishra";
}

function canUseApprovedVerifiedEdit(user = {}, status = {}) {
  const request = status?.verifiedEditRequest || {};
  return isAnuragAdmin(user) &&
    status?.isVerified === true &&
    request.status === "approved" &&
    String(request.requestedBy || "").toLowerCase() === "anurag.mishra";
}

function editRequestView(status = {}) {
  const request = status?.verifiedEditRequest || {};
  return {
    editRequestStatus: request.status || "none",
    editRequestRequestedBy: request.requestedBy || "",
    editRequestRequestedAt: request.requestedAt || null,
    editRequestReason: request.reason || "",
    editRequestApprovedBy: request.approvedBy || "",
    editRequestApprovedAt: request.approvedAt || null,
  };
}

function isNonStandardDgStatus(value = "") {
  return String(value || "").trim().toUpperCase() === "NON STANDARD DG";
}

function hasHpclActionRequiredIssue(status = {}) {
  const duOffline = String(status.duOffline || "").trim().toUpperCase();
  const tankOffline = String(status.tankOffline || "").trim().toUpperCase();
  const earthingStatus = String(status.earthingStatus || "").trim().toUpperCase();
  return Boolean(
    (duOffline && duOffline !== "ALL OK") ||
    (tankOffline && tankOffline !== "ALL OK") ||
    (earthingStatus && earthingStatus !== "OK") ||
    isNonStandardDgStatus(status.dgStatus)
  );
}

function hasSpareActivity(status = {}) {
  const yesValues = new Set(["YES", "Y", "TRUE"]);
  const spareUsed = String(status.spareUsed || "").trim().toUpperCase();
  const spareReq = String(status.spareRequirment || "").trim().toUpperCase();
  const activeSpare = String(status.activeSpare || "").trim().toUpperCase();
  const faultySpare = String(status.faultySpare || "").trim().toUpperCase();
  const spareReqName = String(status.spareRequirmentname || "").trim().toUpperCase();
  return (
    yesValues.has(spareUsed) ||
    yesValues.has(spareReq) ||
    (activeSpare && activeSpare !== "NO ACTIVE MATERIAL USED") ||
    (faultySpare && faultySpare !== "NO FAULTY MATERIAL CREATED") ||
    (spareReqName && spareReqName !== "NO SPARE REQUIRE")
  );
}

function canVerifyHpclStatus(user = {}, status = {}) {
  if (isAnuragAdmin(user)) return true;
  if (!isNikhilAdmin(user)) return false;
  const phase = String(status.planId?.phase || "").trim().toUpperCase();
  return phase.startsWith("HPCL") &&
    !status.isVerified &&
    (hasHpclActionRequiredIssue(status) || hasSpareActivity(status));
}

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
  dgStatus,
  tankOffline,
  tankRemark,
  tankDependency,
}) {
  const observationLines = [];

  if (earthingStatus === "NOT OK") {
    observationLines.push(
      `1. Earthing status is NOT OK${voltageReading ? ` (Voltage Reading: ${voltageReading})` : ""}.`,
    );
  }

  if (
    duOffline &&
    duOffline !== "ALL OK" &&
    (duDependency === "HPCL" || duDependency === "BOTH")
  ) {
    observationLines.push(
      `2. DU offline count observed: ${duOffline}${duRemark ? ` | Remark: ${duRemark}` : ""}.`,
    );
  }

  if (
    tankOffline &&
    tankOffline !== "ALL OK" &&
    (tankDependency === "HPCL" || tankDependency === "BOTH")
  ) {
    observationLines.push(
      `3. Tank offline count observed: ${tankOffline}${tankRemark ? ` | Remark: ${tankRemark}` : ""}.`,
    );
  }

  if (isNonStandardDgStatus(dgStatus)) {
    observationLines.push(
      "4. Dealer is using Non Standard DG at this site.",
    );
  }

  const actionItems = [];
  if (earthingStatus === "NOT OK") {
    actionItems.push(
      "- Earthing issue may impact automation equipment performance. Kindly arrange rectification on priority.",
    );
    actionItems.push(
      "- Any automation device failure caused by earthing issues may be treated as chargeable replacement.",
    );
  }
  if (
    (duOffline &&
      duOffline !== "ALL OK" &&
      (duDependency === "HPCL" || duDependency === "BOTH")) ||
    (tankOffline &&
      tankOffline !== "ALL OK" &&
      (tankDependency === "HPCL" || tankDependency === "BOTH"))
  ) {
    actionItems.push(
      "- Kindly resolve the listed HPCL dependency points and restore normal operation at the earliest.",
    );
  }
  if (isNonStandardDgStatus(dgStatus)) {
    actionItems.push(
      "- In this subjected site dealer using non standard DG and due to which automation hardware will get damage and it will be replaced on chargeable basis.",
    );
  }

  const observationText = observationLines.length
    ? observationLines.join("\n")
    : "No major HPCL dependency points were observed during the visit.";

  const actionText = actionItems.length
    ? actionItems.join("\n")
    : "- No immediate corrective action is pending from HPCL side as per current observation.";

  return [
    "Dear Sir/Madam,",
    "",
    `This is with reference to the site visit carried out on ${date || "N/A"} at ${roName || "Site"} (RO Code: ${roCode || "N/A"}).`,
    "During the visit, the following observations were recorded:",
    "",
    observationText,
    "",
    "Recommended action from HPCL side:",
    actionText,
    "",
    "We request you to please take necessary action at the earliest and confirm closure by return email.",
    "",
    "Regards,",
    "Nikhil Trivedi",
    "RELCON Systems",
  ].join("\n");
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
    const updatedPlan = await DailyPlan.findByIdAndUpdate(planId, { statusSaved: true }, { new: true }).lean();
    clearStatusDependentCaches();

    const isHpclPlan = String(updatedPlan?.phase || "").trim().toUpperCase().startsWith("HPCL");
    const actorUser = getOptionalUserFromRequest(req);
    if (isHpclPlan) {
      sendStatusRequirementAlertToAdmins({
        customer: "HPCL",
        plan: updatedPlan || {},
        status: savedStatus?.toObject ? savedStatus.toObject() : (savedStatus || req.body),
        actorName: updatedPlan?.engineer || actorUser?.engineerName || actorUser?.username || "",
      }).catch((mailErr) => console.error("HPCL requirement alert email error:", mailErr?.message || mailErr));
    }

    sendStatusMaterialUsageAlertToAdmins({
      customer: isHpclPlan ? "HPCL" : (updatedPlan?.phase || "Status"),
      plan: updatedPlan || {},
      status: savedStatus?.toObject ? savedStatus.toObject() : (savedStatus || req.body),
      actorName: updatedPlan?.engineer || actorUser?.engineerName || actorUser?.username || "",
      actorUsername: actorUser?.username || "",
      actorEmail: actorUser?.email || "",
    }).catch((mailErr) => console.error("Material usage alert email error:", mailErr?.message || mailErr));

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
      statusRecords
      .filter((record) => isAdminUser(req.user) || canAccessEngineerRecord(req.user, record.planId?.engineer))
      .map(async (record) => {
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
          ...editRequestView(status),
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
      statusRecords
      .filter((record) => isAdminUser(req.user) || canAccessEngineerRecord(req.user, record.planId?.engineer))
      .map(async (record) => {
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
          ...editRequestView(status),
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

    const approvedVerifiedEdit = canUseApprovedVerifiedEdit(req.user || {}, oldData);

    // ✅ Prevent update if already verified and user is not nikhil.trivedi or approved Anurag edit
    if (oldData?.isVerified && req.user?.username !== "nikhil.trivedi" && !approvedVerifiedEdit) {
      return res
        .status(403)
        .send("Verified records can only be updated by Nikhil, or by Anurag after Nikhil approval.");
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

    if (approvedVerifiedEdit) {
      await Status.findByIdAndUpdate(id, {
        "verifiedEditRequest.status": "used",
        "verifiedEditRequest.usedAt": new Date(),
      });
      await CRMNotification.updateMany(
        {
          statusRecordId: String(id),
          type: "hpcl_verified_edit_approved",
          recipientUsername: "anurag.mishra",
          isRead: false,
        },
        { isRead: true, readAt: new Date() }
      );
    }

    clearStatusDependentCaches();

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

router.post("/requestVerifiedEdit/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const reason = String(req.body?.reason || "").trim();

  if (!id || id === "undefined") {
    return res.status(400).json({ success: false, message: "Invalid ID provided." });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid ObjectId format." });
    }
    if (!isAnuragAdmin(req.user || {})) {
      return res.status(403).json({ success: false, message: "Only Anurag can request edit access for verified HPCL records." });
    }

    const status = await Status.findById(id).populate("planId");
    if (!status) return res.status(404).json({ success: false, message: "Status not found" });
    const phase = String(status.planId?.phase || "").trim().toUpperCase();
    if (!phase.startsWith("HPCL") || !status.isVerified) {
      return res.status(400).json({ success: false, message: "Edit access can be requested only for verified HPCL records." });
    }

    const currentRequest = status.verifiedEditRequest || {};
    if (currentRequest.status === "pending") {
      return res.json({ success: true, message: "Edit request is already pending with Nikhil." });
    }
    if (currentRequest.status === "approved") {
      return res.json({ success: true, message: "Edit access is already approved. You can edit this record now." });
    }

    const updated = await Status.findByIdAndUpdate(
      id,
      {
        verifiedEditRequest: {
          status: "pending",
          requestedBy: "anurag.mishra",
          requestedAt: new Date(),
          reason,
          approvedBy: "",
          approvedAt: null,
          usedAt: null,
        },
      },
      { new: true }
    ).populate("planId");

    const plan = updated.planId || {};
    await CRMNotification.findOneAndUpdate(
      { key: `hpcl-verified-edit-request:nikhil.trivedi:${id}` },
      {
        $set: {
          type: "hpcl_verified_edit_request",
          title: "HPCL verified record edit request",
          message: `Anurag requested edit access for ${plan.roCode || "RO"}${reason ? `: ${reason}` : ""}`,
          recipientUsername: "nikhil.trivedi",
          recipientName: "Nikhil Trivedi",
          assignedTo: "nikhil.trivedi",
          statusRecordId: String(id),
          roCode: plan.roCode || "",
          roName: plan.roName || "",
          visitDate: plan.date || "",
          severity: "warning",
          link: `statusRecords.html?recordId=${encodeURIComponent(String(id))}`,
          isRead: false,
          readAt: null,
          payload: { requestedBy: "anurag.mishra", reason },
        },
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Edit request sent to Nikhil for approval." });
  } catch (err) {
    console.error("Verified edit request error:", err);
    res.status(500).json({ success: false, message: "Request error: " + err.message });
  }
});

router.put("/approveVerifiedEdit/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  if (!id || id === "undefined") {
    return res.status(400).json({ success: false, message: "Invalid ID provided." });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid ObjectId format." });
    }
    if (!isNikhilAdmin(req.user || {})) {
      return res.status(403).json({ success: false, message: "Only Nikhil can approve verified record edit requests." });
    }

    const status = await Status.findById(id).populate("planId");
    if (!status) return res.status(404).json({ success: false, message: "Status not found" });
    if (status.verifiedEditRequest?.status !== "pending") {
      return res.status(400).json({ success: false, message: "No pending edit request found for this record." });
    }

    const updated = await Status.findByIdAndUpdate(
      id,
      {
        "verifiedEditRequest.status": "approved",
        "verifiedEditRequest.approvedBy": "nikhil.trivedi",
        "verifiedEditRequest.approvedAt": new Date(),
      },
      { new: true }
    ).populate("planId");

    const plan = updated.planId || {};
    await CRMNotification.updateMany(
      {
        statusRecordId: String(id),
        type: "hpcl_verified_edit_request",
        recipientUsername: "nikhil.trivedi",
        isRead: false,
      },
      { isRead: true, readAt: new Date() }
    );

    await CRMNotification.findOneAndUpdate(
      { key: `hpcl-verified-edit-approved:anurag.mishra:${id}` },
      {
        $set: {
          type: "hpcl_verified_edit_approved",
          title: "HPCL verified edit approved",
          message: `Nikhil approved edit access for ${plan.roCode || "RO"}.`,
          recipientUsername: "anurag.mishra",
          recipientName: "Anurag Mishra",
          assignedTo: "anurag.mishra",
          statusRecordId: String(id),
          roCode: plan.roCode || "",
          roName: plan.roName || "",
          visitDate: plan.date || "",
          severity: "success",
          link: `statusRecords.html?recordId=${encodeURIComponent(String(id))}`,
          isRead: false,
          readAt: null,
          payload: { approvedBy: "nikhil.trivedi" },
        },
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Edit access approved for Anurag." });
  } catch (err) {
    console.error("Verified edit approval error:", err);
    res.status(500).json({ success: false, message: "Approval error: " + err.message });
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
    clearStatusDependentCaches();

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
  const adminRemark = String(req.body?.adminRemark || "").trim();

  if (!id || id === "undefined") {
    return res.status(400).send("Invalid ID provided.");
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).send("Invalid ObjectId format.");
    }

    const statusToVerify = await Status.findById(id).populate("planId");
    if (!statusToVerify) return res.status(404).send("Status not found");
    if (!canVerifyHpclStatus(req.user || {}, statusToVerify)) {
      return res.status(403).send("You do not have access to verify this HPCL status record.");
    }

    const updated = await Status.findByIdAndUpdate(
      id,
      {
        isVerified: true,
        ...(adminRemark ? { "verificationEditLog.adminRemark": adminRemark } : {}),
      },
      { new: true },
    ).populate("planId");

    if (!updated) return res.status(404).send("Status not found");

    await CRMNotification.updateMany(
      {
        statusRecordId: String(updated._id),
        type: "hpcl_verification_pending",
        isRead: false,
      },
      { isRead: true, readAt: new Date() }
    );

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
    if (((Array.isArray(correctionLog.changes) && correctionLog.changes.length) || correctionLog.adminRemark) && !correctionLog.notificationSentAt) {
      await sendVerificationCorrectionEmail({
        category: "HPCL",
        engineerName,
        roCode,
        roName,
        visitDate,
        correctedBy: correctionLog.editedBy || req.user?.username || "admin",
        changes: correctionLog.changes,
        adminRemark: correctionLog.adminRemark || adminRemark,
      });

      await Status.findByIdAndUpdate(id, {
        "verificationEditLog.notificationSentAt": new Date(),
      });
    }

    // ✅ Task Generation — only if admin + anurag.mishra
    const {
      earthingStatus,
      dgStatus,
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
      !updated.taskGenerated &&
      (earthingStatus === "NOT OK" ||
        (duOffline &&
          duOffline !== "ALL OK" &&
          (duDependency === "HPCL" || duDependency === "BOTH")) ||
        (tankOffline &&
          tankOffline !== "ALL OK" &&
          (tankDependency === "HPCL" || tankDependency === "BOTH")) ||
        isNonStandardDgStatus(dgStatus)) &&
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
      if (isNonStandardDgStatus(dgStatus)) issues.push("Non Standard DG");

      const issueSummary = issues.join(" + ");

      const taskPayload = {
        statusId: updated._id,
        roCode: plan.roCode,
        region: plan.region,
        roName: plan.roName,
        date: plan.date,
        engineer: plan.engineer,
        customer: "HPCL",
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
          dgStatus,
          tankOffline,
          tankRemark,
          tankDependency,
        }),
        earthingStatus,
        dgStatus,
        voltageReading,
        duOffline,
        duDependency,
        duRemark,
        tankOffline,
        tankRemark,
        tankDependency,
      };
      taskPayload.customer = getTaskCustomer(taskPayload);
      taskPayload.issueType = detectTaskIssueType(taskPayload);
      taskPayload.priority = getTaskPriority(taskPayload);
      taskPayload.assignedTo = getTaskDefaultAssignee(taskPayload);
      taskPayload.subject = buildTaskSubject(taskPayload, "action");

      const task = new Task(taskPayload);

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
    const roCode = String(req.params.roCode || "").trim().toUpperCase();

    // 1. इस RO Code के सभी DailyPlans ढूंढें
    const plans = await DailyPlan.find({ roCode }).select("_id");
    const planIds = plans.map((p) => p._id);

    // 2. सबसे लेटेस्ट Verified स्टेटस ढूंढें
    const lastVerified = await Status.findOne({
      planId: { $in: planIds },
      isVerified: true,
    })
      .sort({ createdAt: -1 })
      .select("probeMake probeSize connectivityType sim1Provider sim1Number sim2Provider sim2Number iemiNumber")
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
