const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema(
  {
    engineerName: { type: String, required: true, trim: true },
    username:     { type: String, trim: true },
    date:         { type: String, required: true }, // "YYYY-MM-DD"
    status:       {
      type: String,
      enum: ["Present", "Absent", "Half Day", "On Leave"],
      default: "Present",
    },
    remarks:  { type: String, default: "" },
    markedBy: { type: String, default: "" }, // admin ya khud engineer
  },
  { timestamps: true }
);

// Same engineer ka same date pe duplicate entry nahi hogi
AttendanceSchema.index({ engineerName: 1, date: 1 }, { unique: true });

module.exports =
  mongoose.models.Attendance ||
  mongoose.model("Attendance", AttendanceSchema, "attendances");
