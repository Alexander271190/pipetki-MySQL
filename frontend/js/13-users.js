'use strict';

// ============================================================
// 🆕 ПОЛЬЗОВАТЕЛИ — новая форма с правами
// ============================================================
async function renderUsersSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    const users = await getCachedUsers(true);
    
       let html = '<h3>Управление пользователями</h3>';
    html += `
      <div style="margin-bottom:12px; position:relative;">
        <input type="text" id="users-search" 
               placeholder="Поиск по логину, ФИО, должности, отделу…"
               oninput="filterUsersTable(this.value)"
               style="width:100%; padding:9px 12px 9px 36px; border:1px solid var(--border-hard); border-radius:8px; font-size:.9rem; box-sizing:border-box;">
        <i class="fa-solid fa-magnifying-glass" 
           style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-faint); font-size:.85rem; pointer-events:none;"></i>
      </div>
    `;
    html += `<table class="field-settings-table users-table-fix" style="margin-bottom:20px;" id="users-table">
  <colgroup>
    <col style="width:14%;">
    <col style="width:20%;">
    <col style="width:16%;">
    <col style="width:14%;">
    <col style="width:12%;">
    <col style="width:8%;">
    <col style="width:1%;">
  </colgroup>
  <thead><tr>
    <th>Логин</th><th>ФИО</th><th>Должность</th><th>Отдел</th><th>Роль</th><th>Права</th><th>Действия</th>
  </tr></thead><tbody>`;

    users.forEach(u => {
      const perms = u.extraPermissions || [];
      const isAdm = u.role === 'admin';
      const permText = isAdm
        ? `<span style="color:${COLORS.danger};font-weight:700;">все</span>`
        : (perms.length === 0
          ? `<span style="color:${COLORS.faint};">нет</span>`
          : String(perms.length));

      html += `<tr>
        <td>${esc(u.login)}</td>
        <td>${esc(u.fullName)}</td>
        <td>${esc(u.position)}${u.isActing
          ? ` <span style="color:${COLORS.warning};font-weight:600;">(и.о.${u.actingForName ? ' за ' + esc(u.actingForName) : ''})</span>`
          : ''}</td>
        <td>${esc(u.department || '—')}</td>
        <td>${ROLE_LABELS[u.role] || u.role}</td>
        <td class="perm-cell">${permText}</td>
                <td class="actions">
          <button class="row-actions-btn"
                  onclick="openUserActions(event, '${u.id}')"
                  title="Действия">
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
        </td>
      </tr>`;
    });
    html += `</tbody></table>`;
    html += renderUserEditForm();
    c.innerHTML = html;
  } catch (e) {
    c.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + e.message + '</p>';
  }
}

// ============================================================
// 🆕 Поиск в таблице пользователей (клиентский, без запросов)
// ============================================================
let _usersSearchTimer = null;

function filterUsersTable(query) {
  clearTimeout(_usersSearchTimer);
  _usersSearchTimer = setTimeout(() => {
    const table = document.getElementById('users-table');
    if (!table) return;

    const q = String(query || '').trim().toLowerCase();
    const rows = table.querySelectorAll('tbody tr');

    let visibleCount = 0;
    for (const row of rows) {
      // Если строка — это «пустое состояние» (colspan), не трогаем
      if (row.querySelector('[colspan]') && !row.querySelector('td:not([colspan])')) continue;

      if (!q) {
        row.style.display = '';
        visibleCount++;
        continue;
      }

      const text = row.textContent.toLowerCase();
      if (text.includes(q)) {
        row.style.display = '';
        visibleCount++;
      } else {
        row.style.display = 'none';
      }
    }

    // Показать/скрыть сообщение «не найдено»
    let emptyMsg = document.getElementById('users-search-empty');
    if (visibleCount === 0 && q) {
      if (!emptyMsg) {
        emptyMsg = document.createElement('tr');
        emptyMsg.id = 'users-search-empty';
        emptyMsg.innerHTML = `<td colspan="7" style="text-align:center; padding:20px; color:var(--text-faint);">
          Никого не найдено по запросу «${esc(query)}»
        </td>`;
        table.querySelector('tbody').appendChild(emptyMsg);
      } else {
        emptyMsg.querySelector('td').innerHTML = `Никого не найдено по запросу «${esc(query)}»`;
        emptyMsg.style.display = '';
      }
    } else if (emptyMsg) {
      emptyMsg.style.display = 'none';
    }
  }, 250);
}

function renderUserEditForm() {
  const groups = {};
  for (const p of ALL_PERMISSIONS) {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  }

  let permsHtml = '';
  for (const [group, items] of Object.entries(groups)) {
    permsHtml += `
      <div style="margin-bottom:14px;">
        <div style="font-weight:700;font-size:.82rem;color:#475569;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;">
          ${esc(group)}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(240px, 1fr));gap:6px 16px;">
          ${items.map(p => `
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:5px 8px;border-radius:6px;font-size:.85rem;line-height:1.3;">
              <input type="checkbox" class="usr-perm-cb" value="${esc(p.key)}" style="margin-top:2px;">
              <span>${p.label}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }

  return `
    <div class="settings-form" id="user-edit-form">
      <h4 id="user-form-title"><i class="fa-solid fa-plus"></i> Добавить пользователя</h4>
      <input type="hidden" id="usr-edit-id">

      <div class="form-row">
        <div class="form-group"><label>Логин *</label><input id="usr-login"></div>
        <div class="form-group"><label>ФИО *</label><input id="usr-fullname"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Должность *</label><input id="usr-position"></div>
        <div class="form-group"><label>Отдел</label>
          <select id="usr-department">
            <option value="">— не указан —</option>
            ${departmentsList.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Роль</label>
          <select id="usr-role" onchange="onUserRoleChange(this.value)">
            <option value="user">Пользователь</option>
            <option value="senior_lab">Старший лаборант</option>
            <option value="admin">Администратор</option>
          </select>
        </div>
        <div class="form-group"><label>Строк на странице</label>
          <select id="usr-page-size" style="padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;">
            <option value="50">50</option>
            <option value="100" selected>100</option>
            <option value="200">200</option>
            <option value="500">500</option>
          </select>
        </div>
      </div>
      <small style="color:#64748b;display:block;margin-bottom:12px;font-size:.8rem;">
        Пароль генерируется автоматически. Пользователь обязан сменить его при первом входе.
      </small>

      ${UI.infoBlock(`
        <div style="font-weight:700;font-size:.95rem;margin-bottom:6px;">
          <i class="fa-solid fa-key"></i> Права доступа
        </div>
        <small style="display:block;margin-bottom:10px;font-size:.8rem;">
          Отмеченные права определяют, <strong>какие кнопки и действия доступны пользователю</strong>.
          Если право не выдано — элемент скрыт. По умолчанию все права выключены.
          Для роли «Администратор» все права выдаются автоматически.
        </small>

        <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyPermPreset('none')">
               <i class="fa-solid fa-eraser"></i> Очистить
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyPermPreset('user')">
                <i class="fa-solid fa-user"></i> Пользователь
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyPermPreset('senior')">
                <i class="fa-solid fa-flask"></i> Ст. лаборант
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyPermPreset('manager')">
                <i class="fa-solid fa-chart-line"></i> Менеджер
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyPermPreset('all')">
                <i class="fa-solid fa-star"></i> Все права
          </button>
        </div>

        <div id="usr-permissions">${permsHtml}</div>
      `)}

      ${UI.warningBlock(`
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;">
          <input type="checkbox" id="usr-only-own-dept" style="width:18px;height:18px;">
          <i class="fa-solid fa-eye-slash"></i>
          Показывать только свой отдел
        </label>
        <small style="display:block;margin-top:6px;margin-left:26px;font-size:.78rem;">
          Если включено — пользователь увидит только пипетки своего отдела. Отдел должен быть указан выше.
        </small>
      `)}

      ${UI.infoBlock(`
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;">
          <input type="checkbox" id="usr-is-acting" style="width:18px;height:18px;" onchange="onActingChange(this.checked)">
          <i class="fa-solid fa-user-clock"></i>
          Исполняющий обязанности (и.о.)
        </label>
        <small style="display:block;margin-top:6px;margin-left:26px;font-size:.78rem;">
          И.о. видит оборудование отдела основного и работает под его ФИО.
        </small>
        <div id="usr-acting-for-wrap" style="display:none;margin-top:10px;">
          <label style="font-size:.85rem;font-weight:600;margin-bottom:4px;display:block;">За кого исполняет *</label>
          <select id="usr-acting-for" style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:8px;">
            <option value="">— выберите —</option>
          </select>
        </div>
      `)}

      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
        <button class="btn btn-secondary" onclick="resetUserSettingForm()">
          <i class="fa-solid fa-rotate-left"></i> Очистить форму
        </button>
        <button class="btn btn-success" onclick="saveUserSetting()">
          <i class="fa-solid fa-floppy-disk"></i> Сохранить
        </button>
      </div>
    </div>
  `;
}

function applyPermPreset(preset) {
  const presets = {
    none: [],
    user: ['view_history', 'print_labels', 'export_data'],
     senior: [
      'add_pipette', 'edit_pipette', 'quick_calibration', 'transfer_pipette',
      'bulk_change_responsible',
      'bulk_send', 'bulk_return',
      'export_data', 'scan_barcode', 'print_labels',
      'view_history',
    ],
    manager: [
      'add_pipette', 'edit_pipette', 'delete_pipette', 'quick_calibration',
      'bulk_send', 'bulk_return',
      'import_data', 'export_data',
      'scan_barcode', 'print_labels', 'manage_barcodes',
      'manage_users', 'view_log',
      'view_history',
    ],
    all: ALL_PERMISSIONS.map(p => p.key),
  };
  const selected = presets[preset] || [];
  document.querySelectorAll('.usr-perm-cb').forEach(cb => {
    cb.checked = selected.includes(cb.value);
  });
}

function onUserRoleChange(role) {
  const isAdminRole = (role === 'admin');
  document.querySelectorAll('.usr-perm-cb').forEach(cb => {
    if (isAdminRole) {
      cb.checked = true;
      cb.disabled = true;
    } else {
      if (cb.disabled) cb.checked = false;
      cb.disabled = false;
    }
  });
}

async function onActingChange(checked) {
  const wrap = document.getElementById('usr-acting-for-wrap');
  const sel  = document.getElementById('usr-acting-for');
  if (!wrap || !sel) return;
  wrap.style.display = checked ? 'block' : 'none';
  if (!checked) { sel.value = ''; return; }
  if (sel.dataset.loaded !== '1') {
    try {
      const users = await apiRequest('/users/acting-targets');
      sel.innerHTML = '<option value="">— выберите —</option>' +
        users.map(u => `<option value="${esc(u.id)}">${esc(u.fullName)} — ${esc(u.department || 'без отдела')}</option>`).join('');
      sel.dataset.loaded = '1';
    } catch (e) {
      showToast('Не удалось загрузить список для и.о.', 'error');
    }
  }
}

async function editUserSetting(id) {
  try {
    const users = await apiRequest('/users');
    const u = users.find(x => x.id === id);
    if (!u) return;

    document.getElementById('usr-edit-id').value = u.id;
    document.getElementById('usr-login').value = u.login;
    document.getElementById('usr-fullname').value = u.fullName;
    document.getElementById('usr-position').value = u.position;

    const deptSel = document.getElementById('usr-department');
    Array.from(deptSel.options).forEach(o => { if (o.dataset.broken === '1') o.remove(); });
    deptSel.value = u.department || '';
    if (u.department && deptSel.value !== u.department) {
      const opt = document.createElement('option');
      opt.value = u.department;
      opt.textContent = u.department + '  ⚠ (нет в списке)';
      opt.style.color = '#dc2626';
      opt.dataset.broken = '1';
      deptSel.appendChild(opt);
      deptSel.value = u.department;
      showToast(`Отдел «${u.department}» отсутствует в справочнике`, 'error');
    }

    document.getElementById('usr-role').value = u.role;
    document.getElementById('user-form-title').innerHTML = '<i class="fa-solid fa-pen"></i> Редактирование: ' + esc(u.login);

    let perms = [...(u.extraPermissions || [])];
    if (perms.includes('manage_pipettes')) {
      perms = perms.filter(p => p !== 'manage_pipettes');
      perms.push('add_pipette', 'edit_pipette', 'delete_pipette', 'quick_calibration', 'bulk_send', 'bulk_return');
      perms = [...new Set(perms)];
    }
    document.querySelectorAll('.usr-perm-cb').forEach(cb => {
      cb.checked = perms.includes(cb.value);
      cb.disabled = (u.role === 'admin');
    });

    document.getElementById('usr-only-own-dept').checked = !!u.onlyOwnDepartment;

    const isActingCb = document.getElementById('usr-is-acting');
    isActingCb.checked = !!u.isActing;
    await onActingChange(isActingCb.checked);
    const sel = document.getElementById('usr-acting-for');
    if (sel) sel.value = u.actingForId || '';

    let prefs = {};
    try { prefs = await apiRequest(`/settings/user-preferences/${u.id}`); } catch (e) {}
    const psEl = document.getElementById('usr-page-size');
    if (psEl) psEl.value = String(prefs.defaultPageSize || 100);

    document.getElementById('user-form-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { showToast(e.message, 'error'); }
}

async function saveUserSetting() {
  const id = document.getElementById('usr-edit-id').value;
  const login = document.getElementById('usr-login').value.trim();
  const fullName = document.getElementById('usr-fullname').value.trim();
  const position = document.getElementById('usr-position').value.trim();
  const department = document.getElementById('usr-department').value.trim();
  const role = document.getElementById('usr-role').value;

  const missing = [];
  if (!login) missing.push('Логин');
  if (!fullName) missing.push('ФИО');
  if (!position) missing.push('Должность');
  if (missing.length > 0) {
    const msg = missing.length === 1
      ? `Заполните поле «${missing[0]}»`
      : `Заполните поля: ${missing.map(m => `«${m}»`).join(', ')}`;
    showToast(msg, 'error');
    return;
  }

  const onlyOwnDepartment = document.getElementById('usr-only-own-dept').checked;
  const isActing = document.getElementById('usr-is-acting').checked;
  const actingForId = isActing ? document.getElementById('usr-acting-for').value.trim() : null;

  if (isActing && !actingForId) { showToast('Для и.о. нужно указать, за кого он исполняет', 'error'); return; }

  const extraPermissions = [];
  if (role !== 'admin') {
    document.querySelectorAll('.usr-perm-cb:checked').forEach(cb => extraPermissions.push(cb.value));
  }

  const payload = { login, fullName, position, department, role, onlyOwnDepartment, extraPermissions, isActing, actingForId };

  let userId = id;
  try {
    await UI.saveAction({
      successMsg: id ? 'Пользователь обновлён' : 'Пользователь создан',
      reload: false
    }, async () => {
      if (id) {
        await apiRequest('/users/' + id, 'PUT', payload);
      } else {
        const res = await apiRequest('/users', 'POST', payload);
        userId = res.id;
        setTimeout(() => showTempPasswordModal(res.login, fullName, res.tempPassword), 300);
      }
    });

    if (userId) {
      let existing = {};
      try { existing = await apiRequest(`/settings/user-preferences/${userId}`); } catch (e) {}
      const psEl = document.getElementById('usr-page-size');
      const merged = { ...existing, defaultPageSize: parseInt(psEl ? psEl.value : '100', 10) || 100 };
      try { await apiRequest(`/settings/user-preferences/${userId}`, 'PUT', merged); } catch (e) {}
    }

    if (id === currentUser.id) {
      const me = (await apiRequest('/users')).find(x => x.id === id);
      if (me) {
        currentUser.fullName = me.fullName;
        currentUser.position = me.position;
        currentUser.department = me.department;
        currentUser.role = me.role;
        currentUser.onlyOwnDepartment = !!me.onlyOwnDepartment;
        currentUser.extraPermissions = me.extraPermissions || [];
        const origUser = getOriginalUser();
        const origToken = getOriginalToken();
        if (origUser && origToken) setSession(currentUser, authToken, origUser, origToken);
        else setSession(currentUser, authToken);
        renderAuthUI();
      }
    }

    invalidateUsersCache();
    resetUserSettingForm();
    renderUsersSettings();
  } catch (e) {}
}

function resetUserSettingForm() {
  ['usr-edit-id', 'usr-login', 'usr-fullname', 'usr-position'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const deptSel = document.getElementById('usr-department');
  if (deptSel) {
    Array.from(deptSel.options).forEach(o => { if (o.dataset.broken === '1') o.remove(); });
    deptSel.value = '';
  }
  const roleSel = document.getElementById('usr-role');
  if (roleSel) roleSel.value = 'user';
  const titleEl = document.getElementById('user-form-title');
  if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-plus"></i> Добавить пользователя';
  const onlyOwnCb = document.getElementById('usr-only-own-dept');
  if (onlyOwnCb) onlyOwnCb.checked = false;
  const isActingCb = document.getElementById('usr-is-acting');
  if (isActingCb) { isActingCb.checked = false; onActingChange(false); }
  document.querySelectorAll('.usr-perm-cb').forEach(cb => { cb.checked = false; cb.disabled = false; });
  const psEl = document.getElementById('usr-page-size');
  if (psEl) psEl.value = '100';
}

async function deleteUserSetting(id, displayName) {
  let who = displayName;
  if (!who) {
    try {
      const users = await apiRequest('/users');
      const u = users.find(x => x.id === id);
      if (u) who = u.fullName || u.login;
    } catch (e) {}
  }
  if (!who) who = id;

  const ok = await showConfirm(
    `Удалить пользователя «${who}»?\nДействие необратимо.`,
    { icon: '👤', title: 'Удаление пользователя', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;
    try {
    await apiRequest('/users/' + id, 'DELETE');
    invalidateUsersCache();
    showToast('Удалён', 'success');
    renderUsersSettings();
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// МОДАЛКА «Поля формы пользователя»
// ============================================================
let _userViewUserId = null;
let _userViewVisibleFields = [];

async function openUserViewModal(userId, userName) {
  if (!isAdmin()) return;
  _userViewUserId = userId;
  _userViewVisibleFields = [];

  document.getElementById('user-view-target').innerHTML =
    `Настройка полей формы для: <strong>${esc(userName || userId)}</strong>`;

  let prefs = {};
  try {
    prefs = await apiRequest(`/settings/user-preferences/${userId}`);
    if (prefs.visibleFields && Array.isArray(prefs.visibleFields)) {
      _userViewVisibleFields = [...prefs.visibleFields];
    }
  } catch (e) {}

  try {
    _cachedFields = await apiRequest('/settings/fields');
  } catch (e) {
    _cachedFields = _cachedFields || [];
    showToast('Ошибка загрузки полей: ' + e.message, 'error');
  }

  const VIRTUAL_IDS = ['status', 'nextCalibration'];

  const allEnabled = _cachedFields.filter(f => f.enabled).map(f => f.id);
  const allAvailable = [...allEnabled, ...VIRTUAL_IDS];

  if (_userViewVisibleFields.length === 0) {
    _userViewVisibleFields = [...allAvailable];
  } else {
    const validSet = new Set(allAvailable);
    _userViewVisibleFields = _userViewVisibleFields.filter(id => validSet.has(id));

    const targetHasVirtualsInit = !!(prefs && prefs._virtualsInitialized);
    if (!targetHasVirtualsInit) {
      for (const vid of VIRTUAL_IDS) {
        if (!_userViewVisibleFields.includes(vid)) {
          _userViewVisibleFields.push(vid);
        }
      }
    }
  }

  renderUserViewContent();
  UI.modal.open('user-view-modal');

  loadCopyViewUserList(userId);
}

function closeUserViewModal() {
  UI.modal.close('user-view-modal');
  _userViewUserId = null;
  _userViewVisibleFields = [];
}

function renderUserViewContent() {
  const c = document.getElementById('user-view-content');
  if (!c) return;

  const allFields = _cachedFields
    .filter(f => f.enabled)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const VIRTUAL_TABLE_COLUMNS = [
    { id: 'nextCalibration', label: 'Следующая поверка', hint: 'Считается из «Дата поверки» + МПИ' },
    { id: 'status',          label: 'Статус',            hint: 'Считается из даты, МПИ, результата, активности' },
  ];

  const visibleSet = new Set(_userViewVisibleFields);

  let html = '<div class="prefs-list">';

  if (allFields.length > 0) {
    html += allFields.map(f => `
      <label class="prefs-item">
        <input type="checkbox" ${visibleSet.has(f.id) ? 'checked' : ''} onchange="toggleUserViewField('${f.id}', this.checked)">
        <span class="prefs-label">${esc(f.label)}</span>
      </label>
    `).join('');
  }

  html += '</div>';

  html += `
    <div style="margin-top:14px;padding-top:12px;border-top:1px dashed #e2e8f0;">
      <div style="font-weight:600;font-size:.82rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">
        Виртуальные колонки
      </div>
      <div class="prefs-list">
        ${VIRTUAL_TABLE_COLUMNS.map(v => `
          <label class="prefs-item" title="${esc(v.hint)}">
            <input type="checkbox" ${visibleSet.has(v.id) ? 'checked' : ''} onchange="toggleUserViewField('${v.id}', this.checked)">
            <span class="prefs-label">${esc(v.label)} <small style="color:#94a3b8;font-weight:400;">— ${esc(v.hint)}</small></span>
          </label>
        `).join('')}
      </div>
    </div>
  `;

  html += `
    <div class="prefs-hint">
      <i class="fa-solid fa-circle-info"></i>
      Отключённые поля не будут видны этому пользователю в форме добавления и редактирования.
      Виртуальные колонки влияют только на таблицу.
    </div>

    <div style="margin-top:16px;padding-top:14px;border-top:1px solid #e2e8f0;">
      <div style="font-weight:600;font-size:.85rem;color:#475569;margin-bottom:8px;">
        Применить ко всем пользователям:
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="applyFieldsToAll('missing')" title="Тем, у кого нет своих настроек">
          <i class="fa-solid fa-users"></i> Тем, у кого нет настроек
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="applyFieldsToAll('add')" title="Добавить отмеченные поля всем, не трогая остальные">
          <i class="fa-solid fa-plus"></i> Добавить отмеченные всем
        </button>
      </div>
      <small style="color:#94a3b8;display:block;margin-top:8px;font-size:.78rem;">
        «Тем, у кого нет настроек» — включит выбранные поля только новым/ненастроенным пользователям.<br>
        «Добавить отмеченные всем» — добавит отмеченные галочками поля ко всем, сохранив их текущий набор.
      </small>
    </div>
  `;

  c.innerHTML = html;
}

async function loadCopyViewUserList(excludeUserId) {
  const sel = document.getElementById('copy-view-user-select');
  if (!sel) return;

  sel.innerHTML = '<option value="">— загрузка —</option>';

  try {
    const users = await apiRequest('/users');
    const others = users.filter(u => u.id !== excludeUserId);

    if (others.length === 0) {
      sel.innerHTML = '<option value="">— нет других пользователей —</option>';
      return;
    }

    others.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'ru'));

    sel.innerHTML = '<option value="">— выберите пользователя —</option>' +
      others.map(u => `<option value="${esc(u.id)}">${esc(u.fullName)} — ${esc(u.position || '')}</option>`).join('');
  } catch (e) {
    sel.innerHTML = '<option value="">— ошибка загрузки —</option>';
    console.error('loadCopyViewUserList:', e);
  }
}

async function copyViewFromUser() {
  const sel = document.getElementById('copy-view-user-select');
  if (!sel) return;

  const sourceId = sel.value;
  if (!sourceId) {
    showToast('Выберите пользователя', 'error');
    return;
  }

  try {
    showToast('Загрузка вида…', 'success');

    const res = await apiRequest(`/settings/user-preferences/${sourceId}/effective`);

    if (!res.visibleFields || res.visibleFields.length === 0) {
      showToast('У выбранного пользователя нет активных полей', 'error');
      return;
    }

    const activeFieldIds = new Set(
      _cachedFields.filter(f => f.enabled).map(f => f.id)
    );
    const VIRTUAL_IDS = new Set(['status', 'nextCalibration']);

    const filtered = res.visibleFields.filter(id =>
      activeFieldIds.has(id) || VIRTUAL_IDS.has(id)
    );

    if (filtered.length === 0) {
      showToast('Все поля недоступны', 'error');
      return;
    }

    _userViewVisibleFields = [...filtered];
    renderUserViewContent();

    const skipped = res.visibleFields.length - filtered.length;
    let msg = `Скопировано полей: ${filtered.length}`;
    if (skipped > 0) msg += ` (пропущено недоступных: ${skipped})`;
    msg += '. Нажмите «Сохранить».';

    showToast(msg, 'success');
  } catch (e) {
    console.error('copyViewFromUser:', e);
    showToast('Ошибка загрузки вида: ' + (e.message || ''), 'error');
  }
}

async function applyFieldsToAll(mode) {
  const VIRTUAL_IDS = new Set(['status', 'nextCalibration']);

  const selected = _userViewVisibleFields.filter(id => {
    if (VIRTUAL_IDS.has(id)) return true;
    const f = _cachedFields.find(x => x.id === id);
    return f && f.enabled;
  });
  
  if (selected.length === 0) {
    showToast('Выберите хотя бы одно поле', 'error');
    return;
  }

  const modeLabel = mode === 'missing'
    ? 'только тем пользователям, у кого ещё нет своих настроек'
    : 'ВСЕМ пользователям (добавить отмеченные поля, остальные сохранить)';

  const ok = await showConfirm(
    `Применить ${selected.length} полей ${modeLabel}?\n\n` +
    `Действие затронет всех пользователей.`,
    { icon: '⚠️', title: 'Массовое применение', okText: 'Применить', okClass: 'btn-warning' }
  );
  if (!ok) return;

  try {
    const res = await apiRequest('/settings/apply-fields-to-all', 'POST', {
      visibleFields: selected,
      mode,
    });
    showToast(res.message || `Обновлено: ${res.updated}`, 'success');
    closeUserViewModal();
  } catch (e) {
    showToast(e.message || 'Ошибка применения', 'error');
  }
}

function toggleUserViewField(id, checked) {
  if (checked) {
    if (!_userViewVisibleFields.includes(id)) _userViewVisibleFields.push(id);
  } else {
    _userViewVisibleFields = _userViewVisibleFields.filter(x => x !== id);
  }
}

async function saveUserView() {
  if (!_userViewUserId) return;
  if (_userViewVisibleFields.length === 0) {
    showToast('Выберите хотя бы одно поле', 'error');
    return;
  }

  const savedUserId = _userViewUserId;
  const savedFields = [..._userViewVisibleFields];

  let existing = {};
  try { existing = await apiRequest(`/settings/user-preferences/${savedUserId}`); } catch (e) {}

  const merged = {
    ...existing,
    visibleFields: savedFields,
    _virtualsInitialized: true,
  };

  try {
    await apiRequest(`/settings/user-preferences/${savedUserId}`, 'PUT', merged);
    showToast('Поля формы сохранены', 'success');
    closeUserViewModal();

    if (savedUserId === currentUser.id) {
      myPrefs.visibleFields = [...savedFields];
      myPrefs._loaded = true;
      myPrefs._virtualsInitialized = true;
      render();
    }
  } catch (e) {
    showToast(e.message || 'Ошибка сохранения', 'error');
  }
}

async function resetUserView() {
  if (!_userViewUserId) return;
  const ok = await showConfirm(
    'Сбросить настройки полей формы к стандартным (показывать все включённые)?',
    { icon: '↩️', title: 'Сброс', okText: 'Сбросить', okClass: 'btn-warning' }
  );
  if (!ok) return;
  try {
    await apiRequest(`/settings/user-preferences/${_userViewUserId}`, 'DELETE');
    showToast('Сброшено. Пользователь увидит все включённые поля.', 'success');
    closeUserViewModal();
  } catch (e) {
    showToast(e.message || 'Ошибка сброса', 'error');
  }
}

// ============================================================
// СМЕНА ПАРОЛЯ (своя + чужая)
// ============================================================
function openChangePasswordModal(force, mode = 'change') {
  const modal = document.getElementById('change-password-modal');
  const notice = document.getElementById('change-password-notice');
  const errEl = document.getElementById('cp-error');
  const currentInput = document.getElementById('cp-current');
  const newInput = document.getElementById('cp-new');
  const confirmInput = document.getElementById('cp-confirm');
  const cancelBtn = document.getElementById('cp-cancel-btn');

  if (errEl) errEl.textContent = '';
  if (currentInput) currentInput.value = '';
  if (newInput) newInput.value = '';
  if (confirmInput) confirmInput.value = '';
  const unameField = document.getElementById('cp-username');
  if (unameField) unameField.value = (currentUser && (currentUser.login || currentUser.fullName)) || '';

  const isSetup = mode === 'setup';
  const currentGroup = currentInput ? currentInput.closest('.form-group') : null;
  if (currentGroup) currentGroup.style.display = isSetup ? 'none' : '';

  const titleEl = modal ? modal.querySelector('h2') : null;
  if (titleEl) {
    titleEl.innerHTML = isSetup
      ? '<i class="fa-solid fa-key"></i> Установка пароля администратора'
      : '<i class="fa-solid fa-lock"></i> Смена пароля';
  }
  if (notice) {
    notice.style.display = force ? 'block' : 'none';
    notice.innerHTML = isSetup
      ? 'Это первый вход в систему. Задайте пароль администратора, соответствующий требованиям ниже.'
      : 'Администратор выдал вам разовый пароль. Для продолжения работы задайте новый пароль.';
  }

  if (modal) modal.dataset.mode = mode;

   const isImpersonatingNow = isImpersonating();
  
  // 🆕 Если мы в режиме имперсонации (админ зашел под юзером), ВСЕГДА показываем кнопку «Позже»,
  // чтобы админ не застрял. Иначе — скрываем, если смена принудительная.
  const reallyForce = !isImpersonatingNow && (force || (currentUser && (currentUser.mustSetPassword || currentUser.mustChangePassword)));

  if (cancelBtn) {
    cancelBtn.style.display = reallyForce ? 'none' : 'inline-flex';
    // 🆕 Если мы под другим пользователем — кнопка всегда называется «Позже»
    cancelBtn.textContent = isImpersonatingNow ? 'Позже' : 'Отмена';
  }
  UI.modal.open('change-password-modal');
  const focusTarget = isSetup ? newInput : currentInput;
  if (focusTarget) setTimeout(() => focusTarget.focus(), 100);
}

function closeChangePasswordModal() {
  UI.modal.close('change-password-modal');
}

async function submitChangePassword(e) {
  e.preventDefault();

  const modal = document.getElementById('change-password-modal');
  const mode = (modal && modal.dataset.mode) || 'change';
  const isSetup = mode === 'setup';

  const errEl = document.getElementById('cp-error');
  const currentPwd = isSetup ? '' : document.getElementById('cp-current').value;
  const newPwd     = document.getElementById('cp-new').value;
  const confirmPwd = document.getElementById('cp-confirm').value;

  const cpBtn = document.getElementById('cp-btn');
  const cpBtnIcon = document.getElementById('cp-btn-icon');
  const cpBtnText = document.getElementById('cp-btn-text');

  const resetCpBtn = () => {
    if (cpBtn) cpBtn.disabled = false;
    if (cpBtnIcon) cpBtnIcon.className = 'fa-solid fa-floppy-disk';
    if (cpBtnText) cpBtnText.textContent = isSetup ? 'Установить пароль' : 'Сохранить пароль';
  };

  errEl.textContent = '';

  const missing = [];
  if (!isSetup && !currentPwd) missing.push('Текущий пароль');
  if (!newPwd)     missing.push('Новый пароль');
  if (!confirmPwd) missing.push('Подтверждение пароля');
  if (missing.length > 0) {
    errEl.textContent = missing.length === 1
      ? `Заполните поле «${missing[0]}»`
      : `Заполните поля: ${missing.map(m => `«${m}»`).join(', ')}`;
    return;
  }

  if (newPwd !== confirmPwd) {
    errEl.textContent = 'Пароли не совпадают';
    return;
  }

  const v = validatePasswordClient(newPwd);
  if (!v.ok) {
    errEl.textContent = 'Пароль не соответствует требованиям:\n• ' + v.errors.join('\n• ');
    return;
  }

  if (cpBtn) cpBtn.disabled = true;
  if (cpBtnIcon) cpBtnIcon.className = 'fa-solid fa-spinner fa-spin';
  if (cpBtnText) cpBtnText.textContent = 'Сохранение…';

  try {
    const endpoint = isSetup ? '/auth/setup-password' : '/auth/change-password';
    const payload  = isSetup
      ? { newPassword: newPwd, confirmPassword: confirmPwd }
      : { currentPassword: currentPwd, newPassword: newPwd, confirmPassword: confirmPwd };

    const res = await apiRequest(endpoint, 'POST', payload);

    currentUser.mustSetPassword = false;
    currentUser.mustChangePassword = false;

    if (res.token) authToken = res.token;

    setSession(currentUser, authToken, getOriginalUser(), getOriginalToken());
    showToast(isSetup ? 'Пароль установлен' : 'Пароль успешно изменён', 'success');
    resetCpBtn();
    closeChangePasswordModal();
    renderAuthUI();
  } catch (err) {
    errEl.textContent = err.message || 'Ошибка смены пароля';
    resetCpBtn();
  }
}

async function resetUserPassword(userId, login) {
  if (!isAdmin()) { showToast('Доступно только администратору', 'error'); return; }

  let displayName = login;
  if (!displayName) {
    try {
      const users = await apiRequest('/users');
      const u = users.find(x => x.id === userId);
      if (u) displayName = u.login;
    } catch (e) {}
  }
  if (!displayName) displayName = userId;

  const ok = await showConfirm(
    `Сбросить пароль пользователя «${displayName}»?\n\n` +
    `Будет сгенерирован разовый пароль. Пользователь обязан сменить его при следующем входе.`,
    { icon: '🔑', title: 'Сброс пароля', okText: 'Сбросить', okClass: 'btn-warning' }
  );
  
  if (!ok) return;

  try {
    const res = await apiRequest(`/users/${userId}/reset-password`, 'POST', {});
    showTempPasswordModal(res.login, res.fullName, res.tempPassword);
    renderUsersSettings();
  } catch (e) {
    showToast(e.message || 'Ошибка сброса пароля', 'error');
  }
}

let _tempPasswordValue = '';

function showTempPasswordModal(login, fullName, tempPassword) {
  _tempPasswordValue = tempPassword;

  document.getElementById('tp-login').value    = login || '';
  document.getElementById('tp-fullname').value = fullName || '';
  document.getElementById('tp-password').value = tempPassword || '';

  UI.modal.open('temp-password-modal');
}

function closeTempPasswordModal() {
  UI.modal.close('temp-password-modal');
  _tempPasswordValue = '';
}

async function copyTempPassword() {
  if (!_tempPasswordValue) return;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(_tempPasswordValue);
      showToast('Пароль скопирован в буфер обмена', 'success');
      return;
    }
  } catch (e) { /* fallback ниже */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = _tempPasswordValue;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(
      ok ? 'Пароль скопирован в буфер обмена'
         : 'Не удалось скопировать. Скопируйте вручную.',
      ok ? 'success' : 'error'
    );
  } catch (e) {
    showToast('Не удалось скопировать. Скопируйте вручную.', 'error');
  }
}
