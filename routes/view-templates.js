const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/view-templates — все шаблоны
router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM view_templates ORDER BY is_default DESC, name ASC'
    );
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      visibleFields: db.safeParse(r.visible_fields, []),
      isDefault: !!r.is_default,
    })));
  } catch (e) {
    console.error('GET /view-templates:', e);
    res.status(500).json({ error: 'Ошибка загрузки шаблонов' });
  }
});

// POST /api/view-templates
router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { name, visibleFields, isDefault } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Укажите название шаблона' });
    }
    if (!Array.isArray(visibleFields) || visibleFields.length === 0) {
      return res.status(400).json({ error: 'Выберите хотя бы одно поле' });
    }

    const [ex] = await db.query(
      'SELECT id FROM view_templates WHERE name = ?',
      [String(name).trim()]
    );
    if (ex.length) return res.status(409).json({ error: 'Имя занято' });

    const [result] = await db.query(
      'INSERT INTO view_templates (name, visible_fields, is_default) VALUES (?, ?, ?)',
      [String(name).trim(), JSON.stringify(visibleFields), isDefault ? 1 : 0]
    );

    if (isDefault) {
      await db.query('UPDATE view_templates SET is_default = 0 WHERE id <> ?', [result.insertId]);
    }

    res.status(201).json({ id: result.insertId, message: 'Шаблон создан' });
  } catch (e) {
    console.error('POST /view-templates:', e);
    res.status(500).json({ error: 'Ошибка создания' });
  }
});

// PUT /api/view-templates/:id
router.put('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, visibleFields, isDefault } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Укажите название' });
    }
    if (!Array.isArray(visibleFields) || visibleFields.length === 0) {
      return res.status(400).json({ error: 'Выберите хотя бы одно поле' });
    }

    const [ex] = await db.query('SELECT id FROM view_templates WHERE id = ?', [id]);
    if (!ex.length) return res.status(404).json({ error: 'Не найден' });

    const [dup] = await db.query(
      'SELECT id FROM view_templates WHERE name = ? AND id <> ?',
      [String(name).trim(), id]
    );
    if (dup.length) return res.status(409).json({ error: 'Имя занято' });

    await db.query(
      `UPDATE view_templates SET name = ?, visible_fields = ?, is_default = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [String(name).trim(), JSON.stringify(visibleFields), isDefault ? 1 : 0, id]
    );

    if (isDefault) {
      await db.query('UPDATE view_templates SET is_default = 0 WHERE id <> ?', [id]);
    }

    res.json({ message: 'Шаблон обновлён' });
  } catch (e) {
    console.error('PUT /view-templates:', e);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// DELETE /api/view-templates/:id
router.delete('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [ex] = await db.query('SELECT name FROM view_templates WHERE id = ?', [id]);
    if (!ex.length) return res.status(404).json({ error: 'Не найден' });

    await db.query('UPDATE users SET view_template_id = NULL WHERE view_template_id = ?', [id]);
    await db.query('DELETE FROM view_templates WHERE id = ?', [id]);

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Удаление шаблона вида', ex[0].name]
    );

    res.json({ message: 'Шаблон удалён' });
  } catch (e) {
    console.error('DELETE /view-templates/:id:', e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// POST /api/view-templates/:id/apply-to-user/:userId
router.post('/:id/apply-to-user/:userId', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const tplId = parseInt(req.params.id, 10);
    const userId = req.params.userId;

    const [tpl] = await db.query('SELECT id FROM view_templates WHERE id = ?', [tplId]);
    if (!tpl.length) return res.status(404).json({ error: 'Шаблон не найден' });

    const [user] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user.length) return res.status(404).json({ error: 'Пользователь не найден' });

    await db.query('UPDATE users SET view_template_id = ? WHERE id = ?', [tplId, userId]);

    res.json({ message: 'Шаблон назначен' });
  } catch (e) {
    console.error('apply view template:', e);
    res.status(500).json({ error: 'Ошибка назначения' });
  }
});

module.exports = router;
