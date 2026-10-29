'use strict';

// ============================================================
// СКАНИРОВАНИЕ ШТРИХКОДОВ
// ============================================================
let _barcodeScanList = [];

async function openBarcodeScannerModal() {
  await UI.guard(
    { permission: 'scan_barcode', errorMsg: 'Нет прав на сканирование' },
    async () => {
      _barcodeScanList = [];
      renderBarcodeScanList();
      const input = document.getElementById('barcode-input');
      const errEl = document.getElementById('barcode-scan-error');
      if (errEl) errEl.textContent = '';
      if (input) input.value = '';
      UI.modal.open('barcode-scanner-modal');
      if (input) setTimeout(() => input.focus(), 100);
    }
  );
}

function closeBarcodeScannerModal() {
  UI.modal.close('barcode-scanner-modal');
}

async function handleBarcodeScan(raw) {
  const value = String(raw || '').trim();
  if (!value) return;
  const errEl = document.getElementById('barcode-scan-error');
  if (errEl) errEl.textContent = '';
  if (_barcodeScanList.some(x => x._scannedValue === value)) {
    if (errEl) errEl.textContent = 'Уже в списке';
    return;
  }
  try {
    const res = await apiRequest('/barcodes/lookup', 'POST', { barcode: value });
    if (_barcodeScanList.some(x => x.id === res.id)) {
      if (errEl) errEl.textContent = 'Уже в списке';
      return;
    }
    res._scannedValue = value;
    _barcodeScanList.push(res);
    renderBarcodeScanList();
  } catch (e) {
    if (errEl) errEl.textContent = e.message || 'Не найдено';
  }
}

function renderBarcodeScanList() {
  const list = document.getElementById('barcode-scan-list');
  const counter = document.getElementById('barcode-scan-count');
  const btnSend = document.getElementById('btn-scan-send');
  const btnReturn = document.getElementById('btn-scan-return');
  if (counter) counter.textContent = _barcodeScanList.length;
  if (!_barcodeScanList.length) {
    if (list) list.innerHTML = `<div style="color:${COLORS.faint};">Список пуст. Сканируйте штрихкоды.</div>`;
    if (btnSend) btnSend.disabled = true;
    if (btnReturn) btnReturn.disabled = true;
    return;
  }
  if (list) {
     list.innerHTML = _barcodeScanList.map((p, i) => `
      <div class="flex-row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid #e2e8f0;">
        <div><strong>${esc(p.id)}</strong> — ${esc(p.model || '')}</div>
        <button class="btn btn-danger btn-sm" onclick="removeFromBarcodeScanList(${i})" style="padding:2px 8px;font-size:.7rem;">×</button>
      </div>
    `).join('');
  }
  const hasSendable = _barcodeScanList.some(p => !p.sent_for_calibration);
  const hasReturnable = _barcodeScanList.some(p => p.sent_for_calibration);
  if (btnSend) btnSend.disabled = !hasSendable;
  if (btnReturn) btnReturn.disabled = !hasReturnable;
}

function removeFromBarcodeScanList(idx) {
  _barcodeScanList.splice(idx, 1);
  renderBarcodeScanList();
}

function clearBarcodeScanList() {
  _barcodeScanList = [];
  renderBarcodeScanList();
}

function openBulkSendFromScanner() {
  const ids = _barcodeScanList.filter(p => !p.sent_for_calibration).map(p => p.id);
  if (!ids.length) { showToast('Нет позиций для отправки', 'error'); return; }
  selectedPipettes.clear();
  ids.forEach(id => selectedPipettes.add(id));
  closeBarcodeScannerModal();
  openBulkSendModal();
}

function openBulkReturnFromScanner() {
  const ids = _barcodeScanList.filter(p => p.sent_for_calibration).map(p => p.id);
  if (!ids.length) { showToast('Нет позиций для возврата', 'error'); return; }
  selectedPipettes.clear();
  ids.forEach(id => selectedPipettes.add(id));
  closeBarcodeScannerModal();
  openBulkReturnModal();
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('barcode-input');
  if (!input) return;
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = input.value;
      input.value = '';
      await handleBarcodeScan(value);
    }
  });
});

function isMobileDevice() {
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|PlayBook|Silk/i.test(ua);
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const hasTouch = (navigator.maxTouchPoints || 0) > 0 || ('ontouchstart' in window);
  const narrowScreen = window.matchMedia('(max-width: 900px)').matches;

  return uaMobile || iPadOS || (hasTouch && narrowScreen);
}

function handleScanButton() {
  openBarcodeScannerModal();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.btn-scan-barcode, [onclick*="handleScanButton"]').forEach(btn => {
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'fa-solid fa-barcode';
    btn.title = 'Сканировать USB-сканером';
  });
});

// ============================================================
// ПЕЧАТЬ ЭТИКЕТОК
// ============================================================
async function openBarcodePrintModal() {
  await UI.guard(
    { permission: 'print_labels', errorMsg: 'Нет прав на печать' },
    async () => {
      updateBarcodePrintScopeCounts();
      const hasSelected = selectedPipettes.size > 0;
      const selRadio = document.getElementById('bc-scope-selected');
      const filtRadio = document.getElementById('bc-scope-filtered');
      if (hasSelected && selRadio) selRadio.checked = true;
      else if (filtRadio) filtRadio.checked = true;

      apiRequest('/settings/system').then(s => {
        const copiesEl = document.getElementById('barcode-print-copies');
        if (copiesEl && s.barcode_default_copies) copiesEl.value = s.barcode_default_copies;
      }).catch(() => {});

      loadPrintersForBarcodePrint();
      const errEl = document.getElementById('barcode-print-error');
      if (errEl) errEl.textContent = '';
      UI.modal.open('barcode-print-modal');
    }
  );
}

function closeBarcodePrintModal() {
  UI.modal.close('barcode-print-modal');
}

async function loadPrintersForBarcodePrint() {
  const container = document.getElementById('barcode-print-printer-options');
  if (!container) return;
  container.innerHTML = '<div class="bc-printer-empty">Загрузка…</div>';

  try {
    const data = await apiRequest('/barcode-printers/available');

    if (!data.printers || data.printers.length === 0) {
    container.innerHTML = `
      <label class="bc-printer-item">
      <input type="radio" name="bc-printer" value="pdf-a4" checked>
      <span><i class="fa-solid fa-file-lines"></i> PDF (A4)</span>
      </label>`;
   return;
     }

    const modeLabels = {
     'pdf-a4':      '<i class="fa-solid fa-file-lines"></i> PDF (A4)',
     'pdf-zebra':   '<i class="fa-solid fa-print"></i> PDF 58×40 (Ctrl+P)',
     'zebra-ip':    '<i class="fa-solid fa-network-wired"></i> Zebra по сети (IP)',
     'zebra-agent': '<i class="fa-solid fa-bolt"></i> Zebra (агент)',
  };

    const options = data.printers.map(p => {
      const isPreferred = (p.id === data.preferredId);
      const label = `${modeLabels[p.mode] || p.mode} — ${esc(p.name)}${p.department ? ' (' + esc(p.department) + ')' : ''}`;
      return `
        <label class="bc-printer-item">
          <input type="radio" name="bc-printer" value="printer:${p.id}" ${isPreferred ? 'checked' : ''}>
          <span>${label}${isPreferred ? ' <span class="bc-printer-hint">← ваш</span>' : ''}</span>
        </label>`;
    });

    options.push(`
     <label class="bc-printer-item">
       <input type="radio" name="bc-printer" value="pdf-a4" ${!data.preferredId ? 'checked' : ''}>
       <span><i class="fa-solid fa-file-lines"></i> PDF (A4, обычный принтер)</span>
      </label>`);

    container.innerHTML = options.join('');
  } catch (e) {
    container.innerHTML = `
     <label class="bc-printer-item">
       <input type="radio" name="bc-printer" value="pdf-a4" checked>
       <span><i class="fa-solid fa-file-lines"></i> PDF (A4)</span>
     </label>`;
  }
}

function updateBarcodePrintScopeCounts() {
  const selectedCount = [...selectedPipettes].filter(id => pipettes.some(p => p.id === id)).length;
  const el1 = document.getElementById('bc-scope-selected-count');
  if (el1) el1.textContent = selectedCount;

  const pageIds = getVisiblePageIds();
  const el2 = document.getElementById('bc-scope-page-count');
  if (el2) el2.textContent = pageIds.length;

  // 🆕 «Весь фильтр» — общее число с сервера, а не длина текущей страницы
  const el3 = document.getElementById('bc-scope-filtered-count');
  if (el3) el3.textContent = (pagedState && pagedState.total) ? pagedState.total : 0;
}

async function getBarcodePrintIds() {
  const scope = document.querySelector('input[name="bc-scope"]:checked')?.value || 'filtered';

  if (scope === 'selected') {
    return [...selectedPipettes].filter(id => pipettes.some(p => p.id === id));
  }
  if (scope === 'page') {
    return getVisiblePageIds();
  }
  if (scope === 'filtered') {
    // 🆕 Весь фильтр — с сервера, а не текущая страница
    return await loadIdsForExport();
  }
  return [];
}

async function submitBarcodePrint(ev) {
  const errEl = document.getElementById('barcode-print-error');
  if (errEl) errEl.textContent = '';

  const ids = await getBarcodePrintIds();
  if (ids.length === 0) { if (errEl) errEl.textContent = 'Ничего не выбрано'; return; }
  if (ids.length > 500) {
    const ok = await showConfirm(
      `Печатается ${ids.length} этикеток. Продолжить?`,
      { icon: '⚠️', title: 'Много этикеток', okText: 'Продолжить', okClass: 'btn-warning' }
    );
    if (!ok) return;
  }

  const copies = Math.max(1, Math.min(50, parseInt(document.getElementById('barcode-print-copies').value, 10) || 1));

  const printerRadio = document.querySelector('input[name="bc-printer"]:checked');
  const printerValue = printerRadio ? printerRadio.value : 'pdf-a4';

  if (printerValue === 'pdf-a4') {
    await downloadBarcodePdf(ids, copies, 'a4');
    closeBarcodePrintModal();
    return;
  }

  const printerId = parseInt(printerValue.replace('printer:', ''), 10);

  const btn = ev && ev.target ? ev.target.closest('button') : null;
  const origHtml = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Печать…'; }

  try {
    const res = await apiRequest('/barcodes/print', 'POST', { ids, copies, printerId });

    if (res.mode === 'zebra-ip') {
      showToast(res.message || `Отправлено на «${res.printer}»`, 'success');
      closeBarcodePrintModal();
      return;
    }

    if (res.mode === 'zebra-agent') {
      const ok = await sendToLocalAgent(res.zpl, res.agentPort || 9200);
      if (ok) {
        showToast(`Отправлено на «${res.printer}»: ${res.printed} этикеток`, 'success');
        closeBarcodePrintModal();
      } else {
        showToast('Локальный агент не отвечает. Скачиваем PDF.', 'warn');
        await downloadBarcodePdf(ids, copies, 'zebra');
        closeBarcodePrintModal();
      }
      return;
    }

    if (res.mode === 'pdf-zebra') {
      await downloadBarcodePdf(ids, copies, 'zebra');
      closeBarcodePrintModal();
      showToast(`PDF 58×40 для «${res.printer || 'Zebra'}»: ${ids.length * copies} этикеток`, 'success');
      return;
    }

    if (res.mode === 'pdf-a4-fallback') {
      showToast(`⚠️ ${res.reason}. Скачиваем PDF.`, 'warn');
      await downloadBarcodePdf(ids, copies, 'a4');
      closeBarcodePrintModal();
      return;
    }

    if (res.mode === 'pdf-a4') {
      await downloadBarcodePdf(ids, copies, 'a4');
      closeBarcodePrintModal();
      return;
    }

    showToast('Неизвестный режим: ' + res.mode, 'error');
  } catch (e) {
    if (errEl) errEl.textContent = e.message || 'Ошибка печати';
  } finally {
    if (btn && origHtml) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

async function downloadBarcodePdf(ids, copies, layout) {
  const url = `/api/barcodes/labels.pdf?ids=${encodeURIComponent(ids.join(','))}&copies=${copies}&layout=${layout}`;
  const defaultFilename = `labels_${layout}_${todayStr()}.pdf`;
  
  // 🆕 Используем новую безопасную функцию скачивания
  await downloadFile(url, {}, defaultFilename);
  
  showToast(`PDF: ${ids.length} × ${copies} = ${ids.length * copies} этикеток`, 'success');
}

async function sendToLocalAgent(zpl, port) {
  try {
    const res = await fetch(`http://localhost:${port}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: zpl,
    });
    return res.ok;
  } catch (e) {
    console.warn('Local agent unavailable:', e.message);
    return false;
  }
}

// ============================================================
// НАСТРОЙКИ АДМИНА — принтеры
// ============================================================
let _cachedBarcodePrinters = [];

async function renderBarcodePrintersList() {
  const container = document.getElementById('barcode-printers-list');
  if (!container) return;

  try {
    _cachedBarcodePrinters = await apiRequest('/barcode-printers');

    if (_cachedBarcodePrinters.length === 0) {
      container.innerHTML = `<div class="bc-empty">Принтеров пока нет. Нажмите «Добавить принтер».</div>`;
      return;
    }

    const modeLabels = {
      'pdf-a4':      'PDF (A4)',
      'pdf-zebra':   'PDF 58×40',
      'zebra-ip':    'Zebra IP',
      'zebra-agent': 'Zebra агент',
    };

    let html = `<table class="bc-printers-table"><thead><tr>
      <th style="width:20%;">Название</th>
      <th style="width:16%;">Режим</th>
      <th style="width:20%;">Отдел</th>
      <th style="width:18%;">IP</th>
      <th style="width:9%;">Размер</th>
      <th style="width:5%;">Вкл</th>
      <th style="width:7%;">По&nbsp;ум.</th>
      <th style="width:5%;"></th>
    </tr></thead><tbody>`;

    for (const p of _cachedBarcodePrinters) {
      html += `
        <tr data-printer-id="${p.id}">
          <td><input type="text" value="${esc(p.name)}" onchange="updateBarcodePrinterField(${p.id}, 'name', this.value)"></td>
          <td>
            <select onchange="updateBarcodePrinterField(${p.id}, 'mode', this.value)">
              ${Object.entries(modeLabels).map(([v, l]) =>
                `<option value="${v}" ${p.mode === v ? 'selected' : ''}>${l}</option>`
              ).join('')}
            </select>
          </td>
          <td>
            <select onchange="updateBarcodePrinterField(${p.id}, 'department', this.value)">
              <option value="">— любой —</option>
              ${departmentsList.map(d => `<option value="${esc(d)}" ${p.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
            </select>
          </td>
          <td><input type="text" value="${esc(p.ip || '')}" onchange="updateBarcodePrinterField(${p.id}, 'ip', this.value)" placeholder="192.168.1.100"></td>
          <td>
            <select onchange="updateBarcodePrinterField(${p.id}, 'labelSize', this.value)">
              <option value="58x40" ${p.labelSize === '58x40' ? 'selected' : ''}>58×40</option>
              <option value="40x25" ${p.labelSize === '40x25' ? 'selected' : ''}>40×25</option>
              <option value="100x50" ${p.labelSize === '100x50' ? 'selected' : ''}>100×50</option>
            </select>
          </td>
          <td style="text-align:center;">${UI.checkbox(`updateBarcodePrinterField(${p.id}, 'enabled', this.checked)`, p.enabled, 'bc-chk')}</td>
          <td style="text-align:center;">${UI.checkbox(`updateBarcodePrinterField(${p.id}, 'isDefault', this.checked)`, p.isDefault, 'bc-chk')}</td>
          <td class="bc-printer-actions" style="text-align: center; padding: 5px;">
            <button class="row-actions-btn" onclick="openPrinterActions(event, ${p.id})" title="Действия">
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
          </td>
        </tr>`;
    }
    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div style="color:${COLORS.danger};padding:10px;">Ошибка: ${esc(e.message)}</div>`;
  }
}

function openPrinterActions(ev, id) {
  ev.stopPropagation();
  const p = _cachedBarcodePrinters.find(x => x.id === id);
  if (!p) return;

  const items = [
    { label: '<i class="fa-solid fa-plug"></i> Проверить связь', action: () => checkPrinterById(id) },
    { label: '<i class="fa-solid fa-floppy-disk"></i> Сохранить', action: () => saveBarcodePrinter(id) },
    { divider: true },
    { label: '<i class="fa-solid fa-trash"></i> Удалить', class: 'item-danger', action: () => deleteBarcodePrinter(id) }
  ];
  renderRowActionsMenu(ev.currentTarget, items);
}

function updateBarcodePrinterField(id, field, value) {
  const p = _cachedBarcodePrinters.find(x => x.id === id);
  if (p) p[field] = value;
}

async function saveBarcodePrinter(id) {
  const p = _cachedBarcodePrinters.find(x => x.id === id);
  if (!p) return;
  try {
    await UI.saveAction({
      successMsg: `Принтер «${p.name}» сохранён`,
      reload: false
    }, () => apiRequest('/barcode-printers/' + id, 'PUT', {
      name: p.name,
      department: p.department || '',
      mode: p.mode,
      ip: p.ip || '',
      port: p.port || 9100,
      labelSize: p.labelSize || '58x40',
      enabled: !!p.enabled,
      isDefault: !!p.isDefault,
      sortOrder: p.sortOrder || 0,
    }));
  } catch (e) {}
}

async function deleteBarcodePrinter(id) {
  const p = _cachedBarcodePrinters.find(x => x.id === id);
  if (!p) return;
  const ok = await showConfirm(
    `Удалить принтер «${p.name}»?`,
    { icon: '🖨️', title: 'Удаление', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;
  try {
    await apiRequest('/barcode-printers/' + id, 'DELETE');
    showToast('Удалён', 'success');
    renderBarcodePrintersList();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function checkPrinterById(id) {
  const p = _cachedBarcodePrinters.find(x => x.id === id);
  if (!p) return;
  if (p.mode === 'zebra-ip') {
    try {
      const res = await apiRequest('/barcodes/printer-status', 'POST', { ip: p.ip, port: p.port });
      showToast(res.message, res.ok ? 'success' : 'error');
    } catch (e) {
      showToast(e.message, 'error');
    }
    } else if (p.mode === 'zebra-agent') {
    try {
      const port = p.port || 9200;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`http://localhost:${port}/status`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        showToast(`Агент отвечает на порту ${port}`, 'success');
      } else {
        showToast(`Агент ответил ${res.status}`, 'warn');
      }
    } catch (e) {
      showToast('Агент не отвечает. Проверьте, запущен ли он на этом компьютере.', 'error');
    }
  } else {
      showToast('Для этого режима проверка связи не требуется', 'warn');
  }
}

async function addBarcodePrinter() {
  // Шаг 1 — название
  const name = await showPrompt(
    'Название принтера',
    {
      icon: 'fa-print',
      title: 'Новый принтер этикеток',
      okText: 'Далее',
      placeholder: 'Например: Zebra КДЛ',
      validator: v => v ? null : 'Укажите название принтера'
    }
  );
  if (!name) return;

  // Шаг 2 — режим
  const mode = await showPrompt(
    'Режим печати:\n1 — PDF (A4)\n2 — PDF 58×40 (Ctrl+P)\n3 — Zebra по сети (IP)\n4 — Zebra через агент',
    {
      icon: 'fa-gear',
      title: 'Режим принтера',
      okText: 'Далее',
      defaultValue: '2',
      validator: v => ['1','2','3','4'].includes(v) ? null : 'Введите 1, 2, 3 или 4'
    }
  );
  if (!mode) return;

  const modeMap = { '1': 'pdf-a4', '2': 'pdf-zebra', '3': 'zebra-ip', '4': 'zebra-agent' };
  const selectedMode = modeMap[mode];
  if (!selectedMode) return;

  // Шаг 3 — IP и порт (только для zebra-ip)
  let ip = '';
  let port = 9100;
  if (selectedMode === 'zebra-ip') {
    ip = await showPrompt(
      'IP-адрес принтера',
      {
        icon: 'fa-network-wired',
        title: 'Сетевой принтер',
        okText: 'Далее',
        placeholder: 'Например: 192.168.1.100',
        validator: v => {
          if (!v) return 'Укажите IP';
          if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) return 'Некорректный IP';
          return null;
        }
      }
    );
    if (!ip) return;

    const portStr = await showPrompt(
      'Порт принтера',
      {
        icon: 'fa-plug',
        title: 'Порт',
        okText: 'Далее',
        defaultValue: '9100',
        validator: v => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 1 || n > 65535) return 'Порт 1..65535';
          return null;
        }
      }
    );
    port = parseInt(portStr, 10) || 9100;
  }

  // Шаг 4 — отдел (необязательный)
  const department = await showPrompt(
    'Отдел (оставьте пустым для общего принтера)',
    {
      icon: 'fa-building',
      title: 'Отдел',
      okText: 'Создать',
      okClass: 'btn-success',
      placeholder: 'Например: Гематологический',
    }
  );
  if (department === null) return;  // отмена на этом шаге = отмена всей операции

  try {
    await apiRequest('/barcode-printers', 'POST', {
      name: name.trim(),
      department: department ? department.trim() : '',
      mode: selectedMode,
      ip: ip ? ip.trim() : '',
      port,
      labelSize: '58x40',
      enabled: true,
      isDefault: false,
    });
    showToast('Принтер добавлен', 'success');
    renderBarcodePrintersList();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ============================================================
// НАСТРОЙКИ ПЕЧАТИ — загрузка / сохранение
// ============================================================
async function loadBarcodeSettings() {
  try {
    const s = await apiRequest('/settings/system');
    const sizeEl = document.getElementById('bc-label-size');
    if (sizeEl) sizeEl.value = s.barcode_label_size || '58x40';
    const fontEl = document.getElementById('bc-font');
    if (fontEl) {
      try {
        const list = await apiRequest('/barcodes/fonts');
        if (Array.isArray(list) && list.length > 0) {
          fontEl.innerHTML = list
            .map(f => `<option value="${esc(f.value)}">${esc(f.label)}</option>`)
            .join('');
          const current = s.barcode_font || 'dejavu';
          fontEl.value = list.some(f => f.value === current)
            ? current
            : list[0].value;
        } else {
          fontEl.innerHTML = '<option value="">— нет доступных шрифтов —</option>';
        }
      } catch (e) {
        console.warn('loadBarcodeSettings fonts:', e);
        fontEl.innerHTML = '<option value="">— ошибка загрузки —</option>';
      }
    }
    const typeEl = document.getElementById('bc-type');
    if (typeEl) typeEl.value = s.barcode_type || 'code128';
    const copiesEl = document.getElementById('bc-default-copies');
    if (copiesEl) copiesEl.value = s.barcode_default_copies || 1;
    const agentEl = document.getElementById('bc-agent-port');
    if (agentEl) agentEl.value = s.barcode_agent_port || 9200;
    const maxEl = document.getElementById('bc-max-length');
    if (maxEl) maxEl.value = Math.min(255, parseInt(s.barcode_max_length, 10) || 255);
    const fbEl = document.getElementById('bc-fallback-to-pdf');
    if (fbEl) fbEl.checked = s.barcode_fallback_to_pdf !== '0';

    const container = document.getElementById('bc-label-fields');
    if (container) {
      const allFields = [
        { id: 'id',              label: 'Внутренний номер' },
        { id: 'model',           label: 'Модель' },
        { id: 'serial',          label: 'Серийный' },
        { id: 'inventorynumber', label: 'Инвентарный номер' },
        { id: 'department',      label: 'Отдел' },
        { id: 'responsible',     label: 'Ответственный' },
      ];
      let selected = ['id', 'model', 'serial', 'department'];
      try { selected = JSON.parse(s.barcode_label_fields || '[]'); } catch (e) {}
      container.innerHTML = allFields.map(f => `
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" class="bc-field-cb" value="${esc(f.id)}" ${selected.includes(f.id) ? 'checked' : ''}>
          ${esc(f.label)}
        </label>
      `).join('');
    }
  } catch (e) {
    console.warn('loadBarcodeSettings:', e);
  }
}

async function saveBarcodeSettings() {
  const fields = Array.from(document.querySelectorAll('.bc-field-cb:checked')).map(cb => cb.value);
  if (fields.length === 0) { showToast('Выберите хотя бы одно поле', 'error'); return; }
  const fontEl = document.getElementById('bc-font');
  const payload = {
    barcode_label_size: document.getElementById('bc-label-size').value,
    barcode_type: document.getElementById('bc-type').value,
    barcode_default_copies: document.getElementById('bc-default-copies').value,
    barcode_agent_port: document.getElementById('bc-agent-port').value,
    barcode_max_length: String(Math.min(255, Math.max(8,
     parseInt(document.getElementById('bc-max-length').value, 10) || 255))),
    barcode_fallback_to_pdf: document.getElementById('bc-fallback-to-pdf').checked ? '1' : '0',
    barcode_label_fields: JSON.stringify(fields),
    barcode_font: fontEl && fontEl.value ? fontEl.value : 'dejavu',
  };
  try {
    await UI.saveAction({
      successMsg: 'Настройки печати сохранены',
      reload: false
    }, () => apiRequest('/settings/system', 'PUT', payload));
  } catch (e) {}
}
