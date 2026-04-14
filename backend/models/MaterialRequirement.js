// models/MaterialRequirement.js
const mongoose = require("mongoose");

const MaterialRequirementSchema = new mongoose.Schema(
  {
    engineer: String,
    region: String,
    roCode: String,
    roName: String,
    phase: String,
    date: String,
    material: String,
    materialDispatchStatus: String,
    materialRequestTo: String,
    materialRequestDate: String,
    materialArrangeFrom: String,
    materialReceivedDate: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "MaterialRequirement",
  MaterialRequirementSchema
);
