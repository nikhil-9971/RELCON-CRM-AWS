const mongoose = require("mongoose");

const materialRequestLineItemSchema = new mongoose.Schema(
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

const MaterialRequestBuilderSchema = new mongoose.Schema(
  {
    engineer: { type: String, default: "" },
    engineerCode: { type: String, default: "" },
    engineerContactNumber: { type: String, default: "" },
    engineerEmailId: { type: String, default: "" },
    region: { type: String, default: "" },
    customer: { type: String, default: "" },
    roCode: { type: String, default: "" },
    roName: { type: String, default: "" },
    phase: { type: String, default: "" },
    date: { type: String, default: "" },
    materialUsedIn: { type: String, default: "" },
    materialRequestTo: { type: String, default: "" },
    materialRequestFromEmail: { type: String, default: "" },
    materialRequestDate: { type: String, default: "" },
    materialArrangeFrom: { type: String, default: "" },
    materialSummary: { type: String, default: "" },
    materialDispatchStatus: { type: String, default: "" },
    materialRequirementType: { type: String, default: "" },
    quantity: { type: Number, default: 0 },
    deliveryStatus: { type: String, default: "" },
    materialReceivedDate: { type: String, default: "" },
    remarks: { type: String, default: "" },
    createdByUsername: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    updatedByUsername: { type: String, default: "" },
    updatedByName: { type: String, default: "" },
    lineItems: {
      type: [materialRequestLineItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "MaterialRequestBuilder",
  MaterialRequestBuilderSchema
);
