'use strict';
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { authenticate, requireAnyPermission } = require('../../middleware/auth');
const { validateISODate, todayLocalStr, canAccessDepartment, findPipetteOrFail } = require('./_helpers');
const { withTransaction } = require('../../utils/db-helper');
const { logAction } = require('../../utils/audit');

// ═══════════════════════════════════════════════════════════
// POST /:id/calibration — добавить запись о поверке
// ═══════════════════════════════════════════════════════════
router.post('/:id/calibration', authenticate, requireAnyPermission(['quick_calibration', 'edit_pipette', 'manage_pipettes']), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }
  const { date, cert, result, org, note } = req.body;

  if (!date) return res.status(400).json({ error: 'Заполните поле «Дата поверки»' });
  const calDateCheck = validateISODate(date);
  if (!calDateCheck.ok) return res.status(400).json({ error: calDateCheck.error });
  if (String(date) > todayLocalStr()) {
    return res.status(400).json({ error: 'Дата поверки не может быть в будущем' });
  }

  const ALLOWED = ['pass', 'fail', 'wip'];
  const safeResult = ALLOWED.includes(result) ? result : 'pass';

  let wasSent = false;
  let replId = null;

  try {
   const [lockChk] = await db.query('SELECT user_id, user_full_name FROM edit_locks WHERE pipette_id = ?', [req.params.id]);
  if (lockChk.length && lockChk[0].user_id !== req.user.id) {
    return res.status(409).json({ error: `Прибор заблокирован: ${lockChk[0].user_full_name}` });
  }
    await withTransaction(async (conn) => {
      const exist = await findPipetteOrFail(conn, req.params.id, req.user, { forUpdate: true });
      wasSent = !!exist.sent_for_calibration;
      replId = exist.replaced_by;

      await conn.query(
        `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, org, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.params.id, date, cert, safeResult, org, note]
      );

      await conn.query(
        `UPDATE pipettes
         SET last_calibration = ?, cert = ?, last_result = ?,
             sent_for_calibration = NULL, sent_note = NULL,
             active = CASE WHEN ? = 1 THEN 1 ELSE active END,
             replaced_by = CASE WHEN ? = 1 THEN NULL ELSE replaced_by END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [date, cert, safeResult, wasSent ? 1 : 0, wasSent ? 1 : 0, req.params.id]
      );

      if (wasSent && replId) {
        const [replExists] = await conn.query(
          'SELECT id FROM pipettes WHERE id = ? FOR UPDATE', [replId]
        );
        if (replExists.length) {
          await conn.query(
            `UPDATE pipettes SET active = 0, location = 'Склад', replacing = NULL,
               updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [replId]
          );
        }
      }
    });

    await logAction(req, 'Добавление поверки',
      `${req.params.id} — ${date}${wasSent ? ' (возврат с поверки)' : ''}`);

    res.status(201).json({
      message: 'Поверка добавлена',
      wasReturn: wasSent,
      replacementReturned: wasSent && !!replId
    });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message });
    if (e.status === 403) return res.status(403).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Ошибка добавления поверки' });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /:id/calibration — история поверок
// ═══════════════════════════════════════════════════════════
router.get('/:id/calibration', authenticate, async (req, res) => {
  try {
    const [pipRows] = await db.query(
      'SELECT department FROM pipettes WHERE id = ?', [req.params.id]
    );
    if (!pipRows.length) return res.status(404).json({ error: 'Оборудование не найдено' });
    if (!canAccessDepartment(req.user, pipRows[0].department)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const [rows] = await db.query(
      'SELECT * FROM calibration_history WHERE pipette_id = ? ORDER BY `date` DESC, id DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка загрузки истории' });
  }
});

module.exports = router;
