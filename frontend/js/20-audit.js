'use strict';

let _auditCache = [];
let _auditFiltered = [];
let _eqAuditCache = [];
let _eqAuditId = null;
let _eqAuditInfo = null;

// ── Глобальный аудит ─────────────────────────────────────
async function openAuditModal() {
  UI.modal.open('audit-modal');
  document.getElementById('audit-search').value = '';
  document.getElementById('audit-category').value = '';
  document.getElementById('audit-period').value = '';
  document.getElementById('audit-custom-period').style.display = 'none';
  await loadAuditData();
}

function closeAuditModal() {
  UI.modal.close('audit-modal');
}

function onAuditPeriodChange() {
  const v = document.getElementById('audit-period').value;
  const box = document.getElementById('audit-custom-period');
  box.style.display = v === 'custom' ? 'flex' : 'none';
  box.style.gap = '8px';
  renderAuditList();
}

async function loadAuditData() {
  const tbody = document.getElementById('audit-body');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">Загрузка...</td></tr>';
  try {
    const res = await apiRequest('/pipettes/audit?limit=500');
    _auditCache = Array.isArray(res.items) ? res.items : [];
    renderAuditList();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#dc2626;">Ошибка: ${esc(e.message)}</td></tr>`;
  }
}

function _auditPeriodRange() {
  const period = document.getElementById('audit-period').value;
  const today = todayStr();
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  if (period === 'month') {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  if (period === 'custom') {
    return {
      from: document.getElementById('audit-from').value || '',
      to: document.getElementById('audit-to').value || ''
    };
  }
  return { from: '', to: '' };
}

function renderAuditList() {
  const q = (document.getElementById('audit-search').value || '').trim().toLowerCase();
  const cat = document.getElementById('audit-category').value;
  const { from, to } = _auditPeriodRange();

  _auditFiltered = _auditCache.filter(r => {
    if (cat && r.category !== cat) return false;
    const d = (r.timestamp || '').slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (q) {
      const hay = [r.pipette_id, r.model, r.user_full_name, r.action, r.details]
        .map(x => String(x || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const counters = document.getElementById('audit-counters');
  if (counters) {
    const total = _auditCache.length;
    const shown = _auditFiltered.length;
    const cats = {};
    for (const r of _auditFiltered) cats[r.category || 'other'] = (cats[r.category || 'other'] || 0) + 1;
    const catStr = Object.entries(cats).map(([k, v]) => `${_catLabel(k)}: ${v}`).join(' · ');
    counters.textContent = `Показано: ${shown} из ${total}${catStr ? ' · ' + catStr : ''}`;
  }

  const tbody = document.getElementById('audit-body');
  if (!_auditFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">Нет записей</td></tr>';
  } else {
    tbody.innerHTML = _auditFiltered.map(_renderAuditRow).join('');
  }

  const totalEl = document.getElementById('audit-total');
  if (totalEl) totalEl.textContent = `Всего: ${_auditFiltered.length}`;
}

function _catLabel(cat) {
  return {
    equipment: 'Оборудование', users: 'Пользователи', calibration: 'Поверки',
    barcode: 'Штрихкоды', settings: 'Настройки', locks: 'Блокировки',
    auth: 'Вход/выход', help: 'Справка', other: 'Прочее'
  }[cat] || cat;
}

function _actionColor(action) {
  if (!action) return 'inherit';
  if (action.includes('Удаление')) return '#dc2626';
  if (action.includes('Добавление') || action.includes('Создание')) return '#16a34a';
  if (action.includes('Редактирование')) return '#4f46e5';
  return 'inherit';
}

function _renderAuditRow(r) {
  return `
    <tr>
      <td class="timestamp">${new Date(r.timestamp).toLocaleString('ru-RU')}</td>
      <td><strong>${esc(r.pipette_id || '—')}</strong>${r.model ? `<br><small>${esc(r.model)}</small>` : ''}</td>
      <td>${esc(r.user_full_name || '—')}</td>
      <td style="color:${_actionColor(r.action)};font-weight:600;">${esc(r.action)}</td>
      <td style="font-size:.82rem;">${esc(r.details || '')}</td>
    </tr>`;
}

function exportAuditPDF() {
  if (!_auditFiltered.length) { showToast('Нет данных для печати', 'error'); return; }
  _printAuditTable(_auditFiltered, 'Аудит изменений', 'Дата');
}

// ── Аудит одного прибора ──────────────────────────────────
async function openEquipmentAuditModal(id) {
  _eqAuditId = id;
  UI.modal.open('equipment-audit-modal');
  document.getElementById('eq-audit-search').value = '';
  document.getElementById('eq-audit-period').value = '';
  document.getElementById('eq-audit-custom-period').style.display = 'none';
  document.getElementById('equipment-audit-title').innerHTML = '<i class="fa-solid fa-clipboard-list"></i> Аудит изменений прибора';
  await loadEquipmentAuditData(id);
}

function closeEquipmentAuditModal() {
  UI.modal.close('equipment-audit-modal');
  _eqAuditId = null;
  _eqAuditInfo = null;
  _eqAuditCache = [];
}

function onEqAuditPeriodChange() {
  const v = document.getElementById('eq-audit-period').value;
  const box = document.getElementById('eq-audit-custom-period');
  box.style.display = v === 'custom' ? 'flex' : 'none';
  box.style.gap = '8px';
  renderEquipmentAuditList();
}

async function loadEquipmentAuditData(id) {
  const tbody = document.getElementById('eq-audit-body');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94a3b8;">Загрузка...</td></tr>';
  try {
    const res = await apiRequest(`/pipettes/${encodeURIComponent(id)}/audit?limit=500`);
    _eqAuditInfo = res.equipment || null;
    _eqAuditCache = Array.isArray(res.items) ? res.items : [];
    const title = document.getElementById('equipment-audit-title');
    if (_eqAuditInfo) {
      title.innerHTML = `<i class="fa-solid fa-clipboard-list"></i> Аудит изменений — <strong>${esc(_eqAuditInfo.id)}</strong> ${_eqAuditInfo.model ? '· ' + esc(_eqAuditInfo.model) : ''}`;
    }
    renderEquipmentAuditList();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#dc2626;">Ошибка: ${esc(e.message)}</td></tr>`;
  }
}

function _eqAuditPeriodRange() {
  const period = document.getElementById('eq-audit-period').value;
  const today = todayStr();
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  if (period === 'month') {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  if (period === 'custom') {
    return {
      from: document.getElementById('eq-audit-from').value || '',
      to: document.getElementById('eq-audit-to').value || ''
    };
  }
  return { from: '', to: '' };
}

function _filteredEqAudit() {
  const q = (document.getElementById('eq-audit-search').value || '').trim().toLowerCase();
  const { from, to } = _eqAuditPeriodRange();
  return _eqAuditCache.filter(r => {
    const d = (r.timestamp || '').slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (q) {
      const hay = [r.user_full_name, r.action, r.details].map(x => String(x || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderEquipmentAuditList() {
  const list = _filteredEqAudit();
  const tbody = document.getElementById('eq-audit-body');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94a3b8;">Нет записей</td></tr>';
  } else {
    tbody.innerHTML = list.map(r => `
      <tr>
        <td class="timestamp">${new Date(r.timestamp).toLocaleString('ru-RU')}</td>
        <td>${esc(r.user_full_name || '—')}</td>
        <td style="color:${_actionColor(r.action)};font-weight:600;">${esc(r.action)}</td>
        <td style="font-size:.82rem;">${esc(r.details || '')}</td>
      </tr>`).join('');
  }
  const totalEl = document.getElementById('eq-audit-total');
  if (totalEl) totalEl.textContent = `Всего: ${list.length} из ${_eqAuditCache.length}`;
}

function exportEquipmentAuditPDF() {
  if (!_eqAuditId) return;
  const list = _filteredEqAudit();
  if (!list.length) { showToast('Нет данных для печати', 'error'); return; }
  const title = `Аудит изменений — ${_eqAuditInfo?.id || _eqAuditId}`;
  _printAuditTable(list, title, 'Дата', _eqAuditInfo);
}

// ── Общий принтер ────────────────────────────────────────
function _printAuditTable(items, title, dateLabel, equipmentInfo) {
  const today = new Date().toLocaleDateString('ru-RU');
  const user = currentUser ? currentUser.fullName : '';
  const userPosition = currentUser ? (currentUser.position || '') : '';

  const eqLine = equipmentInfo
    ? `<div>Оборудование: <b>${esc(equipmentInfo.id)}</b>${equipmentInfo.model ? ' — ' + esc(equipmentInfo.model) : ''}</div>`
    : '';

  const rows = items.map(r => `
    <tr>
      <td>${new Date(r.timestamp).toLocaleString('ru-RU')}</td>
      <td>${esc(r.pipette_id || '—')}${r.model ? '<br><small>' + esc(r.model) + '</small>' : ''}</td>
      <td>${esc(r.user_full_name || '—')}</td>
      <td>${esc(r.action)}</td>
      <td>${esc(r.details || '')}</td>
    </tr>`).join('');

  const html = `
    <!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
    <title>${esc(title)} — ${today}</title>
    <style>
      @page { size: A4 landscape; margin: 12mm 8mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #1a1a2e; margin: 0; }
      h1 { font-size: 14pt; margin: 0 0 4px; color: #1e293b; }
      .meta { font-size: 9pt; color: #64748b; margin-bottom: 10px; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; }
      .meta b { color: #1e293b; }
      table { width: 100%; border-collapse: collapse; font-size: 8pt; border: 1.5px solid #1e293b; }
      th { background: #1e293b; color: #fff; padding: 6px 5px; text-align: left; font-size: 7.5pt; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      td { padding: 5px; border-bottom: 0.5px solid #94a3b8; vertical-align: top; }
      tbody tr:nth-child(even) td { background: #f8fafc; }
      small { color: #94a3b8; font-size: 7pt; }
      .footer { margin-top: 12px; font-size: 8pt; display: flex; justify-content: space-between; border-top: 1px solid #cbd5e1; padding-top: 6px; }
      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
    </style></head><body>
      <h1>${esc(title)}</h1>
      <div class="meta">
        <div>Дата печати: <b>${today}</b> · Записей: <b>${items.length}</b></div>
        ${eqLine}
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:14%;">${dateLabel} и время</th>
            <th style="width:10%;">Прибор</th>
            <th style="width:15%;">Кто</th>
            <th style="width:15%;">Действие</th>
            <th>Изменения</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">
        <div>Документ сформировал: <b>${esc(userPosition)}, ${esc(user)}</b></div>
        <div>Подпись: _______________</div>
      </div>
    </body></html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('Разрешите всплывающие окна для печати', 'error'); return; }
  win.document.write(html);
  win.document.close();
}
