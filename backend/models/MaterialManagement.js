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
      trim: true,
      uppercase: true,
      // UI mein free-text datalist use hota hai, isliye enum hata diya
      // Agar strict chahiye: enum: ["HPCL", "RBML", "BPCL", "OTHER"]
    },
    itemStatus: {
      type: String,
      required: true,
      trim: true,
      enum: ["OK", "Not Ok (Faulty)", "Under Repair", "Scrapped"],
      default: "OK",
    },
    engineerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerName: {
      type: String,
      trim: true,
      default: "",
      // UI mein yeh field nahi hai, isliye required: false
    },
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
    timestamps: true,
  }
);

// Fast search ke liye indexes
materialManagementSchema.index({ itemCode: 1 });
materialManagementSchema.index({ engineerName: 1 });
materialManagementSchema.index({ itemType: 1 });
materialManagementSchema.index({ itemStatus: 1 });

module.exports = mongoose.model("MaterialManagement", materialManagementSchema);