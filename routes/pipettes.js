const express = require('express');
const db = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// СТАНДАРТНЫЕ ПОЛЯ (есть колонка в pipettes)
// ============================================================
const STANDARD_FIELDS = new Set([
  'id', 'serial', 'manufacturer', 'model', 'equipmentType', 'volume',
  'department', 'interval', 'lastCalibration', 'cert', 'result', 'active',
  'responsible', 'location', 'notes',
  'lastResult',
  'sentForCalibration',
  'sentNote',
  'replacedBy',    // 🆕 для отмены отправки с заменой
  'replacing'      // 🆕
]);

// 🛡️ Локальная дата YYYY-MM-DD (как todayStr() на фронте).
// Не используем toISOString() — он возвращает UTC и может дать сдвиг до ±1 дня.
function todayLocalStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseCustomData(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

function mergeCustom(p) {
  if (!p) return p;
  const custom = parseCustomData(p.custom_data);
  for (const [k, v] of Object.entries(custom)) {
    if (Object.prototype.hasOwnProperty.call(p, k)) continue;
    p[k] = v;
  }
  return p;
}

function mergeCustomList(list) {
  list.forEach(mergeCustom);
  return list;
}

// ============================================================
// 🆕 Автоперегенерация ID при смене типа оборудования
// ============================================================
async function maybeRegenerateId(oldId, oldType, newType, conn) {
  if (!newType || newType === oldType) return null;

  // 1. Парсим старый ID: PREFIX-DIGITS
  const m = String(oldId).match(/^([A-Za-z]+)-(\d+)$/);
  if (!m) return null;

  const oldPrefix = m[1].toUpperCase();
  const numWidth  = m[2].length;
  const num       = parseInt(m[2], 10);
  if (!Number.isFinite(num)) return null;

  // 2. Достаём префикс нового типа
  const [rows] = await conn.query(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'equipment_types'"
  );
  if (!rows.length || !rows[0].setting_value) return null;

  const types = db.safeParse(rows[0].setting_value, []);
  const type  = types.find(t => t.value === newType);
  if (!type || !type.prefix) return null;

  const newPrefix = String(type.prefix).trim().toUpperCase();
  if (!newPrefix || newPrefix === oldPrefix) return null;

  // 3. Ищем первый свободный: NEW-XXX, NEW-XXX+1, ...
  for (let i = 0; i < 9999; i++) {
    const candidate = `${newPrefix}-${String(num + i).padStart(numWidth, '0')}`;
    const [ex] = await conn.query('SELECT id FROM pipettes WHERE id = ?', [candidate]);
    if (!ex.length) return candidate;
  }
  return null;
}

async function applyIdChange(oldId, newId, conn) {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await conn.query(
      'UPDATE calibration_history SET pipette_id = ? WHERE pipette_id = ?',
      [newId, oldId]
    );
    await conn.query(
      'UPDATE pipettes SET replaced_by = ? WHERE replaced_by = ?',
      [newId, oldId]
    );
    await conn.query(
      'UPDATE pipettes SET replacing = ? WHERE replacing = ?',
      [newId, oldId]
    );
    await conn.query('UPDATE pipettes SET id = ? WHERE id = ?', [newId, oldId]);
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

// ============================================================
// ПРОВЕРКА ДОСТУПА ПО ОТДЕЛУ
// ============================================================
function canAccessDepartment(user, department) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  // 🛡️ И.о. — работает в отделе основного
  if (user.is_acting) {
    if (!user.acting_department) return false;
    return department === user.acting_department;
  }

  if (!user.only_own_department) return true;
  if (!user.department) return false;
  return department === user.department;
}
// 🛡️ Серверный аналог isExternalCalibration из script.js
async function isExternalCalibrationServer(equipmentType) {
  try {
    const [rows] = await db.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'equipment_types'"
    );
    if (!rows.length || !rows[0].setting_value) return true;
    const types = db.safeParse(rows[0].setting_value, []);
    const t = types.find(x => x.value === equipmentType);
    if (!t) return true;
    return (t.calibrationPlace || 'internal') === 'external';
  } catch (e) {
    return true;
  }
}

// Список пипеток
router.get('/', authenticate, async (req, res) => {
  try {
    // 🛡️ И.о. — только оборудование отдела основного
    if (req.user.is_acting) {
      if (!req.user.acting_department) return res.json([]);
      const [pipettes] = await db.query(
        `SELECT * FROM pipettes WHERE department = ?`,
        [req.user.acting_department]
      );
      if (!pipettes.length) return res.json([]);
      // обогащение — как в общем блоке ниже
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

    if (req.user.role !== 'admin'
        && req.user.only_own_department
        && !req.user.department) {
      return res.json([]);
    }

    let sql = 'SELECT * FROM pipettes';
    const params = [];

    if (req.user.role !== 'admin' && req.user.only_own_department) {
      sql += ' WHERE department = ?';
      params.push(req.user.department);
    }

    const [pipettes] = await db.query(sql, params);

    // Пустой список — нечего обогащать историей
        if (!pipettes.length) return res.json([]);

    // История не нужна в списке — только счётчик для тултипа кнопки.
    // Тянем одним GROUP BY, без выгрузки записей.
    const ids = pipettes.map(p => p.id);
    const placeholders = ids.map(() => '?').join(',');
    const [counts] = await db.query(
      `SELECT pipette_id, COUNT(*) AS cnt
       FROM calibration_history
       WHERE pipette_id IN (${placeholders})
       GROUP BY pipette_id`,
      ids
    );

    const byId = {};
    for (const row of counts) {
      byId[row.pipette_id] = row.cnt;
    }

     for (const p of pipettes) {
      p.active = !!p.active;
      p.history_count = byId[p.id] || 0;
    }

    // 🆕 Подтягиваем связки замен
    const replIds = pipettes
      .flatMap(p => [p.replaced_by, p.replacing])
      .filter(Boolean);

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
        if (p.replaced_by && replById[p.replaced_by]) {
          p.replacement = replById[p.replaced_by];
        }
        if (p.replacing && replById[p.replacing]) {
          p.replacedFor = replById[p.replacing];
        }
      }
    }

    // 🆕 Раскрываем custom_data в каждую пипетку
    mergeCustomList(pipettes);

    res.json(pipettes);
    
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка загрузки данных' });
  }
});

// ============================================================
// ДОСТУПНЫЕ ДЛЯ ЗАМЕНЫ (складские того же типа)
// ============================================================
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

// Одна пипетка
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM pipettes WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Оборудование не найдено' });

    const p = rows[0];

    // ← проверка доступа по отделу
    if (!canAccessDepartment(req.user, p.department)) {
      return res.status(403).json({ error: 'Нет доступа к этому оборудованию' });
    }

    const [h] = await db.query(
      'SELECT * FROM calibration_history WHERE pipette_id = ? ORDER BY `date` DESC', [req.params.id]);

    p.active = !!p.active;
    p.history = h;
    mergeCustom(p);

    // 🆕 Связки замен
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

// Создание
router.post('/', authenticate, requirePermission('manage_pipettes'), async (req, res) => {
  
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

  // 🛡️ И.о. — принудительно ответственный и отдел основного
  if (req.user.is_acting) {
    responsible = req.user.acting_full_name  || '';
    department  = req.user.acting_department || '';
  }

  if (!model) return res.status(400).json({ error: 'Заполните поле «Модель»' });

  if (!responsible) {
    return res.status(400).json({ error: 'Заполните поле «Ответственный»' });
  }

  // 🛡️ Дата поверки не может быть в будущем (локальная дата, не UTC)
if (lastCalibration) {
  if (String(lastCalibration) > todayLocalStr()) {
    return res.status(400).json({ error: 'Дата поверки не может быть в будущем' });
  }
}
  
  // 🛡️ Пользователь с "только свой отдел" не может создавать в чужом отделе
  if (req.user.only_own_department && req.user.role !== 'admin') {
    if (!req.user.department) {
      return res.status(403).json({
        error: 'У вас не указан отдел, создание оборудования недоступно'
      });
    }
    if (department && department !== req.user.department) {
      return res.status(403).json({
        error: 'Можно создавать оборудование только в своём отделе'
      });
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let id = rawId;

    if (!id) {
      // Получить prefix
      let prefix = null;
      const [rows] = await conn.query(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'equipment_types'"
      );
      if (rows.length && rows[0].setting_value) {
        try {
          const types = JSON.parse(rows[0].setting_value);
          const found = types.find(t => t.value === equipmentType);
          if (found && found.prefix && found.prefix.trim()) {
            prefix = found.prefix.trim().toUpperCase();
          }
        } catch (e) { /* fallback ниже */ }
      }

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

        // 🆕 Собираем кастомные поля
    const customData = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (!STANDARD_FIELDS.has(k) && k !== 'id') {
        customData[k] = v;
      }
    }

    await conn.query(
      `INSERT INTO pipettes
        (id, serial, manufacturer, model, equipment_type, volume, department, \`interval\`,
         last_calibration, cert, last_result, active, responsible, location, notes, custom_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, serial, manufacturer, model,
        equipmentType || 'pipette', volume, department,
        interval || 12, lastCalibration, cert,
        result || 'pass',
        (active === false || active === 0 || active === 'false' || active === '0') ? 0 : 1,
        responsible, location, notes,
        Object.keys(customData).length ? JSON.stringify(customData) : null
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
      [req.user.id, req.user.full_name, 'Добавление оборудования', `${id} (${model})`]
    );

    await conn.commit();
    res.status(201).json({ message: 'Оборудование создано', id });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'ID уже занят, попробуйте сохранить ещё раз' });
    }
    console.error(e);
    res.status(500).json({ error: 'Ошибка создания оборудования' });
  } finally {
    conn.release();
  }
});

// Обновление
    router.put('/:id', authenticate, requirePermission('manage_pipettes'), async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }

  const updates = req.body;

  // 🛡️ И.о. — принудительно ответственный и отдел основного
  if (req.user.is_acting) {
    updates.responsible = req.user.acting_full_name  || '';
    updates.department  = req.user.acting_department || '';
  }

  const [pipRows] = await db.query(
  'SELECT department, equipment_type FROM pipettes WHERE id = ?', [req.params.id]
);
  if (!pipRows.length) {
    return res.status(404).json({ error: 'Оборудование не найдено' });
  }
  if (!canAccessDepartment(req.user, pipRows[0].department)) {
    return res.status(403).json({ error: 'Нет доступа к этому оборудованию' });
  }

  // Только админ может менять отдел
  if (updates.department !== undefined
      && req.user.role !== 'admin'
      && updates.department !== pipRows[0].department) {
    return res.status(403).json({ error: 'Смена отдела доступна только администратору' });
  }
    
      const map = {
    serial: 'serial', manufacturer: 'manufacturer', model: 'model',
    equipmentType: 'equipment_type',
    volume: 'volume',
    department: 'department',
    interval: '`interval`', lastCalibration: 'last_calibration',
    cert: 'cert', lastResult: 'last_result', active: 'active',
    responsible: 'responsible', location: 'location', notes: 'notes',
    sentForCalibration: 'sent_for_calibration',
    sentNote: 'sent_note',
    replacedBy: 'replaced_by',   
    replacing: 'replacing'       
  };

 const NUMERIC_FIELDS = new Set(['interval']);

  // 🆕 Разделяем входящие поля на стандартные и кастомные
 const customUpdates = {};
 for (const [k, v] of Object.entries(updates)) {
   if (!STANDARD_FIELDS.has(k)) customUpdates[k] = v;
 }

 const fields = [];
 const values = [];
 for (const [k, col] of Object.entries(map)) {
   if (updates[k] === undefined) continue;
   if (k === 'lastCalibration' && (updates[k] === '' || updates[k] === null)) {
     continue;
   }

   fields.push(`${col} = ?`);
   if (k === 'active') {
     values.push(
       (updates[k] === false || updates[k] === 0 ||
        updates[k] === 'false' || updates[k] === '0') ? 0 : 1
     );
   } else if (NUMERIC_FIELDS.has(k) && updates[k] === '') {
     values.push(null);
   } else {
     values.push(updates[k]);
   }
}

 // 🆕 Мёржим custom_data
 if (Object.keys(customUpdates).length > 0) {
   const [curRows] = await db.query(
     'SELECT custom_data FROM pipettes WHERE id = ?', [req.params.id]
   );
   const current = curRows.length ? parseCustomData(curRows[0].custom_data) : {};
   const merged  = { ...current, ...customUpdates };
   fields.push('custom_data = ?');
   values.push(JSON.stringify(merged));
 }

  if (!fields.length) return res.status(400).json({ error: 'Нет полей для обновления' });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.params.id);
    const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 🆕 Проверяем, нужна ли смена ID
    const oldType = pipRows[0].equipment_type;
    const newType = updates.equipmentType;
    let regeneratedId = null;

    if (newType !== undefined && newType !== oldType) {
      regeneratedId = await maybeRegenerateId(req.params.id, oldType, newType, conn);
    }

    // Обычное обновление полей
    await conn.query(`UPDATE pipettes SET ${fields.join(', ')} WHERE id = ?`, values);

    // 🆕 Если нужно — меняем ID и все связи
    if (regeneratedId) {
      await applyIdChange(req.params.id, regeneratedId, conn);
    }

    // Аудит
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

// Удаление
router.delete('/:id', authenticate, requirePermission('manage_pipettes'), async (req, res) => {
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

    // ──────────────────────────────────────────────────────────
    // 🛡️ Блокировка удаления при активных связях замены
    // ──────────────────────────────────────────────────────────
    const row = exist[0];
    const id = req.params.id;
      if (row.replaced_by || row.replacing) {
      await conn.rollback();
      const linkInfo = row.replaced_by
        ? `она отправлена на поверку, замена: ${row.replaced_by}`
        : `она заменяет ${row.replacing}`;
      return res.status(400).json({
        error: `Нельзя удалить ${id}: ${linkInfo}. ` +
               `Сначала отмените отправку или оформите возврат с поверки.`
      });
    }       
    const [usedAsReplacement] = await conn.query(
      'SELECT id FROM pipettes WHERE replaced_by = ? LIMIT 1',
      [id]
    );
    if (usedAsReplacement.length) {
      await conn.rollback();
      return res.status(400).json({
        error: `Нельзя удалить ${id}: она используется как замена для ` +
               `${usedAsReplacement[0].id}. Сначала оформите возврат с поверки.`
      });
    }

    const [usedAsOriginal] = await conn.query(
      'SELECT id FROM pipettes WHERE replacing = ? LIMIT 1',
      [id]
    );
    if (usedAsOriginal.length) {
      await conn.rollback();
      return res.status(400).json({
        error: `Нельзя удалить ${id}: она заменена на ` +
               `${usedAsOriginal[0].id}. Сначала оформите возврат с поверки.`
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
// ============================================================
// МАССОВАЯ ОТПРАВКА НА ПОВЕРКУ
// ============================================================
router.post('/bulk-send', authenticate, requirePermission('manage_pipettes'), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }
  const { ids, sentDate, note } = req.body;

  const replacements =
    (req.body.replacements
      && typeof req.body.replacements === 'object'
      && !Array.isArray(req.body.replacements))
      ? req.body.replacements
      : {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Не выбрано ни одной единицы оборудования' });
  }
  if (!sentDate) {
    return res.status(400).json({ error: 'Заполните поле «Дата отправки»' });
  }
  if (ids.length > 100) {
    return res.status(400).json({ error: 'Слишком много единиц за раз (максимум 100)' });
  }

  const usedReplacements = new Set();
  for (const [origId, replId] of Object.entries(replacements)) {
    if (!replId) continue;
    if (replId === origId) {
      return res.status(400).json({
        error: `Оборудование ${origId} не может заменить само себя`
      });
    }
    if (usedReplacements.has(replId)) {
      return res.status(400).json({
        error: `Одна единица (${replId}) не может заменить несколько. Выберите разные замены.`
      });
    }
    usedReplacements.add(replId);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

        const successful = [];
    const skipped = [];
    const notFound = [];
    let skippedReplacements = [];
    
    const [typeRows] = await conn.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'equipment_types'"
    );
    const typesCache = db.safeParse(typeRows[0] ? typeRows[0].setting_value : null, []);
    const isExternalType = (t) => {
      const found = typesCache.find(x => x.value === t);
      if (!found) return true;
      return (found.calibrationPlace || 'internal') === 'external';
    };

        for (const id of ids) {
      const [rows] = await conn.query(
        'SELECT id, model, sent_for_calibration, equipment_type, department FROM pipettes WHERE id = ? FOR UPDATE',
        [id]
      );

      if (!rows.length) { notFound.push(id); continue; }
      if (!canAccessDepartment(req.user, rows[0].department)) { skipped.push(id); continue; }
    
      if (!isExternalType(rows[0].equipment_type)) { skipped.push(id); continue; }

      if (rows[0].sent_for_calibration) { skipped.push(id); continue; }

      await conn.query(
        `UPDATE pipettes
         SET sent_for_calibration = ?, sent_note = ?,
             active = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [sentDate, note || null, id]
      );
      const replacementId = replacements[id];
      if (replacementId) {
        const [repRows] = await conn.query(
          `SELECT id, location, department, equipment_type, active,
                  sent_for_calibration, replacing
           FROM pipettes WHERE id = ?`,
          [replacementId]
        );

        if (repRows.length === 0) {
          skippedReplacements.push({ id, replacementId, reason: 'замена не найдена' });
          successful.push(id);
        } else {
          const rep = repRows[0];
          let reason = null;

          if (rep.equipment_type !== rows[0].equipment_type) {
            reason = 'тип не совпадает';
          } else if (rep.active) {
            reason = 'замена уже активна';
          } else if (rep.sent_for_calibration) {
            reason = 'замена уже отправлена на поверку';
          } else if (rep.replacing) {
            reason = 'замена уже кого-то заменяет';
          }

          if (reason) {
            skippedReplacements.push({ id, replacementId, reason });
            successful.push(id);
          } else {
            const [origRows] = await conn.query(
              'SELECT location, department FROM pipettes WHERE id = ?',
              [id]
            );
            const origLocation = origRows[0].location || 'Склад';
            const origDepartment = origRows[0].department || rep.department;

            await conn.query(
              `UPDATE pipettes
               SET active = 1, location = ?, department = COALESCE(?, department),
                   replacing = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [origLocation, origDepartment, id, replacementId]
            );

            await conn.query(
              `UPDATE pipettes
               SET replaced_by = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [replacementId, id]
            );

            successful.push(`${id} (замена: ${replacementId})`);
          }
        }
      } else {
        successful.push(id);
      }
    }

    if (successful.length > 0) {
      await conn.query(
        'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
        [req.user.id, req.user.full_name, 'Отправка на поверку',
         `${successful.length} шт. (${successful.join(', ')}) — ${sentDate}`]
      );
    }

    await conn.commit();

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
    await conn.rollback();
    console.error('Bulk send error:', e);
    res.status(500).json({ error: 'Ошибка отправки на поверку', details: e.message });
  } finally {
    conn.release();
  }
});
// ============================================================
// МАССОВЫЙ ВОЗВРАТ С ПОВЕРКИ
// ============================================================
router.post('/bulk-return', authenticate, requirePermission('manage_pipettes'), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }
  const { items, date, org, note } = req.body;

  // 🛡️ Нормализация
  const returnReplacements = Array.isArray(req.body.returnReplacements)
    ? req.body.returnReplacements
    : [];

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Не выбрано ни одной единицы оборудования' });
  }
  if (!date) {
    return res.status(400).json({ error: 'Заполните поле «Дата поверки»' });
  }
  if (items.length > 100) {
    return res.status(400).json({ error: 'Слишком много единиц за раз (максимум 100)' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const successful = [];
    const skipped = [];
    let missingReplacements = [];

    // 🛡️ Один раз читаем типы, чтобы не дёргать БД в цикле
    const [typeRows] = await conn.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'equipment_types'"
    );
    const typesCache = db.safeParse(typeRows[0] ? typeRows[0].setting_value : null, []);
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

       // 🛡️ Только external-типы
      if (!isExternalType(rows[0].equipment_type)) { skipped.push(item.id); continue; }

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
        `UPDATE pipettes
         SET last_calibration = ?, cert = ?, last_result = ?,
             sent_for_calibration = NULL, sent_note = NULL,
             active = 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [date, itemCert, itemResult, item.id]
      );

      // 🛡️ Возврат замены
           const returnRepl = returnReplacements.includes(item.id);
      const replId     = rows[0].replaced_by;

      if (replId) {
        const [replExists] = await conn.query(
          'SELECT id FROM pipettes WHERE id = ? FOR UPDATE', [replId]
        );

        if (replExists.length === 0) {
          // Замена физически удалена — просто чистим ссылку
          await conn.query(
            `UPDATE pipettes SET replaced_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [item.id]
          );
          missingReplacements.push({ id: item.id, replacementId: replId });

        } else if (returnRepl) {
          // Возврат замены на склад: Y → неактивна, X → уже active=1 (см. 1.2)
          await conn.query(
            `UPDATE pipettes
             SET active = 0, location = 'Склад', replacing = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [replId]
          );
          await conn.query(
            `UPDATE pipettes SET replaced_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [item.id]
          );

        } else {
          // Пользователь оставил Y в работе — снимаем только связь
          await conn.query(
            `UPDATE pipettes SET replaced_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [item.id]
          );
        }
      }
      
      successful.push(item.id);
    }

    if (successful.length > 0) {
      await conn.query(
        'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
        [req.user.id, req.user.full_name, 'Возврат с поверки',
         `${successful.length} шт. (${successful.join(', ')}) — ${date}`]
      );
    }

    await conn.commit();
    res.status(201).json({
      message: `Возврат оформлен для ${successful.length} единиц`,
      successful: successful.length,
      skipped: skipped.length,
      skippedIds: skipped,
      missingReplacements: missingReplacements
    });
  } catch (e) {
    await conn.rollback();
    console.error('Bulk return error:', e);
    res.status(500).json({ error: 'Ошибка возврата', details: e.message });
  } finally {
    conn.release();
  }
});

// Добавление поверки
router.post('/:id/calibration', authenticate, requirePermission('manage_pipettes'), async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Тело запроса должно быть JSON-объектом' });
  }
  const { date, cert, result, org, note } = req.body;
if (!date) return res.status(400).json({ error: 'Заполните поле «Дата поверки»' });

// 🛡️ Дата поверки не может быть в будущем (локальная дата, не UTC)
if (String(date) > todayLocalStr()) {
  return res.status(400).json({ error: 'Дата поверки не может быть в будущем' });
}

const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query('SELECT id, department FROM pipettes WHERE id = ?', [req.params.id]);
    if (!exist.length) { await conn.rollback(); return res.status(404).json({ error: 'Не найдена' }); }

    if (!canAccessDepartment(req.user, exist[0].department)) {
  await conn.rollback();
  return res.status(403).json({ error: 'Нет доступа к этому оборудованию' });
}

    const ALLOWED = ['pass', 'fail', 'wip'];
    const safeResult = ALLOWED.includes(result) ? result : 'pass';

    await conn.query(
      `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, org, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.id, date, cert, safeResult, org, note]
    );

    await conn.query(
  `UPDATE pipettes
   SET last_calibration = ?,
       cert = ?,
       last_result = ?,
       sent_for_calibration = NULL,
       sent_note = NULL,
       updated_at = CURRENT_TIMESTAMP
   WHERE id = ?`,
  [date, cert, safeResult, req.params.id]
);

    await conn.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Добавление поверки', `${req.params.id} — ${date}`]
    );

    await conn.commit();
    res.status(201).json({ message: 'Поверка добавлена' });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Ошибка добавления поверки' });
  } finally {
    conn.release();
  }
});

// История
router.get('/:id/calibration', authenticate, async (req, res) => {
  try {
    // Сначала узнаём отдел пипетки
    const [pipRows] = await db.query(
      'SELECT department FROM pipettes WHERE id = ?', [req.params.id]
    );
    if (!pipRows.length) {
      return res.status(404).json({ error: 'Оборудование не найдено' });
    }

    // ← проверка доступа по отделу
    if (!canAccessDepartment(req.user, pipRows[0].department)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const [rows] = await db.query(
      'SELECT * FROM calibration_history WHERE pipette_id = ? ORDER BY `date` DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка загрузки истории' });
  }
});


module.exports = router;
