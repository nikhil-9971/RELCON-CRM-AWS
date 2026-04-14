const express = require("express");
const router = express.Router();
const MaterialRequirement = require("../models/MaterialRequirement");

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
    const { engineer, roCode, date } = req.body;

    // check if entry already exists for this engineer + roCode + date
    const existing = await MaterialRequirement.findOne({
      engineer,
      roCode,
      date,
    });

    if (existing) {
      const updated = await MaterialRequirement.findByIdAndUpdate(
        existing._id,
        req.body,
        { new: true }
      );
      return res.json(updated);
    }

    // else insert new
    const newItem = new MaterialRequirement(req.body);
    await newItem.save();
    res.json(newItem);
  } catch (err) {
    res.status(400).json({ error: "Failed to save item" });
  }
});

// 🔹 PUT update
router.put("/:id", async (req, res) => {
  try {
    const updated = await MaterialRequirement.findByIdAndUpdate(
      req.params.id,
      req.body,
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
