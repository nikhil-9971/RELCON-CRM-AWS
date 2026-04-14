// ═══════════════════════════════════════════════════════
// routes/errorLogs.js  — RELCON CRM Frontend Error Logs
// Endpoints:
//   POST   /audit/logError        — save error (NO auth needed)
//   GET    /audit/errorLogs       — get all errors (admin only)
//   GET    /audit/errorLogs/stats — stats (admin only)  
//   DELETE /audit/errorLogs       — clear all (admin only)
//   GET    /audit/errorLogs/ping  — test route (no auth)
// ═══════════════════════════════════════════════════════

const express     = require('express');
const router      = express.Router();
const ErrorLog    = require('../models/ErrorLog');
const verifyToken = require('../middleware/authMiddleware');

/* ─────────────────────────────────────────────
   PING — test karo route kaam kar raha hai
   GET /audit/errorLogs/ping  (no auth)
───────────────────────────────────────────── */
router.get('/errorLogs/ping', (req, res) => {
  res.json({ ok: true, message: 'errorLogs route is working ✅', timestamp: new Date() });
});

/* ─────────────────────────────────────────────
   SAVE ERROR — frontend se aata hai
   POST /audit/logError  (NO AUTH — public)
───────────────────────────────────────────── */
router.post('/logError', async (req, res) => {
  // Always return 200 — never block the frontend
  try {
    const { type, message, page, url, userAgent, user, details, timestamp } = req.body;

    if (!message) {
      return res.status(200).json({ saved: false, reason: 'no message' });
    }

    // Get real client IP
    const clientIp =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';

    const errorLog = new ErrorLog({
      type:            type || 'unknown',
      message:         String(message).slice(0, 1000),
      page:            page     || 'unknown',
      url:             url      || '',
      userAgent:       userAgent || '',
      user:            user     || 'anonymous',
      clientTimestamp: timestamp ? new Date(timestamp) : new Date(),
      clientIp,
      details: {
        stack:      details?.stack      ? String(details.stack).slice(0, 2000)  : undefined,
        filename:   details?.filename   || undefined,
        lineno:     details?.lineno     || undefined,
        colno:      details?.colno      || undefined,
        statusCode: details?.statusCode || undefined,
        endpoint:   details?.endpoint   ? String(details.endpoint).slice(0, 500) : undefined,
        method:     details?.method     || undefined,
        response:   details?.response   ? String(details.response).slice(0, 1000) : undefined,
      },
    });

    await errorLog.save();
    console.log(`[ErrorLog] Saved: ${type} | ${page} | ${user}`);
    return res.status(200).json({ saved: true });

  } catch (err) {
    console.error('[ErrorLog] Save failed:', err.message);
    return res.status(200).json({ saved: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────
   GET ALL ERRORS — admin only
   GET /audit/errorLogs?type=&page=&from=&to=&limit=500
───────────────────────────────────────────── */
router.get('/errorLogs', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { type, page, user, from, to, limit = 500, skip = 0 } = req.query;

    const filter = {};
    if (type) filter.type = type;
    if (page) filter.page = page;
    if (user) filter.user = { $regex: user, $options: 'i' };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to)   filter.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    const [logs, total] = await Promise.all([
      ErrorLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(Number(skip))
        .limit(Math.min(Number(limit), 1000))
        .lean(),
      ErrorLog.countDocuments(filter),
    ]);

    const mapped = logs.map(l => ({
      id:          l._id,
      type:        l.type,
      message:     l.message,
      page:        l.page,
      url:         l.url,
      user:        l.user,
      userAgent:   l.userAgent,
      timestamp:   l.clientTimestamp || l.createdAt,
      clientIp:    l.clientIp,
      details:     l.details,
      createdAt:   l.createdAt,
    }));

    return res.json({ logs: mapped, total, returned: mapped.length });

  } catch (err) {
    console.error('[ErrorLog] Fetch failed:', err.message);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/* ─────────────────────────────────────────────
   STATS — admin only
   GET /audit/errorLogs/stats
───────────────────────────────────────────── */
router.get('/errorLogs/stats', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [total, todayCount, byType, byPage] = await Promise.all([
      ErrorLog.countDocuments(),
      ErrorLog.countDocuments({ createdAt: { $gte: todayStart } }),
      ErrorLog.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ErrorLog.aggregate([
        { $group: { _id: '$page', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    return res.json({
      total,
      todayCount,
      byType:  Object.fromEntries(byType.map(x => [x._id, x.count])),
      byPage:  byPage.map(x => ({ page: x._id, count: x.count })),
    });

  } catch (err) {
    console.error('[ErrorLog] Stats failed:', err.message);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/* ─────────────────────────────────────────────
   DELETE ALL — admin only
   DELETE /audit/errorLogs  body: { confirm: true }
───────────────────────────────────────────── */
router.delete('/errorLogs', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (!req.body.confirm) {
      return res.status(400).json({ error: 'Send { confirm: true } to delete all logs' });
    }
    const result = await ErrorLog.deleteMany({});
    console.log(`[ErrorLog] Cleared ${result.deletedCount} records by ${req.user.username}`);
    return res.json({ deleted: result.deletedCount, message: 'All error logs cleared' });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

module.exports = router;
