'use strict';

// ============================================================
// НАСТРОЙКИ
// ============================================================
async function openSettingsModal() {
  // Вместо UI.guard({ role: 'admin' }) используем нашу функцию isAdmin()
  if (!isAdmin()) {
    showToast('Доступно только администратору', 'error');
    return;
  }

  document.getElementById('settings-list').style.display = '';
  document.getElementById('settings-section').style.display = 'none';
  document.getElementById('settings-back-btn').style.display = 'none';
  document.getElementById('settings-header-text').textContent = 'Настройки системы';
  document.getElementById('settings-footer').style.display = '';

  renderSettingsList();
  UI.modal.open('settings-modal');
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
    if (id === 'roles')    return isAdmin() || canManageUsers(); 
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
    roles:    () => isAdmin() || canManageUsers(), // <-- Добавлено
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
    if (id === 'identity')         await renderIdentitySettingsInline(); 
    else if (id === 'fields')      await renderFieldsSettings();
    else if (id === 'departments') await renderDepartmentsSettings();
    else if (id === 'filters')     await renderFiltersSettings();
    else if (id === 'export')      await renderExportSettings();
    else if (id === 'users')       await renderUsersSettings();
    else if (id === 'roles')       await renderRolesSettings(); 
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
             <i class="fa-solid fa-ellipsis-vertical"></i>'''
          </button>
        </td>
      </tr>`;
    });
     html += `</tbody></table>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="addFieldSetting()" style="margin-right: auto;"><i class="fa-solid fa-plus"></i>''' Добавить поле</button>
        <button class="btn btn-warning" onclick="renderIdentitySettingsInline()" title="Настроить, какие поля видны в массовых операциях"><i class="fa-solid fa-list-ul"></i>''' Отображение в списках</button>
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()">Закрыть</button>
        <button class="btn btn-success" onclick="saveFieldsSettings()"><i class="fa-solid fa-floppy-disk"></i>''' Сохранить</button>
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
      { icon: '<i class="fa-solid fa-triangle-exclamation"></i>''', title: 'Скрытие обязательного поля', okText: 'Скрыть', okClass: 'btn-warning' }
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
  const label = await showPrompt('Название поля (по-русски)', {
      icon: 'fa-plus', title: 'Новое поле', okText: 'Добавить', placeholder: 'Например: Инвентарный номер',
      validator: (v) => v ? null : 'Укажите название поля'
  });
  if (!label) return;

  let baseId = slugify(label);
  let finalId = baseId;
  let counter = 1;
  while (_cachedFields.some(f => f.id === finalId)) {
    finalId = `${baseId}_${counter++}`;
  }

  _cachedFields.push({ 
    id: finalId, 
    label: label.trim(), 
    type: 'text', 
    required: false, 
    enabled: true, 
    options: [], 
    default: '', 
    order: _cachedFields.length + 1 
  });
  renderFieldsSettings(true);
}

async function deleteFieldSetting(idx) {
  const ok = await showConfirm(`Удалить поле «${_cachedFields[idx].label}»?`, { icon: '<i class="fa-solid fa-clipboard-list"></i>''', title: 'Удаление поля', okText: 'Удалить', okClass: 'btn-danger' });
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

      const ok = await showConfirm(`Поле ${listText} заполнено у ${affected} запис${recordPlural}.\n\nДанные будут стёрты. Продолжить?`, { icon: '<i class="fa-solid fa-triangle-exclamation"></i>''', title: 'Поле с данными', okText: 'Удалить', okClass: 'btn-danger' });
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
           <button class="row-actions-btn" onclick="openDeptActions(event, ${i})" title="Действия"><i class="fa-solid fa-ellipsis-vertical"></i>'''</button>
        </td>
      </tr>`;
    });
    html += `</tbody></table>
    <div class="form-actions" style="margin-top:16px;">
        <input type="text" id="new-dept-name" placeholder="Название нового отдела" style="flex:1; max-width:400px; padding:9px 12px; border:1px solid var(--border-hard); border-radius:8px; background: var(--card); color: var(--text);" onkeydown="if(event.key==='Enter'){event.preventDefault();addDepartmentItem();}">
        <button type="button" class="btn btn-success" onclick="addDepartmentItem()"><i class="fa-solid fa-plus"></i>''' Добавить</button>
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()" style="margin-left:auto;">Закрыть</button>
        <button type="button" class="btn btn-primary" onclick="saveDepartmentsFull()"><i class="fa-solid fa-floppy-disk"></i>''' Сохранить</button>
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
      warn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>''' Отдел «${esc(trimmed)}» уже существует.`;
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
  const dept = _cachedDepartmentsFull[idx];
  const name = dept.name;
  let usedCount = 0;
  try {
    const check = await apiRequest('/pipettes/paged?limit=1&filters=' + encodeURIComponent(JSON.stringify({ department: name })));
    usedCount = check.total || 0;
  } catch (e) {
    console.warn('Ошибка проверки отдела:', e);
    showToast('Не удалось проверить, используется ли отдел. Попробуйте ещё раз.', 'error');
    return; 
  }
  if (usedCount > 0) {
      showToast(`Нельзя удалить отдел «${name}»: к нему привязано ${usedCount} единиц оборудования. Сначала переведите их в другой отдел.`, 'error');
    return;
  }
  const ok = await showConfirm(`Удалить отдел «${name}»?`, { icon: '<i class="fa-solid fa-building"></i>''', title: 'Удаление отдела', okText: 'Удалить', okClass: 'btn-danger' });
  if (!ok) return;
  _cachedDepartmentsFull.splice(idx, 1);
  showToast(`Отдел «${name}» удаляется...`, 'success');
  await saveDepartmentsFull();
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
         <button class="row-actions-btn" onclick="openFilterActions(event, ${i})" title="Действия"><i class="fa-solid fa-ellipsis-vertical"></i>'''</button>
       </td>
      </tr>`;
    });
    
    html += `</tbody></table>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="addFilter()" style="margin-right: auto;"><i class="fa-solid fa-plus"></i>''' Добавить фильтр</button>
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()">Закрыть</button>
        <button class="btn btn-success" onclick="saveFilters()"><i class="fa-solid fa-floppy-disk"></i>''' Сохранить</button>
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
  const label = await showPrompt('Название фильтра (по-русски)', {
      icon: 'fa-filter', title: 'Новый фильтр', okText: 'Добавить', placeholder: 'Например: Ответственный',
      validator: (v) => v ? null : 'Укажите название'
  });
  if (!label) return;

  let baseId = slugify(label);
  let finalId = baseId;
  let counter = 1;
  while (_cachedFilters.some(f => f.id === finalId)) {
    finalId = `${baseId}_${counter++}`;
  }

  _cachedFilters.push({ 
    id: finalId, 
    label: label.trim(), 
    type: 'text', 
    fieldId: '', 
    enabled: true, 
    optionsSource: '', 
    order: _cachedFilters.length + 1 
  });
  renderFiltersSettings(true);
}


async function deleteFilter(idx) {
  const ok = await showConfirm(`Удалить фильтр «${_cachedFilters[idx].label}»?`, { icon: '<i class="fa-solid fa-magnifying-glass"></i>''', title: 'Удаление фильтра', okText: 'Удалить', okClass: 'btn-danger' });
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
// ВКЛАДКА: ПЕЧАТЬ ДОКУМЕНТОВ
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
  c.innerHTML = '<p style="color:#94a3b8;">Загрузка…</p>';
  try {
    _cachedFields = await apiRequest('/settings/fields');
    const data = await apiRequest('/settings/export');

    const settings = Array.isArray(data)
      ? { fields: data, exportEnabled: true,
          actSendEnabled: true, actSendFields: [],
          actReturnEnabled: true, actReturnFields: [],
          historyEnabled: true, historyFields: [] }
      : data;

    c.innerHTML = `
      <h3>Печать документов</h3>
      <p style="color:#64748b;font-size:.88rem;margin:0 0 14px;">
        Настройте, какие документы доступны пользователям и какие поля в них попадут.
      </p>
      <div class="prefs-tabs" style="margin-bottom:16px;">
        <button class="prefs-tab active" onclick="switchPrintTab('export', this)">📄 Печать реестра</button>
        <button class="prefs-tab" onclick="switchPrintTab('actSend', this)">📤 Печать акта отправки</button>
        <button class="prefs-tab" onclick="switchPrintTab('actReturn', this)">📥 Печать акта возврата</button>
        <button class="prefs-tab" onclick="switchPrintTab('history', this)">📜 Печать истории поверок</button>
      </div>
      <div id="print-tab-export" class="print-tab"></div>
      <div id="print-tab-actSend" class="print-tab" style="display:none;"></div>
      <div id="print-tab-actReturn" class="print-tab" style="display:none;"></div>
      <div id="print-tab-history" class="print-tab" style="display:none;"></div>
      <div class="form-actions" style="margin-top:20px;">
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()">Закрыть</button>
        <button class="btn btn-success" onclick="savePrintSettings()">
          <i class="fa-solid fa-floppy-disk"></i>''' Сохранить
        </button>
      </div>
    `;

    window._printSettingsDraft = JSON.parse(JSON.stringify(settings));

    const customIds = (_cachedFields || [])
      .filter(f => f.enabled && !SYSTEM_FIELD_IDS_IN_CONFIG.has(f.id))
      .map(f => f.id);

    const _printDefaults = {
      fields:          [...SYSTEM_EXPORT_FIELDS.map(f => f.id), ...customIds],
      actSendFields:   ['id','model','manufacturer','serial','volume','department','responsible','location','cert','notes'],
      actReturnFields: ['id','model','manufacturer','serial','volume','department','responsible','cert','result','notes'],
      historyFields:   ['date','cert','result','org','note'],
    };
    for (const key of Object.keys(_printDefaults)) {
      const arr = window._printSettingsDraft[key];
      if (!Array.isArray(arr) || arr.length === 0) {
        window._printSettingsDraft[key] = [..._printDefaults[key]];
      } else if (customIds.length > 0 && key === 'fields') {
        const set = new Set(arr);
        let added = false;
        for (const id of customIds) {
          if (!set.has(id)) { set.add(id); added = true; }
        }
        if (added) window._printSettingsDraft[key] = [...set];
      }
    }
    if (typeof window._printSettingsDraft.exportEnabled !== 'boolean') {
      window._printSettingsDraft.exportEnabled = true;
    }

    renderPrintTab('export');
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
}

function switchPrintTab(tab, btn) {
  document.querySelectorAll('#settings-section-content .prefs-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#settings-section-content .print-tab').forEach(el => el.style.display = 'none');
  document.getElementById(`print-tab-${tab}`).style.display = '';
  renderPrintTab(tab);
}

function renderPrintTab(tab) {
  const c = document.getElementById(`print-tab-${tab}`);
  const s = window._printSettingsDraft;

  const configs = {
    export: {
      enabledKey: 'exportEnabled', fieldsKey: 'fields',
      title: 'Реестр оборудования',
      hint: 'Документ при нажатии «Печать в Excel» / «Печать в PDF»',
      fields: SYSTEM_EXPORT_FIELDS,
    },
    actSend: {
      enabledKey: 'actSendEnabled', fieldsKey: 'actSendFields',
      title: 'Акт отправки на поверку',
      hint: 'Печатный документ при отправке на поверку',
      fields: [
        { id: 'id', label: 'Внутренний номер' },
        { id: 'model', label: 'Модель' },
        { id: 'manufacturer', label: 'Производитель' },
        { id: 'serial', label: 'Серийный номер' },
        { id: 'volume', label: 'Объём' },
        { id: 'department', label: 'Отдел' },
        { id: 'responsible', label: 'Ответственный' },
        { id: 'location', label: 'Место хранения' },
        { id: 'cert', label: 'Свидетельство' },
        { id: 'notes', label: 'Примечание' },
      ],
    },
    actReturn: {
      enabledKey: 'actReturnEnabled', fieldsKey: 'actReturnFields',
      title: 'Акт возврата с поверки',
      hint: 'Печатный документ при возврате с поверки',
      fields: [
        { id: 'id', label: 'Внутренний номер' },
        { id: 'model', label: 'Модель' },
        { id: 'manufacturer', label: 'Производитель' },
        { id: 'serial', label: 'Серийный номер' },
        { id: 'volume', label: 'Объём' },
        { id: 'department', label: 'Отдел' },
        { id: 'responsible', label: 'Ответственный' },
        { id: 'cert', label: 'Свидетельство' },
        { id: 'result', label: 'Результат поверки' },
        { id: 'notes', label: 'Примечание' },
      ],
    },
    history: {
      enabledKey: 'historyEnabled', fieldsKey: 'historyFields',
      title: 'Печать истории поверок',
      hint: 'Документ при нажатии «Печать истории» в модалке истории прибора',
      fields: [
        { id: 'date', label: 'Дата поверки' },
        { id: 'cert', label: 'Свидетельство' },
        { id: 'result', label: 'Результат' },
        { id: 'org', label: 'Организация' },
        { id: 'note', label: 'Примечание' },
      ],
    },
  };

  const conf = configs[tab];
  const selected = new Set(s[conf.fieldsKey] || []);

  let html = `
    <div class="info-block" style="margin-bottom:14px;">
      <strong>${esc(conf.title)}</strong><br>
      <small>${esc(conf.hint)}</small>
    </div>
  `;

  if (conf.enabledKey) {
    const isOn = !!s[conf.enabledKey];
    html += `
      <div class="form-group" style="margin-bottom:10px;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:600;">
          <input type="checkbox" id="print-enabled-${tab}"
                 ${isOn ? 'checked' : ''}
                 onchange="togglePrintEnabled('${tab}', this.checked)"
                 style="width:18px;height:18px;">
          Включить печать «${esc(conf.title)}»
        </label>
      </div>
      <div id="print-hint-${tab}" style="margin-bottom:14px;${isOn ? 'display:none;' : ''}">
        <div class="warning-block" style="margin:0;">
          ⚠️ Печать отключена. Поля заблокированы. Включите печать, чтобы настроить содержимое.
        </div>
      </div>
    `;
  }

  html += `<div class="section-title" style="margin-top:14px;">Поля в документе:</div>
    <div class="export-fields-grid" id="print-fields-${tab}"
         style="${conf.enabledKey && !s[conf.enabledKey] ? 'opacity:.45;pointer-events:none;user-select:none;' : ''}">`;

  const allFields = [...conf.fields];
  const custom = (_cachedFields || []).filter(x => x.enabled && !SYSTEM_FIELD_IDS_IN_CONFIG.has(x.id));
  for (const f of custom) allFields.push(f);

  for (const f of allFields) {
    const checked = selected.has(f.id);
    html += `
      <label>
        <input type="checkbox" class="print-field-cb"
               data-tab="${tab}" data-field="${esc(f.id)}"
               ${checked ? 'checked' : ''}
               onchange="onPrintFieldChange('${tab}', '${f.id}', this.checked)">
        ${esc(f.label)}
      </label>
    `;
  }

  html += `</div>`;
  c.innerHTML = html;
}

function togglePrintEnabled(tab, checked) {
  const s = window._printSettingsDraft;
  s[`${tab}Enabled`] = checked;
  const block = document.getElementById(`print-fields-${tab}`);
  const hint = document.getElementById(`print-hint-${tab}`);
  if (block) {
    if (checked) {
      block.style.opacity = '';
      block.style.pointerEvents = '';
      block.style.userSelect = '';
    } else {
      block.style.opacity = '.45';
      block.style.pointerEvents = 'none';
      block.style.userSelect = 'none';
    }
  }
  if (hint) hint.style.display = checked ? 'none' : '';
}

function onPrintFieldChange(tab, fieldId, checked) {
  const s = window._printSettingsDraft;
  const keyMap = {
    export: 'fields', actSend: 'actSendFields',
    actReturn: 'actReturnFields', history: 'historyFields',
  };
  const key = keyMap[tab];
  if (!Array.isArray(s[key])) s[key] = [];
  const set = new Set(s[key]);
  checked ? set.add(fieldId) : set.delete(fieldId);
  s[key] = [...set];
}

async function savePrintSettings() {
  const s = window._printSettingsDraft;
  try {
    await UI.saveAction({
      successMsg: 'Настройки печати сохранены',
      closeFn: closeSettingsModal,
      reload: false,
    }, () => apiRequest('/settings/export', 'PUT', s));
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
        <button class="btn btn-success btn-sm" onclick="saveSystemSetting()"><i class="fa-solid fa-floppy-disk"></i>''' Сохранить</button>
      </div>

      <div class="settings-form" style="margin-top:24px;border-left:3px solid #dc2626;">
        <h4 style="color:#991b1b;">Опасная зона</h4>
        <p style="color:#64748b;font-size:.88rem;margin:8px 0 12px;">
          Удаление <strong>всех данных</strong> об оборудовании и истории поверок. <strong>Действие необратимо.</strong>
        </p>
        <button class="btn btn-danger btn-sm" onclick="resetAllDataSetting()"><i class="fa-solid fa-trash"></i>''' Сбросить все данные</button>
      </div>

      <div class="form-actions" style="margin-top: 24px;">
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()">Закрыть</button>
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
    _equipmentTypesDraft = JSON.parse(JSON.stringify(types));

     c.innerHTML = `
      <p style="color:#64748b;font-size:.88rem;margin:0 0 12px;">Управление списком типов.</p>
      <table class="field-settings-table" id="equip-types-table">
       <thead>
          <tr>
            <th style="width:100px; text-align:center;">Порядок</th>
            <th style="text-align:center;">Название</th>          
            <th style="width:100px; text-align:center;">Префикс</th> 
            <th style="width:100px; text-align:center;">МПИ (мес.)</th>
            <th style="width:200px; text-align:center;">Место поверки</th>
            <th style="width:90px; text-align:center;">Замена</th>
            <th style="width:60px;"></th>
          </tr>
        </thead>
        <tbody id="equip-types-body"></tbody>
      </table>

      <div class="form-actions">
        <button class="btn btn-primary btn-sm" onclick="addEquipmentType()" style="margin-right: auto;"><i class="fa-solid fa-plus"></i>''' Добавить тип</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeSettingsModal()">Закрыть</button>
        <button class="btn btn-success btn-sm" onclick="saveEquipmentTypes()"><i class="fa-solid fa-floppy-disk"></i>''' Сохранить</button>
      </div>
      <div id="equip-types-warning" style="display:none;margin-top:12px;padding:10px 12px;background:#fee2e2;border-left:3px solid #dc2626;border-radius:6px;color:#991b1b;font-size:.85rem;"></div>
    `;
    renderEquipmentTypesTable();
  } catch (e) { c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`; }
}

function renderEquipmentTypesTable() {
  const tbody = document.getElementById('equip-types-body');
  if (!tbody) return;
  
  if (_equipmentTypesDraft.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:20px;">Нет типов. Нажмите «Добавить тип».</td></tr>';
    return;
  }
  
  tbody.innerHTML = _equipmentTypesDraft.map((t, i) => `
  <tr>
    <td>${UI.moveBtns(i, _equipmentTypesDraft.length, 'moveEquipmentType')}</td>
    <td><input type="text" value="${esc(t.label)}" oninput="updateEquipmentType(${i}, 'label', this.value)"></td>
    <td><input type="text" value="${esc(t.prefix || '')}" maxlength="4" style="text-align:center;text-transform:uppercase;" oninput="updateEquipmentType(${i}, 'prefix', this.value.toUpperCase())"></td>
    <td><input type="number" value="${Number.isFinite(parseInt(t.interval, 10)) && parseInt(t.interval, 10) > 0 ? parseInt(t.interval, 10) : 12}" min="1" max="120" style="text-align:center;" oninput="updateEquipmentType(${i}, 'interval', this.value)"></td>
     <td>
      <select onchange="updateEquipmentType(${i}, 'calibrationPlace', this.value)">
        <option value="external" ${t.calibrationPlace === 'external' ? 'selected' : ''}>📦 Внешняя</option>
        <option value="internal" ${(!t.calibrationPlace || t.calibrationPlace === 'internal') ? 'selected' : ''}>🏠 На месте</option>
      </select>
    </td>
    <td style="text-align: center;">
      <input type="checkbox" ${t.allowReplacement !== false ? 'checked' : ''} onchange="updateEquipmentType(${i}, 'allowReplacement', this.checked)" title="Предлагать замену со склада">
    </td>
   <td style="text-align: center;"><button class="row-actions-btn" onclick="openEquipTypeActions(event, ${i})" title="Действия"><i class="fa-solid fa-ellipsis-vertical"></i>'''</button></td>
  </tr>`).join('');
  
  updateEquipmentTypesWarning();
}

function updateEquipmentType(idx, field, value) {
  if (idx < 0 || idx >= _equipmentTypesDraft.length) return;
  if (field === 'interval') {
    const n = parseInt(value, 10);
    _equipmentTypesDraft[idx][field] = (Number.isFinite(n) && n >= 1 && n <= 120) ? n : 12;
  } else if (field === 'allowReplacement') {
    _equipmentTypesDraft[idx][field] = !!value;
  } else {
    _equipmentTypesDraft[idx][field] = String(value).trim();
  }
  updateEquipmentTypesWarning();
}

function moveEquipmentType(idx, dir) {
  const to = idx + dir;
  if (to < 0 || to >= _equipmentTypesDraft.length) return;
  [_equipmentTypesDraft[idx], _equipmentTypesDraft[to]] = [_equipmentTypesDraft[to], _equipmentTypesDraft[idx]];
  renderEquipmentTypesTable();
}

async function addEquipmentType() {
  const label = await showPrompt('Название типа (по-русски)', {
      icon: 'fa-screwdriver-wrench', title: 'Новый тип', okText: 'Добавить', placeholder: 'Например: Пипетка',
      validator: (v) => v ? null : 'Укажите название'
  });
  if (!label) return;
  
  let baseValue = slugify(label);
  let finalValue = baseValue;
  let counter = 1;
  while (_equipmentTypesDraft.some(x => x.value === finalValue)) {
    finalValue = `${baseValue}_${counter++}`;
  }

  _equipmentTypesDraft.push({ 
    value: finalValue, 
    label: label.trim(), 
    prefix: 'EQ', 
    calibrationPlace: 'internal', 
    interval: 12, 
    allowReplacement: true
  });
  renderEquipmentTypesTable();
  showToast('Тип добавлен', 'success');
}

async function deleteEquipmentType(idx) {
  if (idx < 0 || idx >= _equipmentTypesDraft.length) return;
  const t = _equipmentTypesDraft[idx];
  const ok = await showConfirm(`Удалить тип «${t.label}»?`, { icon: '<i class="fa-solid fa-screwdriver-wrench"></i>''', title: 'Удаление', okText: 'Удалить', okClass: 'btn-danger' });
  if (!ok) return;
  _equipmentTypesDraft.splice(idx, 1);
  renderEquipmentTypesTable();
  showToast('Тип удалён', 'success');
}

function updateEquipmentTypesWarning() {
  const warn = document.getElementById('equip-types-warning');
  if (!warn) return;
  const problems = [];
  const values = _equipmentTypesDraft.map(t => t.value);
  if (values.filter((v, i) => values.indexOf(v) !== i).length > 0) problems.push('Дубли value');
  if (_equipmentTypesDraft.some(t => !t.label || !t.label.trim())) problems.push('Пустой label');
  
  if (problems.length > 0) {
    warn.style.display = 'block';
    warn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>''' ' + problems.join(', ');
  } else {
    warn.style.display = 'none';
  }
}

async function saveEquipmentTypes() {
  const values = _equipmentTypesDraft.map(t => t.value);
  if (values.filter((v, i) => values.indexOf(v) !== i).length > 0) { showToast('Есть дубли value', 'error'); return; }
  if (_equipmentTypesDraft.some(t => !t.label || !t.label.trim())) { showToast('Заполните label', 'error'); return; }
  
  _equipmentTypesDraft.forEach(t => {
    if (!t.calibrationPlace) t.calibrationPlace = 'internal';
    const n = parseInt(t.interval, 10);
    t.interval = (Number.isFinite(n) && n >= 1 && n <= 120) ? n : 12;
  });

  try {
    await UI.saveAction({ successMsg: 'Типы сохранены', reload: false }, async () => {
      await apiRequest('/settings/equipment-types', 'PUT', _equipmentTypesDraft);
      _equipmentTypes = JSON.parse(JSON.stringify(_equipmentTypesDraft));
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
        <button class="btn btn-primary btn-sm" onclick="addBarcodePrinter()" style="margin-right: auto;"><i class="fa-solid fa-plus"></i>''' Добавить принтер</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeSettingsModal()">Закрыть</button>
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
          <div class="bc-fields-hint"><i class="fa-solid fa-circle-info"></i>''' Влезает <b>3–4 поля</b></div>
        </div>
      </div>
      <div class="form-actions" style="margin-top:16px;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeSettingsModal()">Закрыть</button>
        <button class="btn btn-success btn-sm" onclick="saveBarcodeSettings()"><i class="fa-solid fa-floppy-disk"></i>''' Сохранить</button>
      </div>
    `;
    await loadBarcodeSettings();
  } catch (e) { c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`; }
}

// ============================================================
// ВКЛАДКА: ЛОГ (с аудитом и фильтрами)
// ============================================================
let _logCache = [];
let _logFiltered = [];

async function renderLogSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    const logs = await apiRequest('/log?limit=1000');
    _logCache = Array.isArray(logs) ? logs : [];

    const cats = {};
    for (const l of _logCache) cats[l.category || 'other'] = (cats[l.category || 'other'] || 0) + 1;
    const catOptions = Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<option value="${esc(k)}">${esc(_catLabel(k))} (${v})</option>`).join('');

    c.innerHTML = `
      <h3>Журнал действий (${_logCache.length})</h3>
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <input type="text" id="log-search" placeholder="Поиск по пользователю, действию, деталям..."
               style="flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border-hard);border-radius:8px;font-size:13px;"
               oninput="renderLogList()">
        <select id="log-category" onchange="renderLogList()"
                style="padding:8px;border:1px solid var(--border-hard);border-radius:8px;font-size:13px;">
          <option value="">Все категории</option>
          ${catOptions}
        </select>
        <select id="log-period" onchange="onLogPeriodChange()"
                style="padding:8px;border:1px solid var(--border-hard);border-radius:8px;font-size:13px;">
          <option value="">Всё время</option>
          <option value="today">Сегодня</option>
          <option value="week">7 дней</option>
          <option value="month">30 дней</option>
          <option value="custom">Произвольный</option>
        </select>
        <button class="btn btn-secondary" onclick="renderLogSettings()"><i class="fa-solid fa-rotate"></i>'''</button>
        <button class="btn btn-danger" onclick="clearLogSetting()"><i class="fa-solid fa-trash"></i>'''</button>
      </div>
      <div id="log-custom-period" style="display:none;gap:8px;margin-bottom:10px;">
        <input type="date" id="log-from" onchange="renderLogList()" style="padding:6px;border:1px solid var(--border-hard);border-radius:8px;">
        <span style="align-self:center;">—</span>
        <input type="date" id="log-to" onchange="renderLogList()" style="padding:6px;border:1px solid var(--border-hard);border-radius:8px;">
      </div>
      <div id="log-counters" style="font-size:.85rem;color:var(--text-muted);margin-bottom:10px;"></div>
      <div class="log-container">
        <table class="log-table">
          <thead>
            <tr>
              <th style="width:140px;">Дата и время</th>
              <th style="width:130px;">Пользователь</th>
              <th style="width:120px;">Категория</th>
              <th style="width:150px;">Действие</th>
              <th>Детали</th>
            </tr>
          </thead>
          <tbody id="log-body"></tbody>
        </table>
      </div>
      <div class="form-actions" style="margin-top:16px;">
        <span id="log-total" style="color:var(--text-muted);font-size:.85rem;margin-right:auto;"></span>
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()">Закрыть</button>
      </div>
    `;
    renderLogList();
  } catch (e) {
    c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + esc(e.message) + '</p>';
  }
}

function onLogPeriodChange() {
  const v = document.getElementById('log-period').value;
  const box = document.getElementById('log-custom-period');
  box.style.display = v === 'custom' ? 'flex' : 'none';
  box.style.gap = '8px';
  renderLogList();
}

function _logPeriodRange() {
  const period = document.getElementById('log-period').value;
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
      from: document.getElementById('log-from').value || '',
      to: document.getElementById('log-to').value || ''
    };
  }
  return { from: '', to: '' };
}

function renderLogList() {
  const q = (document.getElementById('log-search')?.value || '').trim().toLowerCase();
  const cat = document.getElementById('log-category')?.value || '';
  const { from, to } = _logPeriodRange();

  _logFiltered = _logCache.filter(l => {
    if (cat && (l.category || 'other') !== cat) return false;
    const d = (l.timestamp || '').slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (q) {
      const hay = [l.user_full_name, l.action, l.details, l.pipette_id]
        .map(x => String(x || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const counters = document.getElementById('log-counters');
  if (counters) {
    const cats = {};
    for (const l of _logFiltered) cats[l.category || 'other'] = (cats[l.category || 'other'] || 0) + 1;
    const parts = Object.entries(cats).map(([k, v]) => `${_catLabel(k)}: ${v}`).join(' · ');
    counters.textContent = parts || '';
  }

  const tbody = document.getElementById('log-body');
  if (!tbody) return;
  if (!_logFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">Нет записей</td></tr>';
  } else {
    tbody.innerHTML = _logFiltered.map(l => `
      <tr>
        <td class="timestamp">${new Date(l.timestamp).toLocaleString('ru-RU')}</td>
        <td class="user">${esc(l.user_full_name || '—')}</td>
        <td>${esc(_catLabel(l.category || 'other'))}</td>
        <td class="action" style="color:${_actionColor(l.action)};font-weight:600;">${esc(l.action)}</td>
        <td style="font-size:.82rem;">${esc(l.details || '')}</td>
      </tr>`).join('');
  }

  const totalEl = document.getElementById('log-total');
  if (totalEl) totalEl.textContent = `Показано: ${_logFiltered.length} из ${_logCache.length}`;
}

async function clearLogSetting() {
  const ok = await showConfirm('Очистить журнал действий?', { icon: '<i class="fa-solid fa-note-sticky"></i>''', title: 'Очистка', okText: 'Очистить', okClass: 'btn-danger' });
  if (!ok) return;
  await apiRequest('/log', 'DELETE');
  showToast('Журнал очищен', 'success');
  renderLogSettings();
}

async function resetAllDataSetting() {
  if (!isAdmin()) { showToast('Доступно только администратору', 'error'); return; }
  const ok1 = await showConfirm('ВНИМАНИЕ! Всё оборудование будет удалено безвозвратно.', { icon: '<i class="fa-solid fa-triangle-exclamation"></i>''', title: 'Сброс', okText: 'Продолжить', okClass: 'btn-danger' });
  if (!ok1) return;
  const ok2 = await showConfirm('Вы точно уверены?', { icon: '<i class="fa-solid fa-bell"></i>''', title: 'Последнее предупреждение', okText: 'Удалить всё', okClass: 'btn-danger' });
  if (!ok2) return;
  try {
    await apiRequest('/settings/reset-data', 'POST', {});
    showToast('Данные удалены', 'success');
    await loadPipetteData();
    closeSettingsModal();
  } catch (e) { showToast(e.message || 'Ошибка сброса данных', 'error'); }
}

// ============================================================
// РАЗДЕЛ: ШАБЛОНЫ ВИДА
// ============================================================
async function renderViewTemplatesSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    const templates = await apiRequest('/view-templates');
    
    let html = `<h3>Шаблоны вида</h3>
      <p style="color:#64748b;margin-bottom:12px;">Шаблоны для настройки видимых колонок у пользователей.</p>
      <table class="field-settings-table">
        <thead><tr>
          <th>Название</th>
          <th style="text-align:center;">По умолчанию</th>
          <th style="text-align:center;">Действия</th>
        </tr></thead><tbody>`;
        
    if (templates.length === 0) {
      html += `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:20px;">Нет шаблонов</td></tr>`;
    } else {
      templates.forEach(t => {
        html += `<tr>
          <td>${esc(t.name)}</td>
          <td style="text-align:center;">${t.isDefault ? '✅' : '—'}</td>
          <td style="text-align:center;">
            <button class="row-actions-btn" onclick="openViewTemplateActions(event, ${t.id})" title="Действия"><i class="fa-solid fa-ellipsis-vertical"></i>'''</button>
          </td>
        </tr>`;
      });
    }
    
    html += `</tbody></table>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="addViewTemplate()" style="margin-right: auto;"><i class="fa-solid fa-plus"></i>''' Добавить шаблон</button>
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()">Закрыть</button>
      </div>`;
      
    c.innerHTML = html;
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
}

async function addViewTemplate() {
  const name = await showPrompt('Название шаблона', {
    icon: 'fa-plus', title: 'Новый шаблон', okText: 'Далее', placeholder: 'Например: Лаборант',
    validator: v => v ? null : 'Укажите название'
  });
  if (!name) return;
  
  const activeFields = _cachedFields.filter(f => f.enabled).map(f => f.id);
  activeFields.push('status', 'nextCalibration');
  
  try {
    await apiRequest('/view-templates', 'POST', { name, visibleFields: activeFields, isDefault: false });
    showToast('Шаблон создан', 'success');
    renderViewTemplatesSettings();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function editViewTemplate(id) {
  const templates = await apiRequest('/view-templates');
  const tpl = templates.find(t => t.id === id);
  if (!tpl) return;

  const allFields = [
    ..._cachedFields.filter(f => f.enabled).map(f => ({ id: f.id, label: f.label })),
    { id: 'status', label: 'Статус' },
    { id: 'nextCalibration', label: 'Следующая поверка' }
  ];

  let html = `<h3>Редактирование шаблона: ${esc(tpl.name)}</h3>
    <input type="hidden" id="edit-tpl-name" value="${esc(tpl.name)}">
    <div style="margin:12px 0; display:grid; grid-template-columns:1fr 1fr; gap:8px;">`;
  
  allFields.forEach(f => {
    const checked = tpl.visibleFields.includes(f.id) ? 'checked' : '';
    html += `<label><input type="checkbox" class="tpl-field-cb" value="${f.id}" ${checked}> ${esc(f.label)}</label>`;
  });
  
  html += `</div>
    <div style="margin-bottom:16px;">
      <label style="cursor:pointer; display:flex; align-items:center; gap:8px;">
        <input type="checkbox" id="edit-tpl-default" ${tpl.isDefault ? 'checked' : ''}> 
        Сделать шаблоном по умолчанию
      </label>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-secondary" onclick="renderViewTemplatesSettings()">Отмена</button>
      <button class="btn btn-success" onclick="saveViewTemplate(${id})"><i class="fa-solid fa-floppy-disk"></i>''' Сохранить</button>
    </div>`;

  document.getElementById('settings-section-content').innerHTML = html;
}

async function saveViewTemplate(id) {
  const checked = Array.from(document.querySelectorAll('.tpl-field-cb:checked')).map(cb => cb.value);
  const name = document.getElementById('edit-tpl-name').value;
  const isDefault = document.getElementById('edit-tpl-default').checked;
  
  if (checked.length === 0) {
    showToast('Выберите хотя бы одно поле', 'error');
    return;
  }

  try {
    await apiRequest('/view-templates/' + id, 'PUT', { name, visibleFields: checked, isDefault });
    showToast('Шаблон обновлён', 'success');
    renderViewTemplatesSettings();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openViewTemplateActions(ev, id) {
  ev.stopPropagation();
  renderRowActionsMenu(ev.currentTarget, [
    { label: '<i class="fa-solid fa-pen"></i>''' Редактировать', action: () => editViewTemplate(id) },
    { label: '<i class="fa-solid fa-trash"></i>''' Удалить', class: 'item-danger', action: async () => {
        const ok = await showConfirm('Удалить шаблон?', { icon: '<i class="fa-solid fa-trash"></i>''', title: 'Удаление', okText: 'Удалить', okClass: 'btn-danger' });
        if (!ok) return;
        try {
          await apiRequest('/view-templates/' + id, 'DELETE');
          showToast('Удалён', 'success');
          renderViewTemplatesSettings();
        } catch (e) { showToast(e.message, 'error'); }
    }}
  ]);
}

// ============================================================
// МЕНЮ ДЕЙСТВИЙ ДЛЯ НАСТРОЕК
// ============================================================
function openFieldActions(ev, idx) { ev.stopPropagation(); renderRowActionsMenu(ev.currentTarget, [{ label: '<i class="fa-solid fa-trash"></i>''' Удалить поле', class: 'item-danger', action: () => deleteFieldSetting(idx) }]); }
function openDeptActions(ev, idx) { ev.stopPropagation(); renderRowActionsMenu(ev.currentTarget, [{ label: '<i class="fa-solid fa-trash"></i>''' Удалить отдел', class: 'item-danger', action: () => deleteDepartmentItem(idx) }]); }
function openFilterActions(ev, idx) { ev.stopPropagation(); renderRowActionsMenu(ev.currentTarget, [{ label: '<i class="fa-solid fa-trash"></i>''' Удалить фильтр', class: 'item-danger', action: () => deleteFilter(idx) }]); }
function openEquipTypeActions(ev, idx) { ev.stopPropagation(); renderRowActionsMenu(ev.currentTarget, [{ label: '<i class="fa-solid fa-trash"></i>''' Удалить тип', class: 'item-danger', action: () => deleteEquipmentType(idx) }]); }

// ============================================================
// РАЗДЕЛ: ИДЕНТИФИКАЦИЯ ПРИБОРА
// ============================================================
async function renderIdentitySettingsInline() {
  const c = document.getElementById('settings-section-content');
  try {
    const s = await apiRequest('/settings/system');
    
    let currentIdFields = ['id', 'model', 'serial', 'inventorynumber', 'department'];
    if (s.bulk_identity_fields) {
      try { currentIdFields = JSON.parse(s.bulk_identity_fields); } catch(e) {}
    }

    c.innerHTML = `
      <h3>Отображение в списках</h3>
      <p style="color:#64748b;font-size:.88rem;margin:8px 0 16px;">
        Выберите поля, которые будут отображаться в модалках массовых операций и быстрой поверки.
        Первые выбранные ID и Модель будут стоять в заголовке, остальные — мелким шрифтом под ним.
      </p>
      <div style="display:flex;gap:12px;flex-wrap:wrap; background:var(--card-alt); padding:16px; border-radius:8px;">
        ${[
          { id: 'id', label: 'ID' },
          { id: 'model', label: 'Модель' },
          { id: 'serial', label: 'Серийный номер' },
          { id: 'inventorynumber', label: 'Инвентарный номер' },
          { id: 'department', label: 'Отдел' },
          { id: 'responsible', label: 'Ответственный' }
        ].map(f => `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.9rem;">
            <input type="checkbox" class="bulk-id-field-cb" value="${f.id}" ${currentIdFields.includes(f.id) ? 'checked' : ''}>
            ${f.label}
          </label>
        `).join('')}
      </div>
      <div class="form-actions" style="margin-top:20px;">
        <button type="button" class="btn btn-secondary" onclick="renderFieldsSettings(true)">
          <i class="fa-solid fa-arrow-left"></i>''' Назад к полям
        </button>
        <button class="btn btn-success" onclick="saveBulkIdentitySettings()"><i class="fa-solid fa-floppy-disk"></i>''' Сохранить</button>
      </div>
    `;
  } catch (e) { 
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`; 
  }
}

async function saveBulkIdentitySettings() {
  const fields = Array.from(document.querySelectorAll('.bulk-id-field-cb:checked')).map(cb => cb.value);
  if (fields.length === 0) { 
    showToast('Выберите хотя бы одно поле', 'error'); 
    return; 
  }
  
  try {
    await UI.saveAction({ 
      successMsg: 'Настройки отображения сохранены', 
      reload: false 
    }, async () => {
      await apiRequest('/settings/system', 'PUT', { bulk_identity_fields: JSON.stringify(fields) });
      settings.bulkIdentityFields = fields;
      if (typeof loadPipetteData === 'function') await loadPipetteData();
      await renderIdentitySettingsInline(); 
    });
  } catch (e) {}
}
// ============================================================
// РАЗДЕЛ: СПРАВКА
// ============================================================
async function renderHelpSettings() {
  const c = document.getElementById('settings-section-content');
  c.innerHTML = `<p style="color:#64748b;">Загрузка…</p>`;

  try {
    let sections = await apiRequest('/help');
    if (!Array.isArray(sections)) sections = [];

    let html = `
      <p style="color:#64748b;font-size:.88rem;margin:0 0 14px;">
        Загрузите документ Word (.docx) или PDF для каждого раздела. Пользователи увидят его в разделе «Справка».
      </p>
      <div class="help-actions-bar">
        <button class="btn btn-primary btn-sm" onclick="openHelpFileUploadModal()">
          <i class="fa-solid fa-plus"></i>''' Добавить раздел с файлом
        </button>
        <button class="btn btn-warning btn-sm" onclick="resetHelpToFactory()">
          <i class="fa-solid fa-rotate-left"></i>''' Сбросить к заводской
        </button>
      </div>
    `;

    if (sections.length === 0) {
      html += `<div class="help-empty">Разделов пока нет.</div>`;
      c.innerHTML = html;
      return;
    }

    html += `<table class="help-admin-table">
      <thead>
        <tr>
          <th>Название раздела</th>
          <th style="width: 200px;">Файл</th>
          <th style="width: 80px;">Показ</th>
          <th style="width: 80px;">Действия</th>
        </tr>
      </thead>
      <tbody>`;

    const fileExistsMap = new Map();
    await Promise.all(sections.map(async (s) => {
      if (!s.filePath) {
        fileExistsMap.set(s.slug, null);
        return;
      }
      try {
        const r = await fetch('/' + s.filePath, { method: 'HEAD' });
        fileExistsMap.set(s.slug, r.ok);
      } catch {
        fileExistsMap.set(s.slug, false);
      }
    }));

    sections.sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0)).forEach(s => {
      const fileName = s.filePath ? s.filePath.split('/').pop() : 'Нет файла';
      const exists = fileExistsMap.get(s.slug);
      
      let fileCell;
      if (!s.filePath) {
        fileCell = `<span style="font-size:.8rem;color:#94a3b8;">— нет файла —</span>`;
      } else if (exists) {
        fileCell = `<span style="font-size:.8rem;color:#0369a1;"><i class="fa-solid fa-file"></i>''' ${esc(fileName)}</span>`;
      } else {
        fileCell = `<span style="font-size:.8rem;color:#dc2626;font-weight:600;" title="Файл в БД прописан, но физически отсутствует на сервере">
          <i class="fa-solid fa-triangle-exclamation"></i>''' ${esc(fileName)} — ОТСУТСТВУЕТ
        </span>`;
      }

      html += `<tr>
        <td><strong>${esc(s.title)}</strong></td> 
        <td>${fileCell}</td>
        <td style="text-align:center;">${s.enabled ? '✅' : '❌'}</td>
        <td class="help-admin-actions">
          <button class="row-actions-btn" onclick="openHelpAdminActions(event, '${esc(s.slug)}')" title="Действия">
            <i class="fa-solid fa-ellipsis-vertical"></i>'''
          </button>
        </td>
      </tr>`;
    });

    html += '</tbody></table>';
    c.innerHTML = html;

  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
}

function openHelpAdminActions(ev, slug) {
  ev.stopPropagation();
  const items = [
    { label: '<i class="fa-solid fa-pen"></i>''' Заменить файл / Изменить', action: () => openHelpFileUploadModal(slug) },
    { label: '<i class="fa-solid fa-trash"></i>''' Удалить раздел', class: 'item-danger', action: () => deleteHelpSection(slug) }
  ];
  renderRowActionsMenu(ev.currentTarget, items);
}

let _hupSelectedPerms = [];

async function openHelpFileUploadModal(slug = null) {
  const isEdit = !!slug;
  let sec = null;
  _hupSelectedPerms = [];
  
  if (isEdit) {
    const sections = await apiRequest('/help');
    sec = sections.find(x => x.slug === slug);
    if (sec && sec.requiredPermissions) _hupSelectedPerms = [...sec.requiredPermissions];
  }

  const groups = {};
  ALL_PERMISSIONS.forEach(p => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });

  let permsHtml = '';
  for (const [group, items] of Object.entries(groups)) {
    permsHtml += `<div style="font-size:.7rem;font-weight:700;color:#94a3b8;margin:8px 0 4px 4px;text-transform:uppercase;">${group}</div>`;
    
    permsHtml += items.map(p => `
      <label class="hup-menu-item" style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;">
        <input type="checkbox" value="${p.key}" class="hup-perm-cb" ${_hupSelectedPerms.includes(p.key) ? 'checked' : ''} onchange="updateHupPermCount()">
        <span style="font-size:.85rem;color:var(--text-strong);">${p.label.replace(/<[^>]+>/g, '')}</span>
      </label>
    `).join('');
  }

  const modalHtml = `
    <div class="modal-overlay active" id="help-upload-modal" style="z-index:1000;">
      <div class="modal" style="max-width: 500px;">
        <h2><i class="fa-solid fa-upload"></i>''' ${isEdit ? 'Изменить раздел' : 'Новый раздел справки'}</h2>
        
        <div class="form-group">
          <label>Название (видно пользователям) *</label>
          <input type="text" id="hup-title" value="${isEdit ? esc(sec.title) : ''}" placeholder="Например: Вход в систему">
        </div>
        
        <div class="form-group">
          <label>Документ (PDF или DOCX) *</label>
          <input type="file" id="hup-file" accept=".pdf,.docx,.doc" ${isEdit ? '' : 'required'}>
          ${isEdit ? '<small style="color:#64748b;">Оставьте пустым, чтобы сохранить текущий файл</small>' : ''}
        </div>

        <div class="form-group">
          <label>Права доступа (кто увидит)</label>
          <div class="hup-multiselect-wrap">
            <div class="hup-multiselect-trigger" onclick="toggleHupDropdown(event)">
              <span id="hup-perm-text">Выбрано: ${_hupSelectedPerms.length} прав</span>
              <i class="fa-solid fa-caret-down"></i>'''
            </div>
            <div class="hup-multiselect-menu" id="hup-perm-menu">
              ${permsHtml}
            </div>
          </div>
          <small style="color:#64748b;margin-top:6px;display:block;">Если ничего не выбрано — раздел видят все.</small>
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="document.getElementById('help-upload-modal').remove()">Отмена</button>
          <button class="btn btn-success" onclick="uploadHelpFile('${slug || ''}')"><i class="fa-solid fa-upload"></i>''' Сохранить</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  updateHupPermCount();
}

function toggleHupDropdown(e) {
  e.stopPropagation();
  const menu = document.getElementById('hup-perm-menu');
  menu.classList.toggle('show');
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('hup-perm-menu');
  if (menu && !e.target.closest('.hup-multiselect-wrap')) {
    menu.classList.remove('show');
  }
});

function updateHupPermCount() {
  const cbs = document.querySelectorAll('.hup-perm-cb:checked');
  const txt = document.getElementById('hup-perm-text');
  if (txt) txt.textContent = `Выбрано: ${cbs.length} прав`;
}

async function uploadHelpFile(slug) {
  const title = document.getElementById('hup-title').value.trim();
  const fileInput = document.getElementById('hup-file');
  
  _hupSelectedPerms = Array.from(document.querySelectorAll('.hup-perm-cb:checked')).map(cb => cb.value);

  if (!title) { showToast('Заполните название', 'error'); return; }
  if (!slug && (!fileInput.files || !fileInput.files[0])) { showToast('Выберите файл', 'error'); return; }

  const fd = new FormData();
  fd.append('title', title);
  if (slug) fd.append('slug', slug);
  fd.append('requiredPermissions', JSON.stringify(_hupSelectedPerms));
  fd.append('enabled', 'true');
  if (fileInput.files[0]) fd.append('file', fileInput.files[0]);

  try {
    const btn = document.querySelector('#help-upload-modal .btn-success');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>''' Загрузка...';
    
    const res = await fetch('/api/help/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken },
      body: fd
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Ошибка сервера');

    showToast('Раздел сохранен', 'success');
    document.getElementById('help-upload-modal').remove();
    renderHelpSettings();
  } catch (e) {
    showToast(e.message, 'error');
    const btn = document.querySelector('#help-upload-modal .btn-success');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-upload"></i>''' Сохранить'; }
  }
}

async function deleteHelpSection(slug) {
  const ok = await showConfirm('Удалить раздел справки?', { icon: '<i class="fa-solid fa-trash"></i>''', title: 'Удаление', okText: 'Удалить', okClass: 'btn-danger' });
  if (!ok) return;
  try {
    await apiRequest('/help/' + slug, 'DELETE');
    showToast('Удален', 'success');
    renderHelpSettings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function resetHelpToFactory() {
  const ok = await showConfirm('Сбросить справку к заводской? Все изменения названий и добавленные разделы будут потеряны.', { icon: '<i class="fa-solid fa-triangle-exclamation"></i>''', title: 'Сброс', okText: 'Сбросить', okClass: 'btn-warning' });
  if (!ok) return;
  try {
    await apiRequest('/help/reset', 'POST', {});
    showToast('Справка восстановлена', 'success');
    renderHelpSettings();
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// ВКЛАДКА: РОЛИ И ПРАВА
// ============================================================
let _cachedRolesList = [];

async function renderRolesSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    _cachedRolesList = await apiRequest('/roles');

    let html = `
      <h3>Управление ролями</h3>
      <p style="color:#64748b;margin-bottom:12px;">Настройте права доступа для каждой роли.</p>
      <table class="field-settings-table">
        <thead><tr>
          <th>Название</th>
          <th style="text-align:center;">Код (value)</th>
          <th style="text-align:center;">Админ</th>
          <th style="text-align:center;">Права</th>
          <th style="width:60px;"></th>
        </tr></thead><tbody>`;

    _cachedRolesList.forEach(r => {
      const permsCount = r.permissions ? r.permissions.length : 0;
      const isAdminText = r.isAdmin ? '<span style="color:#dc2626;font-weight:bold;">Да</span>' : '—';
      const sysBadge = r.isSystem ? ' <i class="fa-solid fa-lock" style="color:#94a3b8;font-size:0.8em;" title="Системная роль"></i>'''' : '';

      html += `<tr>
        <td><strong>${esc(r.name)}</strong>${sysBadge}</td>
        <td style="text-align:center;color:#64748b;font-family:monospace;">${esc(r.value)}</td>
        <td style="text-align:center;">${isAdminText}</td>
        <td style="text-align:center;">${r.isAdmin ? 'Все' : permsCount + ' шт.'}</td>
        <td style="text-align:center;">
          <button class="row-actions-btn" onclick="openRoleActions(event, ${r.id})" title="Действия">
            <i class="fa-solid fa-ellipsis-vertical"></i>'''
          </button>
        </td>
      </tr>`;
    });

    html += `</tbody></table>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="openRoleModal()" style="margin-right: auto;"><i class="fa-solid fa-plus"></i>''' Добавить роль</button>
        <button type="button" class="btn btn-secondary" onclick="closeSettingsModal()">Закрыть</button>
      </div>`;

    c.innerHTML = html;
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
}

function openRoleActions(ev, id) {
  ev.stopPropagation();
  const role = _cachedRolesList.find(r => r.id === id);
  const items = [
    { label: '<i class="fa-solid fa-pen"></i>''' Редактировать', action: () => openRoleModal(id) }
  ];

  // Системную роль "admin" удалять нельзя (это защищено на бэке, но и на фронте скроем)
  if (!role.isSystem && role.value !== 'admin') {
    items.push({ 
      label: '<i class="fa-solid fa-trash"></i>''' Удалить', 
      class: 'item-danger', 
      action: () => deleteRoleSetting(id) 
    });
  }

  renderRowActionsMenu(ev.currentTarget, items);
}

async function openRoleModal(editId = null) {
  const isEdit = !!editId;
  let role = { name: '', isAdmin: false, permissions: [] };
  
  if (isEdit) {
    role = _cachedRolesList.find(r => r.id === editId);
    if (!role) return;
  }

  // Группируем права по категориям
  const groups = {};
  ALL_PERMISSIONS.forEach(p => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });

  let permsHtml = '';
  for (const [group, items] of Object.entries(groups)) {
    permsHtml += `<div style="font-size:.7rem;font-weight:700;color:#94a3b8;margin:8px 0 4px 4px;text-transform:uppercase;">${group}</div>`;
    permsHtml += items.map(p => {
      const checked = role.permissions.includes(p.key) ? 'checked' : '';
      return `<label style="display:flex;align-items:center;gap:8px;padding:4px 8px;cursor:pointer;">
        <input type="checkbox" class="role-perm-cb" value="${p.key}" ${checked} ${role.isAdmin ? 'disabled' : ''}>
        <span style="font-size:.85rem;">${p.label}</span>
      </label>`;
    }).join('');
  }

  // Скрываем чекбокс "Админ", если текущий пользователь сам не админ
  const adminCheckboxHtml = isAdmin() ? `
    <div class="form-group" style="margin-top:12px; padding:10px; background:var(--card-alt); border-radius:6px;">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="checkbox" id="role-is-admin" ${role.isAdmin ? 'checked' : ''} ${role.value === 'admin' ? 'disabled' : ''} onchange="toggleRoleAdminMode(this.checked)">
        <span style="font-weight:600;color:#dc2626;">Дать полные права администратора</span>
      </label>
      <small style="color:#64748b;margin-top:4px;display:block;">Администраторы игнорируют список прав ниже.</small>
    </div>
  ` : '';

  const modalHtml = `
    <div class="modal-overlay active" id="role-modal" style="z-index:1000;">
      <div class="modal" style="max-width: 500px;">
        <h2><i class="fa-solid fa-user-shield"></i>''' ${isEdit ? 'Редактирование роли' : 'Новая роль'}</h2>
        
        <div class="form-group">
          <label>Название роли (видно пользователям) *</label>
          <input type="text" id="role-name" value="${esc(role.name)}" placeholder="Например: Заведующий лабораторией">
        </div>

        ${adminCheckboxHtml}
        <div class="form-group" style="max-height: 300px; overflow-y: auto; border:1px solid var(--border-hard); padding:8px; border-radius:8px;">
          <div id="role-perms-wrap" style="${role.isAdmin ? 'opacity:0.5;pointer-events:none;' : ''}">
            ${permsHtml}
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="document.getElementById('role-modal').remove()">Отмена</button>
          <button class="btn btn-success" onclick="saveRoleSetting(${isEdit ? editId : 'null'})"><i class="fa-solid fa-floppy-disk"></i>''' Сохранить</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function toggleRoleAdminMode(isAdmin) {
  const wrap = document.getElementById('role-perms-wrap');
  const cbs = document.querySelectorAll('.role-perm-cb');
  if (isAdmin) {
    wrap.style.opacity = '0.5';
    wrap.style.pointerEvents = 'none';
  } else {
    wrap.style.opacity = '1';
    wrap.style.pointerEvents = '';
  }
}

async function saveRoleSetting(editId) {
  const name = document.getElementById('role-name').value.trim();
  const isAdminEl = document.getElementById('role-is-admin');
  const isAdmin = isAdminEl ? isAdminEl.checked : false;
  
  if (!name) {
    showToast('Укажите название роли', 'error');
    return;
  }

  const permissions = [];
  if (!isAdmin) {
    document.querySelectorAll('.role-perm-cb:checked').forEach(cb => permissions.push(cb.value));
  }

  const payload = { name, permissions, isAdmin };
  const btn = document.querySelector('#role-modal .btn-success');
  
  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>''' Сохранение...';

    if (editId) {
      await apiRequest('/roles/' + editId, 'PUT', payload);
    } else {
      await apiRequest('/roles', 'POST', payload);
    }
    
    showToast('Роль сохранена', 'success');
    document.getElementById('role-modal').remove();
    renderRolesSettings(); // Перезагружаем таблицу
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>''' Сохранить';
  }
}

async function deleteRoleSetting(id) {
  const role = _cachedRolesList.find(r => r.id === id);
  if (!role) return;

  const ok = await showConfirm(
    `Удалить роль «${role.name}»?`, 
    { icon: '<i class="fa-solid fa-trash"></i>''', title: 'Удаление роли', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;

  try {
    await apiRequest('/roles/' + id, 'DELETE');
    showToast('Роль удалена', 'success');
    renderRolesSettings();
  } catch (e) {
    // Если бэк вернул 400 (роль используется пользователями)
    showToast(e.message, 'error');
  }
}
