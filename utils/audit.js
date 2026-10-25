'use strict';
const db = require('../db');

const CATEGORY_RULES = [
  { category: 'equipment',   test: /оборудован|прибор|пипетк/i },
  { category: 'users',       test: /пользовател|профил|парол|и\.о\.|имперсон|вход под/i },
  { category: 'calibration', test: /поверк|калибров|свидетельств/i },
  { category: 'barcode',     test: /штрихкод|этикет|принтер/i },
  { category: 'settings',    test: /настройк|пол[ея]|отдел|фильтр|тип[ыа]|шаблон|справк|экспорт/i },
  { category: 'locks',       test: /блокиров/i },
  { category: 'auth',        test: /вход в систем|выход|возврат к своей/i },
  { category: 'help',        test: /справк|раздел/i },
];

function detectCategory(action) {
  for (const r of CATEGORY_RULES) {
    if (r.test.test(action || '')) return r.category;
  }
  return 'other';
}

async function logAction(req, action, details = '', conn = null, pipetteId = null) {
  const executor = conn || db;
  try {
    await executor.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details, pipette_id, category) VALUES (?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        req.user.full_name,
        action,
        String(details || ''),
        pipetteId,
        detectCategory(action)
      ]
    );
  } catch (e) {
    console.error('Audit log error (не критично):', e.message);
  }
}

module.exports = { logAction, detectCategory };
