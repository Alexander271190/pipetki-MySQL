const express = require('express');
const db = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// ПРОВЕРКА ДОСТУПА ПО ОТДЕЛУ
// ============================================================
function canAccessDepartment(user, department) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.only_own_department) return true;
  if (!user.department) return false;       // галка есть, отдела нет — не пускаем
  return department === user.department;
}

// Список пипеток
router.get('/', authenticate, async (req, res) => {
  try {
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

    res.json(pipettes);
    
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка загрузки данных' });
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
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка загрузки данных' });
  }
});

// Создание
router.post('/', authenticate, requirePermission('manage_pipettes'), async (req, res) => {
  const {
    id: rawId, serial, manufacturer, model, equipmentType, volume, department, interval,
    lastCalibration, cert, result, active, responsible, location, notes
  } = req.body;

  if (!model) return res.status(400).json({ error: 'Заполните поле «Модель»' });

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

    await conn.query(
      `INSERT INTO pipettes
        (id, serial, manufacturer, model, equipment_type, volume, department, \`interval\`,
         last_calibration, cert, last_result, active, responsible, location, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, serial, manufacturer, model,
        equipmentType || 'pipette', volume, department,
        interval || 12, lastCalibration, cert,
        result || 'pass', active !== false ? 1 : 0,
        responsible, location, notes
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
  const updates = req.body;

  const [pipRows] = await db.query(
    'SELECT department FROM pipettes WHERE id = ?', [req.params.id]
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
    sentNote: 'sent_note'
  };

 const NUMERIC_FIELDS = new Set(['interval']);

 const fields = [];
 const values = [];
 for (const [k, col] of Object.entries(map)) {
   if (updates[k] !== undefined) {
     fields.push(`${col} = ?`);
     if (k === 'active') {
      values.push(updates[k] ? 1 : 0);
    } else if (NUMERIC_FIELDS.has(k) && updates[k] === '') {
      values.push(null);
    } else {
      values.push(updates[k]);
    }
  }
}

  if (!fields.length) return res.status(400).json({ error: 'Нет полей для обновления' });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.params.id);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE pipettes SET ${fields.join(', ')} WHERE id = ?`, values);
    await conn.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Редактирование оборудования', req.params.id]
    );
    await conn.commit();
    res.json({ message: 'Оборудование обновлено' });
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
      'SELECT model, department FROM pipettes WHERE id = ?', [req.params.id]
    );
    if (!exist.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Не найдена' });
    }

    // ← проверка доступа по отделу
    if (!canAccessDepartment(req.user, exist[0].department)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Нет доступа к этому оборудованию' });
    }

    await conn.query('DELETE FROM pipettes WHERE id = ?', [req.params.id]);
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
  const { ids, sentDate, note } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Не выбрано ни одной единицы оборудования' });
  }
  
  if (!sentDate) return res.status(400).json({ error: 'Заполните поле «Дата отправки»' });
  
  if (ids.length > 100) {
    return res.status(400).json({ error: 'Слишком много единиц за раз (максимум 100)' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const successful = [];
    const skipped = [];
    const notFound = [];

        for (const id of ids) {
      const [rows] = await conn.query(
        'SELECT id, model, sent_for_calibration, equipment_type, department FROM pipettes WHERE id = ?',
        [id]
      );

      if (!rows.length) {
        notFound.push(id);
        continue;
      }

      if (!canAccessDepartment(req.user, rows[0].department)) {
        skipped.push(id);
        continue;
      }

      if (rows[0].equipment_type !== 'pipette') {
        skipped.push(id);
        continue;
      }

      if (rows[0].sent_for_calibration) {
        skipped.push(id);
        continue;
      }
          
      await conn.query(
        `UPDATE pipettes
         SET sent_for_calibration = ?, sent_note = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [sentDate, note || null, id]
      );

      successful.push(id);
    }

    if (successful.length > 0) {
      await conn.query(
        'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
        [
          req.user.id,
          req.user.full_name,
          'Отправка на поверку',
          `${successful.length} шт. (${successful.join(', ')}) — ${sentDate}`
        ]
      );
    }

    await conn.commit();

    res.status(201).json({
      message: `Отправлено на поверку: ${successful.length}`,
      successful: successful.length,
      skipped: skipped.length,
      skippedIds: skipped,
      notFound: notFound.length,
      notFoundIds: notFound
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
  const { items, date, org, note } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Не выбрано ни одной единицы оборудования' });
  }
  
  if (!date) return res.status(400).json({ error: 'Заполните поле «Дата поверки»' });
  
  if (items.length > 100) {
   return res.status(400).json({ error: 'Слишком много единиц за раз (максимум 100)' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const successful = [];
    const skipped = [];

    for (const item of items) {
      if (!item.id) { skipped.push('?'); continue; }

    const [rows] = await conn.query(
      'SELECT id, equipment_type, department, sent_for_calibration FROM pipettes WHERE id = ?',
      [item.id]
      );
      if (!rows.length) { skipped.push(item.id); continue; }
      if (!canAccessDepartment(req.user, rows[0].department)) { skipped.push(item.id); continue; }
      if (rows[0].equipment_type !== 'pipette') { skipped.push(item.id); continue; }
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
         SET last_calibration = ?,
             cert = ?,
             last_result = ?,
             sent_for_calibration = NULL,
             sent_note = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [date, itemCert, itemResult, item.id]
      );

      successful.push(item.id);
    }

    if (successful.length > 0) {
      await conn.query(
        'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
        [
          req.user.id,
          req.user.full_name,
          'Возврат с поверки',
          `${successful.length} шт. (${successful.join(', ')}) — ${date}`
        ]
      );
    }

    await conn.commit();
    res.status(201).json({
      message: `Возврат оформлен для ${successful.length} единиц`,
      successful: successful.length,
      skipped: skipped.length,
      skippedIds: skipped
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
  const { date, cert, result, org, note } = req.body;
  if (!date) return res.status(400).json({ error: 'Заполните поле «Дата поверки»' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query('SELECT id, department FROM pipettes WHERE id = ?', [req.params.id]);
    if (!exist.length) { await conn.rollback(); return res.status(404).json({ error: 'Не найдена' }); }

    if (!canAccessDepartment(req.user, exist[0].department)) {
  await conn.rollback();
  return res.status(403).json({ error: 'Нет доступа к этому оборудованию' });
}

    await conn.query(
      `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, org, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.id, date, cert, result || 'pass', org, note]
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
  [date, cert, result || 'pass', req.params.id]
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
