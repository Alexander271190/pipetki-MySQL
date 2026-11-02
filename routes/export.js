const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// ЭКСПОРТ В EXCEL (.xlsx)
// Два режима:
//   mode = 'history' → история поверок одной пипетки
//   без mode         → реестр всего оборудования
// ============================================================
router.post('/xlsx', authenticate, requirePermission('export_data'), async (req, res) => {
  try {
    const { mode, meta, title, headers, rows } = req.body;

    if (!Array.isArray(headers) || !Array.isArray(rows)) {
      return res.status(400).json({ error: 'Ожидается headers[] и rows[]' });
    }

    // Глобальные флаги — если админ отключил экспорт, отдаём 403
    const [er] = await db.query(
      'SELECT export_enabled, history_enabled FROM export_settings WHERE id = 1'
    );
    if (er.length) {
      if (mode === 'history' && er[0].history_enabled === 0) {
        return res.status(403).json({ error: 'Экспорт истории отключён администратором' });
      }
      if (mode !== 'history' && er[0].export_enabled === 0) {
        return res.status(403).json({ error: 'Экспорт реестра отключён администратором' });
      }
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'КДЛ';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Данные');

    const COLS = Math.max(headers.length, 1);

    // ── Шапка документа (настройки из export_settings) ──
    const [headerRows] = await db.query(
      'SELECT header_enabled, header_text, header_align FROM export_settings WHERE id = 1'
    );
    const hConf = headerRows[0] || { header_enabled: 0, header_text: '', header_align: 'left' };

    const isHeaderOn = hConf.header_enabled === 1 && hConf.header_text && hConf.header_text.trim();
    const align = hConf.header_align || 'left';
    
    // В Excel горизонтальное выравнивание: 'left', 'center', 'right'
    const excelAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';

    if (isHeaderOn) {
      const lines = hConf.header_text.split('\n').map(l => l.trim()).filter(Boolean);
      lines.forEach((line, idx) => {
        const r = sheet.addRow([line]);
        sheet.mergeCells(r.number, 1, r.number, COLS);
        const cell = r.getCell(1);
        cell.font = { bold: idx === 0, size: idx === 0 ? 12 : 10, color: { argb: 'FF000000' } };
        cell.alignment = { horizontal: excelAlign, vertical: 'middle' };
      });
      // Отступ после шапки
      sheet.addRow([]);
    }

    // ── Заголовок документа (по центру) ──
    let docTitle = '';
    if (mode === 'history' && meta) docTitle = meta.title || 'История поверок';
    else if (mode === 'registry' && meta) docTitle = meta.title || 'Реестр оборудования';
    else docTitle = title || 'Реестр оборудования';

    const titleRow = sheet.addRow([docTitle]);
    sheet.mergeCells(titleRow.number, 1, titleRow.number, COLS);
    const titleCell = titleRow.getCell(1);
    titleCell.font = { size: 14, bold: true, color: { argb: 'FF1E293B' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }; // <-- По центру
    titleRow.height = 22;

    sheet.addRow([]); 
    
    // ── Строка заголовков таблицы ──
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FF334155' } },
        left:   { style: 'thin', color: { argb: 'FF334155' } },
        bottom: { style: 'thin', color: { argb: 'FF334155' } },
        right:  { style: 'thin', color: { argb: 'FF334155' } },
      };
    });
    headerRow.height = 22;

    // ── Данные ──
    let lastDataRow = null;

    rows.forEach((row, idx) => {
      const r = sheet.addRow(headers.map(h => row[h] ?? ''));
      r.height = 22;
      r.eachCell(cell => {
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.font = { size: 10 };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left:   { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right:  { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
        if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });
      lastDataRow = r;
    });

        // ── Подвал: дата, количество, кто сформировал + подпись ──
    if (mode && meta) {
      // Отступ от последней записи (60pt)
      const spacer = sheet.addRow([]);
      spacer.height = 60;

      // Левая часть футера (2 строки)
      const footerRow1 = sheet.addRow([]);
      footerRow1.height = 20;
      
      const footerRow2 = sheet.addRow([]);
      footerRow2.height = 20;

      const userText = `Документ сформировал: ${(meta.userPosition || '').trim()}, ${(meta.user || '').trim()}`;
      
        // Для реестра: дата. Для истории: период.
      let metaText = '';
      
        if (mode === 'history' && meta) {
        if (meta.period) metaText += `Период: ${meta.period}`;
        if (meta.recordCount != null) metaText += `${metaText ? ' · ' : ''}Записей: ${meta.recordCount}`;
      } else if (meta) {
        if (meta.date) metaText += `Дата: ${meta.date}`;
        if (meta.recordCount != null) metaText += `${metaText ? ' · ' : ''}Записей: ${meta.recordCount}`;
      }

      const signText = 'Подпись: _______________';

      if (COLS >= 2) {
        const midCol = Math.ceil(COLS / 2);
        
        // Строка 1: Документ сформировал (слева) | Подпись (справа)
        sheet.mergeCells(footerRow1.number, 1, footerRow1.number, midCol);
        const leftCell1 = footerRow1.getCell(1);
        leftCell1.value = userText;
        leftCell1.font = { size: 10, bold: true, color: { argb: 'FF1E293B' } };
        leftCell1.alignment = { horizontal: 'left', vertical: 'middle' };

        if (midCol + 1 <= COLS) {
          sheet.mergeCells(footerRow1.number, midCol + 1, footerRow1.number, COLS);
          const rightCell = footerRow1.getCell(midCol + 1);
          rightCell.value = signText;
          rightCell.font = { size: 10 };
          rightCell.alignment = { horizontal: 'right', vertical: 'middle' };
        }

        // Строка 2: Дата и записи (слева)
        if (metaText) {
          sheet.mergeCells(footerRow2.number, 1, footerRow2.number, COLS);
          const leftCell2 = footerRow2.getCell(1);
          leftCell2.value = metaText;
          leftCell2.font = { size: 9, color: { argb: 'FF64748B' } }; // Серый цвет
          leftCell2.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      } else {
        // Fallback: одна колонка
        const cell = footerRow1.getCell(1);
        cell.value = `${userText}\n${metaText || ''}\n\n${signText}`;
        cell.font = { size: 10, bold: true, color: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      }

      // Перенос страницы для больших таблиц (как было)
      const FORCE_BREAK_THRESHOLD = 40;
      if (lastDataRow && rows.length > FORCE_BREAK_THRESHOLD) {
        lastDataRow.addPageBreak();
      }
      
      sheet.addRow([]); // Пустая строка в самом конце
    }
    
    // ── Автоширина столбцов (узкие, чтобы все влезли по ширине) ──
    sheet.columns.forEach((col, i) => {
      let max = String(headers[i] || '').length;
      col.eachCell({ includeEmpty: false }, cell => {
        const len = String(cell.value || '').length;
        if (len > max) max = len;
      });
      // максимум 20 символов — иначе одна «Примечание» растянет всю таблицу
      col.width = Math.min(Math.max(max + 1, 8), 20);
    });

    // Настройки печати: все колонки уместить по ширине 1 листа
    sheet.pageSetup = {
      fitToPage: true,                  // Excel сам подберёт масштаб
      fitToWidth: 1,                    // вписать по ширине в 1 страницу
      fitToHeight: 0,                   // по высоте — сколько нужно
      orientation: 'landscape',         // A4 горизонтальная
      paperSize: 9,                     // A4
      margins: {
        left: 0.25, right: 0.25,        // уменьшены — больше места для колонок
        top: 0.4, bottom: 0.4,
        header: 0.2, footer: 0.2,
      },
      printTitlesRow: headerRow.number + ':' + headerRow.number,
    };

    // ── Отдача файла ──
    const buffer = await workbook.xlsx.writeBuffer();
    const today = new Date().toISOString().slice(0, 10);
    const filename = mode === 'history'
      ? `history_${meta?.equipmentId || 'export'}_${today}.xlsx`
      : `pipettes_${today}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('Export XLSX error:', e);
    res.status(500).json({ error: 'Ошибка экспорта Excel: ' + e.message });
  }
});

module.exports = router;
