const mongoose = require("mongoose");

const loginLogSchema = new mongoose.Schema({
  engineerName: String,
  username: String,
  role: String,
  loginTime: { type: Date, default: Date.now },
  ip: String,
  location: String, // ✅ Add this
});

const auditTrailSchema = new mongoose.Schema({
  modifiedBy: String,
  action: String, // e.g., 'edit' or 'delete'
  recordType: String, // e.g., 'status', 'user', etc.
  timestamp: { type: Date, default: Date.now },
  before: Object,
  after: Object,
  roCode: String, // ✅ new
  roName: String, // ✅ new
  visitDate: String, // ✅ new
  engineerName: String, // ✅ new
});

// ✅ Email logs for tracking outgoing mails
const emailLogSchema = new mongoose.Schema({
  type: { type: String, default: "" }, // e.g., Daily Unverified, Weekly Plan, etc.
  subject: { type: String, default: "" },
  to: { type: String, default: "" },
  status: { type: String, enum: ["success", "failure"], default: "success" },
  error: { type: String, default: "" },
  meta: { type: Object, default: {} },
  sentAt: { type: Date, default: Date.now },
});

module.exports = {
  LoginLog: mongoose.model("LoginLog", loginLogSchema),
  AuditTrail: mongoose.model("AuditTrail", auditTrailSchema),
  EmailLog: mongoose.model("EmailLog", emailLogSchema),
};
