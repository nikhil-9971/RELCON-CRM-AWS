const mongoose = require("mongoose");

const atgStatusSchema = new mongoose.Schema({
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DailyPlan",
  },
  zone: String,
  atgIssuetype: String,
  startTime: String,
  bfrStatus: String,
  actionSite: String,
  supportPerson: String,
  earthingStatus1: String,
  resolvedStatus: String,
  endTime: String,
  nextAction: String,
  remark: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("ATGStatus", atgStatusSchema);
