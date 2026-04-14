const mongoose = require("mongoose");

const BPCLStatusSchema = new mongoose.Schema(
  {
    // 🔗 One BPCL Status per Daily Plan
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DailyPlan",
      required: true,
      unique: true,
    },

    /* 🔹 IOT CLASS 1 (WITH SIM) */
    class1DeviceCount: {
      type: Number,
      default: 0,
    },
    class1Devices: [
      {
        type: String,
        uppercase: true,
        trim: true,
      },
    ],

    /* 🔹 IOT CLASS 1 (WITHOUT SIM) ✅ NEW */
    class1WithoutSimCount: {
      type: Number,
      default: 0,
    },
    class1WithoutSimDevices: [
      {
        type: String,
        uppercase: true,
        trim: true,
      },
    ],

    /* 🔹 IOT CLASS 2 */
    class2DeviceCount: {
      type: Number,
      default: 0,
    },
    class2Devices: [
      {
        type: String,
        uppercase: true,
        trim: true,
      },
    ],

    /* 🔹 RELCON ATG DETAILS ✅ NEW */
    relconAtgProvided: {
      type: String,
      enum: ["YES", "NO"],
      default: "NO",
    },

    relconAtgCount: {
      type: Number,
      default: 0,
    },

    relconAtgDetails: [
      {
        type: String,
        uppercase: true,
        trim: true,
      },
    ],

    /* 🔹 SIM DETAILS */
    jioSimNumber: {
      type: String,
      trim: true,
    },
    airtelSimNumber: {
      type: String,
      trim: true,
    },

    /* 🔹 COMMON */
    createdBy: {
      type: String,
      default: "",
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

module.exports =
  mongoose.models.BPCLStatus || mongoose.model("BPCLStatus", BPCLStatusSchema);
