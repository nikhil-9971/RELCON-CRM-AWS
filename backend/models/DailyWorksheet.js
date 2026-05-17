const mongoose = require("mongoose");

const DailyWorksheetSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    adminName: { type: String, default: "", index: true },
    adminUserId: { type: String, default: "" },
    workTitle: { type: String, required: true, trim: true },
    workType: {
      type: String,
      default: "Operations",
      enum: ["Operations", "Follow-up", "Reporting", "Customer Call", "Internal", "Other"],
    },
    startTime: { type: String, default: "" },
    endTime: { type: String, default: "" },
    durationMinutes: { type: Number, default: 0 },
    status: {
      type: String,
      default: "In Progress",
      enum: ["Planned", "In Progress", "Completed", "Hold"],
    },
    priority: {
      type: String,
      default: "Medium",
      enum: ["High", "Medium", "Low"],
    },
    workDetails: { type: String, default: "" },
    outcome: { type: String, default: "" },
    blockers: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.DailyWorksheet ||
  mongoose.model("DailyWorksheet", DailyWorksheetSchema);
