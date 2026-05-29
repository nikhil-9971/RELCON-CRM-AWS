const mongoose = require("mongoose");

const CRMNotificationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    type: { type: String, default: "hpcl_verification_pending", index: true },
    title: { type: String, required: true },
    message: { type: String, default: "" },
    recipientUsername: { type: String, required: true, index: true },
    recipientName: { type: String, default: "" },
    assignedTo: { type: String, default: "" },
    statusRecordId: { type: String, default: "", index: true },
    roCode: { type: String, default: "" },
    roName: { type: String, default: "" },
    visitDate: { type: String, default: "" },
    severity: { type: String, default: "warning" },
    link: { type: String, default: "statusRecords.html" },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    payload: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.CRMNotification ||
  mongoose.model("CRMNotification", CRMNotificationSchema);
