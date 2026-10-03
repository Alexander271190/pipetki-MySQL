// ============================================================
// ШТРИХКОДЫ И ПЕЧАТЬ ЭТИКЕТОК
// ============================================================
const express = require('express');
const net = require('net');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const db = require('../db');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');

const router = express.Router();

function normalizeBarcode(s) {
  return String(s || '').trim().replace(/\s+/g, '');
}

function safeParseCustom(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

function resolveBarcodeValue(pipette) {
  if (pipette.barcode && pipette.barcode_source === 'manual') {
    return { value: String(pipette.barcode).trim(), source: 'manual' };
  }
  const custom = safeParseCustom(pipette.custom_data);
  const inv = custom.inventorynumber || custom.inventoryNumber || custom.inventory_no || '';
  if (inv && String(inv).trim()) return { value: String(inv).trim(), source: 'inventorynumber' };
  if (pipette.serial && String(pipette.serial).trim()) return { value: String(pipette.serial).trim(), source: 'serial' };
  return { value: String(pipette.id).trim(), source: 'id' };
}

async function generateBarcodePng(value, type = 'code128') {
  if (type === 'qr') {
    return QRCode.toBuffer(value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 400,
      type: 'png',
    });
  }
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({
      bcid: 'code128',
      text: value,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
    }, (err, png) => {
      if (err) return reject(err);
      resolve(png);
    });
  });
}

async function getSettings() {
  const keys = [
    'barcode_type', 'barcode_label_fields', 'barcode_mode',
    'barcode_label_size', 'barcode_fallback_to_pdf', 'barcode_default_copies',
    'barcode_zebra_language', 'barcode_agent_port', 'barcode_max_length',
  ];
  const ph = keys.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (${ph})`,
    keys
  );
  const s = {};
  for (const r of rows) s[r.setting_key] = r.setting_value;
  return s;
}

function getLabelFields(s) {
  try {
    const parsed = JSON.parse(s.barcode_label_fields || '[]');
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : ['id', 'model', 'serial', 'department'];
  } catch (e) {
    return ['id', 'model', 'serial', 'department'];
  }
}

const LABEL_SIZES = {
  '58x40':  { widthPt: 164.4, heightPt: 113.4, widthDots: 464, heightDots: 320 },
  '40x25':  { widthPt: 113.4, heightPt: 70.9,  widthDots: 320, heightDots: 200 },
  '100x50': { widthPt: 283.5, heightPt: 141.7, widthDots: 800, heightDots: 400 },
};

function buildZplForPipette(p, opts = {}) {
  const labelFields = opts.labelFields || ['id', 'model'];
  const sizeKey = opts.labelSize || '58x40';
  const size = LABEL_SIZES[sizeKey] || LABEL_SIZES['58x40'];
  const barcodeType = opts.barcodeType || 'code128';

  const { value } = resolveBarcodeValue(p);

  const lines = [];
  lines.push('^XA');
  lines.push(`^PW${size.widthDots}`);
  lines.push(`^LL${size.heightDots}`);
  lines.push('^CI28');
  lines.push('^MMT');

  if (barcodeType === 'qr') {
    lines.push('^FO20,20');
    lines.push('^BQN,2,6');
    lines.push(`^FDMA,${value}^FS`);
  } else {
    lines.push('^FO20,20');
    lines.push('^BY2,3,80');
    lines.push('^BCN,80,Y,N,N');
    lines.push(`^FD${value}^FS`);
  }

  let y = barcodeType === 'qr' ? 200 : 120;
  const lineHeight = 22;

  for (const f of labelFields) {
    let text = '';
    if (f === 'id')                text = `ID: ${p.id}`;
    else if (f === 'model')        text = `Модель: ${p.model || ''}`;
    else if (f === 'serial')       text = `S/N: ${p.serial || ''}`;
    else if (f === 'department')   text = `Отдел: ${p.department || ''}`;
    else if (f === 'responsible')  text = `Отв.: ${p.responsible || ''}`;
    else if (f === 'inventorynumber') {
      const cd = safeParseCustom(p.custom_data);
      text = `Инв.: ${cd.inventorynumber || ''}`;
    }
    if (!text) continue;

    const safe = String(text)
      .replace(/\^/g, '').replace(/~/g, '').replace(/\\/g, '').replace(/,/g, '\\,');

    lines.push(`^FO20,${y}`);
    lines.push('^A0N,20,20');
    lines.push(`^FD${safe}^FS`);
    y += lineHeight;
    if (y > size.heightDots - 20) break;
  }

  lines.push('^XZ');
  return lines.join('\n');
}

function sendZplToPrinter(zpl, ip, port, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      client.destroy();
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => finish(new Error('Таймаут подключения к принтеру')), timeoutMs);
    client.once('error', (e) => { clearTimeout(timer); finish(e); });
    client.once('timeout', () => { clearTimeout(timer); finish(new Error('Таймаут')); });
    client.connect(port, ip, () => {
      client.write(zpl, 'utf8', (err) => {
        clearTimeout(timer);
        if (err) return finish(err);
        client.end();
        finish(null);
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════
// GET /api/barcodes/:id/png?type=code128|qr
// ═══════════════════════════════════════════════════════════
router.get('/:id/png', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, barcode, barcode_source, serial, custom_data FROM pipettes WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Оборудование не найдено' });

    const { value } = resolveBarcodeValue(rows[0]);
    const type = (req.query.type || 'code128').toLowerCase();
    const png = await generateBarcodePng(value, type);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(png);
  } catch (e) {
    console.error('barcode png error:', e);
    res.status(500).json({ error: 'Ошибка генерации штрихкода' });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/barcodes/lookup
// ═══════════════════════════════════════════════════════════
router.post('/lookup', authenticate, requirePermission('scan_barcode'), async (req, res) => {
  try {
    const raw = req.body && req.body.barcode;
    if (!raw) return res.status(400).json({ error: 'Укажите штрихкод' });
    const barcode = normalizeBarcode(raw);
    if (!barcode) return res.status(400).json({ error: 'Пустой штрихкод' });

    const selectCols = `
      id, model, serial, department, responsible, location,
      active, last_result, sent_for_calibration, custom_data, barcode
    `;

    let [rows] = await db.query(`SELECT ${selectCols} FROM pipettes WHERE barcode = ? LIMIT 1`, [barcode]);
    if (!rows.length) {
      [rows] = await db.query(`SELECT ${selectCols} FROM pipettes WHERE id = ? LIMIT 1`, [barcode]);
    }
    if (!rows.length) {
      [rows] = await db.query(`SELECT ${selectCols} FROM pipettes WHERE serial = ? LIMIT 1`, [barcode]);
    }
    if (!rows.length) {
      [rows] = await db.query(
        `SELECT ${selectCols} FROM pipettes
         WHERE JSON_UNQUOTE(JSON_EXTRACT(custom_data, '$.inventorynumber')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(custom_data, '$.inventoryNumber')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(custom_data, '$.inventory_no')) = ?
         LIMIT 1`,
        [barcode, barcode, barcode]
      );
    }
    if (!rows.length) return res.status(404).json({ error: 'Не найдено по штрихкоду' });

    res.json(rows[0]);
  } catch (e) {
    console.error('barcode lookup error:', e);
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/barcodes/manual — ручной ввод (админ)
// ═══════════════════════════════════════════════════════════
router.post('/manual', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id, barcode } = req.body || {};
    if (!id)      return res.status(400).json({ error: 'Укажите id пипетки' });
    if (!barcode) return res.status(400).json({ error: 'Укажите штрихкод' });

    const s = await getSettings();
    const maxLen = parseInt(s.barcode_max_length, 10) || 128;
    const value = String(barcode).trim();
    if (!value) return res.status(400).json({ error: 'Пустой штрихкод' });
    if (value.length > maxLen) return res.status(400).json({ error: `Максимум ${maxLen} символов` });

    const [rows] = await db.query('SELECT id FROM pipettes WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Оборудование не найдено' });

    const [dup] = await db.query(
      'SELECT id FROM pipettes WHERE barcode = ? AND id <> ? LIMIT 1',
      [value, id]
    );
    if (dup.length) return res.status(409).json({ error: `Штрихкод уже используется у ${dup[0].id}` });

    await db.query(
      `UPDATE pipettes SET barcode = ?, barcode_source = 'manual', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [value, id]
    );

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Установка штрихкода вручную', `${id} → ${value}`]
    );

    res.json({ message: 'Штрихкод установлен', barcode: value, source: 'manual' });
  } catch (e) {
    console.error('manual barcode error:', e);
    res.status(500).json({ error: 'Ошибка сохранения' });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/barcodes/reset — сбросить к авто
// ═══════════════════════════════════════════════════════════
router.post('/reset', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Укажите id' });

    const [rows] = await db.query('SELECT id FROM pipettes WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Оборудование не найдено' });

    await db.query(
      `UPDATE pipettes SET barcode = NULL, barcode_source = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Сброс штрихкода', id]
    );

    res.json({ message: 'Штрихкод сброшен' });
  } catch (e) {
    console.error('reset barcode error:', e);
    res.status(500).json({ error: 'Ошибка сброса' });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/barcodes/labels.pdf
// ═══════════════════════════════════════════════════════════
router.get('/labels.pdf', authenticate, requirePermission('print_labels'), async (req, res) => {
  try {
    const idsParam = req.query.ids || '';
    const copies   = Math.max(1, Math.min(50, parseInt(req.query.copies, 10) || 1));
    const layout   = (req.query.layout || 'a4').toLowerCase();

    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.status(400).json({ error: 'Не указаны ids' });

    const s = await getSettings();
    const type        = (req.query.type || s.barcode_type || 'code128').toLowerCase();
    const labelFields = req.query.fields
      ? req.query.fields.split(',').map(x => x.trim()).filter(Boolean)
      : getLabelFields(s);

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT id, barcode, barcode_source, model, serial, department,
              responsible, custom_data
       FROM pipettes WHERE id IN (${placeholders})`,
      ids
    );
    if (!rows.length) return res.status(404).json({ error: 'Оборудование не найдено' });

    const tasks = [];
    for (const p of rows) {
      for (let c = 0; c < copies; c++) tasks.push(p);
    }

    const filename = `labels_${layout}_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const zebraSize = LABEL_SIZES[s.barcode_label_size] || LABEL_SIZES['58x40'];
    const doc = layout === 'zebra'
      ? new PDFDocument({ size: [zebraSize.widthPt, zebraSize.heightPt], margins: { top: 4, bottom: 4, left: 4, right: 4 }, autoFirstPage: false })
      : new PDFDocument({ size: 'A4', margin: 20 });

    doc.pipe(res);

    function getFieldLine(p, f) {
      switch (f) {
        case 'id':                return `ID: ${p.id}`;
        case 'model':             return `Модель: ${p.model || ''}`;
        case 'serial':            return `S/N: ${p.serial || ''}`;
        case 'department':        return `Отдел: ${p.department || ''}`;
        case 'responsible':       return `Отв.: ${p.responsible || ''}`;
        case 'inventorynumber': {
          const cd = safeParseCustom(p.custom_data);
          return `Инв.: ${cd.inventorynumber || ''}`;
        }
        default: return '';
      }
    }

    if (layout === 'zebra') {
      for (const p of tasks) {
        doc.addPage();
        const { value } = resolveBarcodeValue(p);
        let png = null;
        try { png = await generateBarcodePng(value, type); } catch (e) {}

        if (png) {
          const imgH = type === 'qr' ? 60 : 34;
          doc.image(png, 4, 4, { fit: [zebraSize.widthPt - 8, imgH], align: 'center' });
        } else {
          doc.fontSize(8).text(value, 4, 4);
        }

        let ty = type === 'qr' ? 68 : 42;
        doc.fontSize(7).fillColor('#000000');
        for (const f of labelFields) {
          const line = getFieldLine(p, f);
          if (!line) continue;
          doc.text(line, 4, ty, { width: zebraSize.widthPt - 8, lineBreak: false, ellipsis: true });
          ty += 10;
          if (ty > zebraSize.heightPt - 10) break;
        }
      }
    } else {
      const COLS = 3;
      const ROWS_PER_PAGE = 8;
      const CELL_W = (doc.page.width - 40) / COLS;
      const CELL_H = (doc.page.height - 40) / ROWS_PER_PAGE;
      const PER_PAGE = COLS * ROWS_PER_PAGE;

      let idx = 0;
      for (const p of tasks) {
        if (idx > 0 && idx % PER_PAGE === 0) doc.addPage();

        const pos = idx % PER_PAGE;
        const col = pos % COLS;
        const row = Math.floor(pos / COLS);
        const x = 20 + col * CELL_W;
        const y = 20 + row * CELL_H;

        doc.rect(x, y, CELL_W - 6, CELL_H - 6).stroke('#cccccc');

        const { value } = resolveBarcodeValue(p);
        let png = null;
        try { png = await generateBarcodePng(value, type); } catch (e) {}

        if (png) {
          const imgW = CELL_W - 20;
          const imgH = type === 'qr' ? CELL_H - 70 : 40;
          doc.image(png, x + 10, y + 6, { fit: [imgW, imgH], align: 'center' });
        } else {
          doc.fontSize(9).text(value, x + 4, y + 4);
        }

        let ty = y + CELL_H - 60;
        doc.fontSize(8).fillColor('#000000');
        for (const f of labelFields) {
          const line = getFieldLine(p, f);
          if (!line) continue;
          doc.text(line, x + 6, ty, { width: CELL_W - 12, lineBreak: false, ellipsis: true });
          ty += 10;
          if (ty > y + CELL_H - 12) break;
        }

        idx++;
      }
    }

    doc.end();
  } catch (e) {
    console.error('labels pdf error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Ошибка генерации PDF' });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/barcodes/printer-status — проверка TCP (админ)
// ═══════════════════════════════════════════════════════════
router.post('/printer-status', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { ip, port } = req.body || {};
    if (!ip) return res.json({ ok: false, message: 'IP не указан' });
    const p = parseInt(port, 10) || 9100;

    await new Promise((resolve, reject) => {
      const client = new net.Socket();
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        client.destroy();
        err ? reject(err) : resolve();
      };
      const t = setTimeout(() => finish(new Error('Таймаут')), 4000);
      client.once('error', (e) => { clearTimeout(t); finish(e); });
      client.connect(p, ip, () => { clearTimeout(t); finish(null); });
    });

    res.json({ ok: true, message: `Связь с ${ip}:${p} есть` });
  } catch (e) {
    res.json({ ok: false, message: `Не могу подключиться: ${e.message}` });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/barcodes/print
// ═══════════════════════════════════════════════════════════
router.post('/print', authenticate, requirePermission('print_labels'), async (req, res) => {
  try {
    const { ids, copies: copiesRaw, printerId } = req.body || {};
    const copies = Math.max(1, Math.min(50, parseInt(copiesRaw, 10) || 1));

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Не указаны ids' });
    }

    const s = await getSettings();
    const labelFields = getLabelFields(s);
    const labelSize = s.barcode_label_size || '58x40';

    const placeholders = ids.map(() => '?').join(',');
    const [pipettes] = await db.query(
      `SELECT id, barcode, barcode_source, model, serial, department,
              responsible, custom_data
       FROM pipettes WHERE id IN (${placeholders})`,
      ids
    );
    if (!pipettes.length) return res.status(404).json({ error: 'Оборудование не найдено' });

    let printer = null;
    if (printerId) {
      const [rows] = await db.query(
        'SELECT * FROM barcode_printers WHERE id = ? AND enabled = 1',
        [printerId]
      );
      printer = rows[0] || null;
    }

    if (!printer) {
      const userDept = (req.user.is_acting && req.user.acting_department)
        ? req.user.acting_department
        : req.user.department;

      if (userDept) {
        const [rows] = await db.query(
          `SELECT * FROM barcode_printers
           WHERE department = ? AND enabled = 1
           ORDER BY is_default DESC, sort_order ASC, id ASC LIMIT 1`,
          [userDept]
        );
        printer = rows[0] || null;
      }
    }

    if (!printer) {
      const [rows] = await db.query(
        `SELECT * FROM barcode_printers WHERE enabled = 1
         ORDER BY is_default DESC, sort_order ASC, id ASC LIMIT 1`
      );
      printer = rows[0] || null;
    }

    const mode = printer ? printer.mode : (s.barcode_mode || 'pdf-a4');

    if (mode === 'zebra-ip') {
      if (!printer || !printer.ip) {
        if (s.barcode_fallback_to_pdf === '1') {
          return res.json({ mode: 'pdf-a4-fallback', reason: 'IP принтера не настроен' });
        }
        return res.status(400).json({ error: 'IP принтера не настроен' });
      }

      try {
        const zplParts = [];
        for (const p of pipettes) {
          const zpl = buildZplForPipette(p, {
            labelFields,
            labelSize: printer.label_size || labelSize,
            barcodeType: s.barcode_type || 'code128',
          });
          for (let c = 0; c < copies; c++) zplParts.push(zpl);
        }
        await sendZplToPrinter(zplParts.join('\n'), printer.ip, printer.port || 9100);

        await db.query(
          'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
          [req.user.id, req.user.full_name, 'Печать Zebra IP',
           `${pipettes.length} × ${copies} → ${printer.name} (${printer.ip}:${printer.port})`]
        );

        return res.json({
          mode: 'zebra-ip',
          printed: pipettes.length * copies,
          printer: printer.name,
          message: `Отправлено на «${printer.name}»: ${pipettes.length * copies} этикеток`,
        });
      } catch (e) {
        console.error('Zebra IP print error:', e.message);
        if (s.barcode_fallback_to_pdf === '1') {
          return res.json({ mode: 'pdf-a4-fallback', reason: e.message });
        }
        return res.status(500).json({ error: 'Принтер недоступен: ' + e.message });
      }
    }

    if (mode === 'zebra-agent') {
      const zplParts = [];
      for (const p of pipettes) {
        const zpl = buildZplForPipette(p, {
          labelFields,
          labelSize: printer ? printer.label_size : labelSize,
          barcodeType: s.barcode_type || 'code128',
        });
        for (let c = 0; c < copies; c++) zplParts.push(zpl);
      }
      return res.json({
        mode: 'zebra-agent',
        zpl: zplParts.join('\n'),
        printer: printer ? printer.name : null,
        printed: pipettes.length * copies,
        agentPort: parseInt(s.barcode_agent_port, 10) || 9200,
      });
    }

    if (mode === 'pdf-zebra') {
      return res.json({
        mode: 'pdf-zebra',
        layout: 'zebra',
        printer: printer ? printer.name : null,
      });
    }

    return res.json({ mode: 'pdf-a4', layout: 'a4' });
  } catch (e) {
    console.error('print error:', e);
    res.status(500).json({ error: 'Ошибка печати' });
  }
});

module.exports = router;
