const mongoose = require("mongoose");

const materialUploadScheduleSchema = new mongoose.Schema(
  {
    moduleKey: {
      type: String,
      required: true,
      unique: true,
      default: "material-management",
      trim: true,
    },
    scheduledDate: {
      type: String,
      trim: true,
      default: "",
    },
    scheduledTime: {
      type: String,
      trim: true,
      default: "",
    },
    timezone: {
      type: String,
      trim: true,
      default: "Asia/Kolkata",
    },
    replaceExistingOnUpload: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    updatedBy: {
      type: String,
      trim: true,
      default: "",
    },
    lastUploadAt: {
      type: Date,
      default: null,
    },
    lastUploadedBy: {
      type: String,
      trim: true,
      default: "",
    },
    lastDeletedCount: {
      type: Number,
      default: 0,
    },
    lastInsertedCount: {
      type: Number,
      default: 0,
    },
    lastReminderSentAt: {
      type: Date,
      default: null,
    },
    lastReminderScheduleKey: {
      type: String,
      trim: true,
      default: "",
    },
    scheduledFileName: {
      type: String,
      trim: true,
      default: "",
    },
    scheduledFileMimeType: {
      type: String,
      trim: true,
      default: "",
    },
    scheduledFileSize: {
      type: Number,
      default: 0,
    },
    scheduledFileBuffer: {
      type: Buffer,
      default: null,
    },
    scheduledFileUploadedAt: {
      type: Date,
      default: null,
    },
    lastAutoImportAt: {
      type: Date,
      default: null,
    },
    lastProcessedScheduleKey: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MaterialUploadSchedule", materialUploadScheduleSchema);
