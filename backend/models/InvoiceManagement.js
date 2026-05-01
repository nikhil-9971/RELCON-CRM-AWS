const mongoose = require("mongoose");

const invoiceManagementSchema = new mongoose.Schema(
  {
    sno: { type: Number, default: 0 },
    region: { type: String, default: "" },
    callupNo: { type: String, default: "" },
    callupDate: { type: String, default: "" },
    phase: { type: String, default: "" },
    noOfSite: { type: Number, default: 0 },
    availableQty: { type: Number, default: 0 },
    finalQty: { type: Number, default: 0 },
    perQtyRate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    taxCgst: { type: Number, default: 0 },
    finalAmount: { type: Number, default: 0 },
    yearLabel: { type: String, default: "" },
    quarter: { type: String, default: "" },
    monthLabel: { type: String, default: "" },
    remark: { type: String, default: "" },
    totalBillingMonth: { type: Number, default: 0 },
    billingType: { type: String, default: "" },
    sourceFile: { type: String, default: "" },
    importedBy: { type: String, default: "" },
    importedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

invoiceManagementSchema.index({ region: 1, monthLabel: 1, billingType: 1 });
invoiceManagementSchema.index({ callupNo: 1, phase: 1 });

module.exports =
  mongoose.models.InvoiceManagement ||
  mongoose.model("InvoiceManagement", invoiceManagementSchema, "invoiceManagement");
