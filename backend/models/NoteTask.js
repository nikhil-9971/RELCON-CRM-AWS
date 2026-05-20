const mongoose = require("mongoose");

const NoteTaskSchema = new mongoose.Schema(
  {
    adminName: { type: String, default: "", index: true },
    adminUserId: { type: String, default: "", index: true },
    title: { type: String, required: true, trim: true },
    note: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["open", "in-progress", "done", "archived"],
      default: "open",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true,
    },
    dueDate: { type: String, default: "", index: true },
    reminderTime: { type: String, default: "" },
    reminderEmailSentAt: { type: Date, default: null },
    reminderEmailSentKey: { type: String, default: "" },
    reminderEmailRecipient: { type: String, default: "" },
    category: { type: String, default: "", trim: true },
    pinned: { type: Boolean, default: false, index: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.NoteTask || mongoose.model("NoteTask", NoteTaskSchema);
