/**
 * mailer.js
 * - Sends daily "Pending Status (HPCL + RBML + BPCL)" report to configured recipient via SMTP.
 * - Report covers LAST 15 DAYS (not just yesterday).
 * - Timezone-aware schedule: runs at 14:30 IST (Asia/Kolkata).
 *
 * Env required:
 *  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO,
 *  BASE_URL, APP_USER, APP_PASS, SESSION_SECRET
 *
 * Usage:
 *  node server/utils/mailer.js               # last 15 days report
 *  node server/utils/mailer.js 2025-04-01    # custom end-date (last 15 days from that date)
 */
require("dotenv").config();
const axios = require("axios");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const XLSX = require("xlsx");
const { EmailLog } = require("../models/AuditLog");
const MaterialManagement = require("../models/MaterialManagement");
const MaterialUploadSchedule = require("../models/MaterialUploadSchedule");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const DailyPlan = require("../models/DailyPlan");
const Status = require("../models/Status");
const Task = require("../models/Task");
const JioBPStatus = require("../models/jioBPStatus");
const BPCLStatus = require("../models/BPCLStatus");
const { importMaterialFileBuffer } = require("./materialUploadService");

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
  MAIL_TO,
  BASE_URL,
  APP_USER,
  APP_PASS,
  SESSION_SECRET,
} = process.env;

if (
  !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS ||
  !MAIL_FROM || !MAIL_TO || !BASE_URL || !APP_USER || !APP_PASS || !SESSION_SECRET
) {
  console.warn("⚠️ Missing mailer environment variables. Emails will not be sent.");
}

axios.defaults.timeout = 30000;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  tls: { rejectUnauthorized: false },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safe(val) {
  return (val ?? "").toString();
}

function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function htmlEscape(str) {
  return safe(str).replace(
    /[&<>"']/g,
    (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s])
  );
}

/**
 * Returns array of YYYY-MM-DD strings for the last `days` days ending on endDateISO (inclusive).
 */
function getLast15Days(endDateISO, days = 15) {
  const result = [];
  const end = new Date(endDateISO + "T00:00:00");
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    result.push(toLocalISODate(d));
  }
  return result;
}

function buildTable(rows, columns, title) {
  if (!rows.length) {
    return `<div style="margin-top:22px">
      <h3 style="margin:0 0 10px;color:#0f172a;font-size:16px;font-weight:700">${htmlEscape(title)}</h3>
      <div style="padding:12px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;color:#065f46;font-size:13px;font-weight:600">
        No pending records in this section.
      </div>
    </div>`;
  }

  const thead = columns
    .map((c) => `<th style="padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#f8fafc;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;color:#334155;text-align:left;white-space:nowrap;">${htmlEscape(c.label)}</th>`)
    .join("");

  const tbody = rows
    .map((r, idx) => {
      const tds = columns
        .map((c) => `<td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">${htmlEscape(typeof c.get === "function" ? c.get(r) : r[c.key])}</td>`)
        .join("");
      return `<tr style="background:${idx % 2 === 0 ? "#ffffff" : "#f8fafc"}">${tds}</tr>`;
    })
    .join("");

  return `
  <div style="margin-top:22px">
    <h3 style="margin:0 0 10px;color:#0f172a;font-size:16px;font-weight:700">${htmlEscape(title)} <span style="font-weight:600;color:#64748b">(${rows.length})</span></h3>
    <div style="overflow:auto;border:1px solid #e2e8f0;border-radius:10px;background:#ffffff">
      <table style="width:100%;border-collapse:separate;border-spacing:0;min-width:860px;">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  </div>`;
}

function toCSV(rows, keys, headerMap = {}) {
  const esc = (v) => {
    const s = safe(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = keys.map((k) => esc(headerMap[k] || k)).join(",");
  const lines = rows.map((r) => keys.map((k) => esc(r[k])).join(","));
  return [header, ...lines].join("\n");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStatusLabel(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isRequirementGivenToHQOStatus(value = "") {
  const normalized = normalizeStatusLabel(value);
  return [
    "requimentgiventohqo",
    "requirementgiventohqo",
    "requirmentgiventohqo",
  ].includes(normalized);
}

function extractEmailAddress(value = "") {
  const raw = String(value || "").trim();
  const match = raw.match(/<([^>]+)>/);
  return normalizeEmail(match ? match[1] : raw);
}

function buildFromHeader(displayName) {
  const fromAddress = extractEmailAddress(MAIL_FROM) || normalizeEmail(SMTP_USER) || "no-reply@relconsystems.com";
  return `"${String(displayName || "Relcon CRM").replace(/"/g, "")}" <${fromAddress}>`;
}

function formatDateTimeIST(value = new Date()) {
  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnlyIST(value = "") {
  if (!value) return "—";
  const isoDate = String(value).slice(0, 10);
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate || "—";
  return parsed.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function getCurrentISTDateParts(baseDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

  const parts = formatter.formatToParts(new Date(baseDate));
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  return {
    dateISO: `${map.year}-${map.month}-${map.day}`,
    weekdayShort: String(map.weekday || "").toLowerCase(),
  };
}

function parseISTDateTime(dateISO = "", timeValue = "") {
  const [year, month, day] = String(dateISO || "").split("-").map(Number);
  const [hour, minute] = String(timeValue || "").split(":").map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function getISTNowDate() {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  return new Date(istString);
}

function buildMaterialDispatchTable(rows = []) {
  if (!rows.length) return "";

  const columns = [
    { key: "serialNumber", label: "Serial No." },
    { key: "itemCode", label: "Item Code" },
    { key: "itemName", label: "Material Name" },
    { key: "qty", label: "Qty" },
    { key: "itemType", label: "Material Type" },
    { key: "itemStatus", label: "Status" },
    { key: "remarks", label: "Remarks" },
    { key: "updatedAt", label: "Last Updated" },
  ];

  return buildTable(
    rows.map((row) => ({
      ...row,
      updatedAt: formatDateTimeIST(row.updatedAt || row.createdAt || new Date()),
      remarks: row.remarks || "—",
    })),
    columns,
    "Faulty Material Details"
  );
}

function buildMaterialRequestLineItemsTable(rows = []) {
  if (!rows.length) {
    return `<div style="padding:14px 16px;border:1px solid #dbeafe;border-radius:12px;background:#f8fbff;color:#334155;font-size:13px;">
      No material line items were available in this request.
    </div>`;
  }

  const columns = [
    { key: "materialName", label: "Material Name" },
    { key: "materialType", label: "Type" },
    { key: "requestType", label: "Request Type" },
    { key: "quantity", label: "Qty" },
    { key: "materialStatus", label: "Status" },
    { key: "challanNumber", label: "Challan No" },
    { key: "dispatchCourier", label: "Courier/Dispatch From" },
    { key: "docketNumber", label: "Docket Number" },
    { key: "dispatchDate", label: "Dispatch Date" },
    { key: "deliveryStatus", label: "Delivery Status" },
    { key: "deliveryDate", label: "Delivery Date" },
    { key: "poNumber", label: "PO Number" },
    { key: "notes", label: "Line Notes" },
  ];

  return buildTable(
    rows.map((row) => ({
      ...row,
      quantity: row.quantity || "—",
      materialStatus: row.materialStatus || "Pending",
      challanNumber: row.challanNumber || "—",
      dispatchCourier: row.dispatchCourier || "—",
      docketNumber: row.docketNumber || "—",
      dispatchDate: formatDateOnlyIST(row.dispatchDate),
      deliveryStatus: row.deliveryStatus || "—",
      deliveryDate: formatDateOnlyIST(row.deliveryDate),
      poNumber: row.poNumber || "—",
      notes: row.notes || "—",
    })),
    columns,
    "Material Line Details"
  );
}

async function getMaterialRequestNotificationRecipients(request = {}) {
  const users = await User.find({}, "email role engineerName username").lean();
  const adminEmails = [...new Set(
    users
      .filter((user) => String(user.role || "").trim().toLowerCase() === "admin")
      .map((user) => normalizeEmail(user.email))
      .filter(Boolean)
  )];

  const engineerNeedle = String(request.engineer || "").trim().toLowerCase();
  const engineerEmails = [...new Set(
    [
      normalizeEmail(request.engineerEmailId),
      ...users
        .filter((user) => {
          const engineerName = String(user.engineerName || user.username || "").trim().toLowerCase();
          return engineerNeedle && engineerName === engineerNeedle;
        })
        .map((user) => normalizeEmail(user.email)),
    ].filter(Boolean)
  )];

  return { adminEmails, engineerEmails };
}

function buildMaterialRequestSummaryCards(request = {}) {
  const cards = [
    ["Engineer", request.engineer || "—"],
    ["Engineer Code", request.engineerCode || "—"],
    ["Engineer Email", request.engineerEmailId || "—"],
    ["Engineer Contact", request.engineerContactNumber || "—"],
    ["Region", request.region || "—"],
    ["Customer", request.customer || "—"],
    ["RO Code", request.roCode || "—"],
    ["RO Name", request.roName || "—"],
    ["Phase", request.phase || "—"],
    ["Material Request Date", formatDateOnlyIST(request.date)],
    ["Request Given To", request.materialRequestTo || "—"],
    ["HQO Email", request.materialRequestFromEmail || "—"],
    ["Dispatch Follow-up Date", formatDateOnlyIST(request.materialRequestDate)],
    ["Destination Address", request.destinationAddress || "—"],
    ["Material Arrange From", request.materialArrangeFrom || "—"],
    ["Request Summary", request.materialSummary || "—"],
    ["Overall Status", request.materialDispatchStatus || "Pending"],
    ["Total Quantity", request.quantity || 0],
    ["Remarks", request.remarks || "—"],
  ];

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:20px 0 8px;">
      ${cards.map(([label, value]) => `
        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#ffffff;">
          <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b;">${htmlEscape(label)}</div>
          <div style="margin-top:6px;font-size:13px;color:#0f172a;font-weight:600;line-height:1.45;">${htmlEscape(value)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function buildMaterialRequestSummaryTable(request = {}) {
  const rows = [
    ["Engineer Name", request.engineer || "—"],
    ["Engineer Code", request.engineerCode || "—"],
    ["Engineer Email", request.engineerEmailId || "—"],
    ["Engineer Contact", request.engineerContactNumber || "—"],
    ["Region", request.region || "—"],
    ["Customer", request.customer || "—"],
    ["RO Code", request.roCode || "—"],
    ["RO Name", request.roName || "—"],
    ["Phase", request.phase || "—"],
    ["Material Request Date", formatDateOnlyIST(request.date)],
    ["Request Given To", request.materialRequestTo || "—"],
    ["HQO Email", request.materialRequestFromEmail || "—"],
    ["Dispatch Follow-up Date", formatDateOnlyIST(request.materialRequestDate)],
    ["Destination Address", request.destinationAddress || "—"],
    ["Material Arrange From", request.materialArrangeFrom || "—"],
    ["Request Summary", request.materialSummary || "—"],
    ["Current Status", request.materialDispatchStatus || "Pending"],
    ["Total Quantity", request.quantity || 0],
    ["Remarks", request.remarks || "—"],
  ];

  return `
    <table style="width:100%;border-collapse:collapse;border:1px solid #dbe3ee;border-radius:12px;overflow:hidden;background:#ffffff;font-size:13px;">
      <tbody>
        ${rows.map(([label, value], index) => `
          <tr style="background:${index % 2 === 0 ? "#ffffff" : "#f8fafc"};">
            <td style="width:260px;padding:11px 14px;border-bottom:1px solid #e5edf5;font-weight:700;color:#334155;vertical-align:top;">${htmlEscape(label)}</td>
            <td style="padding:11px 14px;border-bottom:1px solid #e5edf5;color:#0f172a;vertical-align:top;line-height:1.5;">${htmlEscape(value)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function buildMaterialRequestProfessionalEmailHtml({
  request = {},
  title = "",
  intro = "",
  salutation = "Team",
  statusLabel = "",
}) {
  const generatedAt = formatDateTimeIST(new Date());

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.7;">
      <p style="margin:0 0 14px;">Dear ${htmlEscape(salutation)},</p>
      <p style="margin:0 0 12px;"><strong>${htmlEscape(title)}</strong></p>
      <p style="margin:0 0 18px;">${htmlEscape(intro)}</p>
      <p style="margin:0 0 16px;"><strong>Current Workflow Status:</strong> ${htmlEscape(statusLabel || request.materialDispatchStatus || "Pending")}</p>

      <p style="margin:0 0 8px;"><strong>Request Details</strong></p>
      ${buildMaterialRequestSummaryTable(request)}

      <div style="margin-top:20px;">
        ${buildMaterialRequestLineItemsTable(Array.isArray(request.lineItems) ? request.lineItems : [])}
      </div>

      <p style="margin:18px 0 0;">The complete request data is also attached in CSV format for operational review, dispatch coordination, and audit reference.</p>
      <p style="margin:14px 0 0;">Regards,<br/><strong>Relcon CRM</strong><br/><span style="color:#64748b;font-size:12px;">Generated on ${htmlEscape(generatedAt)} IST.</span></p>
    </div>
  `;
}

function buildMaterialRequestEmailHtml({
  request = {},
  heading = "",
  intro = "",
  highlightLabel = "",
  highlightValue = "",
}) {
  const generatedAt = formatDateTimeIST(new Date());

  return `
    <div style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:1080px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ee;border-radius:18px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#0f3c68,#0176d3);color:#ffffff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.88;">Relcon CRM</div>
          <h2 style="margin:10px 0 8px;font-size:26px;line-height:1.25;">${htmlEscape(heading)}</h2>
          <p style="margin:0;font-size:14px;line-height:1.7;opacity:.96;">${htmlEscape(intro)}</p>
        </div>
        <div style="padding:24px 28px;">
          <div style="padding:16px 18px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:14px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1d4ed8;">${htmlEscape(highlightLabel || "Notification")}</div>
            <div style="margin-top:6px;font-size:16px;font-weight:700;color:#0f172a;">${htmlEscape(highlightValue || "Material Request Workflow Update")}</div>
          </div>
          ${buildMaterialRequestSummaryCards(request)}
          <div style="margin-top:22px;">
            ${buildMaterialRequestLineItemsTable(Array.isArray(request.lineItems) ? request.lineItems : [])}
          </div>
          <div style="margin-top:22px;padding:16px 18px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;">
            <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#475569;">Process Note</div>
            <p style="margin:8px 0 0;font-size:13px;line-height:1.7;color:#334155;">
              This is a system-generated notification from Relcon CRM for controlled material request tracking, dispatch visibility, and delivery confirmation.
            </p>
            <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Generated on ${htmlEscape(generatedAt)} IST.</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildMaterialRequestCsvRows(request = {}) {
  const base = {
    Engineer: request.engineer || "",
    EngineerCode: request.engineerCode || "",
    EngineerEmail: request.engineerEmailId || "",
    EngineerContact: request.engineerContactNumber || "",
    Region: request.region || "",
    Customer: request.customer || "",
    ROCode: request.roCode || "",
    ROName: request.roName || "",
    Phase: request.phase || "",
    MaterialRequestDate: request.date || "",
    RequestGivenTo: request.materialRequestTo || "",
    HQOEmail: request.materialRequestFromEmail || "",
    DispatchFollowupDate: request.materialRequestDate || "",
    DestinationAddress: request.destinationAddress || "",
    ArrangeFrom: request.materialArrangeFrom || "",
    RequestSummary: request.materialSummary || "",
    OverallStatus: request.materialDispatchStatus || "",
    TotalQuantity: request.quantity || 0,
    Remarks: request.remarks || "",
  };

  const lineItems = Array.isArray(request.lineItems) && request.lineItems.length
    ? request.lineItems
    : [{}];

  return lineItems.map((item, index) => ({
    ...base,
    LineNo: index + 1,
    MaterialName: item.materialName || "",
    MaterialType: item.materialType || "",
    RequestType: item.requestType || "",
    Quantity: item.quantity || "",
    LineStatus: item.materialStatus || "",
    ChallanNumber: item.challanNumber || "",
    ChallanDate: item.challanCreationDate || "",
    DispatchCourier: item.dispatchCourier || "",
    DocketNumber: item.docketNumber || "",
    DispatchDate: item.dispatchDate || "",
    DeliveryStatus: item.deliveryStatus || "",
    DeliveryDate: item.deliveryDate || "",
    PONumber: item.poNumber || "",
    PODate: item.poDate || "",
    LineNotes: item.notes || "",
  }));
}

function buildMaterialRequestCsvAttachment(request = {}, fileLabel = "material-request") {
  const rows = buildMaterialRequestCsvRows(request);
  const keys = Object.keys(rows[0] || { RequestSummary: "" });
  const csv = toCSV(rows, keys);
  const safeRoCode = String(request.roCode || "RO").replace(/[^a-z0-9_-]/gi, "_");
  const safeLabel = String(fileLabel || "material-request").replace(/[^a-z0-9_-]/gi, "_");
  return {
    filename: `${safeLabel}_${safeRoCode}_${String(request.date || "").slice(0, 10) || "request"}.csv`,
    content: csv,
    contentType: "text/csv; charset=utf-8",
  };
}

function buildMaterialLineItemsText(rows = []) {
  if (!rows.length) return "No material line items available.";

  return rows
    .map((item, index) => {
      const parts = [
        `${index + 1}. Material Name: ${item.materialName || "—"}`,
        `   Material Type: ${item.materialType || "—"}`,
        `   Request Type: ${item.requestType || "—"}`,
        `   Quantity: ${item.quantity || "—"}`,
        `   Status: ${item.materialStatus || "Pending"}`,
        `   Challan No: ${item.challanNumber || "—"}`,
        `   Challan Date: ${formatDateOnlyIST(item.challanCreationDate)}`,
        `   Courier/Dispatch From: ${item.dispatchCourier || "—"}`,
        `   Docket Number: ${item.docketNumber || "—"}`,
        `   Dispatch Date: ${formatDateOnlyIST(item.dispatchDate)}`,
        `   Delivery Status: ${item.deliveryStatus || "—"}`,
        `   Delivery Date: ${formatDateOnlyIST(item.deliveryDate)}`,
        `   PO Number: ${item.poNumber || "—"}`,
        `   PO Date: ${formatDateOnlyIST(item.poDate)}`,
        `   Line Notes: ${item.notes || "—"}`,
      ];
      return parts.join("\n");
    })
    .join("\n\n");
}

function buildMaterialRequestPlainText({
  request = {},
  greeting = "Team",
  intro = "",
  statusLabel = "",
}) {
  return [
    `Dear ${greeting},`,
    "",
    intro,
    "",
    "Request Summary",
    `- Current Status: ${statusLabel || request.materialDispatchStatus || "Pending"}`,
    `- Engineer: ${request.engineer || "—"} (${request.engineerCode || "—"})`,
    `- Engineer Email: ${request.engineerEmailId || "—"}`,
    `- Engineer Contact: ${request.engineerContactNumber || "—"}`,
    `- Region: ${request.region || "—"}`,
    `- Customer: ${request.customer || "—"}`,
    `- RO Code: ${request.roCode || "—"}`,
    `- RO Name: ${request.roName || "—"}`,
    `- Phase: ${request.phase || "—"}`,
    `- Material Request Date: ${formatDateOnlyIST(request.date)}`,
    `- Request Given To: ${request.materialRequestTo || "—"}`,
    `- HQO Email: ${request.materialRequestFromEmail || "—"}`,
    `- Dispatch Follow-up Date: ${formatDateOnlyIST(request.materialRequestDate)}`,
    `- Destination Address: ${request.destinationAddress || "—"}`,
    `- Material Arrange From: ${request.materialArrangeFrom || "—"}`,
    `- Request Summary: ${request.materialSummary || "—"}`,
    `- Total Quantity: ${request.quantity || 0}`,
    `- Remarks: ${request.remarks || "—"}`,
    "",
    "Material Line Details",
    buildMaterialLineItemsText(Array.isArray(request.lineItems) ? request.lineItems : []),
    "",
    "A CSV attachment containing the full material request details is attached for record and operational follow-up.",
    "",
    "Regards,",
    "Relcon CRM",
    `Generated on ${formatDateTimeIST(new Date())} IST`,
  ].join("\n");
}

async function logMaterialWorkflowEmail({ type, subject, to, cc, status, request, error }) {
  try {
    await EmailLog.create({
      type,
      subject,
      to: [...new Set([...(to || []), ...(cc || [])])].join(", "),
      status,
      error: error ? String(error) : "",
      meta: {
        to: to || [],
        cc: cc || [],
        roCode: request?.roCode || "",
        roName: request?.roName || "",
        engineer: request?.engineer || "",
        materialDispatchStatus: request?.materialDispatchStatus || "",
      },
    });
  } catch (logErr) {
    console.error("Failed to write material workflow EmailLog:", logErr?.message || logErr);
  }
}

async function sendMaterialRequestNotification(request = {}) {
  const statusMatches = isRequirementGivenToHQOStatus(request.materialDispatchStatus);
  const hqoEmail = normalizeEmail(request.materialRequestFromEmail);
  if (!statusMatches || !hqoEmail) {
    return { ok: false, skipped: true, reason: "status_not_hqo_or_missing_hqo_email" };
  }

  const { adminEmails, engineerEmails } = await getMaterialRequestNotificationRecipients(request);
  const cc = [...new Set([...adminEmails, ...engineerEmails].filter((email) => email !== hqoEmail))];
  const subject = `Material Request Notification | HQO Action Required | ${request.roCode || "RO"} | ${request.engineer || "Engineer"}`;
  const html = buildMaterialRequestProfessionalEmailHtml({
    request,
    salutation: "HQO Team",
    title: "Material Request Raised for HQO Review",
    intro: "A material request has been raised and marked for HQO action. Kindly review the request details and material line information shared below and proceed with the necessary coordination.",
    statusLabel: "Requirement given to HQO",
  });
  const text = buildMaterialRequestPlainText({
    request,
    greeting: "HQO Team",
    intro: "A material request has been raised and marked for HQO action. Please review the request details and proceed with the necessary coordination.",
    statusLabel: "Requirement given to HQO",
  });

  const mailOptions = {
    from: buildFromHeader(`Material Requirement <${extractEmailAddress(MAIL_FROM) || extractEmailAddress(SMTP_USER)}>`),
    to: hqoEmail,
    cc: cc.length ? cc.join(", ") : undefined,
    subject,
    html,
    text,
    attachments: [buildMaterialRequestCsvAttachment(request, "material_requirement")],
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    await logMaterialWorkflowEmail({ type: "Material Request Notification", subject, to: [hqoEmail], cc, status: "success", request });
    return { ok: true, messageId: info?.messageId || "" };
  } catch (err) {
    await logMaterialWorkflowEmail({ type: "Material Request Notification", subject, to: [hqoEmail], cc, status: "failure", request, error: err?.message || err });
    throw err;
  }
}

async function sendMaterialDispatchNotification(request = {}, notificationType = "dispatch") {
  const { adminEmails, engineerEmails } = await getMaterialRequestNotificationRecipients(request);
  if (!engineerEmails.length) {
    return { ok: false, skipped: true, reason: "missing_engineer_email" };
  }

  const statusLabel = notificationType === "delivered" ? "Delivered" : "Dispatched";
  const displayName = notificationType === "delivered"
    ? `Material Delivered Notification <${extractEmailAddress(MAIL_FROM) || extractEmailAddress(SMTP_USER)}>`
    : `Material Dispatch Notification <${extractEmailAddress(MAIL_FROM) || extractEmailAddress(SMTP_USER)}>`;
  const subjectPrefix = notificationType === "delivered"
    ? "Material Delivery Confirmation"
    : "Material Dispatch Notification";
  const subject = `${subjectPrefix} | ${request.roCode || "RO"} | ${request.engineer || "Engineer"}`;
  const html = buildMaterialRequestProfessionalEmailHtml({
    request,
    salutation: request.engineer || "Team",
    title: notificationType === "delivered" ? "Material Delivery Confirmation" : "Material Dispatch Update",
    intro: notificationType === "delivered"
      ? "This is to confirm that the material request referenced below has been updated to Delivered status. Please review the delivery details and line-wise material information for record confirmation."
      : "This is to inform you that the material request referenced below has been updated to Dispatched status. Please review the dispatch details, courier references, and docket information shared below.",
    statusLabel,
  });
  const text = buildMaterialRequestPlainText({
    request,
    greeting: request.engineer || "Team",
    intro: notificationType === "delivered"
      ? "This is to confirm that the material request below has been marked as Delivered. Please find the request details, dispatch references, and line-wise status below."
      : "This is to inform you that the material request below has been marked as Dispatched. Please find the dispatch references, docket details, and line-wise material details below.",
    statusLabel,
  });

  const mailOptions = {
    from: buildFromHeader(displayName),
    to: engineerEmails.join(", "),
    cc: adminEmails.length ? adminEmails.join(", ") : undefined,
    subject,
    html,
    text,
    attachments: [buildMaterialRequestCsvAttachment(request, notificationType === "delivered" ? "material_delivered" : "material_dispatch")],
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    await logMaterialWorkflowEmail({
      type: notificationType === "delivered" ? "Material Delivered Notification" : "Material Dispatch Notification",
      subject,
      to: engineerEmails,
      cc: adminEmails,
      status: "success",
      request,
    });
    return { ok: true, messageId: info?.messageId || "" };
  } catch (err) {
    await logMaterialWorkflowEmail({
      type: notificationType === "delivered" ? "Material Delivered Notification" : "Material Dispatch Notification",
      subject,
      to: engineerEmails,
      cc: adminEmails,
      status: "failure",
      request,
      error: err?.message || err,
    });
    throw err;
  }
}

function prettifyFieldName(field = "") {
  return String(field || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function buildCorrectionSummaryText(changes = []) {
  if (!changes.length) return "No field-level corrections were captured.";

  return changes
    .map((change, index) => {
      const field = prettifyFieldName(change.field) || "Field";
      const before = String(change.before || "—").trim() || "—";
      const after = String(change.after || "—").trim() || "—";
      return [
        `${index + 1}. ${field}`,
        `   Submitted: ${before}`,
        `   Corrected: ${after}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildCorrectionSummaryHtml(changes = []) {
  if (!changes.length) {
    return "<p style=\"margin:8px 0 0;\">No field-level corrections were captured.</p>";
  }

  const rows = changes
    .map((change, index) => {
      const field = prettifyFieldName(change.field) || "Field";
      const before = String(change.before || "—").trim() || "—";
      const after = String(change.after || "—").trim() || "—";
      return `
        <tr>
          <td style="border:1px solid #000;padding:8px;vertical-align:top;">${index + 1}</td>
          <td style="border:1px solid #000;padding:8px;vertical-align:top;">${htmlEscape(field)}</td>
          <td style="border:1px solid #000;padding:8px;vertical-align:top;color:#b91c1c;font-weight:600;">${htmlEscape(before)}</td>
          <td style="border:1px solid #000;padding:8px;vertical-align:top;color:#15803d;font-weight:600;">${htmlEscape(after)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <table style="border-collapse:collapse;width:100%;margin-top:8px;font-size:13px;">
      <thead>
        <tr>
          <th style="border:1px solid #000;padding:8px;text-align:left;"><b>S. No.</b></th>
          <th style="border:1px solid #000;padding:8px;text-align:left;"><b>Field</b></th>
          <th style="border:1px solid #000;padding:8px;text-align:left;color:#b91c1c;"><b>Submitted By Engineer</b></th>
          <th style="border:1px solid #000;padding:8px;text-align:left;color:#15803d;"><b>Corrected By Admin</b></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function getUserEmailsByUsernames(usernames = []) {
  const normalizedUsernames = [...new Set(usernames.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  if (!normalizedUsernames.length) return [];
  const users = await User.find({}, "username email").lean();
  return [...new Set(
    users
      .filter((user) => normalizedUsernames.includes(String(user.username || "").trim().toLowerCase()))
      .map((user) => normalizeEmail(user.email))
      .filter(Boolean)
  )];
}

function isHpclActionRequiredStatusRecord(record = {}) {
  const plan = record.planId || {};
  const phase = String(plan.phase || record.phase || "").trim().toUpperCase();
  if (!phase.startsWith("HPCL")) return false;

  const earthingStatus = String(record.earthingStatus || "").trim().toUpperCase();
  const duOffline = String(record.duOffline || "").trim().toUpperCase();
  const duDependency = String(record.duDependency || "").trim().toUpperCase();
  const tankOffline = String(record.tankOffline || "").trim().toUpperCase();
  const tankDependency = String(record.tankDependency || "").trim().toUpperCase();

  return earthingStatus === "NOT OK"
    || (duOffline && duOffline !== "ALL OK" && ["HPCL", "BOTH"].includes(duDependency))
    || (tankOffline && tankOffline !== "ALL OK" && ["HPCL", "BOTH"].includes(tankDependency));
}

function buildHpclActionRequiredIssue(record = {}) {
  const issues = [];
  const earthingStatus = String(record.earthingStatus || "").trim().toUpperCase();
  const duOffline = String(record.duOffline || "").trim();
  const duDependency = String(record.duDependency || "").trim().toUpperCase();
  const tankOffline = String(record.tankOffline || "").trim();
  const tankDependency = String(record.tankDependency || "").trim().toUpperCase();

  if (earthingStatus === "NOT OK") issues.push(`Earthing NOT OK${record.voltageReading ? ` (${record.voltageReading})` : ""}`);
  if (duOffline && duOffline.toUpperCase() !== "ALL OK" && ["HPCL", "BOTH"].includes(duDependency)) {
    issues.push(`DU Offline: ${duOffline}${record.duRemark ? ` | ${record.duRemark}` : ""}`);
  }
  if (tankOffline && tankOffline.toUpperCase() !== "ALL OK" && ["HPCL", "BOTH"].includes(tankDependency)) {
    issues.push(`Tank Offline: ${tankOffline}${record.tankRemark ? ` | ${record.tankRemark}` : ""}`);
  }

  return issues.join(" + ") || "Action Required";
}

function getPlanCreatedAt(plan) {
  if (plan?.createdAt) return new Date(plan.createdAt);
  if (plan?._id?.getTimestamp) return plan._id.getTimestamp();
  return null;
}

const PENDING_STATUS_REMINDER_PLAN_DATE_CUTOFF = "2026-03-01";

function getPlanVisitDateISO(plan) {
  return String(plan?.date || "").trim().slice(0, 10);
}

function isPlanAfterReminderCutoff(plan) {
  const visitDateISO = getPlanVisitDateISO(plan);
  if (!visitDateISO) return false;
  return visitDateISO > PENDING_STATUS_REMINDER_PLAN_DATE_CUTOFF;
}

function normalizePlanKeyPart(value = "") {
  return String(value || "").trim().toUpperCase();
}

function getPendingStatusRecordKey(plan) {
  return [
    normalizePlanKeyPart(plan?.roCode),
    normalizePlanKeyPart(getPlanVisitDateISO(plan)),
    normalizePlanKeyPart(plan?.engineer),
    normalizePlanKeyPart(plan?.phase),
  ].join("|");
}

function getPlanStatusCategory(plan) {
  const phase = String(plan?.phase || "").trim().toUpperCase();
  if (phase.startsWith("BPCL")) return "BPCL";
  if (phase.includes("RBML") || phase.includes("JIO")) return "RBML";
  return "HPCL";
}

function isNayaraPlan(plan) {
  const phase = String(plan?.phase || "").trim().toUpperCase();
  return phase.includes("NAYARA");
}

function isRemotelyAmcPlan(plan) {
  const purpose = String(plan?.purpose || "").trim().toUpperCase().replace(/\s+/g, " ");
  return purpose === "REMOTELY AMC";
}

function isOfficePlan(plan) {
  const category = getPlanStatusCategory(plan);
  if (!["HPCL", "BPCL"].includes(category)) return false;

  const haystack = [
    plan?.roName,
    plan?.purpose,
    plan?.phase,
    plan?.roCode,
  ]
    .map((value) => String(value || "").trim().toUpperCase())
    .join(" ");

  return haystack.includes("OFFICE");
}

function getPendingStatusMailBody({
  severity = "reminder",
  engineerName = "",
  roCode = "",
  roName = "",
  visitDate = "",
  phase = "",
  ageHours = 0,
} = {}) {
  const isWarning = severity === "warning";
  const title = isWarning ? "Final Warning: Status Still Pending" : "Reminder: Status Submission Pending";
  const intro = isWarning
    ? `The status for the below plan is still pending even after ${ageHours}+ hours from plan creation. Immediate action is required.`
    : `The status for the below plan is pending for more than ${ageHours} hours from plan creation. Please submit it at the earliest.`;
  const actionText = isWarning
    ? "Please submit the pending status immediately. Continued delay may impact reporting and escalation tracking."
    : "Please complete the pending status submission so that reporting timelines remain on track.";
  const escalationNote = isWarning
    ? "This mail is being treated as an escalation alert because the expected status update is still not available after the 48-hour threshold."
    : "This is a reminder alert issued after the 24-hour threshold for pending status submission.";
  const text = [
    `Subject: ${title}`,
    "",
    `Dear ${engineerName || "Engineer"},`,
    "",
    intro,
    "",
    "Plan Details:",
    `RO Code: ${roCode || "-"}`,
    `Site Name: ${roName || "-"}`,
    `Visit Date: ${visitDate || "-"}`,
    `Phase: ${phase || "-"}`,
    "",
    `${isWarning ? "Warning" : "Reminder"}: ${actionText}`,
    "",
    escalationNote,
    "",
    "Regards,",
    "Relcon CRM System",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#111;">
      <p>Dear <b>${htmlEscape(engineerName || "Engineer")}</b>,</p>
      <p>${htmlEscape(intro)}</p>
      <p style="margin:16px 0 8px;"><b>Plan Details</b></p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tbody>
          <tr>
            <td style="border:1px solid #000;padding:8px;width:25%;"><b>RO Code</b></td>
            <td style="border:1px solid #000;padding:8px;">${htmlEscape(roCode || "-")}</td>
            <td style="border:1px solid #000;padding:8px;width:25%;"><b>Site Name</b></td>
            <td style="border:1px solid #000;padding:8px;">${htmlEscape(roName || "-")}</td>
          </tr>
          <tr>
            <td style="border:1px solid #000;padding:8px;"><b>Visit Date</b></td>
            <td style="border:1px solid #000;padding:8px;">${htmlEscape(visitDate || "-")}</td>
            <td style="border:1px solid #000;padding:8px;"><b>Phase</b></td>
            <td style="border:1px solid #000;padding:8px;">${htmlEscape(phase || "-")}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin-top:16px;"><b>${isWarning ? "Warning" : "Reminder"}:</b> ${htmlEscape(actionText)}</p>
      <p><b>${isWarning ? "Escalation Note" : "Note"}:</b> ${htmlEscape(escalationNote)}</p>
      <p style="margin-top:16px;">
        Regards,<br>
        <b>Relcon CRM System</b>
      </p>
    </div>
  `;

  return { html, text };
}

function getMonthRange(targetDate = new Date()) {
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 0);
  return {
    fromDateISO: toLocalISODate(from),
    toDateISO: toLocalISODate(to),
    label: from.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }),
  };
}

function getPreviousMonthRange(baseDate = new Date()) {
  return getMonthRange(new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1));
}

function getDateRangeISO(fromDateISO, toDateISO) {
  const dates = [];
  const cursor = new Date(`${fromDateISO}T00:00:00`);
  const end = new Date(`${toDateISO}T00:00:00`);
  while (cursor <= end) {
    dates.push(toLocalISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function getDayShort(dateISO) {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });
}

function isSundayISO(dateISO) {
  return new Date(`${dateISO}T00:00:00`).getDay() === 0;
}

function buildAttendanceWorkbookBuffer({ engineerNames, records, fromDateISO, toDateISO }) {
  const SHORT = { Present: "P", Absent: "A", "Half Day": "H", Holiday: "HOL", "Week Off": "WO" };
  const dates = getDateRangeISO(fromDateISO, toDateISO);
  const pivot = {};

  for (const record of records) {
    const engineerName = String(record.engineerName || record.username || "").trim();
    const dateISO = String(record.date || "").slice(0, 10);
    if (!engineerName || !dateISO) continue;
    if (!pivot[engineerName]) pivot[engineerName] = {};
    pivot[engineerName][dateISO] = SHORT[record.status] || record.status || "";
  }

  for (const engineerName of engineerNames) {
    if (!pivot[engineerName]) pivot[engineerName] = {};
    for (const dateISO of dates) {
      if (isSundayISO(dateISO) && !pivot[engineerName][dateISO]) {
        pivot[engineerName][dateISO] = "WO";
      }
    }
  }

  const headerRow = ["Engineer", ...dates];
  const dataRows = engineerNames.map((engineerName) => [
    engineerName,
    ...dates.map((dateISO) => pivot[engineerName]?.[dateISO] || ""),
  ]);
  const detailRows = records
    .map((record) => ({
      engineerName: record.engineerName || record.username || "",
      date: String(record.date || "").slice(0, 10),
      day: getDayShort(String(record.date || "").slice(0, 10)),
      status: record.status || "",
      remarks: record.remarks || "",
      markedBy: record.markedBy || "",
      submittedAt: record.createdAt ? formatDateTimeIST(record.createdAt) : "",
    }))
    .sort((a, b) => (a.engineerName || "").localeCompare(b.engineerName || "") || (a.date || "").localeCompare(b.date || ""));

  const summaryRows = engineerNames.map((engineerName) => {
    const values = dates.map((dateISO) => pivot[engineerName]?.[dateISO] || "");
    const present = values.filter((value) => value === "P").length;
    const absent = values.filter((value) => value === "A").length;
    const halfDay = values.filter((value) => value === "H").length;
    const holiday = values.filter((value) => value === "HOL").length;
    const weekOff = values.filter((value) => value === "WO").length;
    const workingDays = values.length - weekOff;
    const attendancePct = workingDays > 0 ? Math.round((present / workingDays) * 100) : 0;
    return {
      Engineer: engineerName,
      Present: present,
      Absent: absent,
      HalfDay: halfDay,
      Holiday: holiday,
      WeekOff: weekOff,
      TotalDays: values.length,
      WorkingDays: workingDays,
      AttendancePct: `${attendancePct}%`,
    };
  });

  const wb = XLSX.utils.book_new();

  const pivotSheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  pivotSheet["!cols"] = [{ wch: 24 }, ...dates.map(() => ({ wch: 12 }))];
  XLSX.utils.book_append_sheet(wb, pivotSheet, "Attendance Sheet");

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet["!cols"] = [
    { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  const detailSheet = XLSX.utils.json_to_sheet(detailRows);
  detailSheet["!cols"] = [
    { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
    { wch: 28 }, { wch: 18 }, { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, detailSheet, "Detailed Records");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getFreshToken() {
  try {
    const res = await axios.post(`${BASE_URL}/login`, {
      username: APP_USER,
      password: APP_PASS,
    });
    if (!res?.data?.token) throw new Error("No token returned from login");
    return res.data.token;
  } catch (err) {
    console.error("❌ Login error:", err?.response?.data || err.message);
    throw err;
  }
}

// ─── Pending Calculators ───────────────────────────────────────────────────────

/**
 * HPCL + RBML pending for a given date range (dateSet = Set of YYYY-MM-DD strings)
 */
function computeHpclRbmlPending(plans = [], hpcl = [], jio = [], dateSet) {
  const key = (rc, d) => `${String(rc || "").trim().toUpperCase()}-${String(d || "").slice(0, 10)}`;

  const plansInRange = (plans || []).filter((p) => {
    const pd = String(p.date || "").slice(0, 10);
    if (!pd || !dateSet.has(pd)) return false;
    const purpose = String(p.purpose || "").trim().toUpperCase();
    return purpose !== "NO PLAN" && purpose !== "IN LEAVE";
  });

  const plansHpcl = plansInRange.filter((p) => String(p.phase || "").toUpperCase().startsWith("HPCL"));
  const plansRbml = plansInRange.filter((p) => String(p.phase || "").toUpperCase().includes("RBML"));

  const hpclStatusSet = new Set(
    (hpcl || [])
      .filter((r) => dateSet.has(String(r.date || r.uploadDate || "").slice(0, 10)))
      .filter((r) => String(r.phase || "").toUpperCase().startsWith("HPCL"))
      .map((r) => key(r.roCode, r.date || r.uploadDate))
  );

  const rbmlStatusSet = new Set(
    (jio || [])
      .filter((r) => dateSet.has(String(r.date || r.uploadDate || r.planId?.date || "").slice(0, 10)))
      .map((r) => {
        const ro = (r.roCode || r.siteCode || r.ro || r.planId?.roCode || "").trim().toUpperCase();
        const dt = String(r.date || r.uploadDate || r.planId?.date || "").slice(0, 10);
        return key(ro, dt);
      })
  );

  const pendingHpcl = plansHpcl.filter((p) => !hpclStatusSet.has(key(p.roCode, p.date)));
  const pendingRbml = plansRbml.filter((p) => !rbmlStatusSet.has(key(p.roCode || p.siteCode || p.ro, p.date)));

  const rows = [
    ...pendingHpcl.map((p) => ({
      customer: "HPCL",
      date: String(p.date || "").slice(0, 10),
      roCode: p.roCode || p.siteCode || p.ro || "",
      roName: p.roName || "",
      region: p.region || "",
      engineer: p.engineer || "",
      phase: p.phase || "",
      purpose: p.purpose || "",
    })),
    ...pendingRbml.map((p) => ({
      customer: "RBML",
      date: String(p.date || "").slice(0, 10),
      roCode: p.roCode || p.siteCode || p.ro || "",
      roName: p.roName || "",
      region: p.region || "",
      engineer: p.engineer || "",
      phase: p.phase || "",
      purpose: p.purpose || "",
    })),
  ];

  // Sort by date desc
  rows.sort((a, b) => b.date.localeCompare(a.date));

  return {
    rows,
    counts: { hpcl: pendingHpcl.length, rbml: pendingRbml.length, total: rows.length },
  };
}

/**
 * BPCL pending: plans with phase BPCL that have no BPCLStatus record saved.
 * bpclStatuses = array from /bpclStatus/getAllBPCLStatus (each has planId populated)
 */
function computeBpclPending(plans = [], bpclStatuses = [], dateSet) {
  // Build set of planIds that already have a BPCL status saved
  const savedPlanIds = new Set(
    (bpclStatuses || []).map((s) => {
      // planId may be populated object or raw ObjectId string
      return String(s.planId?._id || s.planId || "");
    })
  );

  const pendingBpcl = (plans || []).filter((p) => {
    const pd = String(p.date || "").slice(0, 10);
    if (!pd || !dateSet.has(pd)) return false;
    const purpose = String(p.purpose || "").trim().toUpperCase();
    if (purpose === "NO PLAN" || purpose === "IN LEAVE") return false;
    const phase = String(p.phase || "").toUpperCase();
    if (!phase.startsWith("BPCL")) return false;
    // Pending = no status saved
    return !savedPlanIds.has(String(p._id || ""));
  });

  const rows = pendingBpcl.map((p) => ({
    customer: "BPCL",
    date: String(p.date || "").slice(0, 10),
    roCode: p.roCode || p.siteCode || p.ro || "",
    roName: p.roName || "",
    region: p.region || "",
    engineer: p.engineer || "",
    phase: p.phase || "",
    purpose: p.purpose || "",
  }));

  // Sort by date desc
  rows.sort((a, b) => b.date.localeCompare(a.date));

  return { rows, counts: { bpcl: rows.length, total: rows.length } };
}

// ─── Main Email Function ───────────────────────────────────────────────────────

async function sendPendingStatusEmail({ forDateISO } = {}) {
  try {
    const token = await getFreshToken();

    // Fetch all datasets in parallel (BPCL added)
    const [plansRes, hpclRes, jioRes, bpclRes] = await Promise.all([
      axios.get(`${BASE_URL}/getDailyPlans`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${BASE_URL}/getMergedStatusRecords`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${BASE_URL}/jioBP/getAllJioBPStatus`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${BASE_URL}/bpclStatus/getAllBPCLStatus`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const plans       = Array.isArray(plansRes.data)  ? plansRes.data  : [];
    const hpcl        = Array.isArray(hpclRes.data)   ? hpclRes.data   : [];
    const jio         = Array.isArray(jioRes.data)    ? jioRes.data    : [];
    const bpclStatus  = Array.isArray(bpclRes.data)   ? bpclRes.data   : [];

    // End date = yesterday (or custom date passed)
    const endDateObj = forDateISO
      ? new Date(forDateISO + "T00:00:00")
      : (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })();
    const endDateISO = endDateObj.toISOString().slice(0, 10);

    // Build date range: last 15 days
    const dateRange  = getLast15Days(endDateISO, 15);
    const dateSet    = new Set(dateRange);
    const fromDateISO = dateRange[0];

    console.log(`📅 Report range: ${fromDateISO} → ${endDateISO}`);

    // Compute pending
    const { rows: hrRows, counts: hrCounts } = computeHpclRbmlPending(plans, hpcl, jio, dateSet);
    const { rows: bpclRows, counts: bpclCounts } = computeBpclPending(plans, bpclStatus, dateSet);

    // All rows combined for CSV
    const allRows = [...hrRows, ...bpclRows];
    allRows.sort((a, b) => b.date.localeCompare(a.date));

    const keys = ["customer", "date", "roCode", "roName", "region", "engineer", "phase", "purpose"];
    const headerMap = {
      customer: "Customer", date: "Date", roCode: "RO Code", roName: "RO Name",
      region: "Region", engineer: "Engineer", phase: "Phase", purpose: "Purpose",
    };

    const csv = toCSV(allRows, keys, headerMap);
    const columns = keys.map((k) => ({ key: k, label: headerMap[k] }));

    const totalPending = hrCounts.total + bpclCounts.total;

    // ── HTML Email Body ──
    const generatedAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const htmlBody = `
      <div style="margin:0;padding:20px 12px;background:#f1f5f9;font:14px/1.6 Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
        <div style="max-width:1120px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.05)">
          <div style="padding:18px 22px;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#ffffff">
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Relcon CRM • Automated Update</p>
            <h2 style="margin:0;font-size:22px;font-weight:700">Pending Status Report</h2>
            <p style="margin:8px 0 0;font-size:13px;opacity:.95">Reporting Window: <strong>${fromDateISO}</strong> to <strong>${endDateISO}</strong> (Last 15 days)</p>
          </div>

          <div style="padding:20px 22px 24px">
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;min-width:170px">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Total Pending</div>
                <div style="font-size:24px;line-height:1.2;font-weight:800;color:#0f172a">${totalPending}</div>
              </div>
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 12px;min-width:150px">
                <div style="font-size:11px;color:#1d4ed8;text-transform:uppercase;letter-spacing:.05em">HPCL</div>
                <div style="font-size:22px;line-height:1.2;font-weight:800;color:#1e40af">${hrCounts.hpcl}</div>
              </div>
              <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 12px;min-width:150px">
                <div style="font-size:11px;color:#c2410c;text-transform:uppercase;letter-spacing:.05em">RBML</div>
                <div style="font-size:22px;line-height:1.2;font-weight:800;color:#9a3412">${hrCounts.rbml}</div>
              </div>
              <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:10px 12px;min-width:150px">
                <div style="font-size:11px;color:#047857;text-transform:uppercase;letter-spacing:.05em">BPCL</div>
                <div style="font-size:22px;line-height:1.2;font-weight:800;color:#065f46">${bpclCounts.bpcl}</div>
              </div>
            </div>

            <p style="margin:12px 0 0;color:#475569;font-size:12px">
              Below sections display up to 300 records each for quick review. The complete report is attached as CSV.
            </p>

            ${buildTable(hrRows.slice(0, 300), columns, "HPCL + RBML Pending")}
            ${buildTable(bpclRows.slice(0, 300), columns, "BPCL Pending")}

            <div style="margin-top:18px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">
              Generated on ${generatedAt} IST. This is a system-generated email from Relcon CRM.
            </div>
          </div>
        </div>
      </div>
    `;

    const subject = `Pending Status Report (15d) • ${fromDateISO} → ${endDateISO} • Total ${totalPending}`;

    const mailOptions = {
      from: MAIL_FROM,
      to: MAIL_TO,
      subject,
      html: htmlBody,
      attachments: [
        { filename: `pending_status_${fromDateISO}_to_${endDateISO}.csv`, content: csv },
      ],
    };

    try {
      await transporter.verify();
    } catch (verifyErr) {
      console.warn("⚠️ Transporter verify failed — continuing:", verifyErr?.message || verifyErr);
    }

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Pending mail sent:", info?.messageId || info);

    try {
      await EmailLog.create({
        type: "Pending Status Report",
        subject,
        to: MAIL_TO,
        status: "success",
        sentAt: new Date(),
        meta: {
          fromDate: fromDateISO,
          toDate: endDateISO,
          totalPending,
          hpcl: hrCounts.hpcl,
          rbml: hrCounts.rbml,
          bpcl: bpclCounts.bpcl,
          messageId: info?.messageId || info,
        },
      });
    } catch (logErr) {
      console.error("⚠️ EmailLog write failed (success):", logErr?.message || logErr);
    }

    return { ok: true, counts: { hpcl: hrCounts.hpcl, rbml: hrCounts.rbml, bpcl: bpclCounts.bpcl, total: totalPending } };

  } catch (err) {
    console.error("sendPendingStatusEmail error:", {
      code: err.code,
      message: err.message,
      responseStatus: err.response?.status,
      responseData: err.response?.data,
    });

    try {
      await EmailLog.create({
        type: "Pending Status Report",
        subject: "Pending Status Report - failure",
        to: MAIL_TO,
        status: "failure",
        sentAt: new Date(),
        meta: {
          error: (err.response?.data || err.message || String(err)).toString(),
          code: err.code || null,
        },
      });
    } catch (logErr) {
      console.error("Failed to write EmailLog (failure):", logErr?.message || logErr);
    }

    return { ok: false, error: err };
  }
}

async function sendUnverifiedStatusEmail() {
  try {
    const token = await getFreshToken();

    const FROM_DATE = "2026-04-01";

    const [hpclRes, jioRes, bpclRes] = await Promise.all([
      axios.get(`${BASE_URL}/getMergedStatusRecords`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${BASE_URL}/jioBP/getAllJioBPStatus`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${BASE_URL}/bpclStatus/getAllBPCLStatus`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const hpcl = hpclRes.data || [];
    const jio = jioRes.data || [];
    const bpcl = bpclRes.data || [];

    // 🔥 FILTER: unverified + date >= 01-04-2026
    const hpclRows = hpcl
      .filter(r => {
        const d = String(r.date || "").slice(0, 10);
        return !r.isVerified && d >= FROM_DATE;
      })
      .map(r => ({
        customer: "HPCL",
        date: r.date,
        roCode: r.roCode,
        roName: r.roName,
        region: r.region,
        engineer: r.engineer,
      }));

    const rbmlRows = jio
      .filter(r => {
        const d = String(r.date || r.planId?.date || "").slice(0, 10);
        return !r.isVerified && d >= FROM_DATE;
      })
      .map(r => ({
        customer: "RBML",
        date: r.date || r.planId?.date,
        roCode: r.roCode || r.planId?.roCode,
        roName: r.roName || r.planId?.roName,
        region: r.region || r.planId?.region,
        engineer: r.engineer || r.planId?.engineer,
      }));

    const bpclRows = bpcl
      .filter(r => {
        const d = String(r.planId?.date || "").slice(0, 10);
        return !r.isVerified && d >= FROM_DATE;
      })
      .map(r => ({
        customer: "BPCL",
        date: r.planId?.date,
        roCode: r.planId?.roCode,
        roName: r.planId?.roName,
        region: r.planId?.region,
        engineer: r.planId?.engineer,
      }));

    let allRows = [...hpclRows, ...rbmlRows, ...bpclRows];

    // 🧠 Aging
    const today = new Date();
    allRows = allRows.map(r => {
      const d = new Date(r.date);
      const agingDays = isNaN(d) ? "" : Math.floor((today - d) / (1000 * 60 * 60 * 24));
      return { ...r, agingDays };
    });

    // 📊 Sort latest first
    allRows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    const total = allRows.length;

    // ✅ SUMMARY
    const summary = {
      HPCL: allRows.filter(r => r.customer === "HPCL").length,
      RBML: allRows.filter(r => r.customer === "RBML").length,
      BPCL: allRows.filter(r => r.customer === "BPCL").length,
    };

    const columns = [
      { key: "customer", label: "Customer" },
      { key: "date", label: "Date" },
      { key: "roCode", label: "RO Code" },
      { key: "roName", label: "RO Name" },
      { key: "region", label: "Region" },
      { key: "engineer", label: "Engineer" },
      { key: "agingDays", label: "Aging (Days)" },
    ];

    const keys = ["customer", "date", "roCode", "roName", "region", "engineer", "agingDays"];

    const headerMap = {
      customer: "Customer",
      date: "Date",
      roCode: "RO Code",
      roName: "RO Name",
      region: "Region",
      engineer: "Engineer",
      agingDays: "Aging (Days)",
    };

    const csv = toCSV(allRows, keys, headerMap);

    // 📧 EMAIL BODY
    const htmlBody = `
<div style="margin:0;padding:0;background:#f4f6f8;font-family:Segoe UI,Roboto,Arial,sans-serif;">
  <div style="max-width:1100px;margin:20px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0;box-shadow:0 4px 20px rgba(0,0,0,0.05);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#ffffff;padding:20px 25px;">
      <h2 style="margin:0;font-size:22px;">Unverified Status Report</h2>
      <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">
        Reporting From <strong>${FROM_DATE}</strong> | Generated on ${new Date().toLocaleString("en-IN")}
      </p>
    </div>

    <!-- Summary Cards -->
    <div style="padding:20px 25px;">
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">

        <div style="flex:1;min-width:180px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
          <div style="font-size:12px;color:#64748b;">TOTAL UNVERIFIED</div>
          <div style="font-size:26px;font-weight:700;color:#0f172a;">${total}</div>
        </div>

        <div style="flex:1;min-width:160px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px;">
          <div style="font-size:12px;color:#1d4ed8;">HPCL</div>
          <div style="font-size:22px;font-weight:700;color:#1e40af;">${summary.HPCL}</div>
        </div>

        <div style="flex:1;min-width:160px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px;">
          <div style="font-size:12px;color:#c2410c;">RBML</div>
          <div style="font-size:22px;font-weight:700;color:#9a3412;">${summary.RBML}</div>
        </div>

        <div style="flex:1;min-width:160px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:14px;">
          <div style="font-size:12px;color:#047857;">BPCL</div>
          <div style="font-size:22px;font-weight:700;color:#065f46;">${summary.BPCL}</div>
        </div>

      </div>

      <!-- Table -->
      ${buildTable(allRows.slice(0, 300), columns, "Unverified Records (Top 300)")}

      <!-- Footer Note -->
      <div style="margin-top:20px;padding:14px;background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;color:#b91c1c;font-size:13px;">
        <strong>Action Required:</strong>  
        Records pending verification should be reviewed at the earliest.  
        High aging entries must be prioritized to avoid SLA breach.
      </div>

      <!-- Footer -->
      <div style="margin-top:18px;font-size:12px;color:#64748b;text-align:center;">
        This is an automated email generated by <strong>Relcon CRM</strong>.
      </div>

    </div>
  </div>
</div>
`;

    const todayStr = new Date().toISOString().slice(0, 10);

    const mailOptions = {
      from: MAIL_FROM,
      to: MAIL_TO,
      subject: `⚠️ Unverified Report | Total: ${total} | H:${summary.HPCL} R:${summary.RBML} B:${summary.BPCL}`,
      html: htmlBody,
      attachments: [
        {
          filename: `unverified_status_${todayStr}.csv`,
          content: csv,
        },
      ],
    };

    await transporter.sendMail(mailOptions);

    console.log("✅ Unverified mail sent with summary + date filter");

  } catch (err) {
    console.error("❌ Unverified mail error:", err.message);
  }
}

async function sendHpclActionRequiredUnverifiedEmail() {
  const reportType = "HPCL Action Required Unverified Report";

  try {
    const [statusRecords, toRecipients, ccRecipients] = await Promise.all([
      Status.find({ isVerified: false }).populate("planId").lean(),
      getUserEmailsByUsernames(["anurag.mishra"]),
      getUserEmailsByUsernames(["nikhil.trivedi"]),
    ]);

    if (!toRecipients.length) {
      await EmailLog.create({
        type: reportType,
        subject: "Skipped: missing recipient for HPCL action required unverified report",
        to: "",
        status: "failure",
        error: "Recipient email not found for anurag.mishra",
      });
      return { ok: false, reason: "missing_to_recipient" };
    }

    const rows = statusRecords
      .filter((record) => isHpclActionRequiredStatusRecord(record))
      .map((record, index) => {
        const plan = record.planId || {};
        return {
          serialNumber: index + 1,
          date: String(plan.date || "").slice(0, 10),
          roCode: plan.roCode || "",
          roName: plan.roName || "",
          region: plan.region || "",
          engineer: plan.engineer || "",
          issue: buildHpclActionRequiredIssue(record),
          earthingStatus: record.earthingStatus || "—",
          voltageReading: record.voltageReading || "—",
          duOffline: record.duOffline || "—",
          duDependency: record.duDependency || "—",
          tankOffline: record.tankOffline || "—",
          tankDependency: record.tankDependency || "—",
        };
      })
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    if (!rows.length) {
      console.log("ℹ️ No unverified HPCL action-required records found for scheduled report.");
      return { ok: true, skipped: true, count: 0 };
    }

    const columns = [
      { key: "serialNumber", label: "S. No." },
      { key: "date", label: "Visit Date" },
      { key: "roCode", label: "RO Code" },
      { key: "roName", label: "RO Name" },
      { key: "region", label: "Region" },
      { key: "engineer", label: "Engineer" },
      { key: "issue", label: "Action Required Issue" },
      { key: "earthingStatus", label: "Earthing" },
      { key: "voltageReading", label: "Voltage" },
      { key: "duOffline", label: "DU Offline" },
      { key: "duDependency", label: "DU Dependency" },
      { key: "tankOffline", label: "Tank Offline" },
      { key: "tankDependency", label: "Tank Dependency" },
    ];

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.7;">
        <p style="margin:0 0 14px;">Dear Anurag,</p>
        <p style="margin:0 0 14px;">
          Please find below the list of HPCL status records where action is required and verification is still pending.
          These records need timely review to avoid follow-up delays and operational dependency closures being missed.
        </p>
        ${buildTable(rows, columns, "HPCL Action Required Records Pending Verification")}
        <p style="margin:18px 0 0;">
          Kindly review and verify the above records on priority.
        </p>
        <p style="margin:14px 0 0;">
          Regards,<br/>
          <strong>Relcon CRM</strong><br/>
          <span style="color:#64748b;font-size:12px;">Generated on ${htmlEscape(formatDateTimeIST(new Date()))} IST.</span>
        </p>
      </div>
    `;

    const subject = `HPCL Status Verification Pending | Action Required Records | ${rows.length} Open`;
    const mailOptions = {
      from: MAIL_FROM,
      to: toRecipients.join(", "),
      cc: ccRecipients.length ? ccRecipients.join(", ") : undefined,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    await EmailLog.create({
      type: reportType,
      subject,
      to: [...new Set([...toRecipients, ...ccRecipients])].join(", "),
      status: "success",
      meta: {
        count: rows.length,
        messageId: info?.messageId || "",
        cc: ccRecipients,
      },
    });
    return { ok: true, count: rows.length, messageId: info?.messageId || "" };
  } catch (err) {
    console.error("❌ HPCL action required unverified mail error:", err.message);
    try {
      await EmailLog.create({
        type: reportType,
        subject: "HPCL action required unverified report - failure",
        to: "",
        status: "failure",
        error: err.message,
      });
    } catch (logErr) {
      console.error("Failed to write EmailLog for HPCL action required report:", logErr?.message || logErr);
    }
    return { ok: false, error: err };
  }
}

async function sendFaultyMaterialDispatchAlerts() {
  const alertType = "Faulty Material Dispatch Alert";

  try {
    const [faultyMaterials, users] = await Promise.all([
      MaterialManagement.find({
        isActive: true,
        itemStatus: "Not Ok (Faulty)",
        qty: { $gt: 0 },
      })
        .sort({ engineerName: 1, updatedAt: -1, createdAt: -1 })
        .lean(),
      User.find({}, "username email role engineerName").lean(),
    ]);

    const adminEmails = [...new Set(
      users
        .filter((user) => String(user.role || "").trim().toLowerCase() === "admin")
        .map((user) => normalizeEmail(user.email))
        .filter(Boolean)
    )];

    const engineerMap = new Map();
    for (const user of users) {
      const key = String(user.engineerName || "").trim().toLowerCase();
      if (!key) continue;
      if (!engineerMap.has(key)) engineerMap.set(key, []);
      engineerMap.get(key).push(user);
    }

    const grouped = new Map();
    for (const item of faultyMaterials) {
      const key = String(item.engineerName || "").trim().toLowerCase();
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }

    const summary = {
      sent: 0,
      skippedNoEngineerEmail: 0,
      skippedBelowThreshold: 0,
      skippedNoAdminEmail: 0,
      totalEngineersReviewed: grouped.size,
    };

    for (const [engineerKey, materials] of grouped.entries()) {
      const faultyQty = materials.reduce((sum, row) => sum + Number(row.qty || 0), 0);
      if (faultyQty < 4) {
        summary.skippedBelowThreshold += 1;
        continue;
      }

      const engineerUsers = engineerMap.get(engineerKey) || [];
      const engineerEmails = [...new Set(
        engineerUsers.map((user) => normalizeEmail(user.email)).filter(Boolean)
      )];
      const engineerName = materials[0]?.engineerName || engineerUsers[0]?.engineerName || "Engineer";

      if (!engineerEmails.length) {
        summary.skippedNoEngineerEmail += 1;
        await EmailLog.create({
          type: alertType,
          subject: `Skipped: missing engineer email for ${engineerName}`,
          to: "",
          status: "failure",
          sentAt: new Date(),
          meta: {
            engineerName,
            faultyQty,
            materialRows: materials.length,
            reason: "Engineer email not found in users collection",
          },
        });
        continue;
      }

      if (!adminEmails.length) {
        summary.skippedNoAdminEmail += 1;
        await EmailLog.create({
          type: alertType,
          subject: `Skipped: missing admin CC for ${engineerName}`,
          to: engineerEmails.join(", "),
          status: "failure",
          sentAt: new Date(),
          meta: {
            engineerName,
            faultyQty,
            materialRows: materials.length,
            reason: "No admin email found in users collection",
          },
        });
        continue;
      }

      const materialRows = materials.map((row) => ({
        serialNumber: row.serialNumber || "—",
        itemCode: row.itemCode || "—",
        itemName: row.itemName || "—",
        qty: Number(row.qty || 0),
        itemType: row.itemType || "—",
        itemStatus: row.itemStatus || "—",
        remarks: row.remarks || "",
        updatedAt: row.updatedAt || row.createdAt || new Date(),
      }));

      const uniqueItemCount = materialRows.length;
      const generatedAt = formatDateTimeIST(new Date());
      const htmlBody = `
        <div style="margin:0;padding:20px 12px;background:#f1f5f9;font:14px/1.6 Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
          <div style="max-width:1080px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.05)">
            <div style="padding:18px 22px;background:linear-gradient(135deg,#0f172a,#1d4ed8);color:#ffffff">
              <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Relcon CRM • Automated Material Alert</p>
              <h2 style="margin:0;font-size:22px;font-weight:700">Material Dispatch Required</h2>
              <p style="margin:8px 0 0;font-size:13px;opacity:.95">Dispatch threshold has been reached for faulty materials mapped to <strong>${htmlEscape(engineerName)}</strong>.</p>
            </div>

            <div style="padding:22px">
              <p style="margin:0 0 14px;font-size:13px;color:#334155">
                Dear <strong>${htmlEscape(engineerName)}</strong>,
              </p>
              <p style="margin:0 0 14px;font-size:13px;color:#475569">
                This is to formally notify you that the quantity of faulty materials currently assigned to your name in Relcon CRM has reached the dispatch threshold. You are requested to arrange dispatch of the below materials at the earliest possible opportunity.
              </p>
              <p style="margin:0 0 16px;font-size:13px;color:#475569">
                Please review the material details carefully and coordinate the dispatch process with the admin team, including handover confirmation, courier reference, or any other supporting dispatch details required for proper tracking and reconciliation.
              </p>

              <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 12px;min-width:180px">
                  <div style="font-size:11px;color:#9a3412;text-transform:uppercase;letter-spacing:.05em">Faulty Quantity</div>
                  <div style="font-size:24px;line-height:1.2;font-weight:800;color:#c2410c">${faultyQty}</div>
                </div>
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 12px;min-width:180px">
                  <div style="font-size:11px;color:#1d4ed8;text-transform:uppercase;letter-spacing:.05em">Faulty Entries</div>
                  <div style="font-size:24px;line-height:1.2;font-weight:800;color:#1e40af">${uniqueItemCount}</div>
                </div>
              </div>

              ${buildMaterialDispatchTable(materialRows)}

              <div style="margin-top:18px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;color:#475569;font-size:13px">
                <strong style="color:#0f172a">Action required:</strong> Please ensure dispatch of the above faulty materials on priority and share the dispatch confirmation with the admin team for further processing.
              </div>

              <p style="margin:18px 0 0;font-size:13px;color:#475569">
                Your prompt action will help us maintain material availability, repair turnaround, and inventory accuracy across operations.
              </p>

              <p style="margin:14px 0 0;font-size:13px;color:#475569">
                Regards,<br>
                <strong style="color:#0f172a">Relcon CRM System</strong>
              </p>

              <div style="margin-top:18px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">
                Generated on ${generatedAt} IST. This is a system-generated notification from Relcon CRM.
              </div>
            </div>
          </div>
        </div>
      `;

      const subject = `Action Required: Faulty Material Dispatch | ${engineerName} | Qty ${faultyQty}`;
      const mailOptions = {
        from: MAIL_FROM,
        to: engineerEmails.join(", "),
        cc: adminEmails.join(", "),
        subject,
        html: htmlBody,
      };

      const info = await transporter.sendMail(mailOptions);

      await EmailLog.create({
        type: alertType,
        subject,
        to: engineerEmails.join(", "),
        status: "success",
        sentAt: new Date(),
        meta: {
          cc: adminEmails.join(", "),
          engineerName,
          faultyQty,
          materialRows: uniqueItemCount,
          messageId: info?.messageId || "",
        },
      });

      summary.sent += 1;
    }

    console.log("✅ Faulty material dispatch alert summary:", summary);
    return { ok: true, summary };
  } catch (err) {
    console.error("❌ Faulty material dispatch alert error:", err.message);

    try {
      await EmailLog.create({
        type: alertType,
        subject: "Faulty material dispatch alert - failure",
        to: "",
        status: "failure",
        sentAt: new Date(),
        meta: {
          error: err.message || String(err),
        },
      });
    } catch (logErr) {
      console.error("Failed to write EmailLog for faulty material alert:", logErr?.message || logErr);
    }

    return { ok: false, error: err };
  }
}

async function sendMonthlyAttendanceSheet({ baseDate = new Date() } = {}) {
  const reportType = "Monthly Attendance Sheet";

  try {
    const { fromDateISO, toDateISO, label } = getPreviousMonthRange(baseDate);

    const [users, attendanceRecords] = await Promise.all([
      User.find({}, "username email role engineerName").lean(),
      Attendance.find({ date: { $gte: fromDateISO, $lte: toDateISO } }).sort({ engineerName: 1, date: 1 }).lean(),
    ]);

    const adminEmails = [...new Set(
      users
        .filter((user) => String(user.role || "").trim().toLowerCase() === "admin")
        .map((user) => normalizeEmail(user.email))
        .filter(Boolean)
    )];

    if (!adminEmails.length) {
      await EmailLog.create({
        type: reportType,
        subject: `Skipped: admin emails missing for ${label}`,
        to: "",
        status: "failure",
        sentAt: new Date(),
        meta: {
          fromDateISO,
          toDateISO,
          reason: "No admin email found in users collection",
        },
      });
      return { ok: false, reason: "missing_admin_emails" };
    }

    const engineerNames = [...new Set([
      ...users
        .filter((user) => String(user.role || "").trim().toLowerCase() === "engineer")
        .map((user) => String(user.engineerName || user.username || "").trim())
        .filter(Boolean),
      ...attendanceRecords
        .map((record) => String(record.engineerName || record.username || "").trim())
        .filter(Boolean),
    ])].sort((a, b) => a.localeCompare(b));

    const workbookBuffer = buildAttendanceWorkbookBuffer({
      engineerNames,
      records: attendanceRecords,
      fromDateISO,
      toDateISO,
    });

    const monthDates = getDateRangeISO(fromDateISO, toDateISO);
    const sundayCount = monthDates.filter(isSundayISO).length;
    const generatedAt = formatDateTimeIST(new Date());

    const htmlBody = `
      <div style="margin:0;padding:20px 12px;background:#f1f5f9;font:14px/1.6 Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
        <div style="max-width:980px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.05)">
          <div style="padding:18px 22px;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#ffffff">
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Relcon CRM • Monthly HR Report</p>
            <h2 style="margin:0;font-size:22px;font-weight:700">Monthly Attendance Sheet</h2>
            <p style="margin:8px 0 0;font-size:13px;opacity:.95">Attendance report for <strong>${htmlEscape(label)}</strong> is attached for review.</p>
          </div>

          <div style="padding:22px">
            <p style="margin:0 0 14px;font-size:13px;color:#334155">
              Dear Admin Team,
            </p>
            <p style="margin:0 0 14px;font-size:13px;color:#475569">
              Please find attached the consolidated attendance sheet for <strong>${htmlEscape(label)}</strong>. The workbook includes an attendance matrix, an engineer-wise summary, and detailed attendance records for the full month.
            </p>
            <p style="margin:0 0 18px;font-size:13px;color:#475569">
              Sundays have been marked as <strong>WO (Week Off)</strong> in the report for each engineer wherever no manual attendance record existed for those dates.
            </p>

            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 12px;min-width:180px">
                <div style="font-size:11px;color:#1d4ed8;text-transform:uppercase;letter-spacing:.05em">Engineers Covered</div>
                <div style="font-size:24px;line-height:1.2;font-weight:800;color:#1e40af">${engineerNames.length}</div>
              </div>
              <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:10px 12px;min-width:180px">
                <div style="font-size:11px;color:#047857;text-transform:uppercase;letter-spacing:.05em">Attendance Entries</div>
                <div style="font-size:24px;line-height:1.2;font-weight:800;color:#065f46">${attendanceRecords.length}</div>
              </div>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;min-width:180px">
                <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.05em">Sundays Marked WO</div>
                <div style="font-size:24px;line-height:1.2;font-weight:800;color:#0f172a">${sundayCount}</div>
              </div>
            </div>

            <div style="padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;color:#475569;font-size:13px">
              <strong style="color:#0f172a">Attachment includes:</strong> Attendance Sheet, Summary, and Detailed Records.
            </div>

            <p style="margin:18px 0 0;font-size:13px;color:#475569">
              Regards,<br>
              <strong style="color:#0f172a">Relcon CRM System</strong>
            </p>

            <div style="margin-top:18px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">
              Generated on ${generatedAt} IST. This is a system-generated email from Relcon CRM.
            </div>
          </div>
        </div>
      </div>
    `;

    const subject = `Monthly Attendance Sheet | ${label} | ${fromDateISO} to ${toDateISO}`;
    const attachmentName = `attendance_sheet_${fromDateISO}_to_${toDateISO}.xlsx`;
    const info = await transporter.sendMail({
      from: MAIL_FROM,
      to: adminEmails.join(", "),
      subject,
      html: htmlBody,
      attachments: [
        {
          filename: attachmentName,
          content: workbookBuffer,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    });

    await EmailLog.create({
      type: reportType,
      subject,
      to: adminEmails.join(", "),
      status: "success",
      sentAt: new Date(),
      meta: {
        fromDateISO,
        toDateISO,
        month: label,
        engineerCount: engineerNames.length,
        attendanceRecordCount: attendanceRecords.length,
        messageId: info?.messageId || "",
      },
    });

    console.log("✅ Monthly attendance sheet sent:", info?.messageId || info);
    return { ok: true, month: label, adminCount: adminEmails.length, engineerCount: engineerNames.length };
  } catch (err) {
    console.error("❌ Monthly attendance sheet error:", err.message);

    try {
      await EmailLog.create({
        type: reportType,
        subject: "Monthly attendance sheet - failure",
        to: "",
        status: "failure",
        sentAt: new Date(),
        meta: {
          error: err.message || String(err),
        },
      });
    } catch (logErr) {
      console.error("Failed to write EmailLog for monthly attendance sheet:", logErr?.message || logErr);
    }

    return { ok: false, error: err };
  }
}

async function sendVerificationCorrectionEmail({
  category = "Status",
  engineerName = "",
  roCode = "",
  roName = "",
  visitDate = "",
  correctedBy = "",
  changes = [],
} = {}) {
  const reportType = `${category} Verification Correction Alert`;

  try {
    if (!engineerName || !changes.length) {
      return { ok: false, reason: "missing_engineer_or_changes" };
    }

    const users = await User.find({}, "email role engineerName username").lean();
    const engineerEmails = [...new Set(
      users
        .filter((user) => {
          const role = String(user.role || "").trim().toLowerCase();
          const name = String(user.engineerName || user.username || "").trim().toLowerCase();
          return role === "engineer" && name === String(engineerName).trim().toLowerCase();
        })
        .map((user) => normalizeEmail(user.email))
        .filter(Boolean)
    )];

    const adminEmails = [...new Set(
      users
        .filter((user) => String(user.role || "").trim().toLowerCase() === "admin")
        .map((user) => normalizeEmail(user.email))
        .filter(Boolean)
    )];

    if (!engineerEmails.length) {
      await EmailLog.create({
        type: reportType,
        subject: `Skipped: engineer email missing for ${engineerName}`,
        to: "",
        status: "failure",
        sentAt: new Date(),
        meta: { engineerName, roCode, roName, visitDate, reason: "Engineer email not found" },
      });
      return { ok: false, reason: "missing_engineer_email" };
    }

    const generatedAt = formatDateTimeIST(new Date());
    const correctionReason = "The record was corrected during admin verification because one or more submitted values did not match the required reporting standard or final site observations.";
    const textBody = [
      `Dear ${engineerName},`,
      "",
      `This is to inform you that your submitted ${category} record has been reviewed during verification, and certain entries were corrected by the admin team before final approval.`,
      "",
      "Please review the corrected details below and ensure future submissions are entered accurately at the time of reporting.",
      "",
      "Record Details:",
      `RO Code: ${roCode || "-"}`,
      `Site Name: ${roName || "-"}`,
      `Visit Date: ${visitDate || "-"}`,
      `Corrected By: ${correctedBy || "Admin"}`,
      "",
      `Reason for Correction: ${correctionReason}`,
      "",
      "Correction Summary:",
      buildCorrectionSummaryText(changes),
      "",
      "Please take care to submit future records correctly to avoid verification delays and rework.",
      "",
      "Regards,",
      "Relcon CRM Team",
      "",
      `Generated on ${generatedAt} IST`,
    ].join("\n");
    const htmlBody = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#111;">
        <p>Dear <b>${htmlEscape(engineerName)}</b>,</p>
        <p>
          This is to inform you that your submitted <b>${htmlEscape(category)}</b> record has been reviewed during verification,
          and certain entries were corrected by the admin team before final approval.
        </p>
        <p>
          Please review the corrected details below and ensure future submissions are entered accurately at the time of reporting.
        </p>
        <p style="margin:16px 0 8px;"><b>Record Details</b></p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
          <tbody>
            <tr>
              <td style="border:1px solid #000;padding:8px;width:25%;"><b>RO Code</b></td>
              <td style="border:1px solid #000;padding:8px;">${htmlEscape(roCode || "-")}</td>
              <td style="border:1px solid #000;padding:8px;width:25%;"><b>Site Name</b></td>
              <td style="border:1px solid #000;padding:8px;">${htmlEscape(roName || "-")}</td>
            </tr>
            <tr>
              <td style="border:1px solid #000;padding:8px;"><b>Visit Date</b></td>
              <td style="border:1px solid #000;padding:8px;">${htmlEscape(visitDate || "-")}</td>
              <td style="border:1px solid #000;padding:8px;"><b>Corrected By</b></td>
              <td style="border:1px solid #000;padding:8px;">${htmlEscape(correctedBy || "Admin")}</td>
            </tr>
          </tbody>
        </table>
        <p style="margin:16px 0 0;"><b>Reason for Correction:</b> ${htmlEscape(correctionReason)}</p>
        <p style="margin:16px 0 8px;"><b>Correction Summary</b></p>
        ${buildCorrectionSummaryHtml(changes)}
        <p style="margin-top:16px;">
          Please take care to submit future records correctly to avoid verification delays and rework.
        </p>
        <p style="margin-top:16px;">
          Regards,<br>
          <b>Relcon CRM Team</b>
        </p>
        <p style="margin-top:16px;">Generated on ${htmlEscape(generatedAt)} IST</p>
      </div>
    `;

    const subject = `Correction Notice | ${category} Verified | ${roCode || "RO"} | ${roName || engineerName}`;
    const info = await transporter.sendMail({
      from: MAIL_FROM,
      to: engineerEmails.join(", "),
      cc: adminEmails.join(", "),
      subject,
      html: htmlBody,
      text: textBody,
    });

    await EmailLog.create({
      type: reportType,
      subject,
      to: engineerEmails.join(", "),
      status: "success",
      sentAt: new Date(),
      meta: {
        cc: adminEmails.join(", "),
        engineerName,
        roCode,
        roName,
        visitDate,
        correctedBy,
        changeCount: changes.length,
        messageId: info?.messageId || "",
      },
    });

    return { ok: true };
  } catch (err) {
    console.error("❌ Verification correction mail error:", err.message);
    return { ok: false, error: err };
  }
}

async function sendMissingMorningDataViewEntryAlert() {
  const reportType = "Missing Morning Data View Entry Alert";

  try {
    const { dateISO: todayISO, weekdayShort } = getCurrentISTDateParts();
    if (weekdayShort === "sun") {
      return { ok: true, skipped: true, reason: "sunday" };
    }

    const alreadySent = await EmailLog.findOne({
      type: reportType,
      status: "success",
      "meta.alertDate": todayISO,
    }).lean();
    if (alreadySent) {
      return { ok: true, skipped: true, reason: "already_sent", alertDate: todayISO };
    }

    const [users, todayPlans] = await Promise.all([
      User.find({}, "email role engineerName username").lean(),
      DailyPlan.find({ date: todayISO }).lean(),
    ]);

    const engineerUsers = users.filter((user) => String(user.role || "").trim().toLowerCase() === "engineer");
    const submittedEngineers = new Set(
      todayPlans
        .map((plan) => normalizePlanKeyPart(plan.engineer || ""))
        .filter(Boolean)
    );

    const missingEngineers = [...new Set(
      engineerUsers
        .map((user) => String(user.engineerName || user.username || "").trim())
        .filter(Boolean)
        .filter((name) => !submittedEngineers.has(normalizePlanKeyPart(name)))
    )].sort((a, b) => a.localeCompare(b));

    if (!missingEngineers.length) {
      return { ok: true, skipped: true, reason: "no_missing_entries", alertDate: todayISO };
    }

    const nikhilRecipients = [...new Set(
      users
        .filter((user) => {
          const username = String(user.username || "").trim().toLowerCase();
          const engineerName = String(user.engineerName || "").trim().toLowerCase();
          return username === "nikhil.trivedi" || engineerName === "nikhil trivedi";
        })
        .map((user) => normalizeEmail(user.email))
        .filter(Boolean)
    )];

    const toRecipients = nikhilRecipients.length ? nikhilRecipients : [normalizeEmail(MAIL_TO)].filter(Boolean);
    if (!toRecipients.length) {
      await EmailLog.create({
        type: reportType,
        subject: `Skipped: recipient email missing for ${todayISO}`,
        to: "",
        status: "failure",
        sentAt: new Date(),
        meta: { alertDate: todayISO, reason: "recipient_email_missing", missingCount: missingEngineers.length },
      });
      return { ok: false, reason: "recipient_email_missing" };
    }

    const rowsHtml = missingEngineers
      .map((name, index) => `
        <tr>
          <td style="border:1px solid #000;padding:8px;">${index + 1}</td>
          <td style="border:1px solid #000;padding:8px;">${htmlEscape(name)}</td>
        </tr>
      `)
      .join("");

    const subject = `Pending Morning Entry Alert | ${todayISO} | ${missingEngineers.length} User(s)`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#111;">
        <p>Dear <b>Nikhil Trivedi</b>,</p>
        <p>
          Please find below the list of users whose data view entry for <b>${htmlEscape(todayISO)}</b>
          has not been submitted before <b>09:30 AM IST</b>.
        </p>
        <p style="margin:16px 0 8px;"><b>Pending User List</b></p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
          <thead>
            <tr>
              <th style="border:1px solid #000;padding:8px;text-align:left;"><b>S. No.</b></th>
              <th style="border:1px solid #000;padding:8px;text-align:left;"><b>User Name</b></th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <p style="margin-top:16px;">
          Total pending users: <b>${missingEngineers.length}</b>
        </p>
        <p style="margin-top:16px;">
          Regards,<br>
          <b>Relcon CRM System</b>
        </p>
      </div>
    `;

    const text = [
      "Dear Nikhil Trivedi,",
      "",
      `Please find below the list of users whose data view entry for ${todayISO} has not been submitted before 09:30 AM IST.`,
      "",
      "Pending User List:",
      ...missingEngineers.map((name, index) => `${index + 1}. ${name}`),
      "",
      `Total pending users: ${missingEngineers.length}`,
      "",
      "Regards,",
      "Relcon CRM System",
    ].join("\n");

    const info = await transporter.sendMail({
      from: MAIL_FROM,
      to: toRecipients.join(", "),
      subject,
      html,
      text,
    });

    await EmailLog.create({
      type: reportType,
      subject,
      to: toRecipients.join(", "),
      status: "success",
      sentAt: new Date(),
      meta: {
        alertDate: todayISO,
        missingCount: missingEngineers.length,
        missingEngineers,
        messageId: info?.messageId || "",
      },
    });

    return { ok: true, alertDate: todayISO, missingCount: missingEngineers.length };
  } catch (err) {
    console.error("❌ Missing morning data view entry alert error:", err.message);
    return { ok: false, error: err };
  }
}

async function sendPendingStatusReminderAlerts() {
  const reportType = "Pending Status Reminder Alert";

  try {
    const [plans, users, hpclStatuses, rbmlStatuses, bpclStatuses] = await Promise.all([
      DailyPlan.find({ date: { $gt: PENDING_STATUS_REMINDER_PLAN_DATE_CUTOFF } }).lean(),
      User.find({}, "email role engineerName username").lean(),
      Status.find({}, "planId").lean(),
      JioBPStatus.find({}, "planId").lean(),
      BPCLStatus.find({}, "planId").lean(),
    ]);

    const hpclPlanIds = new Set(hpclStatuses.map((row) => String(row.planId || "")));
    const rbmlPlanIds = new Set(rbmlStatuses.map((row) => String(row.planId || "")));
    const bpclPlanIds = new Set(bpclStatuses.map((row) => String(row.planId || "")));

    const adminEmails = [...new Set(
      users
        .filter((user) => String(user.role || "").trim().toLowerCase() === "admin")
        .map((user) => normalizeEmail(user.email))
        .filter(Boolean)
    )];

    const now = new Date();
    const summary = {
      reminders24: 0,
      warnings48: 0,
      skippedNoEngineerEmail: 0,
      skippedBeforeCutoff: 0,
      skippedDuplicateRecordKey: 0,
    };
    const processedRecordKeys = new Set();

    for (const plan of plans) {
      const createdAt = getPlanCreatedAt(plan);
      if (!createdAt) continue;
      if (!isPlanAfterReminderCutoff(plan)) {
        summary.skippedBeforeCutoff += 1;
        continue;
      }
      const purpose = String(plan.purpose || "").trim().toUpperCase();
      if (purpose === "NO PLAN" || purpose === "IN LEAVE") continue;
      if (isNayaraPlan(plan)) continue;
      if (isRemotelyAmcPlan(plan)) continue;
      if (isOfficePlan(plan)) continue;

      const recordKey = getPendingStatusRecordKey(plan);
      if (!recordKey || /^\|*\s*$/.test(recordKey)) continue;
      if (processedRecordKeys.has(recordKey)) {
        summary.skippedDuplicateRecordKey += 1;
        continue;
      }

      const category = getPlanStatusCategory(plan);
      if (!["HPCL", "RBML", "BPCL"].includes(category)) continue;
      const planId = String(plan._id || "");
      const statusExists =
        category === "BPCL" ? bpclPlanIds.has(planId)
        : category === "RBML" ? rbmlPlanIds.has(planId)
        : hpclPlanIds.has(planId);

      if (statusExists) continue;

      const ageHours = Math.floor((now - createdAt) / (1000 * 60 * 60));
      const relatedPlans = plans.filter((item) => getPendingStatusRecordKey(item) === recordKey);
      const reminderAlreadySent = relatedPlans.some((item) => !!item.reminder24SentAt);
      const warningAlreadySent = relatedPlans.some((item) => !!item.warning48SentAt);
      const shouldSend48 = ageHours >= 48 && !warningAlreadySent;
      const shouldSend24 = ageHours >= 24 && !reminderAlreadySent && !warningAlreadySent && !shouldSend48;
      if (!shouldSend24 && !shouldSend48) continue;

      const engineerName = String(plan.engineer || "").trim();
      const engineerEmails = [...new Set(
        users
          .filter((user) => {
            const role = String(user.role || "").trim().toLowerCase();
            const name = String(user.engineerName || user.username || "").trim().toLowerCase();
            return role === "engineer" && name === engineerName.toLowerCase();
          })
          .map((user) => normalizeEmail(user.email))
          .filter(Boolean)
      )];

      if (!engineerEmails.length) {
        summary.skippedNoEngineerEmail += 1;
        continue;
      }

      const severity = shouldSend48 ? "warning" : "reminder";
      const subject = shouldSend48
        ? `Escalation Warning: ${category} Status Pending Beyond 48 Hours | ${plan.roCode || "RO"} | ${plan.roName || engineerName}`
        : `Reminder: ${category} Status Pending Beyond 24 Hours | ${plan.roCode || "RO"} | ${plan.roName || engineerName}`;

      const { html, text } = getPendingStatusMailBody({
        severity,
        engineerName,
        roCode: plan.roCode || "",
        roName: plan.roName || "",
        visitDate: plan.date || "",
        phase: plan.phase || "",
        ageHours,
      });

      const info = await transporter.sendMail({
        from: MAIL_FROM,
        to: engineerEmails.join(", "),
        cc: adminEmails.join(", "),
        subject,
        html,
        text,
      });

      const sentAt = new Date();
      const updateFields = shouldSend48
        ? { warning48SentAt: sentAt }
        : { reminder24SentAt: sentAt };
      await DailyPlan.updateMany(
        {
          roCode: plan.roCode || "",
          date: getPlanVisitDateISO(plan),
          engineer: plan.engineer || "",
          phase: plan.phase || "",
        },
        updateFields
      );
      relatedPlans.forEach((item) => {
        if (shouldSend48) item.warning48SentAt = sentAt;
        else item.reminder24SentAt = sentAt;
      });
      processedRecordKeys.add(recordKey);

      await EmailLog.create({
        type: reportType,
        subject,
        to: engineerEmails.join(", "),
        status: "success",
        sentAt: new Date(),
        meta: {
          cc: adminEmails.join(", "),
          category,
          severity,
          planId,
          engineerName,
          roCode: plan.roCode || "",
          roName: plan.roName || "",
          visitDate: getPlanVisitDateISO(plan),
          ageHours,
          messageId: info?.messageId || "",
        },
      });

      if (shouldSend48) summary.warnings48 += 1;
      else summary.reminders24 += 1;
    }

    console.log("✅ Pending status reminder summary:", summary);
    return { ok: true, summary };
  } catch (err) {
    console.error("❌ Pending status reminder alert error:", err.message);
    return { ok: false, error: err };
  }
}

async function sendMaterialUploadScheduleReminder() {
  try {
    return { ok: true, skipped: true, reason: "disabled_by_policy" };
  } catch (err) {
    console.error("❌ Material upload schedule reminder email error:", err.message);
    return { ok: false, error: err };
  }
}

async function sendMaterialSheetUploadReminder() {
  const reportType = "Material Sheet Upload Reminder";

  try {
    const [toRecipients, ccRecipients] = await Promise.all([
      getUserEmailsByUsernames(["anurag.mishra"]),
      getUserEmailsByUsernames(["nikhil.trivedi"]),
    ]);
    if (!toRecipients.length) {
      await EmailLog.create({
        type: reportType,
        subject: "Skipped: missing recipient for material sheet upload reminder",
        to: "",
        status: "failure",
        error: "Recipient email not found for anurag.mishra",
      });
      return { ok: false, reason: "missing_to_recipient" };
    }

    const subject = "Reminder: Material Management Sheet Upload Due Today";
    const text = [
      "Dear Anurag,",
      "",
      "This is a scheduled reminder to upload the latest Material Management sheet in the RELCON CRM system today.",
      "",
      "Please ensure that the uploaded sheet is complete, accurate, and reflects the most recent material position so that inventory visibility and downstream operations remain aligned.",
      "",
      "Recommended checks before upload:",
      "1. Confirm the latest stock quantities are updated.",
      "2. Ensure item status and engineer allocation are accurate.",
      "3. Verify that duplicate or outdated rows are removed from the source file.",
      "",
      "Kindly complete the upload at the earliest convenience within today's working cycle.",
      "",
      "Regards,",
      "Relcon CRM",
      `Generated on ${formatDateTimeIST(new Date())} IST`,
    ].join("\n");

    const info = await transporter.sendMail({
      from: MAIL_FROM,
      to: toRecipients.join(", "),
      cc: ccRecipients.length ? ccRecipients.join(", ") : undefined,
      subject,
      text,
    });

    await EmailLog.create({
      type: reportType,
      subject,
      to: [...new Set([...toRecipients, ...ccRecipients])].join(", "),
      status: "success",
      meta: {
        messageId: info?.messageId || "",
        schedule: "Wednesday and Friday at 11:30 IST",
        cc: ccRecipients,
      },
    });

    return { ok: true, messageId: info?.messageId || "" };
  } catch (err) {
    console.error("❌ Material sheet upload reminder email error:", err.message);
    try {
      await EmailLog.create({
        type: reportType,
        subject: "Material sheet upload reminder - failure",
        to: "",
        status: "failure",
        error: err.message,
      });
    } catch (logErr) {
      console.error("Failed to write EmailLog for material sheet upload reminder:", logErr?.message || logErr);
    }
    return { ok: false, error: err };
  }
}

async function runScheduledMaterialUpload() {
  try {
    const schedule = await MaterialUploadSchedule.findOne({ moduleKey: "material-management" });
    if (!schedule?.scheduledDate || !schedule?.scheduledTime || !schedule?.scheduledFileBuffer) {
      return { ok: true, skipped: true, reason: "missing_schedule_or_file" };
    }

    const dueAtIST = parseISTDateTime(schedule.scheduledDate, schedule.scheduledTime);
    if (!dueAtIST) return { ok: false, skipped: true, reason: "invalid_schedule" };

    const nowIST = getISTNowDate();
    if (nowIST < dueAtIST) return { ok: true, skipped: true, reason: "not_due_yet" };

    const scheduleKey = `${schedule.scheduledDate} ${schedule.scheduledTime}`;
    if (schedule.lastProcessedScheduleKey === scheduleKey) {
      return { ok: true, skipped: true, reason: "already_processed" };
    }

    const result = await importMaterialFileBuffer(schedule.scheduledFileBuffer, {
      actorName: "Material Scheduler",
      processedScheduleKey: scheduleKey,
    });

    if (!result.success) {
      const subject = `Material Scheduler Failed | ${scheduleKey} IST`;
      const html = `
        <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6;">
          <p>Dear Team,</p>
          <p>The scheduled Material Management auto-upload could not be completed.</p>
          <p><strong>Scheduled time:</strong> ${htmlEscape(scheduleKey)} IST</p>
          <p><strong>Reason:</strong> ${htmlEscape(result.message || "Unknown error")}</p>
          <p>Please open Material Management and upload a corrected file manually.</p>
        </div>
      `;
      await transporter.sendMail({ from: MAIL_FROM, to: MAIL_TO, subject, html });
      return { ok: false, skipped: false, reason: result.message || "upload_failed" };
    }

    const generatedAt = formatDateTimeIST(new Date());
    const subject = `Material Upload Completed Successfully | ${scheduleKey} IST`;
    const html = `
      <div style="margin:0;padding:20px 12px;background:#f1f5f9;font:14px/1.6 Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
        <div style="max-width:920px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.05)">
          <div style="padding:18px 22px;background:linear-gradient(135deg,#0f172a,#14532d);color:#ffffff">
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Relcon CRM • Inventory Operations</p>
            <h2 style="margin:0;font-size:22px;font-weight:700">Material Upload Completed Successfully</h2>
            <p style="margin:8px 0 0;font-size:13px;opacity:.95">The scheduled material refresh has been processed and inventory data has been updated successfully.</p>
          </div>

          <div style="padding:22px">
            <p style="margin:0 0 14px;font-size:13px;color:#334155">
              Dear Team,
            </p>
            <p style="margin:0 0 16px;font-size:13px;color:#475569">
              This is to confirm that the scheduled <strong>Material Management</strong> upload has completed successfully. The latest file has been processed and the inventory dataset is now refreshed in the system.
            </p>

            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 12px;min-width:190px">
                <div style="font-size:11px;color:#1d4ed8;text-transform:uppercase;letter-spacing:.05em">Scheduled Window</div>
                <div style="font-size:20px;line-height:1.25;font-weight:800;color:#1e3a8a">${htmlEscape(scheduleKey)} IST</div>
              </div>
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;min-width:190px">
                <div style="font-size:11px;color:#15803d;text-transform:uppercase;letter-spacing:.05em">Fresh Rows Imported</div>
                <div style="font-size:24px;line-height:1.2;font-weight:800;color:#166534">${htmlEscape(String(result.inserted || 0))}</div>
              </div>
              <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:10px 12px;min-width:190px">
                <div style="font-size:11px;color:#c2410c;text-transform:uppercase;letter-spacing:.05em">Previous Rows Replaced</div>
                <div style="font-size:24px;line-height:1.2;font-weight:800;color:#9a3412">${htmlEscape(String(result.deletedCount || 0))}</div>
              </div>
            </div>

            <div style="padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;color:#475569;font-size:13px">
              <div style="margin-bottom:6px;"><strong style="color:#0f172a">Upload Summary</strong></div>
              <div><strong>Skipped duplicates:</strong> ${htmlEscape(String(result.skipped || 0))}</div>
              <div><strong>Import mode:</strong> Replace existing records after validation</div>
              <div><strong>Status:</strong> Material Management is now aligned with the latest uploaded sheet</div>
            </div>

            <p style="margin:18px 0 0;font-size:13px;color:#475569">
              No further action is required unless you would like to schedule the next material refresh window.
            </p>

            <p style="margin:18px 0 0;font-size:13px;color:#475569">
              Regards,<br>
              <strong style="color:#0f172a">Relcon CRM System</strong>
            </p>

            <div style="margin-top:18px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">
              Generated on ${generatedAt} IST. This is a system-generated email from Relcon CRM.
            </div>
          </div>
        </div>
      </div>
    `;
    const text = [
      "Dear Team,",
      "",
      "The scheduled Material Management upload has completed successfully.",
      "",
      `Scheduled Window: ${scheduleKey} IST`,
      `Fresh Rows Imported: ${result.inserted || 0}`,
      `Previous Rows Replaced: ${result.deletedCount || 0}`,
      `Skipped Duplicates: ${result.skipped || 0}`,
      "",
      "Material Management is now refreshed with the latest uploaded sheet.",
      "",
      "Regards,",
      "Relcon CRM System",
    ].join("\n");
    await transporter.sendMail({ from: MAIL_FROM, to: MAIL_TO, subject, html, text });
    console.log("✅ Scheduled material upload completed for", scheduleKey);
    return { ok: true, processed: true, scheduleKey, result };
  } catch (err) {
    console.error("❌ Scheduled material upload error:", err.message);
    return { ok: false, error: err };
  }
}
// ─── Scheduler: daily 10:50 IST ───────────────────────────────────────────────

cron.schedule(
  "50 10 * * *",
  () => {
    console.log("🔔 Scheduled pending-status job triggered (14:30 IST):", new Date().toISOString());
    sendPendingStatusEmail().catch((e) => console.error("Scheduled job error:", e));
  },
  { timezone: "Asia/Kolkata" }
);

// ─── Scheduler: daily 12:30 IST ───────────────────────────────────────────────

cron.schedule(
  "30 12 * * *",
  () => {
    console.log("🔔 Unverified CRON TRIGGERED:", new Date().toISOString());
    sendUnverifiedStatusEmail();
  },
  { timezone: "Asia/Kolkata" }
);

// ─── Scheduler: daily 11:20 IST except Sunday for HPCL action-required records ──

cron.schedule(
  "20 11 * * 1-6",
  () => {
    console.log("🔔 HPCL action required pending verification CRON TRIGGERED:", new Date().toISOString());
    sendHpclActionRequiredUnverifiedEmail().catch((e) =>
      console.error("HPCL action required pending verification job error:", e)
    );
  },
  { timezone: "Asia/Kolkata" }
);

// ─── Scheduler: daily 11:00 IST for faulty material dispatch alerts ──────────

cron.schedule(
  "0 11 * * *",
  () => {
    console.log("🔔 Faulty material dispatch alert CRON TRIGGERED:", new Date().toISOString());
    sendFaultyMaterialDispatchAlerts().catch((e) => console.error("Faulty material dispatch alert job error:", e));
  },
  { timezone: "Asia/Kolkata" }
);

// ─── Scheduler: monthly attendance sheet on 1st day, 08:00 IST ──────────────

cron.schedule(
  "0 8 1 * *",
  () => {
    console.log("🔔 Monthly attendance sheet CRON TRIGGERED:", new Date().toISOString());
    sendMonthlyAttendanceSheet().catch((e) => console.error("Monthly attendance sheet job error:", e));
  },
  { timezone: "Asia/Kolkata" }
);

// ─── Scheduler: hourly pending status reminder/warning checks ────────────────

cron.schedule(
  "15 * * * *",
  () => {
    console.log("🔔 Pending status reminder CRON TRIGGERED:", new Date().toISOString());
    sendPendingStatusReminderAlerts().catch((e) => console.error("Pending status reminder job error:", e));
  },
  { timezone: "Asia/Kolkata" }
);

// ─── Scheduler: Wednesday & Friday 11:30 IST for material sheet upload reminder ──

cron.schedule(
  "30 11 * * 3,5",
  () => {
    console.log("🔔 Material sheet upload reminder CRON TRIGGERED:", new Date().toISOString());
    sendMaterialSheetUploadReminder().catch((e) => console.error("Material sheet upload reminder job error:", e));
  },
  { timezone: "Asia/Kolkata" }
);

cron.schedule(
  "*/5 * * * *",
  () => {
    console.log("⚙️ Material auto upload CRON TRIGGERED:", new Date().toISOString());
    runScheduledMaterialUpload().catch((e) => console.error("Scheduled material upload job error:", e));
  },
  { timezone: "Asia/Kolkata" }
);

// ─── Scheduler: daily missing morning data-view entry alert at 09:30 IST ─────

cron.schedule(
  "30 9 * * *",
  () => {
    console.log("🔔 Missing morning data view entry alert CRON TRIGGERED:", new Date().toISOString());
    sendMissingMorningDataViewEntryAlert().catch((e) => console.error("Missing morning data view entry alert job error:", e));
  },
  { timezone: "Asia/Kolkata" }
);

// ─── Manual run ───────────────────────────────────────────────────────────────

// if (require.main === module) {
//   const dateArg = process.argv[2]; // optional YYYY-MM-DD (end date)
//   sendPendingStatusEmail({ forDateISO: dateArg })
//     .then((r) => { console.log("Done:", r); process.exit(r.ok ? 0 : 1); })
//     .catch((e) => { console.error("❌ error:", e); process.exit(1); });
// }

if (require.main === module) {
  const type = process.argv[2];   // pending / unverified
  const dateArg = process.argv[3]; // optional date

  if (type === "unverified") {
    sendUnverifiedStatusEmail()
      .then(() => { console.log("Unverified Done"); process.exit(0); })
      .catch((e) => { console.error("❌ error:", e); process.exit(1); });

  } else if (type === "hpcl-action-required-unverified") {
    sendHpclActionRequiredUnverifiedEmail()
      .then((r) => { console.log("HPCL action required pending verification done:", r); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("❌ error:", e); process.exit(1); });

  } else if (type === "faulty-material") {
    sendFaultyMaterialDispatchAlerts()
      .then((r) => { console.log("Faulty material dispatch alert done:", r); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("❌ error:", e); process.exit(1); });

  } else if (type === "attendance-monthly") {
    sendMonthlyAttendanceSheet()
      .then((r) => { console.log("Monthly attendance sheet done:", r); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("❌ error:", e); process.exit(1); });

  } else if (type === "status-reminder") {
    sendPendingStatusReminderAlerts()
      .then((r) => { console.log("Pending status reminder done:", r); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("❌ error:", e); process.exit(1); });

  } else if (type === "missing-morning-entry") {
    sendMissingMorningDataViewEntryAlert()
      .then((r) => { console.log("Missing morning data view entry alert done:", r); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("❌ error:", e); process.exit(1); });

  } else if (type === "material-upload-reminder") {
    sendMaterialUploadScheduleReminder()
      .then((r) => { console.log("Material upload schedule reminder done:", r); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("❌ error:", e); process.exit(1); });

  } else if (type === "material-sheet-upload-reminder") {
    sendMaterialSheetUploadReminder()
      .then((r) => { console.log("Material sheet upload reminder done:", r); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("❌ error:", e); process.exit(1); });

  } else if (type === "material-auto-upload") {
    runScheduledMaterialUpload()
      .then((r) => { console.log("Material auto upload done:", r); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("❌ error:", e); process.exit(1); });

  } else {
    // default = pending
    sendPendingStatusEmail({ forDateISO: dateArg })
      .then((r) => { console.log("Pending Done:", r); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("❌ error:", e); process.exit(1); });
  }
}

module.exports = {
  sendPendingStatusEmail,
  sendUnverifiedStatusEmail,
  sendHpclActionRequiredUnverifiedEmail,
  sendFaultyMaterialDispatchAlerts,
  sendMonthlyAttendanceSheet,
  sendVerificationCorrectionEmail,
  sendPendingStatusReminderAlerts,
  sendMaterialUploadScheduleReminder,
  sendMaterialSheetUploadReminder,
  runScheduledMaterialUpload,
  sendMissingMorningDataViewEntryAlert,
  sendMaterialRequestNotification,
  sendMaterialDispatchNotification,
  normalizeStatusLabel,
  isRequirementGivenToHQOStatus,
};
