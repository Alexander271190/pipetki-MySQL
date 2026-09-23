// gen-import-xlsx.js — генератор тестового XLSX-файла для проверки импорта
// Запуск: node gen-import-xlsx.js 1000

const ExcelJS = require('exceljs');

const count = parseInt(process.argv[2], 10) || 500;
const filename = `test-import-${count}.xlsx`;

const TYPES = [
  { value: 'Пипетка',    brand: 'Eppendorf', models: ['Research Plus', 'Reference 2', 'Xplorer'], volumes: ['10', '20', '100', '200', '1000', '5000'] },
  { value: 'Пипетка',    brand: 'Gilson',    models: ['Pipetman L', 'Pipetman P'],               volumes: ['20', '200', '1000'] },
  { value: 'Пипетка',    brand: 'Biohit',    models: ['mLine', 'Proline'],                       volumes: ['50', '100', '500'] },
  { value: 'Анализатор', brand: 'Mindray',   models: ['BC-5150', 'BS-240', 'BS-430'],            volumes: [] },
  { value: 'Анализатор', brand: 'Roche',     models: ['Cobas c311', 'Cobas e411'],               volumes: [] },
  { value: 'Термометр',  brand: 'ТермоЛаб',  models: ['ТЛ-100', 'ТЛ-200', 'ТЛ-500'],             volumes: [] },
  { value: 'Термометр',  brand: 'Testo',     models: ['Testo 108', 'Testo 720'],                 volumes: [] },
  { value: 'Весы',       brand: 'Mettler',   models: ['XS205', 'ML204', 'ME204'],                volumes: [] },
  { value: 'Весы',       brand: 'Sartorius', models: ['Secura 224', 'Quintix 124'],              volumes: [] },
  { value: 'Фотометр',   brand: 'Hach',      models: ['2100Q', 'DR3900', 'DR1900'],              volumes: [] },
  { value: 'Микроскоп',  brand: 'Olympus',   models: ['CX23', 'CX43', 'BX43'],                   volumes: [] },
  { value: 'Микроскоп',  brand: 'Микромед',  models: ['С-1', 'Р-1'],                            volumes: [] },
];

const DEPARTMENTS = [
  'Гематологический отдел',
  'Биохимический отдел',
  'Коагулогический отдел',
  'Экспресс отдел',
  'Изосерологический отдел',
  'Серологический отдел',
  'ГИМИ',
  'Бактериологический отдел',
];

const RESPONSIBLES = [
  'Иванов И.И.', 'Петров П.П.', 'Сидоров С.С.', 'Иванова М.С.',
  'Петров А.В.', 'Сидорова Е.К.', 'Кузнецов К.К.', 'Орлов О.О.',
  'Тестов Т.Т.', 'Русский Р.Р.', 'Смирнова А.А.', 'Морозов Д.Д.',
];

const LOCATIONS = [
  'Лаб. 201', 'Лаб. 202', 'Лаб. 105', 'Лаб. 302',
  'Лаб. 101', 'Лаб. 401', 'Склад', 'Регистратура',
];

const RESULTS = ['Годен','Годен','Годен','Годен','Годен','Годен','Годен','Брак','В процессе'];
const ACTIVES = ['Да','Да','Да','Да','Нет'];

function randomDate() {
  const start = new Date();
  start.setFullYear(start.getFullYear() - 3);
  const end = new Date();
  const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  const r = Math.random();
  if (r < 0.30) return `${y}-${m}-${day}`;
  if (r < 0.65) return `${day}.${m}.${y}`;
  return `${m}.${day}.${y}`;
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pad = (n, len) => String(n).padStart(len, '0');

async function generate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pipette App Test';
  wb.created = new Date();

  const ws = wb.addWorksheet('Оборудование', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: 'ID',                    key: 'id',         width: 14 },
    { header: 'Серийный номер',        key: 'serial',     width: 16 },
    { header: 'Производитель',         key: 'manufacturer', width: 16 },
    { header: 'Модель',                key: 'model',      width: 20 },
    { header: 'Тип оборудования',      key: 'equipmentType', width: 18 },
    { header: 'Объём (мкл)',           key: 'volume',     width: 12 },
    { header: 'Отдел',                 key: 'department', width: 24 },
    { header: 'МПИ',                   key: 'interval',   width: 8 },
    { header: 'Дата поверки',          key: 'lastCalibration', width: 14 },
    { header: 'Свидетельство',         key: 'cert',       width: 18 },
    { header: 'Результат',             key: 'result',     width: 14 },
    { header: 'Статус',                key: 'active',     width: 10 },
    { header: 'Ответственный',         key: 'responsible', width: 18 },
    { header: 'Место хранения',        key: 'location',   width: 16 },
    { header: 'Примечание',            key: 'notes',      width: 24 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell(cell => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border    = {
      top:    { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left:   { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right:  { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  for (let i = 1; i <= count; i++) {
    const t = pick(TYPES);
    const model = pick(t.models);
    const vol = t.volumes.length ? pick(t.volumes) : '';

    const useExplicitId = Math.random() < 0.30;
    const id = useExplicitId ? `TEST-${pad(i, 4)}` : '';

    const date = randomDate();
    const yearForCert = date.match(/(\d{4})/g)?.pop() || new Date().getFullYear();
    const cert = Math.random() < 0.85
      ? `С-АБ-${pad(i, 6)}/${yearForCert}`
      : '';

    const notes = i % 25 === 0 ? 'Нагрузочный тест' : '';

    ws.addRow({
      id,
      serial: `SN-${pad(i, 6)}`,
      manufacturer: t.brand,
      model,
      equipmentType: t.value,
      volume: vol,
      department: pick(DEPARTMENTS),
      interval: pick([6, 12, 12, 12, 24]),
      lastCalibration: date,
      cert,
      result: pick(RESULTS),
      active: pick(ACTIVES),
      responsible: pick(RESPONSIBLES),
      location: pick(LOCATIONS),
      notes,
    });
  }

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
      if (rowNumber % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
      if ([1, 6, 8, 12].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
      if (colNumber === 11 && cell.value === 'Брак') {
        cell.font = { bold: true, color: { argb: 'FF991B1B' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      }
      if (colNumber === 11 && cell.value === 'В процессе') {
        cell.font = { color: { argb: 'FF854D0E' } };
      }
      if (colNumber === 11 && cell.value === 'Годен') {
        cell.font = { color: { argb: 'FF166534' } };
      }
      if (colNumber === 12 && cell.value === 'Нет') {
        cell.font = { color: { argb: 'FF94A3B8' } };
      }
    });
  });

  ws.autoFilter = {
    from: 'A1',
    to:   `O${count + 1}`,
  };

  const ws2 = wb.addWorksheet('Сводка');
  ws2.columns = [
    { header: 'Параметр', key: 'param', width: 30 },
    { header: 'Значение', key: 'value', width: 20 },
  ];
  ws2.getRow(1).font = { bold: true };
  ws2.addRow({ param: 'Всего записей',          value: count });
  ws2.addRow({ param: 'С явным ID (TEST-XXXX)', value: Math.round(count * 0.30) });
  ws2.addRow({ param: 'Без ID (автогенерация)', value: Math.round(count * 0.70) });

  await wb.xlsx.writeFile(filename);
  console.log(`✅ Создан файл: ${filename}`);
  console.log(`   Записей: ${count}`);
  console.log(`   Колонок: 15`);
  console.log(`   Формат: Excel (XLSX)`);
}

// 👇 ЭТА СТРОКА ОБЯЗАТЕЛЬНА! Без неё скрипт ничего не сделает
generate().catch(err => {
  console.error('❌ Ошибка:', err);
  process.exit(1);
});
