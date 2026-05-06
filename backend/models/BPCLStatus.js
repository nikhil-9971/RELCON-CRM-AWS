const mongoose = require("mongoose");

const verificationEditLogSchema = new mongoose.Schema(
  {
    editedBy: { type: String, default: "" },
    editedAt: { type: Date, default: null },
    adminRemark: { type: String, default: "" },
    changes: {
      type: [
        {
          field: { type: String, default: "" },
          before: { type: String, default: "" },
          after: { type: String, default: "" },
        },
      ],
      default: [],
    },
    notificationSentAt: { type: Date, default: null },
  },
  { _id: false }
);

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
    verificationEditLog: {
      type: verificationEditLogSchema,
      default: () => ({ changes: [] }),
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.BPCLStatus || mongoose.model("BPCLStatus", BPCLStatusSchema);
