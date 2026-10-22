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
  findPipetteOrFail, buildDepartmentScope,
  sqlComputedStatus, sqlStatusOrder, buildFiltersWhere, sqlOrderBy, getWarnDays,
} = require('./_helpers');
const { withTransaction } = require('../../utils/db-helper');
const { logAction } = require('../../utils/audit');

// ═══════════════════════════════════════════════════════════
// GET /paged — список с серверной пагинацией, фильтрами, сортировкой
// ═══════════════════════════════════════════════════════════
router.get('/paged', authenticate, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const sort = req.query.sort || 'id';
    const dir = req.query.dir || 'asc';
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    let filters = {};
    if (req.query.filters) {
      try { filters = JSON.parse(req.query.filters); }
      catch (e) { return res.status(400).json({ error: 'Некорректный filters (ожидается JSON)' }); }
    }

    const warnDays = await getWarnDays();
    const statusExpr = sqlComputedStatus(warnDays);

        const { empty, baseWhere, baseParams } = buildDepartmentScope(req.user);
    if (empty) {
      return res.json({ items: [], total: 0, page: 1, limit, totalPages: 0,
        counters: { ok: 0, warn: 0, danger: 0, total: 0 } });
    }
         
    const { sql: filterSql, params: filterParams } = buildFiltersWhere(filters, search);
    let whereSql = baseWhere.length ? ' WHERE ' + baseWhere.join(' AND ') : ' WHERE 1=1';
    whereSql += filterSql;
    const allParams = [...baseParams, ...filterParams];

    let statusFilterSql = '';
    const statusFilterParams = [];
    if (filters && typeof filters === 'object' && filters.status) {
      statusFilterSql = ` AND (${statusExpr}) = ?`;
      statusFilterParams.push(String(filters.status));
    }

    const finalWhere = whereSql + statusFilterSql;
    const finalParams = [...allParams, ...statusFilterParams];

    const [counterRows] = await db.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN (${statusExpr}) = 'ok' THEN 1 ELSE 0 END) AS ok,
         SUM(CASE WHEN (${statusExpr}) = 'warn' THEN 1 ELSE 0 END) AS warn,
         SUM(CASE WHEN (${statusExpr}) = 'danger' THEN 1 ELSE 0 END) AS danger,
         SUM(CASE WHEN sent_for_calibration IS NOT NULL THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN sent_for_calibration IS NULL AND last_result = 'fail' THEN 1 ELSE 0 END) AS fail,
         SUM(CASE WHEN sent_for_calibration IS NULL AND last_result = 'wip' AND last_result != 'fail' THEN 1 ELSE 0 END) AS wip,
         SUM(CASE WHEN sent_for_calibration IS NULL AND last_result NOT IN ('wip','fail') AND active = 0 THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN sent_for_calibration IS NULL AND last_result NOT IN ('wip','fail') AND active = 1 AND (last_calibration IS NULL OR \`interval\` IS NULL) THEN 1 ELSE 0 END) AS unknown_date
     FROM pipettes${whereSql}`,
      allParams
    );
    
    const counters = {
      total: Number(counterRows[0].total) || 0,
      ok: Number(counterRows[0].ok) || 0,
      warn: Number(counterRows[0].warn) || 0,
      danger: Number(counterRows[0].danger) || 0,
      sent: Number(counterRows[0].sent) || 0,
      wip: Number(counterRows[0].wip) || 0,
      fail: Number(counterRows[0].fail) || 0,
      unknownDate: Number(counterRows[0].unknown_date) || 0,
      inactive: Number(counterRows[0].inactive) || 0,
    };
    
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS c FROM pipettes${finalWhere}`,
      finalParams
    );
    const total = Number(countRows[0].c) || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const orderSql = sqlOrderBy(sort, dir, warnDays);
    const [rows] = await db.query(
      `SELECT *, (${statusExpr}) AS computed_status
       FROM pipettes${finalWhere}
       ORDER BY ${orderSql}, id
       LIMIT ? OFFSET ?`,
      [...finalParams, limit, offset]
    );

    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const ph = ids.map(() => '?').join(',');
      const [counts] = await db.query(
        `SELECT pipette_id, COUNT(*) AS cnt FROM calibration_history
         WHERE pipette_id IN (${ph}) GROUP BY pipette_id`,
        ids
      );
      const byId = {};
      for (const c of counts) byId[c.pipette_id] = c.cnt;
      for (const r of rows) {
        r.active = !!r.active;
        r.history_count = byId[r.id] || 0;
      }

      const replIds = rows.flatMap(r => [r.replaced_by, r.replacing]).filter(Boolean);
      if (replIds.length > 0) {
        const uniq = [...new Set(replIds)];
        const ph2 = uniq.map(() => '?').join(',');
        const [replRows] = await db.query(
          `SELECT id, model, manufacturer, location, active, department
           FROM pipettes WHERE id IN (${ph2})`,
          uniq
        );
        const replById = {};
        for (const r of replRows) replById[r.id] = r;
        for (const r of rows) {
          if (r.replaced_by && replById[r.replaced_by]) r.replacement = replById[r.replaced_by];
          if (r.replacing && replById[r.replacing]) r.replacedFor = replById[r.replacing];
        }
      }

      mergeCustomList(rows);
    }

    res.json({ items: rows, total, page, limit, totalPages, counters });
  } catch (e) {
    console.error('GET /pipettes/paged:', e);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /ids — все ID по фильтру (для экспорта и печати этикеток)
// ═══════════════════════════════════════════════════════════
router.get('/ids', authenticate, async (req, res) => {
  try {
    const search = req.query.search || '';
    let filters = {};
    if (req.query.filters) {
      try { filters = JSON.parse(req.query.filters); }
      catch (e) { return res.status(400).json({ error: 'Некорректный filters' }); }
    }

    const warnDays = await getWarnDays();
    const statusExpr = sqlComputedStatus(warnDays);

    const { empty, baseWhere, baseParams } = buildDepartmentScope(req.user);
    if (empty) return res.json({ ids: [] });

    const { sql: filterSql, params: filterParams } = buildFiltersWhere(filters, search);
    let whereSql = baseWhere.length ? ' WHERE ' + baseWhere.join(' AND ') : ' WHERE 1=1';
    whereSql += filterSql;
    const allParams = [...baseParams, ...filterParams];

    let statusFilterSql = '';
    const statusFilterParams = [];
    if (filters && typeof filters === 'object' && filters.status) {
      statusFilterSql = ` AND (${statusExpr}) = ?`;
      statusFilterParams.push(String(filters.status));
    }

    const finalWhere = whereSql + statusFilterSql;
    const finalParams = [...allParams, ...statusFilterParams];

    const [rows] = await db.query(
      `SELECT id FROM pipettes${finalWhere} ORDER BY id`,
      finalParams
    );
    res.json({ ids: rows.map(r => r.id) });
  } catch (e) {
    console.error('GET /pipettes/ids:', e);
    res.status(500).json({ error: 'Ошибка загрузки ID' });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /stats — счётчики + напоминания (danger/fail/warn)
// ═══════════════════════════════════════════════════════════
router.get('/stats', authenticate, async (req, res) => {
  try {
    const warnDays = await getWarnDays();
    const statusExpr = sqlComputedStatus(warnDays);

    const { empty, baseWhere, baseParams } = buildDepartmentScope(req.user);
    if (empty) {
      return res.json({ counters: { ok: 0, warn: 0, danger: 0, total: 0 },
        reminders: { danger: [], warn: [] } });
    }
        
    const whereSql = baseWhere.length ? ' WHERE ' + baseWhere.join(' AND ') : '';

    const [counterRows] = await db.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN (${statusExpr}) = 'ok' THEN 1 ELSE 0 END) AS ok,
         SUM(CASE WHEN (${statusExpr}) = 'warn' THEN 1 ELSE 0 END) AS warn,
         SUM(CASE WHEN (${statusExpr}) = 'danger' THEN 1 ELSE 0 END) AS danger,
         SUM(CASE WHEN sent_for_calibration IS NOT NULL THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN sent_for_calibration IS NULL AND last_result = 'fail' THEN 1 ELSE 0 END) AS fail,
         SUM(CASE WHEN sent_for_calibration IS NULL AND last_result = 'wip' AND last_result != 'fail' THEN 1 ELSE 0 END) AS wip,
         SUM(CASE WHEN sent_for_calibration IS NULL AND last_result NOT IN ('wip','fail') AND active = 0 THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN sent_for_calibration IS NULL AND last_result NOT IN ('wip','fail') AND active = 1 AND (last_calibration IS NULL OR \`interval\` IS NULL) THEN 1 ELSE 0 END) AS unknown_date
   FROM pipettes${whereSql}`,
      baseParams
    );

    const counters = {
      total: Number(counterRows[0].total) || 0,
      ok: Number(counterRows[0].ok) || 0,
      warn: Number(counterRows[0].warn) || 0,
      danger: Number(counterRows[0].danger) || 0,
      sent: Number(counterRows[0].sent) || 0,
      wip: Number(counterRows[0].wip) || 0,
      fail: Number(counterRows[0].fail) || 0,
      unknownDate: Number(counterRows[0].unknown_date) || 0,
      inactive: Number(counterRows[0].inactive) || 0,
    };

    const reminderWhere = whereSql
      ? `${whereSql} AND (${statusExpr}) IN ('danger','fail','warn')`
      : ` WHERE (${statusExpr}) IN ('danger','fail','warn')`;
    const [reminderRows] = await db.query(
      `SELECT id, model, department, responsible, last_calibration, \`interval\`,
              last_result, active, sent_for_calibration,
              (${statusExpr}) AS computed_status
       FROM pipettes${reminderWhere}
       ORDER BY (${sqlStatusOrder(warnDays)}) ASC, id`,
      baseParams
    );

    const reminders = { danger: [], warn: [] };
    for (const r of reminderRows) {
      if (r.computed_status === 'danger' || r.computed_status === 'fail') {
        reminders.danger.push(r);
      } else if (r.computed_status === 'warn') {
        reminders.warn.push(r);
      }
    }

    res.json({ counters, reminders });
  } catch (e) {
    console.error('GET /pipettes/stats:', e);
    res.status(500).json({ error: 'Ошибка загрузки статистики' });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /all — все записи по фильтру (для экспорта / генерации PDF)
// ═══════════════════════════════════════════════════════════
router.get('/all', authenticate, async (req, res) => {
  try {
    const search = req.query.search || '';
    const sort = req.query.sort || 'id';
    const dir = req.query.dir || 'asc';

    let filters = {};
    if (req.query.filters) {
      try { filters = JSON.parse(req.query.filters); }
      catch (e) { return res.status(400).json({ error: 'Некорректный filters' }); }
    }

    const warnDays = await getWarnDays();
    const statusExpr = sqlComputedStatus(warnDays);

    const { empty, baseWhere, baseParams } = buildDepartmentScope(req.user);
    if (empty) return res.json({ items: [] });
    const { sql: filterSql, params: filterParams } = buildFiltersWhere(filters, search);
    let whereSql = baseWhere.length ? ' WHERE ' + baseWhere.join(' AND ') : ' WHERE 1=1';
    whereSql += filterSql;
    const allParams = [...baseParams, ...filterParams];

    let statusFilterSql = '';
    const statusFilterParams = [];
    if (filters && typeof filters === 'object' && filters.status) {
      statusFilterSql = ` AND (${statusExpr}) = ?`;
      statusFilterParams.push(String(filters.status));
    }

    const finalWhere = whereSql + statusFilterSql;
    const finalParams = [...allParams, ...statusFilterParams];

    const orderSql = sqlOrderBy(sort, dir, warnDays);

    // 🆕 Защита от OOM: не более 50000 строк. Если больше — обрезаем.
    const ALL_HARD_LIMIT = 50000;

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS c FROM pipettes${finalWhere}`,
      finalParams
    );
    const totalCount = Number(countRows[0].c) || 0;
    const truncated = totalCount > ALL_HARD_LIMIT;

    const [rows] = await db.query(
      `SELECT *, (${statusExpr}) AS computed_status
       FROM pipettes${finalWhere}
       ORDER BY ${orderSql}, id
       LIMIT ?`,
      [...finalParams, ALL_HARD_LIMIT]
    );

    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const ph = ids.map(() => '?').join(',');
      const [counts] = await db.query(
        `SELECT pipette_id, COUNT(*) AS cnt FROM calibration_history
         WHERE pipette_id IN (${ph}) GROUP BY pipette_id`,
        ids
      );
      const byId = {};
      for (const c of counts) byId[c.pipette_id] = c.cnt;
      for (const r of rows) {
        r.active = !!r.active;
        r.history_count = byId[r.id] || 0;
      }

      const replIds = rows.flatMap(r => [r.replaced_by, r.replacing]).filter(Boolean);
      if (replIds.length > 0) {
        const uniq = [...new Set(replIds)];
        const ph2 = uniq.map(() => '?').join(',');
        const [replRows] = await db.query(
          `SELECT id, model, manufacturer, location, active, department
           FROM pipettes WHERE id IN (${ph2})`, uniq);
        const replById = {};
        for (const r of replRows) replById[r.id] = r;
        for (const r of rows) {
          if (r.replaced_by && replById[r.replaced_by]) r.replacement = replById[r.replaced_by];
          if (r.replacing && replById[r.replacing]) r.replacedFor = replById[r.replacing];
        }
      }

      mergeCustomList(rows);
    }

   res.json({
      items: rows,
      total: totalCount,
      truncated,
      limit: ALL_HARD_LIMIT,
    });
  } catch (e) {
    console.error('GET /pipettes/all:', e);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /next-id — предварительный просмотр следующего ID
// ВАЖНО: должно быть до /:id, иначе Express перехватит как :id
// ═══════════════════════════════════════════════════════════
router.get('/next-id', authenticate, async (req, res) => {
  try {
    const type = req.query.type || 'pipette';
    let prefix = await equipmentTypes.getPrefix(type);
    if (!prefix) {
      const fallback = {
        pipette: 'P', analyzer: 'A', thermometer: 'T',
        scales: 'S', photometer: 'F', microscope: 'M',
      };
      prefix = fallback[type] || 'EQ';
    }
    const safePrefix = String(prefix).replace(/[%_\\]/g, '\\$&');
    const [rows] = await db.query(
      'SELECT id FROM pipettes WHERE id LIKE ? ORDER BY id',
      [`${safePrefix}-%`]
    );
    let maxNum = 0;
    for (const row of rows) {
      const m = String(row.id).match(/(\d+)$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    res.json({ nextId: `${prefix}-${String(maxNum + 1).padStart(3, '0')}` });
  } catch (e) {
    console.error('GET /pipettes/next-id:', e);
    res.status(500).json({ error: 'Ошибка генерации ID' });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /:id — одна пипетка (read-only)
// ═══════════════════════════════════════════════════════════
router.get('/:id', authenticate, async (req, res) => {
  try {
    const warnDays = await getWarnDays();
    const statusExpr = sqlComputedStatus(warnDays);

    const [rows] = await db.query(
      `SELECT *, (${statusExpr}) AS computed_status
       FROM pipettes WHERE id = ?`,
      [req.params.id]
    );
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
  const stripNulls = (s) => String(s || '').replace(/\u0000/g, '');
  const trimmedModel = stripNulls(model).replace(/[\s\u00A0\u2000-\u200A\u2028\u2029\u3000]+/g, ' ').trim();
  if (!trimmedModel) return res.status(400).json({ error: 'Заполните поле «Модель»' });
  if (trimmedModel.length > 255) return res.status(400).json({ error: 'Модель слишком длинная (максимум 255 символов)' });

  const trimmedSerial = stripNulls(serial).trim();
  if (trimmedSerial.length > 255) return res.status(400).json({ error: 'Серийный номер слишком длинный (максимум 255 символов)' });

  const trimmedManufacturer = stripNulls(manufacturer).trim();
  if (trimmedManufacturer.length > 255) return res.status(400).json({ error: 'Производитель слишком длинный (максимум 255 символов)' });

  const trimmedResponsible = stripNulls(responsible).replace(/[\s\u00A0\u2000-\u200A\u2028\u2029\u3000]+/g, ' ').trim();
  if (!trimmedResponsible) return res.status(400).json({ error: 'Заполните поле «Ответственный»' });

  const safeVolume     = stripNulls(volume).trim();
  const safeDepartment = stripNulls(department).trim();
  const safeCert       = stripNulls(cert).trim();
  const safeLocation   = stripNulls(location).trim();
  const safeNotes      = stripNulls(notes);
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
  let createdId;

  try {
    await withTransaction(async (conn) => {
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
        const err = new Error('ID уже существует');
        err.status = 409;
        throw err;
      }

      const customData = {};
      for (const [k, v] of Object.entries(req.body)) {
        if (FORBIDDEN_CUSTOM_KEYS.has(k)) continue;
        if (!STANDARD_FIELDS.has(k) && k !== 'id') {
          customData[k] = (typeof v === 'string') ? v.replace(/\u0000/g, '') : v;
        }
      }
      const rawBarcode = req.body.barcode;
      let barcodeValue = null;
      let barcodeSource = null;

      if (req.user.role === 'admin' && rawBarcode && String(rawBarcode).trim()) {
        const trimmed = stripNulls(rawBarcode).trim();
        if (trimmed.length > BARCODE_MAX_LEN) {
          const err = new Error(`Штрихкод слишком длинный (максимум ${BARCODE_MAX_LEN} символов)`);
          err.status = 400;
          throw err;
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
          equipmentType || 'pipette', safeVolume, safeDepartment,
          safeInterval, lastCalibration, safeCert,
          result || 'pass',
          (active === false || active === 0 || active === 'false' || active === '0') ? 0 : 1,
          trimmedResponsible, safeLocation, safeNotes,
          Object.keys(customData).length ? JSON.stringify(customData) : null,
          barcodeValue, barcodeSource,
        ]
      );

      if (lastCalibration) {
        await conn.query(
          `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, note)
           VALUES (?, ?, ?, ?, ?)`,
          [id, lastCalibration, safeCert, result || 'pass', 'Первичная поверка']
        );
      }

      createdId = id;
    });

    await logAction(req, 'Добавление оборудования', `${createdId} (${trimmedModel})`);

    res.status(201).json({ message: 'Оборудование создано', id: createdId });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    if (e.status === 409) return res.status(409).json({ error: e.message, code: 'race' });

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

  const stripNullsUpd = (s) => String(s || '').replace(/\u0000/g, '');
  const manualBarcode = (req.user.role === 'admin' && updates.barcode !== undefined)
    ? stripNullsUpd(updates.barcode).trim() : null;
  if (manualBarcode !== null && manualBarcode.length > BARCODE_MAX_LEN) {
    return res.status(400).json({ error: `Штрихкод слишком длинный (максимум ${BARCODE_MAX_LEN} символов)` });
  }
  delete updates.barcode;
  delete updates.barcodeSource;

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

  if (updates.serial !== undefined) {
    updates.serial = stripNullsUpd(updates.serial).trim();
    if (updates.serial.length > 255) {
      return res.status(400).json({ error: 'Серийный номер слишком длинный (максимум 255 символов)' });
    }
  }
  if (updates.manufacturer !== undefined) {
    updates.manufacturer = stripNullsUpd(updates.manufacturer).trim();
    if (updates.manufacturer.length > 255) {
      return res.status(400).json({ error: 'Производитель слишком длинный (максимум 255 символов)' });
    }
  }
  if (updates.model !== undefined) {
    const m = stripNullsUpd(updates.model).replace(/[\s\u00A0\u2000-\u200A\u2028\u2029\u3000]+/g, ' ').trim();
    if (!m) return res.status(400).json({ error: 'Заполните поле «Модель»' });
    if (m.length > 255) return res.status(400).json({ error: 'Модель слишком длинная (максимум 255 символов)' });
    updates.model = m;
  }

  ['volume', 'department', 'cert', 'location', 'notes'].forEach(key => {
    if (updates[key] !== undefined) {
      updates[key] = stripNullsUpd(updates[key]);
    }
  });

  if (updates.lastCalibration !== undefined && updates.lastCalibration !== '' && updates.lastCalibration !== null) {
    const lcCheck = validateISODate(updates.lastCalibration);
    if (!lcCheck.ok) return res.status(400).json({ error: lcCheck.error });
    if (String(updates.lastCalibration) > todayLocalStr()) {
      return res.status(400).json({ error: 'Дата поверки не может быть в будущем' });
    }
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
    if (!STANDARD_FIELDS.has(k)) {
      customUpdates[k] = (typeof v === 'string') ? v.replace(/\u0000/g, '') : v;
    }
  }

  try {
   const result = await withTransaction(async (conn) => {
   const p = await findPipetteOrFail(conn, req.params.id, req.user, { forUpdate: true });
     if (updates.updatedAt && p.updated_at) {
    const clientTime = new Date(updates.updatedAt).getTime();
    const dbTime = new Date(p.updated_at).getTime();
       if (Math.abs(clientTime - dbTime) > 1000) {
    const err = new Error('Запись была изменена другим пользователем. Пожалуйста, обновите страницу.');
          err.status = 409;
        throw err;
        }
      }
      if (updates.department !== undefined && req.user.role !== 'admin' && updates.department !== p.department) {
        const err = new Error('Смена отдела доступна только администратору');
        err.status = 403;
        throw err;
      }

      if (req.user.role !== 'admin' && !req.user.is_acting) {
        delete updates.responsible;
      }

      const fields = [];
      const values = [];

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
        const current = parseCustomData(p.custom_data);
        const merged = { ...current, ...customUpdates };
        fields.push('custom_data = ?');
        values.push(JSON.stringify(merged));
      }

      const cur = p;
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
        const baseCustom = parseCustomData(cur.custom_data);
        Object.assign(baseCustom, customUpdates);

        const computed = computeBarcodeValue({ id: cur.id, serial: newSerial, custom_data: baseCustom });
        if (computed.value !== cur.barcode || computed.source !== cur.barcode_source) {
          fields.push('barcode = ?'); values.push(computed.value);
          fields.push('barcode_source = ?'); values.push(computed.source);
        }
      }

      if (!fields.length) {
        const err = new Error('Нет полей для обновления');
        err.status = 400;
        throw err;
      }
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(req.params.id);

      const oldType = cur.equipment_type;
      const newType = updates.equipmentType;
      let regeneratedId = null;

      if (newType !== undefined && newType !== oldType) {
        regeneratedId = await maybeRegenerateId(req.params.id, oldType, newType, conn);
      }

      await conn.query(`UPDATE pipettes SET ${fields.join(', ')} WHERE id = ?`, values);

      if (regeneratedId) {
        await applyIdChange(req.params.id, regeneratedId, conn);
      }

      return { oldType, newType, regeneratedId };
    });

    const auditDetails = result.regeneratedId
      ? `${req.params.id} → ${result.regeneratedId} (смена типа ${result.oldType} → ${result.newType})`
      : req.params.id;

    await logAction(req, 'Редактирование оборудования', auditDetails);

    res.json({
      message: 'Оборудование обновлено',
      idChanged: !!result.regeneratedId,
      newId: result.regeneratedId || undefined,
      oldId: result.regeneratedId ? req.params.id : undefined
    });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    if (e.status === 403) return res.status(403).json({ error: e.message });
    if (e.status === 404) return res.status(404).json({ error: e.message });

    const DATA_ERROR_CODES = new Set(['ER_DATA_TOO_LONG', 'ER_TRUNCATED_WRONG_VALUE', 'ER_BAD_NULL_ERROR', 'ER_NO_DEFAULT_FOR_FIELD']);
    const DATA_ERROR_ERRNOS = new Set([1406, 1292, 1048, 1364]);
    if (DATA_ERROR_CODES.has(e.code) || DATA_ERROR_ERRNOS.has(e.errno)) {
      return res.status(400).json({ error: 'Некорректные данные: ' + (e.sqlMessage || e.message) });
    }
    const RACE_CODES = new Set(['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
    if (RACE_CODES.has(e.code)) {
      return res.status(409).json({ error: 'Конфликт, попробуйте ещё раз' });
    }
    console.error(e);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// ═══════════════════════════════════════════════════════════
// DELETE /:id — удаление
// ═══════════════════════════════════════════════════════════
router.delete('/:id', authenticate, requireAnyPermission(['delete_pipette', 'manage_pipettes']), async (req, res) => {
  try {
    let deletedModel = null;

    await withTransaction(async (conn) => {
      const p = await findPipetteOrFail(conn, req.params.id, req.user, { forUpdate: true });
      const id = req.params.id;

      if (p.replaced_by || p.replacing) {
        const linkInfo = p.replaced_by
          ? `она отправлена на поверку, замена: ${p.replaced_by}`
          : `она заменяет ${p.replacing}`;
        const err = new Error(`Нельзя удалить ${id}: ${linkInfo}. Сначала отмените отправку или оформите возврат с поверки.`);
        err.status = 400;
        throw err;
      }

      const [usedAsReplacement] = await conn.query(
        'SELECT id FROM pipettes WHERE replaced_by = ? LIMIT 1', [id]
      );
      if (usedAsReplacement.length) {
        const err = new Error(`Нельзя удалить ${id}: она используется как замена для ${usedAsReplacement[0].id}. Сначала оформите возврат с поверки.`);
        err.status = 400;
        throw err;
      }

      const [usedAsOriginal] = await conn.query(
        'SELECT id FROM pipettes WHERE replacing = ? LIMIT 1', [id]
      );
      if (usedAsOriginal.length) {
        const err = new Error(`Нельзя удалить ${id}: она заменена на ${usedAsOriginal[0].id}. Сначала оформите возврат с поверки.`);
        err.status = 400;
        throw err;
      }

      await conn.query('DELETE FROM pipettes WHERE id = ?', [id]);
      deletedModel = p.model;
    });

    await logAction(req, 'Удаление оборудования', `${req.params.id} (${deletedModel})`);

    res.json({ message: 'Оборудование удалено' });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    if (e.status === 403) return res.status(403).json({ error: e.message });
    if (e.status === 404) return res.status(404).json({ error: e.message });
    if (e.status === 409) return res.status(409).json({ error: e.message, code: 'conflict' });
    console.error('Delete error:', e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
