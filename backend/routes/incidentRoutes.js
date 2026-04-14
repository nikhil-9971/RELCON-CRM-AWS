const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Incident = require("../models/Incident"); // Mongoose model

// ========== 1. BULK IMPORT INCIDENT ========== //
// incidentRoutes.js
router.post("/bulkImportIncident", async (req, res) => {
  try {
    const { incidents } = req.body;
    if (!Array.isArray(incidents) || incidents.length === 0) {
      return res.status(400).json({ error: "No data to import" });
    }

    for (const inc of incidents) {
      await Incident.findOneAndUpdate(
        { incidentId: inc.incidentId }, // match by Incident ID
        { $set: inc }, // update if exists
        { upsert: true } // insert if not exist
      );
    }

    res.json({
      success: true,
      message: "Incidents imported/updated successfully",
    });
  } catch (err) {
    console.error("Bulk import error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 2. UPDATE INCIDENT STATUS ========== //
// ========== 2. UPDATE INCIDENT STATUS ========== //
router.put("/updateIncidentStatus", async (req, res) => {
  try {
    const {
      incidentId,
      status,
      assignEngineer,
      closeRemark,
      incidentcloseDate,
    } = req.body;

    if (!incidentId) {
      return res.status(400).json({ error: "Missing incidentId" });
    }

    // Always include fields, even if empty
    const updateFields = {
      status,
      assignEngineer,
      closeRemark,
      incidentcloseDate,
    };

    const updated = await Incident.findOneAndUpdate(
      { incidentId },
      { $set: updateFields },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Incident ID not found" });
    }

    res.json({ success: true, updated });
  } catch (err) {
    console.error("Incident update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== 3. GET ALL INCIDENTS ========== //
router.get("/getAllIncidents", async (req, res) => {
  try {
    const incidents = await Incident.find().sort({ incidentDate: -1 });
    res.json({ success: true, incidents });
  } catch (err) {
    console.error("Fetch error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Alias for DB Explorer
router.get("/getIncidents", async (req, res) => {
  try {
    const incidents = await Incident.find().sort({ incidentDate: -1 });
    res.json(incidents); // DB Explorer expects an array
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ New route to fetch incidents by RO Code and Status
router.get("/getIncidentsByRoCodeAndStatus", async (req, res) => {
  const { roCode, status } = req.query;

  if (!roCode || !status) {
    return res
      .status(400)
      .json({ success: false, error: "RO Code and status are required." });
  }

  try {
    const incidents = await Incident.find({
      roCode: roCode.trim(),
      status: status.trim(),
    }).select("roCode siteName region incidentId status");

    res.json({ success: true, incidents });
  } catch (err) {
    console.error("Query error:", err.message);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ========== 5. DELETE INCIDENT (BY OBJECT ID - FOR DB EXPLORER) ==========
router.delete("/deleteIncident/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      // Fallback to legacy incidentId string if not a valid Mongo ID
      const deleted = await Incident.findOneAndDelete({ incidentId: id });
      if (!deleted) return res.status(404).json({ success: false, message: "Incident not found" });
      return res.json({ success: true, message: "Incident deleted" });
    }

    const deleted = await Incident.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Incident not found" });

    res.json({ success: true, message: "Incident deleted successfully" });
  } catch (err) {
    console.error("Delete error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 6. UPDATE INCIDENT (BY OBJECT ID - FOR DB EXPLORER) ==========
router.put("/updateIncident/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid ID" });
    }
    const updated = await Incident.findByIdAndUpdate(id, req.body, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Incident not found" });
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 7. Incident add ==========

router.post("/addIncident", async (req, res) => {
  try {
    const incident = new Incident(req.body); // ✅ Correct model name
    await incident.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Add incident error:", err.message);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
