const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const JioBPStatus = require("../models/jioBPStatus");
const DailyPlan = require("../models/DailyPlan");
const authMiddleware = require("../middleware/authMiddleware");

// ✅ SAVE or UPDATE Jio BP Status
router.post("/saveJioBPStatus", authMiddleware, async (req, res) => {
  try {
    const { planId } = req.body;
    let savedStatus;

    const existing = await JioBPStatus.findOne({ planId });
    if (existing) {
      Object.assign(existing, req.body);
      savedStatus = await existing.save();
    } else {
      const newStatus = new JioBPStatus({
        ...req.body,
        createdBy: req.user?.username || "unknown",
      });
      savedStatus = await newStatus.save();
    }

    await DailyPlan.findByIdAndUpdate(planId, {
      jioBPStatusSaved: true,
      statusSaved: true,
    });

    const updatedPlan = await DailyPlan.findById(planId);

    res.status(200).json({
      success: true,
      message: "✅ Jio BP status saved successfully",
      status: savedStatus,
      plan: updatedPlan,
    });
  } catch (err) {
    console.error("❌ Error saving Jio BP status:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ GET Jio BP Status by Plan ID
router.get(
  "/getJioBPStatusByPlan/:planId",
  authMiddleware,
  async (req, res) => {
    try {
      const status = await JioBPStatus.findOne({ planId: req.params.planId });
      if (!status) {
        return res
          .status(404)
          .json({ success: false, message: "Status not found" });
      }
      res.status(200).json(status);
    } catch (err) {
      console.error("❌ Error fetching Jio BP status:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// ✅ GET All Jio BP Status with Role-Based Access
router.get("/getAllJioBPStatus", authMiddleware, async (req, res) => {
  try {
    // 🔓 No role-based restriction here — frontend will filter
    const statuses = await JioBPStatus.find({}).populate("planId");
    res.status(200).json(statuses);
  } catch (err) {
    console.error("❌ Error fetching Jio BP statuses:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ UPDATE Jio BP Status by ID
// ⬅️ make sure this is imported

router.put("/updateJioBPStatus/:id", authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;

    // ✅ Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid ObjectId format." });
    }

    if (typeof req.body.planId === "object" && req.body.planId._id) {
      req.body.planId = req.body.planId._id;
    }

    const oldData = await JioBPStatus.findById(id);
    if (!oldData) {
      return res
        .status(404)
        .json({ success: false, message: "Record not found" });
    }

    if (oldData.isVerified && req.user?.username !== "nikhil.trivedi") {
      return res.status(403).json({
        success: false,
        message: "Verified records can only be updated by Nikhil.",
      });
    }

    const allowedFields = [
      "engineer",
      "region",
      "roCode",
      "roName",
      "purpose",
      "date",
      "hpsdId",
      "diagnosis",
      "solution",
      "activeMaterialUsed",
      "usedMaterialDetails",
      "faultyMaterialDetails",
      "spareRequired",
      "observationHours",
      "materialRequirement",
      "relconsupport",
      "rbmlperson",
      "status",
      "planId",
      "createdBy",
      "isVerified",
      "oms03",
    ];

    const updateData = {};
    allowedFields.forEach((key) => {
      if (req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    });

    const updated = await JioBPStatus.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error("❌ Error updating Jio BP status:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// ✅ DELETE Jio BP Status by ID
router.delete("/deleteJioBPStatus/:id", authMiddleware, async (req, res) => {
  try {
    const deleted = await JioBPStatus.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    await DailyPlan.findByIdAndUpdate(deleted.planId, {
      jioBPStatusSaved: false,
      statusSaved: false,
    });

    res.status(200).json({ success: true, message: "Record deleted" });
  } catch (err) {
    console.error("❌ Error deleting Jio BP status:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ VERIFY endpoint
router.put("/verifyStatus/:id", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    console.log("🔍 VERIFY API: Requesting user", user);

    if (user.username !== "nikhil.trivedi" || user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const updated = await JioBPStatus.findByIdAndUpdate(
      req.params.id,
      { isVerified: true },
      { new: true }
    );
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Record not found" });
    }

    res
      .status(200)
      .json({ success: true, message: "Status verified", data: updated });
  } catch (err) {
    console.error("❌ Error verifying Jio BP status:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
