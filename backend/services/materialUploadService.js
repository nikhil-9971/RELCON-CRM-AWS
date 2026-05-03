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
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function normalizeUploadRow(row) {
  return {
    serialNumber: (row["Serial Number"] || row.serialNumber || row.SNo || "").toString().trim(),
    itemCode: (row["Item Code"] || row.itemCode || "").toString().trim(),
    itemName: (row["Item Name"] || row.itemName || "").toString().trim(),
    qty: row.Qty ?? row.qty ?? row.Quantity ?? 0,
    itemType: (row["Item Type"] || row.itemType || "").toString().trim(),
    itemStatus: normalizeItemStatus((row["Item Status"] || row.itemStatus || "OK").toString().trim()),
    engineerName: (row.Engineer || row.engineerName || row["Engineer Name"] || "").toString().trim(),
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
};
