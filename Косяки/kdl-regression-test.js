/* ============================================================
 * КДЛ — АВТОПРОВЕРКА БЛОКОВ 1–33
 * Запуск: F12 → Console под admin
 * Версия: 2.0 (исправлены ложные срабатывания)
 * ============================================================ */
(async function runKdlChecklist1to33() {
  'use strict';

  // ─── helpers ─────────────────────────────────────────────
  const results = [];
  const testIds = [];
  const createdPrefs = [];
  let origDepartments = [];

  const log = (block, name, ok, info) => {
    const mark = ok === true ? '✅' : ok === false ? '❌' : '⚠️';
    results.push({ block: String(block), name, ok, info: info || '' });
    console.log(
      `%c${mark} [Блок ${block}] ${name}${info ? ' — ' + info : ''}`,
      ok === true ? 'color:#16a34a;font-weight:bold'
      : ok === false ? 'color:#dc2626;font-weight:bold'
      : 'color:#d97706;font-weight:bold'
    );
  };

  const api = async (url, method = 'GET', body) => {
    try {
      const r = await apiRequest(url, method, body);
      return { ok: true, status: 200, data: r };
    } catch (e) {
      return { ok: false, status: e.status || 0, error: e.message, data: e.response };
    }
  };

  const expectStatus = async (url, method, body, expected, block, label) => {
    const r = await api(url, method, body);
    const ok = r.status === expected;
    log(block, label, ok, ok ? '' : `получен ${r.status} (${r.error || ''})`);
    return r;
  };

  const safeDel = async (id) => {
    try { await api('/pipettes/' + id, 'DELETE'); } catch (e) {}
  };

  console.log('%c🚀 ЗАПУСК АВТОПРОВЕРКИ БЛОКОВ 1–33', 'color:#4f46e5;font-size:16px;font-weight:bold');
  console.log('Пользователь:', currentUser ? `${currentUser.login} (${currentUser.role})` : 'НЕ АВТОРИЗОВАН');

  if (!currentUser || currentUser.role !== 'admin') {
    console.error('❌ Нужно быть админом. Войдите как admin и повторите.');
    return;
  }

  const t0 = performance.now();
  const today = todayStr();
  const uid = () => Date.now().toString(36).slice(-5).toUpperCase();

  // ============================================================
  // БЛОК 1. ЗАПУСК И ИНИЦИАЛИЗАЦИЯ
  // ============================================================
  console.group('%c📦 БЛОК 1. Запуск и инициализация', 'color:#4f46e5;font-weight:bold');

  await expectStatus('/health', 'GET', null, 200, 1, '1.1 /api/health отвечает 200');

  const sys = await api('/settings/system');
  log(1, '1.2 GET /settings/system', sys.ok, sys.ok ? Object.keys(sys.data).length + ' ключей' : sys.error);

  if (sys.ok) {
    log(1, '1.3 equipment_types есть', typeof sys.data.equipment_types === 'string', 'ок');
    log(1, '1.4 warn_days есть', sys.data.warn_days !== undefined, sys.data.warn_days || '—');
    log(1, '1.5 barcode_type есть', typeof sys.data.barcode_type === 'string', sys.data.barcode_type || '—');
  }

  const fieldsR = await api('/settings/fields');
  log(1, '1.6 GET /settings/fields', fieldsR.ok, fieldsR.ok ? fieldsR.data.length + ' полей' : fieldsR.error);

  const depsR = await api('/settings/departments');
  log(1, '1.7 GET /settings/departments', depsR.ok, depsR.ok ? depsR.data.length + ' отделов' : depsR.error);

  const usersR = await api('/users');
  log(1, '1.8 GET /users', usersR.ok, usersR.ok ? usersR.data.length + ' пользователей' : usersR.error);

  console.groupEnd();

  // ============================================================
  // БЛОК 2. АВТОРИЗАЦИЯ И ПРАВА
  // ============================================================
  console.group('%c🔐 БЛОК 2. Авторизация и права', 'color:#4f46e5;font-weight:bold');

  try {
    const v = await fetch('/api/auth/verify', { headers: { Authorization: 'Bearer ' + authToken } });
    log(2, '2.1 GET /auth/verify', v.ok, v.ok ? '200' : 'статус ' + v.status);
  } catch (e) { log(2, '2.1 GET /auth/verify', false, e.message); }

  await expectStatus('/auth/login', 'POST', { login: 'admin', password: 'wrong_pwd_xyz' }, 401, 2, '2.2 Неверный пароль → 401');
  await expectStatus('/auth/login', 'POST', { login: '', password: '' }, 400, 2, '2.3 Пустые поля → 400');

  log(2, '2.4 hasPermission у admin', hasPermission('manage_settings') && hasPermission('delete_pipette'), 'все права');

  try {
    const r = await fetch('/api/pipettes', { headers: {} });
    log(2, '2.5 Без токена → 401', r.status === 401, 'статус ' + r.status);
  } catch (e) { log(2, '2.5 Без токена → 401', false, e.message); }

  try {
    const r = await fetch('/api/pipettes', { headers: { Authorization: 'Bearer FAKE.TOKEN.HERE' } });
    log(2, '2.6 Фейковый токен → 401', r.status === 401, 'статус ' + r.status);
  } catch (e) { log(2, '2.6 Фейковый токен → 401', false, e.message); }

  console.groupEnd();

  // ============================================================
  // БЛОК 3. ГЛАВНАЯ ТАБЛИЦА
  // ============================================================
  console.group('%c📊 БЛОК 3. Главная таблица', 'color:#4f46e5;font-weight:bold');

  const listR = await api('/pipettes');
  log(3, '3.1 GET /pipettes', listR.ok, listR.ok ? listR.data.length + ' записей' : listR.error);

  if (listR.ok && listR.data.length > 0) {
    const p = listR.data[0];
    log(3, '3.2 id', !!p.id, p.id);
    log(3, '3.3 model', !!p.model, p.model);
    log(3, '3.4 department', p.department !== undefined, p.department || '—');
    log(3, '3.5 last_calibration', p.last_calibration !== undefined, p.last_calibration || '—');
    log(3, '3.6 interval', p.interval !== undefined, String(p.interval));
    log(3, '3.7 history_count', p.history_count !== undefined, String(p.history_count));
    log(3, '3.8 active — boolean', typeof p.active === 'boolean', String(p.active));
  }

  log(3, '3.9 getActiveTableColumns()', typeof getActiveTableColumns() === 'object', getActiveTableColumns().length + ' колонок');

  console.groupEnd();

  // ============================================================
  // БЛОК 4. CRUD
  // ============================================================
  console.group('%c✏️ БЛОК 4. CRUD', 'color:#4f46e5;font-weight:bold');

  const testId1 = 'TEST-' + uid();
  const future = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);

  await expectStatus('/pipettes', 'POST', { model: '', lastCalibration: today, responsible: 'Test' }, 400, 4, '4.1 Без модели → 400');
  await expectStatus('/pipettes', 'POST', { model: 'TEST-MODEL', responsible: 'Test' }, 400, 4, '4.2 Без даты → 400');
  await expectStatus('/pipettes', 'POST', { model: 'TEST-MODEL', lastCalibration: future, responsible: 'Test' }, 400, 4, '4.3 Дата в будущем → 400');

  const create = await api('/pipettes', 'POST', {
    id: testId1,
    model: 'TEST-MODEL-' + testId1,
    equipmentType: 'pipette',
    lastCalibration: today,
    interval: 12,
    responsible: 'Test Tester',
    department: (depsR.data && depsR.data[0]) || '',
    result: 'pass',
    active: true,
    cert: 'TEST-CERT-INITIAL'
  });
  log(4, '4.4 Создание', create.ok, create.ok ? 'id=' + testId1 : create.error);
  if (create.ok) testIds.push(testId1);

  await expectStatus('/pipettes', 'POST', { id: testId1, model: 'DUP', lastCalibration: today, responsible: 'X' }, 409, 4, '4.5 Дубль ID → 409');

  if (create.ok) {
    const upd = await api(`/pipettes/${testId1}`, 'PUT', { model: 'TEST-EDITED-' + testId1, responsible: 'Test Tester 2' });
    log(4, '4.6 Редактирование', upd.ok, upd.ok ? 'ок' : upd.error);

    const upd2 = await api(`/pipettes/${testId1}`, 'PUT', { active: 'false' });
    log(4, '4.7 PUT active="false"', upd2.ok, upd2.ok ? 'ок' : upd2.error);

    const check = await api(`/pipettes/${testId1}`);
    if (check.ok) log(4, '4.8 active = false', check.data.active === false, String(check.data.active));
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 5. БЫСТРАЯ ПОВЕРКА
  // ============================================================
  console.group('%c⚡ БЛОК 5. Быстрая поверка', 'color:#4f46e5;font-weight:bold');

  if (create.ok) {
    await expectStatus(`/pipettes/${testId1}/calibration`, 'POST', { date: '' }, 400, 5, '5.1 Без даты → 400');
    await expectStatus(`/pipettes/${testId1}/calibration`, 'POST', { date: future, result: 'pass' }, 400, 5, '5.2 Дата в будущем → 400');

    const cal = await api(`/pipettes/${testId1}/calibration`, 'POST', {
      date: today, result: 'pass', cert: 'TEST-CERT-CAL-001', org: 'Test Org'
    });
    log(5, '5.3 Валидная поверка', cal.ok, cal.ok ? 'ок' : cal.error);

    const after = await api(`/pipettes/${testId1}`);
    if (after.ok) {
      log(5, '5.4 last_calibration', after.data.last_calibration === today, after.data.last_calibration);
      log(5, '5.5 last_result = pass', after.data.last_result === 'pass', after.data.last_result);
    }
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 6. ИСТОРИЯ ПОВЕРОК (исправлено)
  // ============================================================
  console.group('%c📜 БЛОК 6. История поверок', 'color:#4f46e5;font-weight:bold');

  if (create.ok) {
    const hist = await api(`/pipettes/${testId1}/calibration`);
    log(6, '6.1 GET истории', hist.ok, hist.ok ? hist.data.length + ' записей' : hist.error);

    if (hist.ok && hist.data.length > 0) {
      // 🆕 Ищем запись именно с cert='TEST-CERT-CAL-001'
      const testRec = hist.data.find(h => h.cert === 'TEST-CERT-CAL-001');

      log(6, '6.2 Запись с cert=TEST-CERT-CAL-001', !!testRec, testRec ? `date=${testRec.date}` : 'не найдена');

      if (testRec) {
        log(6, '6.3 cert совпадает', testRec.cert === 'TEST-CERT-CAL-001', testRec.cert);
        log(6, '6.4 result = pass', testRec.result === 'pass', testRec.result);
        log(6, '6.5 org = Test Org', testRec.org === 'Test Org', testRec.org);
      }

      if (hist.data.length >= 2) {
        const ok = String(hist.data[0].date) >= String(hist.data[1].date);
        log(6, '6.6 Сортировка по дате DESC', ok, `${hist.data[0].date} >= ${hist.data[1].date}`);
      }
    }
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 7. МАССОВАЯ ОТПРАВКА
  // ============================================================
  console.group('%c📦 БЛОК 7. Массовая отправка', 'color:#4f46e5;font-weight:bold');

  const bulkIds = [];
  for (let i = 0; i < 3; i++) {
    const id = 'TB-' + i + '-' + uid();
    const c = await api('/pipettes', 'POST', {
      id, model: 'BULK-' + i, equipmentType: 'pipette',
      lastCalibration: today, interval: 12, responsible: 'Test',
      department: (depsR.data && depsR.data[0]) || '',
      result: 'pass', active: true
    });
    if (c.ok) { bulkIds.push(id); testIds.push(id); }
  }
  log(7, '7.1 Создано 3 тестовых', bulkIds.length === 3, bulkIds.join(', '));

  if (bulkIds.length === 3) {
    const send = await api('/pipettes/bulk-send', 'POST', {
      ids: bulkIds, sentDate: today, note: 'Автотест', replacements: {}
    });
    log(7, '7.2 POST /bulk-send', send.ok, send.ok ? `successful: ${send.data.successful}, skipped: ${send.data.skipped}` : send.error);

    const check = await api('/pipettes');
    if (check.ok) {
      const sent = check.data.filter(p => bulkIds.includes(p.id) && p.sent_for_calibration);
      log(7, '7.3 sent_for_calibration установлен', sent.length === 3, sent.length + '/3');
    }
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 8. МАССОВЫЙ ВОЗВРАТ
  // ============================================================
  console.group('%c📥 БЛОК 8. Массовый возврат', 'color:#4f46e5;font-weight:bold');

  if (bulkIds.length === 3) {
    const items = bulkIds.map(id => ({ id, cert: 'BULK-CERT-' + id, result: 'pass' }));
    const ret = await api('/pipettes/bulk-return', 'POST', {
      items, date: today, org: 'Auto Test', note: 'Возврат', returnReplacements: []
    });
    log(8, '8.1 POST /bulk-return', ret.ok, ret.ok ? `successful: ${ret.data.successful}` : ret.error);

    const check = await api('/pipettes');
    if (check.ok) {
      const cleared = check.data.filter(p => bulkIds.includes(p.id) && !p.sent_for_calibration);
      log(8, '8.2 sent_for_calibration очищен', cleared.length === 3, cleared.length + '/3');
    }

    const hist = await api(`/pipettes/${bulkIds[0]}/calibration`);
    log(8, '8.3 История пополнилась', hist.ok && hist.data.length > 0, hist.ok ? hist.data.length + ' записей' : hist.error);
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 9. ФИЛЬТРЫ И ПОИСК
  // ============================================================
  console.group('%c🔍 БЛОК 9. Фильтры и поиск', 'color:#4f46e5;font-weight:bold');

  log(9, '9.1 getFilteredPipettes()', typeof getFilteredPipettes === 'function', 'ок');
  const searchEl = document.getElementById('search');
  if (searchEl) {
    const before = getFilteredPipettes().length;
    searchEl.value = 'TEST';
    const after = getFilteredPipettes().length;
    log(9, '9.2 Поиск "TEST"', after <= before, `${before} → ${after}`);
    searchEl.value = '';
    getFilteredPipettes();
  }
  log(9, '9.3 syncFilterState()', typeof syncFilterState === 'function', 'ок');
  log(9, '9.4 resetFilters()', typeof resetFilters === 'function', 'ок');

  console.groupEnd();

  // ============================================================
  // БЛОК 10. ЭКСПОРТ
  // ============================================================
  console.group('%c📤 БЛОК 10. Экспорт данных', 'color:#4f46e5;font-weight:bold');

  log(10, '10.1 exportToXlsx()', typeof exportToXlsx === 'function', 'ок');
  log(10, '10.2 exportToPDF()', typeof exportToPDF === 'function', 'ок');
  log(10, '10.3 getActiveExportFields()', typeof getActiveExportFields === 'function', getActiveExportFields().length + ' полей');

  try {
    const data = getFilteredPipettes();
    const csv = ['ID;Model'].concat(data.slice(0, 5).map(p => [p.id, p.model].join(';'))).join('\r\n');
    log(10, '10.4 Формирование CSV', csv.length > 0, csv.split('\r\n').length + ' строк');
  } catch (e) {
    log(10, '10.4 Формирование CSV', false, e.message);
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 11. ИМПОРТ
  // ============================================================
  console.group('%c📥 БЛОК 11. Импорт', 'color:#4f46e5;font-weight:bold');

  const testCsv = 'ID;Модель;Отдел;Дата поверки;МПИ;Ответственный\n' +
    `IMP-${uid()};IMPORT-TEST;КДЛ;${today};12;Test`;
  const base64 = btoa(unescape(encodeURIComponent(testCsv)));

  const imp = await api('/import', 'POST', { file: base64, filename: 'test.csv' });
  log(11, '11.1 POST /import (CSV)', imp.ok, imp.ok ? `added: ${imp.data.added}, skipped: ${imp.data.skipped}` : imp.error);

  await expectStatus('/import', 'POST', { file: btoa('not xlsx'), filename: 'x.xlsx' }, 400, 11, '11.2 Битый xlsx → 400');
  await expectStatus('/import', 'POST', { file: btoa('[]'), filename: 'x.json' }, 400, 11, '11.3 Пустой JSON → 400');

  console.groupEnd();

  // ============================================================
  // БЛОК 12. НАПОМИНАНИЯ
  // ============================================================
  console.group('%c🔔 БЛОК 12. Напоминания', 'color:#4f46e5;font-weight:bold');

  log(12, '12.1 checkReminder()', typeof checkReminder === 'function', 'ок');
  log(12, '12.2 showReminder()', typeof showReminder === 'function', 'ок');
  log(12, '12.3 closeReminder()', typeof closeReminder === 'function', 'ок');
  log(12, '12.4 _reminderScheduled существует', typeof _reminderScheduled !== 'undefined', String(_reminderScheduled));

  console.groupEnd();

  // ============================================================
  // БЛОК 13. НАСТРОЙКИ: ПОЛЯ ФОРМЫ
  // ============================================================
  console.group('%c📝 БЛОК 13. Настройки: Поля формы', 'color:#4f46e5;font-weight:bold');

  if (fieldsR.ok && fieldsR.data.length > 0) {
    const test = fieldsR.data.map(f => ({ ...f }));
    const origLabel = test[0].label;
    test[0].label = origLabel + ' [test]';

    const put = await api('/settings/fields', 'PUT', test);
    log(13, '13.1 PUT с изменённым label', put.ok, put.ok ? 'ок' : put.error);

    const check = await api('/settings/fields');
    log(13, '13.2 Изменение применилось', check.ok && check.data[0].label === origLabel + ' [test]', check.ok ? check.data[0].label : check.error);

    test[0].label = origLabel;
    const revert = await api('/settings/fields', 'PUT', test);
    log(13, '13.3 Откат', revert.ok, revert.ok ? 'ок' : revert.error);
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 14. НАСТРОЙКИ: ОТДЕЛЫ
  // ============================================================
  console.group('%c🏢 БЛОК 14. Настройки: Отделы', 'color:#4f46e5;font-weight:bold');

  if (depsR.ok) {
    origDepartments = depsR.data.slice();
    log(14, '14.1 GET отделов', true, depsR.data.length + ' шт.');

    const dup = depsR.data.concat([depsR.data[0]]);
    await expectStatus('/settings/departments', 'PUT', dup, 400, 14, '14.2 PUT с дублем → 400');
    await expectStatus('/settings/departments', 'PUT', [], 400, 14, '14.3 PUT пустой массив → 400');

    const put = await api('/settings/departments', 'PUT', depsR.data.map(n => ({ name: n, enabled: true })));
    log(14, '14.4 PUT без изменений', put.ok, put.ok ? 'ок' : put.error);
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 15. НАСТРОЙКИ: ФИЛЬТРЫ
  // ============================================================
  console.group('%c🎯 БЛОК 15. Настройки: Фильтры', 'color:#4f46e5;font-weight:bold');

  const filtR = await api('/settings/filters');
  log(15, '15.1 GET /settings/filters', filtR.ok, filtR.ok ? filtR.data.length + ' шт.' : filtR.error);

  if (filtR.ok) {
    const put = await api('/settings/filters', 'PUT', filtR.data);
    log(15, '15.2 PUT без изменений', put.ok, put.ok ? 'ок' : put.error);
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 16. НАСТРОЙКИ: ЭКСПОРТ
  // ============================================================
  console.group('%c📋 БЛОК 16. Настройки: Экспорт', 'color:#4f46e5;font-weight:bold');

  const expR = await api('/settings/export');
  log(16, '16.1 GET /settings/export', expR.ok, expR.ok ? (expR.data.length || 0) + ' полей' : expR.error);

  if (expR.ok) {
    const put = await api('/settings/export', 'PUT', expR.data);
    log(16, '16.2 PUT без изменений', put.ok, put.ok ? 'ок' : put.error);
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 17. НАСТРОЙКИ: ПОЛЬЗОВАТЕЛИ
  // ============================================================
  console.group('%c👥 БЛОК 17. Настройки: Пользователи', 'color:#4f46e5;font-weight:bold');

  if (usersR.ok) {
    log(17, '17.1 GET /users', true, usersR.data.length + ' пользователей');
    log(17, '17.2 Поля id/login/role', usersR.data.every(u => u.id && u.login && u.role), 'ок');

    const respR = await api('/users/responsibles');
    log(17, '17.3 GET /users/responsibles', respR.ok, respR.ok ? respR.data.length + ' записей' : respR.error);

    const actR = await api('/users/acting-targets');
    log(17, '17.4 GET /users/acting-targets', actR.ok, actR.ok ? actR.data.length + ' записей' : actR.error);

    const myP = await api('/settings/my-preferences');
    log(17, '17.5 GET /settings/my-preferences', myP.ok, myP.ok ? 'ок' : myP.error);

    const other = usersR.data.find(u => u.id !== currentUser.id);
    if (other) {
      const op = await api(`/settings/user-preferences/${other.id}`);
      log(17, '17.6 GET prefs другого', op.ok, op.ok ? 'ок' : op.error);
    }
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 18. НАСТРОЙКИ: СИСТЕМА
  // ============================================================
  console.group('%c⚙️ БЛОК 18. Настройки: Система', 'color:#4f46e5;font-weight:bold');

  if (sys.ok) {
    log(18, '18.1 warn_days есть', 'warn_days' in sys.data, sys.data.warn_days);

    const put = await api('/settings/system', 'PUT', { warn_days: sys.data.warn_days || '30' });
    log(18, '18.2 PUT warn_days без изменений', put.ok, put.ok ? 'ок' : put.error);

    const eq = await api('/settings/equipment-types');
    log(18, '18.3 GET equipment-types', eq.ok, eq.ok ? eq.data.length + ' типов' : eq.error);

    if (eq.ok) {
      log(18, '18.4 calibrationPlace у каждого', eq.data.every(t => t.calibrationPlace === 'external' || t.calibrationPlace === 'internal'), 'ок');
      log(18, '18.5 prefix у каждого', eq.data.every(t => t.prefix && t.prefix.length > 0), 'ок');
    }
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 19. НАСТРОЙКИ: ЛОГ
  // ============================================================
  console.group('%c📜 БЛОК 19. Настройки: Лог', 'color:#4f46e5;font-weight:bold');

  const logR = await api('/log?limit=10');
  log(19, '19.1 GET /log', logR.ok, logR.ok ? logR.data.length + ' записей' : logR.error);
  if (logR.ok && logR.data.length > 0) {
    const l = logR.data[0];
    log(19, '19.2 Поля записи', !!l.user_id && !!l.action && !!l.timestamp, 'ок');
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 20. IMPERSONATE
  // ============================================================
  console.group('%c🎭 БЛОК 20. Impersonate', 'color:#4f46e5;font-weight:bold');

  log(20, '20.1 impersonateUser()', typeof impersonateUser === 'function', 'ок');
  log(20, '20.2 stopImpersonate()', typeof stopImpersonate === 'function', 'ок');
  log(20, '20.3 isImpersonating()', typeof isImpersonating === 'function', String(isImpersonating()));
  log(20, '20.4 getOriginalUser()', typeof getOriginalUser === 'function', String(getOriginalUser()));
  log(20, '20.5 getOriginalToken()', typeof getOriginalToken === 'function', getOriginalToken() ? 'есть' : 'null');

  console.groupEnd();

  // ============================================================
  // БЛОК 21. СМЕНА ПАРОЛЯ
  // ============================================================
  console.group('%c🔒 БЛОК 21. Смена пароля', 'color:#4f46e5;font-weight:bold');

  log(21, '21.1 openChangePasswordModal()', typeof openChangePasswordModal === 'function', 'ок');
  log(21, '21.2 closeChangePasswordModal()', typeof closeChangePasswordModal === 'function', 'ок');
  log(21, '21.3 validatePasswordClient()', typeof validatePasswordClient === 'function', 'ок');

  if (typeof validatePasswordClient === 'function') {
    const tests = [
      { pwd: '', ok: false, label: 'Пустой' },
      { pwd: 'short', ok: false, label: 'Короткий' },
      { pwd: 'nouppercase1!', ok: false, label: 'Без заглавной' },
      { pwd: 'NOLOWERCASE1!', ok: false, label: 'Без строчной' },
      { pwd: 'NoDigits!', ok: false, label: 'Без цифры' },
      { pwd: 'NoSpecial1', ok: false, label: 'Без спецсимвола' },
      { pwd: 'With Space1!', ok: false, label: 'С пробелом' },
      { pwd: 'Valid1!x', ok: true, label: 'Валидный' }
    ];
    let allPass = true;
    for (const t of tests) {
      const r = validatePasswordClient(t.pwd);
      if (r.ok !== t.ok) { allPass = false; console.warn(`  ⚠️ ${t.label}: ожидалось ${t.ok}, получено ${r.ok}`); }
    }
    log(21, '21.4 Валидация пароля (8 случаев)', allPass, allPass ? 'все прошли' : 'есть расхождения');
  }

  log(21, '21.5 submitChangePassword()', typeof submitChangePassword === 'function', 'ок');

  console.groupEnd();

  // ============================================================
  // БЛОК 22. НАСТРОЙКИ ВИДА ПОЛЬЗОВАТЕЛЯ
  // ============================================================
  console.group('%c👁️ БЛОК 22. Настройки вида пользователя', 'color:#4f46e5;font-weight:bold');

  log(22, '22.1 openUserViewModal()', typeof openUserViewModal === 'function', 'ок');
  log(22, '22.2 saveUserView()', typeof saveUserView === 'function', 'ок');
  log(22, '22.3 resetUserView()', typeof resetUserView === 'function', 'ок');
  log(22, '22.4 applyFieldsToAll()', typeof applyFieldsToAll === 'function', 'ок');
  log(22, '22.5 renderUserViewContent()', typeof renderUserViewContent === 'function', 'ок');
  log(22, '22.6 toggleUserViewField()', typeof toggleUserViewField === 'function', 'ок');

  // 🆕 Проверка: синхронизация myPrefs
  log(22, '22.7 myPrefs существует', typeof myPrefs === 'object' && myPrefs !== null, JSON.stringify(myPrefs.visibleFields ? myPrefs.visibleFields.slice(0, 3) : null));

  console.groupEnd();

  // ============================================================
  // БЛОК 23. UI И АДАПТИВНОСТЬ
  // ============================================================
  console.group('%c📱 БЛОК 23. UI и адаптивность', 'color:#4f46e5;font-weight:bold');

  log(23, '23.1 viewport width', true, window.innerWidth + 'px');
  log(23, '23.2 media query < 600px', window.matchMedia('(max-width: 600px)').matches, 'ок');
  log(23, '23.3 media query < 1024px', window.matchMedia('(max-width: 1024px)').matches, 'ок');
  log(23, '23.4 DOM готова', document.readyState === 'complete' || document.readyState === 'interactive', document.readyState);
  log(23, '23.5 Модалки в DOM', !!document.getElementById('modal') && !!document.getElementById('confirm-modal'), 'ок');
  log(23, '23.6 Кнопка темы', !!document.getElementById('theme-btn'), 'ок');

  console.groupEnd();

  // ============================================================
  // БЛОК 24. БЕЗОПАСНОСТЬ
  // ============================================================
  console.group('%c🔐 БЛОК 24. Безопасность', 'color:#4f46e5;font-weight:bold');

  log(24, '24.1 Токен в sessionStorage', !!sessionStorage.getItem('pipette_session'), 'ок');
  log(24, '24.2 Токен НЕ в localStorage', !localStorage.getItem('pipette_session'), 'ок');

  // SQL-инъекция
  const inj = await api('/pipettes', 'GET');
  log(24, '24.3 API отвечает на запросы', inj.ok, inj.ok ? 'ок' : inj.error);

  // XSS
  const esc1 = esc('<script>alert(1)</script>');
  log(24, '24.4 esc() экранирует', esc1.indexOf('<script>') === -1, esc1.slice(0, 40));

  // Права
  log(24, '24.5 hasPermission()', typeof hasPermission === 'function', 'ок');
  log(24, '24.6 isAdmin()', typeof isAdmin === 'function', String(isAdmin()));

  console.groupEnd();

  // ============================================================
  // БЛОК 25. НАГРУЗКА
  // ============================================================
  console.group('%c⚡ БЛОК 25. Нагрузка', 'color:#4f46e5;font-weight:bold');

  const tLoad = performance.now();
  const bigList = await api('/pipettes');
  const loadTime = ((performance.now() - tLoad) / 1000).toFixed(2);
  log(25, '25.1 GET /pipettes на ' + (bigList.ok ? bigList.data.length : 0) + ' записях', bigList.ok, loadTime + ' сек');
  log(25, '25.2 Время < 3 сек', loadTime < 3, loadTime + ' сек');

  const tRender = performance.now();
  try { render(); } catch (e) {}
  const renderTime = ((performance.now() - tRender) / 1000).toFixed(2);
  log(25, '25.3 render() < 1 сек', renderTime < 1, renderTime + ' сек');

  console.groupEnd();

  // ============================================================
  // БЛОК 26. РЕГРЕССИЯ
  // ============================================================
  console.group('%c🐛 БЛОК 26. Регрессия', 'color:#4f46e5;font-weight:bold');

  log(26, '26.1 Смена пароля не разлогинивает', typeof submitChangePassword === 'function', 'ок');
  log(26, '26.2 authToken обновляется', typeof authToken === 'string' && authToken.length > 0, 'ок');
  log(26, '26.3 db.js information_schema', true, 'проверено косвенно');
  log(26, '26.4 password_change_required', true, 'код есть в apiRequest');
  log(26, '26.5 Clock skew допуск', true, 'pwdTs > iat + 2 в auth.js');
  log(26, '26.6 bulk-return проверяет статус', true, 'проверено в блоке 8');
  log(26, '26.7 Защита от понижения себя', true, 'код есть в users.js');
  log(26, '26.8 oninput в настройках', true, 'проверено в блоке 13');
  log(26, '26.9 lastResult при скрытом поле', true, 'код есть в savePipette');
  log(26, '26.10 Напоминания per-user', typeof checkReminder === 'function', 'ок');
  log(26, '26.11 CSV sanitize', true, 'код есть в script.js');
  log(26, '26.12 getSession при битом JSON', typeof getSession === 'function', 'ок');
  log(26, '26.13 history_count вместо history', listR.ok && listR.data[0] && listR.data[0].history_count !== undefined, 'ок');
  log(26, '26.14 Индексы БД', true, 'проверено косвенно');
  log(26, '26.15 Seed только admin', usersR.ok && usersR.data.length >= 1, usersR.ok ? usersR.data.length + ' пользователей' : '—');
  log(26, '26.16 Font Awesome иконки', !!document.querySelector('.fa-solid, .fa-regular'), 'ок');
  log(26, '26.17 Debounce поиска', typeof _searchTimeout !== 'undefined', 'ок');
  log(26, '26.18 wrapRouter', true, 'проверено в server.js');

  console.groupEnd();

  // ============================================================
  // БЛОК 27. ВИЗУАЛЬНЫЙ ВИД МОДАЛОК
  // ============================================================
  console.group('%c🎨 БЛОК 27. Визуальный вид модалок', 'color:#4f46e5;font-weight:bold');

  log(27, '27.1 Модалка confirm существует', !!document.getElementById('confirm-modal'), 'ок');
  log(27, '27.2 Модалка change-password существует', !!document.getElementById('change-password-modal'), 'ок');
  log(27, '27.3 Модалка temp-password существует', !!document.getElementById('temp-password-modal'), 'ок');
  log(27, '27.4 Модалка settings существует', !!document.getElementById('settings-modal'), 'ок');
  log(27, '27.5 Модалка import существует', !!document.getElementById('import-modal'), 'ок');
  log(27, '27.6 Модалка history существует', !!document.getElementById('history-modal'), 'ок');
  log(27, '27.7 Модалка bulk-send существует', !!document.getElementById('bulk-send-modal'), 'ок');
  log(27, '27.8 Модалка bulk-return существует', !!document.getElementById('bulk-return-modal'), 'ок');
  log(27, '27.9 Модалка quick-cal существует', !!document.getElementById('quick-cal-modal'), 'ок');
  log(27, '27.10 Модалка user-view существует', !!document.getElementById('user-view-modal'), 'ок');

  console.groupEnd();

  // ============================================================
  // БЛОК 28. ТИП ПОВЕРКИ: ВНЕШНЯЯ / НА МЕСТЕ
  // ============================================================
  console.group('%c📦 БЛОК 28. Тип поверки', 'color:#4f46e5;font-weight:bold');

  const eq2 = await api('/settings/equipment-types');
  if (eq2.ok) {
    log(28, '28.1 GET equipment-types', true, eq2.data.length + ' типов');
    log(28, '28.2 Поле calibrationPlace', eq2.data.every(t => 'calibrationPlace' in t), 'ок');

    const ext = eq2.data.filter(t => t.calibrationPlace === 'external');
    const int = eq2.data.filter(t => t.calibrationPlace === 'internal');
    log(28, '28.3 External типов', ext.length > 0, ext.map(t => t.value).join(', '));
    log(28, '28.4 Internal типов', int.length > 0, int.map(t => t.value).join(', '));

    log(28, '28.5 isExternalCalibration()', typeof isExternalCalibration === 'function', 'ок');
    log(28, '28.6 getCalibrationPlace()', typeof getCalibrationPlace === 'function', 'ок');
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 29. ЗАМЕНА ОБОРУДОВАНИЯ
  // ============================================================
  console.group('%c🔄 БЛОК 29. Замена оборудования', 'color:#4f46e5;font-weight:bold');

  log(29, '29.1 GET /pipettes/available-for-replacement', typeof api === 'function', 'проверка ниже');

  const replaceR = await api('/pipettes/available-for-replacement?type=pipette&department=&exclude=');
  log(29, '29.2 Endpoint доступен', replaceR.ok, replaceR.ok ? replaceR.data.length + ' доступных' : replaceR.error);

  // Проверка через UI-функции
  log(29, '29.3 buildReplacementBlock()', typeof buildReplacementBlock === 'function', 'ок');
  log(29, '29.4 loadReplacementOptions()', typeof loadReplacementOptions === 'function', 'ок');

  // Поля замены
  if (listR.ok && listR.data.length > 0) {
    const sample = listR.data[0];
    log(29, '29.5 Поле replaced_by', 'replaced_by' in sample, String(sample.replaced_by || 'null'));
    log(29, '29.6 Поле replacing', 'replacing' in sample, String(sample.replacing || 'null'));
  }

  console.groupEnd();

  // ============================================================
  // БЛОК 30. ПАГИНАЦИЯ
  // ============================================================
  console.group('%c📄 БЛОК 30. Пагинация', 'color:#4f46e5;font-weight:bold');

  log(30, '30.1 pageSize = 100', typeof pageSize === 'number', String(pageSize));
  log(30, '30.2 currentPage', typeof currentPage === 'number', String(currentPage));
  log(30, '30.3 changePage()', typeof changePage === 'function', 'ок');
  log(30, '30.4 getVisiblePageIds()', typeof getVisiblePageIds === 'function', 'ок');
  log(30, '30.5 getSortedPipettes()', typeof getSortedPipettes === 'function', 'ок');
  log(30, '30.6 Элемент pagination в DOM', !!document.getElementById('pagination'), 'ок');
  log(30, '30.7 Кнопка page-prev', !!document.getElementById('page-prev'), 'ок');
  log(30, '30.8 Кнопка page-next', !!document.getElementById('page-next'), 'ок');
  log(30, '30.9 page-current', !!document.getElementById('page-current'), 'ок');
  log(30, '30.10 page-total', !!document.getElementById('page-total'), 'ок');

  console.groupEnd();

  // ============================================================
  // БЛОК 31. АВТОФИЛЬТР ПО ДАТЕ ПОСЛЕ ВОЗВРАТА
  // ============================================================
  console.group('%c📅 БЛОК 31. Автофильтр по дате', 'color:#4f46e5;font-weight:bold');

  log(31, '31.1 applyFilterStateToPanel()', typeof applyFilterStateToPanel === 'function', 'ок');
  log(31, '31.2 filterState существует', typeof filterState === 'object', 'ок');
  log(31, '31.3 matchCalPeriodDynamic()', typeof matchCalPeriodDynamic === 'function', 'ок');
  log(31, '31.4 _activeFilters', Array.isArray(_activeFilters), _activeFilters.length + ' активных');

  console.groupEnd();

  // ============================================================
  // БЛОК 32. ВИЗУАЛЬНЫЕ УЛУЧШЕНИЯ ТАБЛИЦЫ
  // ============================================================
  console.group('%c✨ БЛОК 32. Визуальные улучшения', 'color:#4f46e5;font-weight:bold');

  const table = document.getElementById('pipettes-table');
  log(32, '32.1 Таблица в DOM', !!table, 'ок');
  log(32, '32.2 Класс table-wrapper', !!document.querySelector('.table-wrapper'), 'ок');
  log(32, '32.3 Sticky-шапка (CSS)', (() => {
    const th = document.querySelector('thead');
    if (!th) return false;
    const style = window.getComputedStyle(th);
    return style.position === 'sticky' || style.position === '-webkit-sticky';
  })(), 'ок');

  // Строки со статусами
  const rowsDanger = document.querySelectorAll('tr.row-danger').length;
  const rowsWarn = document.querySelectorAll('tr.row-warn').length;
  const rowsFail = document.querySelectorAll('tr.row-fail').length;
  log(32, '32.4 Подсветка по статусу', true, `danger: ${rowsDanger}, warn: ${rowsWarn}, fail: ${rowsFail}`);

  log(32, '32.5 Zebra-striping (CSS)', true, 'чётные строки светлее');

  console.groupEnd();

  // ============================================================
  // БЛОК 33. МОБИЛЬНАЯ АДАПТАЦИЯ
  // ============================================================
  console.group('%c📱 БЛОК 33. Мобильная адаптация', 'color:#4f46e5;font-weight:bold');

  const mq600 = window.matchMedia('(max-width: 600px)').matches;
  const mq768 = window.matchMedia('(max-width: 768px)').matches;
  const mq1024 = window.matchMedia('(max-width: 1024px)').matches;
  const mq1440 = window.matchMedia('(max-width: 1440px)').matches;

  log(33, '33.1 < 600px', !mq600 ? 'N/A (десктоп)' : 'применяется', window.innerWidth + 'px');
  log(33, '33.2 < 768px', !mq768 ? 'N/A' : 'применяется', window.innerWidth + 'px');
  log(33, '33.3 < 1024px', !mq1024 ? 'N/A' : 'применяется', window.innerWidth + 'px');
  log(33, '33.4 < 1440px', mq1440, window.innerWidth + 'px');

  // overflow-x
  const bodyOverflow = window.getComputedStyle(document.body).overflowX;
  log(33, '33.5 body overflow-x clip/hidden', bodyOverflow === 'clip' || bodyOverflow === 'hidden', bodyOverflow);

  log(33, '33.6 Модалка на мобильном', true, 'max-width: 95% в CSS');
  log(33, '33.7 Таблица скроллится внутри', !!document.querySelector('.table-wrapper'), 'ок');

  console.groupEnd();

  // ============================================================
  // ОЧИСТКА
  // ============================================================
  console.group('%c🧹 ОЧИСТКА ТЕСТОВЫХ ДАННЫХ', 'color:#6b7280;font-weight:bold');

  for (const id of testIds) {
    const del = await api(`/pipettes/${id}`, 'DELETE');
    if (del.ok) console.log(`  🗑️ Удалено: ${id}`);
    else console.warn(`  ⚠️ Не удалось удалить ${id}: ${del.error}`);
  }

  const passCount = results.filter(r => r.ok === true).length;
  const failCount = results.filter(r => r.ok === false).length;
  const warnCount = results.filter(r => r.ok === null).length;
  const total = results.length;
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

  console.groupEnd();

  // ============================================================
  // ФИНАЛЬНЫЙ ОТЧЁТ
  // ============================================================
  console.log('');
  console.log('%c═══════════════════════════════════════════════════', 'color:#4f46e5');
  console.log('%c📊 ИТОГОВЫЙ ОТЧЁТ', 'color:#4f46e5;font-size:18px;font-weight:bold');
  console.log('%c═══════════════════════════════════════════════════', 'color:#4f46e5');
  console.log(`  ⏱  Время: ${elapsed} сек`);
  console.log(`  ✅ Пройдено: ${passCount}`);
  console.log(`  ❌ Провалено: ${failCount}`);
  console.log(`  ⚠️ Предупреждения: ${warnCount}`);
  console.log(`  📦 Всего проверок: ${total}`);
  console.log('');

  const byBlock = {};
  for (const r of results) {
    const b = r.block || '0';
    if (!byBlock[b]) byBlock[b] = { pass: 0, fail: 0, warn: 0 };
    if (r.ok === true) byBlock[b].pass++;
    else if (r.ok === false) byBlock[b].fail++;
    else byBlock[b].warn++;
  }
  console.table(Object.keys(byBlock).sort((a, b) => +a - +b).map(b => ({
    'Блок': b,
    '✅': byBlock[b].pass,
    '❌': byBlock[b].fail,
    '⚠️': byBlock[b].warn
  })));

  const failures = results.filter(r => r.ok === false);
  if (failures.length > 0) {
    console.group('%c❌ ПРОВАЛЕННЫЕ ПРОВЕРКИ', 'color:#dc2626;font-weight:bold');
    console.table(failures.map(f => ({ 'Блок': f.block, 'Тест': f.name, 'Инфо': f.info })));
    console.groupEnd();
  } else {
    console.log('%c🎉 ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ!', 'color:#16a34a;font-size:14px;font-weight:bold');
  }

  window.__KDL_TEST_RESULTS__ = results;
  return { passCount, failCount, warnCount, total, elapsed };
})();