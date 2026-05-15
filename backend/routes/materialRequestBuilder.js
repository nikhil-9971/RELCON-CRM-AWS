const express = require("express");
const router = express.Router();
const MaterialRequestBuilder = require("../models/MaterialRequestBuilder");
const verifyToken = require("../middleware/authMiddleware");
const {
  sendMaterialRequestNotification,
  sendMaterialDispatchNotification,
  normalizeStatusLabel,
  isRequirementGivenToHQOStatus,
} = require("../services/mailer");

function isAdmin(req) {
  return String(req.user?.role || "").toLowerCase() === "admin";
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
    createdByName: String(body.createdByName || req.user?.engineerName || req.user?.username || "").trim(),
    updatedByUsername: String(req.user?.username || "").trim(),
    updatedByName: String(req.user?.engineerName || req.user?.username || "").trim(),
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

router.get("/", verifyToken, async (req, res) => {
  try {
    const data = await MaterialRequestBuilder.find().sort({ createdAt: -1 });
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
    await triggerMaterialRequestCreateNotifications(created.toObject ? created.toObject() : created);
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
    await triggerMaterialRequestUpdateNotifications(existing.toObject(), updated?.toObject ? updated.toObject() : updated);
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
