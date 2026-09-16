const mongoose = require("mongoose");

const PlanSchema = new mongoose.Schema({
  roCode: String,
  roName: String,
  zone: String,
  region: String,
  phase: String,
  date: String,
  issueType: String,
  engineer: String,
  empId: String,
  amcQtr: String,
  incidentId: String,
  purpose: String,
  completionStatus: String, // Add this field
  arrivalTime: String,
  leaveTime: String,
  supportTakenFrom: String,
  whatDone: String,
  incidentStatus: String,
  reasonAfter12PM: String,
  reasonAfter6PM: String,
  separateearthingStatus: String,
  earthingCheckedby: String,
  detailEarthingremark: String,
  cableRequirmentremark: String,
  // Purchase order and billing tracking belongs to the visit record.
  poStatus: { type: String, enum: ["Yes", "No"], default: "No" },
  purposeOfPO: {
    type: String,
    enum: ["", "No PO Required", "Visit PO", "Material Replacement PO"],
    default: "No PO Required",
  },
  poNumber: { type: String, default: "" },
  poDate: { type: String, default: "" },
  documentCollect: { type: String, enum: ["", "Yes", "No"], default: "" },
  submitForBilling: { type: String, enum: ["", "Yes", "No"], default: "" },
  billSubmitTo: { type: String, default: "" },
  billSubmitDate: { type: String, default: "" },

  // // ✅ ADD THESE FLAGS
  // statusSaved: { type: Boolean, default: false }, // HPCL
  // jioBPStatusSaved: { type: Boolean, default: false }, // JIO
  bpclStatusSaved: { type: Boolean, default: false }, // ✅ BPCL
  reminder24SentAt: { type: Date, default: null },
  warning48SentAt: { type: Date, default: null },
}, { timestamps: true });

// Used by the Data View's date range and engineer queries.
PlanSchema.index({ date: -1, createdAt: -1 });
PlanSchema.index({ engineer: 1, date: -1, createdAt: -1 });

module.exports =
  mongoose.models.DailyPlan || mongoose.model("DailyPlan", PlanSchema);
