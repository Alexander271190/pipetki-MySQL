const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const { withTransaction } = require('../utils/db-helper');

const router = express.Router();

// ============================================================
// КАРТА ЗАГОЛОВКОВ (не менялась)
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
    .replace(/[«»"'`]/g, '')
    .replace(/[.:;]+$/g, '');
}

function mapHeader(h, customFields = []) {
  const n = normalizeHeader(h);
  if (HEADER_MAP[n]) return HEADER_MAP[n];
  const n2 = n.replace(/\(.*?\)/g, '').trim();
  if (HEADER_MAP[n2]) return HEADER_MAP[n2];

  if (Array.isArray(customFields) && customFields.length > 0) {
    const found = customFields.find(f =>
      normalizeHeader(f.label) === n || f.id === n
    );
    if (found) return `custom:${found.id}`;
  }
  return null;
}

// ============================================================
// ПАРСЕРЫ ЗНАЧЕНИЙ (не менялись)
// ============================================================
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
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
    const g1 = parseInt(m[1], 10);
    const g2 = parseInt(m[2], 10);
    if (g2 > 12 && g1 <= 12) {
      return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
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
  if (/брак|fail|не\s*год|негод|❌|дефект/.test(s)) return 'fail';
  if (/процесс|wip|ожидан|⏳/.test(s)) return 'wip';
  if (/годен|годна|pass|ок|ok|год|✅/.test(s)) return 'pass';
  return 'pass';
}

function normalizeEquipmentTypeCached(val, typesCache) {
  if (!val) return 'pipette';
  const s = String(val).trim().toLowerCase();
  const found = (typesCache || []).find(t =>
    (t.value || '').toLowerCase() === s || (t.label || '').toLowerCase() === s
  );
  if (found) return found.value;
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

function cellValue(cell) {
  if (!cell || cell.value === undefined || cell.value === null) return '';
  const v = cell.value;
  if (typeof v === 'object' && v !== null) {
    if (v.result !== undefined) return v.result;
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text !== undefined) return v.text;
    if (v.hyperlink) return v.text || v.hyperlink;
    return '';
  }
  return v;
}

// ============================================================
// ПАРСЕРЫ ФАЙЛОВ (не менялись)
// ============================================================
async function parseXlsx(buffer, customFields = []) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Файл не содержит листов');

  let headerRowNum = 0;
  let bestScore = 0;
  const MAX_SCAN = Math.min(sheet.rowCount, 20);

  for (let r = 1; r <= MAX_SCAN; r++) {
    const row = sheet.getRow(r);
    if (!row || row.cellCount === 0) continue;
    let score = 0;
    for (let c = 1; c <= row.cellCount; c++) {
      const v = cellValue(row.getCell(c));
      if (v === '' || v === undefined || v === null) continue;
      if (mapHeader(v, customFields)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      headerRowNum = r;
    }
  }

  if (bestScore < 2) {
    throw new Error('Не удалось распознать ни одного столбца. Проверьте заголовки.');
  }

  const headerRow = sheet.getRow(headerRowNum);
  const headers = [];
  const colCount = headerRow.cellCount;
  for (let i = 1; i <= colCount; i++) {
    headers.push(String(cellValue(headerRow.getCell(i)) || '').trim());
  }

  const objects = [];
  for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
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

    const idKey    = headers.find(h => mapHeader(h, customFields) === 'id');
    const modelKey = headers.find(h => mapHeader(h, customFields) === 'model');
    const idVal    = idKey    ? String(obj[idKey] || '').trim()    : '';
    const modelVal = modelKey ? String(obj[modelKey] || '').trim() : '';
    if (/Документ сформировал|Подпись/i.test(idVal))    continue;
    if (/Документ сформировал|Подпись/i.test(modelVal)) continue;
    if (idVal && modelVal && idVal === modelVal)        continue;

    objects.push(obj);
  }

  return { headers, objects };
}

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

    // Кастомные поля
    let customFields = [];
    try {
      const [fRows] = await db.query('SELECT id, label FROM field_config WHERE enabled = 1');
      const standardIds = new Set([
        'id','serial','manufacturer','model','equipmentType','volume',
        'department','interval','lastCalibration','cert','result','active',
        'responsible','location','notes'
      ]);
      customFields = fRows.filter(f => !standardIds.has(f.id));
    } catch (e) { customFields = []; }

    // Парсинг
    let headers = [];
    let objects = [];
    try {
      if (ext === 'json') {
        ({ headers, objects } = parseJson(buffer));
      } else if (ext === 'csv' || ext === 'txt') {
        ({ headers, objects } = parseCsv(buffer));
      } else {
        ({ headers, objects } = await parseXlsx(buffer, customFields));
      }
    } catch (parseErr) {
      console.warn('Import parse error:', parseErr.message);
      let friendly = parseErr.message;
      if (/not valid JSON|Unexpected token|Expected property name|in JSON at position/i.test(parseErr.message)) {
        friendly = 'Файл повреждён или не является корректным JSON';
      } else if (/zip file|central directory/i.test(parseErr.message)) {
        friendly = 'Файл повреждён или не является корректным XLSX';
      } else if (/Пустой файл/i.test(parseErr.message)) {
        friendly = 'Файл пуст или не содержит данных';
      }
      return res.status(400).json({ error: 'Ошибка импорта: ' + friendly });
    }

    if (!objects.length) {
      return res.status(400).json({ error: 'Не найдено ни одной строки данных' });
    }

    const colMap = headers.map(h => mapHeader(h, customFields));
    const mappedCount = colMap.filter(Boolean).length;
    if (mappedCount === 0) {
      return res.status(400).json({
        error: 'Не удалось распознать ни одного столбца. Проверьте заголовки.',
        headers
      });
    }

    const added = [], skipped = [], errors = [];

    // Типы
    let typesCache = [];
    try {
      const [typeRows] = await db.query(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'equipment_types'"
      );
      if (typeRows.length && typeRows[0].setting_value) {
        typesCache = db.safeParse(typeRows[0].setting_value, []);
      }
    } catch (e) { /* fallback */ }

    // ── Предварительная проверка ID ──
    const BATCH_SIZE = 50;
    const idHeaderIdx = headers.findIndex(h => mapHeader(h, customFields) === 'id');
    const declaredIds = [];
    const seenInFile = new Set();
    const validObjects = [];

    for (let i = 0; i < objects.length; i++) {
      const raw = objects[i];
      const idVal = idHeaderIdx >= 0 ? String(raw[headers[idHeaderIdx]] || '').trim() : '';
      if (!idVal) {
        validObjects.push({ raw, originalIdx: i });
        continue;
      }
      if (seenInFile.has(idVal)) {
        skipped.push(`${idVal}: дубль в файле (строка ${i + 2})`);
        continue;
      }
      seenInFile.add(idVal);
      declaredIds.push(idVal);
      validObjects.push({ raw, originalIdx: i });
    }

    const existingIds = new Set();
    if (declaredIds.length > 0) {
      for (let k = 0; k < declaredIds.length; k += 500) {
        const chunk = declaredIds.slice(k, k + 500);
        const ph = chunk.map(() => '?').join(',');
        const [rows] = await db.query(`SELECT id FROM pipettes WHERE id IN (${ph})`, chunk);
        rows.forEach(r => existingIds.add(r.id));
      }
    }

    const totalBatches = Math.ceil(validObjects.length / BATCH_SIZE);
    console.log(`📥 Импорт: ${validObjects.length} строк, ${totalBatches} батчей по ${BATCH_SIZE}`);

    for (let b = 0; b < totalBatches; b++) {
      const batchStart = b * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, validObjects.length);
      const batchEntries = validObjects.slice(batchStart, batchEnd);
      const batchStartTime = Date.now();

      // ── Этап 1: распарсить строки батча ──
      const parsed = [];
      const idGenQueue = new Map();

      for (const { raw, originalIdx } of batchEntries) {
        const obj = {};
        const customObj = {};
        for (let j = 0; j < headers.length; j++) {
          const key = colMap[j];
          if (!key) continue;
          const v = raw[headers[j]];
          if (v === undefined || v === null || v === '') continue;
          if (key.startsWith('custom:')) customObj[key.slice(7)] = v;
          else obj[key] = v;
        }

        let id = String(obj.id || '').trim();
        const model = String(obj.model || '').trim();

        if (!id && !model) continue;
        if (!model) { skipped.push(`Строка ${originalIdx + 2}: не указана модель`); continue; }
        if (id && existingIds.has(id)) { skipped.push(`${id}: ID уже существует`); continue; }

        const eqType = normalizeEquipmentTypeCached(obj.equipmentType, typesCache);

        let prefix = null;
        if (!id) {
          const found = (typesCache || []).find(t => t.value === eqType);
          if (found && found.prefix && found.prefix.trim()) {
            prefix = found.prefix.trim().toUpperCase();
          }
          if (!prefix) {
            const fallback = {
              pipette: 'P', analyzer: 'A', thermometer: 'T',
              scales: 'S', photometer: 'F', microscope: 'M'
            };
            prefix = fallback[eqType] || 'EQ';
          }
          idGenQueue.set(prefix, (idGenQueue.get(prefix) || 0) + 1);
        }

        const lastCal = parseDate(obj.lastCalibration);
        const result = normalizeResult(obj.result);

        parsed.push({ id, prefix, model, obj, customObj, lastCal, result, eqType, originalIdx });
      }

      if (parsed.length === 0) continue;

      // ── Этап 2: транзакция батча (withTransaction) ──
      let batchCommitted = false;
      try {
        await withTransaction(async (conn) => {
          // Генерируем ID разом для каждого префикса
          const idGenResults = new Map();
          for (const [prefix, count] of idGenQueue.entries()) {
            const safePrefix = String(prefix).replace(/[%_\\]/g, '\\$&');
            const [rows] = await conn.query(
              `SELECT id FROM pipettes WHERE id LIKE ? ORDER BY id FOR UPDATE`,
              [`${safePrefix}-%`]
            );
            let maxNum = 0;
            for (const row of rows) {
              const m = String(row.id).match(/(\d+)$/);
              if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
            }
            const ids = [];
            for (let i = 0; i < count; i++) {
              ids.push(`${prefix}-${String(maxNum + 1 + i).padStart(3, '0')}`);
            }
            idGenResults.set(prefix, ids);
          }

          const prefixCounter = new Map();
          for (const item of parsed) {
            if (!item.id) {
              const ids = idGenResults.get(item.prefix) || [];
              const c = prefixCounter.get(item.prefix) || 0;
              if (!ids[c]) {
                item._failed = true;
                errors.push(`Не удалось сгенерировать ID (префикс "${item.prefix}")`);
                continue;
              }
              item.id = ids[c];
              prefixCounter.set(item.prefix, c + 1);
            }
          }

          for (let k = parsed.length - 1; k >= 0; k--) {
            if (parsed[k]._failed) parsed.splice(k, 1);
          }

          // Финальная проверка на гонку
          const allBatchIds = parsed.map(p => p.id);
          if (allBatchIds.length > 0) {
            const ph = allBatchIds.map(() => '?').join(',');
            const [dupCheck] = await conn.query(
              `SELECT id FROM pipettes WHERE id IN (${ph})`,
              allBatchIds
            );
            if (dupCheck.length > 0) {
              const dupSet = new Set(dupCheck.map(r => r.id));
              const filtered = [];
              for (const item of parsed) {
                if (dupSet.has(item.id)) skipped.push(`${item.id}: ID уже занят (гонка)`);
                else filtered.push(item);
              }
              parsed.length = 0;
              parsed.push(...filtered);
            }
          }

          if (parsed.length > 0) {
            // Batch INSERT pipettes
            const clean = (s) => String(s || '').replace(/\u0000/g, '');
            const values = parsed.map(p => [
              p.id,
              clean(p.obj.serial).trim(),
              clean(p.obj.manufacturer).trim(),
              clean(p.model),
              p.eqType,
              clean(p.obj.volume).trim(),
              clean(p.obj.department).trim(),
              parseInterval(p.obj.interval),
              p.lastCal,
              clean(p.obj.cert).trim(),
              p.result,
              normalizeActive(p.obj.active),
              clean(p.obj.responsible).trim(),
              clean(p.obj.location).trim(),
              clean(p.obj.notes).trim(),
              Object.keys(p.customObj).length ? JSON.stringify(p.customObj) : null
            ]);

            const rowPh = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
            await conn.query(
              `INSERT INTO pipettes
                (id, serial, manufacturer, model, equipment_type, volume, department, \`interval\`,
                 last_calibration, cert, last_result, active, responsible, location, notes, custom_data)
               VALUES ${rowPh}`,
              values.flat()
            );

            // Batch INSERT history
            const histValues = parsed
              .filter(p => p.lastCal)
              .map(p => [p.id, p.lastCal, clean(p.obj.cert).trim(), p.result, 'Импорт из файла']);
            if (histValues.length > 0) {
              const histPh = histValues.map(() => '(?, ?, ?, ?, ?)').join(',');
              await conn.query(
                `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, note)
                 VALUES ${histPh}`,
                histValues.flat()
              );
            }
          }
        });

        batchCommitted = true;
        parsed.forEach(p => added.push(p.id));
        const elapsed = Date.now() - batchStartTime;
        console.log(`   ✅ Батч ${b + 1}/${totalBatches}: ${parsed.length} строк за ${elapsed} мс`);
      } catch (batchErr) {
        console.error(`❌ Батч ${b + 1}/${totalBatches}: ${batchErr.message} → fallback на построчную`);
      }

      // ── Fallback: построчная обработка ──
      if (!batchCommitted && parsed.length > 0) {
        for (const p of parsed) {
          if (p._failed) continue;

          // Генерация ID, если её ещё нет
          if (!p.id) {
            try {
              p.id = await withTransaction(async (conn) => {
                const safePrefix = String(p.prefix || 'EQ').replace(/[%_\\]/g, '\\$&');
                const [rows] = await conn.query(
                  `SELECT id FROM pipettes WHERE id LIKE ? ORDER BY id FOR UPDATE`,
                  [`${safePrefix}-%`]
                );
                let maxNum = 0;
                for (const row of rows) {
                  const m = String(row.id).match(/(\d+)$/);
                  if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
                }
                return `${p.prefix || 'EQ'}-${String(maxNum + 1).padStart(3, '0')}`;
              });
            } catch (e) {
              errors.push(`Строка ${(p.originalIdx ?? 0) + 2}: не удалось сгенерировать ID (${e.message})`);
              continue;
            }
          }

          // INSERT построчно
          try {
            await withTransaction(async (conn2) => {
              await conn2.query(
                `INSERT INTO pipettes
                  (id, serial, manufacturer, model, equipment_type, volume, department, \`interval\`,
                   last_calibration, cert, last_result, active, responsible, location, notes, custom_data)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  p.id,
                  String(p.obj.serial || '').replace(/\u0000/g, '').trim(),
                  String(p.obj.manufacturer || '').replace(/\u0000/g, '').trim(),
                  String(p.model || '').replace(/\u0000/g, ''),
                  p.eqType,
                  String(p.obj.volume || '').replace(/\u0000/g, '').trim(),
                  String(p.obj.department || '').replace(/\u0000/g, '').trim(),
                  parseInterval(p.obj.interval),
                  p.lastCal,
                  String(p.obj.cert || '').replace(/\u0000/g, '').trim(),
                  p.result,
                  normalizeActive(p.obj.active),
                  String(p.obj.responsible || '').replace(/\u0000/g, '').trim(),
                  String(p.obj.location || '').replace(/\u0000/g, '').trim(),
                  String(p.obj.notes || '').replace(/\u0000/g, '').trim(),
                  Object.keys(p.customObj).length ? JSON.stringify(p.customObj) : null
                ]
              );
              if (p.lastCal) {
                await conn2.query(
                  `INSERT INTO calibration_history (pipette_id, \`date\`, cert, result, note)
                   VALUES (?, ?, ?, ?, ?)`,
                  [p.id, p.lastCal, String(p.obj.cert || '').replace(/\u0000/g, '').trim(), p.result, 'Импорт из файла']
                );
              }
            });
            added.push(p.id);
          } catch (rowErr) {
            if (rowErr.code === 'ER_DUP_ENTRY') {
              skipped.push(`${p.id}: ID уже занят`);
            } else {
              errors.push(`${p.id}: ${rowErr.message}`);
            }
          }
        }
        console.log(`   ⚠️ Батч ${b + 1}/${totalBatches}: fallback обработал ${parsed.length} строк построчно`);
      }
    }

    // Аудит — через logAction
    await logAction(req, 'Импорт из файла',
      `${filename || 'файл'}: добавлено ${added.length}, пропущено ${skipped.length}, ошибок ${errors.length}`);

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
