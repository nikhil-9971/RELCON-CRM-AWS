const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const path = require("path");

const MaterialManagement = require("../models/MaterialManagement");
const User = require("../models/User");
const { verifyToken, requireRole } = require("./auth");

// ── Multer config ─────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".xlsx", ".xls", ".csv"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Only .xlsx / .xls / .csv files are allowed"));
  },
});

// ── Helper ────────────────────────────────────────────────────────────────────
const VALID_STATUSES = ["OK", "Not Ok (Faulty)", "Under Repair", "Scrapped"];
const actorName = (req) => req.user?.name || req.user?.email || "System";
const buildSerial = (prefix = "MAT") => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

function normalizeItemStatus(status = "") {
  const value = String(status).trim().toLowerCase();
  if (!value) return "";
  if (value === "ok") return "OK";
  if (value === "faulty" || value === "not ok / faulty" || value === "not ok (faulty)") return "Not Ok (Faulty)";
  if (value === "under repair") return "Under Repair";
  if (value === "scrapped") return "Scrapped";
  return status;
}

function validateRow(row) {
  const errors = [];
  if (!row.itemCode)     errors.push("itemCode is required");
  if (!row.itemName)     errors.push("itemName is required");
  if (row.qty === undefined || row.qty === null || isNaN(Number(row.qty)))
    errors.push("qty must be a number");
  if (!row.itemType)     errors.push("itemType is required");
  if (!row.itemStatus || !VALID_STATUSES.includes(row.itemStatus))
    errors.push(`itemStatus must be one of: ${VALID_STATUSES.join(", ")}`);
  if (!row.engineerName) errors.push("engineerName is required");
  // customerName optional hai — UI mein field nahi hai
  return errors;
}

function buildTransferEntry({ type, qty, fromEngineer = "", toEngineer = "", note = "", referenceSerial = "", createdBy = "" }) {
  return {
    type,
    qty: Number(qty),
    fromEngineer,
    toEngineer,
    note,
    referenceSerial,
    createdBy,
    createdAt: new Date(),
  };
}

router.get("/engineers", verifyToken, requireRole(["Admin", "Manager"]), async (req, res) => {
  try {
    const users = await User.find(
      { role: { $in: ["engineer", "Engineer", "user", "User"] } },
      "engineerName username"
    ).lean();

    const engineers = [...new Set(
      users
        .map((user) => String(user.engineerName || user.username || "").trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    res.json({ success: true, engineers });
  } catch (err) {
    console.error("[MaterialMgmt] GET /engineers:", err);
    res.status(500).json({ success: false, message: "Failed to fetch engineer users", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /materialManagement — list with filters & pagination
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/", verifyToken, async (req, res) => {
  try {
    const {
      search = "",
      engineerName,
      itemType,
      itemStatus,        // ← NEW filter
      lowStock,
      customerName,
      page = 1,
      limit = 50,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = { isActive: true };

    if (search) {
      const re = new RegExp(search, "i");
      query.$or = [
        { serialNumber: re },
        { itemCode: re },
        { itemName: re },
        { engineerName: re },
        { customerName: re },
      ];
    }

    if (engineerName) query.engineerName = new RegExp(engineerName, "i");
    if (itemType)     query.itemType     = new RegExp(itemType, "i");    // free-text itemType
    if (itemStatus)   query.itemStatus   = normalizeItemStatus(itemStatus);
    if (String(lowStock).toLowerCase() === "true") query.qty = { $lte: 1 };
    if (customerName) query.customerName = new RegExp(customerName, "i");

    // UI status filter: "ok" → "OK", "faulty" → "Not Ok (Faulty)"
    if (req.query.status) query.itemStatus = normalizeItemStatus(req.query.status);

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [data, total] = await Promise.all([
      MaterialManagement.find(query).sort(sort).skip(skip).limit(parseInt(limit)).lean(),
      MaterialManagement.countDocuments(query),
    ]);

    res.json({ success: true, data, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("[MaterialMgmt] GET /:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /materialManagement/stats — UI stat cards ke liye
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/stats", verifyToken, async (req, res) => {
  try {
    const [total, byStatus, byType, byEngineer] = await Promise.all([
      MaterialManagement.countDocuments({ isActive: true }),

      // UI mein "OK Items" aur "Not OK (Faulty)" stat cards hain
      MaterialManagement.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: "$itemStatus", count: { $sum: 1 } } },
      ]),

      MaterialManagement.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: "$itemType", count: { $sum: 1 }, totalQty: { $sum: "$qty" } } },
        { $sort: { count: -1 } },
      ]),

      MaterialManagement.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: "$engineerName", count: { $sum: 1 }, totalQty: { $sum: "$qty" } } },
        { $sort: { totalQty: -1 } },
        { $limit: 10 },
      ]),
    ]);

    // UI ke stat cards: statOk, statFaulty
    const okCount     = byStatus.find(s => s._id === "OK")?.count || 0;
    const faultyCount = byStatus.find(s => s._id === "Not Ok (Faulty)")?.count || 0;
    const lowStockCount = await MaterialManagement.countDocuments({ isActive: true, qty: { $lte: 1 } });
    const recentTransfers = await MaterialManagement.aggregate([
      { $match: { isActive: true, transferHistory: { $exists: true, $ne: [] } } },
      { $unwind: "$transferHistory" },
      { $sort: { "transferHistory.createdAt": -1 } },
      { $limit: 8 },
      {
        $project: {
          _id: 1,
          itemCode: 1,
          itemName: 1,
          engineerName: 1,
          serialNumber: 1,
          itemType: 1,
          transfer: "$transferHistory",
        },
      },
    ]);

    res.json({ success: true, total, okCount, faultyCount, lowStockCount, byStatus, byType, byEngineer, recentTransfers });
  } catch (err) {
    console.error("[MaterialMgmt] GET /stats:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /materialManagement/:id/transfer — transfer ownership to another engineer
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/:id/transfer", verifyToken, requireRole(["Admin", "Manager"]), async (req, res) => {
  try {
    const { toEngineer, note = "" } = req.body;

    if (!toEngineer || !toEngineer.trim()) {
      return res.status(400).json({ success: false, message: "Target engineer is required" });
    }

    const source = await MaterialManagement.findById(req.params.id);
    if (!source || !source.isActive) {
      return res.status(404).json({ success: false, message: "Source material not found" });
    }
    if (source.engineerName.trim().toLowerCase() === toEngineer.trim().toLowerCase()) {
      return res.status(400).json({ success: false, message: "Source and target engineer cannot be same" });
    }

    const createdBy = actorName(req);
    const normalizedToEngineer = toEngineer.trim();
    const previousEngineer = source.engineerName;
    source.engineerName = normalizedToEngineer;
    source.lastTransferredAt = new Date();
    source.transferHistory.push(buildTransferEntry({
      type: "OUT",
      qty: source.qty,
      fromEngineer: previousEngineer,
      toEngineer: normalizedToEngineer,
      note,
      referenceSerial: source.serialNumber,
      createdBy,
    }));
    await source.save();

    res.json({
      success: true,
      message: `${source.itemCode} transferred to ${normalizedToEngineer}`,
      data: {
        source,
      },
    });
  } catch (err) {
    console.error("[MaterialMgmt] POST /:id/transfer:", err);
    res.status(500).json({ success: false, message: "Transfer failed", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /materialManagement/admin/clear-all — permanently remove all records
// ═══════════════════════════════════════════════════════════════════════════════
router.delete("/admin/clear-all", verifyToken, requireRole(["Admin"]), async (req, res) => {
  try {
    const result = await MaterialManagement.deleteMany({});
    res.json({
      success: true,
      message: `Cleared ${result.deletedCount || 0} material record(s) permanently`,
      deletedCount: result.deletedCount || 0,
      clearedBy: actorName(req),
    });
  } catch (err) {
    console.error("[MaterialMgmt] DELETE /admin/clear-all:", err);
    res.status(500).json({ success: false, message: "Failed to clear material data", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /materialManagement/:id — single record
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const item = await MaterialManagement.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!item) return res.status(404).json({ success: false, message: "Record not found" });
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /materialManagement — create single record
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/", verifyToken, requireRole(["Admin"]), async (req, res) => {
  try {
    const {
      serialNumber,
      itemCode,
      itemName,
      qty,
      itemType,
      itemStatus,      // ← NEW
      engineerName,

    } = req.body;

    const errors = validateRow({ itemCode, itemName, qty, itemType, itemStatus, engineerName });
    if (errors.length)
      return res.status(400).json({ success: false, message: "Validation failed", errors });

    // Serial number auto-generate if not provided
    const finalSerial = (serialNumber || "").trim() || `MAT-${Date.now()}`;

    const existing = await MaterialManagement.findOne({ serialNumber: finalSerial });
    if (existing)
      return res.status(409).json({ success: false, message: `Serial number '${finalSerial}' already exists` });

    const record = await MaterialManagement.create({
      serialNumber: finalSerial,
      itemCode: itemCode.toUpperCase(),
      itemName,
      qty: Number(qty),
      itemType: itemType.toUpperCase(),
      itemStatus,                                   // ← NEW
      engineerName,
      
      uploadedBy: req.user?.name || req.user?.email || "Admin",
    });

    res.status(201).json({ success: true, message: "Material record created", data: record });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ success: false, message: "Duplicate serial number" });
    console.error("[MaterialMgmt] POST /:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /materialManagement/:id — update record
// ═══════════════════════════════════════════════════════════════════════════════
router.put("/:id", verifyToken, requireRole(["Admin", "Manager"]), async (req, res) => {
  try {
    const {
      serialNumber,
      itemCode,
      itemName,
      qty,
      itemType,
      itemStatus,      // ← NEW
      engineerName,

    } = req.body;

    const existing = await MaterialManagement.findById(req.params.id);
    if (!existing || !existing.isActive)
      return res.status(404).json({ success: false, message: "Record not found" });

    // itemStatus validate karein agar diya gaya ho
    if (itemStatus && !VALID_STATUSES.includes(itemStatus))
      return res.status(400).json({ success: false, message: `itemStatus must be one of: ${VALID_STATUSES.join(", ")}` });

    // Duplicate serial check (agar serial change ho raha hai)
    if (serialNumber && serialNumber !== existing.serialNumber) {
      const dup = await MaterialManagement.findOne({ serialNumber, _id: { $ne: req.params.id } });
      if (dup)
        return res.status(409).json({ success: false, message: `Serial number '${serialNumber}' already exists` });
    }

    const updated = await MaterialManagement.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          ...(serialNumber               && { serialNumber }),
          ...(itemCode                   && { itemCode: itemCode.toUpperCase() }),
          ...(itemName                   && { itemName }),
          ...(qty !== undefined          && { qty: Number(qty) }),
          ...(itemType                   && { itemType: itemType.toUpperCase() }),
          ...(itemStatus                 && { itemStatus }),          // ← NEW
          ...(engineerName               && { engineerName }),
         
        },
      },
      { new: true, runValidators: true }
    );

    res.json({ success: true, message: "Record updated", data: updated });
  } catch (err) {
    console.error("[MaterialMgmt] PUT /:id:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /materialManagement/:id — soft delete
// ═══════════════════════════════════════════════════════════════════════════════
router.delete("/:id", verifyToken, requireRole(["Admin"]), async (req, res) => {
  try {
    const item = await MaterialManagement.findById(req.params.id);
    if (!item || !item.isActive)
      return res.status(404).json({ success: false, message: "Record not found" });

    await MaterialManagement.findByIdAndUpdate(req.params.id, { $set: { isActive: false } });
    res.json({ success: true, message: "Record deleted successfully" });
  } catch (err) {
    console.error("[MaterialMgmt] DELETE /:id:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /materialManagement/bulk-upload — Excel/CSV import
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/bulk-upload", verifyToken, requireRole(["Admin"]), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const workbook  = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet     = workbook.Sheets[sheetName];
    const rows      = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) return res.status(400).json({ success: false, message: "Sheet is empty" });

    // CSV column names normalize — UI template ke exact column names match
    const normalize = (row) => ({
      serialNumber: (row["Serial Number"] || row["serialNumber"] || row["SNo"] || "").toString().trim(),
      itemCode:     (row["Item Code"]     || row["itemCode"]     || "").toString().trim(),
      itemName:     (row["Item Name"]     || row["itemName"]     || "").toString().trim(),
      qty:           row["Qty"] ?? row["qty"] ?? row["Quantity"] ?? 0,
      itemType:     (row["Item Type"]     || row["itemType"]     || "").toString().trim(),
      itemStatus:   (row["Item Status"]   || row["itemStatus"]   || "OK").toString().trim(), // ← NEW
      engineerName: (row["Engineer"]      || row["engineerName"] || row["Engineer Name"] || "").toString().trim(),
      
    });

    const validRows = [];
    const errorRows = [];

    rows.forEach((rawRow, index) => {
      const row = normalize(rawRow);
      const errors = validateRow(row);
      if (errors.length) {
        errorRows.push({ row: index + 2, data: rawRow, errors });
      } else {
        validRows.push({
          ...row,
          qty:          Number(row.qty),
          itemCode:     row.itemCode.toUpperCase(),
          itemType:     row.itemType.toUpperCase(),
          serialNumber: row.serialNumber || `MAT-${Date.now()}-${index}`,
          uploadedBy:   req.user?.name || "Admin",
        });
      }
    });

    let inserted = 0, skipped = 0;
    const skipList = [];

    for (const row of validRows) {
      try {
        await MaterialManagement.create(row);
        inserted++;
      } catch (e) {
        if (e.code === 11000) { skipped++; skipList.push(row.serialNumber); }
      }
    }

    res.json({
      success: true,
      message: `Upload complete: ${inserted} inserted, ${skipped} skipped, ${errorRows.length} invalid`,
      inserted,
      skipped,
      skipList,
      errorRows,
    });
  } catch (err) {
    console.error("[MaterialMgmt] POST /bulk-upload:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /materialManagement/export/excel — Excel export
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/export/excel", verifyToken, requireRole(["Admin", "Manager"]), async (req, res) => {
  try {
    const data = await MaterialManagement.find({ isActive: true }).lean();

    const rows = data.map((d, i) => ({
      "S.No":          i + 1,
      "Serial Number": d.serialNumber,
      "Item Code":     d.itemCode,
      "Item Name":     d.itemName,
      "Qty":           d.qty,
      "Item Type":     d.itemType,
      "Item Status":   d.itemStatus,               // ← NEW column
      "Engineer":      d.engineerName,
      "Created At":    new Date(d.createdAt).toLocaleDateString("en-IN"),
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Materials");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="material_management_${Date.now()}.xlsx"`);
    res.send(buf);
  } catch (err) {
    console.error("[MaterialMgmt] GET /export/excel:", err);
    res.status(500).json({ success: false, message: "Export failed", error: err.message });
  }
});

module.exports = router;
