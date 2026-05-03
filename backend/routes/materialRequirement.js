const express = require("express");
const router = express.Router();
const MaterialRequirement = require("../models/MaterialRequirement");

function normalizePayload(body = {}) {
  const lineItems = Array.isArray(body.lineItems)
    ? body.lineItems
        .map((item) => ({
          materialName: String(item?.materialName || "").trim(),
          materialType: String(item?.materialType || "").trim(),
          requestType: String(item?.requestType || "").trim(),
          quantity: Number(item?.quantity || 0) || 0,
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

  const fallbackMaterial = String(body.material || "").trim();
  const materialSummary = String(body.materialSummary || fallbackMaterial).trim();
  const primaryItem = lineItems[0] || {};

  return {
    ...body,
    engineer: String(body.engineer || "").trim(),
    engineerCode: String(body.engineerCode || "").trim(),
    engineerContactNumber: String(body.engineerContactNumber || "").trim(),
    engineerEmailId: String(body.engineerEmailId || "").trim(),
    region: String(body.region || "").trim(),
    roCode: String(body.roCode || "").trim(),
    roName: String(body.roName || "").trim(),
    phase: String(body.phase || "").trim(),
    date: String(body.date || "").trim(),
    customer: String(body.customer || "").trim(),
    material: fallbackMaterial || primaryItem.materialName || "",
    materialSummary,
    materialType: String(body.materialType || primaryItem.materialType || "").trim(),
    materialRequirementType: String(body.materialRequirementType || primaryItem.requestType || "").trim(),
    quantity: Number(body.quantity || primaryItem.quantity || 0) || 0,
    materialDispatchStatus: String(body.materialDispatchStatus || primaryItem.materialStatus || "").trim(),
    materialRequestTo: String(body.materialRequestTo || "").trim(),
    materialRequestFromEmail: String(body.materialRequestFromEmail || "").trim(),
    materialRequestDate: String(body.materialRequestDate || "").trim(),
    materialUsedIn: String(body.materialUsedIn || "").trim(),
    materialArrangeFrom: String(body.materialArrangeFrom || primaryItem.dispatchCourier || "").trim(),
    challanNumber: String(body.challanNumber || primaryItem.challanNumber || "").trim(),
    challanCreationDate: String(body.challanCreationDate || primaryItem.challanCreationDate || "").trim(),
    docketNumber: String(body.docketNumber || primaryItem.docketNumber || "").trim(),
    dispatchDate: String(body.dispatchDate || primaryItem.dispatchDate || "").trim(),
    deliveryStatus: String(body.deliveryStatus || primaryItem.deliveryStatus || "").trim(),
    materialReceivedDate: String(body.materialReceivedDate || primaryItem.deliveryDate || "").trim(),
    poNumber: String(body.poNumber || primaryItem.poNumber || "").trim(),
    poDate: String(body.poDate || primaryItem.poDate || "").trim(),
    sourceRecordId: String(body.sourceRecordId || "").trim(),
    sourceType: String(body.sourceType || "").trim(),
    remarks: String(body.remarks || "").trim(),
    lineItems,
  };
}

// 🔹 GET all
router.get("/", async (req, res) => {
  try {
    const data = await MaterialRequirement.find().sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
});

// 🔹 POST new
// 🔹 POST new (overwrite if same engineer + roCode + date exists)
router.post("/", async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const { engineer, roCode, date } = payload;

    // check if entry already exists for this engineer + roCode + date
    const existing = await MaterialRequirement.findOne({
      engineer,
      roCode,
      date,
    });

    if (existing) {
      const updated = await MaterialRequirement.findByIdAndUpdate(
        existing._id,
        payload,
        { new: true }
      );
      return res.json(updated);
    }

    // else insert new
    const newItem = new MaterialRequirement(payload);
    await newItem.save();
    res.json(newItem);
  } catch (err) {
    res.status(400).json({ error: "Failed to save item" });
  }
});

// 🔹 PUT update
router.put("/:id", async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const updated = await MaterialRequirement.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: "Update failed" });
  }
});

// 🔹 DELETE
router.delete("/:id", async (req, res) => {
  try {
    await MaterialRequirement.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

module.exports = router;
