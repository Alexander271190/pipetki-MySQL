const express = require('express');
const ExcelJS = require('exceljs');
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

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'КДЛ';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Данные');

    const COLS = Math.max(headers.length, 1);

       // ── Шапка ──
    if (mode === 'history' && meta) {
      const titleRow = sheet.addRow([meta.title || 'История поверок']);
      sheet.mergeCells(1, 1, 1, COLS);
      titleRow.getCell(1).font = { size: 14, bold: true, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      titleRow.height = 22;

      sheet.addRow([`ID: ${meta.equipmentId || ''}`]).getCell(1).font = { bold: true };
      sheet.addRow([`Модель: ${meta.model || ''}`]);
      if (meta.manufacturer) sheet.addRow([`Производитель: ${meta.manufacturer}`]);
      if (meta.serial)       sheet.addRow([`Серийный номер: ${meta.serial}`]);
      if (meta.department)   sheet.addRow([`Отдел: ${meta.department}`]);
      if (meta.period)       sheet.addRow([`Период: ${meta.period}`]);
      sheet.addRow([`Записей: ${meta.recordCount ?? rows.length}`]);
      sheet.addRow([]); // пустая строка-разделитель

    } else if (mode === 'registry' && meta) {
      const titleRow = sheet.addRow([meta.title || 'Реестр оборудования']);
      sheet.mergeCells(1, 1, 1, COLS);
      titleRow.getCell(1).font = { size: 14, bold: true, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      titleRow.height = 22;

      // 🆕 В шапке — только дата и число записей (без «Сформировал»)
      const metaParts = [];
      if (meta.date)                metaParts.push(`Дата: ${meta.date}`);
      if (meta.recordCount != null) metaParts.push(`Записей: ${meta.recordCount}`);
      if (metaParts.length) {
        sheet.addRow([metaParts.join('  ·  ')]);
      }
      sheet.addRow([]); // пустая строка-разделитель

    } else {
      const titleRow = sheet.addRow([title || 'Реестр оборудования']);
      sheet.mergeCells(1, 1, 1, COLS);
      titleRow.getCell(1).font = { size: 14, bold: true, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      titleRow.height = 22;
      sheet.addRow([]);
    }
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
    let lastDataRow = null;                        // 🆕 ссылка на последнюю строку

    rows.forEach((row, idx) => {
      const r = sheet.addRow(headers.map(h => row[h] ?? ''));
      r.eachCell(cell => {
        cell.alignment = { vertical: 'top', wrapText: true };
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
      lastDataRow = r;                             // 🆕 запоминаем
    });

    
       // ── Подвал: кто сформировал + подпись ──
    if (mode && meta) {
      // 🆕 Отступ ~2.1 см от последней записи (60pt)
      const spacer = sheet.addRow([]);
      spacer.height = 60;

      // 🆕 Подвал: слева «Документ сформировал», справа «Подпись»
      const footerRow = sheet.addRow([]);
      footerRow.height = 20;

      const userText = `Документ сформировал: ${(meta.userPosition || '').trim()}, ${(meta.user || '').trim()}`;
      const signText = 'Подпись: _______________';

      if (COLS >= 2) {
        // Левая часть — «Документ сформировал» (первая половина колонок)
        const midCol = Math.ceil(COLS / 2);
        sheet.mergeCells(footerRow.number, 1, footerRow.number, midCol);
        const leftCell = footerRow.getCell(1);
        leftCell.value = userText;
        leftCell.font = { size: 10, bold: true, color: { argb: 'FF1E293B' } };
        leftCell.alignment = { horizontal: 'left', vertical: 'middle' };

        // Правая часть — «Подпись» (вторая половина колонок)
        if (midCol + 1 <= COLS) {
          sheet.mergeCells(footerRow.number, midCol + 1, footerRow.number, COLS);
          const rightCell = footerRow.getCell(midCol + 1);
          rightCell.value = signText;
          rightCell.font = { size: 10 };
          rightCell.alignment = { horizontal: 'right', vertical: 'middle' };
        }
      } else {
        // Fallback: одна колонка — печатаем в одной ячейке
        const cell = footerRow.getCell(1);
        cell.value = `${userText}\n\n${signText}`;
        cell.font = { size: 10, bold: true, color: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      }

       const FORCE_BREAK_THRESHOLD = 40;
        if (lastDataRow && rows.length > FORCE_BREAK_THRESHOLD) {
          lastDataRow.addPageBreak();
        }

        sheet.addRow([]);
    }

    // ── Автоширина столбцов ──
    sheet.columns.forEach((col, i) => {
      let max = String(headers[i] || '').length;
      col.eachCell({ includeEmpty: false }, cell => {
        const len = String(cell.value || '').length;
        if (len > max) max = len;
      });
      col.width = Math.min(Math.max(max + 2, 8), 45);
    });

        // 🆕 Настройки печати: шапка таблицы на каждой странице + альбомная
    sheet.pageSetup = {
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      orientation: 'landscape',
      paperSize: 9,                     // A4
      margins: {
        left: 0.4, right: 0.4,
        top: 0.5, bottom: 0.5,
        header: 0.2, footer: 0.2,
      },
      printTitlesRow: headerRow.number + ':' + headerRow.number,   // 🆕 шапка на каждой странице
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
