const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const MaterialRequestBuilder = require("../models/MaterialRequestBuilder");
const verifyToken = require("../middleware/authMiddleware");
const {
  sendMaterialRequestNotification,
  sendMaterialDispatchNotification,
  normalizeStatusLabel,
  isRequirementGivenToHQOStatus,
} = require("../services/mailer");
const { scopeByEngineer } = require("../utils/accessScope");

function isAdmin(req) {
  return String(req.user?.role || "").toLowerCase() === "admin";
}

function normalizeDeliveryStatus(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower.includes("deliver")) return "Delivered";
  if (lower.includes("transit")) return "In Transit";
  if (lower.includes("dispatch")) return "Dispatched";
  if (lower.includes("process")) return "In Process";
  return text;
}

function isTransitRequest(record = {}) {
  return normalizeStatusLabel(record.materialDispatchStatus) === "In Transit";
}

function isDeliveryUpdateTokenValid(record = {}) {
  return !record.deliveryUpdateTokenExpiresAt || record.deliveryUpdateTokenExpiresAt >= new Date();
}

function buildDeliveryUpdateUrl(req, token) {
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}/material-delivery-update?token=${encodeURIComponent(token)}`;
}

function buildPublicDeliverySnapshot(record = {}) {
  return {
    id: record._id?.toString?.() || record._id || "",
    coordinatorName: record.coordinatorName || record.createdByName || "Nikhil Trivedi",
    engineer: record.engineer || "",
    engineerCode: record.engineerCode || "",
    engineerEmailId: record.engineerEmailId || "",
    engineerContactNumber: record.engineerContactNumber || "",
    region: record.region || "",
    customer: record.customer || "",
    roCode: record.roCode || "",
    roName: record.roName || "",
    phase: record.phase || "",
    date: record.date || "",
    materialRequestTo: record.materialRequestTo || "",
    materialRequestFromEmail: record.materialRequestFromEmail || "",
    materialRequestDate: record.materialRequestDate || "",
    destinationAddress: record.destinationAddress || "",
    materialArrangeFrom: record.materialArrangeFrom || "",
    materialDispatchStatus: record.materialDispatchStatus || "",
    deliveryStatus: record.deliveryStatus || "",
    materialReceivedDate: record.materialReceivedDate || "",
    materialSummary: record.materialSummary || "",
    lineItems: Array.isArray(record.lineItems) ? record.lineItems : [],
    deliveryUpdateTokenExpiresAt: record.deliveryUpdateTokenExpiresAt || null,
  };
}

async function ensureTransitDeliveryLink(record, req) {
  if (!record || !isTransitRequest(record)) return record;
  const token = record.deliveryUpdateToken || crypto.randomBytes(24).toString("hex");
  const tokenExpiresAt = record.deliveryUpdateTokenExpiresAt || new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
  const deliveryUpdateUrl = buildDeliveryUpdateUrl(req, token);
  const needsPersist = !record.deliveryUpdateToken || !record.deliveryUpdateTokenExpiresAt;
  if (needsPersist && record._id) {
    await MaterialRequestBuilder.findByIdAndUpdate(record._id, {
      deliveryUpdateToken: token,
      deliveryUpdateTokenExpiresAt: tokenExpiresAt,
    });
  }
  return {
    ...record,
    deliveryUpdateToken: token,
    deliveryUpdateTokenExpiresAt: tokenExpiresAt,
    deliveryUpdateUrl,
  };
}

function applyDeliveryUpdateToRecord(record = {}, body = {}) {
  const deliveryStatus = normalizeDeliveryStatus(body.deliveryStatus || body.materialDispatchStatus || record.deliveryStatus || "Delivered");
  const deliveryDate = String(body.deliveryDate || body.materialReceivedDate || "").trim();
  const remarks = String(body.remarks || record.remarks || "").trim();
  const lineItems = Array.isArray(record.lineItems) ? record.lineItems.map((item) => ({
    ...item,
    deliveryStatus: deliveryStatus || item.deliveryStatus || "",
    deliveryDate: deliveryDate || item.deliveryDate || "",
  })) : [];
  return {
    materialDispatchStatus: deliveryStatus || record.materialDispatchStatus || "",
    deliveryStatus,
    materialReceivedDate: deliveryDate,
    remarks,
    lineItems,
  };
}

function normalizeRequestMode(body = {}) {
  const mode = String(body.requestMode || "").trim();
  if (mode) return mode;
  if (String(body.clientRequirement || "").trim()) return "Client Requirement";
  return String(body.materialUsedIn || "").trim().toLowerCase() === "engineer inventory"
    ? "Engineer Inventory"
    : "RO Site Request";
}

function normalizePayload(body = {}, req = {}) {
  const lineItems = Array.isArray(body.lineItems)
    ? body.lineItems
        .map((item) => ({
          materialName: String(item?.materialName || "").trim(),
          materialType: String(item?.materialType || "").trim(),
          requestType: String(item?.requestType || "").trim(),
          quantity: Math.max(1, Number(item?.quantity || 1) || 1),
          materialStatus: String(item?.materialStatus || "").trim(),
          challanNumber: String(item?.challanNumber || "").trim(),
          challanCreationDate: String(item?.challanCreationDate || "").trim(),
          dispatchCourier: String(item?.dispatchCourier || "").trim(),
          docketNumber: String(item?.docketNumber || "").trim(),
          dispatchDate: String(item?.dispatchDate || "").trim(),
          deliveryStatus: String(item?.deliveryStatus || "").trim(),
          deliveryDate: String(item?.deliveryDate || "").trim(),
          poNumber: String(item?.poNumber || "").trim(),
          poDate: String(item?.poDate || "").trim(),
          notes: String(item?.notes || "").trim(),
        }))
        .filter((item) => item.materialName)
    : [];

  const summary = lineItems
    .slice(0, 2)
    .map((item) => `${item.materialName}${item.quantity > 1 ? ` x${item.quantity}` : ""}`)
    .join(", ");

  const requestMode = normalizeRequestMode(body);
  const inventoryMode = requestMode === "Engineer Inventory";
  const clientMode = requestMode === "Client Requirement";
  const clientRequirement = String(body.clientRequirement || "").trim();

  return {
    requestMode,
    clientRequirement,
    coordinatorName: String(body.coordinatorName || req.user?.engineerName || req.user?.username || "Nikhil Trivedi").trim() || "Nikhil Trivedi",
    engineer: clientMode ? clientRequirement : String(body.engineer || "").trim(),
    engineerCode: clientMode ? "NA" : String(body.engineerCode || "").trim(),
    engineerContactNumber: clientMode ? "" : String(body.engineerContactNumber || "").trim(),
    engineerEmailId: clientMode ? "" : String(body.engineerEmailId || "").trim(),
    region: String(body.region || "").trim(),
    customer: String(body.customer || "").trim() || (clientMode ? "HPCL" : ""),
    roCode: inventoryMode || clientMode ? "NA" : String(body.roCode || "").trim(),
    roName: inventoryMode || clientMode ? "NA" : String(body.roName || "").trim(),
    phase: inventoryMode || clientMode ? "NA" : String(body.phase || "").trim(),
    date: String(body.date || "").trim(),
    materialUsedIn: inventoryMode ? "Engineer Inventory" : clientMode ? clientRequirement : String(body.materialUsedIn || "").trim(),
    materialRequestTo: String(body.materialRequestTo || "").trim(),
    materialRequestFromEmail: String(body.materialRequestFromEmail || "").trim(),
    materialRequestDate: String(body.materialRequestDate || "").trim(),
    destinationAddress: String(body.destinationAddress || "").trim(),
    materialArrangeFrom: String(body.materialArrangeFrom || "").trim(),
    materialSummary: String(body.materialSummary || summary).trim(),
    materialDispatchStatus: String(body.materialDispatchStatus || lineItems[0]?.materialStatus || "").trim(),
    materialRequirementType: String(body.materialRequirementType || lineItems[0]?.requestType || "").trim(),
    quantity: Number(body.quantity || lineItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 0) || 0,
    deliveryStatus: String(body.deliveryStatus || lineItems[0]?.deliveryStatus || "").trim(),
    materialReceivedDate: String(body.materialReceivedDate || lineItems[0]?.deliveryDate || "").trim(),
    remarks: String(body.remarks || "").trim(),
    createdByUsername: String(body.createdByUsername || req.user?.username || "").trim(),
    createdByName: String(body.createdByName || body.coordinatorName || req.user?.engineerName || req.user?.username || "Nikhil Trivedi").trim() || "Nikhil Trivedi",
    updatedByUsername: String(req.user?.username || "").trim(),
    updatedByName: String(body.updatedByName || body.coordinatorName || req.user?.engineerName || req.user?.username || "Nikhil Trivedi").trim() || "Nikhil Trivedi",
    lineItems,
  };
}

function getMaterialWorkflowStatuses(request = {}) {
  const values = [
    request.materialDispatchStatus,
    request.deliveryStatus,
    ...(Array.isArray(request.lineItems)
      ? request.lineItems.flatMap((item) => [item.materialStatus, item.deliveryStatus])
      : []),
  ];
  return new Set(values.map(normalizeStatusLabel).filter(Boolean));
}

function hasWorkflowStatus(request = {}, status = "") {
  return getMaterialWorkflowStatuses(request).has(normalizeStatusLabel(status));
}

const NOTIFICATION_STATUS_BY_TYPE = {
  delivered: "Delivered",
  transit: "In Transit",
  dispatch: "Dispatched",
  process: "In Process",
};

function lineHasStatus(item = {}, status = "") {
  const normalizedStatus = normalizeStatusLabel(status);
  return [item.materialStatus, item.deliveryStatus]
    .map(normalizeStatusLabel)
    .includes(normalizedStatus);
}

function lineHasDispatchReference(item = {}) {
  return Boolean(
    String(item.docketNumber || "").trim() ||
    String(item.dispatchDate || "").trim() ||
    String(item.dispatchCourier || "").trim() ||
    String(item.challanNumber || "").trim()
  );
}

function lineChangedForNotification(previousItem = {}, nextItem = {}, notificationType = "") {
  const fields = notificationType === "delivered"
    ? ["materialStatus", "deliveryStatus", "deliveryDate", "poNumber", "poDate", "docketNumber"]
    : ["materialStatus", "deliveryStatus", "dispatchCourier", "docketNumber", "dispatchDate", "challanNumber", "challanCreationDate"];

  return fields.some((field) => String(previousItem?.[field] || "").trim() !== String(nextItem?.[field] || "").trim());
}

function getNotificationLineItems(previous = {}, next = {}, notificationType = "") {
  const status = NOTIFICATION_STATUS_BY_TYPE[notificationType];
  const nextItems = Array.isArray(next.lineItems) ? next.lineItems : [];
  const previousItems = Array.isArray(previous.lineItems) ? previous.lineItems : [];
  if (!status || !nextItems.length) return nextItems;

  const matchingItems = nextItems.filter((item) => {
    if (!lineHasStatus(item, status)) return false;
    if (["dispatch", "transit"].includes(notificationType) && !lineHasDispatchReference(item)) return false;
    return true;
  });

  const changedItems = matchingItems.filter((item, index) => {
    const originalIndex = nextItems.indexOf(item);
    return lineChangedForNotification(previousItems[originalIndex] || {}, item, notificationType);
  });

  return changedItems.length ? changedItems : matchingItems;
}

function buildNotificationRequest(previous = {}, next = {}, notificationType = "") {
  const lineItems = getNotificationLineItems(previous, next, notificationType);
  if (!lineItems.length) return null;
  return {
    ...next,
    lineItems,
    quantity: lineItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    materialSummary: lineItems
      .slice(0, 2)
      .map((item) => `${item.materialName || "Material"}${Number(item.quantity || 0) > 1 ? ` x${item.quantity}` : ""}`)
      .join(", "),
  };
}

function hasNotificationLineChange(previous = {}, next = {}, notificationType = "") {
  const status = NOTIFICATION_STATUS_BY_TYPE[notificationType];
  const nextItems = Array.isArray(next.lineItems) ? next.lineItems : [];
  const previousItems = Array.isArray(previous.lineItems) ? previous.lineItems : [];
  if (!status || !nextItems.length) return false;

  return nextItems.some((item, index) => {
    if (!lineHasStatus(item, status)) return false;
    if (["dispatch", "transit"].includes(notificationType) && !lineHasDispatchReference(item)) return false;
    return lineChangedForNotification(previousItems[index] || {}, item, notificationType);
  });
}

async function triggerMaterialRequestCreateNotifications(created) {
  try {
    if (hasWorkflowStatus(created, "Delivered")) {
      const request = buildNotificationRequest({}, created, "delivered");
      if (request) await sendMaterialDispatchNotification(request, "delivered");
    } else if (hasWorkflowStatus(created, "In Transit")) {
      const request = buildNotificationRequest({}, created, "transit");
      if (request) await sendMaterialDispatchNotification(request, "transit");
    } else if (hasWorkflowStatus(created, "Dispatched")) {
      const request = buildNotificationRequest({}, created, "dispatch");
      if (request) await sendMaterialDispatchNotification(request, "dispatch");
    } else if (hasWorkflowStatus(created, "In Process")) {
      const request = buildNotificationRequest({}, created, "process");
      if (request) await sendMaterialDispatchNotification(request, "process");
    } else if (isRequirementGivenToHQOStatus(created?.materialDispatchStatus) || hasWorkflowStatus(created, "Requiment given to HQO")) {
      await sendMaterialRequestNotification(created);
    }
  } catch (err) {
    console.error("Material request create notification error:", err?.message || err);
  }
}

function shouldNotifyRequirement(previous = {}, next = {}) {
  const before = isRequirementGivenToHQOStatus(previous.materialDispatchStatus) || hasWorkflowStatus(previous, "Requiment given to HQO");
  const after = isRequirementGivenToHQOStatus(next.materialDispatchStatus) || hasWorkflowStatus(next, "Requiment given to HQO");
  return !before && after;
}

function shouldNotifyInProcess(previous = {}, next = {}) {
  return (!hasWorkflowStatus(previous, "In Process") && hasWorkflowStatus(next, "In Process")) || hasNotificationLineChange(previous, next, "process");
}

function shouldNotifyDispatch(previous = {}, next = {}) {
  return (!hasWorkflowStatus(previous, "Dispatched") && hasWorkflowStatus(next, "Dispatched")) || hasNotificationLineChange(previous, next, "dispatch");
}

function shouldNotifyTransit(previous = {}, next = {}) {
  return (!hasWorkflowStatus(previous, "In Transit") && hasWorkflowStatus(next, "In Transit")) || hasNotificationLineChange(previous, next, "transit");
}

function shouldNotifyDelivered(previous = {}, next = {}) {
  return (!hasWorkflowStatus(previous, "Delivered") && hasWorkflowStatus(next, "Delivered")) || hasNotificationLineChange(previous, next, "delivered");
}

async function triggerMaterialRequestUpdateNotifications(previous, updated) {
  try {
    if (shouldNotifyRequirement(previous, updated)) {
      await sendMaterialRequestNotification(updated);
    }
    if (shouldNotifyDelivered(previous, updated)) {
      const request = buildNotificationRequest(previous, updated, "delivered");
      if (request) await sendMaterialDispatchNotification(request, "delivered");
    } else if (shouldNotifyTransit(previous, updated)) {
      const request = buildNotificationRequest(previous, updated, "transit");
      if (request) await sendMaterialDispatchNotification(request, "transit");
    } else if (shouldNotifyDispatch(previous, updated)) {
      const request = buildNotificationRequest(previous, updated, "dispatch");
      if (request) await sendMaterialDispatchNotification(request, "dispatch");
    } else if (shouldNotifyInProcess(previous, updated)) {
      const request = buildNotificationRequest(previous, updated, "process");
      if (request) await sendMaterialDispatchNotification(request, "process");
    }
  } catch (err) {
    console.error("Material request status notification error:", err?.message || err);
  }
}

router.get("/public/delivery/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ error: "Missing token" });
    const record = await MaterialRequestBuilder.findOne({ deliveryUpdateToken: token }).lean();
    if (!record) return res.status(404).json({ error: "Invalid or expired link" });
    if (!isDeliveryUpdateTokenValid(record)) return res.status(410).json({ error: "This delivery link has expired" });
    res.json(buildPublicDeliverySnapshot(record));
  } catch (err) {
    res.status(500).json({ error: "Unable to load delivery update data" });
  }
});

router.post("/public/delivery/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ error: "Missing token" });

    const existing = await MaterialRequestBuilder.findOne({ deliveryUpdateToken: token });
    if (!existing) return res.status(404).json({ error: "Invalid or expired link" });
    if (!isDeliveryUpdateTokenValid(existing)) return res.status(410).json({ error: "This delivery link has expired" });

    const deliveryDate = String(req.body?.deliveryDate || req.body?.materialReceivedDate || "").trim();
    const deliveryStatus = normalizeDeliveryStatus(req.body?.deliveryStatus || existing.deliveryStatus || "Delivered");
    if (!deliveryDate) {
      return res.status(400).json({ error: "Delivery date is required" });
    }

    const updateFields = {
      ...applyDeliveryUpdateToRecord(existing.toObject(), {
        deliveryDate,
        deliveryStatus,
        remarks: String(req.body?.remarks || "").trim(),
      }),
      deliveryUpdateSubmittedAt: new Date(),
      deliveryUpdateSubmittedBy: String(req.body?.submittedBy || req.body?.submittedByName || "").trim(),
    };

    const updated = await MaterialRequestBuilder.findByIdAndUpdate(existing._id, updateFields, { new: true });
    const updatedRecord = updated?.toObject ? updated.toObject() : updated;
    const notificationType = normalizeStatusLabel(updateFields.deliveryStatus) === "In Transit" ? "transit" : "delivered";
    let mailResult = { ok: false, skipped: true };
    try {
      mailResult = await sendMaterialDispatchNotification(updatedRecord, notificationType);
    } catch (mailErr) {
      console.error("Delivery update mail error:", mailErr?.message || mailErr);
    }

    res.json({
      success: true,
      message: "Delivery details updated successfully",
      data: buildPublicDeliverySnapshot(updatedRecord),
      mailSent: Boolean(mailResult?.ok),
    });
  } catch (err) {
    res.status(500).json({ error: "Unable to update delivery details" });
  }
});

router.get("/", verifyToken, async (req, res) => {
  try {
    const data = await MaterialRequestBuilder.find(scopeByEngineer(req.user, "engineer")).sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch material requests" });
  }
});

router.post("/", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Only admin can create material requests" });
    }
    const payload = normalizePayload(req.body, req);
    const created = await MaterialRequestBuilder.create(payload);
    const createdRecord = created.toObject ? created.toObject() : created;
    const hydratedRecord = isTransitRequest(createdRecord) ? await ensureTransitDeliveryLink(createdRecord, req) : createdRecord;
    await triggerMaterialRequestCreateNotifications(hydratedRecord);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: "Failed to create material request" });
  }
});

router.put("/:id", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Only admin can update material requests" });
    }
    const existing = await MaterialRequestBuilder.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Material request not found" });
    const payload = normalizePayload({ ...existing.toObject(), ...req.body, createdByUsername: existing.createdByUsername, createdByName: existing.createdByName }, req);
    const updated = await MaterialRequestBuilder.findByIdAndUpdate(req.params.id, payload, { new: true });
    const updatedRecord = updated?.toObject ? updated.toObject() : updated;
    const hydratedRecord = isTransitRequest(updatedRecord) ? await ensureTransitDeliveryLink(updatedRecord, req) : updatedRecord;
    await triggerMaterialRequestUpdateNotifications(existing.toObject(), hydratedRecord);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: "Failed to update material request" });
  }
});

router.delete("/:id", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Only admin can delete material requests" });
    }
    await MaterialRequestBuilder.findByIdAndDelete(req.params.id);
    res.json({ message: "Material request deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete material request" });
  }
});

module.exports = router;
