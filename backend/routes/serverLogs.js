// ═══════════════════════════════════════════════════════
// routes/serverLogs.js  — RELCON CRM Server/Container Logs
//
// ADD IN server.js:
//   const { serverLogsRouter } = require('./routes/serverLogs');
//   app.use('/audit', serverLogsRouter);
//
// ENDPOINTS:
//   GET  /audit/serverLogs          — all logs (admin)
//   GET  /audit/serverLogs/stats    — summary stats (admin)
//   GET  /audit/serverLogs/stream   — SSE real-time stream (admin)
//   DELETE /audit/serverLogs        — clear old logs (admin)
// ═══════════════════════════════════════════════════════

const express     = require('express');
const router      = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const { ServerLog } = require('../utils/logger');

/* ── GET /audit/serverLogs ── */
router.get('/serverLogs', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const {
      level, method, url, user,
      from, to,
      search,
      limit  = 200,
      skip   = 0,
    } = req.query;

    const filter = {};
    if (level)  filter.level = level;
    if (method) filter.method = method.toUpperCase();
    if (user)   filter.user = { $regex: user, $options: 'i' };
    if (url)    filter.url  = { $regex: url,  $options: 'i' };
    if (search) filter.message = { $regex: search, $options: 'i' };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to)   filter.createdAt.$lte = new Date(new Date(to).setHours(23,59,59,999));
    }

    const [logs, total] = await Promise.all([
      ServerLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(Number(skip))
        .limit(Math.min(Number(limit), 500))
        .lean(),
      ServerLog.countDocuments(filter),
    ]);

    res.json({ logs, total, returned: logs.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /audit/serverLogs/stats ── */
router.get('/serverLogs/stats', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const hourAgo = new Date(Date.now() - 3600000);

    const [total, todayCount, lastHour, byLevel, slowRequests, recentErrors] = await Promise.all([
      ServerLog.countDocuments(),
      ServerLog.countDocuments({ createdAt: { $gte: todayStart } }),
      ServerLog.countDocuments({ createdAt: { $gte: hourAgo } }),
      ServerLog.aggregate([
        { $group: { _id: '$level', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ServerLog.find({ durationMs: { $gte: 1000 } })
        .sort({ durationMs: -1 }).limit(5)
        .select('method url statusCode durationMs createdAt').lean(),
      ServerLog.find({ level: 'error' })
        .sort({ createdAt: -1 }).limit(5)
        .select('message createdAt').lean(),
    ]);

    res.json({
      total, todayCount, lastHour,
      byLevel: Object.fromEntries(byLevel.map(x => [x._id, x.count])),
      slowRequests,
      recentErrors,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /audit/serverLogs/stream — Real-time SSE ── */
router.get('/serverLogs/stream', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).end();

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send latest 20 logs on connect
  try {
    const recent = await ServerLog.find()
      .sort({ createdAt: -1 }).limit(20).lean();
    recent.reverse().forEach(log => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    });
  } catch {}

  // Poll for new logs every 2 seconds
  let lastId = null;
  try {
    const latest = await ServerLog.findOne().sort({ createdAt: -1 }).lean();
    if (latest) lastId = latest._id;
  } catch {}

  const interval = setInterval(async () => {
    try {
      const query = lastId
        ? { _id: { $gt: lastId } }
        : { createdAt: { $gte: new Date(Date.now() - 5000) } };

      const newLogs = await ServerLog.find(query)
        .sort({ createdAt: 1 }).limit(20).lean();

      newLogs.forEach(log => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
        lastId = log._id;
      });
    } catch {
      clearInterval(interval);
    }
  }, 2000);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
});

/* ── DELETE /audit/serverLogs ── */
router.delete('/serverLogs', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    if (!req.body.confirm) return res.status(400).json({ error: 'Send { confirm: true }' });

    // Delete logs older than X days (default: delete all)
    const days = Number(req.body.olderThanDays) || 0;
    const filter = days > 0
      ? { createdAt: { $lt: new Date(Date.now() - days * 86400000) } }
      : {};

    const result = await ServerLog.deleteMany(filter);
    res.json({ deleted: result.deletedCount });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { serverLogsRouter: router };
