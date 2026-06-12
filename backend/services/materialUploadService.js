const XLSX = require("xlsx");
const MaterialManagement = require("../models/MaterialManagement");
const MaterialUploadSchedule = require("../models/MaterialUploadSchedule");

const VALID_STATUSES = ["OK", "Not Ok (Faulty)", "Under Repair", "Scrapped"];
const UPLOAD_SCHEDULE_KEY = "material-management";

function normalizeItemStatus(status = "") {
  const value = String(status).trim().toLowerCase();
  if (!value) return "";
  if (value === "ok") return "OK";
  if (value === "faulty" || value === "not ok / faulty" || value === "not ok (faulty)") return "Not Ok (Faulty)";
  if (value === "under repair") return "Under Repair";
  if (value === "scrapped") return "Scrapped";
  return status;
}

function normalizeHeader(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseFlexibleDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  if (!text) return null;

  const dmy = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const ymd = text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (ymd) {
    const [, year, month, day] = ymd;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validateRow(row) {
  const errors = [];
  if (!row.itemCode) errors.push("itemCode is required");
  if (!row.itemName) errors.push("itemName is required");
  if (row.qty === undefined || row.qty === null || Number.isNaN(Number(row.qty))) errors.push("qty must be a number");
  if (!row.itemType) errors.push("itemType is required");
  if (!row.itemStatus || !VALID_STATUSES.includes(row.itemStatus)) errors.push(`itemStatus must be one of: ${VALID_STATUSES.join(", ")}`);
  if (!row.engineerName) errors.push("engineerName is required");
  return errors;
}

async function getOrCreateUploadSchedule() {
  let schedule = await MaterialUploadSchedule.findOne({ moduleKey: UPLOAD_SCHEDULE_KEY });
  if (!schedule) schedule = await MaterialUploadSchedule.create({ moduleKey: UPLOAD_SCHEDULE_KEY });
  return schedule;
}

function sanitizeSchedule(schedule) {
  if (!schedule) return null;
  const raw = typeof schedule.toObject === "function" ? schedule.toObject() : { ...schedule };
  delete raw.scheduledFileBuffer;
  return raw;
}

function parseWorkbookRows(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
}

function normalizeUploadRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    normalized[normalizeHeader(key)] = value;
  }

  return {
    serialNumber: (
      normalized.serialnumber ||
      normalized.sno ||
      normalized.serialno ||
      ""
    ).toString().trim(),
    itemCode: (normalized.itemcode || "").toString().trim(),
    itemName: (normalized.itemname || "").toString().trim(),
    qty: normalized.qty ?? normalized.quantity ?? 0,
    itemType: (normalized.itemtype || "").toString().trim(),
    itemStatus: normalizeItemStatus((normalized.itemstatus || "OK").toString().trim()),
    engineerName: (
      normalized.engineer ||
      normalized.engineername ||
      ""
    ).toString().trim(),
    faultyMaterialCreatedAt: parseFlexibleDate(
      normalized.faultymaterialcreationdate ||
      normalized.faultymaterialcreateddate ||
      normalized.faultymaterialcreatedat ||
      normalized.creationdate ||
      normalized.createdat ||
      normalized.faultymaterialdate ||
      ""
    ),
  };
}

async function importMaterialFileBuffer(fileBuffer, options = {}) {
  const actor = String(options.actorName || "System").trim() || "System";
  const rows = parseWorkbookRows(fileBuffer);
  if (!rows.length) {
    return { success: false, message: "Sheet is empty", inserted: 0, skipped: 0, errorRows: [] };
  }

  const validRows = [];
  const errorRows = [];
  rows.forEach((rawRow, index) => {
    const row = normalizeUploadRow(rawRow);
    const errors = validateRow(row);
    if (errors.length) {
      errorRows.push({ row: index + 2, data: rawRow, errors });
      return;
    }
    validRows.push({
      ...row,
      qty: Number(row.qty),
      itemCode: row.itemCode.toUpperCase(),
      itemType: row.itemType.toUpperCase(),
      serialNumber: row.serialNumber || `MAT-${Date.now()}-${index}`,
      ...(row.faultyMaterialCreatedAt && { faultyMaterialCreatedAt: row.faultyMaterialCreatedAt }),
      uploadedBy: actor,
    });
  });

  if (!validRows.length) {
    return {
      success: false,
      message: "No valid rows found in file. Existing material data was not changed.",
      inserted: 0,
      skipped: 0,
      errorRows,
    };
  }

  const schedule = await getOrCreateUploadSchedule();
  const currentScheduleKey = schedule.scheduledDate && schedule.scheduledTime
    ? `${schedule.scheduledDate} ${schedule.scheduledTime}`
    : "";
  const existingCount = await MaterialManagement.countDocuments({});
  if (schedule.replaceExistingOnUpload) {
    await MaterialManagement.deleteMany({});
  }

  let inserted = 0;
  let skipped = 0;
  const skipList = [];

  for (const row of validRows) {
    try {
      await MaterialManagement.create(row);
      inserted += 1;
    } catch (err) {
      if (err.code === 11000) {
        skipped += 1;
        skipList.push(row.serialNumber);
      } else {
        throw err;
      }
    }
  }

  schedule.lastUploadAt = new Date();
  schedule.lastUploadedBy = actor;
  schedule.lastDeletedCount = schedule.replaceExistingOnUpload ? existingCount : 0;
  schedule.lastInsertedCount = inserted;
  const processedScheduleKey = options.processedScheduleKey || currentScheduleKey;
  if (processedScheduleKey) {
    schedule.lastProcessedScheduleKey = processedScheduleKey;
  }
  if (options.processedScheduleKey) {
    schedule.lastAutoImportAt = new Date();
  }
  await schedule.save();

  return {
    success: true,
    message: `Upload complete: ${inserted} inserted, ${skipped} skipped, ${errorRows.length} invalid`,
    inserted,
    skipped,
    deletedCount: schedule.replaceExistingOnUpload ? existingCount : 0,
    replaceExistingOnUpload: schedule.replaceExistingOnUpload,
    skipList,
    errorRows,
  };
}

module.exports = {
  VALID_STATUSES,
  normalizeItemStatus,
  validateRow,
  getOrCreateUploadSchedule,
  sanitizeSchedule,
  importMaterialFileBuffer,
  UPLOAD_SCHEDULE_KEY,
  normalizeHeader,
  parseFlexibleDate,
};
