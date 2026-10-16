'use strict';

// ============================================================
// ФИЛЬТРЫ
// ============================================================
let filterState = {};
let _filterRendered = false;

function renderFilterFields() {
  const container = document.getElementById('filter-fields-container');
  if (!container) return;
  if (_activeFilters.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8;padding:8px;">Нет доступных фильтров</p>';
    return;
  }

  let html = '';
  _activeFilters.forEach(f => {
    const fid = `filter-${f.id}`;

    if (f.type === 'date-period') {
      html += `
        <div class="filter-row">
          <div class="form-group">
            <label>По какой дате</label>
            <select id="${fid}-type">
              <option value="last_calibration">📄 Дата поверки (из сертификата)</option>
              <option value="updated_at">📝 Дата внесения в систему</option>
            </select>
          </div>
          <div class="form-group">
            <label>Период</label>
            <select id="${fid}-period" onchange="toggleCustomPeriod('${fid}')">
              <option value="">Все</option>
              <option value="today">📅 Сегодня</option>
              <option value="yesterday">Вчера</option>
              <option value="week">За 7 дней</option>
              <option value="month">За 30 дней</option>
              <option value="custom">Произвольный период</option>
            </select>
          </div>
        </div>
        <div class="filter-row" id="${fid}-custom" style="display:none;">
          <div class="form-group"><label>С даты</label><input type="date" id="${fid}-from"></div>
          <div class="form-group"><label>По дату</label><input type="date" id="${fid}-to"></div>
        </div>`;
       } else if (f.type === 'select') {
      html += `<div class="form-group">
        <label>${esc(f.label)}</label>
        <select id="${fid}">
          <option value="">Все</option>
          ${(f.options || []).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
        </select>
      </div>`;
    } else if (f.type === 'text') {
      html += `<div class="form-group">
        <label>${esc(f.label)}</label>
        <input type="text" id="${fid}" placeholder="${esc(f.label)}">
      </div>`;
    }
  });

  container.innerHTML = html;
  _filterRendered = true;
}

function toggleCustomPeriod(fid) {
  const sel = document.getElementById(`${fid}-period`);
  const custom = document.getElementById(`${fid}-custom`);
  if (sel && custom) {
    custom.style.display = sel.value === 'custom' ? 'flex' : 'none';
  }
}


function toggleFilterPanel() {
  const panel = document.getElementById('filter-panel');
  if (!panel) return;
  if (!_filterRendered) renderFilterFields();
  panel.classList.toggle('show');
}

function applyFilters() {
  filterState = {};
  for (const f of _activeFilters) {
    const fid = `filter-${f.id}`;
    if (f.type === 'date-period') {
      const typeEl = document.getElementById(`${fid}-type`);
      const periodEl = document.getElementById(`${fid}-period`);
      const fromEl = document.getElementById(`${fid}-from`);
      const toEl = document.getElementById(`${fid}-to`);
      filterState[f.id] = {
        type: typeEl ? typeEl.value : 'last_calibration',
        period: periodEl ? periodEl.value : '',
        from: fromEl ? fromEl.value : '',
        to: toEl ? toEl.value : ''
      };
    } else {
      const el = document.getElementById(fid);
      filterState[f.id] = el ? el.value.trim() : '';
    }
  }
    const savedScroll = window.scrollY;
  document.getElementById('filter-panel').classList.remove('show');
  currentPage = 1;

  render();
  window.scrollTo(0, savedScroll);
}

function resetFilters() {
  filterState = {};
  for (const f of _activeFilters) {
    const fid = `filter-${f.id}`;
    if (f.type === 'date-period') {
      const typeEl = document.getElementById(`${fid}-type`);
      const periodEl = document.getElementById(`${fid}-period`);
      const fromEl = document.getElementById(`${fid}-from`);
      const toEl = document.getElementById(`${fid}-to`);
      const custom = document.getElementById(`${fid}-custom`);
      if (typeEl) typeEl.value = 'last_calibration';
      if (periodEl) periodEl.value = '';
      if (fromEl) fromEl.value = '';
      if (toEl) toEl.value = '';
      if (custom) custom.style.display = 'none';
    } else {
      const el = document.getElementById(fid);
      if (el) el.value = '';
    }
  }
  document.getElementById('filter-panel').classList.remove('show');
  currentPage = 1; 
  render();
}

function applyFilterStateToPanel() {
  if (!_filterRendered && _activeFilters.length > 0) {
    renderFilterFields();
  }

  for (const f of _activeFilters) {
    const fid = `filter-${f.id}`;
    const state = filterState[f.id];

    if (f.type === 'date-period') {
      const typeEl = document.getElementById(`${fid}-type`);
      const periodEl = document.getElementById(`${fid}-period`);
      const fromEl = document.getElementById(`${fid}-from`);
      const toEl = document.getElementById(`${fid}-to`);
      const customEl = document.getElementById(`${fid}-custom`);

      if (typeEl) typeEl.value = (state && state.type) || 'last_calibration';
      if (periodEl) periodEl.value = (state && state.period) || '';
      if (fromEl) fromEl.value = (state && state.from) || '';
      if (toEl) toEl.value = (state && state.to) || '';
      if (customEl) {
        customEl.style.display = (state && state.period === 'custom') ? 'flex' : 'none';
      }
    } else {
      const el = document.getElementById(fid);
      if (el) el.value = state || '';
    }
  }
}

function getFilteredPipettes() {
  const search = normalizeSearch(document.getElementById('search').value);

  let userDept = null;
  if (currentUser) {
    if (currentUser.isActing && currentUser.actingDepartment) {
      userDept = currentUser.actingDepartment;
    } else if (currentUser.onlyOwnDepartment) {
      userDept = currentUser.department;
    }
  }

  return pipettes.filter(p => {
    const s = normalizeSearch(`${p.id} ${p.serial || ''} ${p.model} ${p.manufacturer || ''} ${p.department || ''} ${p.responsible || ''}`);
    if (search && !s.includes(search)) return false;
    if (userDept && p.department !== userDept) return false;

    for (const f of _activeFilters) {
      const v = filterState[f.id];

      if (f.type === 'select') {
        if (v) {
          if (f.id === 'status') {
            if (calcStatus(p) !== v) return false;
          } else if (f.id === 'active') {
            if (String(p.active) !== v) return false;
          } else if (f.fieldId) {
            if (String(p[f.fieldId] || '') !== v) return false;
          }
        }
          } else if (f.type === 'text') {
        if (v && f.fieldId) {
          const haystack = normalizeSearch(p[f.fieldId] || '');
          const needle   = normalizeSearch(v);
          if (!haystack.includes(needle)) return false;
        }
      } else if (f.type === 'date-period') {
        if (v && v.period && !matchCalPeriodDynamic(p, v)) return false;
      }
    }

    return true;
  });
}

function matchCalPeriodDynamic(p, cfg) {
  let targetDate;

  if (cfg.type === 'updated_at') {
    const raw = p.updated_at || p.created_at;
    if (!raw) return false;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return false;
    targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  } else {
    const raw = p.last_calibration;
    if (!raw) return false;
    const pureDate = String(raw).split(' ')[0].split('T')[0];
    targetDate = parseLocalDate(pureDate);
    if (!targetDate) return false;
  }

  targetDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - targetDate) / 86400000);

  switch (cfg.period) {
    case 'today': return diffDays === 0;
    case 'yesterday': return diffDays === 1;
    case 'week': return diffDays >= 0 && diffDays <= 7;
    case 'month': return diffDays >= 0 && diffDays <= 30;
    case 'custom':
      if (cfg.from) {
        const from = new Date(cfg.from); from.setHours(0, 0, 0, 0);
        if (targetDate < from) return false;
      }
      if (cfg.to) {
        const to = new Date(cfg.to); to.setHours(23, 59, 59, 999);
        if (targetDate > to) return false;
      }
      return true;
    default: return true;
  }
}
