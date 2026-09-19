const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// КАРТА ЗАГОЛОВКОВ
// ============================================================
const HEADER_MAP = {
  'id': 'id', 'внутренний номер': 'id', 'инвентарный номер': 'id',
  'инв. номер': 'id', 'инв номер': 'id', 'номер': 'id', '№': 'id',

  'serial': 'serial', 'серийный номер': 'serial', 'серийный': 'serial',
  's/n': 'serial', 'sn': 'serial', 'заводской номер': 'serial',

  'manufacturer': 'manufacturer', 'производитель': 'manufacturer', 'фирма': 'manufacturer',
  'марка': 'manufacturer', 'бренд': 'manufacturer',

  'model': 'model', 'модель': 'model', 'наименование': 'model',
  'название': 'model', 'оборудование': 'model',

  'equipmenttype': 'equipmentType', 'equipment_type': 'equipmentType',
  'тип оборудования': 'equipmentType', 'тип': 'equipmentType',
  'категория': 'equipmentType',

  'volume': 'volume', 'объём': 'volume', 'объем': 'volume', 'объём (мкл)': 'volume',
  'объем (мкл)': 'volume', 'номинал': 'volume', 'диапазон': 'volume',

  'department': 'department', 'отдел': 'department', 'подразделение': 'department',
  'лаборатория': 'department',

  'interval': 'interval', 'мпи': 'interval', 'межповерочный интервал': 'interval',
  'интервал': 'interval', 'периодичность': 'interval',

  'lastcalibration': 'lastCalibration', 'дата поверки': 'lastCalibration',
  'дата последней поверки': 'lastCalibration', 'дата последней проверки': 'lastCalibration',
  'поверка': 'lastCalibration',

  'cert': 'cert', 'свидетельство': 'cert', 'номер свидетельства': 'cert',
  'сертификат': 'cert',

  'result': 'result', 'результат': 'result', 'результат поверки': 'result',
  'итог': 'result',

  'active': 'active', 'статус': 'active', 'активность': 'active',
  'состояние': 'active', 'эксплуатация': 'active',

  'responsible': 'responsible', 'ответственный': 'responsible',
  'ответственный сотрудник': 'responsible', 'мол': 'responsible',
  'пользователь': 'responsible',

  'location': 'location', 'место': 'location', 'место хранения': 'location',
  'расположение': 'location', 'кабинет': 'location',

  'notes': 'notes', 'примечание': 'notes', 'примечания': 'notes',
  'комментарий': 'notes', 'комментарии': 'notes'
};

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[«»"'`]/g, '');
}

function mapHeader(h) {
  const n = normalizeHeader(h);
  if (HEADER_MAP[n]) return HEADER_MAP[n];
  const n2 = n.replace(/\(.*?\)/g, '').trim();
  return HEADER_MAP[n2] || null;
}

// ============================================================
// ПАРСЕРЫ ЗНАЧЕНИЙ
// ============================================================

// exceljs возвращает Date для дат; строку для текста; число для чисел
function parseDate(val) {
  if (val === undefined || val === null || val === '') return '';
  if (val instanceof Date) {
    const d = val;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const s = String(val).trim();

  let m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  return '';
}

function normalizeResult(val) {
  if (!val) return 'pass';
  const s = String(val).trim().toLowerCase();
  if (/годен|годна|pass|ок|ok|год|✅/.test(s)) return 'pass';
  if (/брак|fail|не\s*год|негод|❌|дефект/.test(s)) return 'fail';
  if (/процесс|wip|ожидан|⏳/.test(s)) return 'wip';
  return 'pass';
}

async function normalizeEquipmentType(val) {
  if (!val) return 'pipette';
  const s = String(val).trim().toLowerCase();

  // 1. Проверяем кастомные типы из настроек
  try {
    const [rows] = await db.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'equipment_types'"
    );
    if (rows.length && rows[0].setting_value) {
      const types = JSON.parse(rows[0].setting_value);
      const found = types.find(t =>
        t.value.toLowerCase() === s || (t.label || '').toLowerCase() === s
      );
      if (found) return found.value;
    }
  } catch (e) { /* fallback ниже */ }

  // 2. Стандартные эвристики
  if (/пипет|дозатор|pipette|pipet/.test(s)) return 'pipette';
  if (/анализатор|analyzer/.test(s)) return 'analyzer';
  if (/термометр|thermometer/.test(s)) return 'thermometer';
  if (/весы|scales|balance/.test(s)) return 'scales';
  if (/фотометр|photometer/.test(s)) return 'photometer';
  return 'pipette';
}

function normalizeActive(val) {
  if (val === undefined || val === null || val === '') return 1;
  if (val === true || val === 1) return 1;
  if (val === false || val === 0) return 0;
  const s = String(val).trim().toLowerCase();
  if (/^(да|yes|true|1|активно|в работе|эксплуатация|используется|✅)/.test(s)) return 1;
  if (/^(нет|no|false|0|неактивно|списан|не используется|в резерве|⛔)/.test(s)) return 0;
  return 1;
}

function parseInterval(val) {
  if (!val) return 12;
  const s = String(val).replace(/[^\d]/g, '');
  const n = parseInt(s, 10);
  return n > 0 ? n : 12;
}

// ============================================================
// ВСПОМОГАТЕЛЬНОЕ: получить «чистое» значение ячейки exceljs
// ============================================================
function cellValue(cell) {
  if (!cell || cell.value === undefined || cell.value === null) return '';
  const v = cell.value;

  // Формула / rich text / гиперссылка — объект
  if (typeof v === 'object' && v !== null) {
    if (v.result !== undefined) return v.result;                     // формула → её результат
    if (v.richText) return v.richText.map(r => r.text).join('');      // rich text
    if (v.text !== undefined) return v.text;                          // гиперссылка
    if (v.hyperlink) return v.text || v.hyperlink;
    return '';
  }
  return v;
}

// ============================================================
// ПАРСЕРЫ ПО ФОРМАТАМ
// ============================================================

// --- XLSX / XLS через exceljs ---
async function parseXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Файл не содержит листов');

  const headers = [];
  const objects = [];

  // Первая строка — заголовки
  const firstRow = sheet.getRow(1);
  if (!firstRow) throw new Error('Пустой файл');
  const colCount = firstRow.cellCount;
  for (let i = 1; i <= colCount; i++) {
    headers.push(String(cellValue(firstRow.getCell(i)) || '').trim());
  }
  if (headers.length === 0) throw new Error('Пустой файл');

  // Остальные строки — данные
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (!row || row.cellCount === 0) continue;

    const obj = {};
    let isEmpty = true;

    for (let c = 1; c <= headers.length; c++) {
      const h = headers[c - 1];
      if (!h) continue;
      const val = cellValue(row.getCell(c));
      if (val !== '' && val !== undefined && val !== null) isEmpty = false;
      obj[h] = val;
    }

    if (isEmpty) continue;
    objects.push(obj);
  }

  return { headers, objects };
}

// --- CSV / TXT (без внешних библиотек) ---
function parseCsv(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('Пустой файл');

  const firstLine = lines[0];
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of firstLine) if (counts[ch] !== undefined) counts[ch]++;
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  const splitCsvLine = (line) => {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === sep && !inQ) {
        result.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur);
    return result.map(s => s.trim().replace(/^"|"$/g, ''));
  };

  const headers = splitCsvLine(lines[0]);
  const objects = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCsvLine(lines[i]);
    if (vals.every(v => !v)) continue;
    const obj = {};
    headers.forEach((h, j) => obj[h] = vals[j] || '');
    objects.push(obj);
  }

  return { headers, objects };
}

// --- JSON ---
function parseJson(buffer) {
  const parsed = JSON.parse(buffer.toString('utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('JSON должен содержать массив объектов');
  }
  const headers = parsed.length ? Object.keys(parsed[0]) : [];
  return { headers, objects: parsed };
}

// ============================================================
// ИМПОРТ
// ============================================================
router.post('/', authenticate, requirePermission('import_data'), async (req, res) => {
  try {
    const { file, filename } = req.body;
    if (!file) return res.status(400).json({ error: 'Файл не передан' });

    const buffer = Buffer.from(file, 'base64');
    const ext = (filename || '').toLowerCase().split('.').pop();

    let headers = [];
    let objects = [];

    if (ext === 'json') {
      ({ headers, objects } = parseJson(buffer));
    } else if (ext === 'csv' || ext === 'txt') {
      ({ headers, objects } = parseCsv(buffer));
    } else {
      // xlsx / xls — через exceljs
      ({ headers, objects } = await parseXlsx(buffer));
    }

    if (!objects.length) {
      return res.status(400).json({ error: 'Не найдено ни одной строки данных' });
    }

    const colMap = headers.map(h => mapHeader(h));
    const mappedCount = colMap.filter(Boolean).length;

    if (mappedCount === 0) {
      return res.status(400).json({
        error: 'Не удалось распознать ни одного столбца. Проверьте заголовки.',
        headers: headers
      });
    }

    const added = [], skipped = [], errors = [];

    for (let i = 0; i < objects.length; i++) {
      const raw = objects[i];
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        const key = colMap[j];
        if (key) {
          const v = raw[headers[j]];
          if (v !== undefined && v !== null && v !== '') obj[key] = v;
        }
      }

      let id = String(obj.id || '').trim();
      const model = String(obj.model || '').trim();

      if (!id && !model) continue;

     if (!model) {
  skipped.push(`Строка ${i + 2}: не указана модель`);
  continue;
}

// Если ID указан — проверяем на дубль
if (id) {
  const [ex] = await db.query('SELECT id FROM pipettes WHERE id = ?', [id]);
  if (ex.length) { skipped.push(`${id}: ID уже существует`); continue; }
} else {
  // ─── Автогенерация ID ───
  const eqType = await normalizeEquipmentType(obj.equipmentType);
  let prefix = null;

  try {
    const [rows] = await db.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'equipment_types'"
    );
    if (rows.length && rows[0].setting_value) {
      const types = JSON.parse(rows[0].setting_value);
      const found = types.find(t => t.value === eqType);
      if (found && found.prefix && found.prefix.trim()) {
        prefix = found.prefix.trim().toUpperCase();
      }
    }
  } catch (e) { /* игнорируем, будет fallback */ }

  if (!prefix) {
    const fallback = {
      pipette: 'P', analyzer: 'A', thermometer: 'T',
      scales: 'S', photometer: 'F'
    };
    prefix = fallback[eqType] || 'EQ';
  }

  id = await db.generatePipetteId(prefix);
}

      try {
        const [ex] = await db.query('SELECT id FROM pipettes WHERE id = ?', [id]);
        if (ex.length) { skipped.push(`${id}: уже существует`); continue; }

        const lastCal = parseDate(obj.lastCalibration);
        const result = normalizeResult(obj.result);

        await db.query(
          `INSERT INTO pipettes
            (id, serial, manufacturer, model, equipment_type, volume, department, \`interval\`,
             last_calibration, cert, last_result, active, responsible, location, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            String(obj.serial || '').trim(),
            String(obj.manufacturer || '').trim(),
            model,
            await normalizeEquipmentType(obj.equipmentType),
            String(obj.volume || '').trim(),
            String(obj.department || '').trim(),
            parseInterval(obj.interval),
            lastCal,
            String(obj.cert || '').trim(),
            result,
            normalizeActive(obj.active),
            String(obj.responsible || '').trim(),
            String(obj.location || '').trim(),
            String(obj.notes || '').trim()
          ]
        );

        if (lastCal) {
          await db.query(
            `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, note)
             VALUES (?, ?, ?, ?, ?)`,
            [id, lastCal, String(obj.cert || '').trim(), result, 'Импорт из файла']
          );
        }

        added.push(id);
      } catch (e) {
        errors.push(`${id}: ${e.message}`);
      }
    }

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Импорт из файла',
       `${filename || 'файл'}: добавлено ${added.length}, пропущено ${skipped.length}, ошибок ${errors.length}`]
    );

    res.json({
      message: `Импортировано: ${added.length}`,
      added: added.length,
      skipped: skipped.length,
      errors: errors.length,
      skippedDetails: skipped.slice(0, 30),
      errorDetails: errors.slice(0, 30),
      recognizedFields: colMap.filter(Boolean).length,
      totalColumns: headers.length
    });
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: 'Ошибка импорта: ' + e.message });
  }
});

module.exports = router;
