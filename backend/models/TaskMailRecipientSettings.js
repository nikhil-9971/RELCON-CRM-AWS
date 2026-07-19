const mongoose = require("mongoose");

const taskMailRecipientSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    alwaysCcEmails: { type: String, default: "", trim: true },
    updatedBy: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("TaskMailRecipientSettings", taskMailRecipientSettingsSchema);
