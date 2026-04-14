const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { LoginLog } = require("../models/AuditLog");
const fetch = require("node-fetch");

const SECRET = process.env.JWT_SECRET || "relcon-secret-key";

// 🔐 Login - returns JWT
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const payload = {
    username: user.username,
    role: user.role,
    engineerName: user.engineerName,
  };

  const token = jwt.sign(payload, SECRET, { expiresIn: "24h" });

  // ✅ Get real IP
  const ipAddress =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "UNKNOWN";

  console.log("🔍 Login IP:", ipAddress);

  // ✅ Fetch location
  let location = "Unknown";

  try {
    const response = await fetch(
      `https://ipinfo.io/${ipAddress}?token=be1a52b6573c44`
    );
    const data = await response.json();

    console.log("📡 IPInfo response:", data); // Debug

    // ✅ check for city, region, country
    if (data && data.city && data.region && data.country) {
      location = `${data.city}, ${data.region}, ${data.country}, ${data.org}`;
    }
  } catch (err) {
    console.error("IP location fetch error:", err.message);
  }

  // ✅ Save login log
  try {
    await LoginLog.create({
      engineerName: user.engineerName || user.name || "Unknown",
      username: user.username,
      role: user.role,
      ip: ipAddress,
      location,
    });
  } catch (logErr) {
    console.error("📛 LoginLog error:", logErr.message);
  }

  //res.json({ token });
  res.json({
    token,
    user: {
      username: user.username,
      role: user.role,
      engineerName: user.engineerName,
    },
  });
});

const verifyToken = require("../middleware/authMiddleware");

// 🔍 Logged-in user info
router.get("/user", verifyToken, (req, res) => {
  res.json(req.user);
});

// 🔓 Dummy logout (handled on frontend)
router.post("/logout", (req, res) => {
  res.status(200).json({ message: "Client should clear token manually" });
});

// 🛡️ Admin Only: Get all users (for DB Explorer)
router.get("/getUsers", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }
    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users", details: err.message });
  }
});

// 🛡️ Admin Only: Update User
router.put("/updateUser/:id", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }
    const { password, ...updates } = req.body;
    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }
    const updated = await User.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User updated successfully", user: updated });
  } catch (err) {
    res.status(500).json({ error: "Failed to update user", details: err.message });
  }
});

// 🛡️ Admin Only: Delete User
router.delete("/deleteUser/:id", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user", details: err.message });
  }
});

// ✅ Role-based middleware
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }
    
    // Convert to lowercase for comparison
    const userRole = req.user.role?.toLowerCase() || "";
    const allowed = allowedRoles.map(r => r.toLowerCase());
    
    if (!allowed.includes(userRole)) {
      return res.status(403).json({ success: false, message: "Insufficient permissions" });
    }
    next();
  };
}

// ✅ Export router and middleware
module.exports = {
  router,
  verifyToken,
  requireRole,
};
