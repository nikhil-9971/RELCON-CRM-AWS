const mongoose = require("mongoose");

const taskMailRecipientRuleSchema = new mongoose.Schema(
  {
    region: { type: String, required: true, trim: true },
    regionKey: { type: String, required: true, trim: true, unique: true },
    regionKeys: { type: [String], default: [] },
    toEmails: { type: String, default: "", trim: true },
    ccEmails: { type: String, default: "", trim: true },
    updatedBy: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("TaskMailRecipientRule", taskMailRecipientRuleSchema);
