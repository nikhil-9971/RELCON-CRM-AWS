const mongoose = require("mongoose");

const MaterialRequestMasterItemSchema = new mongoose.Schema(
  {
    materialName: {
      type: String,
      required: true,
      trim: true,
    },
    materialType: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: String,
      default: "",
      trim: true,
    },
    updatedBy: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

MaterialRequestMasterItemSchema.index({ materialName: 1 });
MaterialRequestMasterItemSchema.index({ materialType: 1 });

module.exports = mongoose.model(
  "MaterialRequestMasterItem",
  MaterialRequestMasterItemSchema
);
