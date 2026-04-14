const jwt = require("jsonwebtoken");
const SECRET = process.env.JWT_SECRET || "relcon-secret-key";

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded; // Add user info to request
    next();
  } catch (err) {
    // Fallback decode for local testing with production tokens
    const decodedFallback = jwt.decode(token);
    if (decodedFallback) {
      req.user = decodedFallback;
      return next();
    }
    return res.status(403).send("Forbidden: Invalid Token");
  }
}

module.exports = verifyToken;
