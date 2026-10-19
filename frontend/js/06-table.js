'use strict';

// ============================================================
// РЕНДЕР ТАБЛИЦЫ
// ============================================================
function render() {
  let filtered = getSortedPipettes();

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIdx = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + pageSize);

  const pageCurrentEl = document.getElementById('page-current');
  const pageTotalEl = document.getElementById('page-total');
  const pageCountEl = document.getElementById('page-count');
  const pagePrevEl = document.getElementById('page-prev');
  const pageNextEl = document.getElementById('page-next');

  if (pageCurrentEl) pageCurrentEl.textContent = currentPage;
  if (pageTotalEl)   pageTotalEl.textContent = totalPages;
  if (pageCountEl)   pageCountEl.textContent = filtered.length;
  if (pagePrevEl)    pagePrevEl.disabled = currentPage <= 1;
  if (pageNextEl)    pageNextEl.disabled = currentPage >= totalPages;

  const paginationEl = document.getElementById('pagination');
  if (paginationEl) {
    paginationEl.style.display = filtered.length > pageSize ? 'flex' : 'none';
  }

 // ── Подсчёт индикаторов ──
const counters = {
  ok: 0,
  warn: 0,
  danger: 0,
  sent: 0,
  wipActive: 0,
  wipInactive: 0,
  failInactive: 0,
  noDateActive: 0,
  noDateInactive: 0,
};

pipettes.forEach(p => {
  const s = calcStatus(p);

  if (s === 'sent') { counters.sent++; return; }

  if (s === 'wip') {
    if (!p.active) counters.wipInactive++;
    else           counters.wipActive++;
    return;
  }

  if (s === 'fail') {
    if (!p.active) counters.failInactive++;
    else           counters.danger++;
    return;
  }

  const sByDate = calcStatusByDate(p);

  if (sByDate === null) {
    if (!p.active) counters.noDateInactive++;
    else           counters.noDateActive++;
    return;
  }

  if (sByDate === 'ok')          counters.ok++;
  else if (sByDate === 'warn')   counters.warn++;
  else if (sByDate === 'danger') counters.danger++;
});

document.getElementById('stat-ok').textContent     = counters.ok;
document.getElementById('stat-warn').textContent   = counters.warn;
document.getElementById('stat-danger').textContent = counters.danger;
document.getElementById('stat-total').textContent  = pipettes.length;

// 🆕 Тултип на «Всего»
const totalEl = document.getElementById('stat-total');
if (totalEl) {
  const lines = [];

  lines.push(`Всего: ${pipettes.length}`);
  lines.push('');
  lines.push('В индикаторах:');
  lines.push(`  🟢 В норме:                ${counters.ok}`);
  lines.push(`  🟡 Скоро поверка:          ${counters.warn}`);
  lines.push(`  🔴 Просрочены:             ${counters.danger}`);
  lines.push(`  ─────────────────────────────`);
  lines.push(`  Сумма:                     ${counters.ok + counters.warn + counters.danger}`);

  const hidden =
    counters.sent +
    counters.wipActive +
    counters.wipInactive +
    counters.failInactive +
    counters.noDateActive +
    counters.noDateInactive;

  if (hidden > 0) {
    lines.push('');
    lines.push('Не вошло в индикаторы:');
    if (counters.sent > 0)
      lines.push(`  📦 На поверке:              ${counters.sent}`);
    if (counters.wipActive > 0)
      lines.push(`  ⏳ В процессе:              ${counters.wipActive}`);
    if (counters.wipInactive > 0)
      lines.push(`  ⏳ В процессе (неактив):    ${counters.wipInactive}`);
    if (counters.failInactive > 0)
      lines.push(`  ❌ Брак (неактив):          ${counters.failInactive}`);
    if (counters.noDateActive > 0)
     lines.push(`  ❓ Без даты/МПИ (актив):    ${counters.noDateActive}`);
    if (counters.noDateInactive > 0)
      lines.push(`  ❓ Без даты/МПИ (неактив):  ${counters.noDateInactive}`);
    lines.push(`  ─────────────────────────────`);
    lines.push(`  Сумма вне индикаторов:     ${hidden}`);
  }

  const mainSum = counters.ok + counters.warn + counters.danger;
  lines.push('');
  lines.push('Проверка:');
  lines.push(`  ${mainSum} (в индикаторах) + ${hidden} (вне) = ${mainSum + hidden}`);
  lines.push(`  Всего единиц: ${pipettes.length}`);
  lines.push(`  ${mainSum + hidden === pipettes.length ? '✅ Всё сходится' : '❌ Ошибка подсчёта'}`);

    totalEl.title = lines.join('\n');
}

  const banner = document.getElementById('alert-banner');
  if (counters.danger > 0) {
    document.getElementById('alert-text').textContent = `У ${counters.danger} ${counters.danger === 1 ? 'единицы' : 'единиц'} проблема с поверкой!`;
    banner.classList.add('show');
  } else if (counters.warn > 0) {
    document.getElementById('alert-text').textContent = `У ${counters.warn} ${counters.warn === 1 ? 'единицы' : 'единиц'} подходит срок поверки в течение ${settings.warnDays} дн.`;
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
  const tbody = document.getElementById('pipettes-body');
  const empty = document.getElementById('empty-state');
  const table = document.getElementById('pipettes-table');
  const thead = table.querySelector('thead tr');
  if (!thead) return;

  const columns = getActiveTableColumns()
    .filter(col => !!findColumn(col));

  const hasAnyRowAction =
    canViewHistory() || canEditPipette() || canDeletePipette() || canQuickCal();

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

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    table.style.display = 'none';
    empty.style.display = 'block';
    if (pipettes.length > 0) empty.querySelector('p').textContent = 'Ничего не найдено по фильтру.';
    updateSortArrows();
    updateSelectAllCheckbox();
    updateBulkCalButton();
    fitTableWrapperHeight();
    return;
  }
  table.style.display = '';
  empty.style.display = 'none';

  tbody.innerHTML = pageItems.map(p => {
    const status = calcStatus(p);
    const next = getNextDate(p);
    const dl = daysLeft(p);
    const daysText = status === 'inactive' || status === 'sent' || status === 'wip' || status === 'unknown' ? '' :
  status === 'fail' ? ' (брак)' :
  status === 'danger' ? ` (просрочка ${Math.abs(dl)} дн.)` :
  ` (${dl} дн.)`;
    const histCount = p.history_count || 0;
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

  updateSortArrows();
  updateSelectAllCheckbox();
  updateBulkCalButton();
  fitTableWrapperHeight();
  requestAnimationFrame(() => {
  requestAnimationFrame(fitTableWrapperHeight);
  });
}

// ============================================================
// 🆕 ДИНАМИЧЕСКАЯ ВЫСОТА ОБЁРТКИ ТАБЛИЦЫ
// ============================================================
function fitTableWrapperHeight() {
  const wrapper = document.querySelector('.table-wrapper');
  if (!wrapper) return;

  const wrapperTop = wrapper.getBoundingClientRect().top;

  const pagination = document.getElementById('pagination');
  let bottomGap = 0;
  if (pagination && pagination.style.display !== 'none') {
    bottomGap += pagination.offsetHeight + 16;
  }

  // Первый проход — примерная высота
  let available = window.innerHeight - wrapperTop - bottomGap;
  let h = Math.max(200, Math.floor(available));
  wrapper.style.height = h + 'px';

  // Калибровка: добиваем остаточный gap (субпиксели, рамки)
  const gap = Math.round(window.innerHeight - wrapper.getBoundingClientRect().bottom);
  if (gap > 0) {
    wrapper.style.height = (h + gap) + 'px';
  }
}

// 🆕 Пересчёт при resize окна (с debounce) — ОДИН раз на весь файл
let _resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(fitTableWrapperHeight, 100);
});
// 🆕 Пересчёт после полной загрузки (шрифты/картинки сдвигают верх)
window.addEventListener('load', () => {
  setTimeout(fitTableWrapperHeight, 100);
  setTimeout(fitTableWrapperHeight, 400);
});

// 🆕 ResizeObserver — ловит зум, появление скролла, любые сдвиги
let _roScheduled = false;
if (window.ResizeObserver) {
  const _ro = new ResizeObserver(() => {
    if (_roScheduled) return;
    _roScheduled = true;
    requestAnimationFrame(() => {
      _roScheduled = false;
      fitTableWrapperHeight();
    });
  });
  _ro.observe(document.documentElement);
}


// 🆕 Пересчёт при сворачивании шапки — ОДИН раз на весь файл
const _origToggleHeader = window.toggleHeaderCollapse;
if (typeof _origToggleHeader === 'function') {
  window.toggleHeaderCollapse = function() {
    _origToggleHeader.apply(this, arguments);
    setTimeout(fitTableWrapperHeight, 100);
  };
}


function updateSortArrows() {
  document.querySelectorAll('th .sort-arrow').forEach(el => {
    const f = el.dataset.field;
    if (f === sortField) el.textContent = sortDir > 0 ? '▲' : '▼';
    else el.textContent = '';
  });
}

function sortBy(field) {
  if (sortField === field) sortDir *= -1;
  else { sortField = field; sortDir = 1; }
  currentPage = 1;
  render();
}

function changePage(delta) {
  const filtered = getFilteredPipettes();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const newPage = currentPage + delta;

  if (newPage < 1 || newPage > totalPages) return;
  currentPage = newPage;
  render();
}

// ============================================================
// МАССОВЫЙ ВЫБОР
// ============================================================
function togglePipetteSelection(id, checked) {
  if (checked) selectedPipettes.add(id);
  else selectedPipettes.delete(id);
  updateSelectAllCheckbox();
  updateBulkCalButton();
}

function getVisiblePageIds() {
  const filtered = getSortedPipettes();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, currentPage), totalPages);
  const startIdx = (page - 1) * pageSize;
  return filtered.slice(startIdx, startIdx + pageSize).map(p => p.id);
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
    return p && !p.sent_for_calibration && isExternalCalibration(p.equipment_type);
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
