const mongoose = require("mongoose");

const materialManagementSchema = new mongoose.Schema(
  {
    serialNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    itemCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    qty: {
      type: Number,
      required: true,
      min: 0,
    },
    itemType: {
      type: String,
      required: true,
      enum: ["HPCL", "RBML", "BPCL", "OTHER"],
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    engineerName: {
      type: String,
      required: true,
      trim: true,
    },
    // Optional extra fields
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
    uploadedBy: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// Index for fast search
materialManagementSchema.index({ itemCode: 1 });
materialManagementSchema.index({ engineerName: 1 });
materialManagementSchema.index({ customerName: 1 });
//materialManagementSchema.index({ serialNumber: 1 }, { unique: true });

module.exports = mongoose.model("MaterialManagement", materialManagementSchema);
