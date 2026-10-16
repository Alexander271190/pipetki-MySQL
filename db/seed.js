'use strict';
const { pool } = require('./pool');

// ============================================================
// ГЕНЕРАЦИЯ ID
// ============================================================
async function generatePipetteId(prefix = 'P', conn = null) {
  const executor = conn || pool;
  const safePrefix = String(prefix).replace(/[%_\\]/g, '\\$&');

  // FOR UPDATE внутри транзакции сериализует генерацию между параллельными запросами
  const sql = `SELECT id FROM pipettes
               WHERE id LIKE ?
               ORDER BY id
               FOR UPDATE`;

  const [rows] = await executor.query(sql, [`${safePrefix}-%`]);

  let maxNum = 0;
  for (const row of rows) {
    const m = String(row.id).match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
}

// ============================================================
// СПРАВКА
// ============================================================
async function seedHelpDocs(conn) {
  const executor = conn || pool;
  let sections = [];
  // ⚠️ ИСПРАВЛЕНО: './help-seed' → '../help-seed'
  //    (файл help-seed.js остаётся в корне проекта, а этот файл теперь в db/)
  try { sections = require('../help-seed'); } catch (e) { sections = []; }

  for (const s of sections) {
    await executor.query(
      `INSERT IGNORE INTO help_docs
         (slug, title, content, required_permissions, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        s.slug,
        s.title,
        s.content,
        JSON.stringify(s.requiredPermissions || []),
        s.sortOrder || 0,
      ]
    );
  }
}

// ============================================================
// НАЧАЛЬНЫЕ ДАННЫЕ
// ============================================================
async function seedInitialData() {
  // --- Пользователи ---
  let seededAny = false;

  const [uc] = await pool.query('SELECT COUNT(*) AS c FROM users');
  if (uc[0].c === 0) {
    seededAny = true;

    await pool.query(
      `INSERT INTO users
         (id, login, password, full_name, position, department, role,
          extra_permissions, must_change_password, must_set_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      ['admin1', 'admin', '', 'Администратор', 'Администратор системы',
       null, 'admin', '[]']
    );

    console.log('👤 Создана учётная запись администратора.');
    console.log('   Логин: admin');
    console.log('   Пароль: не задан. При первом входе система попросит установить пароль. Остальных пользователей создайте через «Настройки → Пользователи».');
  }

  // --- Отделы ---
  const [dc] = await pool.query('SELECT COUNT(*) AS c FROM departments');
  if (dc[0].c === 0) {
    const deps = [
      'Гематологический отдел',
      'Биохимический отдел',
      'Коагулогический отдел',
      'Экспресс отдел',
      'Изосерологический отдел',
      'Серологический отдел',
      'ГИМИ',
      'Бактериологический отдел'
    ];
    for (const d of deps) {
      await pool.query('INSERT INTO departments (name) VALUES (?)', [d]);
    }
  }

  // --- Системные настройки ---
  await pool.query(`INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('barcode_type', 'code128')`);
  await pool.query(`INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('barcode_label_fields', ?)`,
    [JSON.stringify(['id', 'model', 'serial', 'department'])]);

  const bcDefaults = {
    barcode_mode: 'pdf-zebra',
    barcode_label_size: '58x40',
    barcode_fallback_to_pdf: '1',
    barcode_default_copies: '1',
    barcode_zebra_language: 'zpl',
    barcode_agent_port: '9200',
    barcode_max_length: '255',
    barcode_font: 'dejavu',
  };
  for (const [k, v] of Object.entries(bcDefaults)) {
    await pool.query(`INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)`, [k, v]);
  }

  // 🆕 Порог предупреждения о поверке — дефолт 30 дней
  await pool.query(
    `INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('warn_days', '30')`
  );

  // Дефолтные типы оборудования
  const defaultTypes = [
    { value: 'pipette',     label: 'Пипетка',     prefix: 'P', calibrationPlace: 'external', interval: 12 },
    { value: 'analyzer',    label: 'Анализатор',  prefix: 'A', calibrationPlace: 'external', interval: 12 },
    { value: 'thermometer', label: 'Термометр',   prefix: 'T', calibrationPlace: 'internal', interval: 12 },
    { value: 'scales',      label: 'Весы',        prefix: 'S', calibrationPlace: 'internal', interval: 12 },
    { value: 'photometer',  label: 'Фотометр',    prefix: 'F', calibrationPlace: 'internal', interval: 12 },
    { value: 'microscope',  label: 'Микроскоп',   prefix: 'M', calibrationPlace: 'internal', interval: 12 },
  ];
  await pool.query(
    `INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('equipment_types', ?)`,
    [JSON.stringify(defaultTypes)]
  );

  // --- Поля формы ---
  const [fc] = await pool.query('SELECT COUNT(*) AS c FROM field_config');
  if (fc[0].c === 0) {
    const ins = `INSERT INTO field_config (id, label, type, required, enabled, options, default_value, field_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const fields = [
      ['id',              'Внутренний номер',              'text',     1, 1, '[]',                     '',       1],
      ['serial',          'Серийный номер',                'text',     0, 1, '[]',                     '',       2],
      ['barcode',         'Штрихкод',                      'text',     0, 1, '[]',                     '',       3],
      ['manufacturer',    'Производитель',                 'text',     0, 1, '[]',                     '',       4],
      ['model',           'Модель',                        'text',     1, 1, '[]',                     '',       5],
      ['equipmentType',   'Тип оборудования',              'select',   1, 1, '[]',                     'pipette', 6],
      ['volume',          'Объём (мкл)',                   'text',     0, 1, '[]',                     '',       7],
      ['department',      'Отдел',                         'select',   0, 1, '[]',                     '',       8],
      ['interval',        'Межповерочный интервал (мес.)', 'number',   1, 1, '[]',                     '12',     9],
      ['lastCalibration', 'Дата последней поверки',        'date',     1, 1, '[]',                     '',       10],
      ['cert',            'Номер свидетельства',           'text',     0, 1, '[]',                     '',       11],
      ['result',          'Результат поверки',             'select',   0, 1, '["pass","fail","wip"]', 'pass',   12],
      ['active',          'Статус эксплуатации',           'select',   0, 1, '["true","false"]',       'true',   13],
      ['responsible',     'Ответственный сотрудник',       'select',   0, 1, '[]',                     '',       14],
      ['location',        'Место хранения',                'text',     0, 1, '[]',                     '',       15],
      ['notes',           'Примечание',                    'textarea', 0, 1, '[]',                     '',       16]
    ];
    for (const f of fields) await pool.query(ins, f);
  }

  // --- Настройки экспорта ---
  const [ec] = await pool.query('SELECT COUNT(*) AS c FROM export_settings');
  if (ec[0].c === 0) {
    const defaultExport = [
      'id', 'serial', 'manufacturer', 'model', 'equipmentType', 'volume', 'department',
      'lastCalibration', 'nextCalibration', 'interval', 'daysLeft',
      'responsible', 'location', 'status', 'cert', 'notes'
    ];
    await pool.query('INSERT INTO export_settings (id, fields) VALUES (1, ?)', [JSON.stringify(defaultExport)]);
  }

  // --- Демо-пипетки (только один раз за всю жизнь БД) ---
  const [demoFlag] = await pool.query(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'demo_seeded'"
  );
  const demoAlreadySeeded = demoFlag.length > 0 && demoFlag[0].setting_value === '1';

  if (!demoAlreadySeeded) {
    const [pc] = await pool.query('SELECT COUNT(*) AS c FROM pipettes');
    if (pc[0].c === 0) {
      const today = new Date();
      const ago = (m) => {
        const d = new Date(today);
        d.setMonth(d.getMonth() - m);
        return d.toISOString().slice(0, 10);
      };

      const insPip = `INSERT INTO pipettes
        (id, serial, manufacturer, model, equipment_type, volume, department, \`interval\`,
         last_calibration, cert, last_result, active, responsible, location, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      await pool.query(insPip, ['P-001', 'EP2024001', 'Eppendorf', 'Research Plus', 'pipette', '1000', 'Гематологический отдел',
        12, ago(11), 'С-АБ-1234567/2025', 'pass', 1,
        'Иванова М.С.', 'Лаб. 201, шкаф 3', '']);

      await pool.query(insPip, ['P-002', 'EP2024002', 'Eppendorf', 'Research Plus', 'pipette', '100', 'Биохимический отдел',
        12, ago(10), 'С-АБ-1234568/2025', 'pass', 1,
        'Петров А.В.', 'Лаб. 201, шкаф 3', '']);

      await pool.query(insPip, ['P-003', 'GT2023005', 'Gilson', 'Pipetman L', 'pipette', '5000', 'Коагулогический отдел',
        6, ago(7), 'С-АБ-1234569/2025', 'pass', 1,
        'Иванова М.С.', 'Лаб. 105', 'Требует внеочередной проверки']);

      await pool.query(insPip, ['A-001', 'AN2022001', 'Mindray', 'BC-5150', 'analyzer', '', 'Гематологический отдел',
        12, ago(14), 'С-АБ-9876546/2024', 'pass', 1,
        'Сидорова Е.К.', 'Лаб. 302', 'Гематологический анализатор']);

      await pool.query(insPip, ['M-001', 'MI2023010', 'Olympus', 'CX23', 'microscope', '', 'Биохимический отдел',
        12, ago(2), 'С-АБ-1234570/2025', 'pass', 0,
        'Петров А.В.', 'Склад', 'Микроскоп в резерве']);

      const insHist = `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, org, note)
                       VALUES (?, ?, ?, ?, ?, ?)`;
      await pool.query(insHist, ['P-001', ago(23), 'С-АБ-9876543/2024', 'pass', 'ФБУ Красноярский ЦСМ', 'Годна']);
      await pool.query(insHist, ['P-001', ago(11), 'С-АБ-1234567/2025', 'pass', 'ФБУ Красноярский ЦСМ', 'Годна']);
      await pool.query(insHist, ['A-001', ago(14), 'С-АБ-9876546/2024', 'pass', 'ФБУ Красноярский ЦСМ', 'Годен']);
    }

    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ('demo_seeded', '1')
       ON DUPLICATE KEY UPDATE setting_value = '1'`
    );
  }

  // --- Фильтры по умолчанию ---
  const [filc] = await pool.query('SELECT COUNT(*) AS c FROM filter_config');
  if (filc[0].c === 0) {
    const insF = `INSERT INTO filter_config
      (id, label, type, field_id, enabled, options_source, filter_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)`;

    await pool.query(insF, ['status',        'Статус',           'select',      'status',           1, 'status_list',         1]);
    await pool.query(insF, ['equipmentType', 'Тип оборудования', 'select',      'equipment_type',   1, 'equipment_type_list', 2]);
    await pool.query(insF, ['department',    'Отдел',            'select',      'department',       1, 'departments',         3]);
    await pool.query(insF, ['responsible',   'Ответственный',    'text',        'responsible',      1, '',                    4]);
    await pool.query(insF, ['model',         'Модель',           'text',        'model',            1, '',                    5]);
    await pool.query(insF, ['manufacturer',  'Производитель',    'text',        'manufacturer',     1, '',                    6]);
    await pool.query(insF, ['active',        'Активность',       'select',      'active',           1, 'active_list',         7]);
    await pool.query(insF, ['calPeriod',     'Дата поверки',     'date-period', 'last_calibration', 1, '',                    8]);
  }

  // 🆕 Справка
  const [hc] = await pool.query('SELECT COUNT(*) AS c FROM help_docs');
  if (hc[0].c === 0) {
    await seedHelpDocs();
    console.log('📖 Справка инициализирована');
  }

  return seededAny;
}

module.exports = { seedInitialData, seedHelpDocs, generatePipetteId };
