const mongoose = require("mongoose");
const UserSchema = new mongoose.Schema({
  username: String,
  email: String,
  contactNumber: String,
  password: String,
  role: String,
  engineerName: String,
  empId: String,
  isActive: { type: Boolean, default: true },
  profilePhoto: { type: String, default: "" },
  pcbProvidedCount: { type: Number, default: 0 },
  externalUser: { type: Boolean, default: false },
  externalPending: { type: Boolean, default: false },
  googleVerified: { type: Boolean, default: false },
  googleEmail: { type: String, default: "" },
  externalInviteToken: { type: String, default: "" },
  externalInvitedBy: { type: String, default: "" },
  externalAccessExpiresAt: { type: Date },
  externalVerifiedAt: { type: Date },
});
// ✅ Fixed: removed broken `mongoose.model.UserSchema ||` which always returned undefined
module.exports = mongoose.model("User", UserSchema, "users");
