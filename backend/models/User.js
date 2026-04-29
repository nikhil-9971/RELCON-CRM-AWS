const mongoose = require("mongoose");
const UserSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  role: String,
  engineerName: String,
  empId: String,
});
// ✅ Fixed: removed broken `mongoose.model.UserSchema ||` which always returned undefined
module.exports = mongoose.model("User", UserSchema, "users");
