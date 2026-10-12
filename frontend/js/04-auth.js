'use strict';

// ============================================================
// АВТОРИЗАЦИЯ
// ============================================================
function getSession() {
  try {
    const data = JSON.parse(sessionStorage.getItem('pipette_session'));
    if (data && data.token && data.user) {
      authToken = data.token;
      currentUser = data.user;
      return data;
    }
  } catch (e) {
    // Битый JSON — чистим, чтобы не остаться в полусостоянии
    sessionStorage.removeItem('pipette_session');
  }
  authToken = null;
  currentUser = null;
  return null;
}

function setSession(user, token, originalUser, originalToken) {
  const data = { user, token };
  if (originalUser && originalToken) {
    data.originalUser = originalUser;
    data.originalToken = originalToken;
  }
  sessionStorage.setItem('pipette_session', JSON.stringify(data));
  authToken = token;
  currentUser = user;
}

function clearSession() {
  sessionStorage.removeItem('pipette_session');
  authToken = null;
  currentUser = null;
}

function getOriginalUser() {
  try {
    const data = JSON.parse(sessionStorage.getItem('pipette_session'));
    return data && data.originalUser ? data.originalUser : null;
  } catch { return null; }
}

function getOriginalToken() {
  try {
    const data = JSON.parse(sessionStorage.getItem('pipette_session'));
    return data && data.originalToken ? data.originalToken : null;
  } catch { return null; }
}

function isImpersonating() {
  return !!getOriginalUser();
}

let _refreshPromise = null;

async function refreshCurrentUser() {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/verify`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) return;

      const { user } = await res.json();

      const oldPerms = (currentUser.extraPermissions || []).join(',');
      const newPerms = (user.extraPermissions || []).join(',');
      const permsChanged = oldPerms !== newPerms;
      const mustChangeChanged = !!currentUser.mustChangePassword !== !!user.mustChangePassword;
      const mustSetChanged    = !!currentUser.mustSetPassword    !== !!user.mustSetPassword;

      currentUser = user;

           let s = {};
      try {
        s = JSON.parse(sessionStorage.getItem('pipette_session') || '{}') || {};
      } catch {
        s = {};
      }
      s.user = user;
      if (!s.token && authToken) s.token = authToken;
      sessionStorage.setItem('pipette_session', JSON.stringify(s));

      if (permsChanged || mustChangeChanged || mustSetChanged) {
        renderAuthUI();
        if (permsChanged) {
          showToast('Ваши права были обновлены администратором', 'success');
        }
      }
    } catch (e) {
      /* тихо */
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

// ============================================================
// ПРАВА
// ============================================================
function hasPermission(permission) {
  const user = currentUser;
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = user.extraPermissions || [];
  return perms.includes(permission);
}

// 🆕 Совместимость со старым правом manage_pipettes + новые права
function canManagePipettes() {
  return hasPermission('manage_pipettes')
      || hasPermission('add_pipette')
      || hasPermission('edit_pipette')
      || hasPermission('delete_pipette')
      || hasPermission('quick_calibration')
      || hasPermission('bulk_send')
      || hasPermission('bulk_return');
}
function canImport() { return hasPermission('import_data'); }
function canExport() { return hasPermission('export_data'); }
function isAuthenticated() { return !!currentUser; }
function isAdmin() { return currentUser && currentUser.role === 'admin'; }
function isSeniorLab() { return currentUser && currentUser.role === 'senior_lab'; }

// ============================================================
// ПРОВЕРКИ ПРАВ (расширенные)
// ============================================================
function canAddPipette()    { return hasPermission('add_pipette')       || hasPermission('manage_pipettes'); }
function canEditPipette()   { return hasPermission('edit_pipette')      || hasPermission('manage_pipettes'); }
function canDeletePipette() { return hasPermission('delete_pipette')    || hasPermission('manage_pipettes'); }
function canQuickCal()      { return hasPermission('quick_calibration') || hasPermission('manage_pipettes'); }
function canTransferPipette() { return hasPermission('transfer_pipette') || hasPermission('manage_pipettes'); }
function canBulkChangeResponsible() { return hasPermission('bulk_change_responsible') || hasPermission('manage_pipettes'); }
function canBulkSend()      { return hasPermission('bulk_send')         || hasPermission('manage_pipettes'); }
function canBulkReturn()    { return hasPermission('bulk_return')       || hasPermission('manage_pipettes'); }
function canScanBarcode()   { return hasPermission('scan_barcode'); }
function canPrintLabels()   { return hasPermission('print_labels'); }
function canManageBarcodes(){ return hasPermission('manage_barcodes'); }
function canManageUsers()   { return hasPermission('manage_users'); }
function canManageSettings(){ return hasPermission('manage_settings'); }
function canManagePrinters(){ return hasPermission('manage_printers'); }
function canViewLog()       { return hasPermission('view_log'); }
function canViewHistory()   { return true; }

// ============================================================
// ВХОД / ВЫХОД
// ============================================================
async function loginUser(e) {
  e.preventDefault();

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const btnIcon = document.getElementById('login-btn-icon');
  const btnText = document.getElementById('login-btn-text');
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');

  errorEl.textContent = '';

    // 🆕 Пароль может быть пустым — для админа при первом входе
  if (!username) {
    errorEl.textContent = 'Заполните поле «Логин»';
    return;
  }

  // 🆕 Блокируем форму и показываем спиннер
  if (btn) btn.disabled = true;
  if (usernameInput) usernameInput.disabled = true;
  if (passwordInput) passwordInput.disabled = true;
  if (btnIcon) btnIcon.className = 'fa-solid fa-spinner fa-spin';
  if (btnText) btnText.textContent = 'Вход…';

  try {
    const result = await apiRequest('/auth/login', 'POST', { login: username, password });
    setSession(result.user, result.token);
    showToast(`Добро пожаловать, ${result.user.fullName}!`, 'success');
    renderAuthUI();
  } catch (error) {
    errorEl.textContent = error.message || 'Ошибка входа';

    // 🆕 Разблокируем форму при ошибке
    if (btn) btn.disabled = false;
    if (usernameInput) usernameInput.disabled = false;
    if (passwordInput) passwordInput.disabled = false;
    if (btnIcon) btnIcon.className = 'fa-solid fa-right-to-bracket';
    if (btnText) btnText.textContent = 'Войти';

    if (passwordInput) {
      passwordInput.focus();
      passwordInput.select();
    }
  }
}

function logoutUser() {
  clearSession();
  myPrefs = { visibleFields: null };

     // 🆕 Сброс состояния сессии
  filterState = {};
  _filterRendered = false;
  selectedPipettes.clear();
  _reminderScheduled = false;
  _reminderDismissed = false;
  _lastPermsCheck = 0;
  _dataLoadedForUser = null;
  currentPage = 1;
  const searchEl = document.getElementById('search');
  if (searchEl) searchEl.value = '';
  

  const u = document.getElementById('login-username');
  const p = document.getElementById('login-password');

  if (u && u.value.trim()) {
    localStorage.setItem('pipette_last_login', u.value.trim());
  }
  if (p) p.value = '';

  renderAuthUI();
  showToast('Вы вышли из системы', 'success');
}

// ============================================================
// IMPERSONATE
// ============================================================
async function impersonateUser(userId) {
  const originalUser = getOriginalUser() || currentUser;
  const originalToken = getOriginalToken() || authToken;

  try {
    const result = await apiRequest('/auth/impersonate/' + userId, 'POST', {});
    setSession(result.user, result.token, originalUser, originalToken);

       myPrefs = { visibleFields: null };
    _dataLoadedForUser = null;
    _lastPermsCheck = 0;

    // 🆕 Сброс напоминаний — у impersonated свой набор
    _reminderScheduled = false;
    _reminderDismissed = false;

    // 🆕 Сброс фильтров, поиска, страницы
    filterState = {};
    _filterRendered = false;
    currentPage = 1;
    const searchEl = document.getElementById('search');
    if (searchEl) searchEl.value = '';

    // Очищаем данные предыдущего пользователя
    pipettes = [];
    selectedPipettes.clear();

    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    document.querySelectorAll('.reminder-overlay.active').forEach(m => m.classList.remove('active'));
    showToast('Вы вошли как ' + result.user.fullName, 'success');
    renderAuthUI();
  } catch (e) {
    showToast(e.message, 'error');
  }
}
async function stopImpersonate() {
  const originalUser = getOriginalUser();
  const originalToken = getOriginalToken();
  if (!originalUser || !originalToken) {
    showToast('Вы не в режиме переключения', 'error');
    return;
  }

  // 🆕 Логируем возврат на сервере (не блокируем при ошибке)
  try {
    await apiRequest('/auth/stop-impersonate', 'POST', {});
  } catch (e) {
    // Не срываем возврат, даже если лог не удался
    console.warn('Не удалось залогировать возврат:', e.message);
  }

  authToken = originalToken;
  currentUser = originalUser;
  sessionStorage.setItem('pipette_session', JSON.stringify({
    user: originalUser,
    token: originalToken
  }));
   myPrefs = { visibleFields: null };
  _dataLoadedForUser = null;
  _lastPermsCheck = 0;

  // 🆕 Сброс напоминаний — возвращаемся к своим
  _reminderScheduled = false;
  _reminderDismissed = false;

   // 🆕 Сброс фильтров, поиска, страницы
  filterState = {};
  _filterRendered = false;
  currentPage = 1;
  const searchEl = document.getElementById('search');
  if (searchEl) searchEl.value = '';

  // Очищаем данные impersonated пользователя
  pipettes = [];
  selectedPipettes.clear();

  showToast('Вернулись к своей учётной записи', 'success');
  renderAuthUI();
}

// Проверка прав при возврате в окно/вкладку
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isAuthenticated()) {
    refreshCurrentUser();
  }
});

window.addEventListener('focus', () => {
  if (isAuthenticated()) refreshCurrentUser();
});