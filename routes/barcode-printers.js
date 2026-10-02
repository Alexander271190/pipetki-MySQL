const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/barcode-printers — список для админа
router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM barcode_printers ORDER BY sort_order ASC, id ASC`
    );
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      department: r.department || null,
      mode: r.mode,
      ip: r.ip || null,
      port: r.port || 9100,
      labelSize: r.label_size || '58x40',
      enabled: !!r.enabled,
      isDefault: !!r.is_default,
      sortOrder: r.sort_order || 0,
    })));
  } catch (e) {
    console.error('GET /barcode-printers:', e);
    res.status(500).json({ error: 'Ошибка загрузки принтеров' });
  }
});

// GET /api/barcode-printers/available — для модалки печати пользователя
router.get('/available', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, department, mode, label_size, sort_order
       FROM barcode_printers WHERE enabled = 1
       ORDER BY sort_order ASC, id ASC`
    );

    const userDept = (req.user.is_acting && req.user.acting_department)
      ? req.user.acting_department
      : req.user.department;

    const preferred = userDept
      ? rows.find(r => r.department === userDept)
      : null;

    res.json({
      printers: rows.map(r => ({
        id: r.id,
        name: r.name,
        department: r.department || null,
        mode: r.mode,
        labelSize: r.label_size || '58x40',
      })),
      preferredId: preferred ? preferred.id : null,
      userDepartment: userDept || null,
    });
  } catch (e) {
    console.error('GET /barcode-printers/available:', e);
    res.status(500).json({ error: 'Ошибка загрузки принтеров' });
  }
});

// POST /api/barcode-printers — создать
router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { name, department, mode, ip, port, labelSize, enabled, isDefault, sortOrder } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Укажите название принтера' });
    }
    const validModes = ['pdf-a4', 'pdf-zebra', 'zebra-ip', 'zebra-agent'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Некорректный режим принтера' });
    }
    if (mode === 'zebra-ip' && (!ip || !String(ip).trim())) {
      return res.status(400).json({ error: 'Для режима «Zebra по сети» укажите IP' });
    }

    const [result] = await db.query(
      `INSERT INTO barcode_printers
       (name, department, mode, ip, port, label_size, enabled, is_default, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(name).trim(),
        department ? String(department).trim() : null,
        mode,
        ip ? String(ip).trim() : null,
        parseInt(port, 10) || 9100,
        labelSize || '58x40',
        enabled === false ? 0 : 1,
        isDefault ? 1 : 0,
        parseInt(sortOrder, 10) || 0,
      ]
    );

    if (isDefault && department) {
      await db.query(
        'UPDATE barcode_printers SET is_default = 0 WHERE department = ? AND id <> ?',
        [String(department).trim(), result.insertId]
      );
    }

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Добавление принтера', `${name} (${mode})`]
    );

    res.status(201).json({ id: result.insertId, message: 'Принтер добавлен' });
  } catch (e) {
    console.error('POST /barcode-printers:', e);
    res.status(500).json({ error: 'Ошибка создания принтера' });
  }
});

// PUT /api/barcode-printers/:id — обновить
router.put('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, department, mode, ip, port, labelSize, enabled, isDefault, sortOrder } = req.body || {};

    const [exist] = await db.query('SELECT id FROM barcode_printers WHERE id = ?', [id]);
    if (!exist.length) return res.status(404).json({ error: 'Принтер не найден' });

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Укажите название принтера' });
    }
    const validModes = ['pdf-a4', 'pdf-zebra', 'zebra-ip', 'zebra-agent'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Некорректный режим' });
    }
    if (mode === 'zebra-ip' && (!ip || !String(ip).trim())) {
      return res.status(400).json({ error: 'Для «Zebra по сети» укажите IP' });
    }

    await db.query(
      `UPDATE barcode_printers SET
         name = ?, department = ?, mode = ?, ip = ?, port = ?,
         label_size = ?, enabled = ?, is_default = ?, sort_order = ?
       WHERE id = ?`,
      [
        String(name).trim(),
        department ? String(department).trim() : null,
        mode,
        ip ? String(ip).trim() : null,
        parseInt(port, 10) || 9100,
        labelSize || '58x40',
        enabled ? 1 : 0,
        isDefault ? 1 : 0,
        parseInt(sortOrder, 10) || 0,
        id,
      ]
    );

    if (isDefault && department) {
      await db.query(
        'UPDATE barcode_printers SET is_default = 0 WHERE department = ? AND id <> ?',
        [String(department).trim(), id]
      );
    }

    res.json({ message: 'Принтер обновлён' });
  } catch (e) {
    console.error('PUT /barcode-printers:', e);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// DELETE /api/barcode-printers/:id
router.delete('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [exist] = await db.query('SELECT name FROM barcode_printers WHERE id = ?', [id]);
    if (!exist.length) return res.status(404).json({ error: 'Принтер не найден' });

    await db.query('DELETE FROM barcode_printers WHERE id = ?', [id]);

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Удаление принтера', exist[0].name]
    );

    res.json({ message: 'Принтер удалён' });
  } catch (e) {
    console.error('DELETE /barcode-printers/:id:', e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
