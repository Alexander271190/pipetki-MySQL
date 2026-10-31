'use strict';

// ============================================================
// МАССОВАЯ ОТПРАВКА НА ПОВЕРКУ
// ============================================================
async function openBulkSendModal() {
  await UI.guard(
    { permission: ['bulk_send', 'manage_pipettes'], errorMsg: 'Нет прав на отправку' },
    async () => {
      const selected = [...selectedPipettes].filter(id =>
        pipettes.some(p => p.id === id)
      );

      const toSend = selected.filter(id => {
        const p = pipettes.find(x => x.id === id);
        return p && !p.sent_for_calibration && !p.replacing && isExternalCalibration(p.equipment_type);
      });

      if (toSend.length === 0) {
        const usedAsReplacement = selected.some(id => {
          const p = pipettes.find(x => x.id === id);
          return p && p.replacing;
        });
        if (usedAsReplacement) {
          showToast('Прибор используется как замена для другого. Сначала оформите возврат оригинала с поверки.', 'error');
        } else {
          showToast('Не выбрано ни одной единицы для внешней поверки.', 'error');
        }
        return;
      }

      _bulkSendIds = [...toSend];
      document.getElementById('bulk-send-count').textContent = toSend.length;

      // O(n) — Map вместо find
      const pipettesMap = new Map(pipettes.map(p => [p.id, p]));
      const listHtml = toSend.map(id => {
        const p = pipettesMap.get(id);
        if (!p) return '';
        return `<div style="padding:6px 0; border-bottom: 1px dashed var(--border-soft);">
          ${getDeviceIdentityHtml(p)}
        </div>`;
      }).join('');
      document.getElementById('bulk-send-list').innerHTML = listHtml;

      document.getElementById('bulk-send-date').value = todayStr();
      document.getElementById('bulk-send-note').value = '';

      UI.modal.open('bulk-send-modal');
      const btnAct = document.querySelector('#bulk-send-modal [onclick="printSendAct()"]');
      if (btnAct) btnAct.style.display = settings.printDocs?.actSend === false ? 'none' : '';

      // Блокировки — один запрос, в фоне
      (async () => {
        try {
          const r = await apiRequest('/pipettes/bulk-lock', 'POST', { ids: toSend });
          if (r.busy && r.busy.length > 0) {
            const names = r.busy.map(b => `${b.id} (${b.lockedBy})`).join(', ');
            showToast(`Уже редактируются другими: ${names}`, 'warn');
          }
          if (r.notFound && r.notFound.length > 0) {
            showToast(`Не найдены: ${r.notFound.join(', ')}`, 'warn');
          }
        } catch (e) {
          console.warn('bulk-lock error:', e.message);
        }
      })();

      // Замены — в фоне (только для типов, где замена разрешена)
      const idsForReplacement = toSend.filter(id => {
        const p = pipettes.find(x => x.id === id);
        return p && allowReplacement(p.equipment_type);
      });
      
      if (idsForReplacement.length > 0) {
        loadReplacementOptions(idsForReplacement);
      } else {
        document.getElementById('replacement-options').innerHTML = '';
      }
    }
  );
}

async function loadReplacementOptions(ids) {
  const container = document.getElementById('replacement-options');
  if (!container) return;

  container.innerHTML = '<p id="repl-placeholder" style="color:#94a3b8;font-size:.85rem;">Загрузка складских…</p>';

  // Формируем массив для батч-запроса
  const items = ids.map(id => {
    const p = pipettes.find(x => x.id === id);
    if (!p) return null;
    return {
      id: p.id,
      type: p.equipment_type,
      department: p.department || '',
    };
  }).filter(Boolean);

  if (items.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8;font-size:.85rem;">Нет приборов для загрузки замен.</p>';
    return;
  }

  try {
    const batchResult = await apiRequest('/pipettes/available-for-replacement-batch', 'POST', { items });

    let rendered = 0;
    let html = '';

    for (const id of ids) {
      const p = pipettes.find(x => x.id === id);
      if (!p) continue;
      const options = batchResult[id] || [];
      if (options.length === 0) continue;
      html += buildReplacementBlock(id, p, options);
      rendered++;
    }

    if (rendered === 0) {
      container.innerHTML = '<p style="color:#94a3b8;font-size:.85rem;">Нет доступных складских единиц того же типа.</p>';
    } else {
      container.innerHTML = html;
    }
  } catch (e) {
    console.warn('Ошибка загрузки замен:', e.message);
    container.innerHTML = '<p style="color:#dc2626;font-size:.85rem;">Ошибка загрузки замен: ' + esc(e.message) + '</p>';
  }
}

function buildReplacementBlock(id, p, options) {
  const safeName = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  let html = `<div class="card">
    <div class="card-title" style="margin-bottom: 8px;">${getDeviceIdentityHtml(p)}</div>

    <div class="text-muted-sm" style="margin-bottom:6px;">Складские того же типа:</div>
    <div class="flex-col">`;

  for (const opt of options) {
    html += `
      <label style="display:flex;align-items:center;gap:8px;padding:6px;background:var(--card);border-radius:6px;cursor:pointer;font-size:.82rem;">
        <input type="radio" name="repl-${safeName}" value="${esc(opt.id)}" data-for="${esc(id)}">
        <span><strong>${esc(opt.id)}</strong> — ${esc(opt.model)}
        ${opt.manufacturer ? `<span style="color:#94a3b8;">(${esc(opt.manufacturer)})</span>` : ''}
        ${opt.last_calibration ? `<span style="color:#94a3b8;margin-left:8px;">поверка: ${formatDate(opt.last_calibration)}</span>` : ''}
        </span>
      </label>`;
  }

  html += `
      <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;font-size:.82rem;color:#94a3b8;">
        <input type="radio" name="repl-${safeName}" value="" data-for="${esc(id)}" checked>
        <span>Без замены</span>
      </label>
    </div>
  </div>`;

  return html;
}

function closeBulkSendModal() {
  UI.modal.close('bulk-send-modal');
  if (_bulkSendIds.length > 0) {
    apiRequest('/pipettes/bulk-unlock', 'POST', { ids: _bulkSendIds }).catch(() => {});
  }
  _bulkSendIds = [];
}

async function saveBulkSend(e) {
  e.preventDefault();
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
        
  const toSend = _bulkSendIds.filter(id => {
    const p = pipettes.find(x => x.id === id);
    return p && !p.sent_for_calibration && !p.replacing && isExternalCalibration(p.equipment_type);
  });

  if (toSend.length === 0) {
    showToast('Не выбрано ни одной единицы для внешней поверки', 'error');
    return;
  }

  const sentDate = document.getElementById('bulk-send-date').value;
  const note = document.getElementById('bulk-send-note').value.trim();

  if (!sentDate) { showToast('Заполните поле «Дата отправки»', 'error'); return; }
  if (sentDate > todayStr()) {
    showToast('Дата не может быть в будущем', 'error');
    return;
  }

  if (toSend.length > 1) {
    const ok = await showConfirm(
      `Отправить на поверку ${toSend.length} единиц оборудования?`,
      { icon: '📦', title: 'Отправка на поверку', okText: 'Отправить', okClass: 'btn-warning' }
    );
    if (!ok) return;
  }

  const replacements = {};
  document.querySelectorAll('#replacement-options input[type="radio"]:checked').forEach(rb => {
    const forId = rb.dataset.for;
    if (rb.value) {
      // Защита: применяем замену только если для типа это разрешено
      const p = pipettes.find(x => x.id === forId);
      if (p && allowReplacement(p.equipment_type)) {
        replacements[forId] = rb.value;
      }
    }
  });

  try {
    const res = await apiRequest('/pipettes/bulk-send', 'POST', {
      ids: toSend, sentDate, note, replacements
    });

    let msg = `Отправлено на поверку: ${res.successful}`;
    if (res.skipped > 0) msg += `. Пропущено: ${res.skipped}`;
    if (res.skippedReplacements && res.skippedReplacements.length > 0) {
      msg += `. Замены не применены: ${res.skippedReplacements.length}`;
      console.warn('⚠️ Пропущенные замены:', res.skippedReplacements);
    }
    showToast(msg, res.successful > 0 ? 'success' : 'error');

    clearSelection();
    closeBulkSendModal();
    filterState = {};
    _filterRendered = false;
    currentPage = 1;
    await loadPipetteData();
    await loadStats();
  } catch (error) {
    showToast(error.message || 'Ошибка отправки', 'error');
  }
}

// ============================================================
// ПЕЧАТЬ АКТА ОТПРАВКИ
// ============================================================
async function printSendAct() {
  await refreshCurrentUser();
  if (!canManagePipettes()) return;
  if (settings.printDocs?.actSend === false) {
    showToast('Печать акта отправки отключена администратором', 'error');
    return;
  }

  const sendItems = _bulkSendIds.filter(id => {
    const p = pipettes.find(x => x.id === id);
    return p && !p.sent_for_calibration && !p.replacing && isExternalCalibration(p.equipment_type);
  });
  if (sendItems.length === 0) { showToast('Нет единиц для печати', 'error'); return; }

  const sentDate = document.getElementById('bulk-send-date').value || todayStr();
  const note = (document.getElementById('bulk-send-note').value || '').trim();
  const today = new Date().toLocaleDateString('ru-RU');
  const user = currentUser ? currentUser.fullName : '';
  const userPosition = currentUser ? (currentUser.position || '') : '';

  const fields = settings.printDocs?.actSendFields?.length
    ? settings.printDocs.actSendFields
    : ['id', 'model', 'manufacturer', 'serial', 'volume', 'department', 'responsible'];

  const fieldLabels = {
    id: 'Внутр. №', model: 'Модель', manufacturer: 'Производитель',
    serial: 'Серийный №', volume: 'Объём', department: 'Отдел',
    responsible: 'Ответственный', location: 'Место',
    cert: 'Свидетельство', notes: 'Примечание',
  };

  const renderCell = (p, field) => {
    switch (field) {
      case 'id':           return `<strong>${esc(p.id)}</strong>`;
      case 'volume':       return p.volume ? esc(p.volume) + ' мкл' : '—';
      case 'model':        return esc(p.model);
      default:             return esc(p[field] || '—');
    }
  };

  const headerCells = fields.map(f => `<th>${esc(fieldLabels[f] || f)}</th>`).join('');
  const rows = sendItems.map((id, i) => {
    const p = pipettes.find(x => x.id === id);
    if (!p) return '';
    const cells = fields.map(f => `<td>${renderCell(p, f)}</td>`).join('');
    return `<tr><td style="text-align:center;">${i + 1}</td>${cells}<td style="width:50px;"></td></tr>`;
  }).join('');

  const win = window.open('', '_blank');
  if (!win) { showToast('Разрешите всплывающие окна', 'error'); return; }
  win.document.write(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <title>Акт отправки — ${today}</title>
      <style>
        @page { size: A4 landscape; margin: 15mm 12mm; }
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1a1a2e; }
        h1 { font-size: 15pt; text-align: center; margin: 0 0 6px; }
        .subtitle { font-size: 10pt; text-align: center; color: #64748b; margin-bottom: 20px; }
        .meta { padding: 10px 12px; background: #f8fafc; border-radius: 6px; margin-bottom: 15px; font-size: 9.5pt; }
        .meta div { margin-bottom: 3px; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 10px; }
        th { background: #1e293b; color: #fff; padding: 8px 6px; text-align: left; font-size: 8.5pt; text-transform: uppercase; -webkit-print-color-adjust: exact; }
        td { padding: 8px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        tr:nth-child(even) td { background: #f8fafc; }
        small { color: #94a3b8; font-size: 8pt; }
        .footer { margin-top: 30px; font-size: 9.5pt; }
        .signatures { margin-top: 40px; display: flex; justify-content: space-between; }
        .sig-block { width: 45%; }
        .sig-line { border-bottom: 1px solid #000; height: 30px; margin-bottom: 5px; }
        .sig-label { font-size: 8.5pt; color: #64748b; text-align: center; }
      </style>
    </head>
    <body>
      <h1>АКТ ОТПРАВКИ НА ПОВЕРКУ</h1>
      <div class="subtitle">КГБУЗ Краевая клиническая больница · Клинико-диагностическая лаборатория</div>
      <div class="meta">
        <div>Дата отправки: <b>${formatDate(sentDate)}</b></div>
        <div>Количество приборов: <b>${sendItems.length}</b></div>
        <div>Организация: <b>ФБУ «Красноярский ЦСМ»</b></div>
        <div>Дата печати: <b>${today}</b></div>
      </div>
      <table>
        <thead><tr><th style="width:5%;text-align:center;">№</th>${headerCells}<th style="width:10%;">Прим.</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${note ? `<div class="meta" style="margin-top:15px;"><b>Примечание:</b> ${esc(note)}</div>` : ''}
      <div class="footer">
        <div>Документ сформировал: <b>${esc(userPosition)}, ${esc(user)}</b></div>
        <div style="margin-top:6px;">Подпись: _______________</div>
      </div>
      <div class="signatures">
        <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Сдал (ФИО, подпись)</div></div>
        <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Принял (ФИО, подпись)</div></div>
      </div>
    </body>
    </html>
  `);
  win.document.close();
  showToast('Окно печати открыто', 'success');
}

// ============================================================
// МАССОВЫЙ ВОЗВРАТ С ПОВЕРКИ
// ============================================================
async function openBulkReturnModal() {
  await UI.guard(
    { permission: ['bulk_return', 'manage_pipettes'], errorMsg: 'Нет прав на возврат' },
    async () => {
      const selected = [...selectedPipettes].filter(id =>
        pipettes.some(p => p.id === id)
      );

      const sentItems = selected
        .map(id => pipettes.find(x => x.id === id))
        .filter(p => p && p.sent_for_calibration && isExternalCalibration(p.equipment_type));

      if (sentItems.length === 0) {
        showToast('Не выбрано ни одной единицы со статусом «На поверке»', 'error');
        return;
      }

      _bulkReturnIds = sentItems.map(p => p.id);

      document.getElementById('bulk-return-count').textContent = sentItems.length;

      const container = document.getElementById('bulk-return-items-container');
      container.innerHTML = `
      <div class="card-title" style="margin-bottom:8px;">
          Свидетельства по оборудованию:
       </div>
          <table class="field-settings-table">
            <thead>
              <tr>
                <th style="width:35%;">ID / Модель</th>
                <th style="width:40%;">Номер свидетельства</th>
                <th style="width:25%;">Результат</th>
              </tr>
            </thead>
            <tbody>
              ${sentItems.map(p => `
                <tr>
                  <td>
                    ${getDeviceIdentityHtml(p)}
                    <br><small style="color:${COLORS.info}; margin-top:4px; display:inline-block;"><i class="fa-solid fa-box"></i> отпр. ${formatDate(p.sent_for_calibration)}</small>
                  </td>
                  <td>
                    <input type="text" class="bulk-return-cert-input" 
                           data-id="${esc(p.id)}" 
                           placeholder="напр. С-АБ-...">
                  </td>
                  <td>
                    <select class="bulk-return-result-input" data-id="${esc(p.id)}">
                      <option value="pass">✅ Годен</option>
                      <option value="fail">❌ Брак</option>
                      <option value="wip">⏳ В процессе</option>
                    </select>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;

      document.getElementById('bulk-return-date').value = todayStr();
      document.getElementById('bulk-return-org').value = '';
      document.getElementById('bulk-return-result').value = 'pass';
      document.getElementById('bulk-return-note').value = '';
      document.getElementById('bulk-return-cert').value = '';
      document.getElementById('bulk-return-single-cert').checked = false;
      toggleSingleCert(false);

      renderReturnReplacements(sentItems);

      UI.modal.open('bulk-return-modal');

      const btnAct = document.querySelector('#bulk-return-modal [onclick="printReturnAct()"]');
      if (btnAct) btnAct.style.display = settings.printDocs?.actReturn === false ? 'none' : '';

      // Блокировки — один запрос, в фоне
      (async () => {
        try {
          const r = await apiRequest('/pipettes/bulk-lock', 'POST', { ids: _bulkReturnIds });
          if (r.busy && r.busy.length > 0) {
            const names = r.busy.map(b => `${b.id} (${b.lockedBy})`).join(', ');
            showToast(`Уже редактируются другими: ${names}`, 'warn');
          }
        } catch (e) {
          console.warn('bulk-lock error:', e.message);
        }
      })();
    }
  );
}

function renderReturnReplacements(sentItems) {
  const container = document.getElementById('return-replacements');
  if (!container) return;

  const withRepl = sentItems.filter(p => p.replaced_by);
  if (withRepl.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  let html = `<div class="info-block" style="margin:15px 0;">
    <div class="sub-title" style="color:#1e40af;margin-bottom:8px;">
      <i class="fa-solid fa-arrows-rotate"></i> На время поверки было выдано со склада:
    </div>`;

  withRepl.forEach(p => {
    html += `
      <label style="display:flex;align-items:flex-start;gap:8px;padding:6px;background:var(--card);border-radius:6px;margin-bottom:4px;cursor:pointer;">
        <input type="checkbox" class="return-repl-cb" value="${esc(p.id)}" checked style="margin-top:3px;">
        <span>
          <strong>${esc(p.id)}</strong> → было заменено на
          <strong>${esc(p.replaced_by)}</strong>
          <br><small style="color:#64748b;">Вернуть замену на склад (Склад, не активна)</small>
          <br><small style="color:#f59e0b;">Снятие галочки оставит замену в работе</small>
        </span>
      </label>`;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function closeBulkReturnModal() {
  UI.modal.close('bulk-return-modal');
  if (_bulkReturnIds.length > 0) {
    apiRequest('/pipettes/bulk-unlock', 'POST', { ids: _bulkReturnIds }).catch(() => {});
  }
  _bulkReturnIds = [];
}

function toggleSingleCert(checked) {
  document.getElementById('bulk-return-common-cert').style.display = checked ? 'block' : 'none';

  document.querySelectorAll('.bulk-return-cert-input').forEach(inp => {
    inp.disabled = checked;
    inp.style.opacity = checked ? '0.4' : '1';
    if (checked) inp.value = '';
  });
}

function applyBulkReturnResult(result) {
  document.querySelectorAll('.bulk-return-result-input').forEach(sel => {
    sel.value = result;
  });
}

async function saveBulkReturn(e) {
  e.preventDefault();
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }

  const date = document.getElementById('bulk-return-date').value;
  const org = document.getElementById('bulk-return-org').value.trim();
  const commonResult = document.getElementById('bulk-return-result').value;
  const note = document.getElementById('bulk-return-note').value.trim();
  const singleCert = document.getElementById('bulk-return-single-cert').checked;
  const commonCert = document.getElementById('bulk-return-cert').value.trim();

  if (!date) { showToast('Заполните поле «Дата поверки»', 'error'); return; }
  if (date > todayStr()) {
    showToast('Дата не может быть в будущем', 'error');
    return;
  }
  if (singleCert && !commonCert) {
    showToast('Укажите общий номер свидетельства', 'error');
    return;
  }

  const sentIds = _bulkReturnIds.filter(id => {
    const p = pipettes.find(x => x.id === id);
    return p && p.sent_for_calibration && isExternalCalibration(p.equipment_type);
  });

  const items = sentIds.map(id => {
    const certInput = document.querySelector(`.bulk-return-cert-input[data-id="${id}"]`);
    const resultInput = document.querySelector(`.bulk-return-result-input[data-id="${id}"]`);
    return {
      id,
      cert: singleCert ? commonCert : (certInput ? certInput.value.trim() : ''),
      result: resultInput ? resultInput.value : commonResult
    };
  });

  if (!singleCert) {
    const missingCert = items.filter(it => !it.cert);
    if (missingCert.length > 0) {
      const okMissing = await showConfirm(   
        `У ${missingCert.length} пипеток не указано свидетельство. Продолжить?`,  
        { icon: '⚠️', title: 'Нет свидетельства', okText: 'Продолжить', okClass: 'btn-warning' } 
      ); 
      if (!okMissing) return;
    }
  }

  if (items.length > 1) {
    const ok = await showConfirm(
      `Применить возврат для ${items.length} единиц оборудования?`,
      { icon: '📥', title: 'Возврат с поверки', okText: 'Применить', okClass: 'btn-success' }
    );
    if (!ok) return;
  }

  const returnReplacements = [];
  document.querySelectorAll('.return-repl-cb:checked').forEach(cb => {
    returnReplacements.push(cb.value);
  });

  try {
    const res = await apiRequest('/pipettes/bulk-return', 'POST', {
      items, date, org, note, returnReplacements
    });

    let msg = res.message || `Возврат оформлен для ${items.length} единиц`;
    let toastType = 'success';
    if (res.missingReplacements && res.missingReplacements.length > 0) {
      msg += `. ⚠️ Замены не возвращены на склад: ${res.missingReplacements.length}`;
      toastType = 'error';
      console.warn('⚠️ Пропущенные замены:', res.missingReplacements);
    }
    showToast(msg, toastType);

    clearSelection();
    closeBulkReturnModal();

    filterState = {};
    _filterRendered = false;
    currentPage = 1;

    const calFilter = _activeFilters.find(f => f.type === 'date-period');
    if (calFilter && date) {
      filterState[calFilter.id] = {
        type: 'last_calibration',
        period: 'custom',
        from: date,
        to: date
      };
    }
    
    await loadPipetteData();
    await loadStats();

    if (calFilter && date) {
      showToast(`Таблица отфильтрована по дате ${date}. Сбросьте фильтр, чтобы увидеть всё.`, 'warn');
    } else if (date) {
      showToast(`Возврат оформлен на ${date}. Если не видите приборы — проверьте фильтры.`, 'success');
    }

    applyFilterStateToPanel();
  } catch (error) {
    showToast(error.message || 'Ошибка сохранения', 'error');
  }
}

// ============================================================
// МАССОВАЯ СМЕНА ОТВЕТСТВЕННОГО
// ============================================================
let _bulkResponsibleIds = [];

async function openBulkResponsibleModal() {
  await UI.guard(
    { permission: ['bulk_change_responsible', 'manage_pipettes'], errorMsg: 'Нет прав на смену ответственного' },
    async () => {
      const selected = [...selectedPipettes].filter(id =>
        pipettes.some(p => p.id === id)
      );

      if (selected.length === 0) {
        showToast('Не выбрано ни одной единицы', 'error');
        return;
      }

      _bulkResponsibleIds = [...selected];

      document.getElementById('bulk-responsible-count').textContent = selected.length;
      document.getElementById('bulk-responsible-error').textContent = '';

      const sel = document.getElementById('bulk-responsible-select');
      sel.innerHTML = '<option value="">— выберите —</option>';

      const names = new Set();
      if (Array.isArray(_responsibles)) {
        for (const u of _responsibles) {
          if (u.fullName) names.add(u.fullName);
        }
      }
      for (const p of pipettes) {
        if (p.responsible) names.add(p.responsible);
      }

      const sorted = [...names].sort((a, b) => a.localeCompare(b, 'ru'));
      for (const name of sorted) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      }

      UI.modal.open('bulk-responsible-modal');

      // Блокировки — один запрос, в фоне
      (async () => {
        try {
          const r = await apiRequest('/pipettes/bulk-lock', 'POST', { ids: _bulkResponsibleIds });
          if (r.busy && r.busy.length > 0) {
            const names = r.busy.map(b => `${b.id} (${b.lockedBy})`).join(', ');
            showToast(`Уже редактируются другими: ${names}`, 'warn');
          }
        } catch (e) {
          console.warn('bulk-lock error:', e.message);
        }
      })();
    }
  );
}

function closeBulkResponsibleModal() {
  UI.modal.close('bulk-responsible-modal');
  if (_bulkResponsibleIds.length > 0) {
    apiRequest('/pipettes/bulk-unlock', 'POST', { ids: _bulkResponsibleIds }).catch(() => {});
  }
  _bulkResponsibleIds = [];
}

async function saveBulkResponsible(e) {
  e.preventDefault();
  await refreshCurrentUser();
  if (!canBulkChangeResponsible()) {
    showToast('Нет прав на смену ответственного', 'error');
    return;
  }

  const newResp = document.getElementById('bulk-responsible-select').value.trim();
  const errEl = document.getElementById('bulk-responsible-error');
  errEl.textContent = '';

  if (!newResp) {
    errEl.textContent = 'Выберите ответственного';
    return;
  }

  const ids = _bulkResponsibleIds.filter(id =>
    pipettes.some(p => p.id === id)
  );

  if (ids.length === 0) {
    errEl.textContent = 'Ничего не выбрано';
    return;
  }

  const ok = await showConfirm(
    `Назначить «${newResp}» ответственным за ${ids.length} единиц оборудования?\n\n` +
    `Отдел не меняется.`,
    { icon: '👤', title: 'Смена ответственного', okText: 'Применить', okClass: 'btn-primary' }
  );
  if (!ok) return;

  try {
    const res = await apiRequest('/pipettes/bulk-change-responsible', 'POST', {
      ids,
      newResponsible: newResp,
    });

    let msg = `Ответственный изменён у ${res.successful} единиц`;
    if (res.skipped > 0) msg += `. Пропущено: ${res.skipped}`;
    showToast(msg, res.successful > 0 ? 'success' : 'error');

    clearSelection();
    closeBulkResponsibleModal();
    await loadPipetteData();
  } catch (e) {
    if (e.status === 409) { return; }
    errEl.textContent = e.message || 'Ошибка';
  }
}

async function printReturnAct() {
  await refreshCurrentUser();
  if (!canManagePipettes()) return;
  if (settings.printDocs?.actReturn === false) {
    showToast('Печать акта возврата отключена администратором', 'error');
    return;
  }

  if (!_bulkReturnIds || _bulkReturnIds.length === 0) {
    showToast('Нет единиц для печати', 'error');
    return;
  }

  const returnDate = document.getElementById('bulk-return-date').value || todayStr();
  const org = (document.getElementById('bulk-return-org').value || '').trim() || 'ФБУ «Красноярский ЦСМ»';
  const singleCert = document.getElementById('bulk-return-single-cert').checked;
  const commonCert = (document.getElementById('bulk-return-cert').value || '').trim();
  const today = new Date().toLocaleDateString('ru-RU');
  const user = currentUser ? currentUser.fullName : '';
  const userPosition = currentUser ? (currentUser.position || '') : '';
  const note = (document.getElementById('bulk-return-note').value || '').trim();

  const fields = settings.printDocs?.actReturnFields?.length
    ? settings.printDocs.actReturnFields
    : ['id', 'model', 'manufacturer', 'serial', 'volume', 'department', 'cert', 'result'];

  const fieldLabels = {
    id: 'Внутр. №', model: 'Модель', manufacturer: 'Производитель',
    serial: 'Серийный №', volume: 'Объём', department: 'Отдел',
    responsible: 'Ответственный', cert: 'Свидетельство',
    result: 'Результат', notes: 'Примечание',
  };

  const renderCell = (id, field) => {
    const p = pipettes.find(x => x.id === id);
    if (!p) return '—';
    if (field === 'id') return `<strong>${esc(id)}</strong>`;
    if (field === 'volume') return p.volume ? esc(p.volume) + ' мкл' : '—';
    if (field === 'model') return esc(p.model);
    if (field === 'cert') {
      const ci = document.querySelector(`.bulk-return-cert-input[data-id="${id}"]`);
      const v = singleCert ? commonCert : (ci ? ci.value.trim() : '');
      return esc(v || '—');
    }
    if (field === 'result') {
      const rs = document.querySelector(`.bulk-return-result-input[data-id="${id}"]`);
      const v = rs ? rs.value : 'pass';
      return v === 'pass' ? 'Годен' : v === 'fail' ? 'Брак' : 'В процессе';
    }
    return esc(p[field] || '—');
  };

  const headerCells = fields.map(f => `<th>${esc(fieldLabels[f] || f)}</th>`).join('');
  const rows = _bulkReturnIds.map((id, i) => {
    const cells = fields.map(f => `<td>${renderCell(id, f)}</td>`).join('');
    return `<tr><td style="text-align:center;">${i + 1}</td>${cells}</tr>`;
  }).join('');

  const win = window.open('', '_blank');
  if (!win) { showToast('Разрешите всплывающие окна', 'error'); return; }
  win.document.write(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <title>Акт возврата — ${today}</title>
      <style>
        @page { size: A4 landscape; margin: 15mm 12mm; }
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1a1a2e; }
        h1 { font-size: 15pt; text-align: center; margin: 0 0 6px; }
        .subtitle { font-size: 10pt; text-align: center; color: #64748b; margin-bottom: 20px; }
        .meta { padding: 10px 12px; background: #f8fafc; border-radius: 6px; margin-bottom: 15px; font-size: 9.5pt; }
        .meta div { margin-bottom: 3px; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 10px; }
        th { background: #1e293b; color: #fff; padding: 8px 6px; text-align: left; font-size: 8.5pt; text-transform: uppercase; -webkit-print-color-adjust: exact; }
        td { padding: 8px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        tr:nth-child(even) td { background: #f8fafc; }
        small { color: #94a3b8; font-size: 8pt; }
        .footer { margin-top: 30px; font-size: 9.5pt; }
        .signatures { margin-top: 40px; display: flex; justify-content: space-between; }
        .sig-block { width: 45%; }
        .sig-line { border-bottom: 1px solid #000; height: 30px; margin-bottom: 5px; }
        .sig-label { font-size: 8.5pt; color: #64748b; text-align: center; }
      </style>
    </head>
    <body>
      <h1>АКТ ВОЗВРАТА С ПОВЕРКИ</h1>
      <div class="subtitle">КГБУЗ Краевая клиническая больница · Клинико-диагностическая лаборатория</div>
      <div class="meta">
        <div>Дата поверки: <b>${formatDate(returnDate)}</b></div>
        <div>Количество приборов: <b>${_bulkReturnIds.length}</b></div>
        <div>Поверяющая организация: <b>${esc(org)}</b></div>
        <div>Дата печати: <b>${today}</b></div>
      </div>
      <table>
        <thead><tr><th style="width:5%;text-align:center;">№</th>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${note ? `<div class="meta" style="margin-top:15px;"><b>Примечание:</b> ${esc(note)}</div>` : ''}
      <div class="footer">
        <div>Документ сформировал: <b>${esc(userPosition)}, ${esc(user)}</b></div>
        <div style="margin-top:6px;">Подпись: _______________</div>
      </div>
      <div class="signatures">
        <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Сдал (ФИО, подпись)</div></div>
        <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Принял (ФИО, подпись)</div></div>
      </div>
    </body>
    </html>
  `);
  win.document.close();
  showToast('Окно печати открыто', 'success');
}
