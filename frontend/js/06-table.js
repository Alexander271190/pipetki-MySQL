'use strict';

// ============================================================
// ГЛАВНЫЙ РЕНДЕР
// ============================================================
function render() {
  const totalPages = pagedState.totalPages;
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  renderPagination();
  renderCounters();

  const columns = getActiveTableColumns().filter(col => !!findColumn(col));
  const hasAnyRowAction =
    canViewHistory() || canEditPipette() || canDeletePipette() || canQuickCal();

  renderTableHeader(columns, hasAnyRowAction);
  renderTableBody(pagedState.items, columns, hasAnyRowAction);

  updateSortArrows();
  updateSelectAllCheckbox();
  updateBulkCalButton();
}

// ============================================================
// ПАГИНАЦИЯ
// ============================================================
function renderPagination() {
  const totalPages = pagedState.totalPages;
  const total = pagedState.total;

  const pageCurrentEl = document.getElementById('page-current');
  const pageTotalEl = document.getElementById('page-total');
  const pageCountEl = document.getElementById('page-count');
  const pagePrevEl = document.getElementById('page-prev');
  const pageNextEl = document.getElementById('page-next');

  if (pageCurrentEl) pageCurrentEl.textContent = currentPage;
  if (pageTotalEl)   pageTotalEl.textContent = totalPages;
  if (pageCountEl)   pageCountEl.textContent = total;
  if (pagePrevEl)    pagePrevEl.disabled = currentPage <= 1;
  if (pageNextEl)    pageNextEl.disabled = currentPage >= totalPages;

  const paginationEl = document.getElementById('pagination');
  if (paginationEl) {
    paginationEl.style.display = total > pageSize ? 'flex' : 'none';
  }
}

// ============================================================
// СЧЁТЧИКИ + ТУЛТИП + БАННЕР
// ============================================================
function renderCounters() {
  const c = pagedState.counters || { ok: 0, warn: 0, danger: 0, total: 0 };
  const statOkEl = document.getElementById('stat-ok');
  const statWarnEl = document.getElementById('stat-warn');
  const statDangerEl = document.getElementById('stat-danger');
  const statTotalEl = document.getElementById('stat-total');

  if (statOkEl)     statOkEl.textContent = c.ok;
  if (statWarnEl)   statWarnEl.textContent = c.warn;
  if (statDangerEl) statDangerEl.textContent = c.danger;
  if (statTotalEl)  statTotalEl.textContent = c.total;

  // Тултип на «Всего»
  if (statTotalEl) {
    const sumIn = (c.ok || 0) + (c.warn || 0) + (c.danger || 0);
    const outside = (c.total || 0) - sumIn;
    const tipEl = document.getElementById('stat-tooltip');
    
    if (tipEl) {
      let html = `
        <div class="tooltip-row tooltip-total">
          <span>Всего:</span> <strong>${c.total}</strong>
        </div>
        <div class="tooltip-row"><span>🟢 В норме:</span> <span>${c.ok}</span></div>
        <div class="tooltip-row"><span>🟡 Скоро поверка:</span> <span>${c.warn}</span></div>
        <div class="tooltip-row"><span>🔴 Просрочены:</span> <span>${c.danger}</span></div>
      `;
      
      if (outside > 0) {
        // Категории «вне индикаторов»
        const allCategories = [
          { label: '📦 На поверке',        value: c.sent || 0 },
          { label: '⏳ В процессе',         value: c.wip || 0 },
          { label: '❌ Брак',               value: c.fail || 0 },
          { label: '❓ Без даты поверки',   value: c.unknownDate || 0 },
          { label: '⛔ Неактивные',         value: c.inactive || 0 },
        ];
        
       const visibleLines = allCategories
        .filter(cat => cat.value > 0)
        .map(cat => `
          <div class="tooltip-row" style="font-size:0.78rem;">
            <span>${cat.label}:</span> <b>${cat.value}</b>
          </div>
        `);
      
      const sumCategories = allCategories.reduce((sum, cat) => sum + cat.value, 0);
      
      // Если сумма не сходится — показываем «Прочее»
      const diff = outside - sumCategories;
      if (diff > 0) {
        visibleLines.push(`
          <div class="tooltip-row" style="font-size:0.78rem; color:#94a3b8;">
            <span>Прочее:</span> <b>${diff}</b>
          </div>
        `);
      }
      
      if (visibleLines.length === 0) {
        visibleLines.push(`<div class="tooltip-row" style="font-size:0.78rem;"><span>— (нет данных)</span></div>`);
      }
      
      html += `
        <div class="tooltip-outside">
          <div class="tooltip-row" style="font-weight:600; margin-bottom: 4px; color: var(--warn);">
            <span>Вне индикаторов:</span> <b>${outside}</b>
          </div>
          <div style="font-size:0.78rem; line-height: 1.5; color: var(--text);">
            ${visibleLines.join('')}
          </div>
        </div>
      `;
      }
      
      tipEl.innerHTML = html;
    }
  }

  // Баннер просрочек
  const banner = document.getElementById('alert-banner');
  const alertText = document.getElementById('alert-text');
  if (banner) {
    if (c.danger > 0) {
      if (alertText) alertText.textContent = `У ${c.danger} ${c.danger === 1 ? 'единицы' : 'единиц'} проблема с поверкой!`;
      banner.classList.add('show');
    } else if (c.warn > 0) {
      if (alertText) alertText.textContent = `У ${c.warn} ${c.warn === 1 ? 'единицы' : 'единиц'} подходит срок поверки в течение ${settings.warnDays} дн.`;
      banner.classList.add('show');
    } else {
      banner.classList.remove('show');
    }
  }
}

// ============================================================
// ЗАГОЛОВОК ТАБЛИЦЫ (thead)
// ============================================================
function renderTableHeader(columns, hasAnyRowAction) {
  const table = document.getElementById('pipettes-table');
  if (!table) return;
  const thead = table.querySelector('thead tr');
  if (!thead) return;

  thead.innerHTML = `
    <th class="col-checkbox">
      <input type="checkbox" id="select-all-checkbox" onclick="toggleSelectAll(this.checked)" title="Выбрать все">
    </th>
    ${columns.map(col => {
      const def = findColumn(col);
      if (def.sortable) {
        return `<th onclick="sortBy('${def.field}')">${esc(def.label)} <span class="sort-arrow" data-field="${def.field}"></span></th>`;
      }
      return `<th>${esc(def.label)}</th>`;
    }).join('')}
    <th id="actions-header" ${!hasAnyRowAction ? 'style="display:none"' : ''}>Действия</th>
  `;
}

// ============================================================
// ТЕЛО ТАБЛИЦЫ (tbody)
// ============================================================
function renderTableBody(items, columns, hasAnyRowAction) {
  const tbody = document.getElementById('pipettes-body');
  const empty = document.getElementById('empty-state');
  const table = document.getElementById('pipettes-table');
  if (!tbody || !table) return;

  if (items.length === 0) {
    tbody.innerHTML = '';
    table.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      if (pagedState.total > 0) {
        empty.querySelector('p').textContent = 'Ничего не найдено по фильтру.';
      } else if (pagedState.total === 0 && !document.getElementById('search')?.value && Object.keys(filterState || {}).length === 0) {
        empty.querySelector('p').textContent = 'Оборудования пока нет. Нажмите «Добавить оборудование», чтобы начать.';
      } else {
        empty.querySelector('p').textContent = 'Ничего не найдено по фильтру.';
      }
    }
    return;
  }
  table.style.display = '';
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = items.map(p => {
    const status = calcStatus(p);
    const next = getNextDate(p);
    const dl = daysLeft(p);
    const daysText = status === 'inactive' || status === 'sent' || status === 'wip' || status === 'unknown' ? '' :
      status === 'fail' ? ' (брак)' :
      status === 'danger' ? ` (просрочка ${Math.abs(dl)} дн.)` :
      ` (${dl} дн.)`;
    const isChecked = selectedPipettes.has(p.id) ? 'checked' : '';

    const _canEdit     = canEditPipette();
    const _canDelete   = canDeletePipette();
    const _canQuickCal = canQuickCal();
    const _canHistory  = canViewHistory();

    const hasAnyAction = _canHistory || _canEdit || _canDelete || _canQuickCal;

    let actionsHtml = '';
    if (hasAnyAction) {
      actionsHtml = `<button class="row-actions-btn" onclick="openRowActions(event, '${esc(p.id)}')" title="Действия"><i class="fa-solid fa-ellipsis-vertical"></i></button>`;
    }

    const cellsHtml = columns.map(colId => {
      switch (colId) {
        case 'id': {
          const statusDot = UI.renderStatusDot(status);
          let replLine = '';
          if (p.replaced_by && p.replacement) {
            replLine = `<br><small style="color:${COLORS.info};">↔ замена: ${esc(p.replaced_by)}</small>`;
          } else if (p.replaced_by) {
            replLine = `<br><small style="color:${COLORS.danger};">⚠ замена удалена: ${esc(p.replaced_by)}</small>`;
          }
          if (p.replacing && p.replacedFor) {
            replLine = `<br><small style="color:${COLORS.warning};">↔ заменяет: ${esc(p.replacing)}</small>`;
          }
          return `<td><span class="id-cell"><strong>${esc(p.id)}</strong>${statusDot}</span>${replLine}</td>`;
        }
        case 'type': {
          const t = _equipmentTypes.find(x => x.value === p.equipment_type);
          const label = t ? t.label : 'Прочее';
          const cls   = p.equipment_type === 'pipette' ? 'badge-pipette' : 'badge-other';
          return `<td><span class="badge-type ${cls}">${esc(label)}</span></td>`;
        }
        case 'model':
          return `<td>${esc(p.model)}${p.manufacturer ? `<br><small style="color:#94a3b8">${esc(p.manufacturer)}</small>` : ''}</td>`;
        case 'volume':
          return `<td>${p.volume ? esc(p.volume) + ' мкл' : '—'}</td>`;
        case 'department':
          return `<td>${esc(p.department || '—')}</td>`;
        case 'lastCalibration':
          return `<td>${formatDate(p.last_calibration)}</td>`;
        case 'nextCalibration':
          return `<td>${status === 'sent'
            ? `<small style="color:${COLORS.info};font-weight:600;"><i class="fa-solid fa-box"></i> ${formatDate(p.sent_for_calibration)}</small>`
            : status === 'wip'
            ? `<small style="color:${COLORS.warning};font-weight:600;"><i class="fa-solid fa-hourglass-half"></i> В процессе поверки</small>`
            : status === 'unknown'
            ? `<small style="color:${COLORS.faint};">Дата не задана</small>`
            : `${formatDate(next)}${daysText ? `<br><small style="color:${status === 'danger' || status === 'fail' ? COLORS.danger : status === 'warn' ? COLORS.warning : COLORS.success}">${daysText}</small>` : ''}`}</td>`;
        case 'responsible':
          return `<td>${esc(p.responsible || '—')}${p.location ? `<br><small style="color:#94a3b8">${esc(p.location)}</small>` : ''}</td>`;
        case 'location':
          return `<td>${esc(p.location || '—')}</td>`;
        case 'manufacturer':
          return `<td>${esc(p.manufacturer || '—')}</td>`;
        case 'serial':
          return `<td>${esc(p.serial || '—')}</td>`;
        case 'cert':
          return `<td>${esc(p.cert || '—')}</td>`;
        case 'status':
          return `<td>${UI.renderStatusBadge(status)}</td>`;
        case 'interval':
          return `<td>${p.interval != null ? esc(p.interval) + ' мес.' : '—'}</td>`;
        case 'notes':
          return `<td>${esc(p.notes || '—')}</td>`;
        case 'result':
          return `<td>${esc(RESULT_LABELS[p.last_result] || p.last_result || '—')}</td>`;
        case 'active':
          return `<td>${p.active ? 'В работе' : 'Не используется'}</td>`;
        default: {
          const raw = p[colId];
          const val = (raw === undefined || raw === null || raw === '') ? '—' : esc(raw);
          return `<td>${val}</td>`;
        }
      }
    }).join('');

    const rowClass =
      status === 'danger' ? 'row-danger' :
      status === 'fail' ? 'row-fail' :
      status === 'warn' ? 'row-warn' :
      '';

    return `<tr class="${rowClass}">
      <td class="col-checkbox">
         <input type="checkbox" class="row-checkbox" data-id="${esc(p.id)}" ${isChecked}
         onchange="togglePipetteSelection('${esc(p.id)}', this.checked)">
      </td>
      ${cellsHtml}
      <td ${!hasAnyAction ? 'style="display:none"' : ''}>${actionsHtml}</td>
    </tr>`;
  }).join('');
}

// ============================================================
// ОБНОВЛЕНИЕ СТРЕЛОЧЕК СОРТИРОВКИ
// ============================================================
function updateSortArrows() {
  document.querySelectorAll('th .sort-arrow').forEach(el => {
    const f = el.dataset.field;
    if (f === sortField) el.textContent = sortDir > 0 ? '▲' : '▼';
    else el.textContent = '';
  });
}

// ============================================================
// СОРТИРОВКА — на сервер
// ============================================================
async function sortBy(field) {
  if (sortField === field) sortDir *= -1;
  else { sortField = field; sortDir = 1; }
  currentPage = 1;
  clearSelection();   
  await loadPaged();
  render();
}

// ============================================================
// ПАГИНАЦИЯ — на сервер
// ============================================================
async function changePage(delta) {
  const newPage = currentPage + delta;
  if (newPage < 1 || newPage > pagedState.totalPages) return;
  currentPage = newPage;
  clearSelection();   
  await loadPaged();
  render();
}

// ============================================================
// МАССОВЫЙ ВЫБОР (в пределах текущей страницы)
// ============================================================
function togglePipetteSelection(id, checked) {
  if (checked) selectedPipettes.add(id);
  else selectedPipettes.delete(id);
  updateSelectAllCheckbox();
  updateBulkCalButton();
}

function getVisiblePageIds() {
  return pipettes.map(p => p.id);
}

function toggleSelectAll(checked) {
  const pageIds = getVisiblePageIds();
  if (checked) {
    pageIds.forEach(id => selectedPipettes.add(id));
  } else {
    pageIds.forEach(id => selectedPipettes.delete(id));
  }
  document.querySelectorAll('.row-checkbox').forEach(cb => {
    cb.checked = checked;
  });
  updateBulkCalButton();
}

function updateSelectAllCheckbox() {
  const pageIds = getVisiblePageIds();
  const master = document.getElementById('select-all-checkbox');
  if (!master) return;

  if (pageIds.length === 0) {
    master.checked = false;
    master.indeterminate = false;
    master.disabled = true;
    return;
  }

  const selectedOnPage = pageIds.filter(id => selectedPipettes.has(id));
  master.disabled = false;

  if (selectedOnPage.length === 0) {
    master.checked = false;
    master.indeterminate = false;
  } else if (selectedOnPage.length === pageIds.length) {
    master.checked = true;
    master.indeterminate = false;
  } else {
    master.checked = false;
    master.indeterminate = true;
  }
}

function updateBulkCalButton() {
  const btnSend = document.getElementById('btn-bulk-cal');
  const btnReturn = document.getElementById('btn-bulk-return');
  const btnResponsible = document.getElementById('btn-bulk-responsible');
  const counterSend = document.getElementById('bulk-counter');
  const counterReturn = document.getElementById('bulk-return-counter');
  const counterResponsible = document.getElementById('bulk-responsible-counter');

  const visibleSelected = [...selectedPipettes].filter(id => pipettes.some(p => p.id === id));

  const toSend = visibleSelected.filter(id => {
  const p = pipettes.find(x => x.id === id);
  return p && !p.sent_for_calibration && !p.replacing && isExternalCalibration(p.equipment_type);
  });
  const toReturn = visibleSelected.filter(id => {
    const p = pipettes.find(x => x.id === id);
    return p && p.sent_for_calibration && isExternalCalibration(p.equipment_type);
  });

  if (btnSend) {
    if (canBulkSend() && toSend.length > 0) {
      btnSend.style.display = 'inline-flex';
      const hint = toSend.length < selectedPipettes.size ? `${toSend.length} / ${selectedPipettes.size}` : toSend.length;
      if (counterSend) counterSend.textContent = hint;
    } else {
      btnSend.style.display = 'none';
    }
  }

  if (btnReturn) {
    if (canBulkReturn() && toReturn.length > 0) {
      btnReturn.style.display = 'inline-flex';
      if (counterReturn) counterReturn.textContent = toReturn.length;
    } else {
      btnReturn.style.display = 'none';
    }
  }

  if (btnResponsible) {
    if (canBulkChangeResponsible() && visibleSelected.length > 0) {
      btnResponsible.style.display = 'inline-flex';
      if (counterResponsible) counterResponsible.textContent = visibleSelected.length;
    } else {
      btnResponsible.style.display = 'none';
    }
  }
  updateBulkToolbar();
}

function clearSelection() {
  selectedPipettes.clear();
  document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
  updateSelectAllCheckbox();
  updateBulkCalButton();
}

function updateBulkToolbar() {
  const row = document.getElementById('toolbar-bulk');
  if (!row) return;

  const totalEl = document.getElementById('bulk-total');
  if (totalEl) totalEl.textContent = selectedPipettes.size;

  const hasAny = selectedPipettes.size > 0;
  row.style.display = hasAny ? 'flex' : 'none';
}
