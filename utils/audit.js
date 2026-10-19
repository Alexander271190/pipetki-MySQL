'use strict';
const db = require('../db');

async function logAction(req, action, details = '', conn = null) {
  const executor = conn || db;
  try {
    await executor.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, action, String(details || '')]
    );
  } catch (e) {
    console.error('Audit log error (не критично):', e.message);
  }
}

module.exports = { logAction };
