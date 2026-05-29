const Groq = require("groq-sdk");

const DailyPlan = require("../models/DailyPlan");
const Incident = require("../models/Incident");
const Status = require("../models/Status");
const BPCLStatus = require("../models/BPCLStatus");
const JioBPStatus = require("../models/jioBPStatus");
const Task = require("../models/Task");
const MaterialRequirement = require("../models/MaterialRequirement");
const ROMaster = require("../models/ROMaster");
const MaterialManagement = require("../models/MaterialManagement");

const modelMap = {
  DailyPlan,
  Incident,
  Status,
  BPCLStatus,
  JioBPStatus,
  Task,
  MaterialRequirement,
  ROMaster,
  MaterialManagement,
};

const COLLECTION_GUIDE = `
RELCON CRM DATABASE GUIDE

Core relationships:
- DailyPlan is the visit/plan master. Most status collections link by planId -> DailyPlan._id.
- For Status/JioBPStatus/BPCLStatus questions needing RO name, region, engineer, visit date, phase, use:
  { "$lookup": { "from": "dailyplans", "localField": "planId", "foreignField": "_id", "as": "planDetails" } },
  { "$unwind": { "path": "$planDetails", "preserveNullAndEmptyArrays": true } }

Collections and fields:
1. DailyPlan
   Fields: roCode, roName, zone, region, phase, date, issueType, engineer, empId, amcQtr, incidentId, purpose, completionStatus, arrivalTime, leaveTime, supportTakenFrom, whatDone, incidentStatus, separateearthingStatus, earthingCheckedby, detailEarthingremark, cableRequirmentremark, bpclStatusSaved, createdAt, updatedAt.
   Use for plans, visits, RO plan history, engineer schedule, phase/customer visit counts.

2. Status
   HPCL visit status. Fields: planId, createdAt, probeMake, probeSize, lowProductLock, highWaterSet, duSerialNumber, dgStatus, connectivityType, sim1Provider, sim1Number, sim2Provider, sim2Number, iemiNumber, bosVersion, fccVersion, wirelessSlave, sftpConfig, adminPassword, workCompletion, spareUsed, activeSpare, faultySpare, spareRequirment, spareRequirmentname, earthingStatus, voltageReading, duOffline, duDependency, duRemark, tankOffline, tankDependency, tankRemark, bosIP, fccIP, locationField, oms03, isVerified, taskGenerated, verificationEditLog.
   Use for HPCL status, HPCL spares, HPCL verification, earthing, DU/tank offline, OMS 03.

3. JioBPStatus
   RBML/JioBP status. Fields: planId, hpsdId, diagnosis, solution, activeMaterialUsed, usedMaterialDetails, faultyMaterialDetails, spareRequired, observationHours, materialRequirement, relconsupport, rbmlperson, status, createdBy, oms03, isVerified, verifiedBy, verifiedAt, verificationEditLog.
   Use for RBML/JioBP status, materials, requirements, verification.

4. BPCLStatus
   BPCL IOT status. Fields: planId, class1DeviceCount, class1Devices, class1WithoutSimCount, class1WithoutSimDevices, class2DeviceCount, class2Devices, relconAtgProvided, relconAtgCount, relconAtgDetails, jioSimNumber, airtelSimNumber, createdBy, isVerified, verifiedBy, verifiedAt, verificationEditLog.
   Use for BPCL IOT device details, class devices, RELCON ATG, SIM numbers, verification.

5. Incident
   Fields: roCode, siteName, region, incidentId, incidentDate, complaintRemark, assignEngineer, closeRemark, incidentcloseDate, status.
   Use for incidents/complaints, pending/close incident counts.

6. Task
   Fields: statusId, roCode, region, roName, date, engineer, customer, issue, issueType, priority, subject, emailContent, customerEmail, ccEmails, status, replyStatus, mailReply, mailDate, lastMailSentAt, lastMailSubject, nextFollowUpDate, closureSummary, completedBy, assignedTo, slaDays, escalatedAt, escalatedLevel, createdAt, earthingStatus, voltageReading, duOffline, duRemark, duDependency, tankOffline, tankRemark, tankDependency, followUpDates, mailHistory.
   Use for HPCL action tasks, pending/mailed/resolved tasks, assignee workload.

7. MaterialRequirement
   Fields: engineer, engineerCode, engineerContactNumber, engineerEmailId, region, roCode, roName, phase, date, customer, material, materialSummary, materialType, materialRequirementType, quantity, materialDispatchStatus, materialRequestTo, materialRequestFromEmail, materialRequestDate, materialUsedIn, materialArrangeFrom, challanNumber, challanCreationDate, docketNumber, dispatchDate, deliveryStatus, materialReceivedDate, poNumber, poDate, sourceRecordId, sourceType, lineItems, remarks.
   Use for material requirement, dispatch status, challan/docket, pending delivery.

8. ROMaster
   Fields: zone, roCode, roName, region, phase, engineer, amcQtr, siteStatus, connectivityType, bosIP, fccIP, siteActivestatus, lastAMCqtr.
   Use for RO master/site master lookup, assigned engineer, active site status.

9. MaterialManagement
   Fields: serialNumber, itemCode, itemName, qty, itemType, itemStatus, engineerName, customerName, remarks, uploadedBy, transferHistory, lastTransferredAt, isActive, createdAt, updatedAt.
   Use for inventory, active/faulty material, engineer stock, serial/item code search.

Important spelling aliases:
- spareRequirment and spareRequirmentname are intentionally misspelled in HPCL Status.
- RBML means JioBPStatus.
- JioBP and JIO BP mean JioBPStatus.
- HPCL status means Status.
- RO/site master means ROMaster.
`;

const ALLOWED_STAGES = new Set([
  "$match",
  "$lookup",
  "$unwind",
  "$project",
  "$group",
  "$sort",
  "$limit",
  "$skip",
  "$addFields",
  "$set",
  "$count",
  "$facet",
]);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function toISTDateISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

function shiftISODate(dateISO, days) {
  const date = new Date(`${dateISO}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getDateContext() {
  const today = toISTDateISO();
  return {
    today,
    yesterday: shiftISODate(today, -1),
    tomorrow: shiftISODate(today, 1),
    last7DaysFrom: shiftISODate(today, -6),
    last15DaysFrom: shiftISODate(today, -14),
    last30DaysFrom: shiftISODate(today, -29),
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value || "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function validatePipeline(collection, pipeline) {
  if (!modelMap[collection]) {
    throw new Error(`Invalid collection "${collection}".`);
  }
  if (!Array.isArray(pipeline)) {
    throw new Error("Pipeline must be an array.");
  }
  if (pipeline.length > 14) {
    throw new Error("Pipeline is too long.");
  }

  for (const stage of pipeline) {
    const keys = Object.keys(stage || {});
    if (keys.length !== 1) throw new Error("Each pipeline stage must contain exactly one operator.");
    const op = keys[0];
    if (!ALLOWED_STAGES.has(op)) throw new Error(`Pipeline operator ${op} is not allowed.`);
    const raw = JSON.stringify(stage);
    if (/\$(out|merge|function|accumulator|where)\b/i.test(raw)) {
      throw new Error("Unsafe pipeline stage blocked.");
    }
  }

  const hasLimit = pipeline.some((stage) => Object.prototype.hasOwnProperty.call(stage, "$limit"));
  if (!hasLimit) pipeline.push({ $limit: 50 });
  return pipeline;
}

function extractPlanDetails(row = {}) {
  const plan = Array.isArray(row.planDetails) ? row.planDetails[0] : row.planDetails;
  if (!plan || typeof plan !== "object") return row;
  return {
    ...row,
    roCode: row.roCode || plan.roCode,
    roName: row.roName || plan.roName,
    region: row.region || plan.region,
    engineer: row.engineer || plan.engineer,
    visitDate: row.visitDate || plan.date,
    phase: row.phase || plan.phase,
  };
}

function normalizeResultRows(rows = []) {
  return rows.map(extractPlanDetails);
}

async function buildQueryPlan(question, dateContext) {
  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: `${COLLECTION_GUIDE}

You convert a user's RELCON CRM question into ONE MongoDB aggregation pipeline.

Current IST dates:
- today: ${dateContext.today}
- yesterday: ${dateContext.yesterday}
- tomorrow: ${dateContext.tomorrow}
- last 7 days start: ${dateContext.last7DaysFrom}
- last 15 days start: ${dateContext.last15DaysFrom}
- last 30 days start: ${dateContext.last30DaysFrom}

Rules:
1. Return ONLY JSON: {"collection":"ExactCollectionName","pipeline":[...],"intent":"short description"}.
2. Use only these collection names: ${Object.keys(modelMap).join(", ")}.
3. Read-only aggregation only. No write/delete/update operations.
4. Dates stored as strings are usually YYYY-MM-DD in field "date", "incidentDate", "mailDate", etc. Match exact date string for today/yesterday.
5. For counts, use $count or $group. For lists, project only useful fields and limit to 20 unless user asks more.
6. For text/code search, use case-insensitive regex on relevant fields. Escape user literals when possible.
7. If user asks across HPCL/RBML/BPCL status together, choose the most relevant single collection. If impossible in one collection, use DailyPlan or MaterialRequirement when it has combined data.
8. Do not invent fields. Use the schema above.
9. For Status/JioBPStatus/BPCLStatus, use $lookup to DailyPlan when answer needs RO, engineer, date, phase, or region.
10. Prefer precise filters over broad scans.`,
      },
      { role: "user", content: question },
    ],
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const plan = safeJsonParse(completion.choices[0].message.content);
  plan.pipeline = validatePipeline(plan.collection, plan.pipeline);
  return plan;
}

async function answerFromData({ question, plan, rows, dateContext }) {
  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: `You are RELCON CRM data assistant.
Answer only from the supplied database result. Do not guess.
If result is empty, say no matching records found and mention what was searched.
Use concise Hinglish. Include counts, RO code/name, engineer, date, status when present.
If the data is a grouped count, explain the grouping clearly.
If there are many rows, show top rows and say total rows returned.
Current IST today is ${dateContext.today}.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          question,
          queryPlan: plan,
          returnedRows: rows.length,
          data: rows,
        }),
      },
    ],
    model: "llama-3.1-8b-instant",
    temperature: 0.1,
  });

  return completion.choices[0].message.content.trim();
}

async function handleAIQuery(question) {
  try {
    const cleanQuestion = String(question || "").trim();
    if (!cleanQuestion) return "Question blank hai. Kripya database se related sawal poochiye.";
    if (!process.env.GROQ_API_KEY) return "AI configuration missing hai: GROQ_API_KEY set nahi hai.";

    const dateContext = getDateContext();
    const plan = await buildQueryPlan(cleanQuestion, dateContext);
    const Model = modelMap[plan.collection];
    const rawRows = await Model.aggregate(plan.pipeline);
    const rows = normalizeResultRows(rawRows).slice(0, 50);

    return await answerFromData({
      question: cleanQuestion,
      plan,
      rows,
      dateContext,
    });
  } catch (error) {
    console.error("CRITICAL_AI_ERROR:", error);
    return `Maaf kijiye, database query banane ya chalane mein issue aaya: ${error.message || "Unknown error"}. Sawal thoda specific karke poochiye, jaise "yesterday HPCL visits count" ya "RO code XXX ka latest status".`;
  }
}

module.exports = { handleAIQuery };
