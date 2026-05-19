const mongoose = require("mongoose");

const DailyWorksheetSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    adminName: { type: String, default: "", index: true },
    adminUserId: { type: String, default: "" },
    workDescription: { type: String, required: true, trim: true },
    startTime: { type: String, default: "" },
    endTime: { type: String, default: "" },
    lunchStartTime: { type: String, default: "" },
    lunchEndTime: { type: String, default: "" },
    lunchBreakMinutes: { type: Number, default: 0 },
    durationMinutes: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.DailyWorksheet ||
  mongoose.model("DailyWorksheet", DailyWorksheetSchema);
