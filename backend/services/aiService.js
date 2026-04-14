const Groq = require("groq-sdk");
const mongoose = require("mongoose");

// Models Import (Sahi paths ensure karein)
const DailyPlan = require("../models/DailyPlan");
const Incident = require("../models/Incident");
const Status = require("../models/Status");
const BPCLStatus = require("../models/BPCLStatus");
const JioBPStatus = require("../models/jioBPStatus");
const Task = require("../models/Task");
const MaterialRequirement = require("../models/MaterialRequirement");

// Model Map (Taaki case-sensitive error na aaye)
const modelMap = {
  Status: Status,
  DailyPlan: DailyPlan,
  Incident: Incident,
  BPCLStatus: BPCLStatus,
  JioBPStatus: JioBPStatus,
  Task: Task,
  MaterialRequirement: MaterialRequirement,
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function handleAIQuery(question) {
  try {
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-GB").replace(/\//g, "-");

    const architectCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are the Lead Data Engineer at RELCON. Today: ${todayStr}.
          
          COLLECTION NAMES:
          - HPCL Spares: 'Status' (field: spareUsed)
          - JioBP Spares: 'JioBPStatus' (field: usedMaterialDetails)
          - BPCL Spares: 'BPCLStatus' (fields: class1Devices, relconAtgDetails)
          - Plans/ROs/Engineers: 'DailyPlan'
          
          SEARCH RULES:
          1. If searching for codes (5ER..., J0K..., 1-RF...), ALWAYS use {"$regex": "code_without_special_chars", "$options": "i"}.
          2. IMPORTANT: To get RO Name or Engineer Name from a Status/Spare search, you MUST use $lookup:
             { "$lookup": { "from": "dailyplans", "localField": "planId", "foreignField": "_id", "as": "planDetails" } }
          3. Collection names must be exactly: "Status", "DailyPlan", "Incident", "BPCLStatus", or "JioBPStatus".

          STRICT RESPONSE: Respond ONLY with JSON {"collection": "ExactModelName", "pipeline": [...]}.`,
        },
        { role: "user", content: question },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const strategy = JSON.parse(architectCompletion.choices[0].message.content);

    // Fix: Use the Map instead of mongoose.model() to avoid Schema errors
    const Model = modelMap[strategy.collection];

    if (!Model) {
      console.error("Model Not Found in Map:", strategy.collection);
      return "System configuration error: Model mapping failed.";
    }

    // Execute Data Fetching
    const rawData = await Model.aggregate(strategy.pipeline).limit(10);

    const communicatorCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a helpful RELCON Business Assistant. 
          - If data contains 'planDetails', use it to mention RO Name, RO Code, and Engineer.
          - If no data [], explain exactly what was searched.
          - Use a mix of Hindi and English.`,
        },
        {
          role: "user",
          content: `Question: ${question} \nData: ${JSON.stringify(rawData)}`,
        },
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.3,
    });

    return communicatorCompletion.choices[0].message.content.trim();
  } catch (error) {
    console.error("CRITICAL_AI_ERROR:", error);
    return "Maaf kijiye, database access karne mein error aaya. Kripya check karein ki query sahi hai.";
  }
}

module.exports = { handleAIQuery };
