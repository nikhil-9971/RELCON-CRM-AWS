const express = require("express");
const mongoose = require("mongoose");
const verifyToken = require("../middleware/authMiddleware");
const { AuditTrail } = require("../models/AuditLog");

const router = express.Router();
const READ_ONLY_COLLECTIONS = new Set(["users", "loginlogs", "audittrails", "emaillogs"]);
const SENSITIVE_FIELDS = /password|token|secret|smtp_pass|app_pass/i;
const ALLOWED_QUERY_OPERATORS = new Set(["$and", "$or", "$in", "$nin", "$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$exists", "$regex", "$options"]);

function requireExplorerAdmin(req, res, next) {
  const username = String(req.user?.username || "").trim().toLowerCase();
  if (req.user?.role !== "admin" || username !== "nikhil.trivedi") {
    return res.status(403).json({ error: "Database Explorer is restricted to the primary administrator." });
  }
  next();
}

function database() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) throw new Error("Database is not connected");
  return mongoose.connection.db;
}

async function getCollection(name) {
  const collectionName = String(name || "").trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(collectionName)) throw new Error("Invalid collection name");
  const exists = await database().listCollections({ name: collectionName }, { nameOnly: true }).toArray();
  if (!exists.length) throw new Error("Collection not found");
  return database().collection(collectionName);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object" || value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_FIELDS.test(key) ? "[REDACTED]" : sanitize(item)]));
}

function assertSafeDocument(value, path = "") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertSafeDocument(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (key.startsWith("$") || key.includes("\0") || SENSITIVE_FIELDS.test(key)) throw new Error(`Unsafe field: ${path}${key}`);
    assertSafeDocument(item, `${path}${key}.`);
  });
}

function assertSafeFilter(value, depth = 0) {
  if (depth > 8) throw new Error("Filter is too deeply nested");
  if (Array.isArray(value)) return value.forEach((item) => assertSafeFilter(item, depth + 1));
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (key.startsWith("$") && !ALLOWED_QUERY_OPERATORS.has(key)) throw new Error(`Query operator ${key} is not allowed`);
    if (key === "$regex" && String(item).length > 120) throw new Error("Regex filter is too long");
    assertSafeFilter(item, depth + 1);
  });
}

function objectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid document id");
  return new mongoose.Types.ObjectId(id);
}

function writeAllowed(collectionName) {
  if (READ_ONLY_COLLECTIONS.has(collectionName)) throw new Error(`${collectionName} is protected; use its dedicated admin workflow instead.`);
}

async function audit(req, action, collection, before, after, meta = {}) {
  await AuditTrail.create({
    modifiedBy: req.user?.username || "unknown",
    action: `db-explorer:${action}`,
    recordType: collection,
    before: sanitize(before),
    after: sanitize(after),
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
    ...meta,
  }).catch((error) => console.error("DB Explorer audit log failed:", error.message));
}

router.use(verifyToken, requireExplorerAdmin);

router.get("/collections", async (req, res) => {
  try {
    const collections = await database().listCollections({}, { nameOnly: true }).toArray();
    const result = await Promise.all(collections.map(async ({ name }) => ({
      name,
      count: await database().collection(name).estimatedDocumentCount(),
      readOnly: READ_ONLY_COLLECTIONS.has(name),
    })));
    res.json({ collections: result.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unable to list collections" });
  }
});

router.get("/collections/:name/documents", async (req, res) => {
  try {
    const collection = await getCollection(req.params.name);
    const filter = req.query.filter ? JSON.parse(String(req.query.filter)) : {};
    assertSafeFilter(filter);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 250);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const total = await collection.countDocuments(filter);
    const documents = await collection.find(filter).skip(skip).limit(limit).toArray();
    res.json({ documents: documents.map(sanitize), total, limit, skip, readOnly: READ_ONLY_COLLECTIONS.has(collection.collectionName) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to load documents" });
  }
});

router.post("/collections/:name/documents", async (req, res) => {
  try {
    const collection = await getCollection(req.params.name);
    writeAllowed(collection.collectionName);
    const document = req.body?.document;
    if (!document || Array.isArray(document) || typeof document !== "object") throw new Error("A JSON document is required");
    assertSafeDocument(document);
    delete document._id;
    const result = await collection.insertOne(document);
    const saved = await collection.findOne({ _id: result.insertedId });
    await audit(req, "create", collection.collectionName, null, saved);
    res.status(201).json({ document: sanitize(saved) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to create document" });
  }
});

router.put("/collections/:name/documents/:id", async (req, res) => {
  try {
    const collection = await getCollection(req.params.name);
    writeAllowed(collection.collectionName);
    const _id = objectId(req.params.id);
    const document = req.body?.document;
    if (!document || Array.isArray(document) || typeof document !== "object") throw new Error("A JSON document is required");
    assertSafeDocument(document);
    delete document._id;
    const before = await collection.findOne({ _id });
    if (!before) return res.status(404).json({ error: "Document not found" });
    await collection.replaceOne({ _id }, document);
    const after = await collection.findOne({ _id });
    await audit(req, "replace", collection.collectionName, before, after);
    res.json({ document: sanitize(after) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to update document" });
  }
});

router.delete("/collections/:name/documents/:id", async (req, res) => {
  try {
    const collection = await getCollection(req.params.name);
    writeAllowed(collection.collectionName);
    const _id = objectId(req.params.id);
    const before = await collection.findOne({ _id });
    if (!before) return res.status(404).json({ error: "Document not found" });
    await collection.deleteOne({ _id });
    await audit(req, "delete", collection.collectionName, before, null);
    res.json({ deleted: true });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to delete document" });
  }
});

router.post("/collections/:name/bulk-update", async (req, res) => {
  try {
    const collection = await getCollection(req.params.name);
    writeAllowed(collection.collectionName);
    const filter = req.body?.filter || {};
    const set = req.body?.set;
    assertSafeFilter(filter); assertSafeDocument(set);
    if (!set || Array.isArray(set) || !Object.keys(set).length) throw new Error("A non-empty JSON update is required");
    const result = await collection.updateMany(filter, { $set: set });
    await audit(req, "bulk-update", collection.collectionName, { filter }, { set, modifiedCount: result.modifiedCount });
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to bulk update documents" });
  }
});

router.post("/collections/:name/bulk-delete", async (req, res) => {
  try {
    const collection = await getCollection(req.params.name);
    writeAllowed(collection.collectionName);
    const filter = req.body?.filter || {};
    assertSafeFilter(filter);
    if (req.body?.confirmation !== `DELETE ${collection.collectionName}`) throw new Error(`Confirmation must be: DELETE ${collection.collectionName}`);
    const result = await collection.deleteMany(filter);
    await audit(req, "bulk-delete", collection.collectionName, { filter, deletedCount: result.deletedCount }, null);
    res.json({ deletedCount: result.deletedCount });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to bulk delete documents" });
  }
});

module.exports = router;
