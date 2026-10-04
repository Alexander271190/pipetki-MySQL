const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// ОТДЕЛЫ
// ============================================================
router.get('/departments', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT name FROM departments WHERE enabled = 1 ORDER BY name');
    res.json(rows.map(r => r.name));
  } catch (e) {
    console.error('GET /departments:', e);
    res.status(500).json({ error: 'Ошибка загрузки отделов' });
  }
});

router.put('/departments', authenticate, requireRole(['admin']), async (req, res) => {
  const departments = req.body;

  // ──────────────────────────────────────────────────────────
  // 1. Проверка типа
  // ──────────────────────────────────────────────────────────
  if (!Array.isArray(departments)) {
    return res.status(400).json({ error: 'Ожидается массив отделов' });
  }

  if (departments.length === 0) {
    return res.status(400).json({ error: 'Добавьте хотя бы один отдел' });
  }

  // ──────────────────────────────────────────────────────────
  // 2. Нормализация: единый формат { name, enabled }
  //    Принимает и строки ('Гематология'), и объекты ({name, enabled})
  // ──────────────────────────────────────────────────────────
  const normalized = departments
    .map(d => {
      const rawName = typeof d === 'string' ? d : (d && d.name ? d.name : '');
      const name = String(rawName).trim();
      const enabled = (d && typeof d === 'object' && d.enabled === false) ? 0 : 1;
      return { name, enabled };
    })
    .filter(d => d.name.length > 0);

  // ──────────────────────────────────────────────────────────
  // 3. Проверка «после очистки пусто» — все имена были пробелами
  // ──────────────────────────────────────────────────────────
  if (normalized.length === 0) {
    return res.status(400).json({ error: 'Добавьте хотя бы один отдел' });
  }

  // ──────────────────────────────────────────────────────────
  // 4. Проверка дублей (регистронезависимая)
  // ──────────────────────────────────────────────────────────
  const seen = new Set();
  const duplicates = [];
  for (const d of normalized) {
    const key = d.name.toLowerCase();
    if (seen.has(key)) duplicates.push(d.name);
    else seen.add(key);
  }
  if (duplicates.length > 0) {
    return res.status(400).json({
      error: 'Дубли отделов: ' + [...new Set(duplicates)].join(', ')
    });
  }

  // ──────────────────────────────────────────────────────────
  // 5. Сохранение (транзакция)
  // ──────────────────────────────────────────────────────────
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM departments');

    for (const d of normalized) {
      await conn.query(
        'INSERT INTO departments (name, enabled) VALUES (?, ?)',
        [d.name, d.enabled]
      );
    }

    await conn.commit();
    res.json({ message: 'Отделы обновлены', count: normalized.length });
  } catch (e) {
    await conn.rollback();
    console.error('Ошибка обновления отделов:', e.message, '| code:', e.code);
    res.status(500).json({
      error: 'Ошибка обновления отделов',
      details: e.message
    });
  } finally {
    conn.release();
  }
});

router.get('/departments-full', authenticate, requireRole(['admin']), async (req, res) => {
  const [rows] = await db.query('SELECT name, enabled FROM departments ORDER BY name');
  res.json(rows.map(r => ({ name: r.name, enabled: !!r.enabled })));
});

// ============================================================
// ПОЛЯ ФОРМЫ
// ============================================================
router.get('/fields', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM field_config ORDER BY field_order');
    res.json(rows.map(f => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: !!f.required,
      enabled: !!f.enabled,
      options: db.safeParse(f.options, []),
      default: f.default_value || '',
      order: f.field_order
    })));
  } catch (e) {
    console.error('GET /fields:', e);
    res.status(500).json({ error: 'Ошибка загрузки полей' });
  }
});

router.put('/fields', authenticate, requireRole(['admin']), async (req, res) => {
  const fields = req.body;
  if (!Array.isArray(fields)) return res.status(400).json({ error: 'Ожидается массив' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 🛡️ Защита от удаления полей, у которых уже есть данные
    const [oldFields] = await conn.query('SELECT id FROM field_config');
    const newIds = new Set(fields.map(f => f.id));
    const removed = oldFields.map(r => r.id).filter(id => !newIds.has(id));

    if (removed.length > 0) {
      const confirmDelete = req.query.confirmDelete === 'true';

      const [rows] = await conn.query(
        'SELECT id, custom_data FROM pipettes WHERE custom_data IS NOT NULL'
      );

      const removedLower = new Set(removed.map(id => id.toLowerCase()));
      const usedFields = new Set();       // какие поля используются
      let affectedRecords = 0;             // в скольких записях есть НЕпустые данные
      const recordsToClean = [];           // { id, cleanedCustomData } для каскада

      for (const r of rows) {
        if (r.custom_data == null) continue;

        let cd;
        if (typeof r.custom_data === 'object') cd = r.custom_data;
        else {
          try { cd = JSON.parse(r.custom_data) || {}; }
          catch { continue; }
        }

        // Ищем ключи, соответствующие удаляемым полям (регистронезависимо)
        const keysToDelete = Object.keys(cd).filter(k => removedLower.has(k.toLowerCase()));
        if (keysToDelete.length === 0) continue;

        keysToDelete.forEach(k => usedFields.add(k));

        // Проверяем, есть ли ХОТЯ БЫ ОДНО непустое значение
        const hasData = keysToDelete.some(k =>
          cd[k] !== undefined && cd[k] !== null && cd[k] !== ''
        );
        if (hasData) affectedRecords++;

        // Готовим очищенный объект (без удаляемых ключей)
        const cleaned = { ...cd };
        keysToDelete.forEach(k => delete cleaned[k]);
        recordsToClean.push({ id: r.id, cleaned });
      }

      // ── Случай 1: есть данные и нет подтверждения — 409 ──
      if (affectedRecords > 0 && !confirmDelete) {
        await conn.rollback();
        return res.status(409).json({
          error: `Поля заполнены у ${affectedRecords} запис${affectedRecords === 1 ? 'и' : 'ей'}`,
          code: 'field_has_data',
          affected: affectedRecords,
          fields: [...usedFields]
        });
      }

      // ── Случай 2: подтверждено (или данных нет) — каскадная очистка ──
      // Если поле удаляется — его ключ не должен оставаться в custom_data,
      // даже если значение пустое. Чистим всех, у кого ключ был.
      for (const rec of recordsToClean) {
        const cleanedJson = Object.keys(rec.cleaned).length
          ? JSON.stringify(rec.cleaned)
          : null;
        await conn.query(
          'UPDATE pipettes SET custom_data = ? WHERE id = ?',
          [cleanedJson, rec.id]
        );
      }

      if (recordsToClean.length > 0) {
        console.log(`🗑️ Каскадная очистка: ${recordsToClean.length} записей (поля: ${[...usedFields].join(', ')})`);
      }
    }
    
    await conn.query('DELETE FROM field_config');
    for (const f of fields) {
      await conn.query(
        `INSERT INTO field_config (id, label, type, required, enabled, options, default_value, field_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [f.id, f.label, f.type, f.required ? 1 : 0, f.enabled !== false ? 1 : 0,
         JSON.stringify(f.options || []), f.default || '', f.order || 0]
      );
    }
    await conn.commit();
    res.json({ message: 'Поля обновлены' });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Ошибка обновления полей' });
  } finally {
    conn.release();
  }
});

// ============================================================
// НАСТРОЙКИ ЭКСПОРТА
// ============================================================
router.get('/export', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT fields FROM export_settings WHERE id = 1');
    if (!rows.length) return res.json([]);
    res.json(db.safeParse(rows[0].fields, []));
  } catch (e) {
    console.error('GET /export:', e);
    res.status(500).json({ error: 'Ошибка загрузки настроек экспорта' });
  }
});

router.put('/export', authenticate, requireRole(['admin']), async (req, res) => {
  const fields = req.body;
  if (!Array.isArray(fields)) return res.status(400).json({ error: 'Ожидается массив' });
  await db.query(
    `INSERT INTO export_settings (id, fields) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE fields = VALUES(fields), updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(fields)]
  );
  res.json({ message: 'Настройки экспорта обновлены' });
});

// ============================================================
// СИСТЕМНЫЕ НАСТРОЙКИ
// ============================================================
router.get('/system', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT setting_key, setting_value FROM system_settings');
    const result = {};
    for (const s of rows) result[s.setting_key] = s.setting_value;
    res.json(result);
  } catch (e) {
    console.error('GET /system:', e);
    res.status(500).json({ error: 'Ошибка загрузки настроек' });
  }
});

router.put('/system', authenticate, requireRole(['admin']), async (req, res) => {
  const settings = req.body;
  try {
    for (const [k, v] of Object.entries(settings)) {
      await db.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
        [k, String(v)]
      );
    }
    res.json({ message: 'Настройки обновлены' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка обновления настроек' });
  }
});

// ============================================================
// ФИЛЬТРЫ
// ============================================================
router.get('/filters', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM filter_config ORDER BY filter_order');
    res.json(rows.map(f => ({
      id: f.id,
      label: f.label,
      type: f.type,
      fieldId: f.field_id,
      enabled: !!f.enabled,
      optionsSource: f.options_source,
      order: f.filter_order
    })));
  } catch (e) {
    console.error('GET /filters:', e);
    res.status(500).json({ error: 'Ошибка загрузки фильтров' });
  }
});

router.put('/filters', authenticate, requireRole(['admin']), async (req, res) => {
  const filters = req.body;
  if (!Array.isArray(filters)) return res.status(400).json({ error: 'Ожидается массив' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM filter_config');
    for (const f of filters) {
      await conn.query(
        `INSERT INTO filter_config
         (id, label, type, field_id, enabled, options_source, filter_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [f.id, f.label, f.type, f.fieldId || '',
         f.enabled ? 1 : 0, f.optionsSource || '', f.order || 0]
      );
    }
    await conn.commit();
    res.json({ message: 'Фильтры обновлены' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Ошибка обновления фильтров' });
  } finally {
    conn.release();
  }
});
// ============================================================
// ТИПЫ ОБОРУДОВАНИЯ
// ============================================================

// GET /api/settings/equipment-types
router.get('/equipment-types', authenticate, async (req, res) => {
   const fallback = [
    { value: 'pipette',     label: 'Пипетка',     prefix: 'P', calibrationPlace: 'external' },
    { value: 'analyzer',    label: 'Анализатор',  prefix: 'A', calibrationPlace: 'external' },
    { value: 'thermometer', label: 'Термометр',   prefix: 'T', calibrationPlace: 'internal' },
    { value: 'scales',      label: 'Весы',        prefix: 'S', calibrationPlace: 'internal' },
    { value: 'photometer',  label: 'Фотометр',    prefix: 'F', calibrationPlace: 'internal' },
    { value: 'microscope',  label: 'Микроскоп',   prefix: 'M', calibrationPlace: 'internal' },
  ];

  try {
    const [rows] = await db.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'equipment_types'"
    );
    if (!rows.length) return res.json(fallback);
    res.json(db.safeParse(rows[0].setting_value, fallback));
  } catch (e) {
    console.error('GET /equipment-types:', e);
    res.json(fallback);
  }
});

// PUT /api/settings/equipment-types (только админ)
router.put('/equipment-types', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const types = req.body;
    if (!Array.isArray(types)) {
      return res.status(400).json({ error: 'Ожидается массив' });
    }

    // ──────────────────────────────────────────────────────────
    // ВАЛИДАЦИЯ + НОРМАЛИЗАЦИЯ PREFIX
    // ──────────────────────────────────────────────────────────
    for (const t of types) {
      if (!t.value || !/^[a-z][a-z0-9_]*$/.test(t.value)) {
        return res.status(400).json({ error: `Некорректный value: ${t.value}` });
      }
      if (!t.label || !t.label.trim()) {
        return res.status(400).json({ error: `Пустой label у ${t.value}` });
      }

      if (!t.prefix || !t.prefix.trim()) {
        t.prefix = 'EQ';
      } else {
        t.prefix = t.prefix.trim().toUpperCase();
      }
       if (t.prefix.length > 10) {
        return res.status(400).json({ error: `Слишком длинный prefix у ${t.value}` });
      }

      // 🛡️ Место поверки: external | internal
      if (!t.calibrationPlace || !['external', 'internal'].includes(t.calibrationPlace)) {
        t.calibrationPlace = 'internal';
      }
    }

    // ──────────────────────────────────────────────────────────
    // ПРОВЕРКА ДУБЛЕЙ VALUE
    // ──────────────────────────────────────────────────────────
    const seen = new Set();
    for (const t of types) {
      if (seen.has(t.value)) {
        return res.status(400).json({ error: `Дубль value: ${t.value}` });
      }
      seen.add(t.value);
    }

    // ──────────────────────────────────────────────────────────
    // ПРОВЕРКА: НЕ УДАЛЕНЫ ЛИ ИСПОЛЬЗУЕМЫЕ ТИПЫ
    // ──────────────────────────────────────────────────────────
    const [used] = await db.query('SELECT DISTINCT equipment_type FROM pipettes');
    const usedValues = used.map(r => r.equipment_type).filter(Boolean);
    const newValues = types.map(t => t.value);
    const removed = usedValues.filter(v => !newValues.includes(v));

    if (removed.length > 0) {
      return res.status(400).json({
        error: `Нельзя удалить типы, которые используются: ${removed.join(', ')}`
      });
    }

    // ──────────────────────────────────────────────────────────
    // СОХРАНЕНИЕ В БД
    // ──────────────────────────────────────────────────────────
    await db.query(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ('equipment_types', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [JSON.stringify(types)]
    );
    res.json({ message: 'Типы оборудования обновлены' });
  } catch (e) {
    console.error('PUT /equipment-types:', e);
    res.status(500).json({ error: 'Ошибка сохранения типов' });
  }
});
// ============================================================
// НАСТРОЙКИ ВИДА ПОЛЬЗОВАТЕЛЯ (только для админа)
// ============================================================

// Получить настройки вида конкретного пользователя (админ)
router.get('/user-preferences/:userId', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT preferences FROM user_preferences WHERE user_id = ?',
      [req.params.userId]
    );
    if (!rows.length) return res.json({});
    res.json(db.safeParse(rows[0].preferences, {}));
    } catch (e) {
    console.error('user-preferences GET error:', e);
    res.status(500).json({ error: 'Ошибка загрузки настроек пользователя' });
  }
});

// Сохранить настройки вида конкретного пользователя (админ)
router.put('/user-preferences/:userId', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const prefs = req.body;
    if (typeof prefs !== 'object' || prefs === null) {
      return res.status(400).json({ error: 'Ожидается объект' });
    }

    const [user] = await db.query('SELECT id FROM users WHERE id = ?', [req.params.userId]);
    if (!user.length) return res.status(404).json({ error: 'Пользователь не найден' });

    await db.query(
      `INSERT INTO user_preferences (user_id, preferences) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE preferences = VALUES(preferences), updated_at = CURRENT_TIMESTAMP`,
      [req.params.userId, JSON.stringify(prefs)]
    );

    res.json({ message: 'Настройки сохранены' });
  } catch (e) {
    console.error('user-preferences PUT error:', e);
    res.status(500).json({ error: 'Ошибка сохранения настроек' });
  }
});

// Сбросить настройки вида пользователя (админ)
router.delete('/user-preferences/:userId', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    await db.query('DELETE FROM user_preferences WHERE user_id = ?', [req.params.userId]);
    res.json({ message: 'Настройки сброшены' });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сброса' });
  }
});

// Получить СВОИ настройки вида (для применения при входе)
router.get('/my-preferences', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT preferences FROM user_preferences WHERE user_id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.json({});
    res.json(db.safeParse(rows[0].preferences, {}));
    } catch (e) {
    console.error('my-preferences GET error:', e);
    res.status(500).json({ error: 'Ошибка загрузки настроек' });
  }
});

// ============================================================
// СБРОС ВСЕХ ДАННЫХ (только для админа)
// ============================================================
router.post('/reset-data', authenticate, requireRole(['admin']), async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM calibration_history');
    await conn.query('DELETE FROM pipettes');
    await conn.query('DELETE FROM audit_log');
    await conn.commit();
    res.json({ message: 'Все данные удалены' });
  } catch (e) {
    await conn.rollback();
    console.error('Reset data error:', e);
    res.status(500).json({ error: 'Ошибка сброса данных' });
  } finally {
    conn.release();
  }
});

// POST /api/settings/apply-fields-to-all
// Применяет указанный набор полей ко ВСЕМ пользователям,
// у которых нет персональных настроек или которые явно отмечены.
router.post('/apply-fields-to-all', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { visibleFields, mode } = req.body || {};

    if (!Array.isArray(visibleFields)) {
      return res.status(400).json({ error: 'Ожидается массив visibleFields' });
    }

    // Режимы:
    //   'missing' — только тем, у кого настроек НЕТ (не создавать лишние записи)
    //   'all'     — всем без исключения (перезаписать настройки)
    //   'add'     — добавить указанные поля ко всем, не трогая остальные
    const m = mode || 'missing';
    if (!['missing', 'add', 'all'].includes(m)) {
  return res.status(400).json({ error: 'Неизвестный mode' });
}

    const [users] = await db.query('SELECT id FROM users');
    const [prefsRows] = await db.query('SELECT user_id, preferences FROM user_preferences');
    const prefsByUser = {};
    for (const r of prefsRows) {
      try { prefsByUser[r.user_id] = JSON.parse(r.preferences || '{}'); }
      catch { prefsByUser[r.user_id] = {}; }
    }

    const conn = await db.getConnection();
    let updated = 0;
    try {
      await conn.beginTransaction();

      for (const u of users) {
        const cur = prefsByUser[u.id] || {};
        let nextVisibleFields;

        if (m === 'all') {
          nextVisibleFields = [...visibleFields];
        } else if (m === 'missing') {
          // Тем, у кого уже есть свои настройки — не трогаем
          if (Array.isArray(cur.visibleFields) && cur.visibleFields.length > 0) continue;
          nextVisibleFields = [...visibleFields];
        } else if (m === 'add') {
          // Добавить перечисленные поля, не трогая остальные
          const existing = Array.isArray(cur.visibleFields) ? cur.visibleFields : [];
          const set = new Set(existing);
          for (const id of visibleFields) set.add(id);
          nextVisibleFields = [...set];
        } 
       
        const merged = {
          ...cur,
          visibleFields: nextVisibleFields,
          snapshotAtSave: [...visibleFields],   // опционально: снимок на момент применения
        };

        await conn.query(
          `INSERT INTO user_preferences (user_id, preferences) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE preferences = VALUES(preferences), updated_at = CURRENT_TIMESTAMP`,
          [u.id, JSON.stringify(merged)]
        );
        updated++;
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Массовое применение полей',
       `Режим: ${m}, полей: ${visibleFields.length}, обновлено: ${updated}`]
    );

    res.json({
      message: `Обновлено пользователей: ${updated}`,
      updated,
      mode: m,
    });
  } catch (e) {
    console.error('POST /settings/apply-fields-to-all:', e);
    res.status(500).json({ error: 'Ошибка применения настроек' });
  }
});

module.exports = router;
