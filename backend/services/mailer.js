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
const { EmailLog } = require("../models/AuditLog");

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
    result.push(d.toISOString().slice(0, 10));
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

    const subject = `Pending Report (15d) • ${fromDateISO} → ${endDateISO} • Total ${totalPending}`;

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

// ─── Scheduler: daily 14:30 IST ───────────────────────────────────────────────

cron.schedule(
  "30 10 * * *",
  () => {
    console.log("🔔 Scheduled pending-status job triggered (14:30 IST):", new Date().toISOString());
    sendPendingStatusEmail().catch((e) => console.error("Scheduled job error:", e));
  },
  { timezone: "Asia/Kolkata" }
);

// ─── Manual run ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const dateArg = process.argv[2]; // optional YYYY-MM-DD (end date)
  sendPendingStatusEmail({ forDateISO: dateArg })
    .then((r) => { console.log("Done:", r); process.exit(r.ok ? 0 : 1); })
    .catch((e) => { console.error("❌ error:", e); process.exit(1); });
}

module.exports = { sendPendingStatusEmail };
