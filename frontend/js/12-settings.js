'use strict';

// ============================================================
// НАСТРОЙКИ
// ============================================================
async function openSettingsModal() {
  await refreshCurrentUser();
  if (!isAdmin()) { showToast('Доступно только администратору', 'error'); return; }

  document.getElementById('settings-list').style.display = '';
  document.getElementById('settings-section').style.display = 'none';
  document.getElementById('settings-back-btn').style.display = 'none';
  document.getElementById('settings-header-text').textContent = 'Настройки системы';
  document.getElementById('settings-footer').style.display = '';

  renderSettingsList();
  document.getElementById('settings-modal').classList.add('active');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.remove('active');
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
          <th style="width:60px;">Порядок</th>
          <th>Название</th>
          <th style="width:120px;">Тип</th>
          <th style="width:80px;">Обяз.</th>
          <th style="width:80px;">Активно</th>
          <th>Список значений</th>
          <th style="width:60px;"></th>
        </tr></thead><tbody>`;

    _cachedFields.forEach((f, i) => {
  html += `<tr>
    <td>
      <div class="order-btns">
        <button class="btn btn-secondary btn-sm" onclick="moveFilter(${i},-1)" title="Выше">
          <i class="fa-solid fa-arrow-up"></i>
        </button>
        <button class="btn btn-secondary btn-sm" onclick="moveFieldSetting(${i},1)" title="Ниже">
          <i class="fa-solid fa-arrow-down"></i>
        </button>
      </div>
    </td>
    <td><input type="text" value="${esc(f.label)}" oninput="_cachedFields[${i}].label=this.value"></td>
        <td>${renderFieldTypeSelect(i, f)}</td>
        <td style="text-align:center;"><input type="checkbox" ${f.required ? 'checked' : ''} onchange="_cachedFields[${i}].required=this.checked"></td>
        <td style="text-align:center;"><input type="checkbox" ${f.enabled ? 'checked' : ''} onchange="_cachedFields[${i}].enabled=this.checked"></td>
       <td>${renderFieldOptionsCell(i, f.type)}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteFieldSetting(${i})"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`;
    });
   html += `</tbody></table>
  <button class="btn btn-primary" onclick="addFieldSetting()" style="margin-top:12px;"><i class="fa-solid fa-plus"></i> Добавить поле</button>
  <button class="btn btn-success" onclick="saveFieldsSettings()" style="margin-top:12px;margin-left:10px;"><i class="fa-solid fa-floppy-disk"></i> Сохранить изменения</button>`;
    c.innerHTML = html;
  } catch (e) {
    c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>';
  }
}
function renderFieldOptionsCell(idx, type) {
  if (type === 'select') {
    const opts = (_cachedFields[idx].options || []).join('\n');
        return `<textarea rows="2" oninput="_cachedFields[${idx}].options=this.value.split('\\n').map(s=>s.trim()).filter(Boolean)">${esc(opts)}</textarea>`;
  }
  return '—';
}

// Системные поля — их тип зафиксирован логикой приложения
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
  const id = await showPrompt(
    'ID нового поля (латиница, начинается с буквы)',
    {
      icon: 'fa-plus',
      title: 'Новое поле',
      okText: 'Добавить',
      placeholder: 'Например: inventorynumber',
      validator: (v) => {
        if (!v) return 'Укажите ID поля';
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(v)) return 'Только латиница, цифры и _, начиная с буквы';
        if (_cachedFields.some(f => f.id === v)) return 'Поле с таким ID уже существует';
        return null;
      }
    }
  );
  if (!id) return;

  _cachedFields.push({
    id, label: id, type: 'text', required: false, enabled: true,
    options: [], default: '', order: _cachedFields.length + 1
  });
  renderFieldsSettings(true);
}

async function deleteFieldSetting(idx) {
  const ok = await showConfirm(
    `Удалить поле «${_cachedFields[idx].label}»?`,
    { icon: '📋', title: 'Удаление поля', okText: 'Удалить', okClass: 'btn-danger' }
  );
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
      console.warn('Не удалось перезагрузить prefs после сохранения полей:', e);
    }

    const activeFieldIds = _cachedFields
      .filter(f => f.enabled)
      .map(f => f.id);

    if (!Array.isArray(myPrefs.visibleFields) || myPrefs.visibleFields.length === 0) {
      myPrefs.visibleFields = [...activeFieldIds];
    } else {
      const visibleSet = new Set(myPrefs.visibleFields);
      for (const id of activeFieldIds) {
        if (!visibleSet.has(id)) {
          myPrefs.visibleFields.push(id);
        }
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
      const plural = fieldsArr.length > 1 ? 'я' : 'е';
      const listText = fieldsArr.map(f => `«${f}»`).join(', ');
      const recordPlural = affected === 1 ? 'и' : 'ей';

      const ok = await showConfirm(
        `Поле${plural} ${listText} заполнено у ${affected} запис${recordPlural}.\n\n` +
        `При удалении данные будут безвозвратно стёрты.\n` +
        `Продолжить?`,
        {
          icon: '⚠️',
          title: 'Поле с данными',
          okText: 'Удалить и стереть',
          okClass: 'btn-danger'
        }
      );
      if (!ok) return;

      try {
        await apiRequest('/settings/fields?confirmDelete=true', 'PUT', _cachedFields);
        _cachedFields = await apiRequest('/settings/fields');

        myPrefs = { visibleFields: null, _loaded: false };
        try {
          myPrefs = await apiRequest('/settings/my-preferences') || {};
          myPrefs._loaded = true;
        } catch (err) {
          myPrefs = { _loaded: true };
        }

        const activeIds = _cachedFields.filter(f => f.enabled).map(f => f.id);
        if (!Array.isArray(myPrefs.visibleFields) || myPrefs.visibleFields.length === 0) {
          myPrefs.visibleFields = [...activeIds];
        } else {
          const activeSet = new Set(activeIds);
          const visibleSet = new Set(myPrefs.visibleFields);
          for (const id of activeIds) {
            if (!visibleSet.has(id)) myPrefs.visibleFields.push(id);
          }
          myPrefs.visibleFields = myPrefs.visibleFields.filter(id => activeSet.has(id));
        }

        showToast(`Поле удалено, данные очищены у ${affected} записей`, 'success');
        closeSettingsModal();
        await loadPipetteData();
      } catch (e2) {
        showToast(e2.message || 'Ошибка удаления', 'error');
      }
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
      <p style="color:#64748b;margin-bottom:12px;">
        Отделы <strong>не могут дублироваться</strong>. При совпадении имён — они объединяются.
      </p>
      <table class="field-settings-table">
        <thead><tr>
          <th style="width:60px;">Активно</th>
          <th>Название</th>
          <th style="width:100px;">Действия</th>
        </tr></thead><tbody>`;

    _cachedDepartmentsFull.forEach((d, i) => {
      html += `<tr>
        <td style="text-align:center;">
          <input type="checkbox" ${d.enabled ? 'checked' : ''} 
                 onchange="_cachedDepartmentsFull[${i}].enabled=this.checked">
        </td>
        <td><input type="text" value="${esc(d.name)}" 
                   oninput="onDepartmentNameChange(${i}, this.value)"></td>
        <td><button class="btn btn-danger btn-sm btn-icon-only" 
                    onclick="deleteDepartmentItem(${i})" title="Удалить">
          <i class="fa-solid fa-trash"></i>
        </button></td>
      </tr>`;
    });
    html += `</tbody></table>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <input type="text" id="new-dept-name" 
               placeholder="Название нового отдела" 
               style="flex:1;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;"
               onkeydown="if(event.key==='Enter'){event.preventDefault();addDepartmentItem();}">
        <button type="button" class="btn btn-success" onclick="addDepartmentItem()">
          <i class="fa-solid fa-plus"></i> Добавить
        </button>
        <button type="button" class="btn btn-primary" onclick="saveDepartmentsFull()">
          <i class="fa-solid fa-floppy-disk"></i> Сохранить
        </button>
      </div>
      <div id="dept-duplicate-warning" style="margin-top:12px;display:none;padding:10px 12px;background:#fee2e2;border-left:3px solid #dc2626;border-radius:6px;color:#991b1b;font-size:.85rem;">
      </div>`;
    c.innerHTML = html;
  } catch (e) {
    c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>';
  }
}

function onDepartmentNameChange(idx, value) {
  const trimmed = value.trim();
  const d = _cachedDepartmentsFull[idx];
  if (d._originalName === undefined) {
    d._originalName = d.name;
  }
  d.name = trimmed;
  
  const lower = trimmed.toLowerCase();
  const duplicates = _cachedDepartmentsFull.filter((d, i) => i !== idx && d.name.trim().toLowerCase() === lower);

  const warn = document.getElementById('dept-duplicate-warning');
  if (warn) {
    if (duplicates.length > 0 && trimmed !== '') {
      warn.style.display = 'block';
      warn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Отдел «${esc(trimmed)}» уже существует. Дубликат будет удалён при сохранении.`;
    } else {
      warn.style.display = 'none';
    }
  }
}

function addDepartmentItem() {
  const input = document.getElementById('new-dept-name');
  const name = (input ? input.value : '').trim();

  if (!name) { showToast('Заполните поле «Название отдела»', 'error'); return; }

  if (_cachedDepartmentsFull.some(d => d.name.toLowerCase() === name.toLowerCase())) {
    showToast('Такой отдел уже есть', 'error');
    return;
  }

  _cachedDepartmentsFull.push({ name, enabled: true, _originalName: null });
  renderDepartmentsSettings(true);

  setTimeout(() => {
    const inp = document.getElementById('new-dept-name');
    if (inp) inp.focus();
  }, 0);

  showToast(`Отдел «${name}» добавлен — не забудьте нажать «Сохранить»`, 'success');
}

async function deleteDepartmentItem(idx) {
  if (idx < 0 || idx >= _cachedDepartmentsFull.length) return;
  const name = _cachedDepartmentsFull[idx].name;
  const ok = await showConfirm(
    `Удалить отдел «${name}»?`,
    { icon: '🏢', title: 'Удаление отдела', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;
  _cachedDepartmentsFull.splice(idx, 1);
  renderDepartmentsSettings(true);
  showToast(`Отдел «${name}» удалён — не забудьте «Сохранить»`, 'success');
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

   cleaned.push({
  name,
  enabled: d.enabled !== false,
  oldName: (d._originalName && d._originalName !== name) ? d._originalName : null,
});
  }

  if (cleaned.length === 0) {
    showToast('Добавьте хотя бы один отдел', 'error');
    return;
  }

  if (cleaned.length !== _cachedDepartmentsFull.length) {
    showToast(`Удалены дубликаты: было ${_cachedDepartmentsFull.length}, стало ${cleaned.length}`, 'success');
  }

    try {
    await apiRequest('/settings/departments', 'PUT', cleaned);
    _cachedDepartmentsFull = cleaned;
    showToast(`Отделы сохранены (${cleaned.length})`, 'success');
    await loadDepartments();
    await loadFilterConfig();

    syncFilterState();
    currentPage = 1;
    render();
    closeSettingsModal();
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// ВКЛАДКА: ФИЛЬТРЫ
// ============================================================
async function renderFiltersSettings(skipFetch = false) {
  const c = document.getElementById('settings-section-content');
  try {
    if (!skipFetch) {
      _cachedFilters = await apiRequest('/settings/filters');
    }

    let html = `
      <h3>Управление фильтрами</h3>
      <p style="color:#64748b;margin-bottom:12px;">
        Включайте / отключайте фильтры и добавляйте новые.
      </p>
      <table class="field-settings-table">
        <thead><tr>
          <th style="width:60px;">Порядок</th>
          <th style="width:60px;">Активно</th>
          <th>Название</th>
          <th style="width:130px;">Тип</th>
          <th style="width:140px;">Источник</th>
          <th style="width:60px;"></th>
        </tr></thead><tbody>`;

    _cachedFilters.forEach((f, i) => {
      html += `<tr>
        <td>
          <div class="order-btns">
         <button class="btn btn-secondary btn-sm" onclick="moveFilter(${i},-1)" title="Выше">
            <i class="fa-solid fa-arrow-up"></i>
         </button>
         <button class="btn btn-secondary btn-sm" onclick="moveFilter(${i},1)" title="Ниже">
            <i class="fa-solid fa-arrow-down"></i>
          </button>
          </div>
        </td>
        <td style="text-align:center;">
          <input type="checkbox" ${f.enabled ? 'checked' : ''} 
                 onchange="_cachedFilters[${i}].enabled=this.checked">
        </td>
           <td><input type="text" value="${esc(f.label)}" 
                   oninput="_cachedFilters[${i}].label=this.value"></td>
        
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
        <td><button class="btn btn-danger btn-sm btn-icon-only" 
         onclick="deleteFilter(${i})" title="Удалить">
          <i class="fa-solid fa-trash"></i>
        </button></td>
      </tr>`;
    });
    html += `</tbody></table>
      <button class="btn btn-primary" onclick="addFilter()" style="margin-top:12px;">
        <i class="fa-solid fa-plus"></i> Добавить фильтр
      </button>
      <button class="btn btn-success" onclick="saveFilters()" style="margin-top:12px;margin-left:10px;">
        <i class="fa-solid fa-floppy-disk"></i> Сохранить
      </button>`;
    c.innerHTML = html;
  } catch (e) {
    c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>';
  }
}

function moveFilter(idx, dir) {
  const to = idx + dir;
  if (to < 0 || to >= _cachedFilters.length) return;
  [_cachedFilters[idx], _cachedFilters[to]] = [_cachedFilters[to], _cachedFilters[idx]];
  _cachedFilters.forEach((f, i) => f.order = i + 1);
  renderFiltersSettings(true);
}

async function addFilter() {
  const id = await showPrompt(
    'ID нового фильтра (латиница, начинается с буквы)',
    {
      icon: 'fa-filter',
      title: 'Новый фильтр',
      okText: 'Добавить',
      placeholder: 'Например: responsible',
      validator: (v) => {
        if (!v) return 'Укажите ID фильтра';
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(v)) return 'Только латиница, цифры и _';
        if (_cachedFilters.some(f => f.id === v)) return 'Такой фильтр уже есть';
        return null;
      }
    }
  );
  if (!id) return;

  _cachedFilters.push({
    id, label: id, type: 'text', fieldId: '',
    enabled: true, optionsSource: '', order: _cachedFilters.length + 1
  });
  renderFiltersSettings(true);
}

async function deleteFilter(idx) {
  const ok = await showConfirm(
    `Удалить фильтр «${_cachedFilters[idx].label}»?`,
    { icon: '🔍', title: 'Удаление фильтра', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;
  _cachedFilters.splice(idx, 1);
  _cachedFilters.forEach((f, i) => f.order = i + 1);
  renderFiltersSettings(true);
}

async function saveFilters() {
  try {
    await apiRequest('/settings/filters', 'PUT', _cachedFilters);
    showToast('Фильтры сохранены', 'success');
    await loadFilterConfig();
    _filterRendered = false;

    const panel = document.getElementById('filter-panel');
    if (panel && panel.classList.contains('show')) {
      renderFilterFields();
    }

    syncFilterState();
    currentPage = 1;
    render();
    closeSettingsModal();
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// ВКЛАДКА: ЭКСПОРТ
// ============================================================
const SYSTEM_EXPORT_FIELDS = [
  { id: 'id', label: 'Внутренний номер' },
  { id: 'serial', label: 'Серийный номер' },
  { id: 'manufacturer', label: 'Производитель' },
  { id: 'model', label: 'Модель' },
  { id: 'equipmentType', label: 'Тип оборудования' },
  { id: 'volume', label: 'Объём (мкл)' },
  { id: 'department', label: 'Отдел' },
  { id: 'lastCalibration', label: 'Дата поверки' },
  { id: 'nextCalibration', label: 'Следующая поверка' },
  { id: 'interval', label: 'МПИ (мес.)' },
  { id: 'daysLeft', label: 'Дней до поверки' },
  { id: 'responsible', label: 'Ответственный' },
  { id: 'location', label: 'Место хранения' },
  { id: 'status', label: 'Статус' },
  { id: 'cert', label: 'Свидетельство' },
  { id: 'notes', label: 'Примечание' }
];

function getExportFields() {
  const list = [...SYSTEM_EXPORT_FIELDS];
  const custom = (_cachedFields || []).filter(f =>
    f.enabled && !SYSTEM_FIELD_IDS_IN_CONFIG.has(f.id)
  );
  for (const f of custom) {
    list.push({ id: f.id, label: f.label });
  }
  return list;
}

const EXPORT_FIELDS = SYSTEM_EXPORT_FIELDS;

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
    
    html += `</div><button class="btn btn-success" onclick="saveExportSettings()"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>`;
    c.innerHTML = html;
  } catch (e) {
    c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>';
  }
}

async function saveExportSettings() {
  const selected = Array.from(document.querySelectorAll('.exp-field-cb:checked')).map(cb => cb.value);
  try {
    await apiRequest('/settings/export', 'PUT', selected);
    exportFields = selected;
    showToast('Настройки экспорта сохранены', 'success');
    closeSettingsModal();
  } catch (e) {
    showToast(e.message, 'error');
  }
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
        <button class="btn btn-success btn-sm" onclick="saveSystemSetting()">
          <i class="fa-solid fa-floppy-disk"></i> Сохранить
        </button>
      </div>

      <div class="settings-form" style="margin-top:24px;border-left:3px solid #dc2626;">
        <h4 style="color:#991b1b;">Опасная зона</h4>
        <p style="color:#64748b;font-size:.88rem;margin:8px 0 12px;">
          Удаление <strong>всех данных</strong> об оборудовании и истории поверок.
          Пользователи, отделы, поля и настройки останутся.
          <strong>Действие необратимо.</strong>
        </p>
        <button class="btn btn-danger btn-sm" onclick="resetAllDataSetting()">
          <i class="fa-solid fa-trash"></i> Сбросить все данные
        </button>
      </div>
    `;
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
}

async function saveSystemSetting() {
  const wd = document.getElementById('sys-warn-days').value;
  try {
    await apiRequest('/settings/system', 'PUT', { warn_days: String(wd) });
    settings.warnDays = parseInt(wd) || 30;
    showToast('Настройки сохранены', 'success');
    closeSettingsModal();
    render();
  } catch (e) {
    showToast(e.message, 'error');
  }
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
      <p style="color:#64748b;font-size:.88rem;margin:0 0 12px;">
        Управление списком типов. <strong>value</strong> — служебный ключ,
        <strong>label</strong> — название, <strong>prefix</strong> — префикс для авто-ID.
      </p>

      <table class="field-settings-table" id="equip-types-table">
        <thead>
          <tr>
            <th style="width:60px;">Порядок</th>
            <th style="width:140px;">value</th>
            <th>label</th>
            <th style="width:80px;">prefix</th>
            <th style="width:100px;">МПИ (мес.)</th>
            <th style="width:200px;">Место поверки</th>
            <th style="width:60px;"></th>
          </tr>
        </thead>
        <tbody id="equip-types-body"></tbody>
      </table>

      <div style="margin-top:12px;display:flex;gap:10px;">
        <button class="btn btn-primary btn-sm" onclick="addEquipmentType()">
          <i class="fa-solid fa-plus"></i> Добавить тип
        </button>
        <button class="btn btn-success btn-sm" onclick="saveEquipmentTypes()">
          <i class="fa-solid fa-floppy-disk"></i> Сохранить типы
        </button>
      </div>

      <div id="equip-types-warning"
           style="display:none;margin-top:12px;padding:10px 12px;background:#fee2e2;
                  border-left:3px solid #dc2626;border-radius:6px;color:#991b1b;font-size:.85rem;">
      </div>
    `;

    renderEquipmentTypesTable();
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
}

function renderEquipmentTypesTable() {
  const tbody = document.getElementById('equip-types-body');
  if (!tbody) return;

  if (_cachedEquipmentTypes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px;">Нет типов. Нажмите «Добавить тип».</td></tr>';
    return;
  }

    tbody.innerHTML = _cachedEquipmentTypes.map((t, i) => `
    <tr>
      <td>
        <div class="order-btns">
           <button class="btn btn-secondary btn-sm" onclick="moveEquipmentType(${i}, -1)" ${i === 0 ? 'disabled' : ''} title="Выше">
              <i class="fa-solid fa-arrow-up"></i>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="moveEquipmentType(${i}, 1)" ${i === _cachedEquipmentTypes.length - 1 ? 'disabled' : ''} title="Ниже">
                <i class="fa-solid fa-arrow-down"></i>
            </button>
        </div>
      </td>
      <td>
        <input type="text" value="${esc(t.value)}" readonly
               style="background:#f1f5f9;cursor:not-allowed;"
               title="value менять нельзя — это служебный ключ">
      </td>
      <td>
        <input type="text" value="${esc(t.label)}"
               oninput="updateEquipmentType(${i}, 'label', this.value)">
      </td>
     <td>
        <input type="text" value="${esc(t.prefix || '')}" maxlength="4"
               style="text-align:center;text-transform:uppercase;"
               oninput="updateEquipmentType(${i}, 'prefix', this.value.toUpperCase())">
      </td>
      <td>
        <input type="number" value="${Number.isFinite(parseInt(t.interval, 10)) && parseInt(t.interval, 10) > 0 ? parseInt(t.interval, 10) : 12}"
               min="1" max="120"
               style="text-align:center;"
               oninput="updateEquipmentType(${i}, 'interval', parseInt(this.value, 10) || 12)">
      </td>
      <td>
        <select onchange="updateEquipmentType(${i}, 'calibrationPlace', this.value)">
          <option value="external" ${t.calibrationPlace === 'external' ? 'selected' : ''}>📦 Внешняя (с отправкой)</option>
          <option value="internal" ${(!t.calibrationPlace || t.calibrationPlace === 'internal') ? 'selected' : ''}>🏠 На месте</option>
        </select>
      </td>
      <td>
        <button class="btn btn-danger btn-sm btn-icon-only"
                onclick="deleteEquipmentType(${i})" title="Удалить">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');

  updateEquipmentTypesWarning();
}

function updateEquipmentType(idx, field, value) {
  if (idx < 0 || idx >= _cachedEquipmentTypes.length) return;
  _cachedEquipmentTypes[idx][field] = value.trim();
  updateEquipmentTypesWarning();
}

function moveEquipmentType(idx, dir) {
  const to = idx + dir;
  if (to < 0 || to >= _cachedEquipmentTypes.length) return;
  [_cachedEquipmentTypes[idx], _cachedEquipmentTypes[to]] =
  [_cachedEquipmentTypes[to], _cachedEquipmentTypes[idx]];
  renderEquipmentTypesTable();
}

async function addEquipmentType() {
  const value = await showPrompt(
    'Ключ типа (латиница, без пробелов)',
    {
      icon: 'fa-screwdriver-wrench',
      title: 'Новый тип оборудования',
      okText: 'Добавить',
      placeholder: 'Например: ph_meter',
      validator: (v) => {
        if (!v) return 'Укажите ключ';
        const t = v.trim().toLowerCase();
        if (!/^[a-z][a-z0-9_]*$/.test(t)) return 'Только латиница, цифры и _, начиная с буквы';
        if (_cachedEquipmentTypes.some(x => x.value === t)) return 'Тип с таким ключом уже есть';
        return null;
      }
    }
  );
  if (!value) return;

  const trimmed = value.trim().toLowerCase();
  _cachedEquipmentTypes.push({
    value: trimmed, label: trimmed, prefix: 'EQ',
    calibrationPlace: 'internal', interval: 12
  });
  renderEquipmentTypesTable();
  showToast('Тип добавлен. Не забудьте нажать «Сохранить типы».', 'success');
}

async function deleteEquipmentType(idx) {
  if (idx < 0 || idx >= _cachedEquipmentTypes.length) return;
  const t = _cachedEquipmentTypes[idx];

  const ok = await showConfirm(
    `Удалить тип «${t.label}» (${t.value})?\n\nЕсли тип используется у существующего оборудования — удаление будет отклонено.`,
    { icon: '🔧', title: 'Удаление типа', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;

  _cachedEquipmentTypes.splice(idx, 1);
  renderEquipmentTypesTable();
  showToast('Тип удалён. Не забудьте нажать «Сохранить типы».', 'success');
}

function updateEquipmentTypesWarning() {
  const warn = document.getElementById('equip-types-warning');
  if (!warn) return;

  const problems = [];

  const values = _cachedEquipmentTypes.map(t => t.value);
  const dupValues = values.filter((v, i) => values.indexOf(v) !== i);
  if (dupValues.length > 0) problems.push(`Дубли value: ${[...new Set(dupValues)].join(', ')}`);

  const emptyLabels = _cachedEquipmentTypes.filter(t => !t.label || !t.label.trim());
  if (emptyLabels.length > 0) problems.push(`Пустой label у: ${emptyLabels.map(t => t.value).join(', ')}`);

  const emptyPrefixes = _cachedEquipmentTypes.filter(t => !t.prefix || !t.prefix.trim());
  if (emptyPrefixes.length > 0) problems.push(`Пустой prefix у: ${emptyPrefixes.map(t => t.value).join(', ')}`);

  const prefixes = _cachedEquipmentTypes.map(t => t.prefix).filter(Boolean);
  const dupPrefixes = prefixes.filter((v, i) => prefixes.indexOf(v) !== i);
  if (dupPrefixes.length > 0) problems.push(`Дубли prefix: ${[...new Set(dupPrefixes)].join(', ')}`);
  const noPlace = _cachedEquipmentTypes.filter(t => !t.calibrationPlace);
  if (noPlace.length > 0) {
    problems.push(`Не указано место поверки у: ${noPlace.map(t => t.value).join(', ')}`);
  }

  const badInterval = _cachedEquipmentTypes.filter(t => {
    const n = parseInt(t.interval, 10);
    return !Number.isFinite(n) || n < 1 || n > 120;
  });
  if (badInterval.length > 0) {
    problems.push(`Некорректный МПИ у: ${badInterval.map(t => t.value).join(', ')} (будет 12)`);
  }

  if (problems.length > 0) {
    warn.style.display = 'block';
    warn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + problems.join('<br><i class="fa-solid fa-triangle-exclamation"></i> ');
  } else {
    warn.style.display = 'none';
  }
}

async function saveEquipmentTypes() {
  const values = _cachedEquipmentTypes.map(t => t.value);
  const dupValues = values.filter((v, i) => values.indexOf(v) !== i);
  if (dupValues.length > 0) {
    showToast('Есть дубли value: ' + [...new Set(dupValues)].join(', '), 'error');
    return;
  }
  if (_cachedEquipmentTypes.some(t => !t.label || !t.label.trim())) {
    showToast('У всех типов должен быть label', 'error');
    return;
  }

  if (_cachedEquipmentTypes.some(t => !t.prefix || !t.prefix.trim())) {
    const ok = await showConfirm(
      'У некоторых типов не указан prefix. ID будет генерироваться с префиксом EQ. Продолжить?',
      { icon: '⚠️', title: 'Пустой prefix', okText: 'Продолжить', okClass: 'btn-warning' }
    );
    if (!ok) return;
  }
    _cachedEquipmentTypes.forEach(t => {
    if (!t.calibrationPlace) t.calibrationPlace = 'internal';
    const n = parseInt(t.interval, 10);
    t.interval = (Number.isFinite(n) && n >= 1 && n <= 120) ? n : 12;
  });

    try {
    await apiRequest('/settings/equipment-types', 'PUT', _cachedEquipmentTypes);
    showToast('Типы оборудования сохранены', 'success');
    _equipmentTypes = JSON.parse(JSON.stringify(_cachedEquipmentTypes));
    await loadFilterConfig();

    syncFilterState();
    currentPage = 1;
    render();
  } catch (e) {
    showToast(e.message || 'Ошибка сохранения', 'error');
  }
}

// ============================================================
// РАЗДЕЛ: ПРИНТЕРЫ ЭТИКЕТОК
// ============================================================
async function renderPrintersSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    c.innerHTML = `
      <p style="color:#64748b;font-size:.85rem;margin:0 0 12px;">
        Список принтеров, доступных пользователям. Каждый может быть привязан к отделу.
      </p>

      <div id="barcode-printers-list"></div>

      <button class="btn btn-primary btn-sm" onclick="addBarcodePrinter()" style="margin-top:10px;">
        <i class="fa-solid fa-plus"></i> Добавить принтер
      </button>
    `;

    await renderBarcodePrintersList();
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
}

// ============================================================
// РАЗДЕЛ: ШТРИХКОДЫ
// ============================================================
async function renderBarcodesSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    c.innerHTML = `
      <p style="color:#64748b;font-size:.85rem;margin:0 0 12px;">
        Параметры генерации и печати штрихкодов на этикетках.
      </p>

      <div class="bc-settings-block" style="margin-top:0;">
        <div class="bc-settings-title">Что печатать</div>

        <div class="bc-settings-grid">
          <div class="bc-cell">
            <label>Размер</label>
            <select id="bc-label-size">
              <option value="58x40">58 × 40 мм</option>
              <option value="40x25">40 × 25 мм</option>
              <option value="100x50">100 × 50 мм</option>
            </select>
          </div>
          <div class="bc-cell">
            <label>Тип ШК</label>
            <select id="bc-type">
              <option value="code128">Code-128</option>
              <option value="qr">QR-код</option>
            </select>
          </div>
          <div class="bc-cell">
            <label>Шрифт этикеток</label>
            <select id="bc-font">
              <option value="">— загрузка —</option>
            </select>
          </div>
          <div class="bc-cell">
            <label>Копий</label>
            <input type="number" id="bc-default-copies" value="1" min="1" max="50">
          </div>
          <div class="bc-cell">
            <label>Порт агента</label>
            <input type="number" id="bc-agent-port" value="9200">
          </div>
          <div class="bc-cell">
            <label>Макс. длина</label>
            <input type="number" id="bc-max-length" value="255" min="8" max="255">
          </div>
          <div class="bc-cell bc-cell-check">
            <label class="bc-fallback-line">
              <input type="checkbox" id="bc-fallback-to-pdf">
              <span>Fallback на PDF</span>
            </label>
          </div>
        </div>

        <div class="bc-fields-section">
          <div class="bc-fields-label">Поля на этикетке:</div>
          <div id="bc-label-fields" class="bc-fields-grid"></div>
          <div class="bc-fields-hint">
             <i class="fa-solid fa-circle-info"></i> На этикетке 58×40 мм влезает <b>3–4 поля</b>
          </div>
        </div>
      </div>

      <button class="btn btn-success btn-sm" onclick="saveBarcodeSettings()" style="margin-top:16px;">
        <i class="fa-solid fa-floppy-disk"></i> Сохранить настройки штрихкодов
      </button>
    `;

    await loadBarcodeSettings();
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
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
        html += `<tr>
          <td class="timestamp">${new Date(l.timestamp).toLocaleString('ru-RU')}</td>
          <td class="user">${esc(l.user_full_name)}</td>
          <td class="action">${esc(l.action)}</td>
          <td>${esc(l.details || '')}</td>
        </tr>`;
      }
    }
    html += '</tbody></table></div>';
    c.innerHTML = html;
  } catch (e) {
    c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>';
  }
}

async function clearLogSetting() {
  const ok = await showConfirm(
    'Очистить журнал действий? Все записи будут удалены.',
    { icon: '🗒️', title: 'Очистка журнала', okText: 'Очистить', okClass: 'btn-danger' }
  );
  if (!ok) return;
  await apiRequest('/log', 'DELETE');
  showToast('Журнал очищен', 'success');
  renderLogSettings();
}

async function resetAllDataSetting() {
  if (!isAdmin()) { showToast('Доступно только администратору', 'error'); return; }

  const ok1 = await showConfirm(
    'ВНИМАНИЕ! Всё оборудование, история поверок и журнал действий будут удалены безвозвратно.\n\nПользователи, отделы и настройки — останутся.',
    { icon: '⚠️', title: 'Сброс всех данных', okText: 'Продолжить', okClass: 'btn-danger' }
  );
  if (!ok1) return;

  const ok2 = await showConfirm(
    'Вы точно уверены? Отменить это действие будет невозможно.\n\nРекомендуем сначала сделать экспорт важных данных в Excel.',
    { icon: '🚨', title: 'Последнее предупреждение', okText: 'Удалить всё', okClass: 'btn-danger' }
  );
  if (!ok2) return;

  try {
    await apiRequest('/settings/reset-data', 'POST', {});
    showToast('Данные удалены', 'success');
    await loadPipetteData();
    closeSettingsModal();
  } catch (e) {
    showToast(e.message || 'Ошибка сброса данных', 'error');
  }
}
