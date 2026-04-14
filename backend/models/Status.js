const mongoose = require("mongoose");

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
});

module.exports =
  mongoose.model.StatusSchema ||
  mongoose.model("Status", StatusSchema, "status");
