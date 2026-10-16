'use strict';
const mysql = require('mysql2/promise');

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

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function getConnection() {
  const conn = await pool.getConnection();
  return {
    query:            (sql, p = []) => conn.query(sql, p),
    beginTransaction: () => conn.beginTransaction(),
    commit:           () => conn.commit(),
    rollback:         async () => { try { await conn.rollback(); } catch (e) {} },
    release:          () => conn.release(),
  };
}

function safeParse(json, fallback = []) {
  if (json === null || json === undefined) return fallback;
  if (typeof json === 'object') return json;
  if (typeof json !== 'string') return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

module.exports = { pool, query, getConnection, safeParse };
