const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { LoginLog } = require("../models/AuditLog");
const fetch = require("node-fetch");
const {
  clearCachePrefixes,
  getOrSetCache,
  makeCacheKey,
  sendCachedJson,
} = require("../utils/cache");

const SECRET = process.env.JWT_SECRET || "relcon-secret-key";
const USERS_CACHE_TTL_MS = 3 * 60 * 1000;
const GOOGLE_EXTERNAL_SCOPE = "openid email profile";

function clearUserCaches() {
  clearCachePrefixes(["users:", "pcb-provided-counts:", "material-engineers:"]);
}

// 🔐 Login - returns JWT
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  if (user.isActive === false) {
    return res.status(403).json({ error: "Your account is inactive. Please contact the admin." });
  }

  const normalizedRole = normalizeUserRole(user.role);
  const payload = {
    username: user.username,
    role: normalizedRole,
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
      role: normalizedRole,
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
      role: normalizedRole,
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

function getExternalRedirectUri(req) {
  return process.env.GOOGLE_EXTERNAL_REDIRECT_URI ||
    `${getPublicBaseUrl(req)}/api/external/google/callback`;
}

function getFrontendBase(req) {
  return String(process.env.FRONTEND_URL || getPublicBaseUrl(req)).replace(/\/$/, "");
}

function getPublicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_URL || process.env.FRONTEND_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const forwardedHost = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.get("host");
  return `${proto}://${host}`.replace(/\/$/, "");
}

function buildAbsoluteUrl(req, path) {
  return `${getPublicBaseUrl(req)}${path}`;
}

function externalMissingConfig() {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((key) => !String(process.env[key] || "").trim());
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function encodeExternalMeetingPayload(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function createExternalInviteForEmail(req, { email, engineerName, accessDays = 7 }) {
  const normalizedEmail = normalizeEmail(email);
  const cleanName = String(engineerName || normalizedEmail.split("@")[0] || "External User").trim();
  const days = Math.min(Math.max(Number(accessDays || 7), 1), 30);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    const err = new Error("Valid external email is required");
    err.statusCode = 400;
    throw err;
  }
  const externalInviteToken = crypto.randomBytes(24).toString("hex");
  const externalAccessExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const randomPassword = await bcrypt.hash(crypto.randomBytes(18).toString("hex"), 10);
  const user = await User.findOneAndUpdate(
    { email: normalizedEmail },
    {
      $set: {
        username: normalizedEmail,
        email: normalizedEmail,
        engineerName: cleanName,
        role: "engineer",
        externalUser: true,
        externalPending: true,
        googleVerified: false,
        googleEmail: "",
        externalInviteToken,
        externalInvitedBy: req.user?.username || req.user?.engineerName || "admin",
        externalAccessExpiresAt,
        password: randomPassword,
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  clearUserCaches();
  return {
    inviteLink: buildAbsoluteUrl(req, `/api/external/google/start?invite=${encodeURIComponent(externalInviteToken)}`),
    user,
    externalAccessExpiresAt,
  };
}

const PROFILE_PHOTO_MAX_BYTES = 500 * 1024;

function parseProfilePhoto(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) {
    throw new Error("Profile photo must be PNG, JPG, JPEG, or WEBP");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error("Profile photo size must be 500 KB or less");
  }
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  return `data:${mime};base64,${match[2]}`;
}

// 🔍 Logged-in user info
router.get("/user", verifyToken, async (req, res) => {
  try {
    const user = await User.findOne(
      { username: req.user?.username },
      "username role engineerName email contactNumber empId profilePhoto"
    ).lean();
    if (!user) return res.json(req.user);
    res.json({
      username: user.username || req.user?.username || "",
      role: normalizeUserRole(user.role || req.user?.role || ""),
      engineerName: user.engineerName || req.user?.engineerName || "",
      email: user.email || "",
      contactNumber: user.contactNumber || "",
      empId: user.empId || "",
      profilePhoto: user.profilePhoto || "",
    });
  } catch (err) {
    res.json(req.user);
  }
});

router.get("/pcb-provided-counts", verifyToken, async (req, res) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    const engineerName = String(req.user?.engineerName || req.user?.username || "").trim();
    const result = await getOrSetCache(makeCacheKey("pcb-provided-counts", { role, engineerName }), USERS_CACHE_TTL_MS, async () => {
      const query = role === "admin"
        ? { role: { $in: ["engineer", "Engineer", "user", "User"] } }
        : { engineerName, role: { $in: ["engineer", "Engineer", "user", "User"] } };
      const users = await User.find(query, "engineerName username pcbProvidedCount").lean();
      const counts = {};
      users.forEach((user) => {
        const key = String(user.engineerName || user.username || "").trim();
        if (!key) return;
        counts[key] = Number(user.pcbProvidedCount || 0) || 0;
      });
      return counts;
    });
    sendCachedJson(res, result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch PCB provided counts", details: err.message });
  }
});

router.put("/pcb-provided-counts", verifyToken, async (req, res) => {
  try {
    if (String(req.user?.role || "").toLowerCase() !== "admin") {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }
    const counts = req.body && typeof req.body === "object" ? req.body : {};
    const updates = Object.entries(counts)
      .map(([engineerName, value]) => ({
        engineerName: String(engineerName || "").trim(),
        pcbProvidedCount: Math.max(0, Number(value) || 0),
      }))
      .filter((item) => item.engineerName);

    await Promise.all(
      updates.map((item) =>
        User.updateOne(
          { engineerName: item.engineerName },
          { $set: { pcbProvidedCount: item.pcbProvidedCount } }
        )
      )
    );
    clearUserCaches();

    const users = await User.find(
      { role: { $in: ["engineer", "Engineer", "user", "User"] } },
      "engineerName username pcbProvidedCount"
    ).lean();
    const savedCounts = {};
    users.forEach((user) => {
      const key = String(user.engineerName || user.username || "").trim();
      if (!key) return;
      savedCounts[key] = Number(user.pcbProvidedCount || 0) || 0;
    });
    res.json({ success: true, counts: savedCounts });
  } catch (err) {
    res.status(500).json({ error: "Failed to save PCB provided counts", details: err.message });
  }
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
    const result = await getOrSetCache("users:admin-all", USERS_CACHE_TTL_MS, () =>
      User.find({}).sort({ createdAt: -1 }).lean()
    );
    sendCachedJson(res, result);
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
    const result = await getOrSetCache("users:management-list", USERS_CACHE_TTL_MS, async () => {
      const users = await User.find({}, "username email contactNumber role engineerName empId isActive profilePhoto externalUser externalPending googleVerified externalAccessExpiresAt").sort({ username: 1 }).lean();
      return users.map(u => ({
        _id: u._id,
        username: u.username || "",
        email: u.email || "",
        contactNumber: u.contactNumber || "",
        role: normalizeUserRole(u.role),
        engineerName: u.engineerName || "",
        empId: u.empId || "",
        isActive: u.isActive !== false,
        profilePhoto: u.profilePhoto || "",
        externalUser: Boolean(u.externalUser),
        externalPending: Boolean(u.externalPending),
        googleVerified: Boolean(u.googleVerified),
        externalAccessExpiresAt: u.externalAccessExpiresAt || null,
        passwordVisible: false,
        passwordNote: u.externalUser
          ? (u.googleVerified ? "Google verified external access" : "External Google verification pending")
          : "Stored securely and not retrievable",
      }));
    });
    sendCachedJson(res, result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users", details: err.message });
  }
});

router.post("/user-management/users", verifyToken, async (req, res) => {
  try {
    if (!isNikhilAdmin(req.user)) {
      return res.status(403).json({ error: "Access denied. Nikhil admin only." });
    }
    const { username, email, contactNumber, engineerName, role, empId, password, profilePhoto, isActive } = req.body;
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
      contactNumber: String(contactNumber || "").trim(),
      engineerName: String(engineerName).trim(),
      role: normalizeUserRole(role),
      empId: String(empId || "").trim(),
      isActive: isActive !== false,
      profilePhoto: parseProfilePhoto(profilePhoto),
      password: hashedPassword,
    });
    clearUserCaches();
    res.status(201).json({
      message: "User created successfully",
      user: {
        _id: created._id,
        username: created.username || "",
        email: created.email || "",
        contactNumber: created.contactNumber || "",
        role: normalizeUserRole(created.role),
        engineerName: created.engineerName || "",
        empId: created.empId || "",
        isActive: created.isActive !== false,
        profilePhoto: created.profilePhoto || "",
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
    const { username, email, contactNumber, engineerName, role, empId, password, profilePhoto, isActive } = req.body;
    const updates = {};
    if (username !== undefined) updates.username = String(username).trim();
    if (email !== undefined) updates.email = String(email).trim();
    if (contactNumber !== undefined) updates.contactNumber = String(contactNumber).trim();
    if (engineerName !== undefined) updates.engineerName = String(engineerName).trim();
    if (role !== undefined) updates.role = normalizeUserRole(role);
    if (empId !== undefined) updates.empId = String(empId).trim();
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    if (profilePhoto !== undefined) updates.profilePhoto = parseProfilePhoto(profilePhoto);
    if (password) updates.password = await bcrypt.hash(password, 10);
    if (updates.isActive === false) {
      const target = await User.findById(req.params.id, "username").lean();
      if (target && String(target.username || "").toLowerCase() === String(req.user?.username || "").toLowerCase()) {
        return res.status(400).json({ error: "You cannot deactivate your own admin account" });
      }
    }
    const updated = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true, select: "username email contactNumber role engineerName empId isActive profilePhoto" });
    if (!updated) return res.status(404).json({ error: "User not found" });
    clearUserCaches();
    res.json({
      message: "User updated successfully",
      user: {
        _id: updated._id,
        username: updated.username || "",
        email: updated.email || "",
        contactNumber: updated.contactNumber || "",
        role: normalizeUserRole(updated.role),
        engineerName: updated.engineerName || "",
        empId: updated.empId || "",
        isActive: updated.isActive !== false,
        profilePhoto: updated.profilePhoto || "",
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
    clearUserCaches();
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user", details: err.message });
  }
});

router.post("/user-management/external-invites", verifyToken, async (req, res) => {
  try {
    if (!isNikhilAdmin(req.user)) {
      return res.status(403).json({ error: "Access denied. Nikhil admin only." });
    }
    const { inviteLink, user, externalAccessExpiresAt } = await createExternalInviteForEmail(req, req.body || {});
    res.status(201).json({
      message: "External Google verification invite created",
      inviteLink,
      user: {
        _id: user._id,
        username: user.username || "",
        email: user.email || "",
        engineerName: user.engineerName || "",
        role: normalizeUserRole(user.role),
        externalUser: true,
        externalPending: true,
        googleVerified: false,
        externalAccessExpiresAt,
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : "Failed to create external invite", details: err.message });
  }
});

router.post("/external/meeting-invites", verifyToken, async (req, res) => {
  try {
    const { inviteLink, user, externalAccessExpiresAt } = await createExternalInviteForEmail(req, req.body || {});
    res.status(201).json({
      message: "External meeting invite created",
      inviteLink,
      user: {
        _id: user._id,
        username: user.username || "",
        email: user.email || "",
        engineerName: user.engineerName || "",
        role: normalizeUserRole(user.role),
        externalUser: true,
        externalPending: true,
        googleVerified: false,
        externalAccessExpiresAt,
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : "Failed to create external meeting invite", details: err.message });
  }
});

router.get("/external/google/start", async (req, res) => {
  try {
    const invite = String(req.query?.invite || "").trim();
    const meeting = String(req.query?.meeting || "").trim();
    const user = await User.findOne({ externalInviteToken: invite, externalUser: true });
    if (!invite || !user) return res.status(404).send("Invalid or expired invite link");
    if (user.isActive === false) return res.status(403).send("External account is inactive");
    if (user.externalAccessExpiresAt && user.externalAccessExpiresAt < new Date()) {
      return res.status(410).send("External invite has expired");
    }
    const missing = externalMissingConfig();
    if (missing.length) {
      return res.status(500).send(`Google verification configuration missing: ${missing.join(", ")}`);
    }
    const state = jwt.sign({ invite, meeting, nonce: Date.now() }, SECRET, { expiresIn: "10m" });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      response_type: "code",
      redirect_uri: getExternalRedirectUri(req),
      scope: GOOGLE_EXTERNAL_SCOPE,
      state,
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  } catch (err) {
    res.status(500).send(String(err.message || "Unable to start Google verification"));
  }
});

router.get("/external/google/callback", async (req, res) => {
  try {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) throw new Error(errorDescription || error);
    if (!code || !state) throw new Error("Missing Google verification code");
    const decoded = jwt.verify(String(state), SECRET);
    const invite = String(decoded.invite || "").trim();
    const meeting = String(decoded.meeting || "").trim();
    const user = await User.findOne({ externalInviteToken: invite, externalUser: true });
    if (!user) throw new Error("Invite not found or already invalid");
    if (user.isActive === false) throw new Error("External account is inactive");
    if (user.externalAccessExpiresAt && user.externalAccessExpiresAt < new Date()) {
      throw new Error("Invite has expired");
    }

    const tokenBody = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code: String(code),
      redirect_uri: getExternalRedirectUri(req),
      grant_type: "authorization_code",
    });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokenData.error_description || tokenData.error || "Google token exchange failed");

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) throw new Error(profile.error_description || profile.error || "Google profile verification failed");

    const verifiedEmail = normalizeEmail(profile.email);
    if (!profile.email_verified) throw new Error("Google email is not verified");
    if (verifiedEmail !== normalizeEmail(user.email)) {
      throw new Error(`Verified Google email ${verifiedEmail} does not match invited email ${user.email}`);
    }

    user.googleVerified = true;
    user.googleEmail = verifiedEmail;
    user.externalPending = false;
    user.externalVerifiedAt = new Date();
    user.engineerName = user.engineerName || profile.name || verifiedEmail;
    await user.save();
    clearUserCaches();

    const payload = {
      username: user.username || verifiedEmail,
      role: "external_meeting",
      engineerName: user.engineerName || profile.name || verifiedEmail,
      externalUser: true,
      googleVerified: true,
      meetingOnly: true,
    };
    const token = jwt.sign(payload, SECRET, { expiresIn: "4h" });
    const access = encodeExternalMeetingPayload({
      token,
      name: payload.engineerName,
      email: verifiedEmail,
      meeting,
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    });
    const target = buildAbsoluteUrl(req, `/external-meeting?access=${encodeURIComponent(access)}`);
    res.send(`<!doctype html><html><body style="font-family:Arial,sans-serif;padding:28px;">
      <h3>Google verification complete</h3>
      <p>Redirecting to RELCON meeting access...</p>
      <script>
        window.location.href = ${JSON.stringify(target)};
      </script>
    </body></html>`);
  } catch (err) {
    res.status(400).send(`<!doctype html><html><body style="font-family:Arial,sans-serif;padding:28px;">
      <h3>Google verification failed</h3>
      <p>${String(err.message || "Unable to verify external user")}</p>
    </body></html>`);
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
    clearUserCaches();
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
    clearUserCaches();
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
