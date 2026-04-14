const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const ATGStatus = require("../models/atgStatus");
const DailyPlan = require("../models/DailyPlan");

// Save or update ATG Status
router.post("/saveATGStatus", async (req, res) => {
  try {
    const { planId } = req.body;

    await ATGStatus.findOneAndUpdate(
      { planId },
      { ...req.body },
      { upsert: true, new: true }
    );

    res.send("ATG status saved");
  } catch (err) {
    res.status(500).send("Server error: " + err.message);
  }
});

// Get merged ATG records with plan data
router.get("/getMergedATGStatus", async (req, res) => {
  try {
    const atgRecords = await ATGStatus.find().populate("planId");

    const merged = atgRecords.map((record) => {
      const plan = record.planId || {};
      const atg = record || {};

      return {
        _id: atg._id?.toString() || "",
        planId: plan._id?.toString() || "",
        engineer: plan.engineer || "",
        region: plan.region || "",
        phase: plan.phase || "",
        roCode: plan.roCode || "",
        roName: plan.roName || "",
        date: plan.date || "",
        amcQtr: plan.amcQtr || "",
        purpose: plan.purpose || "",
        zone: atg.zone || "",
        atgIssuetype: atg.atgIssuetype || "",
        startTime: atg.startTime || "",
        bfrStatus: atg.bfrStatus || "",
        actionSite: atg.actionSite || "",
        supportPerson: atg.supportPerson || "",
        earthingStatus1: atg.earthingStatus1 || "",
        resolvedStatus: atg.resolvedStatus || "",
        endTime: atg.endTime || "",
        nextAction: atg.nextAction || "",
        remark: atg.remark || "",
        createdAt: atg.createdAt || "",
      };
    });

    res.json(merged);
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).send("Server error: " + err.message);
  }
});

// Update ATG status by _id
router.put("/updateATGStatus/:id", async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).send("Invalid ObjectId");
  }

  try {
    const updated = await ATGStatus.findByIdAndUpdate(id, req.body, {
      new: true,
    });
    if (!updated) return res.status(404).send("ATG status not found");

    res.send("ATG status updated");
  } catch (err) {
    res.status(500).send("Update error: " + err.message);
  }
});

// Delete ATG status by _id
router.delete("/deleteATGStatus/:id", async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).send("Invalid ObjectId");
  }

  try {
    const deleted = await ATGStatus.findByIdAndDelete(id);
    if (!deleted) return res.status(404).send("ATG status not found");

    res.send("ATG status deleted");
  } catch (err) {
    res.status(500).send("Delete error: " + err.message);
  }
});

router.get("/checkATGStatus/:planId", async (req, res) => {
  const { planId } = req.params;
  try {
    const exists = await ATGStatus.exists({ planId });
    res.json({ exists: !!exists });
  } catch (err) {
    res.status(500).send("Error checking ATG status");
  }
});

module.exports = router;
