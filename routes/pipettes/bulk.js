'use strict';
const express = require('express');
const router = express.Router();
const db = require('../../db');
const equipmentTypes = require('../../utils/equipment-types');
const { authenticate, requireAnyPermission } = require('../../middleware/auth');
const {
  validateISODate, todayLocalStr,
  STANDARD_FIELDS, FORBIDDEN_CUSTOM_KEYS,
  computeBarcodeValue, canAccessDepartment,
} = require('./_helpers');
const { withTransaction } = require('../../utils/db-helper');
const { logAction } = require('../../utils/audit');

// ═══════════════════════════════════════════════════════════
// POST /bulk-create — пакетное создание
// ═══════════════════════════════════════════════════════════
router.post('/bulk-create', authenticate, requireAnyPermission(['add_pipette', 'manage_pipettes']), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Передайте массив rows' });
  }
  if (rows.length > 100) {
    return res.status(400).json({ error: 'Максимум 100 строк за раз' });
  }

  const typesCache = await equipmentTypes.getEquipmentTypes();
  const validTypesSet = new Set(typesCache.map(t => t.value));

  const errors = [];
  const normalized = rows.map((r, idx) => {
    const lineNo = idx + 1;
    const equipmentType = String(r.equipmentType || 'pipette').trim() || 'pipette';
    const model = String(r.model || '').replace(/[\s\u00A0\u2000-\u200A\u2028\u2029\u3000]+/g, ' ').trim();
    if (!model) errors.push(`Строка ${lineNo}: не указана модель`);
    if (model.length > 255) errors.push(`Строка ${lineNo}: модель слишком длинная`);
    if (!validTypesSet.has(equipmentType)) {
      errors.push(`Строка ${lineNo}: неизвестный тип «${equipmentType}»`);
    }

    const lastCalibration = String(r.lastCalibration || '').trim();
    if (!lastCalibration) {
      errors.push(`Строка ${lineNo}: не указана дата поверки`);
    } else {
      const dc = validateISODate(lastCalibration);
      if (!dc.ok) errors.push(`Строка ${lineNo}: ${dc.error}`);
      else if (lastCalibration > todayLocalStr()) errors.push(`Строка ${lineNo}: дата поверки в будущем`);
    }
    const serial = String(r.serial || '').trim();
    if (serial.length > 255) errors.push(`Строка ${lineNo}: серийный номер слишком длинный`);
    const manufacturer = String(r.manufacturer || '').trim();
    if (manufacturer.length > 255) errors.push(`Строка ${lineNo}: производитель слишком длинный`);

    let responsible = String(r.responsible || '').replace(/[\s\u00A0\u2000-\u200A\u2028\u2029\u3000]+/g, ' ').trim();
    let department = String(r.department || '').trim();

    // Админ не подменяется данными и.о. — даже если случайно его включили
    if (req.user.is_acting && !req.user._isAdmin) {
      responsible = req.user.acting_full_name || '';
      department = req.user.acting_department || '';
    }
    if (!responsible) errors.push(`Строка ${lineNo}: не указан ответственный`);

    if (req.user.only_own_department && !req.user._isAdmin) {
      if (!req.user.department) errors.push(`Строка ${lineNo}: у вас не указан отдел`);
      else if (department && department !== req.user.department) errors.push(`Строка ${lineNo}: можно создавать только в своём отделе`);
      department = req.user.department;
    }

    let interval = parseInt(r.interval, 10);
    if (!Number.isFinite(interval) || interval < 1 || interval > 120) {
      const td = typesCache.find(x => x.value === equipmentType);
      const ti = td ? parseInt(td.interval, 10) : NaN;
      interval = (Number.isFinite(ti) && ti >= 1 && ti <= 120) ? ti : 12;
    }

    const customData = {};
    for (const [k, v] of Object.entries(r)) {
      if (FORBIDDEN_CUSTOM_KEYS.has(k)) continue;
      if (!STANDARD_FIELDS.has(k) && k !== 'id' && !k.startsWith('_') && v !== undefined && v !== null && v !== '') {
        customData[k] = v;
      }
    }

    return {
      lineNo, equipmentType, model, serial, manufacturer,
      volume: String(r.volume || '').trim(),
      department, responsible, lastCalibration, interval,
      cert: String(r.cert || '').trim(),
      location: String(r.location || '').trim(),
      notes: String(r.notes || '').trim(),
      result: ['pass', 'fail', 'wip'].includes(r.result) ? r.result : 'pass',
      active: (r.active === false || r.active === 0 || r.active === 'false' || r.active === '0') ? 0 : 1,
      custom_data: customData,
    };
  });

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Валидация не пройдена:\n' + errors.join('\n'), details: errors });
  }

  const createdIds = [];
  try {
    await withTransaction(async (conn) => {
      const prefixCache = {};
      const fallback = { pipette: 'P', analyzer: 'A', thermometer: 'T', scales: 'S', photometer: 'F', microscope: 'M' };
      for (const n of normalized) {
        if (prefixCache[n.equipmentType] !== undefined) continue;
        const td = typesCache.find(x => x.value === n.equipmentType);
        let p = td && td.prefix ? String(td.prefix).trim().toUpperCase() : null;
        if (!p) p = fallback[n.equipmentType] || 'EQ';
        prefixCache[n.equipmentType] = p;
      }

      for (const n of normalized) {
        const id = await db.generatePipetteId(prefixCache[n.equipmentType], conn);
        const computed = computeBarcodeValue({ id, serial: n.serial, custom_data: n.custom_data });

        await conn.query(
          `INSERT INTO pipettes
            (id, serial, manufacturer, model, equipment_type, volume, department, \`interval\`,
             last_calibration, cert, last_result, active, responsible, location, notes,
             custom_data, barcode, barcode_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, n.serial, n.manufacturer, n.model, n.equipmentType, n.volume,
            n.department, n.interval, n.lastCalibration, n.cert, n.result, n.active,
            n.responsible, n.location, n.notes,
            Object.keys(n.custom_data).length ? JSON.stringify(n.custom_data) : null,
            computed.value, computed.source,
          ]
        );

        if (n.lastCalibration) {
          await conn.query(
            `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, note)
             VALUES (?, ?, ?, ?, ?)`,
            [id, n.lastCalibration, n.cert, n.result, 'Первичная поверка (партия)']
          );
        }
        createdIds.push(id);
      }
    });

    // Аудит — после коммита
    if (createdIds.length > 0) {
      const first = createdIds[0];
      const last = createdIds[createdIds.length - 1];
      await logAction(req, 'Пакетное добавление',
        `${createdIds.length} шт. (${createdIds.length > 1 ? first + ' … ' + last : first})`);
    }

    res.status(201).json({
      message: `Создано ${createdIds.length} единиц`,
      count: createdIds.length,
      ids: createdIds,
    });
  } catch (e) {
    console.error('Bulk-create error:', e);
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Конфликт ID, попробуйте ещё раз' });
    res.status(500).json({ error: 'Ошибка пакетного добавления: ' + e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /bulk-send — массовая отправка на поверку
// ═══════════════════════════════════════════════════════════
router.post('/bulk-send', authenticate, requireAnyPermission(['bulk_send', 'manage_pipettes']), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }
  const { ids, sentDate, note } = req.body;
  const replacements = (req.body.replacements && typeof req.body.replacements === 'object' && !Array.isArray(req.body.replacements))
    ? req.body.replacements : {};

  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Не выбрано ни одной единицы оборудования' });
  if (!sentDate) return res.status(400).json({ error: 'Заполните поле «Дата отправки»' });
  if (ids.length > 100) return res.status(400).json({ error: 'Слишком много единиц за раз (максимум 100)' });

  const usedReplacements = new Set();
  for (const [origId, replId] of Object.entries(replacements)) {
    if (!replId) continue;
    if (replId === origId) return res.status(400).json({ error: `Оборудование ${origId} не может заменить само себя` });
    if (usedReplacements.has(replId)) return res.status(400).json({ error: `Одна единица (${replId}) не может заменить несколько. Выберите разные замены.` });
    usedReplacements.add(replId);
  }

  const successful = [];
  const skipped = [];
  const notFound = [];
  const skippedReplacements = [];

  try {
    await withTransaction(async (conn) => {
      const typesCache = await equipmentTypes.getEquipmentTypes();
      const isExternalType = (t) => {
        const found = typesCache.find(x => x.value === t);
        if (!found) return true;
        return (found.calibrationPlace || 'internal') === 'external';
      };

      for (const id of ids) {
        const [rows] = await conn.query(
          'SELECT id, model, sent_for_calibration, equipment_type, department, replacing FROM pipettes WHERE id = ? FOR UPDATE',
          [id]
        );
        if (!rows.length) { notFound.push(id); continue; }
        if (!canAccessDepartment(req.user, rows[0].department)) { skipped.push(id); continue; }
        const [lock] = await conn.query('SELECT user_id, user_full_name FROM edit_locks WHERE pipette_id = ?', [id]);
        if (lock.length && lock[0].user_id !== req.user.id) {
          skipped.push(`${id} (заблокирован: ${lock[0].user_full_name})`);
          continue;
        }
        if (!isExternalType(rows[0].equipment_type)) { skipped.push(id); continue; }
        if (rows[0].sent_for_calibration) { skipped.push(id); continue; }
        if (rows[0].replacing) { skipped.push(id); continue; }

        await conn.query(
          `UPDATE pipettes SET sent_for_calibration = ?, sent_note = ?, active = 0,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [sentDate, note || null, id]
        );

        const typeDef = typesCache.find(t => t.value === rows[0].equipment_type);
        const isReplacementAllowed = typeDef ? (typeDef.allowReplacement !== false) : true;

        const replacementId = replacements[id];
        if (replacementId && isReplacementAllowed) {
          const [repRows] = await conn.query(
            `SELECT id, location, department, equipment_type, active, sent_for_calibration, replacing
             FROM pipettes WHERE id = ?`, [replacementId]
          );
          if (repRows.length === 0) {
            skippedReplacements.push({ id, replacementId, reason: 'замена не найдена' });
            successful.push(id);
          } else {
            const rep = repRows[0];
            let reason = null;
            if (rep.equipment_type !== rows[0].equipment_type) reason = 'тип не совпадает';
            else if (rep.active) reason = 'замена уже активна';
            else if (rep.sent_for_calibration) reason = 'замена уже отправлена на поверку';
            else if (rep.replacing) reason = 'замена уже кого-то заменяет';

            if (reason) {
              skippedReplacements.push({ id, replacementId, reason });
              successful.push(id);
            } else {
              const [origRows] = await conn.query(
                'SELECT location, department FROM pipettes WHERE id = ?', [id]
              );
              const origLocation = origRows[0].location || 'Склад';
              const origDepartment = origRows[0].department || rep.department;

              await conn.query(
                `UPDATE pipettes SET active = 1, location = ?, department = COALESCE(?, department),
                   replacing = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [origLocation, origDepartment, id, replacementId]
              );
              await conn.query(
                `UPDATE pipettes SET replaced_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [replacementId, id]
              );
              successful.push(`${id} (замена: ${replacementId})`);
            }
          }
        } else {
          successful.push(id);
        }
      }
    });

    if (successful.length > 0) {
      await logAction(req, 'Отправка на поверку',
        `${successful.length} шт. (${successful.join(', ')}) — ${sentDate}`);
    }

    res.status(201).json({
      message: `Отправлено на поверку: ${successful.length}`,
      successful: successful.length,
      skipped: skipped.length,
      skippedIds: skipped,
      notFound: notFound.length,
      notFoundIds: notFound,
      skippedReplacements: skippedReplacements
    });
  } catch (e) {
    console.error('Bulk send error:', e);
    res.status(500).json({ error: 'Ошибка отправки на поверку', details: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /bulk-return — массовый возврат с поверки
// ═══════════════════════════════════════════════════════════
router.post('/bulk-return', authenticate, requireAnyPermission(['bulk_return', 'manage_pipettes']), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }
  const { items, date, org, note } = req.body;
  const returnReplacements = Array.isArray(req.body.returnReplacements) ? req.body.returnReplacements : [];

  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Не выбрано ни одной единицы оборудования' });
  if (!date) return res.status(400).json({ error: 'Заполните поле «Дата поверки»' });
  const returnDateCheck = validateISODate(date);
  if (!returnDateCheck.ok) return res.status(400).json({ error: returnDateCheck.error });
  if (items.length > 100) return res.status(400).json({ error: 'Слишком много единиц за раз (максимум 100)' });

  const successful = [];
  const skipped = [];
  const missingReplacements = [];

  try {
    await withTransaction(async (conn) => {
      const typesCache = await equipmentTypes.getEquipmentTypes();
      const isExternalType = (t) => {
        const found = typesCache.find(x => x.value === t);
        if (!found) return true;
        return (found.calibrationPlace || 'internal') === 'external';
      };

      for (const item of items) {
        if (!item.id) { skipped.push('?'); continue; }

        const [rows] = await conn.query(
          'SELECT id, equipment_type, department, sent_for_calibration, replaced_by FROM pipettes WHERE id = ? FOR UPDATE',
          [item.id]
        );
        if (!rows.length) { skipped.push(item.id); continue; }
        if (!canAccessDepartment(req.user, rows[0].department)) { skipped.push(item.id); continue; }
        const [lock] = await conn.query('SELECT user_id, user_full_name FROM edit_locks WHERE pipette_id = ?', [item.id]);
        if (lock.length && lock[0].user_id !== req.user.id) {
          skipped.push(`${item.id} (заблокирован: ${lock[0].user_full_name})`);
          continue;
        }
        if (!rows[0].sent_for_calibration && !isExternalType(rows[0].equipment_type)) {
          skipped.push(item.id);
          continue;
        }
        if (!rows[0].sent_for_calibration) { skipped.push(item.id); continue; }

        const ALLOWED = ['pass', 'fail', 'wip'];
        const itemResult = ALLOWED.includes(item.result) ? item.result : 'pass';
        const itemCert = item.cert || null;

        await conn.query(
          `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, org, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [item.id, date, itemCert, itemResult, org || null, note || null]
        );

        await conn.query(
          `UPDATE pipettes SET last_calibration = ?, cert = ?, last_result = ?,
             sent_for_calibration = NULL, sent_note = NULL, active = 1,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [date, itemCert, itemResult, item.id]
        );

        const returnRepl = returnReplacements.includes(item.id);
        const replId = rows[0].replaced_by;

        if (replId) {
          const [replExists] = await conn.query('SELECT id FROM pipettes WHERE id = ? FOR UPDATE', [replId]);
          if (replExists.length === 0) {
            await conn.query(`UPDATE pipettes SET replaced_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [item.id]);
            missingReplacements.push({ id: item.id, replacementId: replId });
          } else if (returnRepl) {
            await conn.query(
              `UPDATE pipettes SET active = 0, location = 'Склад', replacing = NULL,
                 updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [replId]
            );
            await conn.query(`UPDATE pipettes SET replaced_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [item.id]);
          } else {
            await conn.query(`UPDATE pipettes SET replaced_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [item.id]);
            await conn.query(`UPDATE pipettes SET replacing = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [replId]);
          }
        }

        successful.push(item.id);
      }
    });

    if (successful.length > 0) {
      await logAction(req, 'Возврат с поверки',
        `${successful.length} шт. (${successful.join(', ')}) — ${date}`);
    }

    res.status(201).json({
      message: `Возврат оформлен для ${successful.length} единиц`,
      successful: successful.length,
      skipped: skipped.length,
      skippedIds: skipped,
      missingReplacements: missingReplacements
    });
  } catch (e) {
    console.error('Bulk return error:', e);
    res.status(500).json({ error: 'Ошибка возврата', details: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /bulk-change-responsible — массовая смена ответственного
// ═══════════════════════════════════════════════════════════
router.post('/bulk-change-responsible', authenticate, requireAnyPermission(['bulk_change_responsible', 'manage_pipettes']), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }
  const { ids, newResponsible } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Не выбрано ни одной единицы оборудования' });
  if (!newResponsible || !String(newResponsible).trim()) return res.status(400).json({ error: 'Укажите нового ответственного' });
  if (ids.length > 500) return res.status(400).json({ error: 'Слишком много единиц за раз (максимум 500)' });

  const resp = String(newResponsible).trim();
  const successful = [];
  const skipped = [];

  try {
    await withTransaction(async (conn) => {
      for (const id of ids) {
        const [rows] = await conn.query(
          'SELECT id, department, responsible FROM pipettes WHERE id = ? FOR UPDATE', [id]
        );
        if (!rows.length) { skipped.push(id); continue; }
        if (!canAccessDepartment(req.user, rows[0].department)) { skipped.push(id); continue; }
        const [lock] = await conn.query('SELECT user_id, user_full_name FROM edit_locks WHERE pipette_id = ?', [id]);
        if (lock.length && lock[0].user_id !== req.user.id) {
          skipped.push(`${id} (заблокирован: ${lock[0].user_full_name})`);
          continue;
        }
        if (rows[0].responsible === resp) { skipped.push(id); continue; }

        await conn.query(
          `UPDATE pipettes SET responsible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [resp, id]
        );
        successful.push(id);
      }
    });

    if (successful.length > 0) {
      await logAction(req, 'Массовая смена ответственного', `${successful.length} шт. → «${resp}»`);
    }

    res.status(201).json({
      message: `Ответственный изменён у ${successful.length} единиц`,
      successful: successful.length,
      skipped: skipped.length,
      skippedIds: skipped,
    });
  } catch (e) {
    console.error('bulk-change-responsible error:', e);
    res.status(500).json({ error: 'Ошибка массовой смены ответственного' });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /bulk-lock — массовая блокировка (1 запрос вместо N)
// ═══════════════════════════════════════════════════════════
router.post('/bulk-lock', authenticate, requireAnyPermission(['add_pipette', 'edit_pipette', 'bulk_send', 'bulk_return', 'bulk_change_responsible', 'manage_pipettes']), async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids обязателен (массив)' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Максимум 200 за раз' });
    }

    // Снимаем просроченные (30 мин)
    await db.query('DELETE FROM edit_locks WHERE locked_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)');

    // Проверяем, какие приборы существуют
    const ph = ids.map(() => '?').join(',');
    const [existing] = await db.query(
      `SELECT id FROM pipettes WHERE id IN (${ph})`,
      ids
    );
    const existingSet = new Set(existing.map(r => r.id));
    const notFound = ids.filter(id => !existingSet.has(id));
    const validIds = ids.filter(id => existingSet.has(id));

    if (validIds.length === 0) {
      return res.json({ locked: [], busy: [], notFound });
    }

    // Массовый INSERT IGNORE — только там, где нет блокировки
    const validPh = validIds.map(() => '?').join(',');
    await db.query(
      `INSERT IGNORE INTO edit_locks (pipette_id, user_id, user_full_name)
       SELECT id, ?, ? FROM pipettes WHERE id IN (${validPh})`,
      [req.user.id, req.user.full_name, ...validIds]
    );

    // Обновляем время у наших (если уже были наши)
    await db.query(
      `UPDATE edit_locks SET locked_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND pipette_id IN (${validPh})`,
      [req.user.id, ...validIds]
    );

    // Проверяем, какие остались занятыми
    const [locks] = await db.query(
      `SELECT l.pipette_id, l.user_id, l.user_full_name, u.position AS locked_by_position
       FROM edit_locks l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.pipette_id IN (${validPh})`,
      validIds
    );

    const locked = [];
    const busy = [];
    for (const l of locks) {
      if (l.user_id === req.user.id) locked.push(l.pipette_id);
      else busy.push({
        id: l.pipette_id,
        lockedBy: l.user_full_name,
        lockedByPosition: l.locked_by_position,
      });
    }

    res.json({ locked, busy, notFound });
  } catch (e) {
    console.error('POST /bulk-lock error:', e);
    res.status(500).json({ error: 'Ошибка блокировки' });
  }
});

module.exports = router;
