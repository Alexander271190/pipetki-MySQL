const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/equipment-templates — все шаблоны
router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, data FROM equipment_templates ORDER BY name'
    );
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      data: db.safeParse(r.data, {}),
    })));
  } catch (e) {
    console.error('GET /equipment-templates:', e);
    res.status(500).json({ error: 'Ошибка загрузки шаблонов' });
  }
});

// POST /api/equipment-templates — создать (только админ)
router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { name, data } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Укажите название' });
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ error: 'Нет данных шаблона' });
    }
    const [ex] = await db.query(
      'SELECT id FROM equipment_templates WHERE name = ?',
      [String(name).trim()]
    );
    if (ex.length) return res.status(409).json({ error: 'Имя занято' });

    const [result] = await db.query(
      'INSERT INTO equipment_templates (name, data, created_by) VALUES (?, ?, ?)',
      [String(name).trim(), JSON.stringify(data), req.user.id]
    );

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Создание шаблона единицы', String(name).trim()]
    );

    res.status(201).json({ id: result.insertId, message: 'Шаблон создан' });
  } catch (e) {
    console.error('POST /equipment-templates:', e);
    res.status(500).json({ error: 'Ошибка создания' });
  }
});

// DELETE /api/equipment-templates/:id — удалить (только админ)
router.delete('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [ex] = await db.query('SELECT name FROM equipment_templates WHERE id = ?', [id]);
    if (!ex.length) return res.status(404).json({ error: 'Не найден' });

    await db.query('DELETE FROM equipment_templates WHERE id = ?', [id]);

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Удаление шаблона единицы', ex[0].name]
    );

    res.json({ message: 'Шаблон удалён' });
  } catch (e) {
    console.error('DELETE /equipment-templates/:id:', e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
