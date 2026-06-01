const mongoose = require("mongoose");

const taskMailHistorySchema = new mongoose.Schema(
  {
    action: { type: String, default: "" },
    subject: { type: String, default: "" },
    to: { type: String, default: "" },
    cc: { type: String, default: "" },
    status: { type: String, enum: ["success", "failure"], default: "success" },
    messageId: { type: String, default: "" },
    sentAt: { type: Date, default: Date.now },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const taskSchema = new mongoose.Schema({
  statusId: String, // Status Record ID (for traceability)
  roCode: String,
  region: String,
  roName: String,
  date: String,
  engineer: String,
  customer: { type: String, default: "HPCL" },
  issue: String, // e.g., "Earthing NOT OK" or "DU Offline: 2"
  issueType: { type: String, default: "" },
  priority: { type: String, default: "Medium" },
  subject: { type: String, default: "" },
  emailContent: String,
  customerEmail: { type: String, default: "" },
  ccEmails: { type: String, default: "" },
  status: { type: String, default: "Pending" }, // Pending, Mailed, Resolved
  replyStatus: { type: String, default: "No Response" },
  mailReply: String,
  mailDate: String, // ✅ add this
  lastMailSentAt: Date,
  lastMailSubject: { type: String, default: "" },
  nextFollowUpDate: String,
  closureSummary: { type: String, default: "" },
  completedBy: String, // ✅ add this
  assignedTo: { type: String, default: "" },
  slaDays: { type: Number, default: 2 },
  escalatedAt: Date,
  escalatedLevel: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  // ✅ Add these for UI display
  earthingStatus: String,
  dgStatus: String,
  voltageReading: String,
  duOffline: String,
  duRemark: String,
  duDependency: String,
  tankOffline: String,
  tankRemark: String,
  tankDependency: String,
  followUpDates: [String], // array to store each follow-up date as 'YYYY-MM-DD'
  mailHistory: {
    type: [taskMailHistorySchema],
    default: [],
  },
});

module.exports = mongoose.model("Task", taskSchema);
