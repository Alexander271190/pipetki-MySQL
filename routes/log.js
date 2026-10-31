const express = require('express');
const db = require('../db');
const { authenticate, requireAnyPermission } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════
// GET /log/errors — журнал ошибок (для админки)
// ВАЖНО: должен идти ДО GET /
// ═══════════════════════════════════════════════════════════
router.get('/errors', authenticate, requireAnyPermission(['view_log']), async (req, res) => {
  try {
    const search = req.query.search || '';
    const level = req.query.level || '';
    const dateFrom = req.query.from || '';
    const dateTo = req.query.to || '';
    const raw = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 500, 2000);

    const parts = ['1=1'];
    const params = [];

    if (level) { parts.push('level = ?'); params.push(String(level)); }
    if (search) {
      const q = `%${search}%`;
      parts.push('(message LIKE ? OR stack LIKE ? OR url LIKE ? OR user_full_name LIKE ?)');
      params.push(q, q, q, q);
    }
    if (dateFrom) { parts.push('DATE(timestamp) >= ?'); params.push(dateFrom); }
    if (dateTo)   { parts.push('DATE(timestamp) <= ?'); params.push(dateTo); }

    const whereSql = 'WHERE ' + parts.join(' AND ');

    const [cnt] = await db.query(`SELECT COUNT(*) AS c FROM app_logs ${whereSql}`, params);
    const total = Number(cnt[0].c) || 0;

    const [rows] = await db.query(
      `SELECT id, level, source, message, stack, user_id, user_full_name, method, url, status_code, ip, timestamp
       FROM app_logs ${whereSql} ORDER BY timestamp DESC LIMIT ?`,
      [...params, limit]
    );

    const [lvls] = await db.query(
      `SELECT level, COUNT(*) AS c FROM app_logs GROUP BY level`
    );
    const counters = {};
    for (const r of lvls) counters[r.level] = Number(r.c);

    res.json({ items: rows, total, counters });
  } catch (e) {
    console.error('GET /log/errors:', e);
    res.status(500).json({ error: 'Ошибка загрузки журнала ошибок' });
  }
});

router.delete('/errors', authenticate, requireAnyPermission(['view_log']), async (req, res) => {
  try {
    await db.query('DELETE FROM app_logs');
    res.json({ message: 'Журнал ошибок очищен' });
  } catch (e) {
    console.error('DELETE /log/errors:', e);
    res.status(500).json({ error: 'Ошибка очистки журнала ошибок' });
  }
});

router.get('/', authenticate, requireAnyPermission(['view_log']), async (req, res) => {
  try {
    const raw = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 100, 2000);
    const [rows] = await db.query(
      `SELECT id, user_id, user_full_name, action, details, pipette_id, category, timestamp
       FROM audit_log ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /log:', e);
    res.status(500).json({ error: 'Ошибка загрузки журнала' });
  }
});

router.delete('/', authenticate, requireAnyPermission(['view_log']), async (req, res) => {
  try {
    await db.query('DELETE FROM audit_log');
    res.json({ message: 'Лог очищен' });
  } catch (e) {
    console.error('DELETE /log:', e);
    res.status(500).json({ error: 'Ошибка очистки журнала' });
  }
});

module.exports = router;
