const express = require("express");
const router = express.Router();
const MaterialRequestMasterItem = require("../models/MaterialRequestMasterItem");
const verifyToken = require("../middleware/authMiddleware");

function isAdmin(req) {
  return String(req.user?.role || "").toLowerCase() === "admin";
}

function actor(req) {
  return String(req.user?.engineerName || req.user?.username || "System").trim();
}

router.get("/", verifyToken, async (req, res) => {
  try {
    const items = await MaterialRequestMasterItem.find({ isActive: true }).sort({
      materialType: 1,
      materialName: 1,
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch material master items" });
  }
});

router.post("/", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Only admin can add material master items" });
    }
    const materialName = String(req.body?.materialName || "").trim();
    const materialType = String(req.body?.materialType || "").trim();
    if (!materialName || !materialType) {
      return res.status(400).json({ error: "Material name and type are required" });
    }
    const created = await MaterialRequestMasterItem.create({
      materialName,
      materialType,
      createdBy: actor(req),
      updatedBy: actor(req),
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: "Failed to add material master item" });
  }
});

router.put("/:id", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Only admin can update material master items" });
    }
    const updates = {};
    if (req.body?.materialName !== undefined) updates.materialName = String(req.body.materialName).trim();
    if (req.body?.materialType !== undefined) updates.materialType = String(req.body.materialType).trim();
    updates.updatedBy = actor(req);
    const updated = await MaterialRequestMasterItem.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!updated) return res.status(404).json({ error: "Material master item not found" });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: "Failed to update material master item" });
  }
});

router.delete("/:id", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Only admin can delete material master items" });
    }
    const deleted = await MaterialRequestMasterItem.findByIdAndUpdate(
      req.params.id,
      { isActive: false, updatedBy: actor(req) },
      { new: true }
    );
    if (!deleted) return res.status(404).json({ error: "Material master item not found" });
    res.json({ message: "Material master item deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete material master item" });
  }
});

router.post("/seed-defaults", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Only admin can seed material master items" });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "No default items supplied" });

    const existingCount = await MaterialRequestMasterItem.countDocuments({ isActive: true });
    if (existingCount > 0) {
      return res.json({ message: "Material master already exists", seeded: 0 });
    }

    const docs = items
      .map((item) => ({
        materialName: String(item?.name || item?.materialName || "").trim(),
        materialType: String(item?.type || item?.materialType || "").trim(),
        createdBy: actor(req),
        updatedBy: actor(req),
      }))
      .filter((item) => item.materialName && item.materialType);

    if (!docs.length) {
      return res.status(400).json({ error: "No valid default items supplied" });
    }

    await MaterialRequestMasterItem.insertMany(docs, { ordered: false });
    res.json({ message: "Default material master seeded successfully", seeded: docs.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to seed material master items" });
  }
});

module.exports = router;
