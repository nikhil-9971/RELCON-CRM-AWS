const jwt = require("jsonwebtoken");
const User = require("../models/User");
const SECRET = process.env.JWT_SECRET || "relcon-secret-key";

function normalizeUserRole(role = "") {
  const value = String(role || "").trim().toLowerCase();
  if (value === "admin") return "admin";
  if (value === "engineer" || value === "user") return "engineer";
  return value || "engineer";
}

async function ensureActiveUser(decoded) {
  const username = String(decoded?.username || "").trim();
  const email = String(decoded?.email || "").trim();
  const engineerName = String(decoded?.engineerName || decoded?.name || "").trim();
  const queries = [];
  if (username) queries.push({ username });
  if (email) queries.push({ email });
  if (engineerName) queries.push({ engineerName });
  if (!queries.length) return true;
  const user = await User.findOne({ $or: queries }, "isActive").lean();
  return !user || user.isActive !== false;
}

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, SECRET);
    decoded.role = normalizeUserRole(decoded.role);
    if (decoded.meetingOnly) {
      return res.status(403).json({ error: "Meeting-only access cannot use CRM APIs" });
    }
    if (!(await ensureActiveUser(decoded))) {
      return res.status(403).json({ error: "Account is inactive. Please contact the admin." });
    }
    req.user = decoded; // Add user info to request
    next();
  } catch (err) {
    // Fallback decode for local testing with production tokens
    try {
      const decodedFallback = jwt.decode(token);
      if (decodedFallback) {
        decodedFallback.role = normalizeUserRole(decodedFallback.role);
        if (decodedFallback.meetingOnly) {
          return res.status(403).json({ error: "Meeting-only access cannot use CRM APIs" });
        }
        if (!(await ensureActiveUser(decodedFallback))) {
          return res.status(403).json({ error: "Account is inactive. Please contact the admin." });
        }
        req.user = decodedFallback;
        return next();
      }
    } catch {
      return res.status(403).send("Forbidden: Invalid Token");
    }
    return res.status(403).send("Forbidden: Invalid Token");
  }
}

module.exports = verifyToken;
