const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const path = require("path");

const MaterialManagement = require("../models/MaterialManagement");
const { verifyToken, requireRole } = require("./auth"); // reuse existing auth middleware

// ── Multer config (memory storage for Excel parsing) ──────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = [".xlsx", ".xls", ".csv"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Only .xlsx / .xls / .csv files are allowed"));
  },
});

// ── Helper ────────────────────────────────────────────────────────────────────
const VALID_TYPES = ["HPCL", "RBML", "BPCL", "OTHER"];

function validateRow(row) {
  const errors = [];
  if (!row.serialNumber) errors.push("serialNumber is required");
  if (!row.itemCode)     errors.push("itemCode is required");
  if (!row.itemName)     errors.push("itemName is required");
  if (row.qty === undefined || row.qty === null || isNaN(Number(row.qty))) errors.push("qty must be a number");
  if (!row.itemType || !VALID_TYPES.includes(row.itemType)) errors.push(`itemType must be one of: ${VALID_TYPES.join(", ")}`);
  if (!row.customerName) errors.push("customerName is required");
  if (!row.engineerName) errors.push("engineerName is required");
  return errors;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /materialManagement — list all (with optional filters & search)
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/", verifyToken, async (req, res) => {
  try {
    const {
      search = "",
      engineerName,
      itemType,
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
        { customerName: re },
        { engineerName: re },
      ];
    }
    if (engineerName) query.engineerName = new RegExp(engineerName, "i");
    if (itemType)     query.itemType = itemType;
    if (customerName) query.customerName = new RegExp(customerName, "i");

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
// GET /materialManagement/stats — summary stats
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/stats", verifyToken, async (req, res) => {
  try {
    const [total, byType, byEngineer] = await Promise.all([
      MaterialManagement.countDocuments({ isActive: true }),
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

    res.json({ success: true, total, byType, byEngineer });
  } catch (err) {
    console.error("[MaterialMgmt] GET /stats:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
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
// POST /materialManagement — create single record (Admin only)
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/", verifyToken, requireRole(["Admin"]), async (req, res) => {
  try {
    const { serialNumber, itemCode, itemName, qty, itemType, customerName, engineerName, remarks } = req.body;

    const errors = validateRow({ serialNumber, itemCode, itemName, qty, itemType, customerName, engineerName });
    if (errors.length) return res.status(400).json({ success: false, message: "Validation failed", errors });

    // Auto-generate serial number if not provided
    const finalSerial = serialNumber || `MAT-${Date.now()}`;

    const existing = await MaterialManagement.findOne({ serialNumber: finalSerial });
    if (existing) return res.status(409).json({ success: false, message: `Serial number '${finalSerial}' already exists` });

    const record = await MaterialManagement.create({
      serialNumber: finalSerial,
      itemCode: itemCode.toUpperCase(),
      itemName,
      qty: Number(qty),
      itemType,
      customerName,
      engineerName,
      remarks: remarks || "",
      uploadedBy: req.user?.name || req.user?.email || "Admin",
    });

    res.status(201).json({ success: true, message: "Material record created", data: record });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: "Duplicate serial number" });
    console.error("[MaterialMgmt] POST /:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /materialManagement/:id — update record (Admin only)
// ═══════════════════════════════════════════════════════════════════════════════
router.put("/:id", verifyToken, requireRole(["Admin", "Manager"]), async (req, res) => {
  try {
    const { serialNumber, itemCode, itemName, qty, itemType, customerName, engineerName, remarks } = req.body;

    const existing = await MaterialManagement.findById(req.params.id);
    if (!existing || !existing.isActive) return res.status(404).json({ success: false, message: "Record not found" });

    // Check duplicate serial (if changed)
    if (serialNumber && serialNumber !== existing.serialNumber) {
      const dup = await MaterialManagement.findOne({ serialNumber, _id: { $ne: req.params.id } });
      if (dup) return res.status(409).json({ success: false, message: `Serial number '${serialNumber}' already exists` });
    }

    const updated = await MaterialManagement.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          ...(serialNumber  && { serialNumber }),
          ...(itemCode      && { itemCode: itemCode.toUpperCase() }),
          ...(itemName      && { itemName }),
          ...(qty !== undefined && { qty: Number(qty) }),
          ...(itemType      && { itemType }),
          ...(customerName  && { customerName }),
          ...(engineerName  && { engineerName }),
          ...(remarks !== undefined && { remarks }),
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
// DELETE /materialManagement/:id — soft delete (Admin only)
// ═══════════════════════════════════════════════════════════════════════════════
router.delete("/:id", verifyToken, requireRole(["Admin"]), async (req, res) => {
  try {
    const item = await MaterialManagement.findById(req.params.id);
    if (!item || !item.isActive) return res.status(404).json({ success: false, message: "Record not found" });

    await MaterialManagement.findByIdAndUpdate(req.params.id, { $set: { isActive: false } });
    res.json({ success: true, message: "Record deleted successfully" });
  } catch (err) {
    console.error("[MaterialMgmt] DELETE /:id:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /materialManagement/bulk-upload — Admin uploads Excel/CSV sheet
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/bulk-upload", verifyToken, requireRole(["Admin"]), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) return res.status(400).json({ success: false, message: "Sheet is empty" });

    // Normalize column names (handle different cases)
    const normalize = (row) => ({
      serialNumber: (row["Serial Number"] || row["serialNumber"] || row["SNo"] || row["S.No"] || "").toString().trim(),
      itemCode:     (row["Item Code"]     || row["itemCode"]     || row["Code"]  || "").toString().trim(),
      itemName:     (row["Item Name"]     || row["itemName"]     || row["Name"]  || "").toString().trim(),
      qty:          row["Qty"] ?? row["qty"] ?? row["Quantity"] ?? row["quantity"] ?? 0,
      itemType:     (row["Item Type"]     || row["itemType"]     || row["Type"]  || "Other").toString().trim(),
      customerName: (row["Customer"]      || row["customerName"] || row["Customer Name"] || "").toString().trim(),
      engineerName: (row["Engineer"]      || row["engineerName"] || row["Engineer Name"] || "").toString().trim(),
      remarks:      (row["Remarks"]       || row["remarks"]      || "").toString().trim(),
    });

    const validRows = [];
    const errorRows = [];

    rows.forEach((rawRow, index) => {
      const row = normalize(rawRow);
      const errors = validateRow(row);
      if (errors.length) {
        errorRows.push({ row: index + 2, data: rawRow, errors }); // +2 for header row + 1-indexed
      } else {
        validRows.push({ ...row, qty: Number(row.qty), itemCode: row.itemCode.toUpperCase(), uploadedBy: req.user?.name || "Admin" });
      }
    });

    let inserted = 0;
    let skipped = 0;
    const skipList = [];

    for (const row of validRows) {
      try {
        await MaterialManagement.create(row);
        inserted++;
      } catch (e) {
        if (e.code === 11000) {
          skipped++;
          skipList.push(row.serialNumber);
        }
      }
    }

    res.json({
      success: true,
      message: `Upload complete: ${inserted} inserted, ${skipped} skipped (duplicates), ${errorRows.length} invalid rows`,
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
// GET /materialManagement/export/excel — export all as Excel
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/export/excel", verifyToken, requireRole(["Admin", "Manager"]), async (req, res) => {
  try {
    const data = await MaterialManagement.find({ isActive: true }).lean();

    const rows = data.map((d, i) => ({
      "S.No": i + 1,
      "Serial Number": d.serialNumber,
      "Item Code": d.itemCode,
      "Item Name": d.itemName,
      "Qty": d.qty,
      "Item Type": d.itemType,
      "Customer": d.customerName,
      "Engineer": d.engineerName,
      "Remarks": d.remarks || "",
      "Created At": new Date(d.createdAt).toLocaleDateString("en-IN"),
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
