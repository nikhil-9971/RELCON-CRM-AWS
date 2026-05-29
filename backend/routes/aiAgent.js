const express = require("express");
const router = express.Router();
const { handleAIQuery } = require("../services/aiService");
const verifyToken = require("../middleware/authMiddleware");

router.post("/ask", verifyToken, async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ reply: "Question missing" });
    }

    const reply = await handleAIQuery(question);

    res.json({ reply });
  } catch (err) {
    console.error("AI ERROR:", err);
    res.status(500).json({
      reply: "⚠ AI backend error. Please try again.",
    });
  }
});

module.exports = router;
