'use strict';

// ============================================================
// ЭКСПОРТ
// ============================================================
const SYSTEM_EXPORT_FIELD_MAP = {
  id: { label: 'ID', get: p => p.id },
  serial: { label: 'Серийный', get: p => p.serial || '' },
  manufacturer: { label: 'Производитель', get: p => p.manufacturer || '' },
  model: { label: 'Модель', get: p => p.model },
  equipmentType: {
    label: 'Тип',
    get: p => {
      const t = _equipmentTypes.find(x => x.value === p.equipment_type);
      return t ? t.label : 'Прочее';
    }
  },
  volume: { label: 'Объём', get: p => p.volume || '' },
  department: { label: 'Отдел', get: p => p.department || '' },
  lastCalibration: { label: 'Дата поверки', get: p => formatDate(p.last_calibration) },
  nextCalibration: { label: 'Следующая', get: p => formatDate(getNextDate(p)) },
  interval: { label: 'МПИ', get: p => p.interval || '' },
  daysLeft: {
    label: 'Дней', get: p => {
      const s = calcStatus(p); const dl = daysLeft(p);
      return (s === 'inactive' || s === 'unknown') ? '—'
        : (s === 'sent' ? 'на поверке'
        : (s === 'wip' ? 'в процессе'
        : (s === 'fail' ? 'брак'
        : (dl < 0 ? 'просрочка ' + Math.abs(dl) + ' дн.' : dl + ' дн.'))));
    }
  },
  responsible: { label: 'Ответственный', get: p => p.responsible || '' },
  location: { label: 'Место', get: p => p.location || '' },
  status: {
    label: 'Статус', get: p => {
      const L = {
        ok: 'В норме', warn: 'Скоро поверка', danger: 'Просрочена',
        inactive: 'Неактивна', sent: 'На поверке', fail: 'Брак',
        wip: 'В процессе', unknown: 'Не задано'
      };
      return L[calcStatus(p)] || calcStatus(p);
    }
  },
  cert: { label: 'Свидетельство', get: p => p.cert || '' },
  notes: { label: 'Примечание', get: p => p.notes || '' }
};

function getExportField(id) {
  if (SYSTEM_EXPORT_FIELD_MAP[id]) return SYSTEM_EXPORT_FIELD_MAP[id];
  const custom = (_cachedFields || []).find(f => f.id === id);
  if (!custom) return null;
  return {
    label: custom.label,
    get: p => {
      const v = p[id];
      return (v === undefined || v === null) ? '' : String(v);
    }
  };
}

function getActiveExportFields() {
  if (exportFields && Array.isArray(exportFields) && exportFields.length > 0) {
    return exportFields.filter(f => !!getExportField(f));
  }
  return getExportFields().map(f => f.id);
}

async function exportToXlsx() {
  await refreshCurrentUser();
  if (!canExport()) { showToast('Нет прав на экспорт', 'error'); return; }
  if (!requirePasswordChange()) return;

  const data = getFilteredPipettes();
  if (data.length === 0) { showToast('Нет данных для экспорта', 'error'); return; }
  
 const fields = getActiveExportFields();
  const headers = fields.map(f => {
    const def = getExportField(f);
    return def ? def.label : f;
  });
  const rows = data.map(p => {
    const obj = {};
    fields.forEach((f, i) => {
      const def = getExportField(f);
      obj[headers[i]] = def ? def.get(p) : '';
    });
    return obj;
  });
  
  showToast('Формирование Excel…', 'success');

    try {
    const sess = sessionStorage.getItem('pipette_session');
    if (!sess) {
      showToast('Сессия истекла, войдите заново', 'error');
      return;
    }
    const token = JSON.parse(sess).token;

    const res = await fetch('/api/export/xlsx', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
        body: JSON.stringify({
        mode: 'registry',
        meta: {
          title: 'Реестр оборудования — КГБУЗ «Краевая клиническая больница», КДЛ',
          date: new Date().toLocaleDateString('ru-RU'),
          recordCount: data.length,
          user: currentUser ? currentUser.fullName : '',
          userPosition: currentUser ? (currentUser.position || '') : ''
        },
        headers,
        rows,
        fields
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка экспорта');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipettes_${todayStr()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Экспортировано: ${data.length} записей`, 'success');
  } catch (e) {
    showToast(e.message || 'Ошибка экспорта', 'error');
  }
}

async function exportToPDF() {
  await refreshCurrentUser();
  if (!canExport()) { showToast('Нет прав на экспорт', 'error'); return; }
  if (!requirePasswordChange()) return; 
  const data = getFilteredPipettes();
  if (data.length === 0) { showToast('Нет данных для экспорта', 'error'); return; }

  const fields = getActiveExportFields();
  const today = new Date().toLocaleDateString('ru-RU');
  const user = currentUser ? currentUser.fullName : '';
  const userPosition = currentUser ? (currentUser.position || '') : '';

    const headerCells = fields
    .map(f => {
      const def = getExportField(f);
      return `<th>${esc(def ? def.label : f)}</th>`;
    })
    .join('');

  const rows = data.map(p => {
    const cells = fields.map(f => {
      const def = getExportField(f);
      const val = def ? def.get(p) : '';
      if (f === 'status') {
        const st = calcStatus(p);
        return `<td><span class="status-${st}">${esc(val)}</span></td>`;
      }
      if (f === 'model' && p.manufacturer) {
        return `<td>${esc(p.model)}<br><small>${esc(p.manufacturer)}</small></td>`;
      }
      if (f === 'responsible' && p.location) {
        return `<td>${esc(p.responsible || '—')}<br><small>${esc(p.location)}</small></td>`;
      }
         if (f === 'nextCalibration') {
        const st = calcStatus(p);
        if (st === 'sent') {
          return `<td>На поверке<br><small>с ${formatDate(p.sent_for_calibration)}</small></td>`;
        }
        if (st === 'unknown') {
          return `<td>—<br><small>дата не задана</small></td>`;
        }
        const dl = daysLeft(p);
        const dlText = st === 'inactive' ? '' : (dl < 0 ? 'просрочка ' + Math.abs(dl) + ' дн.' : dl + ' дн.');
        return `<td>${esc(val)}${dlText ? '<br><small>' + dlText + '</small>' : ''}</td>`;
      }
      return `<td>${esc(val)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

    const win = window.open('', '_blank');
  if (!win) {
    showToast('Разрешите всплывающие окна для экспорта в PDF', 'error');
    return;
  }
  win.document.write(`
    <!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
    <title>Реестр пипеток — ${today}</title>
    <style>
            @page { size: A4 landscape; margin: 12mm 8mm; }
      * { box-sizing: border-box; }

      body {
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 9pt;
        color: #1a1a2e;
        margin: 0;
      }

      h1 { font-size: 14pt; margin: 0 0 4px; color: #1e293b; }

      .meta {
        font-size: 9pt;
        color: #64748b;
        margin-bottom: 10px;
        border-bottom: 1px solid #cbd5e1;
        padding-bottom: 6px;
      }
      .meta b { color: #1e293b; }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 8pt;
        border: 1.5px solid #1e293b;
      }

      th {
        background: #1e293b;
        color: #fff;
        padding: 6px 5px;
        text-align: left;
        font-size: 7.5pt;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        border: 1px solid #1e293b;
        vertical-align: middle;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      td {
        padding: 5px 5px;
        border: 0.5px solid #94a3b8;
        vertical-align: top;
        word-wrap: break-word;
      }

      tbody tr:nth-child(even) td {
        background: #f8fafc;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      tbody td:first-child,
      thead th:first-child {
        border-left: 1.5px solid #1e293b;
      }
      tbody td:last-child,
      thead th:last-child {
        border-right: 1.5px solid #1e293b;
      }

      small {
        color: #94a3b8;
        font-size: 7pt;
        line-height: 1.2;
        display: block;
      }

      .status-ok       { color: #16a34a; font-weight: 600; }
      .status-warn     { color: #ca8a04; font-weight: 600; }
      .status-danger   { color: #dc2626; font-weight: 700; }
      .status-fail     { color: #991b1b; font-weight: 700; }
      .status-inactive { color: #94a3b8; }
      .status-sent     { color: #0ea5e9; font-weight: 600; }
      .status-wip      { color: #ca8a04; font-weight: 600; }

      .footer {
        margin-top: 12px;
        font-size: 8pt;
        color: #000;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid #cbd5e1;
        padding-top: 6px;
      }

      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
    </style></head><body>
    
       <h1>Реестр оборудования — КГБУЗ «Краевая клиническая больница», КДЛ</h1>
      <div class="meta">Дата: <b>${today}</b> · Записей: <b>${data.length}</b></div>
      <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
       <div class="footer">
        <div>Документ сформировал: <b>${esc(userPosition)}, ${esc(user)}</b></div>
        <div>Подпись: _______________</div>
      </div>
    </body></html>`);
  win.document.close();
  showToast(`PDF: ${fields.length} полей, ${data.length} записей`, 'success');
}

// ============================================================
// МЕНЮ ЭКСПОРТА
// ============================================================
function toggleExportMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('export-menu');
  menu.classList.toggle('show');
}

function closeExportMenu() {
  const menu = document.getElementById('export-menu');
  if (menu) menu.classList.remove('show');
}

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('export-dropdown');
  if (dropdown && !dropdown.contains(e.target)) {
    closeExportMenu();
  }
});

// ============================================================
// ЭКСПОРТ ИСТОРИИ ПОВЕРОК КОНКРЕТНОГО ОБОРУДОВАНИЯ
// ============================================================
function openHistoryExportModal() {
  if (!requirePasswordChange()) return;
  if (!currentHistoryId) {
    showToast('Сначала откройте историю оборудования', 'error');
    return;
  }
  const p = pipettes.find(x => x.id === currentHistoryId);
  if (!p) return;

  document.getElementById('history-export-target').innerHTML =
    `Оборудование: <strong>${esc(p.id)}</strong> — ${esc(p.model)}`;

  document.getElementById('he-from').value = '';
  document.getElementById('he-to').value = '';
  document.getElementById('he-error').textContent = '';

  document.getElementById('history-export-modal').classList.add('active');
}

function closeHistoryExportModal() {
  document.getElementById('history-export-modal').classList.remove('active');
}

async function getFilteredHistoryForExport() {
  const p = pipettes.find(x => x.id === currentHistoryId);
  if (!p) return [];

  let history = await apiRequest(`/pipettes/${p.id}/calibration`);

  const from = document.getElementById('he-from').value;
  const to   = document.getElementById('he-to').value;

  if (from) {
    history = history.filter(h => String(h.date).slice(0, 10) >= from);
  }
  if (to) {
    history = history.filter(h => String(h.date).slice(0, 10) <= to);
  }

  history.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return history;
}

async function exportHistoryToXlsx() {
  const errEl = document.getElementById('he-error');
  errEl.textContent = '';

  const p = pipettes.find(x => x.id === currentHistoryId);
  if (!p) return;

  const history = await getFilteredHistoryForExport();
  if (history.length === 0) {
    errEl.textContent = 'Нет записей за выбранный период';
    return;
  }

  const from = document.getElementById('he-from').value;
  const to   = document.getElementById('he-to').value;

  const resultLabels = { pass: 'Годен', fail: 'Брак', wip: 'В процессе' };

  const headers = ['Дата поверки', 'Свидетельство', 'Результат', 'Организация', 'Примечание'];
  const rows = history.map(h => ({
    'Дата поверки':   h.date ? formatDate(h.date) : '',
    'Свидетельство':  h.cert || '',
    'Результат':      resultLabels[h.result] || h.result || '',
    'Организация':    h.org || '',
    'Примечание':     h.note || ''
  }));

   const meta = {
    title: 'История поверок оборудования',
    equipmentId: p.id,
    model: p.model,
    manufacturer: p.manufacturer || '',
    serial: p.serial || '',
    department: p.department || '',
    period: (from || to) ? `${from || '…'} — ${to || '…'}` : 'вся история',
    recordCount: history.length,
    user: currentUser ? currentUser.fullName : '',
    userPosition: currentUser ? (currentUser.position || '') : ''
  };

    try {
    const sess = sessionStorage.getItem('pipette_session');
    if (!sess) {
      errEl.textContent = 'Сессия истекла, войдите заново';
      return;
    }
    const token = JSON.parse(sess).token;

    const res = await fetch('/api/export/xlsx', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mode: 'history', meta, headers, rows })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка экспорта');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `history_${p.id}_${todayStr()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);

    closeHistoryExportModal();
    showToast(`Экспортировано: ${history.length} записей`, 'success');
  } catch (e) {
    errEl.textContent = e.message || 'Ошибка экспорта';
    showToast(e.message || 'Ошибка экспорта', 'error');
  }
}

async function exportHistoryToPDF() {
  const errEl = document.getElementById('he-error');
  errEl.textContent = '';

  const p = pipettes.find(x => x.id === currentHistoryId);
  if (!p) return;

  const history = await getFilteredHistoryForExport();
  if (history.length === 0) {
    errEl.textContent = 'Нет записей за выбранный период';
    return;
  }

  const from = document.getElementById('he-from').value;
  const to   = document.getElementById('he-to').value;
  const periodText =
    (from || to) ? `Период: ${from || '…'} — ${to || '…'}` : 'Период: вся история';

  const user = currentUser ? currentUser.fullName : '';
  const userPosition = currentUser ? (currentUser.position || '') : '';
  const today = new Date().toLocaleDateString('ru-RU');
  const resultLabels = { pass: 'Годен', fail: 'Брак', wip: 'В процессе' };

  const rows = history.map((h, i) => `
    <tr>
      <td style="text-align:center;">${i + 1}</td>
      <td>${esc(formatDate(h.date))}</td>
      <td>${esc(h.cert || '—')}</td>
      <td>${esc(resultLabels[h.result] || h.result || '—')}</td>
      <td>${esc(h.org || '—')}</td>
      <td>${esc(h.note || '')}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
    <title>История поверок — ${esc(p.id)}</title>
    <style>
            @page { size: A4 portrait; margin: 12mm 10mm; }
      * { box-sizing: border-box; }

      body {
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 10pt;
        color: #1a1a2e;
        margin: 0;
      }

      h1 { font-size: 14pt; margin: 0 0 4px; }

      .meta {
        font-size: 9pt;
        color: #64748b;
        margin-bottom: 12px;
        border-bottom: 1px solid #cbd5e1;
        padding-bottom: 6px;
      }
      .meta b { color: #1e293b; }

      .info {
        padding: 10px 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        font-size: 9pt;
        margin-bottom: 12px;
      }
      .info div { margin-bottom: 3px; }
      .info b { color: #1e293b; }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 9pt;
        border: 1.5px solid #1e293b;
      }

      th {
        background: #1e293b;
        color: #fff;
        padding: 7px 6px;
        text-align: left;
        font-size: 8pt;
        text-transform: uppercase;
        border: 1px solid #1e293b;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      td {
        padding: 6px;
        border: 0.5px solid #94a3b8;
        vertical-align: top;
      }

      tbody tr:nth-child(even) td {
        background: #f8fafc;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      tbody td:first-child,
      thead th:first-child {
        border-left: 1.5px solid #1e293b;
      }
      tbody td:last-child,
      thead th:last-child {
        border-right: 1.5px solid #1e293b;
      }

       .footer {
        margin-top: 20px;
        font-size: 8pt;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid #cbd5e1;
        padding-top: 6px;
      }

      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
    </style></head><body>
    
       <h1>История поверок оборудования</h1>
      <div class="meta">Дата формирования: <b>${today}</b></div>

      <div class="info">
        <div><b>ID:</b> ${esc(p.id)}</div>
        <div><b>Модель:</b> ${esc(p.model)}${p.manufacturer ? ' (' + esc(p.manufacturer) + ')' : ''}</div>
        <div><b>Серийный номер:</b> ${esc(p.serial || '—')}</div>
        <div><b>Отдел:</b> ${esc(p.department || '—')}</div>
        <div><b>${periodText}</b></div>
        <div><b>Записей:</b> ${history.length}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:5%;text-align:center;">№</th>
            <th style="width:15%;">Дата</th>
            <th style="width:20%;">Свидетельство</th>
            <th style="width:12%;">Результат</th>
            <th style="width:20%;">Организация</th>
            <th>Примечание</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

       <div class="footer">
        <div>Документ сформировал: <b>${esc(userPosition)}, ${esc(user)}</b></div>
      <div>Подпись: _______________</div>
      </div>
    </body></html>
  `;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    showToast('Разрешите всплывающие окна для экспорта в PDF', 'error');
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  closeHistoryExportModal();
  showToast(`PDF: ${history.length} записей`, 'success');
}
