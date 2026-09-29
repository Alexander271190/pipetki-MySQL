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
    });

    // ── Автоширина столбцов ──
    sheet.columns.forEach((col, i) => {
      let max = String(headers[i] || '').length;
      col.eachCell({ includeEmpty: false }, cell => {
        const len = String(cell.value || '').length;
        if (len > max) max = len;
      });
      col.width = Math.min(Math.max(max + 2, 8), 45);
    });

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
