const mongoose = require("mongoose");

const JioBPStatusSchema = new mongoose.Schema(
  {
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DailyPlan",
      required: true,
      unique: true, // ❗Only one status per plan
    },
    hpsdId: {
      type: String,
      required: true,
    },
    diagnosis: {
      type: String,
      required: true,
    },
    solution: {
      type: String,
      required: true,
    },
    activeMaterialUsed: {
      type: String,
      required: true,
    },
    usedMaterialDetails: {
      type: String,
      default: "",
    },
    faultyMaterialDetails: {
      type: String,
      default: "",
    },
    spareRequired: {
      type: String,
      required: true,
    },
    observationHours: {
      type: String,
      default: "",
    },
    materialRequirement: {
      type: String,
      default: "",
    },
    relconsupport: {
      type: String,
      default: "",
    },
    rbmlperson: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      required: true,
    },
    createdBy: {
      type: String,
      default: "",
    },
    // NEW: OMS 03 picklist
    oms03: {
      type: String,
      enum: ["Yes", "No", "PO Basis"],
      default: "No",
    },

    isVerified: {
      type: Boolean,
      default: false,
    },
    verifiedBy: {
      type: String,
      default: "",
    },
    verifiedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// 🔠 Middleware to convert relevant fields to uppercase before saving
JioBPStatusSchema.pre("save", function (next) {
  if (this.hpsdId) this.hpsdId = this.hpsdId.toUpperCase();
  if (this.diagnosis) this.diagnosis = this.diagnosis.toUpperCase();
  if (this.solution) this.solution = this.solution.toUpperCase();
  if (this.usedMaterialDetails)
    this.usedMaterialDetails = this.usedMaterialDetails.toUpperCase();
  if (this.faultyMaterialDetails)
    this.faultyMaterialDetails = this.faultyMaterialDetails.toUpperCase();
  if (this.materialRequirement)
    this.materialRequirement = this.materialRequirement.toUpperCase();
  if (this.relconsupport) this.relconsupport = this.relconsupport.toUpperCase();
  if (this.rbmlperson) this.rbmlperson = this.rbmlperson.toUpperCase();
  next();
});

module.exports = mongoose.model("JioBPStatus", JioBPStatusSchema);
