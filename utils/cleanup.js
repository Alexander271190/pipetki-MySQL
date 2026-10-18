'use strict';
const db = require('../db');

const AUDIT_LOG_RETENTION_DAYS = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS, 10) || 90;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

async function cleanupAuditLog() {
  try {
    const [result] = await db.query(
      'DELETE FROM audit_log WHERE timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [AUDIT_LOG_RETENTION_DAYS]
    );
    if (result.affectedRows > 0) {
      console.log(`🧹 audit_log: удалено ${result.affectedRows} записей старше ${AUDIT_LOG_RETENTION_DAYS} дней`);
    }
  } catch (e) {
    console.error('❌ Ошибка очистки audit_log:', e.message);
  }
}

function startCleanupScheduler() {
  console.log(`🕒 Cleanup scheduler: audit_log (${AUDIT_LOG_RETENTION_DAYS} дн.), интервал — 24 ч`);
  setTimeout(async () => {
    await cleanupAuditLog();
    setInterval(cleanupAuditLog, CLEANUP_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
}

module.exports = { startCleanupScheduler, cleanupAuditLog };
