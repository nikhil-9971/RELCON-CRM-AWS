// ═══════════════════════════════════════════════════════
// utils/logger.js  — RELCON CRM Server Logger
// 
// Yeh file console.log/error/warn ko intercept karke
// MongoDB mein save karta hai — taaki CRM mein dekh sako
//
// HOW TO USE in server.js (TOP pe, sabse pehle):
//   require('./utils/logger');
// ═══════════════════════════════════════════════════════

const mongoose = require('mongoose');

/* ── Server Log Schema ── */
const ServerLogSchema = new mongoose.Schema({
  level:     { type: String, enum: ['info','warn','error','debug'], default: 'info' },
  message:   { type: String, maxlength: 2000 },
  data:      { type: mongoose.Schema.Types.Mixed },   // extra args
  source:    { type: String, maxlength: 200 },        // which file/route
  requestId: { type: String },                        // for HTTP request tracing
  method:    { type: String },                        // HTTP method
  url:       { type: String },                        // HTTP url
  statusCode:{ type: Number },                        // HTTP status
  ip:        { type: String },
  user:      { type: String },
  durationMs:{ type: Number },                        // response time
}, {
  timestamps: true,
  collection: 'serverlogs'
});

ServerLogSchema.index({ createdAt: -1 });
ServerLogSchema.index({ level: 1 });
ServerLogSchema.index({ createdAt: -1, level: 1 });

const ServerLog = mongoose.model('ServerLog', ServerLogSchema);

/* ── In-memory buffer (save karo agar DB not ready) ── */
const buffer = [];
const MAX_BUFFER = 200;
let dbReady = false;

async function flushBuffer() {
  if (!buffer.length) return;
  try {
    const toFlush = buffer.splice(0, buffer.length);
    await ServerLog.insertMany(toFlush, { ordered: false });
  } catch {}
}

/* ── Wait for mongoose connection ── */
mongoose.connection.on('connected', () => {
  dbReady = true;
  setTimeout(flushBuffer, 500);
});

/* ── Core save function ── */
async function saveLog(level, message, data) {
  const entry = {
    level,
    message: String(message || '').slice(0, 2000),
    data: data || undefined,
    createdAt: new Date(),
  };

  if (!dbReady || mongoose.connection.readyState !== 1) {
    buffer.push(entry);
    if (buffer.length > MAX_BUFFER) buffer.shift();
    return;
  }

  try {
    await ServerLog.create(entry);
  } catch {
    buffer.push(entry);
  }
}

/* ── Override console methods ── */
const _log   = console.log.bind(console);
const _info  = console.info.bind(console);
const _warn  = console.warn.bind(console);
const _error = console.error.bind(console);
const _debug = console.debug.bind(console);

function formatArgs(args) {
  if (args.length === 0) return '';
  if (args.length === 1) {
    const a = args[0];
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  // Multiple args
  const parts = args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  });
  return parts.join(' ');
}

function getExtra(args) {
  if (args.length <= 1) return undefined;
  const extra = args.slice(1).map(a => {
    if (a instanceof Error) return { error: a.message, stack: a.stack?.slice(0, 500) };
    return a;
  });
  return extra.length === 1 ? extra[0] : extra;
}

console.log = function(...args) {
  _log(...args);
  const msg = formatArgs(args);
  // Skip noisy/internal messages
  if (msg.includes('[RELCON Logger]') || msg.includes('logError')) return;
  saveLog('info', msg, getExtra(args));
};

console.info = function(...args) {
  _info(...args);
  saveLog('info', formatArgs(args), getExtra(args));
};

console.warn = function(...args) {
  _warn(...args);
  saveLog('warn', formatArgs(args), getExtra(args));
};

console.error = function(...args) {
  _error(...args);
  const msg = formatArgs(args);
  const firstArg = args[0];
  const extra = firstArg instanceof Error
    ? { stack: firstArg.stack?.slice(0, 1000) }
    : getExtra(args);
  saveLog('error', msg, extra);
};

console.debug = function(...args) {
  _debug(...args);
  saveLog('debug', formatArgs(args), getExtra(args));
};

/* ── HTTP Request Logger Middleware ── */
function httpLogger(req, res, next) {
  const start = Date.now();
  const requestId = Math.random().toString(36).slice(2, 10);
  req._requestId = requestId;

  // Log on response finish
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'info';

    // Skip health checks and static files
    const skipPaths = ['/', '/favicon.ico', '/health'];
    if (skipPaths.includes(req.path)) return;

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
             || req.socket?.remoteAddress
             || '';

    // Get user from JWT if available
    let user = '';
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (token) {
        const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        user = p.engineerName || p.username || p.name || '';
      }
    } catch {}

    const entry = {
      level,
      message: `${req.method} ${req.path} → ${res.statusCode} (${durationMs}ms)`,
      requestId,
      method:    req.method,
      url:       req.originalUrl || req.path,
      statusCode: res.statusCode,
      ip,
      user,
      durationMs,
    };

    if (!dbReady || mongoose.connection.readyState !== 1) {
      buffer.push({ ...entry, createdAt: new Date() });
      return;
    }

    ServerLog.create(entry).catch(() => {});
  });

  next();
}

/* ── Uncaught Exception & Unhandled Rejection ── */
process.on('uncaughtException', (err) => {
  _error('[UNCAUGHT EXCEPTION]', err);
  saveLog('error', 'Uncaught Exception: ' + err.message, {
    stack: err.stack?.slice(0, 1000)
  });
  // Give time to save before process exits
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  _error('[UNHANDLED REJECTION]', reason);
  saveLog('error', 'Unhandled Rejection: ' + String(reason), {
    stack: reason instanceof Error ? reason.stack?.slice(0, 1000) : undefined
  });
});

module.exports = { httpLogger, ServerLog };
