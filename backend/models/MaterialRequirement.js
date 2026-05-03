// models/MaterialRequirement.js
const mongoose = require("mongoose");

const materialLineItemSchema = new mongoose.Schema(
  {
    materialName: { type: String, default: "" },
    materialType: { type: String, default: "" },
    requestType: { type: String, default: "" },
    quantity: { type: Number, default: 1 },
    materialStatus: { type: String, default: "" },
    challanNumber: { type: String, default: "" },
    challanCreationDate: { type: String, default: "" },
    dispatchCourier: { type: String, default: "" },
    docketNumber: { type: String, default: "" },
    dispatchDate: { type: String, default: "" },
    deliveryStatus: { type: String, default: "" },
    deliveryDate: { type: String, default: "" },
    poNumber: { type: String, default: "" },
    poDate: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const MaterialRequirementSchema = new mongoose.Schema(
  {
    engineer: String,
    engineerCode: String,
    engineerContactNumber: String,
    engineerEmailId: String,
    region: String,
    roCode: String,
    roName: String,
    phase: String,
    date: String,
    customer: String,
    material: String,
    materialSummary: String,
    materialType: String,
    materialRequirementType: String,
    quantity: Number,
    materialDispatchStatus: String,
    materialRequestTo: String,
    materialRequestFromEmail: String,
    materialRequestDate: String,
    materialUsedIn: String,
    materialArrangeFrom: String,
    challanNumber: String,
    challanCreationDate: String,
    docketNumber: String,
    dispatchDate: String,
    deliveryStatus: String,
    materialReceivedDate: String,
    poNumber: String,
    poDate: String,
    sourceRecordId: String,
    sourceType: String,
    lineItems: {
      type: [materialLineItemSchema],
      default: [],
    },
    remarks: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "MaterialRequirement",
  MaterialRequirementSchema
);
