'use strict';
const db = require('../db');

async function logError(opts) {
  const {
    level = 'error',
    source = 'app',
    message = '',
    stack = null,
    req = null,
    statusCode = null,
  } = opts || {};

  let userId = null;
  let userName = null;
  let method = null;
  let url = null;
  let ip = null;

  try {
    if (req) {
      userId = req.user ? req.user.id : null;
      userName = req.user ? req.user.full_name : null;
      method = req.method || null;
      url = req.originalUrl || req.url || null;
      ip = req.ip || (req.socket && req.socket.remoteAddress) || null;
    }

    await db.query(
      `INSERT INTO app_logs
        (level, source, message, stack, user_id, user_full_name, method, url, status_code, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(level).slice(0, 20),
        String(source || '').slice(0, 50),
        String(message || '').slice(0, 5000),
        stack ? String(stack).slice(0, 20000) : null,
        userId,
        userName,
        method,
        url ? String(url).slice(0, 500) : null,
        statusCode,
        ip ? String(ip).slice(0, 64) : null,
      ]
    );
  } catch (e) {
    // Не роняем приложение, если не удалось записать лог
    console.error('app_logs write failed:', e.message);
  }
}

module.exports = { logError };
