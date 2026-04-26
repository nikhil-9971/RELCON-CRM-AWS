const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema(
  {
    engineerName: { type: String, required: true, trim: true },
    username:     { type: String, trim: true },
    date:         { type: String, required: true }, // "YYYY-MM-DD"
    status:       {
      type: String,
      enum: ["Present", "Absent", "Half Day", "Holiday"],
      default: "Present",
    },
    remarks:  { type: String, default: "" },
    markedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

AttendanceSchema.index({ engineerName: 1, date: 1 }, { unique: true });

module.exports =
  mongoose.models.Attendance ||
  mongoose.model("Attendance", AttendanceSchema, "attendances");