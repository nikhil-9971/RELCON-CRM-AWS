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
const NIKHIL_ADMIN_USERNAME = "nikhil.trivedi";

function isNikhilAdmin(user) {
  return user?.role === "admin" && String(user?.username || "").toLowerCase() === NIKHIL_ADMIN_USERNAME;
}

function normalizeUserRole(role = "") {
  const value = String(role || "").trim().toLowerCase();
  if (value === "admin") return "admin";
  if (value === "engineer" || value === "user") return "engineer";
  return value || "engineer";
}

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

// Safe user management view for Nikhil only
router.get("/user-management/users", verifyToken, async (req, res) => {
  try {
    if (!isNikhilAdmin(req.user)) {
      return res.status(403).json({ error: "Access denied. Nikhil admin only." });
    }
    const users = await User.find({}, "username email role engineerName empId").sort({ username: 1 }).lean();
    res.json(users.map(u => ({
      _id: u._id,
      username: u.username || "",
      email: u.email || "",
      role: normalizeUserRole(u.role),
      engineerName: u.engineerName || "",
      empId: u.empId || "",
      passwordVisible: false,
      passwordNote: "Stored securely and not retrievable",
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users", details: err.message });
  }
});

router.post("/user-management/users", verifyToken, async (req, res) => {
  try {
    if (!isNikhilAdmin(req.user)) {
      return res.status(403).json({ error: "Access denied. Nikhil admin only." });
    }
    const { username, email, engineerName, role, empId, password } = req.body;
    if (!username || !engineerName || !password) {
      return res.status(400).json({ error: "Username, engineer name, and password are required" });
    }
    const existing = await User.findOne({ username: String(username).trim() });
    if (existing) {
      return res.status(409).json({ error: "Username already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const created = await User.create({
      username: String(username).trim(),
      email: String(email || "").trim(),
      engineerName: String(engineerName).trim(),
      role: normalizeUserRole(role),
      empId: String(empId || "").trim(),
      password: hashedPassword,
    });
    res.status(201).json({
      message: "User created successfully",
      user: {
        _id: created._id,
        username: created.username || "",
        email: created.email || "",
        role: normalizeUserRole(created.role),
        engineerName: created.engineerName || "",
        empId: created.empId || "",
        passwordVisible: false,
        passwordNote: "Stored securely and not retrievable",
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to create user", details: err.message });
  }
});

router.put("/user-management/users/:id", verifyToken, async (req, res) => {
  try {
    if (!isNikhilAdmin(req.user)) {
      return res.status(403).json({ error: "Access denied. Nikhil admin only." });
    }
    const { username, email, engineerName, role, empId, password } = req.body;
    const updates = {};
    if (username !== undefined) updates.username = String(username).trim();
    if (email !== undefined) updates.email = String(email).trim();
    if (engineerName !== undefined) updates.engineerName = String(engineerName).trim();
    if (role !== undefined) updates.role = normalizeUserRole(role);
    if (empId !== undefined) updates.empId = String(empId).trim();
    if (password) updates.password = await bcrypt.hash(password, 10);
    const updated = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true, select: "username email role engineerName empId" });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({
      message: "User updated successfully",
      user: {
        _id: updated._id,
        username: updated.username || "",
        email: updated.email || "",
        role: normalizeUserRole(updated.role),
        engineerName: updated.engineerName || "",
        empId: updated.empId || "",
        passwordVisible: false,
        passwordNote: password ? "Password updated successfully" : "Stored securely and not retrievable",
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to update user", details: err.message });
  }
});

router.delete("/user-management/users/:id", verifyToken, async (req, res) => {
  try {
    if (!isNikhilAdmin(req.user)) {
      return res.status(403).json({ error: "Access denied. Nikhil admin only." });
    }
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user", details: err.message });
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
