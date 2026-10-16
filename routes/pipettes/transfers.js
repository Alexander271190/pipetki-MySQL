'use strict';
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { authenticate, requireAnyPermission } = require('../../middleware/auth');
const { canAccessDepartment } = require('./_helpers');

// ═══════════════════════════════════════════════════════════
// GET /available-for-replacement — складские того же типа
// ═══════════════════════════════════════════════════════════
router.get('/available-for-replacement', authenticate, async (req, res) => {
  try {
    const { type, department, exclude } = req.query;
    if (!type) return res.status(400).json({ error: 'Параметр type обязателен' });

    let sql = `
      SELECT id, serial, manufacturer, model, equipment_type, volume,
             department, last_calibration, \`interval\`, last_result,
             active, responsible, location
      FROM pipettes
      WHERE equipment_type = ?
        AND active = 0
        AND sent_for_calibration IS NULL
        AND (replacing IS NULL OR replacing = '')
    `;
    const params = [type];

    if (department) {
      sql += ' AND (department = ? OR department IS NULL OR department = \'\')';
      params.push(department);
    }
    if (exclude) {
      sql += ' AND id <> ?';
      params.push(exclude);
    }
    sql += ' ORDER BY last_calibration DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error('GET /available-for-replacement:', e);
    res.status(500).json({ error: 'Ошибка поиска замены' });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /:id/transfer — передача в другой отдел
// ═══════════════════════════════════════════════════════════
router.post('/:id/transfer', authenticate, requireAnyPermission(['transfer_pipette', 'manage_pipettes']), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }
  const { department: newDept, responsible: newResp } = req.body;

  if (!newDept || !String(newDept).trim()) return res.status(400).json({ error: 'Укажите новый отдел' });
  if (!newResp || !String(newResp).trim()) return res.status(400).json({ error: 'Укажите ответственного' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT id, model, department, responsible FROM pipettes WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Оборудование не найдено' });
    }

    const p = rows[0];
    const oldDept = p.department || '';

    if (!canAccessDepartment(req.user, oldDept)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Нет доступа к этому оборудованию' });
    }
    if (String(newDept).trim() === oldDept) {
      await conn.rollback();
      return res.status(400).json({ error: 'Оборудование уже в этом отделе' });
    }

    const [deptCheck] = await conn.query(
      'SELECT name FROM departments WHERE name = ? AND enabled = 1',
      [String(newDept).trim()]
    );
    if (!deptCheck.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'Отдел не найден в справочнике' });
    }

    await conn.query(
      `UPDATE pipettes SET department = ?, responsible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [String(newDept).trim(), String(newResp).trim(), req.params.id]
    );

    await conn.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Передача в другой отдел',
       `${p.id} (${p.model}): «${oldDept || 'без отдела'}» → «${String(newDept).trim()}», ответственный: ${String(newResp).trim()}`]
    );

    await conn.commit();
    res.json({
      message: 'Оборудование передано',
      id: p.id,
      oldDepartment: oldDept,
      newDepartment: String(newDept).trim(),
      newResponsible: String(newResp).trim(),
    });
  } catch (e) {
    await conn.rollback();
    console.error('Transfer error:', e);
    res.status(500).json({ error: 'Ошибка передачи' });
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════
// POST /:id/cancel-send — отмена отправки
// ═══════════════════════════════════════════════════════════
router.post('/:id/cancel-send', authenticate, requireAnyPermission(['bulk_send', 'manage_pipettes']), async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, department, sent_for_calibration, replaced_by FROM pipettes WHERE id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Оборудование не найдено' });
    }

    const p = rows[0];
    if (!canAccessDepartment(req.user, p.department)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (!p.sent_for_calibration) {
      await conn.rollback();
      return res.status(400).json({ error: 'Оборудование не находится на поверке' });
    }

    const replId = p.replaced_by;
    if (replId) {
      const [rep] = await conn.query('SELECT id FROM pipettes WHERE id = ? FOR UPDATE', [replId]);
      if (rep.length) {
        await conn.query(
          `UPDATE pipettes SET active = 0, location = 'Склад', replacing = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [replId]
        );
      }
    }

    await conn.query(
      `UPDATE pipettes SET sent_for_calibration = NULL, sent_note = NULL,
         active = 1, replaced_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.params.id]
    );

    await conn.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Отмена отправки на поверку',
       `${p.id}${replId ? ` (замена возвращена на склад: ${replId})` : ''}`]
    );

    await conn.commit();
    res.json({ message: 'Отправка отменена', id: p.id, replacementReturned: !!replId });
  } catch (e) {
    await conn.rollback();
    console.error('cancel-send error:', e);
    res.status(500).json({ error: 'Ошибка отмены отправки' });
  } finally {
    conn.release();
  }
});

module.exports = router;
