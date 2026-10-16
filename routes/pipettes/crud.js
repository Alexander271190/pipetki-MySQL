'use strict';
const express = require('express');
const router = express.Router();
const db = require('../../db');
const equipmentTypes = require('../../utils/equipment-types');
const { authenticate, requireAnyPermission } = require('../../middleware/auth');
const {
  validateISODate, normalizeInterval, todayLocalStr,
  STANDARD_FIELDS, FORBIDDEN_CUSTOM_KEYS, BARCODE_MAX_LEN,
  parseCustomData, mergeCustom, mergeCustomList, computeBarcodeValue,
  maybeRegenerateId, applyIdChange, canAccessDepartment,
} = require('./_helpers');

// ═══════════════════════════════════════════════════════════
// GET / — список пипеток
// ═══════════════════════════════════════════════════════════
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.user.is_acting) {
      if (!req.user.acting_department) return res.json([]);
      const [pipettes] = await db.query(
        `SELECT * FROM pipettes WHERE department = ?`,
        [req.user.acting_department]
      );
      if (!pipettes.length) return res.json([]);
      const ids = pipettes.map(p => p.id);
      const ph  = ids.map(() => '?').join(',');
      const [counts] = await db.query(
        `SELECT pipette_id, COUNT(*) AS cnt FROM calibration_history
         WHERE pipette_id IN (${ph}) GROUP BY pipette_id`,
        ids
      );
      const byId = {};
      for (const row of counts) byId[row.pipette_id] = row.cnt;
      for (const p of pipettes) {
        p.active = !!p.active;
        p.history_count = byId[p.id] || 0;
      }
      const replIds = pipettes.flatMap(p => [p.replaced_by, p.replacing]).filter(Boolean);
      if (replIds.length) {
        const uniq = [...new Set(replIds)];
        const ph2  = uniq.map(() => '?').join(',');
        const [replRows] = await db.query(
          `SELECT id, model, manufacturer, location, active, department
           FROM pipettes WHERE id IN (${ph2})`, uniq);
        const replById = {};
        for (const r of replRows) replById[r.id] = r;
        for (const p of pipettes) {
          if (p.replaced_by && replById[p.replaced_by]) p.replacement = replById[p.replaced_by];
          if (p.replacing   && replById[p.replacing])   p.replacedFor = replById[p.replacing];
        }
      }
      mergeCustomList(pipettes);
      return res.json(pipettes);
    }

    if (req.user.role !== 'admin' && req.user.only_own_department && !req.user.department) {
      return res.json([]);
    }

    let sql = 'SELECT * FROM pipettes';
    const params = [];
    if (req.user.role !== 'admin' && req.user.only_own_department) {
      sql += ' WHERE department = ?';
      params.push(req.user.department);
    }

    const [pipettes] = await db.query(sql, params);
    if (!pipettes.length) return res.json([]);

    const ids = pipettes.map(p => p.id);
    const placeholders = ids.map(() => '?').join(',');
    const [counts] = await db.query(
      `SELECT pipette_id, COUNT(*) AS cnt FROM calibration_history
       WHERE pipette_id IN (${placeholders}) GROUP BY pipette_id`,
      ids
    );
    const byId = {};
    for (const row of counts) byId[row.pipette_id] = row.cnt;
    for (const p of pipettes) {
      p.active = !!p.active;
      p.history_count = byId[p.id] || 0;
    }

    const replIds = pipettes.flatMap(p => [p.replaced_by, p.replacing]).filter(Boolean);
    if (replIds.length > 0) {
      const uniq = [...new Set(replIds)];
      const placeholders2 = uniq.map(() => '?').join(',');
      const [replRows] = await db.query(
        `SELECT id, model, manufacturer, location, active, department
         FROM pipettes WHERE id IN (${placeholders2})`,
        uniq
      );
      const replById = {};
      for (const r of replRows) replById[r.id] = r;
      for (const p of pipettes) {
        if (p.replaced_by && replById[p.replaced_by]) p.replacement = replById[p.replaced_by];
        if (p.replacing   && replById[p.replacing])   p.replacedFor = replById[p.replacing];
      }
    }

    mergeCustomList(pipettes);
    res.json(pipettes);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка загрузки данных' });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /:id — одна пипетка
// ═══════════════════════════════════════════════════════════
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM pipettes WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Оборудование не найдено' });
    const p = rows[0];

    if (!canAccessDepartment(req.user, p.department)) {
      return res.status(403).json({ error: 'Нет доступа к этому оборудованию' });
    }

    const [h] = await db.query(
      'SELECT * FROM calibration_history WHERE pipette_id = ? ORDER BY `date` DESC, id DESC',
      [req.params.id]
    );
    p.active = !!p.active;
    p.history = h;
    mergeCustom(p);

    if (p.replaced_by) {
      const [repl] = await db.query(
        'SELECT id, model, manufacturer, location FROM pipettes WHERE id = ?',
        [p.replaced_by]
      );
      p.replacement = repl[0] || null;
    }
    if (p.replacing) {
      const [orig] = await db.query(
        'SELECT id, model, manufacturer, location FROM pipettes WHERE id = ?',
        [p.replacing]
      );
      p.replacedFor = orig[0] || null;
    }
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка загрузки данных' });
  }
});

// ═══════════════════════════════════════════════════════════
// POST / — создание
// ═══════════════════════════════════════════════════════════
router.post('/', authenticate, requireAnyPermission(['add_pipette', 'manage_pipettes']), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }

  const {
    id: rawId, serial, manufacturer, model, equipmentType,
    interval, lastCalibration, cert, result, active, location, notes
  } = req.body;

  let volume      = req.body.volume;
  let department  = req.body.department;
  let responsible = req.body.responsible;

  if (req.user.is_acting) {
    responsible = req.user.acting_full_name  || '';
    department  = req.user.acting_department || '';
  }

  const trimmedModel = String(model || '').replace(/[\s\u00A0\u2000-\u200A\u2028\u2029\u3000]+/g, ' ').trim();
  if (!trimmedModel) return res.status(400).json({ error: 'Заполните поле «Модель»' });
  if (trimmedModel.length > 255) return res.status(400).json({ error: 'Модель слишком длинная (максимум 255 символов)' });

  const trimmedSerial = String(serial || '').trim();
  if (trimmedSerial.length > 255) return res.status(400).json({ error: 'Серийный номер слишком длинный (максимум 255 символов)' });

  const trimmedManufacturer = String(manufacturer || '').trim();
  if (trimmedManufacturer.length > 255) return res.status(400).json({ error: 'Производитель слишком длинный (максимум 255 символов)' });

  const trimmedResponsible = String(responsible || '').replace(/[\s\u00A0\u2000-\u200A\u2028\u2029\u3000]+/g, ' ').trim();
  if (!trimmedResponsible) return res.status(400).json({ error: 'Заполните поле «Ответственный»' });

  if (!lastCalibration || String(lastCalibration).trim() === '') {
    return res.status(400).json({ error: 'Заполните поле «Дата последней поверки»' });
  }
  const dateCheck = validateISODate(lastCalibration);
  if (!dateCheck.ok) return res.status(400).json({ error: dateCheck.error });
  if (String(lastCalibration) > todayLocalStr()) {
    return res.status(400).json({ error: 'Дата поверки не может быть в будущем' });
  }

  const eqTypeCheck = String(equipmentType || 'pipette').trim();
  {
    const typesCache = await equipmentTypes.getEquipmentTypes();
    const validTypes = new Set(typesCache.map(t => t.value));
    if (!validTypes.has(eqTypeCheck)) {
      return res.status(400).json({
        error: `Неизвестный тип оборудования: «${eqTypeCheck}». Допустимые: ${[...validTypes].join(', ')}`,
        code: 'invalid_equipment_type'
      });
    }
  }

  if (req.user.only_own_department && req.user.role !== 'admin') {
    if (!req.user.department) {
      return res.status(403).json({ error: 'У вас не указан отдел, создание оборудования недоступно' });
    }
    if (department && department !== req.user.department) {
      return res.status(403).json({ error: 'Можно создавать оборудование только в своём отделе' });
    }
  }

  const safeInterval = normalizeInterval(interval, 12);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let id = rawId;

    if (!id) {
      let prefix = await equipmentTypes.getPrefix(equipmentType);
      if (!prefix) {
        const fallback = {
          pipette: 'P', analyzer: 'A', thermometer: 'T',
          scales: 'S', photometer: 'F', microscope: 'M',
        };
        prefix = fallback[equipmentType] || 'EQ';
      }
      id = await db.generatePipetteId(prefix, conn);
    }

    const [exist] = await conn.query('SELECT id FROM pipettes WHERE id = ?', [id]);
    if (exist.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'ID уже существует' });
    }

    const customData = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (FORBIDDEN_CUSTOM_KEYS.has(k)) continue;
      if (!STANDARD_FIELDS.has(k) && k !== 'id') customData[k] = v;
    }

    const rawBarcode = req.body.barcode;
    let barcodeValue = null;
    let barcodeSource = null;

    if (req.user.role === 'admin' && rawBarcode && String(rawBarcode).trim()) {
      const trimmed = String(rawBarcode).trim();
      if (trimmed.length > BARCODE_MAX_LEN) {
        await conn.rollback();
        return res.status(400).json({ error: `Штрихкод слишком длинный (максимум ${BARCODE_MAX_LEN} символов)` });
      }
      barcodeValue = trimmed;
      barcodeSource = 'manual';
    } else {
      const computed = computeBarcodeValue({ id, serial, custom_data: customData });
      barcodeValue = computed.value;
      barcodeSource = computed.source;
    }

    await conn.query(
      `INSERT INTO pipettes
        (id, serial, manufacturer, model, equipment_type, volume, department, \`interval\`,
         last_calibration, cert, last_result, active, responsible, location, notes, custom_data,
         barcode, barcode_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, trimmedSerial, trimmedManufacturer, trimmedModel,
        equipmentType || 'pipette', volume, department,
        safeInterval, lastCalibration, cert,
        result || 'pass',
        (active === false || active === 0 || active === 'false' || active === '0') ? 0 : 1,
        trimmedResponsible, location, notes,
        Object.keys(customData).length ? JSON.stringify(customData) : null,
        barcodeValue, barcodeSource,
      ]
    );

    if (lastCalibration) {
      await conn.query(
        `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, note)
         VALUES (?, ?, ?, ?, ?)`,
        [id, lastCalibration, cert, result || 'pass', 'Первичная поверка']
      );
    }

    await conn.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Добавление оборудования', `${id} (${trimmedModel})`]
    );

    await conn.commit();
    res.status(201).json({ message: 'Оборудование создано', id });
  } catch (e) {
    await conn.rollback();
    const RACE_CODES = new Set(['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_TRANSACTION_ROLLBACK', 'ER_QUERY_INTERRUPTED', 'ER_CHECKREAD']);
    const RACE_ERRNOS = new Set([1020, 1062, 1205, 1213, 1317]);
    const DATA_ERROR_CODES = new Set(['ER_DATA_TOO_LONG', 'ER_TRUNCATED_WRONG_VALUE', 'ER_BAD_NULL_ERROR', 'ER_NO_DEFAULT_FOR_FIELD']);
    const DATA_ERROR_ERRNOS = new Set([1406, 1292, 1048, 1364]);

    if (DATA_ERROR_CODES.has(e.code) || DATA_ERROR_ERRNOS.has(e.errno)) {
      return res.status(400).json({ error: 'Некорректные данные: ' + (e.sqlMessage || e.message), code: 'data_error' });
    }
    const isRace = RACE_CODES.has(e.code) || RACE_ERRNOS.has(e.errno) ||
      /Duplicate entry|Deadlock|lock wait timeout|Record has changed since last read/i.test(e.message || '');
    if (isRace) {
      return res.status(409).json({ error: 'ID уже занят, попробуйте сохранить ещё раз', code: 'race' });
    }
    console.error('Create pipette error:', e);
    res.status(500).json({ error: 'Ошибка создания оборудования' });
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════
// PUT /:id — обновление
// ═══════════════════════════════════════════════════════════
router.put('/:id', authenticate, requireAnyPermission(['edit_pipette', 'manage_pipettes']), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }

  const updates = req.body;

  if (req.user.is_acting) {
    updates.responsible = req.user.acting_full_name  || '';
    updates.department  = req.user.acting_department || '';
  }

  const manualBarcode = (req.user.role === 'admin' && updates.barcode !== undefined)
    ? String(updates.barcode || '').trim() : null;
  if (manualBarcode !== null && manualBarcode.length > BARCODE_MAX_LEN) {
    return res.status(400).json({ error: `Штрихкод слишком длинный (максимум ${BARCODE_MAX_LEN} символов)` });
  }
  delete updates.barcode;
  delete updates.barcodeSource;

  const [pipRows] = await db.query(
    'SELECT department, equipment_type, responsible FROM pipettes WHERE id = ?',
    [req.params.id]
  );
  if (!pipRows.length) return res.status(404).json({ error: 'Оборудование не найдено' });

  if (updates.equipmentType !== undefined) {
    const typesCache = await equipmentTypes.getEquipmentTypes();
    const validTypes = new Set(typesCache.map(t => t.value));
    const newType = String(updates.equipmentType).trim();
    if (!validTypes.has(newType)) {
      return res.status(400).json({
        error: `Неизвестный тип оборудования: «${newType}». Допустимые: ${[...validTypes].join(', ')}`,
        code: 'invalid_equipment_type'
      });
    }
  }

  if (!canAccessDepartment(req.user, pipRows[0].department)) {
    return res.status(403).json({ error: 'Нет доступа к этому оборудованию' });
  }

  if (updates.department !== undefined && req.user.role !== 'admin' && updates.department !== pipRows[0].department) {
    return res.status(403).json({ error: 'Смена отдела доступна только администратору' });
  }

  if (req.user.role !== 'admin' && !req.user.is_acting) {
    delete updates.responsible;
  }

  if (updates.serial !== undefined && String(updates.serial).trim().length > 255) {
    return res.status(400).json({ error: 'Серийный номер слишком длинный (максимум 255 символов)' });
  }
  if (updates.manufacturer !== undefined && String(updates.manufacturer).trim().length > 255) {
    return res.status(400).json({ error: 'Производитель слишком длинный (максимум 255 символов)' });
  }
  if (updates.model !== undefined) {
    const m = String(updates.model).replace(/[\s\u00A0\u2000-\u200A\u2028\u2029\u3000]+/g, ' ').trim();
    if (!m) return res.status(400).json({ error: 'Заполните поле «Модель»' });
    if (m.length > 255) return res.status(400).json({ error: 'Модель слишком длинная (максимум 255 символов)' });
  }

  const map = {
    serial: 'serial', manufacturer: 'manufacturer', model: 'model',
    equipmentType: 'equipment_type', volume: 'volume', department: 'department',
    interval: '`interval`', lastCalibration: 'last_calibration',
    cert: 'cert', lastResult: 'last_result', active: 'active',
    responsible: 'responsible', location: 'location', notes: 'notes',
    sentForCalibration: 'sent_for_calibration', sentNote: 'sent_note',
    replacedBy: 'replaced_by', replacing: 'replacing'
  };

  const NUMERIC_FIELDS = new Set(['interval']);
  const customUpdates = {};
  for (const [k, v] of Object.entries(updates)) {
    if (!STANDARD_FIELDS.has(k)) customUpdates[k] = v;
  }

  const fields = [];
  const values = [];

  if (updates.lastCalibration !== undefined && updates.lastCalibration !== '' && updates.lastCalibration !== null) {
    const lcCheck = validateISODate(updates.lastCalibration);
    if (!lcCheck.ok) return res.status(400).json({ error: lcCheck.error });
    if (String(updates.lastCalibration) > todayLocalStr()) {
      return res.status(400).json({ error: 'Дата поверки не может быть в будущем' });
    }
  }

  for (const [k, col] of Object.entries(map)) {
    if (updates[k] === undefined) continue;
    if (k === 'lastCalibration' && (updates[k] === '' || updates[k] === null)) continue;

    fields.push(`${col} = ?`);
    if (k === 'active') {
      values.push((updates[k] === false || updates[k] === 0 || updates[k] === 'false' || updates[k] === '0') ? 0 : 1);
    } else if (NUMERIC_FIELDS.has(k) && updates[k] === '') {
      values.push(null);
    } else {
      values.push(updates[k]);
    }
  }

  if (Object.keys(customUpdates).length > 0) {
    const [curRows] = await db.query('SELECT custom_data FROM pipettes WHERE id = ?', [req.params.id]);
    const current = curRows.length ? parseCustomData(curRows[0].custom_data) : {};
    const merged = { ...current, ...customUpdates };
    fields.push('custom_data = ?');
    values.push(JSON.stringify(merged));
  }

  {
    const [curRows] = await db.query(
      'SELECT id, barcode, barcode_source, serial, custom_data FROM pipettes WHERE id = ?',
      [req.params.id]
    );
    const cur = curRows[0];
    if (cur) {
      const isManualSet = manualBarcode !== null;
      const isManualClear = isManualSet && manualBarcode === '';
      const wasManual = cur.barcode_source === 'manual';

      if (isManualClear) {
        fields.push('barcode = ?'); values.push(null);
        fields.push('barcode_source = ?'); values.push(null);
      } else if (isManualSet) {
        fields.push('barcode = ?'); values.push(manualBarcode);
        fields.push('barcode_source = ?'); values.push('manual');
      } else if (!wasManual) {
        const newSerial = updates.serial !== undefined ? updates.serial : cur.serial;
        let baseCustom = {};
        try {
          baseCustom = typeof cur.custom_data === 'object' ? { ...cur.custom_data } : JSON.parse(cur.custom_data || '{}') || {};
        } catch (e) { baseCustom = {}; }
        Object.assign(baseCustom, customUpdates);

        const computed = computeBarcodeValue({ id: cur.id, serial: newSerial, custom_data: baseCustom });
        if (computed.value !== cur.barcode || computed.source !== cur.barcode_source) {
          fields.push('barcode = ?'); values.push(computed.value);
          fields.push('barcode_source = ?'); values.push(computed.source);
        }
      }
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'Нет полей для обновления' });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.params.id);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const oldType = pipRows[0].equipment_type;
    const newType = updates.equipmentType;
    let regeneratedId = null;

    if (newType !== undefined && newType !== oldType) {
      regeneratedId = await maybeRegenerateId(req.params.id, oldType, newType, conn);
    }

    await conn.query(`UPDATE pipettes SET ${fields.join(', ')} WHERE id = ?`, values);

    if (regeneratedId) {
      await applyIdChange(req.params.id, regeneratedId, conn);
    }

    const auditDetails = regeneratedId
      ? `${req.params.id} → ${regeneratedId} (смена типа ${oldType} → ${newType})`
      : req.params.id;

    await conn.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Редактирование оборудования', auditDetails]
    );

    await conn.commit();
    res.json({
      message: 'Оборудование обновлено',
      idChanged: !!regeneratedId,
      newId: regeneratedId || undefined,
      oldId: regeneratedId ? req.params.id : undefined
    });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Ошибка обновления' });
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════
// DELETE /:id — удаление
// ═══════════════════════════════════════════════════════════
router.delete('/:id', authenticate, requireAnyPermission(['delete_pipette', 'manage_pipettes']), async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query(
      'SELECT id, model, department, replaced_by, replacing FROM pipettes WHERE id = ?',
      [req.params.id]
    );
    if (!exist.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Не найдена' });
    }
    if (!canAccessDepartment(req.user, exist[0].department)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Нет доступа к этому оборудованию' });
    }

    const row = exist[0];
    const id = req.params.id;

    if (row.replaced_by || row.replacing) {
      await conn.rollback();
      const linkInfo = row.replaced_by
        ? `она отправлена на поверку, замена: ${row.replaced_by}`
        : `она заменяет ${row.replacing}`;
      return res.status(400).json({
        error: `Нельзя удалить ${id}: ${linkInfo}. Сначала отмените отправку или оформите возврат с поверки.`
      });
    }

    const [usedAsReplacement] = await conn.query(
      'SELECT id FROM pipettes WHERE replaced_by = ? LIMIT 1', [id]
    );
    if (usedAsReplacement.length) {
      await conn.rollback();
      return res.status(400).json({
        error: `Нельзя удалить ${id}: она используется как замена для ${usedAsReplacement[0].id}. Сначала оформите возврат с поверки.`
      });
    }

    const [usedAsOriginal] = await conn.query(
      'SELECT id FROM pipettes WHERE replacing = ? LIMIT 1', [id]
    );
    if (usedAsOriginal.length) {
      await conn.rollback();
      return res.status(400).json({
        error: `Нельзя удалить ${id}: она заменена на ${usedAsOriginal[0].id}. Сначала оформите возврат с поверки.`
      });
    }

    await conn.query('DELETE FROM pipettes WHERE id = ?', [id]);
    await conn.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Удаление оборудования', `${req.params.id} (${exist[0].model})`]
    );
    await conn.commit();
    res.json({ message: 'Оборудование удалено' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Ошибка удаления' });
  } finally {
    conn.release();
  }
});

module.exports = router;
