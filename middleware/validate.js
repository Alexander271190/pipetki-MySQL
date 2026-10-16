'use strict';

// ============================================================
// ДАТЫ
// ============================================================
function validateISODate(str) {
  if (!str) return { ok: false, error: 'Дата не указана' };
  const s = String(str).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { ok: false, error: 'Некорректный формат даты (ожидается ГГГГ-ММ-ДД)' };
  }
  const [yy, mm, dd] = s.split('-').map(Number);
  if (mm < 1 || mm > 12) return { ok: false, error: 'Месяц должен быть от 1 до 12' };
  if (dd < 1 || dd > 31) return { ok: false, error: 'День должен быть от 1 до 31' };
  const parsed = new Date(yy, mm - 1, dd);
  if (parsed.getFullYear() !== yy || parsed.getMonth() !== mm - 1 || parsed.getDate() !== dd) {
    return { ok: false, error: 'Такой даты не существует' };
  }
  return { ok: true, value: s };
}

function todayLocalStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================
// ЧИСЛА
// ============================================================
function normalizeInterval(value, fallback = 12) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 120) return fallback;
  return n;
}

// ============================================================
// СТРОКИ
// ============================================================
function validateLength(str, max, fieldName) {
  if (String(str || '').length > max) {
    return { ok: false, error: `${fieldName}: максимум ${max} символов` };
  }
  return { ok: true };
}

// ============================================================
// ТИП ОБОРУДОВАНИЯ
// ============================================================
function validateEquipmentType(value, typesCache) {
  const v = String(value || '').trim();
  const validSet = new Set((typesCache || []).map(t => t.value));
  if (!validSet.has(v)) {
    return {
      ok: false,
      error: `Неизвестный тип оборудования: «${v}». Допустимые: ${[...validSet].join(', ')}`,
    };
  }
  return { ok: true, value: v };
}

module.exports = {
  validateISODate,
  todayLocalStr,
  normalizeInterval,
  validateLength,
  validateEquipmentType,
};
