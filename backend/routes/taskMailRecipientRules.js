const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { isAdminUser } = require("../utils/accessScope");
const TaskMailRecipientRule = require("../models/TaskMailRecipientRule");

function regionKey(value = "") {
  return String(value).trim().toUpperCase().replace(/\s+/g, " ");
}

function regionKeys(value = "") {
  return [...new Set(String(value).split("|").map(regionKey).filter(Boolean))];
}

function emailList(value = "") {
  return [...new Set(String(value)
    .split(/[;,\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))].join(", ");
}

function validateEmails(value, field) {
  const invalid = emailList(value).split(", ").filter((email) => email && !/^\S+@\S+\.\S+$/.test(email));
  if (invalid.length) throw new Error(`Invalid ${field} email: ${invalid[0]}`);
}

router.get("/taskMailRecipientRules", authMiddleware, async (_req, res) => {
  try {
    const rules = await TaskMailRecipientRule.find().sort({ region: 1 }).lean();
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch task mail recipient rules." });
  }
});

router.post("/taskMailRecipientRules", authMiddleware, async (req, res) => {
  try {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Only administrators can manage region mail recipients." });
    const region = String(req.body.region || "").trim();
    const keys = regionKeys(region);
    const toEmails = emailList(req.body.toEmails);
    const ccEmails = emailList(req.body.ccEmails);
    if (!keys.length || !toEmails) return res.status(400).json({ error: "Region and To email are required." });
    validateEmails(toEmails, "To");
    validateEmails(ccEmails, "CC");

    const rule = await TaskMailRecipientRule.findOneAndUpdate(
      { regionKey: keys[0] },
      { region, regionKey: keys[0], regionKeys: keys, toEmails, ccEmails, updatedBy: req.user?.username || "admin" },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.status(201).json(rule);
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to save task mail recipient rule." });
  }
});

router.delete("/taskMailRecipientRules/:id", authMiddleware, async (req, res) => {
  try {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Only administrators can manage region mail recipients." });
    const rule = await TaskMailRecipientRule.findByIdAndDelete(req.params.id);
    if (!rule) return res.status(404).json({ error: "Region mail recipient rule not found." });
    res.json({ message: "Region mail recipient rule deleted." });
  } catch (error) {
    res.status(400).json({ error: "Failed to delete task mail recipient rule." });
  }
});

module.exports = router;
