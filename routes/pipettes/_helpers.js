'use strict';
const equipmentTypes = require('../../utils/equipment-types');
const {
  validateISODate,
  normalizeInterval,
  todayLocalStr,
} = require('../../middleware/validate');
const db = require('../../db');

const PIPETTE_COLUMNS = 'id, serial, manufacturer, model, equipment_type, volume, department, `interval`, last_calibration, cert, last_result, active, responsible, location, notes, sent_for_calibration, sent_note, replaced_by, replacing, custom_data, barcode, barcode_source, created_at, updated_at';
const USER_COLUMNS = 'id, login, password, full_name, position, department, role, only_own_department, is_acting, acting_for_id, extra_permissions, must_change_password, must_set_password, password_changed_at, view_template_id';
const AUDIT_COLUMNS = 'id, user_id, user_full_name, action, details, pipette_id, category, timestamp';
const PRINTER_COLUMNS = 'id, name, department, mode, ip, port, label_size, enabled, is_default, sort_order';

// ============================================================
// КОНСТАНТЫ
// ============================================================
const STANDARD_FIELDS = new Set([
  'id', 'serial', 'manufacturer', 'model', 'equipmentType', 'volume',
  'department', 'interval', 'lastCalibration', 'cert', 'result', 'active',
  'responsible', 'location', 'notes',
  'lastResult', 'sentForCalibration', 'sentNote',
  'replacedBy', 'replacing',
  'barcode', 'barcodeSource',
]);

const FORBIDDEN_CUSTOM_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BARCODE_MAX_LEN = 255;

// ============================================================
// КАСТОМНЫЕ ПОЛЯ
// ============================================================
function parseCustomData(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

function mergeCustom(p) {
  if (!p) return p;
  const custom = parseCustomData(p.custom_data);
  for (const [k, v] of Object.entries(custom)) {
    if (FORBIDDEN_CUSTOM_KEYS.has(k)) continue;
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
// ШТРИХКОД
// ============================================================
function computeBarcodeValue(p) {
  const custom = parseCustomData(p.custom_data);
  const inv = custom.inventorynumber || custom.inventoryNumber || custom.inventory_no || '';
  const cut = (s) => String(s).trim().slice(0, BARCODE_MAX_LEN);
  if (inv && String(inv).trim()) return { value: cut(inv), source: 'inventorynumber' };
  if (p.serial && String(p.serial).trim()) return { value: cut(p.serial), source: 'serial' };
  return { value: cut(p.id), source: 'id' };
}

// ============================================================
// ID — АВТОПЕРЕГЕНЕРАЦИЯ ПРИ СМЕНЕ ТИПА
// ============================================================
async function maybeRegenerateId(oldId, oldType, newType, conn) {
  if (!newType || newType === oldType) return null;

  const m = String(oldId).match(/^([A-Za-z]+)-(\d+)$/);
  if (!m) return null;

  const oldPrefix = m[1].toUpperCase();
  const numWidth  = m[2].length;
  const num       = parseInt(m[2], 10);
  if (!Number.isFinite(num)) return null;

  const type = await equipmentTypes.getTypeByValue(newType);
  if (!type || !type.prefix) return null;

  const newPrefix = String(type.prefix).trim().toUpperCase();
  if (!newPrefix || newPrefix === oldPrefix) return null;

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
    await conn.query('UPDATE pipettes SET replaced_by = ? WHERE replaced_by = ?', [newId, oldId]);
    await conn.query('UPDATE pipettes SET replacing = ? WHERE replacing = ?', [newId, oldId]);
    await conn.query('UPDATE pipettes SET id = ? WHERE id = ?', [newId, oldId]);
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

// ============================================================
// Скоуп по отделу — общий для /paged, /ids, /stats, /all.
// Возвращает: { empty, baseWhere, baseParams }.
//   empty = true — у и.о./пользователя нет отдела, роут должен
//                  вернуть пустой результат (что именно — решает роут).
//   baseWhere/baseParams — массив частей WHERE и параметров.
// ============================================================
function buildDepartmentScope(user) {
  const baseWhere = [];
  const baseParams = [];

  if (!user) return { empty: true, baseWhere, baseParams };

  if (user.is_acting) {
    if (!user.acting_department) return { empty: true, baseWhere, baseParams };
    baseWhere.push('department = ?');
    baseParams.push(user.acting_department);
  } else if (!user._isAdmin && user.only_own_department) {
    if (!user.department) return { empty: true, baseWhere, baseParams };
    baseWhere.push('department = ?');
    baseParams.push(user.department);
  }

  return { empty: false, baseWhere, baseParams };
}

// ============================================================
// ДОСТУП ПО ОТДЕЛУ
// ============================================================
function canAccessDepartment(user, department) {
  if (!user) return false;
  if (user._isAdmin) return true;
  if (user.is_acting) {
    if (!user.acting_department) return false;
    return department === user.acting_department;
  }
  if (!user.only_own_department) return true;
  if (!user.department) return false;
  return department === user.department;
}

// ============================================================
// Поиск прибора с проверкой доступа (для роутов)
// Бросает err со status = 404 / 403 — чтобы использовать внутри withTransaction.
// ============================================================
async function findPipetteOrFail(executor, id, user, { forUpdate = false } = {}) {
  const sql = `SELECT ${PIPETTE_COLUMNS} FROM pipettes WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`;
  const [rows] = await executor.query(sql, [id]);
  if (!rows.length) {
    const err = new Error('Оборудование не найдено');
    err.status = 404;
    throw err;
  }
  if (!canAccessDepartment(user, rows[0].department)) {
    const err = new Error('Нет доступа к этому оборудованию');
    err.status = 403;
    throw err;
  }
  return rows[0];
}

// ============================================================
// SQL — ВЫЧИСЛЯЕМЫЕ ПОЛЯ, ФИЛЬТРЫ, СОРТИРОВКА
// ============================================================

// ═══════════════════════════════════════════════════════════════════
// ⚠️ ЕДИНСТВЕННЫЙ источник правды о статусе прибора.
// Правило: sent → fail → inactive → wip → unknown → danger → warn → ok.
// Клиент (05-state.js/calcStatus) только читает p.computed_status.
// Меняешь порядок/условия — меняй ТОЛЬКО здесь.
// ═══════════════════════════════════════════════════════════════════
function sqlComputedStatus(warnDays) {
  // ⚠️ ТОЛЬКО числа, никогда не строки. Принудительный каст защищает
  // от SQL-инъекции, если warnDays придёт из query/body.
  const n = Number(warnDays);
  const wd = Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
  return `
    CASE
      WHEN sent_for_calibration IS NOT NULL THEN 'sent'
      WHEN last_result = 'fail' THEN 'fail'
      WHEN active = 0 THEN 'inactive'
      WHEN last_result = 'wip' THEN 'wip'
      WHEN last_calibration IS NULL OR \`interval\` IS NULL THEN 'unknown'
      WHEN DATE_ADD(STR_TO_DATE(last_calibration, '%Y-%m-%d'), INTERVAL \`interval\` MONTH) < CURDATE() THEN 'danger'
      WHEN DATE_ADD(STR_TO_DATE(last_calibration, '%Y-%m-%d'), INTERVAL \`interval\` MONTH) < DATE_ADD(CURDATE(), INTERVAL ${wd} DAY) THEN 'warn'
      ELSE 'ok'
    END
  `;
}

// Числовой порядок статусов (для ORDER BY)
function sqlStatusOrder(warnDays) {
  // ⚠️ ТОЛЬКО числа, никогда не строки
  const n = Number(warnDays);
  const wd = Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
  return `
    CASE
      WHEN sent_for_calibration IS NOT NULL THEN 5
      WHEN last_result = 'fail' THEN 2
      WHEN active = 0 THEN 7
      WHEN last_result = 'wip' THEN 3
      WHEN last_calibration IS NULL OR \`interval\` IS NULL THEN 8
      WHEN DATE_ADD(STR_TO_DATE(last_calibration, '%Y-%m-%d'), INTERVAL \`interval\` MONTH) < CURDATE() THEN 1
      WHEN DATE_ADD(STR_TO_DATE(last_calibration, '%Y-%m-%d'), INTERVAL \`interval\` MONTH) < DATE_ADD(CURDATE(), INTERVAL ${wd} DAY) THEN 4
      ELSE 6
    END
  `;
}

// Строит WHERE-условия по filters (объект) + search.
// Возвращает { sql, params }. НЕ включает фильтр по status — он вычисляемый,
// добавляется отдельно в crud.js.
function buildFiltersWhere(filters, search) {
  const parts = [];
  const params = [];

  // Поиск по 7 колонкам
  if (search && String(search).trim()) {
    const s = String(search).trim();
    const q = `%${s}%`;
    parts.push(`(
      id LIKE ? OR model LIKE ? OR serial LIKE ? OR manufacturer LIKE ?
      OR department LIKE ? OR responsible LIKE ?
      OR CAST(custom_data AS CHAR) LIKE ?
    )`);
    params.push(q, q, q, q, q, q, q);
  }

  if (filters && typeof filters === 'object' && !Array.isArray(filters)) {
    for (const [fieldId, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;

      if (fieldId === 'status') continue; // вычисляемый, отдельно

      if (fieldId === 'equipmentType') {
        parts.push('equipment_type = ?');
        params.push(String(value));
        continue;
      }
      if (fieldId === 'department') {
        parts.push('department = ?');
        params.push(String(value));
        continue;
      }
      if (fieldId === 'active') {
        parts.push('active = ?');
        params.push(value === 'true' || value === true ? 1 : 0);
        continue;
      }
      if (fieldId === 'responsible') {
        parts.push('responsible LIKE ?');
        params.push(`%${String(value).trim()}%`);
        continue;
      }
      if (fieldId === 'model') {
        parts.push('model LIKE ?');
        params.push(`%${String(value).trim()}%`);
        continue;
      }
      if (fieldId === 'manufacturer') {
        parts.push('manufacturer LIKE ?');
        params.push(`%${String(value).trim()}%`);
        continue;
      }

      // date-period: объект { type, period, from, to }
      if (value && typeof value === 'object' && value.period) {
        const isUpdated = value.type === 'updated_at';
        const colExpr = isUpdated
          ? 'DATE(updated_at)'
          : "STR_TO_DATE(last_calibration, '%Y-%m-%d')";

        if (value.period === 'today') {
          parts.push(`${colExpr} = CURDATE()`);
        } else if (value.period === 'yesterday') {
          parts.push(`${colExpr} = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`);
        } else if (value.period === 'week') {
          parts.push(`${colExpr} >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`);
          parts.push(`${colExpr} <= CURDATE()`);
        } else if (value.period === 'month') {
          parts.push(`${colExpr} >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`);
          parts.push(`${colExpr} <= CURDATE()`);
        } else if (value.period === 'custom') {
          if (value.from) { parts.push(`${colExpr} >= ?`); params.push(value.from); }
          if (value.to)   { parts.push(`${colExpr} <= ?`); params.push(value.to); }
        }
        continue;
      }

      // Кастомное поле — LIKE по JSON_EXTRACT
      if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldId)) {
        parts.push(`JSON_UNQUOTE(JSON_EXTRACT(custom_data, ?)) LIKE ?`);
        params.push(`$.${fieldId}`, `%${String(value).trim()}%`);
      }
    }
  }

  return {
    sql: parts.length ? ' AND ' + parts.join(' AND ') : '',
    params,
  };
}

// SQL для ORDER BY
function sqlOrderBy(sort, dir, warnDays) {
  const d = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  switch (sort) {
    case 'id':              return `id ${d}`;
    case 'equipmentType':   return `equipment_type ${d}`;
    case 'model':           return `model ${d}`;
    case 'volume':          return `CAST(NULLIF(volume, '') AS UNSIGNED) ${d}`;
    case 'department':      return `department ${d}`;
    case 'lastCalibration': return `last_calibration ${d}`;
    case 'nextCalibration': return `DATE_ADD(STR_TO_DATE(last_calibration, '%Y-%m-%d'), INTERVAL \`interval\` MONTH) ${d}`;
    case 'responsible':     return `responsible ${d}`;
    case 'status':          return `(${sqlStatusOrder(warnDays)}) ${d}`;
    default:                return `id ${d}`;
  }
}

// Кэш warn_days (60 сек)
let _warnDaysCache = null;
let _warnDaysCacheTime = 0;
const WARN_DAYS_CACHE_TTL = 60_000;

async function getWarnDays(executor) {
  const now = Date.now();
  if (_warnDaysCache != null && now - _warnDaysCacheTime < WARN_DAYS_CACHE_TTL) {
    return _warnDaysCache;
  }
  try {
    const ex = executor || db;
    const [rows] = await ex.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'warn_days'"
    );
    const wd = rows.length ? parseInt(rows[0].setting_value, 10) : 30;
    _warnDaysCache = Number.isFinite(wd) && wd > 0 ? wd : 30;
    _warnDaysCacheTime = now;
    return _warnDaysCache;
  } catch (e) {
    return 30;
  }
}

function invalidateWarnDaysCache() {
  _warnDaysCache = null;
  _warnDaysCacheTime = 0;
}

module.exports = {
  validateISODate,
  normalizeInterval,
  todayLocalStr,
  STANDARD_FIELDS,
  FORBIDDEN_CUSTOM_KEYS,
  BARCODE_MAX_LEN,
  parseCustomData,
  mergeCustom,
  mergeCustomList,
  computeBarcodeValue,
  maybeRegenerateId,
  applyIdChange,
  canAccessDepartment,
  findPipetteOrFail,
  buildDepartmentScope,
  sqlComputedStatus,
  sqlStatusOrder,
  buildFiltersWhere,
  sqlOrderBy,
  getWarnDays,
  invalidateWarnDaysCache,
  PIPETTE_COLUMNS,
  USER_COLUMNS,
  AUDIT_COLUMNS,
  PRINTER_COLUMNS,
};
