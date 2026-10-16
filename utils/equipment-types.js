'use strict';
const db = require('../db');

// ============================================================
// КЭШ
// ============================================================
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000;   // 60 секунд

async function getEquipmentTypes({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && now - _cacheTime < CACHE_TTL) {
    return _cache;
  }

  const [rows] = await db.query(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'equipment_types'"
  );
  _cache = rows.length ? db.safeParse(rows[0].setting_value, []) : [];
  _cacheTime = now;
  return _cache;
}

// ============================================================
// ПОИСК ПО ЗНАЧЕНИЮ
// ============================================================
async function getTypeByValue(value) {
  const types = await getEquipmentTypes();
  return types.find(t => t.value === value) || null;
}

async function isValidType(value) {
  const types = await getEquipmentTypes();
  return types.some(t => t.value === value);
}

async function getPrefix(value) {
  const t = await getTypeByValue(value);
  return t && t.prefix ? String(t.prefix).trim().toUpperCase() : null;
}

async function getDefaultInterval(value) {
  const t = await getTypeByValue(value);
  const n = t ? parseInt(t.interval, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 120 ? n : 12;
}

async function isExternal(value) {
  const t = await getTypeByValue(value);
  if (!t) return true;
  return (t.calibrationPlace || 'internal') === 'external';
}

// ============================================================
// ИНВАЛИДАЦИЯ
// ============================================================
function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = {
  getEquipmentTypes,
  getTypeByValue,
  isValidType,
  getPrefix,
  getDefaultInterval,
  isExternal,
  invalidateCache,
};
