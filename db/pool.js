'use strict';
const mysql = require('mysql2/promise');

// ============================================================
// ПУЛ СОЕДИНЕНИЙ
// ============================================================
const pool = mysql.createPool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  database: process.env.DB_NAME || 'pipette',
  user:     process.env.DB_USER || 'pipette',
  password: process.env.DB_PASSWORD || 'pipette_secret',
  charset:  'utf8mb4',
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: false,
});

// Универсальный query → [rowsOrResult, fields]
async function query(sql, params = []) {
  return pool.query(sql, params);
}

// ============================================================
// ОБЁРТКА СОЕДИНЕНИЯ
// Отслеживает SET FOREIGN_KEY_CHECKS и гарантирует, что в пул
// соединение вернётся с FK_CHECKS = 1. Если восстановить не
// удалось — соединение уничтожается (destroy), пул создаст новое.
// ============================================================
async function getConnection() {
  const raw = await pool.getConnection();
  let fkDirty = false;   // true, если последним SET было FOREIGN_KEY_CHECKS = 0

  const wrap = {
    query: async (sql, params = []) => {
      const result = await raw.query(sql, params);
      if (typeof sql === 'string') {
        const m = sql.match(/SET\s+(?:SESSION\s+|@@SESSION\.)?FOREIGN_KEY_CHECKS\s*=\s*([01])/i);
        if (m) fkDirty = (m[1] === '0');
      }
      return result;
    },

    beginTransaction: () => raw.beginTransaction(),
    commit:           () => raw.commit(),
    rollback:         async () => { try { await raw.rollback(); } catch (e) {} },

    release: async () => {
      if (fkDirty) {
        try {
          await raw.query('SET FOREIGN_KEY_CHECKS = 1');
          fkDirty = false;
        } catch (e) {
          // Соединение сломано — не возвращаем его в пул с FK_CHECKS=0.
          // destroy() закрывает сокет и убирает из пула, пул создаст новое.
          try { raw.destroy(); } catch (_) {}
          return;
        }
      }
      raw.release();
    },
  };

  return wrap;
}

// Универсальный безопасный парсер JSON
function safeParse(json, fallback = []) {
  if (json === null || json === undefined) return fallback;
  if (typeof json === 'object') return json;
  if (typeof json !== 'string') return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

module.exports = { pool, query, getConnection, safeParse };
