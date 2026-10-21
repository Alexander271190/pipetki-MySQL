'use strict';

// ============================================================
// КЭШ СПИСКА ПОЛЬЗОВАТЕЛЕЙ (для меню действий)
// ============================================================
async function getCachedUsers(forceReload = false) {
  const now = Date.now();
  if (!forceReload && _cachedUsersList && now - _cachedUsersTime < USERS_CACHE_TTL) {
    return _cachedUsersList;
  }
  try {
    _cachedUsersList = await apiRequest('/users');
    _cachedUsersTime = now;
  } catch (e) {
    console.warn('Не удалось загрузить пользователей:', e.message);
    if (!_cachedUsersList) _cachedUsersList = [];
  }
  return _cachedUsersList;
}

function invalidateUsersCache() {
  _cachedUsersList = null;
  _cachedUsersTime = 0;
}

// ============================================================
// 🆕 МЕНЮ ДЕЙСТВИЙ В СТРОКЕ (кнопка ⋮)
// ============================================================
let _rowActionsMenu = null;

async function openUserActions(ev, userId) {
  ev.stopPropagation();
  
  
  const anchorEl = ev.currentTarget;
  
  await UI.guard({ role: 'admin', errorMsg: 'Только для администратора' }, async () => {
    const curId = currentUser.id;
    const isSelf = userId === curId;

  let u = {};
    try {
      const users = await getCachedUsers();
      u = users.find(x => x.id === userId) || {};
    } catch (e) {
      console.warn('Не удалось подтянуть данные пользователя:', e.message);
    }

    const items = [
      { label: '<i class="fa-solid fa-pen"></i> Редактировать', action: () => editUserSetting(userId) },
      { label: '<i class="fa-solid fa-list-check"></i> Настроить видимые поля', action: () => openUserViewModal(userId, u.fullName || '') },
    ];

    if (!isSelf) {
      items.push({ divider: true });
      items.push({ label: '<i class="fa-solid fa-right-to-bracket"></i> Войти как этот пользователь', class: 'item-warning', action: () => impersonateUser(userId) });
      items.push({ label: '<i class="fa-solid fa-key"></i> Сбросить пароль', class: 'item-warning', action: () => resetUserPassword(userId, u.login || '') });
      items.push({ divider: true });
      items.push({ label: '<i class="fa-solid fa-trash"></i> Удалить пользователя', class: 'item-danger', action: () => deleteUserSetting(userId, u.fullName || '') });
    }

    renderUserActionsMenu(anchorEl, items); 
  });
}
function renderUserActionsMenu(anchorEl, items) {
  renderRowActionsMenu(anchorEl, items);
}

async function openRowActions(ev, id) {
  ev.stopPropagation();
  const anchorEl = ev.currentTarget; 
  
  await UI.guard({}, async () => {
    const p = pipettes.find(x => x.id === id);
    if (!p) return;

    const status = calcStatus(p);
    const histCount = p.history_count || 0;

    const items = [];

    if (canViewHistory()) {
      items.push({
        label: '<i class="fa-solid fa-clock-rotate-left"></i> История поверок' + (histCount > 0 ? ` (${histCount})` : ''),
        action: () => openHistoryModal(id),
      });
    }

    if (canEditPipette()) {
      items.push({ label: '<i class="fa-solid fa-pen"></i> Редактировать', action: () => openModal(id) });
    }

    if (canTransferPipette()) {
      items.push({ label: '<i class="fa-solid fa-right-left"></i> Передать в другой отдел', action: () => openTransferModal(id) });
    }

    if (canQuickCal()) {
      items.push({ divider: true });
      if (status === 'sent') {
        items.push({ label: '<i class="fa-solid fa-rotate-left"></i> Вернулась с поверки', class: 'item-success', action: () => openQuickCalModal(id) });
      } else {
        items.push({ label: '<i class="fa-solid fa-clipboard-check"></i> Быстрая поверка', class: 'item-success', action: () => openQuickCalModal(id) });
      }
    }

    if (status === 'sent' && canBulkSend()) {
      items.push({ label: '<i class="fa-solid fa-xmark"></i> Отменить отправку', class: 'item-warning', action: () => cancelSend(id) });
    }

    if (canDeletePipette()) {
      items.push({ divider: true });
      items.push({ label: '<i class="fa-solid fa-trash"></i> Удалить', class: 'item-danger', action: () => deletePipette(id) });
    }
    renderRowActionsMenu(anchorEl, items); 
  });
}

function renderRowActionsMenu(anchorEl, items) {
  closeRowActionsMenu();

  const rect = anchorEl.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'row-actions-menu';
  menu.id = 'row-actions-menu';

  let html = '';
  for (const item of items) {
    if (item.divider) {
      html += `<div class="row-actions-divider"></div>`;
      continue;
    }
    html += `<button class="row-actions-item ${item.class || ''}" type="button">${item.label}</button>`;
  }
  menu.innerHTML = html;

  document.body.appendChild(menu);
  _rowActionsMenu = menu;

  // 🆕 Все замеры и установка позиции — в одном requestAnimationFrame
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;

    const top = (spaceBelow < menuRect.height + 10)
      ? rect.top - menuRect.height - 6
      : rect.bottom + 6;

    let left = rect.right - menuRect.width;
    if (left < 8) left = 8;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = window.innerWidth - menuRect.width - 8;
    }

    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
  });

  const realItems = items.filter(it => !it.divider);
  menu.querySelectorAll('.row-actions-item').forEach((btn, i) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const item = realItems[i];
      if (item && item.action) item.action();
      closeRowActionsMenu();
    };
  });

  setTimeout(() => {
    document.addEventListener('mousedown', _rowActionsOutsideClick, true);
    window.addEventListener('resize', closeRowActionsMenu);
    window.addEventListener('scroll', closeRowActionsMenu, true);
  }, 0);
}

function _rowActionsOutsideClick(e) {
  if (_rowActionsMenu && !_rowActionsMenu.contains(e.target)) {
    closeRowActionsMenu();
  }
}

function closeRowActionsMenu() {
  if (_rowActionsMenu) {
    _rowActionsMenu.remove();
    _rowActionsMenu = null;
  }
  document.removeEventListener('mousedown', _rowActionsOutsideClick, true);
  window.removeEventListener('resize', closeRowActionsMenu);
  window.removeEventListener('scroll', closeRowActionsMenu, true);
}

// ============================================================
// 🆕 ПЕРЕДАЧА В ДРУГОЙ ОТДЕЛ
// ============================================================
let _transferPipetteId = null;

async function openTransferModal(id) {
  await UI.guard(
    { permission: ['transfer_pipette', 'manage_pipettes'], errorMsg: 'Нет прав на передачу' },
    async () => {
      const p = pipettes.find(x => x.id === id);
      if (!p) { showToast('Оборудование не найдено', 'error'); return; }

      _transferPipetteId = id;

      document.getElementById('transfer-pipette-info').innerHTML =
        `<strong>${esc(p.id)}</strong> — ${esc(p.model)}<br>
         <small style="color:${COLORS.muted};">Текущий отдел: ${esc(p.department || 'без отдела')}</small>`;

      const currentDept = p.department || '';
      const available = departmentsList.filter(d => d !== currentDept);

      const deptSel = document.getElementById('transfer-department');
      deptSel.innerHTML = '<option value="">— выберите отдел —</option>' +
        available.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');

      const respSel = document.getElementById('transfer-responsible');
      respSel.innerHTML = '<option value="">— сначала выберите отдел —</option>';
      respSel.disabled = true;

      document.getElementById('transfer-error').textContent = '';
      UI.modal.open('transfer-modal');
    }
  );
}

function closeTransferModal() {
  UI.modal.close('transfer-modal');
  _transferPipetteId = null;
}

async function onTransferDepartmentChange(dept) {
  const respSel = document.getElementById('transfer-responsible');
  if (!dept) {
    respSel.innerHTML = '<option value="">— сначала выберите отдел —</option>';
    respSel.disabled = true;
    return;
  }

  respSel.disabled = false;
  respSel.innerHTML = '<option value="">Загрузка…</option>';

  try {
    const users = await apiRequest('/users/responsibles');
    const inDept = users.filter(u => (u.department || '') === dept);

    if (inDept.length === 0) {
      respSel.innerHTML = '<option value="">— нет сотрудников в этом отделе —</option>';
      return;
    }

    respSel.innerHTML = '<option value="">— выберите ответственного —</option>' +
      inDept.map(u => `<option value="${esc(u.fullName)}">${esc(u.fullName)}</option>`).join('');
  } catch (e) {
    respSel.innerHTML = '<option value="">— ошибка загрузки —</option>';
    showToast('Не удалось загрузить список ответственных: ' + e.message, 'error');
  }
}

async function saveTransfer() {
  await refreshCurrentUser();
  if (!canTransferPipette()) {
    showToast('Нет прав на передачу оборудования', 'error');
    return;
  }

  const id = _transferPipetteId;
  if (!id) return;

  const newDept = document.getElementById('transfer-department').value.trim();
  const newResp = document.getElementById('transfer-responsible').value.trim();
  const errEl = document.getElementById('transfer-error');

  errEl.textContent = '';

  if (!newDept) {
    errEl.textContent = 'Выберите отдел';
    return;
  }
  if (!newResp) {
    errEl.textContent = 'Выберите ответственного';
    return;
  }

  const p = pipettes.find(x => x.id === id);
  if (!p) return;

  const ok = await showConfirm(
    `Передать «${id}» из «${p.department || 'без отдела'}» в «${newDept}»?\n\n` +
    `Ответственный: ${newResp}.\n` +
    `Вся история поверок сохранится.`,
    { icon: '🔀', title: 'Передача в другой отдел', okText: 'Передать', okClass: 'btn-primary' }
  );
  if (!ok) return;

  try {
    await apiRequest(`/pipettes/${id}/transfer`, 'POST', {
      department: newDept,
      responsible: newResp,
    });

    showToast(`Передано в «${newDept}»`, 'success');
    closeTransferModal();
    await loadPipetteData();
  } catch (e) {
    errEl.textContent = e.message || 'Ошибка передачи';
  }
}

// ============================================================
// ИСТОРИЯ
// ============================================================
async function openHistoryModal(id) {
  await UI.guard({ permission: 'view_history' }, async () => {
    const p = pipettes.find(x => x.id === id);
    if (!p) return;
    currentHistoryId = id;
    document.getElementById('history-title').innerHTML =
      `<i class="fa-solid fa-clock-rotate-left"></i> История поверок — ${esc(p.id)}`;
    await renderHistoryContent(p);
    closeCalibrationForm();
    UI.modal.open('history-modal');
  });
}

function closeHistoryModal() {
  UI.modal.close('history-modal');
  currentHistoryId = null;
  closeCalibrationForm();
}

async function renderHistoryContent(p) {
  const content = document.getElementById('history-content');
  const next = getNextDate(p);
  const status = calcStatus(p);

  // 1. Загружаем историю
  let history = [];
  try {
    history = await apiRequest(`/pipettes/${p.id}/calibration`);
    history.sort((a, b) => {
      const dateCmp = String(b.date).localeCompare(String(a.date));
      if (dateCmp !== 0) return dateCmp;
      return (b.id || 0) - (a.id || 0);
    });
  } catch (error) {
    console.error('Error loading history:', error);
  }

  // 2. Карточка прибора
  let infoHtml = `
    <div class="info-grid">
      <div><label>Модель</label><span>${esc(p.model)}${p.manufacturer ? ' (' + esc(p.manufacturer) + ')' : ''}</span></div>
      <div><label>Серийный номер</label><span>${esc(p.serial || '—')}</span></div>
      <div><label>Объём</label><span>${p.volume ? esc(p.volume) + ' мкл' : '—'}</span></div>
      <div><label>Отдел</label><span>${esc(p.department || '—')}</span></div>
      <div><label>МПИ</label><span>${p.interval} мес.</span></div>
      <div><label>Последняя поверка</label><span>${formatDate(p.last_calibration)}</span></div>
      <div><label>Следующая поверка</label><span>${formatDate(next)}</span></div>
      <div><label>Статус</label><span>${UI.renderStatusBadge(status)}</span></div>
      <div><label>Ответственный</label><span>${esc(p.responsible || '—')}</span></div>
      <div><label>Место хранения</label><span>${esc(p.location || '—')}</span></div>
      ${p.sent_for_calibration ? `<div><label>Отправлена на поверку</label><span>${formatDate(p.sent_for_calibration)}</span></div>` : ''}
      ${p.sent_note ? `<div><label>Примечание к отправке</label><span>${esc(p.sent_note)}</span></div>` : ''}
    </div>
  `;

  // 3. Timeline истории
  let histHtml = '';
  if (history.length === 0) {
    histHtml = '<div class="history-empty">Записей о поверках пока нет.<br>Нажмите «Добавить поверку», чтобы создать первую.</div>';
  } else {
    histHtml = '<div class="history-header"><h3>Журнал поверок (' + history.length + ')</h3></div>';
    histHtml += '<div class="timeline" style="position:relative;padding-left:28px;margin-top:15px;">';
    history.forEach(h => {
      const itemClass = h.result === 'fail' ? 'danger' : (h.result === 'wip' ? 'warn' : '');
      histHtml += `<div class="timeline-item ${itemClass}" style="position:relative;padding-bottom:20px;border-left:2px solid #e2e8f0;padding-left:20px;">
        <div style="font-weight:600;font-size:.85rem;color:#475569;">${formatDate(h.date)}</div>
        ${h.cert ? `<div style="display:inline-block;background:#e0f2fe;color:#0369a1;padding:2px 10px;border-radius:6px;font-size:.78rem;margin-top:4px;"><i class="fa-solid fa-file-lines"></i> Свидетельство № ${esc(h.cert)}</div>` : ''}
        <span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;margin-top:4px;margin-left:6px;${h.result === 'pass' ? 'background:#dcfce7;color:#166534;' : h.result === 'fail' ? 'background:#fee2e2;color:#991b1b;' : 'background:#e0f2fe;color:#0369a1;'}">${RESULT_LABELS[h.result] || h.result}</span>
        ${h.org ? `<div style="font-size:.85rem;color:#64748b;margin-top:4px;">Организация: ${esc(h.org)}</div>` : ''}
        ${h.note ? `<div style="font-size:.85rem;color:#64748b;margin-top:4px;">${esc(h.note)}</div>` : ''}
      </div>`;
    });
    histHtml += '</div>';
  }

  content.innerHTML = infoHtml + histHtml;
}

async function openCalibrationForm() {
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  document.getElementById('calibration-form-wrap').style.display = 'block';
  document.getElementById('cal-date').value = todayStr();
  document.getElementById('cal-cert').value = '';
  document.getElementById('cal-result').value = 'pass';
  document.getElementById('cal-org').value = '';
  document.getElementById('cal-note').value = '';
}

function closeCalibrationForm() {
  document.getElementById('calibration-form-wrap').style.display = 'none';
}

async function addCalibrationRecord() {
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  const date = document.getElementById('cal-date').value;
  const cert = document.getElementById('cal-cert').value.trim();
  const result = document.getElementById('cal-result').value;
  const org = document.getElementById('cal-org').value.trim();
  const note = document.getElementById('cal-note').value.trim();

  if (!date) { showToast('Заполните поле «Дата поверки»', 'error'); return; }
  if (date > todayStr()) { showToast('Дата не может быть в будущем', 'error'); return; }

  try {
    await apiRequest(`/pipettes/${currentHistoryId}/calibration`, 'POST', { date, cert, result, org, note });
    showToast('Запись о поверке добавлена', 'success');
    closeCalibrationForm();
    closeHistoryModal();
    await loadPipetteData();
  } catch (error) {
    showToast(error.message || 'Ошибка сохранения', 'error');
  }
}
