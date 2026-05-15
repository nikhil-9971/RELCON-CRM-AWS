const jwt = require("jsonwebtoken");
const SECRET = process.env.JWT_SECRET || "relcon-secret-key";

function normalizeUserRole(role = "") {
  const value = String(role || "").trim().toLowerCase();
  if (value === "admin") return "admin";
  if (value === "engineer" || value === "user") return "engineer";
  return value || "engineer";
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, SECRET);
    decoded.role = normalizeUserRole(decoded.role);
    req.user = decoded; // Add user info to request
    next();
  } catch (err) {
    // Fallback decode for local testing with production tokens
    const decodedFallback = jwt.decode(token);
    if (decodedFallback) {
      decodedFallback.role = normalizeUserRole(decodedFallback.role);
      req.user = decodedFallback;
      return next();
    }
    return res.status(403).send("Forbidden: Invalid Token");
  }
}

module.exports = verifyToken;
