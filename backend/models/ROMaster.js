const mongoose = require("mongoose");

const ROMasterSchema = new mongoose.Schema({
  zone: String,
  roCode: String,
  roName: String,
  region: String,
  phase: String,
  engineer: String,
  engineerContactNumber: String,
  amcQtr: String,
  siteStatus: String,
  connectivityType: String,
  bosIP: String,
  fccIP: String,
  siteActivestatus: String,
  lastAMCqtr: String,
});

ROMasterSchema.index({ roCode: 1 });

module.exports =
  mongoose.models.ROMaster ||
  mongoose.model("ROMaster", ROMasterSchema, "romasters");
