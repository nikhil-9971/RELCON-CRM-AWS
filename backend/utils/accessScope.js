function isAdminUser(user = {}) {
  return String(user.role || "").trim().toLowerCase() === "admin";
}

function currentEngineerName(user = {}) {
  return String(user.engineerName || user.name || user.username || "").trim();
}

function engineerRegex(user = {}) {
  const engineer = currentEngineerName(user);
  if (!engineer) return /^$/;
  return new RegExp(`^${engineer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

function scopeByEngineer(user = {}, field = "engineer") {
  if (isAdminUser(user)) return {};
  return { [field]: engineerRegex(user) };
}

function canAccessEngineerRecord(user = {}, recordEngineer = "") {
  if (isAdminUser(user)) return true;
  return String(recordEngineer || "").trim().toLowerCase() === currentEngineerName(user).toLowerCase();
}

module.exports = {
  isAdminUser,
  currentEngineerName,
  engineerRegex,
  scopeByEngineer,
  canAccessEngineerRecord,
};
