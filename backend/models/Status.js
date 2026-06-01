const mongoose = require("mongoose");

const verificationEditLogSchema = new mongoose.Schema(
  {
    editedBy: { type: String, default: "" },
    editedAt: { type: Date, default: null },
    adminRemark: { type: String, default: "" },
    changes: {
      type: [
        {
          field: { type: String, default: "" },
          before: { type: String, default: "" },
          after: { type: String, default: "" },
        },
      ],
      default: [],
    },
    notificationSentAt: { type: Date, default: null },
  },
  { _id: false }
);

const verifiedEditRequestSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["none", "pending", "approved", "used", "rejected"],
      default: "none",
    },
    requestedBy: { type: String, default: "" },
    requestedAt: { type: Date, default: null },
    reason: { type: String, default: "" },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    usedAt: { type: Date, default: null },
  },
  { _id: false }
);

const StatusSchema = new mongoose.Schema({
  planId: { type: mongoose.Schema.Types.ObjectId, ref: "DailyPlan" },
  createdAt: { type: Date, default: Date.now },
  probeMake: String,
  probeSize: String,
  lowProductLock: String,
  highWaterSet: String,
  duSerialNumber: String,
  dgStatus: String,
  connectivityType: String,
  sim1Provider: String,
  sim1Number: String,
  sim2Provider: String,
  sim2Number: String,
  iemiNumber: String,
  bosVersion: String,
  fccVersion: String,
  wirelessSlave: String,
  sftpConfig: String,
  adminPassword: String,
  workCompletion: String,
  spareUsed: String,
  activeSpare: String,
  faultySpare: String,
  spareRequirment: String,
  spareRequirmentname: String,
  earthingStatus: String,
  voltageReading: String,
  duOffline: String,
  duDependency: String,
  duRemark: String,
  tankOffline: String,
  tankDependency: String,
  tankRemark: String,
  bosIP: String,
  fccIP: String,
  locationField: String,
  // NEW: OMS 03 picklist (Yes / No / PO Basis)
  oms03: {
    type: String,
    enum: ["Yes", "No", "PO Basis"],
    default: "No",
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  taskGenerated: { type: Boolean, default: false },
  verificationEditLog: {
    type: verificationEditLogSchema,
    default: () => ({ changes: [] }),
  },
  verifiedEditRequest: {
    type: verifiedEditRequestSchema,
    default: () => ({ status: "none" }),
  },
});

module.exports =
  mongoose.model.StatusSchema ||
  mongoose.model("Status", StatusSchema, "status");
