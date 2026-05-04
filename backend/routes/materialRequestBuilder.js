const express = require("express");
const router = express.Router();
const MaterialRequestBuilder = require("../models/MaterialRequestBuilder");
const verifyToken = require("../middleware/authMiddleware");
const {
  sendMaterialRequestNotification,
  sendMaterialDispatchNotification,
  normalizeStatusLabel,
} = require("../services/mailer");

function isAdmin(req) {
  return String(req.user?.role || "").toLowerCase() === "admin";
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

  return {
    engineer: String(body.engineer || "").trim(),
    engineerCode: String(body.engineerCode || "").trim(),
    engineerContactNumber: String(body.engineerContactNumber || "").trim(),
    engineerEmailId: String(body.engineerEmailId || "").trim(),
    region: String(body.region || "").trim(),
    customer: String(body.customer || "").trim(),
    roCode: String(body.roCode || "").trim(),
    roName: String(body.roName || "").trim(),
    phase: String(body.phase || "").trim(),
    date: String(body.date || "").trim(),
    materialUsedIn: String(body.materialUsedIn || "").trim(),
    materialRequestTo: String(body.materialRequestTo || "").trim(),
    materialRequestFromEmail: String(body.materialRequestFromEmail || "").trim(),
    materialRequestDate: String(body.materialRequestDate || "").trim(),
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

async function triggerMaterialRequestCreateNotifications(created) {
  try {
    await sendMaterialRequestNotification(created);
  } catch (err) {
    console.error("Material request HQO notification error:", err?.message || err);
  }
}

function shouldNotifyDispatch(previous = {}, next = {}) {
  const before = normalizeStatusLabel(previous.materialDispatchStatus);
  const after = normalizeStatusLabel(next.materialDispatchStatus);
  return before !== "dispatched" && after === "dispatched";
}

function shouldNotifyDelivered(previous = {}, next = {}) {
  const beforeDispatch = normalizeStatusLabel(previous.materialDispatchStatus);
  const afterDispatch = normalizeStatusLabel(next.materialDispatchStatus);
  const beforeDelivery = normalizeStatusLabel(previous.deliveryStatus);
  const afterDelivery = normalizeStatusLabel(next.deliveryStatus);
  return (beforeDispatch !== "delivered" && afterDispatch === "delivered")
    || (beforeDelivery !== "delivered" && afterDelivery === "delivered");
}

async function triggerMaterialRequestUpdateNotifications(previous, updated) {
  try {
    if (shouldNotifyDispatch(previous, updated)) {
      await sendMaterialDispatchNotification(updated, "dispatch");
    }
    if (shouldNotifyDelivered(previous, updated)) {
      await sendMaterialDispatchNotification(updated, "delivered");
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
