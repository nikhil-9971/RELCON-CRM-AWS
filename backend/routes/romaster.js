const express = require("express");
const router = express.Router();
const ROMaster = require("../models/ROMaster");
const DailyPlan = require("../models/DailyPlan");
const {
  clearCacheByPrefix,
  getOrSetCache,
  makeCacheKey,
  sendCachedJson,
} = require("../utils/cache");

const RO_CACHE_TTL_MS = 5 * 60 * 1000;

function clearROCache() {
  clearCacheByPrefix("romaster:");
}

router.get("/getROInfo/:roCode", async (req, res) => {
  try {
    const roCode = req.params.roCode.toUpperCase();
    const result = await getOrSetCache(makeCacheKey("romaster:info", { roCode }), RO_CACHE_TTL_MS, () =>
      ROMaster.findOne({ roCode }).lean()
    );
    const data = result.value;
    if (!data) return res.status(404).json({ error: "RO Code not found" });
    sendCachedJson(res, result);
  } catch (err) {
    res.status(500).send("Server error");
  }
});

router.post("/add", async (req, res) => {
  try {
    const {
      zone,
      roCode,
      roName,
      region,
      phase,
      engineer,
      amcQtr,
      siteStatus,
    } = req.body;

    if (
      !zone ||
      !roCode ||
      !roName ||
      !region ||
      !phase ||
      !engineer ||
      !amcQtr ||
      !siteStatus
    ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existing = await ROMaster.findOne({
      roCode: roCode.toUpperCase().trim(),
    });
    if (existing) {
      return res.status(400).json({ message: "RO Code already exists" });
    }

    const newEntry = new ROMaster({
      zone,
      roCode: roCode.toUpperCase(),
      roName,
      region,
      phase,
      engineer,
      amcQtr,
      siteStatus,
    });

    await newEntry.save();
    clearROCache();
    //     res.status(200).json({ message: "Site added successfully" });
    //   } catch (err) {
    //     console.error("Error saving new site:", err);
    //     res.status(500).json({ message: "Server error" });
    //   }
    // });

    res
      .status(200)
      .json({ message: "Site added successfully", data: newEntry });
  } catch (err) {
    console.error("Error saving new site:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* List all RO Master records */
router.get("/list", async (req, res) => {
  try {
    const result = await getOrSetCache("romaster:list", RO_CACHE_TTL_MS, () =>
      ROMaster.find({}).sort({ roCode: 1 }).lean()
    );
    sendCachedJson(res, result);
  } catch (err) {
    console.error("Error fetching ROMaster list:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* Alias for list (some frontends try /all) */
router.get("/all", async (req, res) => {
  try {
    const result = await getOrSetCache("romaster:all", RO_CACHE_TTL_MS, () =>
      ROMaster.find({}).sort({ roCode: 1 }).lean()
    );
    sendCachedJson(res, result);
  } catch (err) {
    console.error("Error fetching ROMaster all:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* Get single record by id */
router.get("/get/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const data = await ROMaster.findById(id);
    if (!data) return res.status(404).json({ error: "Record not found" });
    res.json(data);
  } catch (err) {
    console.error("Error fetching ROMaster by id:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* Update record by id */
router.put("/update/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updateFields = {};

    // Only allow certain fields to be updated
    const allowed = [
      "zone",
      "roCode",
      "roName",
      "region",
      "phase",
      "engineer",
      "amcQtr",
      "siteStatus",
      "siteActivestatus",
      "lastAMCqtr",
    ];

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        updateFields[key] =
          key === "roCode" && typeof req.body[key] === "string"
            ? req.body[key].toUpperCase()
            : req.body[key];
      }
    });

    const updated = await ROMaster.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Record not found" });
    clearROCache();
    res.json({ message: "Updated successfully", data: updated });
  } catch (err) {
    console.error("Error updating ROMaster:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* Delete record by id */
router.delete("/delete/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await ROMaster.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Record not found" });
    clearROCache();
    res.json({ message: "Deleted successfully", data: deleted });
  } catch (err) {
    console.error("Error deleting ROMaster:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// New endpoint for AMC Count Status
router.get("/amcCountStatus", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ error: "Start date and end date are required" });
    }

    const result = await getOrSetCache(makeCacheKey("romaster:amc-count-status", { startDate, endDate }), RO_CACHE_TTL_MS, async () => {
      // Get only RO Master entries with siteStatus = "AMC"
      const roMasterData = await ROMaster.find({ siteStatus: "AMC" }).lean();

      // Get all daily plans within the date range
      const dailyPlans = await DailyPlan.find({
        date: {
          $gte: startDate,
          $lte: endDate,
        },
        issueType: {
          $in: ["Issue & PM Visit", "PM Visit", "ATG & PM Visit"],
        },
      }).lean();

      // Create a map to track completed AMC visits by RO Code
      const completedAMCVisits = new Map();
      dailyPlans.forEach((plan) => {
        const roCode = plan.roCode;
        if (!completedAMCVisits.has(roCode)) {
          completedAMCVisits.set(roCode, []);
        }
        completedAMCVisits.get(roCode).push(plan);
      });

      // Group by engineer
      const engineerStats = new Map();
      const detailedData = []; // For CSV export

      const isInactiveSite = (value = "") =>
        String(value || "").trim().toLowerCase() === "inactive";

      roMasterData.forEach((ro) => {
        const engineer = ro.engineer || "Unknown";
        const roCode = ro.roCode;
        const roName = ro.roName;
        const region = ro.region;
        const phase = ro.phase;
        const siteActivestatus = ro.siteActivestatus;

        if (!engineerStats.has(engineer)) {
          engineerStats.set(engineer, {
            engineerName: engineer,
            totalAMCAssigned: 0,
            totalAMCCompleted: 0,
            pendingAMC: 0,
            inactiveSiteCount: 0,
          });
        }

        const stats = engineerStats.get(engineer);
        stats.totalAMCAssigned++;
        if (isInactiveSite(siteActivestatus)) {
          stats.inactiveSiteCount++;
        }

        // Check if this RO has completed AMC visits
        const hasCompletedAMC = completedAMCVisits.has(roCode);
        if (hasCompletedAMC) {
          stats.totalAMCCompleted++;
        } else {
          stats.pendingAMC++;
        }

        // Add detailed data for CSV export
        const latestVisit = hasCompletedAMC
          ? completedAMCVisits
              .get(roCode)
              .reduce((latest, plan) =>
                new Date(plan.date) > new Date(latest.date) ? plan : latest
              )
          : null;

        detailedData.push({
          engineerName: engineer,
          roCode: roCode,
          roName: roName,
          region: region,
          phase: phase,
          purpose: hasCompletedAMC ? latestVisit.purpose : "-",
          amcStatus: hasCompletedAMC ? "Completed" : "Pending",
          visitDate: hasCompletedAMC ? latestVisit.date : "-",
          amcQtr: hasCompletedAMC ? ro.amcQtr : "-",
          issueType: hasCompletedAMC ? latestVisit.issueType : "-",
          siteActivestatus: siteActivestatus,
        });
      });

      const data = Array.from(engineerStats.values());

      return {
        success: true,
        data,
        detailedData: detailedData,
        summary: {
          totalSites: roMasterData.length,
          totalCompleted: data.reduce(
            (sum, stat) => sum + stat.totalAMCCompleted,
            0
          ),
          totalPending: data.reduce((sum, stat) => sum + stat.pendingAMC, 0),
          totalInactiveSites: data.reduce(
            (sum, stat) => sum + stat.inactiveSiteCount,
            0
          ),
        },
      };
    });
    sendCachedJson(res, result);
  } catch (err) {
    console.error("Error in AMC count status:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
