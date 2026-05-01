const express = require("express");
const multer = require("multer");
const path = require("path");
const XLSX = require("xlsx");

const InvoiceManagement = require("../models/InvoiceManagement");
const { verifyToken, requireRole } = require("./auth");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if ([".xlsx", ".xls", ".csv"].includes(ext)) return cb(null, true);
    cb(new Error("Only .xlsx, .xls and .csv files are allowed"));
  },
});

const EXPORT_HEADERS = [
  "SNO",
  "Region",
  "Callup_No",
  "Callup_Date",
  "Phase",
  "No_of_Site",
  "Available_Qty",
  "Final_Qty",
  "Per_qty_Rate",
  "Amount",
  "Tax(CGST)",
  "Final_amount",
  "Year",
  "Qtr",
  "MONTH ",
  "Remark",
  "Total_Billing_Month",
  "Billing Type",
];

function normalizeHeader(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toISODateFromExcel(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return String(value);
    const yyyy = String(parsed.y).padStart(4, "0");
    const mm = String(parsed.m).padStart(2, "0");
    const dd = String(parsed.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const text = String(value).trim();
  if (!text) return "";
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return text;
  return dt.toISOString().slice(0, 10);
}

function parseSheetRows(sheet) {
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  return rawRows.map((row, index) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) normalized[normalizeHeader(key)] = value;

    const record = {
      sno: toNumber(normalized.sno, index + 1),
      region: normalizeText(normalized.region),
      callupNo: normalizeText(normalized.callupno),
      callupDate: toISODateFromExcel(normalized.callupdate),
      phase: normalizeText(normalized.phase),
      noOfSite: toNumber(normalized.noofsite),
      availableQty: toNumber(normalized.availableqty),
      finalQty: toNumber(normalized.finalqty),
      perQtyRate: toNumber(normalized.perqtyrate),
      amount: toNumber(normalized.amount),
      taxCgst: toNumber(normalized.taxcgst),
      finalAmount: toNumber(normalized.finalamount),
      yearLabel: normalizeText(normalized.year),
      quarter: normalizeText(normalized.qtr),
      monthLabel: normalizeText(normalized.month),
      remark: normalizeText(normalized.remark),
      totalBillingMonth: toNumber(normalized.totalbillingmonth),
      billingType: normalizeText(normalized.billingtype),
    };

    return record;
  }).filter((row) => row.region || row.callupNo || row.phase || row.monthLabel);
}

function validateInvoiceRow(row) {
  const errors = [];
  if (!row.region) errors.push("Region is required");
  if (!row.callupNo) errors.push("Callup_No is required");
  if (!row.phase) errors.push("Phase is required");
  if (!row.monthLabel) errors.push("MONTH is required");
  return errors;
}

function buildQuery(queryParams = {}) {
  const {
    search = "",
    region = "",
    monthLabel = "",
    billingType = "",
    quarter = "",
    yearLabel = "",
  } = queryParams;

  const query = {};
  if (search) {
    const re = new RegExp(search, "i");
    query.$or = [
      { region: re },
      { callupNo: re },
      { phase: re },
      { remark: re },
      { billingType: re },
    ];
  }
  if (region) query.region = new RegExp(`^${region}$`, "i");
  if (monthLabel) query.monthLabel = new RegExp(`^${monthLabel}$`, "i");
  if (billingType) query.billingType = new RegExp(`^${billingType}$`, "i");
  if (quarter) query.quarter = new RegExp(`^${quarter}$`, "i");
  if (yearLabel) query.yearLabel = new RegExp(`^${yearLabel}$`, "i");
  return query;
}

function exportRows(records = []) {
  return records.map((item, index) => ([
    item.sno || index + 1,
    item.region || "",
    item.callupNo || "",
    item.callupDate || "",
    item.phase || "",
    item.noOfSite || 0,
    item.availableQty || 0,
    item.finalQty || 0,
    item.perQtyRate || 0,
    item.amount || 0,
    item.taxCgst || 0,
    item.finalAmount || 0,
    item.yearLabel || "",
    item.quarter || "",
    item.monthLabel || "",
    item.remark || "",
    item.totalBillingMonth || 0,
    item.billingType || "",
  ]));
}

router.get("/", verifyToken, requireRole(["Admin"]), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const skip = (page - 1) * limit;
    const query = buildQuery(req.query);

    const [data, total] = await Promise.all([
      InvoiceManagement.find(query).sort({ createdAt: -1, sno: 1 }).skip(skip).limit(limit).lean(),
      InvoiceManagement.countDocuments(query),
    ]);

    res.json({ success: true, data, total, page, limit });
  } catch (err) {
    console.error("[InvoiceMgmt] GET /:", err);
    res.status(500).json({ success: false, message: "Failed to fetch invoices", error: err.message });
  }
});

router.get("/stats", verifyToken, requireRole(["Admin"]), async (req, res) => {
  try {
    const query = buildQuery(req.query);
    const [totals, regions, months, billingTypes] = await Promise.all([
      InvoiceManagement.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            recordCount: { $sum: 1 },
            amount: { $sum: "$amount" },
            finalAmount: { $sum: "$finalAmount" },
            noOfSite: { $sum: "$noOfSite" },
          },
        },
      ]),
      InvoiceManagement.distinct("region", query),
      InvoiceManagement.distinct("monthLabel", query),
      InvoiceManagement.distinct("billingType", query),
    ]);

    res.json({
      success: true,
      totals: totals[0] || { recordCount: 0, amount: 0, finalAmount: 0, noOfSite: 0 },
      filters: {
        regions: regions.filter(Boolean).sort(),
        months: months.filter(Boolean).sort(),
        billingTypes: billingTypes.filter(Boolean).sort(),
      },
    });
  } catch (err) {
    console.error("[InvoiceMgmt] GET /stats:", err);
    res.status(500).json({ success: false, message: "Failed to fetch invoice stats", error: err.message });
  }
});

router.post("/bulk-upload", verifyToken, requireRole(["Admin"]), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Upload file is required" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return res.status(400).json({ success: false, message: "Workbook is empty" });
    }

    const records = parseSheetRows(workbook.Sheets[firstSheetName]);
    if (!records.length) {
      return res.status(400).json({ success: false, message: "No usable rows found in the uploaded sheet" });
    }

    const errors = [];
    const validRows = [];
    records.forEach((row, index) => {
      const rowErrors = validateInvoiceRow(row);
      if (rowErrors.length) errors.push({ row: index + 2, errors: rowErrors });
      else validRows.push(row);
    });

    if (!validRows.length) {
      return res.status(400).json({ success: false, message: "All rows are invalid", errors: errors.slice(0, 20) });
    }

    const mode = String(req.body.mode || "append").trim().toLowerCase();
    if (mode === "replace") await InvoiceManagement.deleteMany({});

    const importedBy = req.user?.engineerName || req.user?.username || "Admin";
    const payload = validRows.map((row) => ({
      ...row,
      sourceFile: req.file.originalname || "",
      importedBy,
      importedAt: new Date(),
    }));

    await InvoiceManagement.insertMany(payload, { ordered: false });

    res.status(201).json({
      success: true,
      message: `Imported ${payload.length} invoice records successfully`,
      importedCount: payload.length,
      skippedCount: errors.length,
      errors: errors.slice(0, 20),
      mode,
    });
  } catch (err) {
    console.error("[InvoiceMgmt] POST /bulk-upload:", err);
    res.status(500).json({ success: false, message: "Failed to import invoice file", error: err.message });
  }
});

router.get("/export/excel", verifyToken, requireRole(["Admin"]), async (req, res) => {
  try {
    const query = buildQuery(req.query);
    const records = await InvoiceManagement.find(query).sort({ sno: 1, createdAt: 1 }).lean();

    const aoa = [EXPORT_HEADERS, ...exportRows(records)];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 8 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 20 }, { wch: 12 },
      { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
      { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 46 }, { wch: 20 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Invoices");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="invoice_management_export.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error("[InvoiceMgmt] GET /export/excel:", err);
    res.status(500).json({ success: false, message: "Failed to export invoices", error: err.message });
  }
});

router.delete("/admin/clear-all", verifyToken, requireRole(["Admin"]), async (req, res) => {
  try {
    const result = await InvoiceManagement.deleteMany({});
    res.json({ success: true, message: "All invoice records deleted", deletedCount: result.deletedCount || 0 });
  } catch (err) {
    console.error("[InvoiceMgmt] DELETE /admin/clear-all:", err);
    res.status(500).json({ success: false, message: "Failed to clear invoice records", error: err.message });
  }
});

router.delete("/:id", verifyToken, requireRole(["Admin"]), async (req, res) => {
  try {
    const deleted = await InvoiceManagement.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Invoice record not found" });
    res.json({ success: true, message: "Invoice record deleted" });
  } catch (err) {
    console.error("[InvoiceMgmt] DELETE /:id:", err);
    res.status(500).json({ success: false, message: "Failed to delete invoice record", error: err.message });
  }
});

module.exports = router;
