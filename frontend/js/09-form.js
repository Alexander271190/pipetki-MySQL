'use strict';

// ============================================================
// ДИНАМИЧЕСКАЯ ФОРМА
// ============================================================
async function generateFormFields(data = null) {
  const container = document.getElementById('form-fields-container');
  container.innerHTML = '<p style="color:#94a3b8;padding:10px;">Загрузка полей…</p>';

  try {
       const allFields = await apiRequest('/settings/fields');
    const fields = getActiveFormFields(allFields)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    container.innerHTML = '';

    if (fields.length === 0) {
      container.innerHTML = '<p style="color:#dc2626;padding:10px;">Нет активных полей. Включите их в настройках.</p>';
      return;
    }

        for (const f of fields) {
      if (f.id === 'id' && !data) continue;

      const div = document.createElement('div');
      div.className = 'form-group';

      const label = document.createElement('label');
      label.textContent = f.label + (f.required ? ' *' : '');
      div.appendChild(label);

      const val = (data && data[f.id] !== undefined && data[f.id] !== null)
        ? data[f.id]
        : (f.default || '');

      const wrapper = document.createElement('div');
      wrapper.innerHTML = UI.renderField(f, val);
      const input = wrapper.firstElementChild;

      // Заполняем опции для select
      if (f.type === 'select') {
        fillSelectOptions(input, f, val);
      }

      // Спец-состояния
      if (f.id === 'id' && data && data.id) {
        input.readOnly = true;
        input.style.background = '#f1f5f9';
        input.style.cursor = 'not-allowed';
        input.title = 'Номер присваивается автоматически. Изменить нельзя.';
      }
      if (f.id === 'department' && currentUser.isActing) {
        input.disabled = true;
        input.style.background = '#f1f5f9';
        input.style.cursor = 'not-allowed';
        input.title = 'И.о. работает в отделе основного';
      }
      if (f.id === 'responsible' && currentUser.role !== 'admin') {
        input.disabled = true;
        input.style.background = '#f1f5f9';
        input.style.cursor = 'not-allowed';
        input.title = 'Только администратор может изменить ответственного';
      }

      div.appendChild(input);
      container.appendChild(div);
    }

    const eqSelect = document.getElementById('p-equipmentType');
    const ivInput  = document.getElementById('p-interval');
    if (eqSelect && ivInput) {
      const applyIntervalFromType = () => {
        const typeVal = eqSelect.value;
        const t = _equipmentTypes.find(x => x.value === typeVal);
        const n = t && Number.isFinite(parseInt(t.interval, 10)) && parseInt(t.interval, 10) > 0
          ? parseInt(t.interval, 10)
          : 12;
        ivInput.value = String(n);
      };

      eqSelect.addEventListener('change', async () => {
  applyIntervalFromType();
  try {
    const res = await apiRequest('/pipettes/next-id?type=' + eqSelect.value);
    const idInput = document.getElementById('p-id');
    if (idInput) idInput.value = res.nextId;
  } catch (e) {
    console.warn('Не удалось обновить ID:', e.message);
  }
});
      if (!data || !data.id) {
        applyIntervalFromType();
      }
    }

    if (document.getElementById('p-department')) {
      const datalist = document.getElementById('dept-list');
      if (datalist) {
        datalist.innerHTML = departmentsList.map(d => `<option value="${esc(d)}">`).join('');
      }
    }
  } catch (err) {
    console.error('Ошибка загрузки полей:', err);
    container.innerHTML = '<p style="color:#dc2626;padding:10px;">Ошибка загрузки полей: ' + esc(err.message) + '</p>';
  }
}

// ============================================================
// УНИВЕРСАЛЬНАЯ МОДАЛКА ДОБАВЛЕНИЯ (одна единица / партия)
// ============================================================
let _addTab = 'single';
let _bulkRows = [];
let _bulkFields = [];
const BULK_MAX_ROWS = 100;

async function openModal(id) {
  // 🆕 Защита: если типы ещё не загрузились — подгружаем
  if (!Array.isArray(_equipmentTypes) || _equipmentTypes.length === 0) {
    try {
      const types = await apiRequest('/settings/equipment-types');
      if (Array.isArray(types) && types.length > 0) _equipmentTypes = types;
    } catch (e) {
      console.warn('Не удалось загрузить типы оборудования:', e.message);
    }
  }

  const isEdit = !!id;
  await UI.guard(
    {
      permission: isEdit
        ? ['edit_pipette', 'manage_pipettes']
        : ['add_pipette', 'manage_pipettes'],
      errorMsg: isEdit ? 'Нет прав на редактирование' : 'Нет прав на добавление'
    },
    async () => {
      const tabsEl = document.getElementById('add-tabs');

      if (tabsEl) tabsEl.style.display = isEdit ? 'none' : 'flex';

      _addTab = 'single';
      switchAddTab('single');

      UI.modal.open('modal');

      if (!id) {
        loadEquipmentTemplates();
      } else {
        const bar = document.getElementById('template-bar');
        if (bar) bar.style.display = 'none';
      }

      if (isEdit) {
        const p = pipettes.find(x => x.id === id);
        if (!p) { showToast('Оборудование не найдено', 'error'); return; }

        document.getElementById('modal-title').innerHTML =
          '<i class="fa-solid fa-pen"></i> Редактировать оборудование';
        document.getElementById('edit-id').value = p.id;

        let lastCal = '';
        if (p.last_calibration) {
          const m = String(p.last_calibration).match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (m) lastCal = `${m[1]}-${m[2]}-${m[3]}`;
        }
        const editData = {
          ...p,
          equipmentType:   p.equipment_type || 'pipette',
          lastCalibration: lastCal,
          result:          p.last_result || 'pass',
          active:          p.active ? 'true' : 'false'
        };
        await generateFormFields(editData);
      } else {
        document.getElementById('modal-title').innerHTML =
          '<i class="fa-solid fa-plus"></i> Добавить оборудование';
        document.getElementById('edit-id').value = '';

        let nextId = '';
try {
  const res = await apiRequest('/pipettes/next-id?type=pipette');
  nextId = res.nextId;
} catch (e) {
  console.warn('Не удалось получить next ID:', e.message);
}
const defaults = {
  id: nextId, // <- ДОБАВИТЬ
  lastCalibration: todayStr(),
  interval: 12,
  result: 'pass',
  active: 'true'
};

        if (currentUser.role === 'admin') {
          // admin — ничего
        } else if (currentUser.isActing && currentUser.actingForName) {
          defaults.responsible = currentUser.actingForName;
          if (currentUser.actingDepartment) defaults.department = currentUser.actingDepartment;
        } else {
          defaults.responsible = currentUser.fullName || '';
          if (currentUser.onlyOwnDepartment && currentUser.department) {
            defaults.department = currentUser.department;
          }
        }

        await generateFormFields(defaults);
      }
    }
  );
}

function closeModal() {
  UI.modal.close('modal');
  document.getElementById('edit-id').value = '';
  document.getElementById('form-fields-container').innerHTML = '';

  const bar = document.getElementById('template-bar');
  if (bar) bar.style.display = 'none';
  const sel = document.getElementById('template-select');
  if (sel) sel.value = '';

  _bulkRows = [];
  _bulkFields = [];
  document.getElementById('bc-rows-body').innerHTML = '';
  document.getElementById('bc-table-head').innerHTML = '';
}

function switchAddTab(tab) {
  _addTab = tab;
  document.querySelectorAll('.add-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('add-tab-single').style.display = tab === 'single' ? '' : 'none';
  document.getElementById('add-tab-batch').style.display  = tab === 'batch'  ? '' : 'none';

  if (tab === 'batch') {
    if (_bulkFields.length === 0) {
      initBulkTable();
    } else if (_bulkRows.length === 0) {
      addBulkRow();
    }
  }
}

async function initBulkTable() {
  const head = document.getElementById('bc-table-head');
  const body = document.getElementById('bc-rows-body');
  if (!head || !body) return;

  head.innerHTML = '<tr><th style="width:40px;">#</th><th>Загрузка…</th></tr>';
  body.innerHTML = '';

  try {
    const allFields = await apiRequest('/settings/fields');
    _bulkFields = getActiveFormFields(allFields)
      .filter(f => f.id !== 'id')
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    if (_bulkFields.length === 0) {
      head.innerHTML = '';
      body.innerHTML = '<tr><td colspan="2" style="color:#dc2626;padding:16px;text-align:center;">Нет активных полей. Обратитесь к администратору.</td></tr>';
      return;
    }

    head.innerHTML = `
      <tr>
        <th style="width:40px;">#</th>
        ${_bulkFields.map(f => `<th>${esc(f.label)}${f.required ? ' *' : ''}</th>`).join('')}
        <th style="width:50px;"></th>
      </tr>
    `;

    _bulkRows = [];
    addBulkRow();
  } catch (e) {
    head.innerHTML = '';
    body.innerHTML = `<tr><td colspan="2" style="color:#dc2626;padding:16px;">Ошибка загрузки полей: ${esc(e.message)}</td></tr>`;
  }
}

function makeDefaultBulkRow() {
  const row = { _id: Math.random().toString(36).slice(2) };
  for (const f of _bulkFields) {
    if (f.id === 'lastCalibration') {
      row[f.id] = todayStr();
    } else if (f.id === 'interval') {
      const t = _equipmentTypes.find(x => x.value === 'pipette');
      row[f.id] = t && t.interval ? t.interval : (f.default || 12);
    } else if (f.id === 'equipmentType') {
      row[f.id] = 'pipette';
    } else if (f.id === 'result') {
      row[f.id] = 'pass';
    } else if (f.id === 'active') {
      row[f.id] = 'true';
    } else if (f.id === 'responsible') {
      if (currentUser.role !== 'admin') {
        if (currentUser.isActing && currentUser.actingForName) row[f.id] = currentUser.actingForName;
        else row[f.id] = currentUser.fullName || '';
      } else {
        row[f.id] = '';
      }
    } else if (f.id === 'department') {
      if (currentUser.role !== 'admin') {
        if (currentUser.isActing && currentUser.actingDepartment) row[f.id] = currentUser.actingDepartment;
        else if (currentUser.onlyOwnDepartment && currentUser.department) row[f.id] = currentUser.department;
        else row[f.id] = '';
      } else {
        row[f.id] = '';
      }
    } else {
      row[f.id] = '';
    }
  }
  return row;
}

function addBulkRow() {
  if (_bulkRows.length >= BULK_MAX_ROWS) {
    showToast(`Максимум ${BULK_MAX_ROWS} строк`, 'error');
    return;
  }
  _bulkRows.push(makeDefaultBulkRow());
  renderBulkRows();
}

function removeBulkRow(idx) {
  if (idx < 0 || idx >= _bulkRows.length) return;
  _bulkRows.splice(idx, 1);
  renderBulkRows();
}

function updateBulkCounters() {
  const cnt = _bulkRows.length;
  const c1 = document.getElementById('bc-rows-count');
  const c2 = document.getElementById('bc-submit-count');
  if (c1) c1.textContent = cnt;
  if (c2) c2.textContent = cnt;

  const empty = document.getElementById('bc-empty');
  const table = document.getElementById('bc-table');
  if (empty) empty.style.display = cnt === 0 ? 'block' : 'none';
  if (table) table.style.display = cnt === 0 ? 'none' : '';
}

function renderBulkRows() {
  const tbody = document.getElementById('bc-rows-body');
  if (!tbody) return;

  if (_bulkRows.length === 0) {
    tbody.innerHTML = '';
    updateBulkCounters();
    return;
  }

  tbody.innerHTML = _bulkRows.map((row, i) => `
    <tr data-row-idx="${i}">
      <td class="bulk-num">${i + 1}</td>
      ${_bulkFields.map(f => `
        <td>${renderBulkCell(f, row[f.id], i)}</td>
      `).join('')}
      <td>
        <button type="button" class="bulk-del-btn" onclick="removeBulkRow(${i})" title="Удалить">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');

  updateBulkCounters();
}

function renderBulkCell(field, value, rowIdx) {
  const fid = `bc-${rowIdx}-${field.id}`;
  const val = value == null ? '' : String(value);

  const handler = field.id === 'equipmentType'
    ? `onBulkTypeChange(${rowIdx}, this.value)`
    : `onBulkChange(${rowIdx}, '${field.id}', this.value)`;

  if (field.type === 'select') {
    const opts = getBulkFieldOptions(field, val);
    return `<select class="bulk-input" id="${fid}" onchange="${handler}">
      ${opts.map(o => `<option value="${esc(o.value)}" ${String(o.value) === val ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  }

  if (field.type === 'date') {
    return `<input type="date" class="bulk-input" id="${fid}" value="${esc(val)}" oninput="${handler}">`;
  }

  if (field.type === 'number') {
    const extra = field.id === 'interval' ? 'min="1" max="120"' : '';
    return `<input type="number" class="bulk-input" id="${fid}" value="${esc(val)}" oninput="${handler}" ${extra}>`;
  }

  return `<input type="text" class="bulk-input" id="${fid}" value="${esc(val)}" oninput="${handler}" placeholder="${esc(field.label)}">`;
}

function getBulkFieldOptions(field, currentValue) {
  let opts = [];

  if (field.id === 'department') {
    let deps = departmentsList;
    if (currentUser.isActing && currentUser.actingDepartment) deps = [currentUser.actingDepartment];
    else if (currentUser.role !== 'admin' && currentUser.onlyOwnDepartment && currentUser.department) {
      deps = [currentUser.department];
    }
    opts = deps.map(d => ({ value: d, label: d }));
    if (!field.required) opts.unshift({ value: '', label: '—' });
  } else if (field.id === 'equipmentType') {
    opts = _equipmentTypes.map(t => ({ value: t.value, label: t.label }));
  } else if (field.id === 'result') {
    opts = [
      { value: 'pass', label: '✅ Годен' },
      { value: 'fail', label: '❌ Брак' },
      { value: 'wip',  label: '⏳ В процессе' },
    ];
  } else if (field.id === 'active') {
    opts = [
      { value: 'true',  label: '✅ В работе' },
      { value: 'false', label: '⛔ Не используется' },
    ];
  } else if (field.id === 'responsible') {
    if (currentUser.role === 'admin') {
      opts = (_responsibles || []).map(u => ({ value: u.fullName, label: u.fullName }));
      if (!field.required) opts.unshift({ value: '', label: '—' });
    } else if (currentUser.isActing && currentUser.actingForName) {
      opts = [{ value: currentUser.actingForName, label: currentUser.actingForName + ' (основной)' }];
    } else {
      const self = currentUser.fullName || '';
      opts = self ? [{ value: self, label: self }] : [{ value: '', label: '—' }];
    }
  } else {
    opts = field.options || [];
    if (!field.required && !opts.some(o => String(o.value) === '')) {
      opts = [{ value: '', label: '—' }, ...opts];
    }
  }

  if (currentValue && !opts.some(o => String(o.value) === currentValue)) {
    opts = [...opts, { value: currentValue, label: `${currentValue} ⚠` }];
  }
  return opts;
}

function onBulkChange(rowIdx, fieldId, value) {
  if (rowIdx < 0 || rowIdx >= _bulkRows.length) return;
  _bulkRows[rowIdx][fieldId] = value;
}

function onBulkTypeChange(rowIdx, newType) {
  if (rowIdx < 0 || rowIdx >= _bulkRows.length) return;
  const row = _bulkRows[rowIdx];
  row.equipmentType = newType;

  const t = _equipmentTypes.find(x => x.value === newType);
  if (t && t.interval) row.interval = t.interval;

  const ivInput = document.getElementById(`bc-${rowIdx}-interval`);
  if (ivInput) ivInput.value = row.interval;
}

async function saveBulkRows(e) {
  if (e) e.preventDefault();
  await refreshCurrentUser();
  if (!canAddPipette()) { showToast('Нет прав', 'error'); return; }

  const errEl = document.getElementById('bc-error');
  errEl.textContent = '';

  if (_bulkRows.length === 0) {
    errEl.textContent = 'Добавьте хотя бы одну строку';
    return;
  }
  if (_bulkRows.length > BULK_MAX_ROWS) {
    errEl.textContent = `Максимум ${BULK_MAX_ROWS} строк`;
    return;
  }

   const bulkFieldIds = new Set(_bulkFields.map(f => f.id));
  const errors = [];

  _bulkRows.forEach((r, i) => {
    const n = i + 1;
    if (bulkFieldIds.has('model') && !String(r.model || '').trim()) errors.push(`Строка ${n}: модель`);
    if (bulkFieldIds.has('lastCalibration') && !String(r.lastCalibration || '').trim()) errors.push(`Строка ${n}: дата`);
    if (bulkFieldIds.has('responsible') && !String(r.responsible || '').trim()) errors.push(`Строка ${n}: ответственный`);

    // Проверяем остальные обязательные поля (если админ поставил им галку "Обязательно")
    const SYSTEM_REQUIRED = new Set(['model', 'lastCalibration', 'responsible']);
    _cachedFields.filter(f => f.required && f.enabled && !SYSTEM_REQUIRED.has(f.id) && bulkFieldIds.has(f.id)).forEach(f => {
      if (!String(r[f.id] || '').trim()) errors.push(`Строка ${n}: ${f.label}`);
    });
  });

  if (errors.length > 0) {
    errEl.textContent = 'Заполните: ' + errors.slice(0, 5).join('; ') +
      (errors.length > 5 ? ` (+${errors.length - 5})` : '');
    return;
  }

  // Автоподстановка для СКРЫТЫХ обязательных полей в партии
  const defaultResp = currentUser.isActing && currentUser.actingForName
    ? currentUser.actingForName
    : currentUser.fullName;

  _bulkRows.forEach(r => {
    if (!bulkFieldIds.has('model')) r.model = 'Не указана';
    if (!bulkFieldIds.has('lastCalibration')) r.lastCalibration = todayStr();
    if (!bulkFieldIds.has('responsible')) r.responsible = defaultResp;
  });

  if (_bulkRows.length >= 20) {
    const ok = await showConfirm(
      `Создать ${_bulkRows.length} единиц одной операцией?`,
      { icon: '📦', title: 'Пакетное создание', okText: 'Создать', okClass: 'btn-primary' }
    );
    if (!ok) return;
  }

    try {
    await UI.saveAction({
      btn: '#bc-submit-btn',
      successMsg: `Создано ${_bulkRows.length} единиц`,
      closeFn: closeModal
    }, () => apiRequest('/pipettes/bulk-create', 'POST', { rows: _bulkRows }));
  } catch (err) {
    errEl.textContent = err.message || 'Ошибка создания';
  }
}

// ============================================================
// СОХРАНЕНИЕ ОДНОЙ ЕДИНИЦЫ (создание или редактирование)
// ============================================================
async function savePipette(e) {
  if (e) e.preventDefault();
  await refreshCurrentUser();

  const editId = document.getElementById('edit-id').value || '';
  const isEdit = !!editId;

  if (!isEdit && !canAddPipette())     { showToast('Нет прав на добавление', 'error'); return; }
  if (isEdit  && !canEditPipette())    { showToast('Нет прав на редактирование', 'error'); return; }

  const payload = {};
  const fieldElements = {};
  const editingPipette = isEdit ? pipettes.find(p => p.id === editId) : null;
  if (isEdit && editingPipette && editingPipette.updated_at) {
    payload.updatedAt = editingPipette.updated_at;
  }

 document.querySelectorAll('#form-fields-container [data-field-id]').forEach(el => {
  const key = el.dataset.fieldId;
  fieldElements[key] = el;
   
  if (key === 'id') {
    payload[key] = el.value;
    return;
  }
  payload[key] = el.value;
});

  const errors = [];
  // Проверяем только те поля, которые видит пользователь
  if (fieldElements.model && !String(payload.model || '').trim()) errors.push('Модель');
  if (fieldElements.lastCalibration && !String(payload.lastCalibration || '').trim()) errors.push('Дата последней поверки');
  if (fieldElements.responsible && !String(payload.responsible || '').trim()) errors.push('Ответственный');

  // Проверяем остальные обязательные поля (если админ поставил им галку "Обязательно")
  const SYSTEM_REQUIRED = new Set(['model', 'lastCalibration', 'responsible']);
  _cachedFields.filter(f => f.required && f.enabled && !SYSTEM_REQUIRED.has(f.id)).forEach(f => {
    if (fieldElements[f.id] && !String(payload[f.id] || '').trim()) errors.push(f.label);
  });
   
  if (!fieldElements.model && (!isEdit || !editingPipette?.model)) {
    payload.model = 'Не указана';
  }
  if (!fieldElements.lastCalibration && (!isEdit || !editingPipette?.last_calibration)) {
    payload.lastCalibration = todayStr();
  }
  if (!fieldElements.responsible && (!isEdit || !editingPipette?.responsible)) {
    payload.responsible = currentUser.isActing && currentUser.actingForName
      ? currentUser.actingForName
      : currentUser.fullName;
  }

  if (errors.length > 0) {
    showToast('Заполните: ' + errors.join(', '), 'error');
    return;
  }

      try {
    await UI.saveAction({
      btn: '#pipette-form button[type="submit"]',
      successMsg: isEdit ? 'Оборудование обновлено' : 'Оборудование создано',
      closeFn: closeModal
    }, async () => {
      if (isEdit) {
        const res = await apiRequest('/pipettes/' + encodeURIComponent(editId), 'PUT', payload);
        if (res.idChanged && res.newId) {
          showToast(`Сохранено. Новый ID: ${res.newId}`, 'success');
        }
      } else {
        const res = await apiRequest('/pipettes', 'POST', payload);
        showToast(`Оборудование создано (${res.id})`, 'success');
      }
    });
  } catch (e) {
      if (e.status === 409 || (e.response && e.response.code === 'conflict')) {
      showToast('Кто-то уже редактирует этот прибор. Пожалуйста, закройте форму и откройте позже.', 'error');
    } else {
      showToast(e.message || 'Ошибка сохранения', 'error');
    }
  }
}
async function deletePipette(id) {
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  const ok = await showConfirm(
    `Удалить оборудование «${id}» вместе со всей историей поверок? Действие необратимо.`,
    { icon: '🗑️', title: 'Удаление', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;
    try {
    await apiRequest(`/pipettes/${id}`, 'DELETE');
    showToast('Оборудование удалено', 'success');
    selectedPipettes.delete(id);
    await loadPipetteData();
  } catch (error) {
    const isBlock = /Нельзя удалить/.test(error.message || '');
    showToast(error.message || 'Ошибка удаления', isBlock ? 'warn' : 'error');
  }
}

// ============================================================
// БЫСТРАЯ ПОВЕРКА
// ============================================================
async function openQuickCalModal(id) {
  await UI.guard(
    { permission: ['quick_calibration', 'manage_pipettes'], errorMsg: 'Доступ запрещён' },
    async () => {
      const p = pipettes.find(x => x.id === id);
      if (!p) { showToast('Оборудование не найдено', 'error'); return; }
      document.getElementById('quick-cal-id').value = id;
      document.getElementById('quick-cal-pipette-info').innerHTML = `<strong>${esc(p.id)}</strong> — ${esc(p.model)} (${esc(p.department || 'без отдела')})`;
      document.getElementById('quick-cal-date').value = todayStr();
      document.getElementById('quick-cal-cert').value = '';
      document.getElementById('quick-cal-result').value = 'pass';
      document.getElementById('quick-cal-org').value = '';
      document.getElementById('quick-cal-note').value = '';
      UI.modal.open('quick-cal-modal');
    }
  );
}

function closeQuickCalModal() {
  UI.modal.close('quick-cal-modal');
}

async function saveQuickCalibration() {
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  const id = document.getElementById('quick-cal-id').value;
  const date = document.getElementById('quick-cal-date').value;
  const cert = document.getElementById('quick-cal-cert').value.trim();
  const result = document.getElementById('quick-cal-result').value;
  const org = document.getElementById('quick-cal-org').value.trim();
  const note = document.getElementById('quick-cal-note').value.trim();

  if (!date) { showToast('Заполните поле «Дата поверки»', 'error'); return; }
  if (date > todayStr()) { showToast('Дата не может быть в будущем', 'error'); return; }

  try {
    await apiRequest(`/pipettes/${id}/calibration`, 'POST', { date, cert, result, org, note });
    showToast('Поверка зарегистрирована', 'success');
    closeQuickCalModal();
    await loadPipetteData();
    } catch (error) {
    showToast(error.message || 'Ошибка сохранения', 'error');
  }
}

// ============================================================
// ОТМЕНА ОТПРАВКИ
// ============================================================
async function cancelSend(id) {
  await refreshCurrentUser();
  if (!canBulkSend() && !canManagePipettes()) {
    showToast('Нет прав на отмену отправки', 'error');
    return;
  }

  const p = pipettes.find(x => x.id === id);
  if (!p) return;

  const hasReplacement = !!p.replaced_by;
  const confirmMsg = hasReplacement
    ? `Отменить отправку «${id}» на поверку?\n\n` +
      `Замена «${p.replaced_by}» вернётся на склад и станет неактивной.`
    : `Отменить отправку «${id}» на поверку?`;

  const ok = await showConfirm(
    confirmMsg,
    { icon: '↩️', title: 'Отмена отправки', okText: 'Отменить', okClass: 'btn-warning' }
  );
  if (!ok) return;

  try {
    await apiRequest(`/pipettes/${encodeURIComponent(id)}/cancel-send`, 'POST', {});
    showToast('Отправка отменена', 'success');
    await loadPipetteData();
  } catch (e) {
    showToast(e.message || 'Ошибка отмены', 'error');
  }
}

// ============================================================
// ХЕЛПЕР: заполнение <select> опциями
// ============================================================
function fillSelectOptions(selectEl, field, currentVal) {
  let opts = [];

  if (field.id === 'department') {
    let deps = departmentsList;
    if (currentUser.isActing && currentUser.actingDepartment) deps = [currentUser.actingDepartment];
    else if (currentUser.role !== 'admin' && currentUser.onlyOwnDepartment && currentUser.department) {
      deps = [currentUser.department];
    }
    opts = deps.length ? deps.map(d => ({ value: d, label: d })) : (field.options || []);
  } else if (field.id === 'equipmentType') {
    opts = _equipmentTypes.length > 0
      ? _equipmentTypes.map(t => ({ value: t.value, label: t.label }))
      : [{ value: 'pipette', label: 'Пипетка' }];
  } else if (field.id === 'result') {
    opts = [
      { value: 'pass', label: '✅ Годен' },
      { value: 'fail', label: '❌ Брак' },
      { value: 'wip',  label: '⏳ В процессе' }
    ];
  } else if (field.id === 'active') {
    opts = [
      { value: 'true',  label: '✅ В работе' },
      { value: 'false', label: '⛔ Не используется' }
    ];
  } else if (field.id === 'responsible') {
    if (currentUser.role === 'admin') {
      opts = _responsibles.map(u => ({ value: u.fullName, label: u.fullName }));
      if (!field.required) opts.unshift({ value: '', label: '— не указан —' });
    } else if (currentUser.isActing && currentUser.actingForName) {
      opts = [{ value: currentUser.actingForName, label: currentUser.actingForName + ' (основной)' }];
    } else {
      const self = currentUser.fullName || '';
      opts = self ? [{ value: self, label: self }] : [{ value: '', label: '— не указан —' }];
    }
  } else {
    opts = field.options || [];
    if (!field.required && !opts.some(o => String(typeof o === 'object' ? o.value : o) === '')) {
      opts = [{ value: '', label: '— не указан —' }, ...opts];
    }
  }

  const valStr = currentVal == null ? '' : String(currentVal);
  if (valStr && !opts.some(o => String(typeof o === 'object' ? o.value : o) === valStr)) {
    opts = [...opts, { value: valStr, label: `${valStr}  ⚠ (нет в списке)` }];
  }
  if (opts.length === 0) opts = [{ value: '', label: '—' }];

  opts.forEach(opt => {
    const v = (typeof opt === 'object') ? opt.value : opt;
    const l = (typeof opt === 'object') ? opt.label : (opt || '—');
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    if (String(currentVal) === String(v)) o.selected = true;
    selectEl.appendChild(o);
  });
}

// ============================================================
// ОБЁРТКА generateFormFields — поле «Штрихкод» с кнопками
// ============================================================
(function wrapGenerateFormFieldsForBarcode() {
  if (typeof window.generateFormFields !== 'function') return;
  const orig = window.generateFormFields;
  window.generateFormFields = async function(data) {
    const result = await orig.apply(this, arguments);

    const barcodeInput = document.querySelector('[data-field-id="barcode"]');
    if (!barcodeInput) return result;
    if (barcodeInput.parentElement?.dataset.barcodeWrapped === '1') return result;

    const wrap = document.createElement('div');
    wrap.dataset.barcodeWrapped = '1';
    wrap.style.display = 'flex';
    wrap.style.gap = '6px';

    barcodeInput.parentNode.insertBefore(wrap, barcodeInput);
    wrap.appendChild(barcodeInput);

    if (!canManageBarcodes()) {
      barcodeInput.readOnly = true;
      barcodeInput.style.background = '#f1f5f9';
      barcodeInput.style.cursor = 'not-allowed';
      barcodeInput.title = 'Меняется администратором. Авто из инв. номера.';
      return result;
    }

    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'btn btn-secondary';
    genBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
    genBtn.title = 'Заполнить из инв. / серийного / ID';
    genBtn.style.flexShrink = '0';
    genBtn.onclick = () => {
      const invInput    = document.querySelector('[data-field-id="inventorynumber"]');
      const serialInput = document.querySelector('[data-field-id="serial"]');
      const idInput     = document.querySelector('[data-field-id="id"]');
      let value = '';
      if (invInput && invInput.value.trim())            value = invInput.value.trim();
      else if (serialInput && serialInput.value.trim()) value = serialInput.value.trim();
      else if (idInput && idInput.value.trim())         value = idInput.value.trim();
      else if (data && data.id)                         value = data.id;
      if (!value) { showToast('Заполните инв. номер, серийный или ID', 'error'); return; }
      barcodeInput.value = value;
      barcodeInput.dataset.manual = '1';
    };
    wrap.appendChild(genBtn);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn btn-warning';
    resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
    resetBtn.title = 'Сбросить ручной штрихкод — вернуть к авто';
    resetBtn.style.flexShrink = '0';
    resetBtn.onclick = async () => {
      if (!data || !data.id) {
        barcodeInput.value = '';
        barcodeInput.dataset.manual = '0';
        return;
      }
      const ok = await showConfirm(
        'Сбросить ручной штрихкод и пересчитать из источника?',
        { icon: '↩️', title: 'Сброс штрихкода', okText: 'Сбросить', okClass: 'btn-warning' }
      );
      if (!ok) return;
      try {
        await apiRequest('/barcodes/reset', 'POST', { id: data.id });
        showToast('Штрихкод сброшен. Будет пересчитан при сохранении.', 'success');
        barcodeInput.value = '';
        barcodeInput.dataset.manual = '0';
      } catch (e) {
        showToast(e.message || 'Ошибка сброса', 'error');
      }
    };
    wrap.appendChild(resetBtn);

    barcodeInput.addEventListener('input', () => {
      barcodeInput.dataset.manual = '1';
    });

    return result;
  };
})();
