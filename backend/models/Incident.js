const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema({
  roCode: String,
  siteName: String,
  region: String,
  incidentId: String,
  incidentDate: String,
  complaintRemark: String,
  assignEngineer: String,
  closeRemark: String,
  incidentcloseDate: String,
  status: { type: String, default: "Pending" },
});

module.exports = mongoose.model("Incident", incidentSchema);
