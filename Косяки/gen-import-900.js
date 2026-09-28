// gen-import-900.js — 900 записей: КДЛ / ГИМИ / БАК по 300
// Запуск: node gen-import-900.js
// Результат: test-import-900.xlsx

const ExcelJS = require('exceljs');

// ─── Отделы и их ответственные ──────────────────────────────
const DEPTS = [
  { name: 'КДЛ',  resp: 'Сайфулина АР', prefix: 'КДЛ'  },
  { name: 'ГИМИ', resp: 'Овсеева ОИ',   prefix: 'ГИМИ' },
  { name: 'БАК',  resp: 'Иванова ИС',   prefix: 'БАК'  },
];

// ─── Справочник оборудования ────────────────────────────────
const EQUIP = [
  { brand: 'Eppendorf', model: 'Research Plus', type: 'Пипетка',    volumes: ['10','20','100','200','1000','5000'] },
  { brand: 'Eppendorf', model: 'Reference 2',   type: 'Пипетка',    volumes: ['10','100','200','1000','5000'] },
  { brand: 'Eppendorf', model: 'Xplorer',       type: 'Пипетка',    volumes: ['10','20','100','200','1000'] },
  { brand: 'Gilson',    model: 'Pipetman L',    type: 'Пипетка',    volumes: ['20','200','1000'] },
  { brand: 'Gilson',    model: 'Pipetman P',    type: 'Пипетка',    volumes: ['20','200','1000'] },
  { brand: 'Biohit',    model: 'mLine',         type: 'Пипетка',    volumes: ['50','100','500'] },
  { brand: 'Biohit',    model: 'Proline',       type: 'Пипетка',    volumes: ['50','100','500'] },
  { brand: 'Mindray',   model: 'BS-240',        type: 'Анализатор', volumes: [] },
  { brand: 'Mindray',   model: 'BS-430',        type: 'Анализатор', volumes: [] },
  { brand: 'Mindray',   model: 'BC-5150',       type: 'Анализатор', volumes: [] },
  { brand: 'Roche',     model: 'Cobas e411',    type: 'Анализатор', volumes: [] },
  { brand: 'Roche',     model: 'Cobas c311',    type: 'Анализатор', volumes: [] },
  { brand: 'Testo',     model: 'Testo 108',     type: 'Термометр',  volumes: [] },
  { brand: 'Testo',     model: 'Testo 720',     type: 'Термометр',  volumes: [] },
  { brand: 'ТермоЛаб',  model: 'ТЛ-100',        type: 'Термометр',  volumes: [] },
  { brand: 'ТермоЛаб',  model: 'ТЛ-200',        type: 'Термометр',  volumes: [] },
  { brand: 'ТермоЛаб',  model: 'ТЛ-500',        type: 'Термометр',  volumes: [] },
  { brand: 'Mettler',   model: 'ME204',         type: 'Весы',       volumes: [] },
  { brand: 'Mettler',   model: 'ML204',         type: 'Весы',       volumes: [] },
  { brand: 'Mettler',   model: 'XS205',         type: 'Весы',       volumes: [] },
  { brand: 'Sartorius', model: 'Secura 224',    type: 'Весы',       volumes: [] },
  { brand: 'Sartorius', model: 'Quintix 124',   type: 'Весы',       volumes: [] },
  { brand: 'Olympus',   model: 'CX23',          type: 'Микроскоп',  volumes: [] },
  { brand: 'Olympus',   model: 'CX43',          type: 'Микроскоп',  volumes: [] },
  { brand: 'Olympus',   model: 'BX43',          type: 'Микроскоп',  volumes: [] },
  { brand: 'Микромед',  model: 'Р-1',           type: 'Микроскоп',  volumes: [] },
  { brand: 'Микромед',  model: 'С-1',           type: 'Микроскоп',  volumes: [] },
  { brand: 'Hach',      model: 'DR1900',        type: 'Фотометр',   volumes: [] },
  { brand: 'Hach',      model: 'DR3900',        type: 'Фотометр',   volumes: [] },
  { brand: 'Hach',      model: '2100Q',         type: 'Фотометр',   volumes: [] },
];

const LOCATIONS = ['Лаб. 101','Лаб. 105','Лаб. 201','Лаб. 202',
                   'Лаб. 302','Лаб. 401','Регистратура','Склад'];

// ─── План статусов на 300 строк в отделе ─────────────────────
//   ok     → «Годен», активна, следующая поверка > сегодня
//   soon   → «Годен», активна, следующая поверка в пределах 30 дней
//   danger → «Годен», активна, следующая поверка в прошлом
//   fail   → «Брак»
//   wip    → «В процессе»
//   inactive → «Годен», но неактивна
const PLAN_300 = [
  ...Array(200).fill({ result: 'Годен',      active: 'Да',  dc: 'ok'     }),
  ...Array( 25).fill({ result: 'Годен',      active: 'Да',  dc: 'soon'   }),
  ...Array( 35).fill({ result: 'Годен',      active: 'Да',  dc: 'danger' }),
  ...Array( 15).fill({ result: 'Брак',       active: 'Да',  dc: 'ok'     }),
  ...Array( 10).fill({ result: 'В процессе', active: 'Да',  dc: 'ok'     }),
  ...Array( 15).fill({ result: 'Годен',      active: 'Нет', dc: 'ok'     }),
];

// ─── Даты по категориям (ISO) ────────────────────────────────
const D_OK     = ['2025-11-15','2026-01-20','2026-03-10','2026-05-05','2026-07-18'];
const D_SOON   = ['2025-09-28','2025-10-05','2025-10-15'];
const D_DANGER = ['2024-02-10','2024-06-22','2025-03-15','2025-07-01'];

// ─── Утилиты ─────────────────────────────────────────────────
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const pad  = (n, len) => String(n).padStart(len, '0');
const pickDate = dc => pick({ ok: D_OK, soon: D_SOON, danger: D_DANGER }[dc]);

// Детерминированный shuffle с seed (чтобы результат повторялся)
function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Генерация ───────────────────────────────────────────────
async function generate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pipette App Test 900';
  wb.created = new Date();

  const ws = wb.addWorksheet('Оборудование', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // ─── Шапка (16 колонок, «Инв.№» — вторая) ──────────────────
  ws.columns = [
    { header: 'ID',               key: 'id',           width: 14 },
    { header: 'Инв.№',            key: 'inv',          width: 14 },
    { header: 'Серийный номер',   key: 'serial',       width: 16 },
    { header: 'Производитель',    key: 'manufacturer', width: 16 },
    { header: 'Модель',           key: 'model',        width: 20 },
    { header: 'Тип оборудования', key: 'equipmentType',width: 18 },
    { header: 'Объём (мкл)',      key: 'volume',       width: 12 },
    { header: 'Отдел',            key: 'department',   width: 12 },
    { header: 'МПИ',              key: 'interval',     width: 8  },
    { header: 'Дата поверки',     key: 'lastCalibration', width: 14 },
    { header: 'Свидетельство',    key: 'cert',         width: 22 },
    { header: 'Результат',        key: 'result',       width: 14 },
    { header: 'Статус',           key: 'active',       width: 10 },
    { header: 'Ответственный',    key: 'responsible',  width: 18 },
    { header: 'Место хранения',   key: 'location',     width: 16 },
    { header: 'Примечание',       key: 'notes',        width: 24 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell(cell => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left:   { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right:  { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  // ─── Данные: 3 отдела × 300 ─────────────────────────────────
  let globalSn   = 0;   // SN-сквозной
  let globalCert = 0;   // № свидетельства

  DEPTS.forEach((dept, dIdx) => {
    const plan = seededShuffle(PLAN_300, 1000 + dIdx);

    for (let i = 1; i <= 300; i++) {
      globalSn++;
      const eq  = EQUIP[(i - 1) % EQUIP.length];
      const vol = eq.volumes.length ? pick(eq.volumes) : '';
      const loc = LOCATIONS[(i - 1) % LOCATIONS.length];
      const mpi = pick([6, 12, 12, 24]);

      const { result, active, dc } = plan[i - 1];
      const date = pickDate(dc);

      // Свидетельство — 85% заполнено для «Годен», пустое для «Брак»/«В процессе»
      let cert = '';
      if (result === 'Годен' && Math.random() < 0.85) {
        globalCert++;
        cert = `С-АБ-${pad(globalCert, 6)}/${date.slice(0, 4)}`;
      } else if (result !== 'Годен' && Math.random() < 0.20) {
        globalCert++;
        cert = `С-АБ-${pad(globalCert, 6)}/${date.slice(0, 4)}`;
      }

      // ID — 30% с явным, 70% без (проверка автогенерации)
      const expId = Math.random() < 0.30 ? `TEST-${dept.prefix}-${pad(i, 4)}` : '';
      const inv   = `${dept.prefix}-${pad(i, 4)}`;
      const sn    = `SN-${pad(globalSn, 6)}`;
      const notes = i % 25 === 0 ? 'Нагрузочный тест' : '';

      ws.addRow({
        id:               expId,
        inv,
        serial:           sn,
        manufacturer:     eq.brand,
        model:            eq.model,
        equipmentType:    eq.type,
        volume:           vol,
        department:       dept.name,
        interval:         mpi,
        lastCalibration:  date,
        cert,
        result,
        active,
        responsible:      dept.resp,
        location:         loc,
        notes,
      });
    }
  });

  // ─── Стилизация данных ──────────────────────────────────────
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    row.height = 18;
    row.eachCell((cell, colNumber) => {
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        top:    { style: 'hair', color: { argb: 'FFE2E8F0' } },
        left:   { style: 'hair', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        right:  { style: 'hair', color: { argb: 'FFE2E8F0' } },
      };

      // Зебра
      if (rowNumber % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }

      // Центрирование: ID, Инв.№, Объём, МПИ, Статус
      if ([1, 2, 7, 9, 13].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }

      // Подсветка результата (столбец 12)
      if (colNumber === 12) {
        if (cell.value === 'Брак') {
          cell.font = { bold: true, color: { argb: 'FF991B1B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        } else if (cell.value === 'В процессе') {
          cell.font = { color: { argb: 'FF854D0E' } };
        } else if (cell.value === 'Годен') {
          cell.font = { color: { argb: 'FF166534' } };
        }
      }

      // Подсветка статуса «Нет» (столбец 13)
      if (colNumber === 13 && cell.value === 'Нет') {
        cell.font = { color: { argb: 'FF94A3B8' } };
      }
    });
  });

  // ─── Автофильтр ─────────────────────────────────────────────
  ws.autoFilter = { from: 'A1', to: `P901` };  // 16 колонок → P

  // ─── Лист «Сводка» ──────────────────────────────────────────
  const ws2 = wb.addWorksheet('Сводка');
  ws2.columns = [
    { header: 'Параметр', key: 'param', width: 34 },
    { header: 'Значение', key: 'value', width: 28 },
  ];
  ws2.getRow(1).font = { bold: true };

  ws2.addRow({ param: 'Всего записей',              value: 900 });
  ws2.addRow({ param: 'КДЛ',                        value: '300 (отв. Сайфулина АР)' });
  ws2.addRow({ param: 'ГИМИ',                       value: '300 (отв. Овсеева ОИ)' });
  ws2.addRow({ param: 'БАК',                        value: '300 (отв. Иванова ИС)' });
  ws2.addRow({ param: 'С явным ID (TEST-XXXX)',     value: '~270 (30%)' });
  ws2.addRow({ param: 'Без ID (автогенерация)',     value: '~630 (70%)' });
  ws2.addRow({ param: 'Столбцов',                   value: '16 (добавлен «Инв.№»)' });
  ws2.addRow({ param: 'Форматы даты',               value: 'ISO (YYYY-MM-DD)' });
  ws2.addRow({ param: 'Статусов на отдел',          value: '200 годен / 25 скоро / 35 просрочка / 15 брак / 10 процесс / 15 неактивна' });

  // ─── Сохранение ─────────────────────────────────────────────
  await wb.xlsx.writeFile('test-import-900.xlsx');
  console.log('✅ Создан файл: test-import-900.xlsx');
  console.log('   Записей:  900 (3 × 300)');
  console.log('   Колонок:  16 (добавлен «Инв.№»)');
  console.log('   Отделы:   КДЛ / ГИМИ / БАК — по 300');
  console.log('   Отв.:     Сайфулина АР / Овсеева ОИ / Иванова ИС');
}

generate().catch(err => {
  console.error('❌ Ошибка:', err);
  process.exit(1);
});
