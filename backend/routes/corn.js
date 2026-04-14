// corn.js
const cron = require("node-cron");
const fetch = require("node-fetch");
const Chat = require("../models/Chat");

const BASE_URL = "https://relcon-backend-jwt-backup.onrender.com";

function startCronJobs(broadcastToAll) {
  // 🔹 Morning 07:30 AM job
  cron.schedule(
    "30 7 * * *",
    async () => {
      console.log("⏰ Running pending incidents cron job at 07:30 AM IST");
      await runPendingIncidentJob(broadcastToAll, "Good Morning !");
    },
    { timezone: "Asia/Kolkata" }
  );

  // 🔹 Evening 07:30 PM job
  cron.schedule(
    "30 19 * * *",
    async () => {
      console.log("⏰ Running pending incidents cron job at 07:30 PM IST");
      await runPendingIncidentJob(broadcastToAll, "Good Evening !");
    },
    { timezone: "Asia/Kolkata" }
  );
}

// 🔁 Common function to handle pending incident job
async function runPendingIncidentJob(broadcastToAll, greetingText) {
  try {
    const res = await fetch(`${BASE_URL}/getAllIncidents`);
    const result = await res.json();

    if (!result?.success) return;

    const pending = (result.incidents || []).filter(
      (i) => i.status === "Pending"
    );

    // Remove previous system chatbot messages (table or system=true) from today only
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const endOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      23,
      59,
      59
    );

    await Chat.deleteMany({
      roomId: "group",
      from: "🤖 Chatbot",
      createdAt: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
      $or: [
        { system: true },
        { text: { $regex: /^\s*<table[\s\S]*<\/table>\s*$/i } },
      ],
    });

    if (pending.length > 0) {
      // Build HTML table
      const thStyle =
        "border: 1px solid #ccc; padding: 4px 6px; text-align:left; white-space: nowrap; background-color: #15803d; color:white;";
      const tdStyle =
        "border: 1px solid #ccc; padding: 4px 6px; text-align:left; white-space: nowrap;";

      let tableHTML = `
        <table style="border-collapse: collapse; width: 100%; margin-top: 5px; font-size: 11px;">
          <p style="margin: 0 0 10px 0; font-weight: bold;">
            Dear Team,<br>
            ${greetingText}<br>
            Please find today incident detail under Lucknow, Patna & Begusarai Regional office.<br>
            Please let me know if issue resolved.
          </p>
          <thead>
            <tr>
              <th style="${thStyle}">RO Code</th>
              <th style="${thStyle}">Site Name</th>
              <th style="${thStyle}">Region</th>
              <th style="${thStyle}">Incident ID</th>
              <th style="${thStyle}">Incident Date</th>
              <th style="${thStyle}">Dealer Remark</th>
            </tr>
          </thead>
          <tbody>
      `;

      for (const i of pending) {
        tableHTML += `
          <tr>
            <td style="${tdStyle}">${i.roCode}</td>
            <td style="${tdStyle}">${i.siteName}</td>
            <td style="${tdStyle}">${i.region}</td>
            <td style="${tdStyle}">${i.incidentId}</td>
            <td style="${tdStyle}">${i.incidentDate}</td>
            <td style="${tdStyle}">${i.complaintRemark}</td>
          </tr>`;
      }

      tableHTML += "</tbody></table>";

      // Save to DB with proper timestamp
      const messageDoc = await Chat.create({
        from: "🤖 Chatbot",
        to: "group",
        roomId: "group",
        text: tableHTML,
        delivered: true,
        read: false,
        system: true,
        createdAt: new Date(), // This will be the current time when cron runs
        updatedAt: new Date(),
      });

      // Broadcast as HTML
      broadcastToAll({
        type: "group",
        from: "🤖 Chatbot",
        html: tableHTML,
        createdAt: messageDoc.createdAt,
      });
    } else {
      // Save + broadcast "No pending..." message
      const messageDoc = await Chat.create({
        from: "🤖 Chatbot",
        to: "group",
        roomId: "group",
        text: "✅ No pending incidents today.",
        delivered: true,
        read: false,
        system: true,
        createdAt: new Date(), // This will be the current time when cron runs
        updatedAt: new Date(),
      });

      broadcastToAll({
        type: "group",
        from: "🤖 Chatbot",
        text: "✅ No pending incidents today.",
        createdAt: messageDoc.createdAt,
      });
    }
  } catch (err) {
    console.error("❌ Cron job error:", err);
  }
}

module.exports = { startCronJobs };
