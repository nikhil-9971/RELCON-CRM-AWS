const mongoose = require("mongoose");

const ROMasterSchema = new mongoose.Schema({
  zone: String,
  roCode: String,
  roName: String,
  region: String,
  phase: String,
  engineer: String,
  amcQtr: String,
  siteStatus: String,
  siteActivestatus: String,
  lastAMCqtr: String,
});

module.exports =
  mongoose.models.ROMaster ||
  mongoose.model("ROMaster", ROMasterSchema, "romasters");
