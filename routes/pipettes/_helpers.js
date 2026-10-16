'use strict';
const equipmentTypes = require('../../utils/equipment-types');
const {
  validateISODate,
  normalizeInterval,
  todayLocalStr,
} = require('../../middleware/validate');

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
// ДОСТУП ПО ОТДЕЛУ
// ============================================================
function canAccessDepartment(user, department) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.is_acting) {
    if (!user.acting_department) return false;
    return department === user.acting_department;
  }
  if (!user.only_own_department) return true;
  if (!user.department) return false;
  return department === user.department;
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
};
