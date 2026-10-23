'use strict';
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { authenticate, requireAnyPermission } = require('../../middleware/auth');
const { findPipetteOrFail } = require('./_helpers');
const { withTransaction } = require('../../utils/db-helper');
const { logAction } = require('../../utils/audit');

// ═══════════════════════════════════════════════════════════
// GET /available-for-replacement — складские того же типа
// read-only, без транзакции
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
// POST /available-for-replacement-batch — складские для массива
// ═══════════════════════════════════════════════════════════
router.post('/available-for-replacement-batch', authenticate, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Параметр items обязателен (массив)' });
    }
    if (items.length > 200) {
      return res.status(400).json({ error: 'Максимум 200 единиц за раз' });
    }

    // Группируем по типу + отделу, чтобы сделать минимум запросов
    const groups = new Map();
    const result = {};

    for (const item of items) {
      if (!item.id || !item.type) continue;
      const key = `${item.type}||${item.department || ''}`;
      if (!groups.has(key)) {
        groups.set(key, {
          type: item.type,
          department: item.department || '',
          ids: [],
        });
      }
      groups.get(key).ids.push(item.id);
    }

    for (const group of groups.values()) {
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
      const params = [group.type];

      if (group.department) {
        sql += " AND (department = ? OR department IS NULL OR department = '')";
        params.push(group.department);
      }

      if (group.ids.length > 0) {
        const ph = group.ids.map(() => '?').join(',');
        sql += ` AND id NOT IN (${ph})`;
        params.push(...group.ids);
      }

      sql += ' ORDER BY last_calibration DESC';

      const [rows] = await db.query(sql, params);

      for (const id of group.ids) {
        result[id] = rows;
      }
    }

    // Для приборов, которых нет в result (не попали в группы) — пустые массивы
    for (const item of items) {
      if (item.id && !result[item.id]) result[item.id] = [];
    }

    res.json(result);
  } catch (e) {
    console.error('POST /available-for-replacement-batch:', e);
    res.status(500).json({ error: 'Ошибка поиска замен' });
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

  const trimmedDept = String(newDept).trim();
  const trimmedResp = String(newResp).trim();

  let p;
  let oldDept;

  try {    
  const [lockChk] = await db.query('SELECT user_full_name FROM edit_locks WHERE pipette_id = ?', [req.params.id]);
  if (lockChk.length) return res.status(409).json({ error: `Прибор заблокирован: ${lockChk[0].user_full_name}` });
    await withTransaction(async (conn) => {
      p = await findPipetteOrFail(conn, req.params.id, req.user, { forUpdate: true });
      oldDept = p.department || '';

      if (trimmedDept === oldDept) {
        const err = new Error('Оборудование уже в этом отделе');
        err.status = 400;
        throw err;
      }

      const [deptCheck] = await conn.query(
        'SELECT name FROM departments WHERE name = ? AND enabled = 1',
        [trimmedDept]
      );
      if (!deptCheck.length) {
        const err = new Error('Отдел не найден в справочнике');
        err.status = 400;
        throw err;
      }

      await conn.query(
        `UPDATE pipettes SET department = ?, responsible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [trimmedDept, trimmedResp, req.params.id]
      );
    });

    await logAction(req, 'Передача в другой отдел',
      `${p.id} (${p.model}): «${oldDept || 'без отдела'}» → «${trimmedDept}», ответственный: ${trimmedResp}`);

    res.json({
      message: 'Оборудование передано',
      id: p.id,
      oldDepartment: oldDept,
      newDepartment: trimmedDept,
      newResponsible: trimmedResp,
    });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message });
    if (e.status === 403) return res.status(403).json({ error: e.message });
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error('Transfer error:', e);
    res.status(500).json({ error: 'Ошибка передачи' });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /:id/cancel-send — отмена отправки на поверку
// ═══════════════════════════════════════════════════════════
router.post('/:id/cancel-send', authenticate, requireAnyPermission(['bulk_send', 'manage_pipettes']), async (req, res) => {
  let p;
  let replId = null;

  try {
  const [lockChk] = await db.query('SELECT user_full_name FROM edit_locks WHERE pipette_id = ?', [req.params.id]);
  if (lockChk.length) return res.status(409).json({ error: `Прибор заблокирован: ${lockChk[0].user_full_name}` });
    await withTransaction(async (conn) => {
      p = await findPipetteOrFail(conn, req.params.id, req.user, { forUpdate: true });

      if (!p.sent_for_calibration) {
        const err = new Error('Оборудование не находится на поверке');
        err.status = 400;
        throw err;
      }

      replId = p.replaced_by;

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
    });

    await logAction(req, 'Отмена отправки на поверку',
      `${p.id}${replId ? ` (замена возвращена на склад: ${replId})` : ''}`);

    res.json({ message: 'Отправка отменена', id: p.id, replacementReturned: !!replId });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message });
    if (e.status === 403) return res.status(403).json({ error: e.message });
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error('cancel-send error:', e);
    res.status(500).json({ error: 'Ошибка отмены отправки' });
  }
});

module.exports = router;
