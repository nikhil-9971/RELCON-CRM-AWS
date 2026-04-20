/**
 * mailer.js (final)
 * - Sends daily "Pending Status (HPCL + RBML)" CSV to configured recipient via SMTP.
 * - Timezone-aware schedule: runs at 14:30 IST (Asia/Kolkata).
 * - Improved timeouts, robust error handling, detailed logging and safe EmailLog writes.
 *
 * Env required:
 *  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO,
 *  BASE_URL, APP_USER, APP_PASS, SESSION_SECRET
 *
 * Usage:
 *  node server/utils/mailer.js            # sends yesterday's report
 *  node server/utils/mailer.js 2025-12-20 # sends for specific date
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
  MAIL_TO_ADMIN,
} = process.env;

// Quick env validation
if (
  !SMTP_HOST ||
  !SMTP_PORT ||
  !SMTP_USER ||
  !SMTP_PASS ||
  !MAIL_FROM ||
  !MAIL_TO ||
  !BASE_URL ||
  !APP_USER ||
  !APP_PASS ||
  !SESSION_SECRET
) {
  console.warn("⚠️ Missing mailer environment variables. Emails will not be sent.");
  // process.exit(1); 
}

// Increase axios default timeout so backend calls have time
axios.defaults.timeout = 30000; // 30s

// Create nodemailer transporter with reasonable timeouts
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  tls: { rejectUnauthorized: false }, // keep false to avoid cert issues on some hosts; change if your env enforces cert checking
});

// Helper utilities
function safe(val) {
  return (val ?? "").toString();
}
function htmlEscape(str) {
  return safe(str).replace(
    /[&<>"']/g,
    (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        s
      ])
  );
}

function buildTable(rows, columns, title) {
  if (!rows.length) {
    return `<div style="font:13px/1.4 Calibri,Segoe UI,Roboto,Arial,sans-serif">
      <h3 style="margin:12px 0">${htmlEscape(title)}</h3>
      <div style="padding:8px 12px;background:#fff3cd;border:1px solid #ffe69c;border-radius:8px">No records.</div>
    </div>`;
  }

  const thead = columns
    .map(
      (c) =>
        `<th style="padding:6px 8px;border:1px solid #d1d5db;background:#e8f4ff;font-size:12px;font-weight:600;text-align:left;white-space:nowrap;">${htmlEscape(
          c.label
        )}</th>`
    )
    .join("");

  const tbody = rows
    .map((r) => {
      const tds = columns
        .map(
          (c) =>
            `<td style="padding:6px 8px;border:1px solid #d1d5db;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">${htmlEscape(
              typeof c.get === "function" ? c.get(r) : r[c.key]
            )}</td>`
        )
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");

  return `
  <div style="font:13px/1.4 Calibri,Segoe UI,Roboto,Arial,sans-serif;margin-top:12px">
    <h3 style="margin:12px 0">${htmlEscape(
      title
    )} <span style="font-weight:normal;color:#6b7280">(${
    rows.length
  })</span></h3>
    <div style="overflow:auto;border:1px solid #d1d5db;border-radius:6px">
      <table style="width:100%;border-collapse:collapse;min-width:860px;">
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

function toISODate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function getLastNDaysISO(n, endDate = new Date()) {
  const list = [];
  const base = new Date(endDate);
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    list.push(toISODate(d));
  }
  return list.reverse();
}

// Login to backend to get JWT
async function getFreshToken() {
  try {
    const res = await axios.post(`${BASE_URL}/login`, {
      username: APP_USER,
      password: APP_PASS,
    });
    if (!res?.data?.token) throw new Error("No token returned from login");
    return res.data.token;
  } catch (err) {
    // enhanced logging
    console.error(
      "❌ Error while login to backend:",
      err?.response?.data || err.message || err
    );
    throw err;
  }
}

// Build pending dataset
function computePending(plans = [], hpcl = [], jio = [], targetDateISO) {
  const key = (rc, d) =>
    `${String(rc || "")
      .trim()
      .toUpperCase()}-${String(d || "").slice(0, 10)}`;

  const plansOnDate = (plans || []).filter((p) => {
    const pd = String(p.date || "").slice(0, 10);
    if (!pd) return false;
    const purpose = String(p.purpose || "")
      .trim()
      .toUpperCase();
    if (purpose === "NO PLAN" || purpose === "IN LEAVE") return false;
    return pd === targetDateISO;
  });

  const plansHpcl = plansOnDate.filter((p) =>
    String(p.phase || "")
      .toUpperCase()
      .startsWith("HPCL")
  );
  const plansRbml = plansOnDate.filter((p) =>
    String(p.phase || "")
      .toUpperCase()
      .includes("RBML")
  );

  const hpclStatusSet = new Set(
    (hpcl || [])
      .filter(
        (r) =>
          String(r.date || r.uploadDate || "").slice(0, 10) === targetDateISO
      )
      .filter((r) =>
        String(r.phase || "")
          .toUpperCase()
          .startsWith("HPCL")
      )
      .map((r) => key(r.roCode, r.date || r.uploadDate))
  );

  const rbmlStatusSet = new Set(
    (jio || [])
      .filter((r) => {
        const statusDate = String(
          r.date || r.uploadDate || r.planId?.date || ""
        ).slice(0, 10);
        return statusDate === targetDateISO;
      })
      .map((r) => {
        const ro = (r.roCode || r.siteCode || r.ro || r.planId?.roCode || "")
          .trim()
          .toUpperCase();
        const dt = String(r.date || r.uploadDate || r.planId?.date || "").slice(
          0,
          10
        );
        return key(ro, dt);
      })
  );

  const pendingHpcl = plansHpcl.filter(
    (p) => !hpclStatusSet.has(key(p.roCode, p.date))
  );
  const pendingRbml = plansRbml.filter(
    (p) => !rbmlStatusSet.has(key(p.roCode || p.siteCode || p.ro, p.date))
  );

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

  return {
    rows,
    counts: {
      hpcl: pendingHpcl.length,
      rbml: pendingRbml.length,
      total: rows.length,
    },
  };
}

// Send mail and log outcome. Uses EmailLog with status "success" or "failed" to match typical enum.
async function sendPendingStatusEmail({ forDateISO, days = 15 } = {}) {
  try {
    const token = await getFreshToken();

    // fetch all required datasets in parallel
    const [plansRes, hpclRes, jioRes] = await Promise.all([
      axios.get(`${BASE_URL}/getDailyPlans`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      axios.get(`${BASE_URL}/getMergedStatusRecords`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      axios.get(`${BASE_URL}/jioBP/getAllJioBPStatus`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const plans = Array.isArray(plansRes.data) ? plansRes.data : [];
    const hpcl = Array.isArray(hpclRes.data) ? hpclRes.data : [];
    const jio = Array.isArray(jioRes.data) ? jioRes.data : [];

    // If date explicitly provided, send single-day report (backward compatible).
    // Else send last N days report ending at yesterday.
    const targetDates = forDateISO
      ? [forDateISO]
      : (() => {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          return getLastNDaysISO(days, yesterday);
        })();

    let rows = [];
    const totalCounts = { hpcl: 0, rbml: 0, total: 0 };

    for (const targetDateISO of targetDates) {
      const { rows: dayRows, counts } = computePending(
        plans,
        hpcl,
        jio,
        targetDateISO
      );

      rows.push(
        ...dayRows.map((r) => ({
          ...r,
          reportDate: targetDateISO,
        }))
      );
      totalCounts.hpcl += counts.hpcl;
      totalCounts.rbml += counts.rbml;
      totalCounts.total += counts.total;
    }

    const keys = [
      "date",
      "customer",
      "roCode",
      "roName",
      "region",
      "engineer",
      "phase",
      "purpose",
      "reportDate",
    ];
    const headerMap = {
      date: "Date",
      customer: "Customer",
      roCode: "RO Code",
      roName: "RO Name",
      region: "Region",
      engineer: "Engineer",
      phase: "Phase",
      purpose: "Purpose",
      reportDate: "Report Date",
    };
    const csv = toCSV(rows, keys, headerMap);

    const columns = keys.map((k) => ({ key: k, label: headerMap[k] }));
    const toRecipients = MAIL_TO_ADMIN || MAIL_TO;
    const dateRangeText =
      targetDates.length === 1
        ? targetDates[0]
        : `${targetDates[0]} to ${targetDates[targetDates.length - 1]}`;

    const htmlBody = `
      <div style="font:14px/1.5 Calibri,Segoe UI,Roboto,Arial,sans-serif">
        <h2 style="margin-bottom:6px">Pending Status Report (HPCL + RBML)</h2>
        <p style="margin:6px 0;color:#374151">Period: <strong>${dateRangeText}</strong></p>
        <p style="margin:6px 0;color:#374151">Total pending: <strong>${
          totalCounts.total
        }</strong> • HPCL: <strong>${totalCounts.hpcl}</strong> • RBML: <strong>${totalCounts.rbml
    }</strong></p>
        ${buildTable(
          rows.slice(0, 500),
          columns,
          "Pending Records (first 500 shown)"
        )}
        <p style="margin-top:10px;color:#6b7280;font-size:12px">This is an automated email. Full CSV is attached.</p>
      </div>
    `;

    const subject = `Pending Status Report • ${dateRangeText} • Total ${totalCounts.total}`;

    const mailOptions = {
      from: MAIL_FROM,
      to: toRecipients,
      subject,
      html: htmlBody,
      attachments: [
        {
          filename:
            targetDates.length === 1
              ? `pending_status_${targetDates[0]}.csv`
              : `pending_status_last_${days}_days_${targetDates[targetDates.length - 1]}.csv`,
          content: csv,
        },
      ],
    };

    // Verify transporter connectivity before sending (helps detect block early)
    try {
      await transporter.verify();
    } catch (verifyErr) {
      console.warn(
        "⚠️ Transporter verify failed - continuing to attempt send; verifyErr:",
        verifyErr && (verifyErr.message || verifyErr.code || verifyErr)
      );
    }

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Pending mail sent:", info && (info.messageId || info));

    // Write EmailLog safely
    try {
      await EmailLog.create({
        type: "Pending Status Report",
        subject,
        to: toRecipients,
        status: "success",
        sentAt: new Date(),
        meta: {
          period: dateRangeText,
          total: totalCounts.total,
          messageId: info.messageId || info,
        },
      });
    } catch (logErr) {
      console.error(
        "⚠️ Failed to write EmailLog (success case) - continuing. Error:",
        logErr && (logErr.message || logErr)
      );
    }

    return { ok: true, counts: totalCounts };
  } catch (err) {
    // comprehensive logging
    console.error("sendPendingStatusEmail error:", {
      code: err.code,
      message: err.message,
      responseStatus: err.response?.status,
      responseData: err.response?.data,
      stack: err.stack,
    });

    // Attempt to write EmailLog marking failure — use status "failed" which should match enum
    try {
      await EmailLog.create({
        type: "Pending Status Report",
        subject: `Pending Status Report - failure`,
        to: MAIL_TO_ADMIN || MAIL_TO,
        status: "failed", // use "failed" instead of "error" (avoid schema enum validation error)
        sentAt: new Date(),
        meta: {
          error: (err.response?.data || err.message || String(err)).toString(),
          code: err.code || null,
        },
      });
    } catch (logErr) {
      // log but don't throw — we must not crash scheduler because of schema mismatch
      console.error(
        "Failed to write EmailLog (failure case). Validation likely - error:",
        logErr && (logErr.message || logErr)
      );
    }

    return { ok: false, error: err };
  }
}

// -------------------------------
// SCHEDULING: timezone-aware -> run at 14:30 IST daily
// Uses IANA timezone "Asia/Kolkata"
cron.schedule(
  "10 15 * * *",
  () => {
    console.log(
      "🔔 Scheduled pending-status job triggered (14:30 IST):",
      new Date().toISOString()
    );
    sendPendingStatusEmail().catch((e) =>
      console.error("Scheduled job error:", e)
    );
  },
  { timezone: "Asia/Kolkata" }
);

// manual invocation support
if (require.main === module) {
  const dateArg = process.argv[2]; // optional YYYY-MM-DD
  sendPendingStatusEmail({ forDateISO: dateArg })
    .then((r) => {
      console.log("Done:", r);
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => {
      console.error("❌ error:", e);
      process.exit(1);
    });
}

module.exports = { sendPendingStatusEmail };
