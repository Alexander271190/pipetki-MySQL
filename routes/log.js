const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const raw = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 100, 1000);
    const [rows] = await db.query(
      'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /log:', e);
    res.status(500).json({ error: 'Ошибка загрузки журнала' });
  }
});

router.delete('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    await db.query('DELETE FROM audit_log');
    res.json({ message: 'Лог очищен' });
  } catch (e) {
    console.error('DELETE /log:', e);
    res.status(500).json({ error: 'Ошибка очистки журнала' });
  }
});

module.exports = router;
