'use strict';

// ============================================================
// НАСТРОЙКИ
// ============================================================
async function openSettingsModal() {
  await UI.guard(
    { role: 'admin', errorMsg: 'Доступно только администратору' },
    async () => {
      document.getElementById('settings-list').style.display = '';
      document.getElementById('settings-section').style.display = 'none';
      document.getElementById('settings-back-btn').style.display = 'none';
      document.getElementById('settings-header-text').textContent = 'Настройки системы';
      document.getElementById('settings-footer').style.display = '';

      renderSettingsList();
      UI.modal.open('settings-modal');
    }
  );
}

function closeSettingsModal() {
  UI.modal.close('settings-modal');
}

async function closeSettingsSection() {
  document.getElementById('settings-section').style.display = 'none';
  document.getElementById('settings-list').style.display = '';
  document.getElementById('settings-back-btn').style.display = 'none';
  document.getElementById('settings-header-text').textContent = 'Настройки системы';
  document.getElementById('settings-footer').style.display = '';
  document.getElementById('settings-section-content').innerHTML = '';
}

function renderSettingsList() {
  const c = document.getElementById('settings-list');
  if (!c) return;

  const canSee = (id) => {
    if (id === 'users')    return canManageUsers();
    if (id === 'printers') return canManagePrinters();
    if (id === 'log')      return canViewLog();
    return true;
  };

  let html = '';
  for (const section of SETTINGS_SECTIONS) {
    const visibleItems = section.items.filter(it => canSee(it.id));
    if (visibleItems.length === 0) continue;

    html += `<div class="settings-group-title">${esc(section.group)}</div>`;
    html += `<div class="settings-items">`;
    visibleItems.forEach((item, idx) => {
      const isLast = idx === visibleItems.length - 1;
      html += `<button class="settings-item${isLast ? ' settings-item-last' : ''}" onclick="openSettingsSection('${item.id}')">${esc(item.label)}</button>`;
    });
    html += `</div>`;
  }
  c.innerHTML = html;
}

async function openSettingsSection(id) {
  const sectionDef = SETTINGS_SECTIONS
    .flatMap(s => s.items)
    .find(i => i.id === id);
  if (!sectionDef) return;

  const permCheck = {
    users:    canManageUsers,
    printers: canManagePrinters,
    log:      canViewLog,
  }[id];
  if (permCheck && !permCheck()) {
    showToast('Недостаточно прав для этого раздела', 'error');
    return;
  }

  document.getElementById('settings-list').style.display = 'none';
  document.getElementById('settings-section').style.display = '';
  document.getElementById('settings-back-btn').style.display = 'inline-flex';
  document.getElementById('settings-header-text').textContent = sectionDef.label;
  document.getElementById('settings-footer').style.display = 'none';

  const c = document.getElementById('settings-section-content');
  c.innerHTML = '<p style="color:#94a3b8;">Загрузка…</p>';

  try {
    if (id === 'fields')           await renderFieldsSettings();
    else if (id === 'departments') await renderDepartmentsSettings();
    else if (id === 'filters')     await renderFiltersSettings();
    else if (id === 'export')      await renderExportSettings();
    else if (id === 'users')       await renderUsersSettings();
    else if (id === 'equipment')   await renderEquipmentSettings();
    else if (id === 'printers')    await renderPrintersSettings();
    else if (id === 'barcodes')    await renderBarcodesSettings();
    else if (id === 'help')        await renderHelpSettings();
    else if (id === 'view-templates') await renderViewTemplatesSettings();
    else if (id === 'general')     await renderGeneralSettings();
    else if (id === 'log')         await renderLogSettings();
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
}

// ============================================================
// ВКЛАДКА: ПОЛЯ ФОРМЫ
// ============================================================
async function renderFieldsSettings(skipFetch = false) {
  const c = document.getElementById('settings-section-content');
  try {
    if (!skipFetch) {
      _cachedFields = await apiRequest('/settings/fields');
    }

    let html = `
      <h3>Управление полями формы</h3>
      <p style="color:#64748b;margin-bottom:12px;">Включите/отключите поля, измените порядок, сделайте обязательными.</p>
      <table class="field-settings-table">
        <thead><tr>
          <th style="width:100px; text-align:center;">Порядок</th>
          <th style="text-align:center;">Название</th>
          <th style="width:120px; text-align:center;">Тип</th>
          <th style="width:100px; text-align:center;">Обяз-но</th>
          <th style="width:110px; text-align:center;">Активно</th>
          <th style="text-align:center;">Список значений</th>
          <th style="width:60px;"></th>
        </tr></thead><tbody>`;

    _cachedFields.forEach((f, i) => {
      html += `<tr>
        <td>${UI.moveBtns(i, _cachedFields.length, 'moveFieldSetting')}</td>
        <td><input type="text" value="${esc(f.label)}" oninput="_cachedFields[${i}].label=this.value"></td>
        <td>${renderFieldTypeSelect(i, f)}</td>
        <td style="text-align:center;">${UI.checkbox(`_cachedFields[${i}].required=this.checked`, f.required)}</td>
        <td style="text-align:center;">${UI.checkbox(`onFieldEnabledChange(${i}, this.checked)`, f.enabled)}</td>
        <td>${renderFieldOptionsCell(i, f.type)}</td>
        <td style="text-align: center;">
          <button class="row-actions-btn" onclick="openFieldActions(event, ${i})" title="Действия">
             <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
        </td>
      </tr>`;
    });
     html += `</tbody></table>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="addFieldSetting()"><i class="fa-solid fa-plus"></i> Добавить поле</button>
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()" style="margin-left:auto;">Закрыть</button>
        <button class="btn btn-success" onclick="saveFieldsSettings()"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
      </div>`;
    c.innerHTML = html;
  } catch (e) {
    c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>';
  }
}

async function onFieldEnabledChange(idx, checked) {
  const f = _cachedFields[idx];
  if (!checked && f.required) {
    const ok = await showConfirm(
      `Поле «${f.label}» обязательно. Если скрыть его, при создании оборудования будет подставляться значение «Не указана» (или значение по умолчанию). Продолжить?`,
      { icon: '⚠️', title: 'Скрытие обязательного поля', okText: 'Скрыть', okClass: 'btn-warning' }
    );
    if (!ok) {
       const row = document.querySelectorAll('.field-settings-table tbody tr')[idx];
      if (row) {
        const cbs = row.querySelectorAll('input[type="checkbox"]');
        if (cbs[1]) cbs[1].checked = true;
      }
      return;
    }
  }
  _cachedFields[idx].enabled = checked;
}

function renderFieldOptionsCell(idx, type) {
  if (type === 'select') {
    const opts = (_cachedFields[idx].options || []).join('\n');
        return `<textarea rows="2" oninput="_cachedFields[${idx}].options=this.value.split('\\n').map(s=>s.trim()).filter(Boolean)">${esc(opts)}</textarea>`;
  }
  return '—';
}

const SYSTEM_FIELD_IDS = ['id', 'department', 'equipmentType', 'result', 'active'];

function renderFieldTypeSelect(idx, f) {
  const typeLabels = {
    text: 'Текст', number: 'Число', date: 'Дата',
    select: 'Список', textarea: 'Текст. область'
  };

  if (SYSTEM_FIELD_IDS.includes(f.id)) {
    return `<select disabled title="Системное поле — тип фиксирован">
      <option>${typeLabels[f.type] || f.type}</option>
    </select>`;
  }

  return `<select onchange="onFieldTypeChange(${idx}, this.value)">
    <option value="text" ${f.type === 'text' ? 'selected' : ''}>Текст</option>
    <option value="number" ${f.type === 'number' ? 'selected' : ''}>Число</option>
    <option value="date" ${f.type === 'date' ? 'selected' : ''}>Дата</option>
    <option value="select" ${f.type === 'select' ? 'selected' : ''}>Список</option>
    <option value="textarea" ${f.type === 'textarea' ? 'selected' : ''}>Текст. область</option>
  </select>`;
}

function onFieldTypeChange(idx, type) {
  _cachedFields[idx].type = type;
  const row = document.querySelector('.field-settings-table tbody').children[idx];
  if (row) row.children[5].innerHTML = renderFieldOptionsCell(idx, type);
}

function moveFieldSetting(idx, dir) {
  const to = idx + dir;
  if (to < 0 || to >= _cachedFields.length) return;
  [_cachedFields[idx], _cachedFields[to]] = [_cachedFields[to], _cachedFields[idx]];
  _cachedFields.forEach((f, i) => f.order = i + 1);
  renderFieldsSettings(true);
}

async function addFieldSetting() {
  const id = await showPrompt('ID нового поля (латиница, начинается с буквы)', {
      icon: 'fa-plus', title: 'Новое поле', okText: 'Добавить', placeholder: 'Например: inventorynumber',
      validator: (v) => {
        if (!v) return 'Укажите ID поля';
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(v)) return 'Только латиница, цифры и _, начиная с буквы';
        if (_cachedFields.some(f => f.id === v)) return 'Поле с таким ID уже существует';
        return null;
      }
  });
  if (!id) return;
  _cachedFields.push({ id, label: id, type: 'text', required: false, enabled: true, options: [], default: '', order: _cachedFields.length + 1 });
  renderFieldsSettings(true);
}

async function deleteFieldSetting(idx) {
  const ok = await showConfirm(`Удалить поле «${_cachedFields[idx].label}»?`, { icon: '📋', title: 'Удаление поля', okText: 'Удалить', okClass: 'btn-danger' });
  if (!ok) return;
  _cachedFields.splice(idx, 1);
  _cachedFields.forEach((f, i) => f.order = i + 1);
  renderFieldsSettings(true);
}

async function saveFieldsSettings() {
  try {
    await apiRequest('/settings/fields', 'PUT', _cachedFields);
    _cachedFields = await apiRequest('/settings/fields');
  
    myPrefs = { visibleFields: null, _loaded: false };
    try {
      myPrefs = await apiRequest('/settings/my-preferences') || {};
      myPrefs._loaded = true;
    } catch (e) {
      myPrefs = { _loaded: true };
    }

    const activeFieldIds = _cachedFields.filter(f => f.enabled).map(f => f.id);
    if (!Array.isArray(myPrefs.visibleFields) || myPrefs.visibleFields.length === 0) {
      myPrefs.visibleFields = [...activeFieldIds];
    } else {
      const visibleSet = new Set(myPrefs.visibleFields);
      for (const id of activeFieldIds) {
        if (!visibleSet.has(id)) myPrefs.visibleFields.push(id);
      }
      const activeSet = new Set(activeFieldIds);
      myPrefs.visibleFields = myPrefs.visibleFields.filter(id => activeSet.has(id));
    }

    showToast('Поля сохранены', 'success');
    closeSettingsModal();
    await loadPipetteData();
  } catch (e) {
    if (e.response?.code === 'field_has_data') {
      const affected = e.response.affected || 0;
      const fieldsArr = e.response.fields || [];
      const listText = fieldsArr.map(f => `«${f}»`).join(', ');
      const recordPlural = affected === 1 ? 'и' : 'ей';

      const ok = await showConfirm(`Поле ${listText} заполнено у ${affected} запис${recordPlural}.\n\nДанные будут стёрты. Продолжить?`, { icon: '⚠️', title: 'Поле с данными', okText: 'Удалить', okClass: 'btn-danger' });
      if (!ok) return;

      try {
        await apiRequest('/settings/fields?confirmDelete=true', 'PUT', _cachedFields);
        _cachedFields = await apiRequest('/settings/fields');
        myPrefs = { visibleFields: null, _loaded: false };
        try { myPrefs = await apiRequest('/settings/my-preferences') || {}; myPrefs._loaded = true; } catch (err) { myPrefs = { _loaded: true }; }

        const activeIds = _cachedFields.filter(f => f.enabled).map(f => f.id);
        if (!Array.isArray(myPrefs.visibleFields) || myPrefs.visibleFields.length === 0) {
          myPrefs.visibleFields = [...activeIds];
        } else {
          const activeSet = new Set(activeIds);
          const visibleSet = new Set(myPrefs.visibleFields);
          for (const id of activeIds) { if (!visibleSet.has(id)) myPrefs.visibleFields.push(id); }
          myPrefs.visibleFields = myPrefs.visibleFields.filter(id => activeSet.has(id));
        }
        showToast(`Поле удалено, данные очищены у ${affected} записей`, 'success');
        closeSettingsModal();
        await loadPipetteData();
      } catch (e2) { showToast(e2.message || 'Ошибка удаления', 'error'); }
      return;
    }
    showToast(e.message, 'error');
  }
}

// ============================================================
// ВКЛАДКА: ОТДЕЛЫ
// ============================================================
async function renderDepartmentsSettings(skipFetch = false) {
  const c = document.getElementById('settings-section-content');
  try {
    if (!skipFetch) {
      _cachedDepartmentsFull = await apiRequest('/settings/departments-full');
      _cachedDepartmentsFull.forEach(d => { d._originalName = d.name; });
    }

    let html = `
      <h3>Управление отделами</h3>
      <p style="color:#64748b;margin-bottom:12px;">Отделы <strong>не могут дублироваться</strong>.</p>
      <table class="field-settings-table">
        <thead><tr>
          <th style="width:110px; text-align:center;">Активно</th>
          <th style="text-align:center;">Название</th>
          <th style="width:100px; text-align:center;">Действия</th>
        </tr></thead><tbody>`;

    _cachedDepartmentsFull.forEach((d, i) => {
      html += `<tr>
        <td style="text-align:center;">${UI.checkbox(`_cachedDepartmentsFull[${i}].enabled=this.checked`, d.enabled)}</td>
        <td><input type="text" value="${esc(d.name)}" oninput="onDepartmentNameChange(${i}, this.value)"></td>
        <td style="text-align: center;">
           <button class="row-actions-btn" onclick="openDeptActions(event, ${i})" title="Действия"><i class="fa-solid fa-ellipsis-vertical"></i></button>
        </td>
      </tr>`;
    });
    html += `</tbody></table>
    <div class="form-actions" style="margin-top:16px;">
        <input type="text" id="new-dept-name" placeholder="Название нового отдела" style="flex:1; max-width:400px; padding:9px 12px; border:1px solid #d1d5db; border-radius:8px;" onkeydown="if(event.key==='Enter'){event.preventDefault();addDepartmentItem();}">
        <button type="button" class="btn btn-success" onclick="addDepartmentItem()"><i class="fa-solid fa-plus"></i> Добавить</button>
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()" style="margin-left:auto;">Закрыть</button>
        <button type="button" class="btn btn-primary" onclick="saveDepartmentsFull()"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
     </div>
     <div id="dept-duplicate-warning" style="margin-top:12px;display:none;padding:10px 12px;background:#fee2e2;border-left:3px solid #dc2626;border-radius:6px;color:#991b1b;font-size:.85rem;"></div>`;
    c.innerHTML = html;
  } catch (e) { c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>'; }
}

function onDepartmentNameChange(idx, value) {
  const trimmed = value.trim();
  const d = _cachedDepartmentsFull[idx];
  if (d._originalName === undefined) d._originalName = d.name;
  d.name = trimmed;
  const lower = trimmed.toLowerCase();
  const duplicates = _cachedDepartmentsFull.filter((d, i) => i !== idx && d.name.trim().toLowerCase() === lower);
  const warn = document.getElementById('dept-duplicate-warning');
  if (warn) {
    if (duplicates.length > 0 && trimmed !== '') {
      warn.style.display = 'block';
      warn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Отдел «${esc(trimmed)}» уже существует.`;
    } else { warn.style.display = 'none'; }
  }
}

function addDepartmentItem() {
  const input = document.getElementById('new-dept-name');
  const name = (input ? input.value : '').trim();
  if (!name) { showToast('Заполните поле «Название отдела»', 'error'); return; }
  if (_cachedDepartmentsFull.some(d => d.name.toLowerCase() === name.toLowerCase())) { showToast('Такой отдел уже есть', 'error'); return; }
  _cachedDepartmentsFull.push({ name, enabled: true, _originalName: null });
  renderDepartmentsSettings(true);
  setTimeout(() => { const inp = document.getElementById('new-dept-name'); if (inp) inp.focus(); }, 0);
  showToast(`Отдел «${name}» добавлен`, 'success');
}

async function deleteDepartmentItem(idx) {
  if (idx < 0 || idx >= _cachedDepartmentsFull.length) return;
  const name = _cachedDepartmentsFull[idx].name;
  const ok = await showConfirm(`Удалить отдел «${name}»?`, { icon: '🏢', title: 'Удаление отдела', okText: 'Удалить', okClass: 'btn-danger' });
  if (!ok) return;
  _cachedDepartmentsFull.splice(idx, 1);
  renderDepartmentsSettings(true);
  showToast(`Отдел «${name}» удалён`, 'success');
}

async function saveDepartmentsFull() {
  const cleaned = [];
  const seen = new Set();
  for (const d of _cachedDepartmentsFull) {
    const name = (d.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ name, enabled: d.enabled !== false, oldName: (d._originalName && d._originalName !== name) ? d._originalName : null });
  }
  if (cleaned.length === 0) { showToast('Добавьте хотя бы один отдел', 'error'); return; }

  try {
    await UI.saveAction({ successMsg: `Отделы сохранены (${cleaned.length})`, closeFn: closeSettingsModal, reload: false }, async () => {
      await apiRequest('/settings/departments', 'PUT', cleaned);
      _cachedDepartmentsFull = cleaned;
      await loadDepartments();
      await loadFilterConfig();
      syncFilterState();
      await refreshAfterSettingsChange();
    });
  } catch (e) {}
}

// ============================================================
// ВКЛАДКА: ФИЛЬТРЫ
// ============================================================
async function renderFiltersSettings(skipFetch = false) {
  const c = document.getElementById('settings-section-content');
  try {
    if (!skipFetch) _cachedFilters = await apiRequest('/settings/filters');

    let html = `
      <h3>Управление фильтрами</h3>
      <p style="color:#64748b;margin-bottom:12px;">Включайте / отключайте фильтры.</p>
      <table class="field-settings-table">
        <thead><tr>
          <th style="width:100px; text-align:center;">Порядок</th>
          <th style="width:110px; text-align:center;">Активно</th>
          <th style="text-align:center;">Название</th>
          <th style="width:130px; text-align:center;">Тип</th>
          <th style="width:140px; text-align:center;">Источник</th>
          <th style="width:60px;"></th>
        </tr></thead><tbody>`;

    _cachedFilters.forEach((f, i) => {
      html += `<tr>
        <td>${UI.moveBtns(i, _cachedFilters.length, 'moveFilter')}</td>
        <td style="text-align:center;">${UI.checkbox(`_cachedFilters[${i}].enabled=this.checked`, f.enabled)}</td>
        <td><input type="text" value="${esc(f.label)}" oninput="_cachedFilters[${i}].label=this.value"></td>
        <td><select onchange="_cachedFilters[${i}].type=this.value">
            <option value="text" ${f.type === 'text' ? 'selected' : ''}>Текст</option>
            <option value="select" ${f.type === 'select' ? 'selected' : ''}>Список</option>
            <option value="date-period" ${f.type === 'date-period' ? 'selected' : ''}>Период дат</option>
          </select>
        </td>
        <td>
          <select onchange="_cachedFilters[${i}].optionsSource=this.value">
            <option value="" ${!f.optionsSource ? 'selected' : ''}>—</option>
            <option value="departments" ${f.optionsSource === 'departments' ? 'selected' : ''}>Отделы</option>
            <option value="status_list" ${f.optionsSource === 'status_list' ? 'selected' : ''}>Статусы</option>
            <option value="active_list" ${f.optionsSource === 'active_list' ? 'selected' : ''}>Активность</option>
            <option value="equipment_type_list" ${f.optionsSource === 'equipment_type_list' ? 'selected' : ''}>Типы оборудования</option>
          </select>
        </td>
        <td style="text-align: center;">
         <button class="row-actions-btn" onclick="openFilterActions(event, ${i})" title="Действия"><i class="fa-solid fa-ellipsis-vertical"></i></button>
       </td>
      </tr>`;
    });
    
    html += `</tbody></table>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="addFilter()"><i class="fa-solid fa-plus"></i> Добавить фильтр</button>
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()" style="margin-left:auto;">Закрыть</button>
        <button class="btn btn-success" onclick="saveFilters()"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
      </div>`;
    c.innerHTML = html;
  } catch (e) { c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>'; }
}

function moveFilter(idx, dir) {
  const to = idx + dir;
  if (to < 0 || to >= _cachedFilters.length) return;
  [_cachedFilters[idx], _cachedFilters[to]] = [_cachedFilters[to], _cachedFilters[idx]];
  _cachedFilters.forEach((f, i) => f.order = i + 1);
  renderFiltersSettings(true);
}

async function addFilter() {
  const id = await showPrompt('ID нового фильтра', {
      icon: 'fa-filter', title: 'Новый фильтр', okText: 'Добавить', placeholder: 'Например: responsible',
      validator: (v) => {
        if (!v) return 'Укажите ID фильтра';
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(v)) return 'Только латиница, цифры и _';
        if (_cachedFilters.some(f => f.id === v)) return 'Такой фильтр уже есть';
        return null;
      }
  });
  if (!id) return;
  _cachedFilters.push({ id, label: id, type: 'text', fieldId: '', enabled: true, optionsSource: '', order: _cachedFilters.length + 1 });
  renderFiltersSettings(true);
}

async function deleteFilter(idx) {
  const ok = await showConfirm(`Удалить фильтр «${_cachedFilters[idx].label}»?`, { icon: '🔍', title: 'Удаление фильтра', okText: 'Удалить', okClass: 'btn-danger' });
  if (!ok) return;
  _cachedFilters.splice(idx, 1);
  _cachedFilters.forEach((f, i) => f.order = i + 1);
  renderFiltersSettings(true);
}

async function saveFilters() {
  try {
    await UI.saveAction({ successMsg: 'Фильтры сохранены', closeFn: closeSettingsModal, reload: false }, async () => {
      await apiRequest('/settings/filters', 'PUT', _cachedFilters);
      await loadFilterConfig();
      _filterRendered = false;
      const panel = document.getElementById('filter-panel');
      if (panel && panel.classList.contains('show')) renderFilterFields();
      syncFilterState();
      await refreshAfterSettingsChange();
    });
  } catch (e) {}
}

// ============================================================
// ВКЛАДКА: ЭКСПОРТ
// ============================================================
const SYSTEM_EXPORT_FIELDS = [
  { id: 'id', label: 'Внутренний номер' }, { id: 'serial', label: 'Серийный номер' },
  { id: 'manufacturer', label: 'Производитель' }, { id: 'model', label: 'Модель' },
  { id: 'equipmentType', label: 'Тип оборудования' }, { id: 'volume', label: 'Объём (мкл)' },
  { id: 'department', label: 'Отдел' }, { id: 'lastCalibration', label: 'Дата поверки' },
  { id: 'nextCalibration', label: 'Следующая поверка' }, { id: 'interval', label: 'МПИ (мес.)' },
  { id: 'daysLeft', label: 'Дней до поверки' }, { id: 'responsible', label: 'Ответственный' },
  { id: 'location', label: 'Место хранения' }, { id: 'status', label: 'Статус' },
  { id: 'cert', label: 'Свидетельство' }, { id: 'notes', label: 'Примечание' }
];

function getExportFields() {
  const list = [...SYSTEM_EXPORT_FIELDS];
  const custom = (_cachedFields || []).filter(f => f.enabled && !SYSTEM_FIELD_IDS_IN_CONFIG.has(f.id));
  for (const f of custom) list.push({ id: f.id, label: f.label });
  return list;
}

async function renderExportSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    _cachedFields = await apiRequest('/settings/fields');
    const selected = await apiRequest('/settings/export');
    let html = `<h3>Настройки экспорта</h3>
      <p style="color:#64748b;margin-bottom:12px;">Выберите поля для PDF/Excel</p>
      <div class="export-fields-grid">`;
    getExportFields().forEach(f => {
      html += `<label><input type="checkbox" value="${esc(f.id)}" ${selected.includes(f.id) ? 'checked' : ''} class="exp-field-cb"> ${esc(f.label)}</label>`;
    });
    
    html += `</div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()" style="margin-left:auto;">Закрыть</button>
        <button class="btn btn-success" onclick="saveExportSettings()"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
      </div>`;
    c.innerHTML = html;
  } catch (e) { c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>'; }
}

async function saveExportSettings() {
  const selected = Array.from(document.querySelectorAll('.exp-field-cb:checked')).map(cb => cb.value);
  try {
    await UI.saveAction({ successMsg: 'Настройки экспорта сохранены', closeFn: closeSettingsModal, reload: false }, async () => {
      await apiRequest('/settings/export', 'PUT', selected);
      exportFields = selected;
    });
  } catch (e) {}
}

// ============================================================
// РАЗДЕЛ: ОБЩИЕ
// ============================================================
async function renderGeneralSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    const s = await apiRequest('/settings/system');
    c.innerHTML = `
      <div class="settings-form">
        <h4>Уведомления</h4>
        <div class="form-group">
          <label>Порог предупреждения о поверке (дней)</label>
          <input type="number" id="sys-warn-days" value="${esc(s.warn_days || '30')}" min="1" max="365" style="max-width:150px;">
        </div>
        <button class="btn btn-success btn-sm" onclick="saveSystemSetting()"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
      </div>

      <div class="settings-form" style="margin-top:24px;border-left:3px solid #dc2626;">
        <h4 style="color:#991b1b;">Опасная зона</h4>
        <p style="color:#64748b;font-size:.88rem;margin:8px 0 12px;">
          Удаление <strong>всех данных</strong> об оборудовании и истории поверок. <strong>Действие необратимо.</strong>
        </p>
        <button class="btn btn-danger btn-sm" onclick="resetAllDataSetting()"><i class="fa-solid fa-trash"></i> Сбросить все данные</button>
      </div>

      <div class="form-actions" style="margin-top: 24px;">
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()" style="margin-left:auto;">Закрыть</button>
      </div>
    `;
  } catch (e) { c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`; }
}

async function saveSystemSetting() {
  const wd = document.getElementById('sys-warn-days').value;
  try {
    await UI.saveAction({ successMsg: 'Настройки сохранены', closeFn: closeSettingsModal, reload: false }, async () => {
      await apiRequest('/settings/system', 'PUT', { warn_days: String(wd) });
      settings.warnDays = parseInt(wd) || 30;
      await refreshAfterSettingsChange();
    });
  } catch (e) {}
}

// ============================================================
// РАЗДЕЛ: ТИПЫ ОБОРУДОВАНИЯ
// ============================================================
async function renderEquipmentSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    const types = await apiRequest('/settings/equipment-types');
    _cachedEquipmentTypes = JSON.parse(JSON.stringify(types));

    c.innerHTML = `
      <p style="color:#64748b;font-size:.88rem;margin:0 0 12px;">Управление списком типов.</p>
      <table class="field-settings-table" id="equip-types-table">
       <thead>
          <tr>
            <th style="width:100px; text-align:center;">Порядок</th>
            <th style="width:140px; text-align:center;">value</th>
            <th style="text-align:center;">label</th>
            <th style="width:80px; text-align:center;">prefix</th>
            <th style="width:100px; text-align:center;">МПИ (мес.)</th>
            <th style="width:200px; text-align:center;">Место поверки</th>
            <th style="width:60px;"></th>
          </tr>
        </thead>
        <tbody id="equip-types-body"></tbody>
      </table>

      <div class="form-actions">
        <button class="btn btn-primary btn-sm" onclick="addEquipmentType()"><i class="fa-solid fa-plus"></i> Добавить тип</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeSettingsModal()" style="margin-left:auto;">Закрыть</button>
        <button class="btn btn-success btn-sm" onclick="saveEquipmentTypes()"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
      </div>
      <div id="equip-types-warning" style="display:none;margin-top:12px;padding:10px 12px;background:#fee2e2;border-left:3px solid #dc2626;border-radius:6px;color:#991b1b;font-size:.85rem;"></div>
    `;
    renderEquipmentTypesTable();
  } catch (e) { c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`; }
}

function renderEquipmentTypesTable() {
  const tbody = document.getElementById('equip-types-body');
  if (!tbody) return;
  if (_cachedEquipmentTypes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:20px;">Нет типов. Нажмите «Добавить тип».</td></tr>';
    return;
  }
  tbody.innerHTML = _cachedEquipmentTypes.map((t, i) => `
  <tr>
    <td>${UI.moveBtns(i, _cachedEquipmentTypes.length, 'moveEquipmentType')}</td>
    <td><input type="text" value="${esc(t.value)}" readonly style="background:#f1f5f9;cursor:not-allowed;" title="value менять нельзя"></td>
    <td><input type="text" value="${esc(t.label)}" oninput="updateEquipmentType(${i}, 'label', this.value)"></td>
    <td><input type="text" value="${esc(t.prefix || '')}" maxlength="4" style="text-align:center;text-transform:uppercase;" oninput="updateEquipmentType(${i}, 'prefix', this.value.toUpperCase())"></td>
    <td><input type="number" value="${Number.isFinite(parseInt(t.interval, 10)) && parseInt(t.interval, 10) > 0 ? parseInt(t.interval, 10) : 12}" min="1" max="120" style="text-align:center;" oninput="updateEquipmentType(${i}, 'interval', this.value)"></td>
    <td>
      <select onchange="updateEquipmentType(${i}, 'calibrationPlace', this.value)">
        <option value="external" ${t.calibrationPlace === 'external' ? 'selected' : ''}>📦 Внешняя</option>
        <option value="internal" ${(!t.calibrationPlace || t.calibrationPlace === 'internal') ? 'selected' : ''}>🏠 На месте</option>
      </select>
    </td>
    <td style="text-align: center;"><button class="row-actions-btn" onclick="openEquipTypeActions(event, ${i})" title="Действия"><i class="fa-solid fa-ellipsis-vertical"></i></button></td>
  </tr>`).join('');
  updateEquipmentTypesWarning();
}

function updateEquipmentType(idx, field, value) {
  if (idx < 0 || idx >= _cachedEquipmentTypes.length) return;
  if (field === 'interval') {
    const n = parseInt(value, 10);
    _cachedEquipmentTypes[idx][field] = (Number.isFinite(n) && n >= 1 && n <= 120) ? n : 12;
  } else {
    _cachedEquipmentTypes[idx][field] = String(value).trim();
  }
  updateEquipmentTypesWarning();
}

function moveEquipmentType(idx, dir) {
  const to = idx + dir;
  if (to < 0 || to >= _cachedEquipmentTypes.length) return;
  [_cachedEquipmentTypes[idx], _cachedEquipmentTypes[to]] = [_cachedEquipmentTypes[to], _cachedEquipmentTypes[idx]];
  renderEquipmentTypesTable();
}

async function addEquipmentType() {
  const value = await showPrompt('Ключ типа', {
      icon: 'fa-screwdriver-wrench', title: 'Новый тип', okText: 'Добавить', placeholder: 'Например: ph_meter',
      validator: (v) => {
        if (!v) return 'Укажите ключ';
        const t = v.trim().toLowerCase();
        if (!/^[a-z][a-z0-9_]*$/.test(t)) return 'Только латиница, цифры и _';
        if (_cachedEquipmentTypes.some(x => x.value === t)) return 'Тип с таким ключом уже есть';
        return null;
      }
  });
  if (!value) return;
  const trimmed = value.trim().toLowerCase();
  _cachedEquipmentTypes.push({ value: trimmed, label: trimmed, prefix: 'EQ', calibrationPlace: 'internal', interval: 12 });
  renderEquipmentTypesTable();
  showToast('Тип добавлен', 'success');
}

async function deleteEquipmentType(idx) {
  if (idx < 0 || idx >= _cachedEquipmentTypes.length) return;
  const t = _cachedEquipmentTypes[idx];
  const ok = await showConfirm(`Удалить тип «${t.label}»?`, { icon: '🔧', title: 'Удаление', okText: 'Удалить', okClass: 'btn-danger' });
  if (!ok) return;
  _cachedEquipmentTypes.splice(idx, 1);
  renderEquipmentTypesTable();
  showToast('Тип удалён', 'success');
}

function updateEquipmentTypesWarning() {
  const warn = document.getElementById('equip-types-warning');
  if (!warn) return;
  const problems = [];
  const values = _cachedEquipmentTypes.map(t => t.value);
  if (values.filter((v, i) => values.indexOf(v) !== i).length > 0) problems.push('Дубли value');
  if (_cachedEquipmentTypes.some(t => !t.label || !t.label.trim())) problems.push('Пустой label');
  
  if (problems.length > 0) {
    warn.style.display = 'block';
    warn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + problems.join(', ');
  } else {
    warn.style.display = 'none';
  }
}

async function saveEquipmentTypes() {
  const values = _cachedEquipmentTypes.map(t => t.value);
  if (values.filter((v, i) => values.indexOf(v) !== i).length > 0) { showToast('Есть дубли value', 'error'); return; }
  if (_cachedEquipmentTypes.some(t => !t.label || !t.label.trim())) { showToast('Заполните label', 'error'); return; }
  
  _cachedEquipmentTypes.forEach(t => {
    if (!t.calibrationPlace) t.calibrationPlace = 'internal';
    const n = parseInt(t.interval, 10);
    t.interval = (Number.isFinite(n) && n >= 1 && n <= 120) ? n : 12;
  });

  try {
    await UI.saveAction({ successMsg: 'Типы сохранены', reload: false }, async () => {
      await apiRequest('/settings/equipment-types', 'PUT', _cachedEquipmentTypes);
      _equipmentTypes = JSON.parse(JSON.stringify(_cachedEquipmentTypes));
      await loadFilterConfig();
      syncFilterState();
      await refreshAfterSettingsChange();
    });
  } catch (e) {}
}

// ============================================================
// РАЗДЕЛ: ПРИНТЕРЫ ЭТИКЕТОК
// ============================================================
async function renderPrintersSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    c.innerHTML = `
      <p style="color:#64748b;font-size:.85rem;margin:0 0 12px;">Список принтеров.</p>
      <div id="barcode-printers-list"></div>
      <div class="form-actions" style="margin-top:16px;">
        <button class="btn btn-primary btn-sm" onclick="addBarcodePrinter()"><i class="fa-solid fa-plus"></i> Добавить принтер</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeSettingsModal()" style="margin-left:auto;">Закрыть</button>
      </div>
    `;
    await renderBarcodePrintersList();
  } catch (e) { c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`; }
}

// ============================================================
// РАЗДЕЛ: ШТРИХКОДЫ
// ============================================================
async function renderBarcodesSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    c.innerHTML = `
      <p style="color:#64748b;font-size:.85rem;margin:0 0 12px;">Параметры печати штрихкодов.</p>
      <div class="bc-settings-block" style="margin-top:0;">
        <div class="bc-settings-title">Что печатать</div>
        <div class="bc-settings-grid">
          <div class="bc-cell"><label>Размер</label><select id="bc-label-size"><option value="58x40">58 × 40 мм</option><option value="40x25">40 × 25 мм</option><option value="100x50">100 × 50 мм</option></select></div>
          <div class="bc-cell"><label>Тип ШК</label><select id="bc-type"><option value="code128">Code-128</option><option value="qr">QR-код</option></select></div>
          <div class="bc-cell"><label>Шрифт</label><select id="bc-font"><option value="">— загрузка —</option></select></div>
          <div class="bc-cell"><label>Копий</label><input type="number" id="bc-default-copies" value="1" min="1" max="50"></div>
          <div class="bc-cell"><label>Порт агента</label><input type="number" id="bc-agent-port" value="9200"></div>
          <div class="bc-cell"><label>Макс. длина</label><input type="number" id="bc-max-length" value="255" min="8" max="255"></div>
          <div class="bc-cell bc-cell-check"><label class="bc-fallback-line"><input type="checkbox" id="bc-fallback-to-pdf"><span>Fallback на PDF</span></label></div>
        </div>
        <div class="bc-fields-section">
          <div class="bc-fields-label">Поля на этикетке:</div>
          <div id="bc-label-fields" class="bc-fields-grid"></div>
          <div class="bc-fields-hint"><i class="fa-solid fa-circle-info"></i> Влезает <b>3–4 поля</b></div>
        </div>
      </div>
      <div class="form-actions" style="margin-top:16px;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeSettingsModal()" style="margin-left:auto;">Закрыть</button>
        <button class="btn btn-success btn-sm" onclick="saveBarcodeSettings()"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
      </div>
    `;
    await loadBarcodeSettings();
  } catch (e) { c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`; }
}

// ============================================================
// ВКЛАДКА: ЛОГ
// ============================================================
async function renderLogSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    const logs = await apiRequest('/log?limit=200');
    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3>Журнал действий (${logs.length})</h3>
      <button class="btn btn-danger btn-sm" onclick="clearLogSetting()"><i class="fa-solid fa-trash"></i> Очистить</button>
    </div>
    <div class="log-container"><table class="log-table">
      <thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Детали</th></tr></thead><tbody>`;
    if (!logs.length) {
      html += '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94a3b8;">Пусто</td></tr>';
    } else {
      for (const l of logs) {
        html += `<tr><td class="timestamp">${new Date(l.timestamp).toLocaleString('ru-RU')}</td><td class="user">${esc(l.user_full_name)}</td><td class="action">${esc(l.action)}</td><td>${esc(l.details || '')}</td></tr>`;
      }
    }
    html += '</tbody></table></div>';
    html += `<div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()" style="margin-left:auto;">Закрыть</button>
      </div>`;
    c.innerHTML = html;
  } catch (e) { c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>'; }
}

async function clearLogSetting() {
  const ok = await showConfirm('Очистить журнал действий?', { icon: '🗒️', title: 'Очистка', okText: 'Очистить', okClass: 'btn-danger' });
  if (!ok) return;
  await apiRequest('/log', 'DELETE');
  showToast('Журнал очищен', 'success');
  renderLogSettings();
}

async function resetAllDataSetting() {
  if (!isAdmin()) { showToast('Доступно только администратору', 'error'); return; }
  const ok1 = await showConfirm('ВНИМАНИЕ! Всё оборудование будет удалено безвозвратно.', { icon: '⚠️', title: 'Сброс', okText: 'Продолжить', okClass: 'btn-danger' });
  if (!ok1) return;
  const ok2 = await showConfirm('Вы точно уверены?', { icon: '🚨', title: 'Последнее предупреждение', okText: 'Удалить всё', okClass: 'btn-danger' });
  if (!ok2) return;
  try {
    await apiRequest('/settings/reset-data', 'POST', {});
    showToast('Данные удалены', 'success');
    await loadPipetteData();
    closeSettingsModal();
  } catch (e) { showToast(e.message || 'Ошибка сброса данных', 'error'); }
}

// ============================================================
// МЕНЮ ДЕЙСТВИЙ ДЛЯ НАСТРОЕК
// ============================================================
function openFieldActions(ev, idx) { ev.stopPropagation(); renderRowActionsMenu(ev.currentTarget, [{ label: '<i class="fa-solid fa-trash"></i> Удалить поле', class: 'item-danger', action: () => deleteFieldSetting(idx) }]); }
function openDeptActions(ev, idx) { ev.stopPropagation(); renderRowActionsMenu(ev.currentTarget, [{ label: '<i class="fa-solid fa-trash"></i> Удалить отдел', class: 'item-danger', action: () => deleteDepartmentItem(idx) }]); }
function openFilterActions(ev, idx) { ev.stopPropagation(); renderRowActionsMenu(ev.currentTarget, [{ label: '<i class="fa-solid fa-trash"></i> Удалить фильтр', class: 'item-danger', action: () => deleteFilter(idx) }]); }
function openEquipTypeActions(ev, idx) { ev.stopPropagation(); renderRowActionsMenu(ev.currentTarget, [{ label: '<i class="fa-solid fa-trash"></i> Удалить тип', class: 'item-danger', action: () => deleteEquipmentType(idx) }]); }

