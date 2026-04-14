// ═══════════════════════════════════════════════════════
// models/ErrorLog.js
// RELCON CRM — Frontend Error Log Schema
//
// HOW TO USE:
//   const ErrorLog = require('./models/ErrorLog');
// ═══════════════════════════════════════════════════════

const mongoose = require('mongoose');

const ErrorLogSchema = new mongoose.Schema(
  {
    // Error identification
    type: {
      type: String,
      enum: [
        'js_error',
        'promise_rejection',
        'console_error',
        'console_warn',
        'fetch_error',
        'manual_error',
        'manual_warn',
        'manual_info',
        'unknown',
      ],
      default: 'unknown',
    },

    // Error content
    message: {
      type: String,
      required: true,
      maxlength: 1000,
    },

    // Where it happened
    page:      { type: String, maxlength: 100 },  // e.g. "dashboard.html"
    url:       { type: String, maxlength: 500 },  // full URL
    userAgent: { type: String, maxlength: 300 },

    // Who was logged in
    user:      { type: String, maxlength: 100 },  // engineerName or username

    // Extra detail (stack, endpoint, status code etc.)
    details: {
      stack:      { type: String, maxlength: 2000 },
      filename:   { type: String, maxlength: 300 },
      lineno:     { type: Number },
      colno:      { type: Number },
      statusCode: { type: Number },   // HTTP status code for fetch errors
      endpoint:   { type: String, maxlength: 500 },  // API endpoint that failed
      method:     { type: String, maxlength: 10 },   // GET / POST / PUT etc.
      response:   { type: String, maxlength: 1000 }, // API response body (truncated)
    },

    // Client-side timestamp (when error happened on browser)
    clientTimestamp: { type: Date },

    // Server IP (auto-filled by backend)
    clientIp: { type: String, maxlength: 50 },
  },
  {
    timestamps: true, // adds createdAt + updatedAt automatically
    collection: 'errorlogs',
  }
);

// Index for fast queries
ErrorLogSchema.index({ createdAt: -1 });
ErrorLogSchema.index({ type: 1 });
ErrorLogSchema.index({ user: 1 });
ErrorLogSchema.index({ page: 1 });

module.exports = mongoose.model('ErrorLog', ErrorLogSchema);
