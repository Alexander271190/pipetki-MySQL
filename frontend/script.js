// ============================================================
// КОНФИГУРАЦИЯ API
// ============================================================
const API_URL = '/api';
let authToken = null;
let currentUser = null;
let _lastPermsCheck = 0;
let _cachedDepartmentsFull = [];
let _cachedFilters = [];
let _activeFilters = [];
let _cachedFields = [];
let exportFields = null;
let selectedPipettes = new Set();
let myPrefs = { visibleFields: null };
let _equipmentTypes = [];            
let _cachedEquipmentTypes = []; 
let _responsibles = [];                
let _bulkSendIds = [];    
let _bulkReturnIds = [];
let _dataLoadedForUser = null;

// ============================================================
// 🆕 СТРУКТУРА РАЗДЕЛОВ НАСТРОЕК
// ============================================================
const SETTINGS_SECTIONS = [
  {
    group: 'Оборудование и данные',
    items: [
      { id: 'fields',      label: 'Поля формы' },
      { id: 'departments', label: 'Отделы' },
      { id: 'filters',     label: 'Фильтры' },
      { id: 'export',      label: 'Экспорт' },
      { id: 'equipment',   label: 'Типы оборудования' },
    ]
  },
  {
    group: 'Пользователи',
    items: [
      { id: 'users',       label: 'Пользователи' },
    ]
  },
  {
    group: 'Печать и штрихкоды',
    items: [
      { id: 'printers',    label: 'Принтеры этикеток' },
      { id: 'barcodes',    label: 'Штрихкоды' },
    ]
  },
  {
    group: 'Общие',
    items: [
      { id: 'general',     label: 'Общие' },
      { id: 'log',         label: 'Журнал действий' },
    ]
  }
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Парсим 'YYYY-MM-DD' как локальную дату, без UTC-сдвига
function parseLocalDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

// Прибавить месяцы, не перескакивая через конец месяца
// (31 янв + 1 мес → 28/29 фев, а не 3 мар)
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

function formatDate(d) {
  if (!d) return '—';
  // YYYY-MM-DD — парсим как локальную, чтобы не съезжала в UTC
  const parsed = parseLocalDate(d);
  if (parsed) {
    return parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function normalizeSearch(s) {
  if (!s) return '';
  const map = {
    'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm',
    'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't',
    'у': 'y', 'х': 'x'
  };
  return String(s)
    .toLowerCase()
    .replace(/[авекмнорстух]/g, ch => map[ch] || ch);
}
function pluralizeType(label) {
  if (!label) return '';
  const s = label.trim();
  if (!s) return '';

  // Уже во множественном числе
  if (s.endsWith('ы') || s.endsWith('и')) return s;

  // Исключения
  if (s.endsWith('ь')) return s.slice(0, -1) + 'и';       // Мышь → Мыши
  if (s.endsWith('ка')) return s.slice(0, -2) + 'ки';      // Пипетка → Пипетки
  if (s.endsWith('га')) return s.slice(0, -1) + 'и';       // Влага → Влаги
  if (s.endsWith('а'))  return s.slice(0, -1) + 'ы';       // Лампа → Лампы

  // Согласные в конце (стандартное правило: +ы)
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(s)) return s + 'ы';  // Анализатор → Анализаторы

  // Всё остальное — без изменений
  return s;
}

function getCalibrationPlace(equipmentType) {
  const t = _equipmentTypes.find(x => x.value === equipmentType);
  if (!t) return 'external';
  return t.calibrationPlace || 'internal';
}

function isExternalCalibration(equipmentType) {
  return getCalibrationPlace(equipmentType) === 'external';
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || '');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.className = 'toast', 4000);
}

let _confirmResolver = null;

function showConfirm(message, options = {}) {
  // 🛡️ Если уже открыт confirm — сначала закрываем предыдущий
  if (_confirmResolver) {
    const prev = _confirmResolver;
    _confirmResolver = null;
    try { prev(false); } catch (e) {}
  }

  return new Promise(resolve => {
    _confirmResolver = resolve;
    const modal = document.getElementById('confirm-modal');
    const icon  = document.getElementById('confirm-icon');
    const title = document.getElementById('confirm-title');
    const text  = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok-btn');

    icon.textContent  = options.icon  || '⚠️';
    title.textContent = options.title || 'Подтверждение';
    text.textContent  = message;
    okBtn.textContent = options.okText || 'ОК';
    okBtn.className   = 'btn ' + (options.okClass || 'btn-danger');

    modal.classList.add('active');
  });
}

function resolveConfirm(result) {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.remove('active');
  if (_confirmResolver) {
    _confirmResolver(result);
    _confirmResolver = null;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const m = document.getElementById('confirm-modal');
    if (m && m.classList.contains('active')) resolveConfirm(false);
  }
});

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'confirm-modal') resolveConfirm(false);
});

// ============================================================
// API КЛИЕНТ
// ============================================================
async function apiRequest(endpoint, method = 'GET', data = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const options = { method, headers };
  if (data) options.body = JSON.stringify(data);

  const response = await fetch(`${API_URL}${endpoint}`, options);

     if (response.status === 401 && !endpoint.startsWith('/auth/login')) {
    clearSession();
    renderAuthUI();
    showToast('Сессия истекла, войдите заново', 'error');
    throw new Error('Неавторизован');
  }

  // Обязательная смена пароля: сервер вернул 403 с кодом
  if (response.status === 403 && !endpoint.startsWith('/auth/')) {
    let body = null;
    try { body = await response.clone().json(); } catch (e) { /* ignore */ }
    if (body && body.code === 'password_change_required') {
      openChangePasswordModal(true);
      throw new Error('Требуется смена пароля');
    }
  }

  // Обновление прав с throttle (не чаще раза в 60 секунд)
  const now = Date.now();
  if (!endpoint.startsWith('/auth/') && now - _lastPermsCheck > 60_000) {
    _lastPermsCheck = now;
    refreshCurrentUser();   // fire-and-forget
  }

    let result;
  try {
    result = await response.json();
  } catch (e) {
    // 🆕 Сервер вернул не JSON (502 от прокси, пустой ответ, HTML)
    result = { error: `Ошибка ${response.status}: сервер вернул некорректный ответ` };
  }

   if (!response.ok) {
    const error = new Error(result.error || 'Ошибка запроса');
    error.status = response.status;
    error.response = result;   // 🆕 полный JSON-ответ сервера
    throw error;
  }
  return result;
}

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

      if (permsChanged || mustChangeChanged) {
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

  if (!username || !password) {
    const missing = [];
    if (!username) missing.push('Логин');
    if (!password) missing.push('Пароль');

    errorEl.textContent = missing.length === 1
      ? `Заполните поле «${missing[0]}»`
      : `Заполните поля: ${missing.map(m => `«${m}»`).join(', ')}`;
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
function stopImpersonate() {
  const originalUser = getOriginalUser();
  const originalToken = getOriginalToken();
  if (!originalUser || !originalToken) {
    showToast('Вы не в режиме переключения', 'error');
    return;
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
  currentPage = 1;
  const searchEl = document.getElementById('search');
  if (searchEl) searchEl.value = '';

  // Очищаем данные impersonated пользователя
  pipettes = [];
  selectedPipettes.clear();

  showToast('Вернулись к своей учётной записи', 'success');
  renderAuthUI();
}

// ============================================================
// ЗАГРУЗКА ДАННЫХ
// ============================================================
let pipettes = [];
let settings = { warnDays: 30 };
let sortField = 'nextCalibration';
let sortDir = 1;
let currentPage = 1;
let pageSize = 100;
let currentHistoryId = null;
let departmentsList = [];

async function loadPipetteData() {
  if (!isAuthenticated()) return;
  try {
    if (!myPrefs._loaded) {
      try {
        myPrefs = await apiRequest('/settings/my-preferences') || {};
        myPrefs._loaded = true;
      } catch (e) {
        myPrefs = { _loaded: true };
      }
    }

    const data = await apiRequest('/pipettes');
    pipettes = data;
    const settingsData = await apiRequest('/settings/system');
    settings = { warnDays: parseInt(settingsData.warn_days) || 30 };
    try {
      _equipmentTypes = await apiRequest('/settings/equipment-types');
    } catch (e) {
      _equipmentTypes = [
        { value: 'pipette',     label: 'Пипетка',     icon: '💧',  prefix: 'P' },
        { value: 'analyzer',    label: 'Анализатор',  icon: '🖥️', prefix: 'A' },
        { value: 'thermometer', label: 'Термометр',   icon: '🌡️', prefix: 'T' },
        { value: 'scales',      label: 'Весы',        icon: '⚖️', prefix: 'S' },
        { value: 'photometer',  label: 'Фотометр',    icon: '🔆', prefix: 'F' },
        { value: 'microscope',  label: 'Микроскоп',   icon: '🔬', prefix: 'M' }
      ];
    }

   try {
      exportFields = await apiRequest('/settings/export');
    } catch (e) {
      exportFields = null;
    }

    // 🆕 Обновляем кэш полей — иначе кастомные колонки/экспорт не подхватятся
    try {
      _cachedFields = await apiRequest('/settings/fields');
    } catch (e) {
      _cachedFields = _cachedFields || [];
    }

    // 🛡️ Список ответственных нужен только тем, кто может редактировать
    if (currentUser.role === 'admin' || isSeniorLab()) {
      try {
        _responsibles = await apiRequest('/users/responsibles');
      } catch (e) {
        _responsibles = [];
        console.warn('Не удалось загрузить список ответственных:', e.message);
      }
    } else {
      _responsibles = [];
    }
    
    await loadDepartments();
    await loadFilterConfig();
    render();
    checkReminder();
  } catch (error) {
    console.error('Error loading data:', error);
    if (error.message === 'Неавторизован') return;
    showToast('Ошибка загрузки данных', 'error');
  }
}

async function loadDepartments() {
  try {
    departmentsList = await apiRequest('/settings/departments');
  } catch (error) {
    console.error('Error loading departments:', error);
    departmentsList = [];
  }
}

async function loadFilterConfig() {
  try {
    const raw = await apiRequest('/settings/filters');
    _activeFilters = raw.filter(f => f.enabled);
    for (const f of _activeFilters) {
      if (f.type === 'select') {
        if (f.optionsSource === 'departments') {
          f.options = departmentsList.map(d => ({ value: d, label: d }));
        
        } else if (f.optionsSource === 'status_list') {
          f.options = [
            { value: 'ok', label: 'В норме' },
            { value: 'warn', label: 'Скоро поверка' },
            { value: 'danger', label: 'Просрочены' },
            { value: 'inactive', label: 'Неактивны' },
            { value: 'sent', label: '📦 На поверке' },
            { value: 'fail', label: '❌ Брак' },
            { value: 'wip', label: '⏳ В процессе' },
            { value: 'unknown', label: 'Не задано' }
             ];
           } else if (f.optionsSource === 'equipment_type_list') {
           f.options = _equipmentTypes.map(t => ({
           value: t.value,
           label: pluralizeType(t.label)
           }));

        } else if (f.optionsSource === 'active_list') {
          f.options = [
            { value: 'true', label: 'В работе' },
            { value: 'false', label: 'Неактивны' }
          ];
        } else {
          f.options = [];
        }
      }
    }
    _filterRendered = false;
  } catch (e) {
    console.error('Error loading filter config:', e);
    _activeFilters = [];
  }
}

// ============================================================
// Синхронизирует filterState с актуальными _activeFilters
// Делает две вещи:
//   1) убирает ключи фильтров, которых больше нет в _activeFilters
//      (удалены или выключены в настройках)
//   2) у оставшихся select-фильтров сбрасывает значение,
//      если его больше нет среди опций (переименование отдела,
//      удаление типа оборудования и т.п.)
// ============================================================
function syncFilterState() {
  // 1) ключи удалённых/выключенных фильтров
  const activeIds = new Set(_activeFilters.map(f => f.id));
  for (const id of Object.keys(filterState)) {
    if (!activeIds.has(id)) {
      delete filterState[id];
    }
  }

  // 2) невалидные значения у оставшихся select-фильтров
  for (const f of _activeFilters) {
    if (f.type !== 'select' || !Array.isArray(f.options) || f.options.length === 0) {
      continue;
    }
    const current = filterState[f.id];
    if (current === undefined || current === null || current === '') continue;

    const validValues = new Set(f.options.map(o => String(o.value)));
    if (!validValues.has(String(current))) {
      delete filterState[f.id];
    }
  }
}


// ============================================================
// СТАТУСЫ
// ============================================================
function calcStatus(p) {
  if (p.sent_for_calibration) return 'sent';
  if (p.last_result === 'fail') return 'fail';
  if (!p.active) return 'inactive';
  if (p.last_result === 'wip') return 'wip';
  if (!p.last_calibration || !p.interval) return 'unknown';
  const last = parseLocalDate(p.last_calibration);
  if (!last) return 'unknown';
  const next = addMonths(last, p.interval);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((next - now) / 86400000);
  if (daysLeft < 0) return 'danger';
  if (daysLeft <= settings.warnDays) return 'warn';
  return 'ok';
}

function getNextDate(p) {
  if (!p.last_calibration || !p.interval) return null;
  const d = parseLocalDate(p.last_calibration);
  if (!d) return null;
  return addMonths(d, p.interval);
}

function daysLeft(p) {
  const next = getNextDate(p);
  if (!next) return -9999;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.ceil((next - now) / 86400000);
}

// ============================================================
// ОПРЕДЕЛЕНИЯ КОЛОНОК ТАБЛИЦЫ
// ============================================================
// Системные колонки
const SYSTEM_TABLE_COLUMNS = [
  { id: 'id',              label: 'ID',            sortable: true,  field: 'id' },
  { id: 'type',            label: 'Тип',           sortable: true,  field: 'equipmentType' },
  { id: 'model',           label: 'Модель',        sortable: true,  field: 'model' },
  { id: 'volume',          label: 'Объём',         sortable: true,  field: 'volume' },
  { id: 'department',      label: 'Отдел',         sortable: true,  field: 'department' },
  { id: 'lastCalibration', label: 'Поверка',       sortable: true,  field: 'lastCalibration' },
  { id: 'nextCalibration', label: 'Следующая',     sortable: true,  field: 'nextCalibration' },
  { id: 'responsible',     label: 'Ответственный', sortable: true,  field: 'responsible' },
  { id: 'location',        label: 'Место',         sortable: false, field: 'location' },
  { id: 'manufacturer',    label: 'Производитель', sortable: false, field: 'manufacturer' },
  { id: 'serial',          label: 'Серийный',      sortable: false, field: 'serial' },
  { id: 'cert',            label: 'Свидетельство', sortable: false, field: 'cert' },
  { id: 'status',          label: 'Статус',        sortable: true,  field: 'status' }
];

const DEFAULT_TABLE_COLUMNS = [
  'id', 'type', 'model', 'volume', 'department',
  'lastCalibration', 'nextCalibration', 'responsible', 'status'
];

// 🆕 Список системных id из field_config — они НЕ должны попадать
// в кастомные колонки, даже если id не совпадает с SYSTEM_TABLE_COLUMNS
const SYSTEM_FIELD_IDS_IN_CONFIG = new Set([
  'id', 'serial', 'manufacturer', 'model', 'equipmentType',
  'volume', 'department', 'interval', 'lastCalibration', 'cert',
  'result', 'active', 'responsible', 'location', 'notes'
]);

// 🆕 Все доступные колонки: системные + кастомные (для настроек вида)
function getAllTableColumns() {
  const result = [];
  const added = new Set();

  // 1. Проходим по field_config в его порядке — добавляем всё, что активно
  const fields = [...(_cachedFields || [])].sort(
    (a, b) => (a.order || 0) - (b.order || 0)
  );

  for (const f of fields) {
    if (!f.enabled) continue;

    const tableId = (f.id === 'equipmentType') ? 'type' : f.id;

    const sysDef = SYSTEM_TABLE_COLUMNS.find(c => c.id === tableId);
    if (sysDef) {
      result.push(sysDef);
      added.add(tableId);
    } else if (!SYSTEM_FIELD_IDS_IN_CONFIG.has(f.id)) {
      // Кастомное поле
      result.push({ id: f.id, label: f.label, sortable: true, field: f.id });
      added.add(f.id);
    }
  }

  // 2. Виртуальные колонки
  if (!added.has('nextCalibration')) {
    const def = SYSTEM_TABLE_COLUMNS.find(c => c.id === 'nextCalibration');
    const idx = result.findIndex(c => c.id === 'lastCalibration');
    if (idx !== -1) result.splice(idx + 1, 0, def);
    else result.push(def);
    added.add('nextCalibration');
  }
  if (!added.has('status')) {
    result.push(SYSTEM_TABLE_COLUMNS.find(c => c.id === 'status'));
    added.add('status');
  }

    // 3. Остальные системные — добавляем в конец.
  //    🆕 Расширяем SYSTEM_TABLE_COLUMNS определениями для системных полей,
  //    которых там нет: interval, notes, result, active.
  //    Иначе findColumn() вернёт undefined, и колонка не отрисуется,
  //    хотя она есть в visibleFields.
  const SYSTEM_EXTRA_COLUMNS = [
    { id: 'interval', label: 'МПИ',         sortable: true,  field: 'interval' },
    { id: 'notes',    label: 'Примечание',  sortable: false, field: 'notes' },
    { id: 'result',   label: 'Результат',   sortable: false, field: 'last_result' },
    { id: 'active',   label: 'Активность',  sortable: false, field: 'active' },
  ];

  const allSystemDefs = [...SYSTEM_TABLE_COLUMNS, ...SYSTEM_EXTRA_COLUMNS];

  for (const sys of allSystemDefs) {
    if (!added.has(sys.id)) {
      result.push(sys);
      added.add(sys.id);
    }
  }

  return result;
}

function getDefaultTableColumns() {
  // Системные поля, которые уже представлены в таблице
  // под другими id (не дублируем)
  const SYSTEM_SKIP_IN_TABLE = new Set([
    'id',            // уже есть как колонка 'id'
    'equipmentType', // уже есть как колонка 'type'
  ]);

  const cols = [];

  // Идём по field_config в его порядке
  for (const f of (_cachedFields || [])) {
    if (!f.enabled) continue;

    if (SYSTEM_FIELD_IDS_IN_CONFIG.has(f.id)) {
      // Системное — пропускаем только те, что уже отражены как 'id'/'type'
      if (!SYSTEM_SKIP_IN_TABLE.has(f.id)) {
        const tableId = (f.id === 'equipmentType') ? 'type' : f.id;
        cols.push(tableId);
      }
    } else {
      // Кастомное — всегда
      cols.push(f.id);
    }
  }

  // Виртуальные колонки — их нет в field_config
  // «Следующая» — сразу после «Поверка»
  const lastCalIdx = cols.indexOf('lastCalibration');
  if (lastCalIdx !== -1) {
    cols.splice(lastCalIdx + 1, 0, 'nextCalibration');
  } else if (!cols.includes('nextCalibration')) {
    cols.push('nextCalibration');
  }

  // «Статус» — в конец
  if (!cols.includes('status')) {
    cols.push('status');
  }

  // Страховка: если field_config пустой — fallback на классический набор
  if (cols.length <= 2) {
    return [...DEFAULT_TABLE_COLUMNS];
  }

  return cols;
}

function findColumn(id) {
  return getAllTableColumns().find(c => c.id === id);
}

function getActiveTableColumns() {
  const allOrdered = getAllTableColumns();

  // 🆕 Единый источник правды — prefs.visibleFields.
  // Что включено у пользователя в форме, то и показываем в таблице.
  // Если индивидуальных настроек нет — дефолтный набор.
  if (!myPrefs.visibleFields || !Array.isArray(myPrefs.visibleFields) || myPrefs.visibleFields.length === 0) {
    return getDefaultTableColumns();
  }

  // Маппинг: id поля в field_config → id колонки в таблице
  const TABLE_ID_MAP = { equipmentType: 'type' };

  const visible = new Set(myPrefs.visibleFields);

  const cols = [];
  const added = new Set();

  // Идём по field_config в порядке field_order — берём только включённые
  for (const f of (_cachedFields || [])) {
    if (!f.enabled) continue;
    if (!visible.has(f.id)) continue;

    const tableId = TABLE_ID_MAP[f.id] || f.id;

    const def = allOrdered.find(c => c.id === tableId);
    if (def) {
      cols.push(tableId);
      added.add(tableId);
    }
  }

  // Виртуальные колонки — всегда
  // «Следующая» — после «Поверка»
  if (!added.has('nextCalibration')) {
    const idx = cols.indexOf('lastCalibration');
    if (idx !== -1) cols.splice(idx + 1, 0, 'nextCalibration');
    else cols.push('nextCalibration');
  }

  // «Статус» — в конец
  if (!added.has('status')) {
    cols.push('status');
  }

  // Страховка: если ничего не собралось — дефолтный набор
  if (cols.length <= 2) {
    return getDefaultTableColumns();
  }

  return cols;
}

function getActiveFormFields(allFields) {
  const enabled = allFields.filter(f => f.enabled);

  // Если настроек нет — показываем всё
  if (!myPrefs.visibleFields || !Array.isArray(myPrefs.visibleFields) || myPrefs.visibleFields.length === 0) {
    return enabled;
  }

  const visible = new Set(myPrefs.visibleFields);

  const SYSTEM_IDS = new Set([
    'id', 'serial', 'manufacturer', 'model', 'equipmentType',
    'volume', 'department', 'interval', 'lastCalibration', 'cert',
    'result', 'active', 'responsible', 'location', 'notes'
  ]);

  const currentCustom = enabled
    .map(f => f.id)
    .filter(id => !SYSTEM_IDS.has(id));

  // Кастомные поля показываем ВСЕГДА — независимо от prefs
  const allowedIds = new Set([...visible, ...currentCustom]);

  return enabled.filter(f => {
    if (SYSTEM_IDS.has(f.id)) return visible.has(f.id);
    return allowedIds.has(f.id);
  });
}

// ============================================================
// ОТСОРТИРОВАННЫЙ СПИСОК (единый источник для render и pageIds)
// ============================================================
function getSortedPipettes() {
  const filtered = getFilteredPipettes();
  filtered.sort((a, b) => {
    let va, vb;
    if (sortField === 'nextCalibration') {
      va = getNextDate(a) || new Date(8640000000000000);
      vb = getNextDate(b) || new Date(8640000000000000);
    } else if (sortField === 'volume') {
      va = parseFloat(a.volume) || 0;
      vb = parseFloat(b.volume) || 0;
    } else if (sortField === 'equipmentType') {
      va = (a.equipment_type || 'pipette');
      vb = (b.equipment_type || 'pipette');
        } else if (sortField === 'status') {
      // 🆕 Сортировка по статусу — по фиксированному порядку
      const STATUS_ORDER = {
        'danger':   1,   // Просрочена
        'fail':     2,   // Брак
        'wip':      3,   // В процессе
        'warn':     4,   // Скоро поверка
        'sent':     5,   // На поверке
        'ok':       6,   // В норме
        'inactive': 7,   // Неактивна
        'unknown':  8    // Не задано
      };
      va = STATUS_ORDER[calcStatus(a)] || 99;
      vb = STATUS_ORDER[calcStatus(b)] || 99;
    } else {
      va = (a[sortField] || '').toString().toLowerCase();
      vb = (b[sortField] || '').toString().toLowerCase();
    }
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  });
  return filtered;
}

// ============================================================
// 🆕 МЕНЮ ДЕЙСТВИЙ В СТРОКЕ (кнопка ⋮)
// ============================================================
let _rowActionsMenu = null;

function openRowActions(ev, id) {
  ev.stopPropagation();

  const p = pipettes.find(x => x.id === id);
  if (!p) return;

  const status = calcStatus(p);
  const histCount = p.history_count || 0;

  const _canEdit     = canEditPipette();
  const _canDelete   = canDeletePipette();
  const _canQuickCal = canQuickCal();
  const _canHistory  = canViewHistory();

  const items = [];

  if (_canHistory) {
    items.push({
      label: 'История поверок' + (histCount > 0 ? ` (${histCount})` : ''),
      action: () => openHistoryModal(id),
    });
  }

   if (_canEdit) {
    items.push({
      label: 'Редактировать',
      action: () => openModal(id),
    });
  }

  if (canTransferPipette()) {
    items.push({
      label: 'Передать в другой отдел',
      action: () => openTransferModal(id),
    });
  }

  if (_canQuickCal) {
    items.push({ divider: true });
    if (status === 'sent') {
      items.push({
        label: 'Вернулась с поверки',
        class: 'item-success',
        action: () => openQuickCalModal(id),
      });
    } else {
      items.push({
        label: 'Быстрая поверка',
        class: 'item-success',
        action: () => openQuickCalModal(id),
      });
    }
  }

  if (status === 'sent' && canBulkSend()) {
    items.push({
      label: 'Отменить отправку',
      class: 'item-warning',
      action: () => cancelSend(id),
    });
  }

  if (_canDelete) {
    items.push({ divider: true });
    items.push({
      label: 'Удалить',
      class: 'item-danger',
      action: () => deletePipette(id),
    });
  }

  renderRowActionsMenu(ev.currentTarget, items);
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
    html += `<button class="row-actions-item ${item.class || ''}" type="button">${esc(item.label)}</button>`;
  }
  menu.innerHTML = html;

  document.body.appendChild(menu);
  _rowActionsMenu = menu;

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
  await refreshCurrentUser();
  if (!canTransferPipette()) {
    showToast('Нет прав на передачу оборудования', 'error');
    return;
  }

  const p = pipettes.find(x => x.id === id);
  if (!p) {
    showToast('Оборудование не найдено', 'error');
    return;
  }

  _transferPipetteId = id;

  // Заголовок
  document.getElementById('transfer-pipette-info').innerHTML =
    `<strong>${esc(p.id)}</strong> — ${esc(p.model)}<br>
     <small style="color:#64748b;">Текущий отдел: ${esc(p.department || 'без отдела')}</small>`;

  // Список отделов: все, кроме текущего
  const currentDept = p.department || '';
  const available = departmentsList.filter(d => d !== currentDept);

  const deptSel = document.getElementById('transfer-department');
  deptSel.innerHTML = '<option value="">— выберите отдел —</option>' +
    available.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');

  // Селект ответственного — пуст до выбора отдела
  const respSel = document.getElementById('transfer-responsible');
  respSel.innerHTML = '<option value="">— сначала выберите отдел —</option>';
  respSel.disabled = true;

  // Очистка ошибок
  document.getElementById('transfer-error').textContent = '';

  document.getElementById('transfer-modal').classList.add('active');
}

function closeTransferModal() {
  document.getElementById('transfer-modal').classList.remove('active');
  _transferPipetteId = null;
}

// Загрузка ответственных для выбранного отдела
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
    // Пытаемся получить всех пользователей — у кого есть роль/отдел
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

// Закрытие модалки по клику на overlay
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'transfer-modal') closeTransferModal();
});

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

 let ok = 0, warn = 0, danger = 0, sent = 0, wip = 0;
pipettes.forEach(p => {
  const s = calcStatus(p);
  if (s === 'ok') ok++;
  else if (s === 'warn') warn++;
  else if (s === 'danger' || s === 'fail') danger++;
  else if (s === 'sent') sent++;
  else if (s === 'wip') wip++;
});
  document.getElementById('stat-ok').textContent = ok;
  document.getElementById('stat-warn').textContent = warn;
  document.getElementById('stat-danger').textContent = danger;
  document.getElementById('stat-total').textContent = pipettes.length;

  const banner = document.getElementById('alert-banner');
  if (danger > 0) {
    document.getElementById('alert-text').textContent = `У ${danger} ${danger === 1 ? 'единицы' : 'единиц'} проблема с поверкой!`;
    banner.classList.add('show');
  } else if (warn > 0) {
    document.getElementById('alert-text').textContent = `У ${warn} ${warn === 1 ? 'единицы' : 'единиц'} подходит срок поверки в течение ${settings.warnDays} дн.`;
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }

  const tbody = document.getElementById('pipettes-body');
  const empty = document.getElementById('empty-state');
  const table = document.getElementById('pipettes-table');
  const thead = table.querySelector('thead tr');
  if (!thead) return;
    // 🆕 Фильтруем колонки ОДИН РАЗ — только те, для которых есть определение.
  // Это гарантирует, что <th> и <td> идут парами и не разъезжаются.
  const columns = getActiveTableColumns()
    .filter(col => !!findColumn(col));

  // 🆕 Столбец «Действия» виден, если есть хоть какое-то право на действия
  const hasAnyRowAction =
    canViewHistory() || canEditPipette() || canDeletePipette() || canQuickCal();

  // Динамическая шапка
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
    return;
  }
  table.style.display = '';
  empty.style.display = 'none';

const labels = {
  ok: 'В норме', warn: 'Скоро поверка', danger: 'Просрочена',
  inactive: 'Неактивна',
  sent: '<i class="fa-solid fa-box"></i> На поверке',
  fail: '<i class="fa-solid fa-xmark"></i> Брак',
  wip: '<i class="fa-solid fa-hourglass-half"></i> В процессе',
  unknown: '<i class="fa-solid fa-circle-question"></i> Не задано'
};

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
          let replLine = '';
          if (p.replaced_by && p.replacement) {
            replLine = `<br><small style="color:#0ea5e9;">↔ замена: ${esc(p.replaced_by)}</small>`;
          } else if (p.replaced_by) {
            replLine = `<br><small style="color:#dc2626;">⚠ замена удалена: ${esc(p.replaced_by)}</small>`;
          }
          if (p.replacing && p.replacedFor) {
            replLine = `<br><small style="color:#f59e0b;">↔ заменяет: ${esc(p.replacing)}</small>`;
          }
          return `<td><strong>${esc(p.id)}</strong>${p.serial ? `<br><small style="color:#94a3b8">S/N: ${esc(p.serial)}</small>` : ''}${replLine}</td>`;
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
            ? `<small style="color:#0ea5e9;font-weight:600;"><i class="fa-solid fa-box"></i> ${formatDate(p.sent_for_calibration)}</small>`
            : status === 'wip'
            ? `<small style="color:#ca8a04;font-weight:600;"><i class="fa-solid fa-hourglass-half"></i> В процессе поверки</small>`
            : status === 'unknown'
            ? `<small style="color:#94a3b8;">Дата не задана</small>`
            : `${formatDate(next)}${daysText ? `<br><small style="color:${status === 'danger' || status === 'fail' ? '#dc2626' : status === 'warn' ? '#eab308' : '#16a34a'}">${daysText}</small>` : ''}`}</td>`;
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
          return `<td><span class="status-badge status-${status}"><span class="status-dot"></span>${labels[status]}</span></td>`;
        case 'interval':
          return `<td>${p.interval != null ? esc(p.interval) + ' мес.' : '—'}</td>`;
        case 'notes':
          return `<td>${esc(p.notes || '—')}</td>`;
        case 'result': {
          const R = { pass: 'Годен', fail: 'Брак', wip: 'В процессе' };
          return `<td>${esc(R[p.last_result] || p.last_result || '—')}</td>`;
        }
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

// 🛡️ Возвращает ID только ТЕКУЩЕЙ страницы (с учётом пагинации)
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
  const counterSend = document.getElementById('bulk-counter');
  const counterReturn = document.getElementById('bulk-return-counter');
  if (!btnSend && !btnReturn) return;

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
}

function clearSelection() {
  selectedPipettes.clear();
  document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
  updateSelectAllCheckbox();
  updateBulkCalButton();
}

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
      html += `<div class="filter-row"><div class="form-group">
        <label>${esc(f.label)}</label>
        <select id="${fid}">
          <option value="">Все</option>
          ${(f.options || []).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
        </select>
      </div></div>`;
    } else if (f.type === 'text') {
      html += `<div class="filter-row"><div class="form-group">
        <label>${esc(f.label)}</label>
        <input type="text" id="${fid}" placeholder="${esc(f.label)}">
      </div></div>`;
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
    const savedScroll = window.scrollY;                    // 🆕 запомнили
  document.getElementById('filter-panel').classList.remove('show');
  currentPage = 1;

  render();
  window.scrollTo(0, savedScroll);                       // 🆕 вернули
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
  // 🛡️ Если панель ещё не отрисована — отрисовать
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
  let dateStr;
  if (cfg.type === 'updated_at') {
    dateStr = p.updated_at || p.created_at;
  } else {
    dateStr = p.last_calibration;
  }
  if (!dateStr) return false;

  const pureDate = String(dateStr).split(' ')[0].split('T')[0];
  const targetDate = parseLocalDate(pureDate);
  if (!targetDate) return false;
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
      if (f.id === 'id' && (!data || !data.id)) {
        continue;
      }

      const div = document.createElement('div');
      div.className = 'form-group';
      
      const label = document.createElement('label');
      label.textContent = f.label + (f.required ? ' *' : '');
      div.appendChild(label);

      let val;
      if (data && data[f.id] !== undefined && data[f.id] !== null) {
        val = data[f.id];
      } else {
        val = f.default || '';
      }

      let input;

      if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 2;
        input.placeholder = f.label;
        input.value = val;
      } else if (f.type === 'select') {
        input = document.createElement('select');

        let opts = [];

        if (f.id === 'department') {
          let deps = departmentsList;

          // 🛡️ И.о. — только отдел основного
          if (currentUser.isActing && currentUser.actingDepartment) {
            deps = [currentUser.actingDepartment];
          } else if (currentUser.role !== 'admin'
              && currentUser.onlyOwnDepartment
              && currentUser.department) {
            deps = [currentUser.department];
          }
          opts = deps.length ? deps : (f.options || []);

      } else if (f.id === 'equipmentType') {
      opts = _equipmentTypes.length > 0
      ? _equipmentTypes.map(t => ({ value: t.value, label: t.label }))
      : [{ value: 'pipette', label: 'Пипетка' }];
    
      } else if (f.id === 'result') {
          opts = [
            { value: 'pass', label: '✅ Годен' },
            { value: 'fail', label: '❌ Брак' },
            { value: 'wip', label: '⏳ В процессе' }
          ];
                } else if (f.id === 'active') {
          opts = [
            { value: 'true', label: '✅ В работе' },
            { value: 'false', label: '⛔ Не используется' }
          ];
         } else if (f.id === 'responsible') {
          if (currentUser.role === 'admin') {
            opts = _responsibles.map(u => ({ value: u.fullName, label: u.fullName }));
            if (!f.required) {
              opts = [{ value: '', label: '— не указан —' }, ...opts];
            }
          } else if (currentUser.isActing && currentUser.actingForName) {
            opts = [{
              value: currentUser.actingForName,
              label: currentUser.actingForName + ' (основной)'
            }];
          } else {
            const self = currentUser.fullName || '';
            opts = self
              ? [{ value: self, label: self }]
              : [{ value: '', label: '— не указан —' }];
          }
        } else {
          opts = f.options || [];
        }

        // 🛡️ Пустая опция для необязательных полей —
        // чтобы при создании не подставлялся первый по списку
        const valStr = (val == null) ? '' : String(val);
        const hasEmpty = opts.some(o => String(typeof o === 'object' ? o.value : o) === '');
        if (!f.required && !hasEmpty && opts.length > 0) {
          opts = [{ value: '', label: '— не указан —' }, ...opts];
        }

        // 🛡️ Если сохранённое значение не найдено среди опций —
        // показываем его как «битую» опцию, чтобы не затереть молча
        const hasVal = opts.some(o => String(typeof o === 'object' ? o.value : o) === valStr);
        if (valStr && !hasVal) {
          opts = [...opts, { value: valStr, label: `${valStr}  ⚠ (нет в списке)` }];
        }

        if (opts.length === 0) opts = [{ value: '', label: '—' }];

        opts.forEach(opt => {
          const optValue = (typeof opt === 'object') ? opt.value : opt;
          const optLabel = (typeof opt === 'object') ? opt.label : (opt || '—');
          const option = document.createElement('option');
          option.value = optValue;
          option.textContent = optLabel;
          if (String(val) === String(optValue)) option.selected = true;
          input.appendChild(option);
        });
            } else {
        input = document.createElement('input');
        input.type = f.type === 'date' ? 'date'
          : f.type === 'number' ? 'number'
          : 'text';
        input.placeholder = f.label;

        // Для type="date" — отрезаем всё, что после первых 10 символов
        // (время, часовой пояс). Иначе браузер молча покажет пустое поле.
        if (f.type === 'date' && val) {
          const s = String(val).trim();
          // Проверяем базовый формат YYYY-MM-DD
          const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
          input.value = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
        } else {
          input.value = val;
        }
      }

      input.id = `p-${f.id}`;
      input.dataset.fieldId = f.id;
      if (f.required) input.required = true;
           
      // ID нельзя менять при редактировании
      if (f.id === 'id' && data && data.id) {
        input.readOnly = true;
        input.style.background = '#f1f5f9';
        input.style.cursor = 'not-allowed';
      }
            // 🛡️ И.о. — отдел заблокирован
      if (f.id === 'department' && currentUser.isActing) {
        input.disabled = true;
        input.style.background = '#f1f5f9';
        input.style.cursor = 'not-allowed';
        input.title = 'И.о. работает в отделе основного';
      }
            // 🛡️ Ответственный — только админ может менять
      if (f.id === 'responsible' && currentUser.role !== 'admin') {
        input.disabled = true;
        input.style.background = '#f1f5f9';
        input.style.cursor = 'not-allowed';
        input.title = 'Только администратор может изменить ответственного';
      }

      div.appendChild(input);
      container.appendChild(div);
      
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
// МОДАЛКА ПИПЕТКИ
// ============================================================
async function openModal(id) {
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }

  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  document.getElementById('edit-id').value = '';

        if (id) {
    const p = pipettes.find(x => x.id === id);
    if (!p) { showToast('Оборудование не найдено', 'error'); return; }

    title.innerHTML = '<i class="fa-solid fa-pen"></i> Редактировать оборудование';
    document.getElementById('edit-id').value = p.id;
    modal.classList.add('active');

        // Нормализация даты — отрезаем время, если оно есть
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
      
   title.innerHTML = '<i class="fa-solid fa-plus"></i> Добавить оборудование';
    const defaultData = {
      lastCalibration: todayStr(),
      interval: 12,
      result: 'pass',
      active: 'true'
    };

       if (currentUser.role === 'admin') {
      // admin — ничего
    } else if (currentUser.isActing && currentUser.actingForName) {
      defaultData.responsible = currentUser.actingForName;
      if (currentUser.actingDepartment) {
        defaultData.department = currentUser.actingDepartment;
      }
    } else {
      defaultData.responsible = currentUser.fullName || '';
    }
          
    // 🛡️ User с onlyOwnDepartment — отдел предзаполнен его отделом
    if (currentUser.role !== 'admin'
        && currentUser.onlyOwnDepartment
        && currentUser.department) {
      defaultData.department = currentUser.department;
    }

    modal.classList.add('active');
    await generateFormFields(defaultData);
  }
}

function closeModal() { document.getElementById('modal').classList.remove('active'); }

async function savePipette(e) {
  e.preventDefault();
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }

  const editId = document.getElementById('edit-id').value;
  const container = document.getElementById('form-fields-container');
  const data = {};
  const missing = [];

  // Собираем все поля формы
  const inputs = container.querySelectorAll('[data-field-id]');
  for (const input of inputs) {
    const fieldId = input.dataset.fieldId;
    const value = (input.value || '').trim();
    const labelEl = input.previousElementSibling;
    const labelText = labelEl
      ? labelEl.textContent.replace(/\s*\*\s*$/, '').trim()
      : fieldId;

    // ID генерируется автоматически при создании — не шлём
    if (fieldId === 'id' && !editId) continue;

    if (input.required && !value) {
      missing.push(labelText);
    }
    if (editId && fieldId === 'lastCalibration' && !value) {
       const original = pipettes.find(x => x.id === editId);
    if (original && original.last_calibration) {
         // Оставляем как есть, не шлём на сервер
         continue;
       }
     }

     data[fieldId] = value;
  }

    const barcodeInput = container.querySelector('[data-field-id="barcode"]');
  if (barcodeInput) {
    if (currentUser.role === 'admin') {
      const isManual = barcodeInput.dataset.manual === '1';
      const val = barcodeInput.value.trim();
      if (isManual && val) {
        data.barcode = val;
      } else {
        delete data.barcode;
      }
    } else {
      delete data.barcode;
    }
  }

  // Единый формат сообщения о незаполненных полях
  if (missing.length > 0) {
    const msg = missing.length === 1
      ? `Заполните поле «${missing[0]}»`
      : `Заполните поля: ${missing.map(m => `«${m}»`).join(', ')}`;
    showToast(msg, 'error');
    return;
  }

  if (data.lastCalibration) {
    const m = String(data.lastCalibration).match(/^(\d{4})-(\d{2})-(\d{2})/);
    data.lastCalibration = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }
  
  if (data.interval) data.interval = parseInt(data.interval) || 12;
  if (data.active !== undefined) {
    data.active = data.active === 'true' || data.active === true;
  }

  if (data.lastCalibration && data.lastCalibration > todayStr()) {
    showToast('Дата поверки не может быть в будущем', 'error');
    return;
  }

    if (data.result) {
    data.lastResult = data.result;
  } else if (editId) {
    // Поле «Результат» скрыто в настройках вида —
    // сохраняем прежнее значение, чтобы PUT его не сбросил
    const original = pipettes.find(x => x.id === editId);
    if (original) data.lastResult = original.last_result || 'pass';
  }
  if (!editId) delete data.id;

  try {
   if (editId) {
      const res = await apiRequest(`/pipettes/${editId}`, 'PUT', data);
      if (res.idChanged && res.newId) {
        showToast(`ID изменён: ${res.oldId} → ${res.newId} (смена типа)`, 'success');
      } else {
        showToast('Оборудование обновлено', 'success');
      }
    } else {
      await apiRequest('/pipettes', 'POST', data);
      showToast('Оборудование добавлено', 'success');
    }
    closeModal();
    await loadPipetteData();
  } catch (error) {
    showToast(error.message || 'Ошибка сохранения', 'error');
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
    // 🆕 Блокировки удаления показываем как предупреждение
    const isBlock = /Нельзя удалить/.test(error.message || '');
    showToast(error.message || 'Ошибка удаления', isBlock ? 'warn' : 'error');
  }
}

// ============================================================
// БЫСТРАЯ ПОВЕРКА (одна пипетка)
// ============================================================
async function openQuickCalModal(id) {
   await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  const p = pipettes.find(x => x.id === id);
  if (!p) { showToast('Оборудование не найдено', 'error'); return; }
  document.getElementById('quick-cal-id').value = id;
  document.getElementById('quick-cal-pipette-info').innerHTML = `<strong>${esc(p.id)}</strong> — ${esc(p.model)} (${esc(p.department || 'без отдела')})`;
  document.getElementById('quick-cal-date').value = todayStr();
  document.getElementById('quick-cal-cert').value = '';
  document.getElementById('quick-cal-result').value = 'pass';
  document.getElementById('quick-cal-org').value = '';
  document.getElementById('quick-cal-note').value = '';
  document.getElementById('quick-cal-modal').classList.add('active');
}

function closeQuickCalModal() {
  document.getElementById('quick-cal-modal').classList.remove('active');
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
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }

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
    // 🆕 Если была замена — сначала разрываем связь:
    // возвращаем складскую на склад
    if (hasReplacement) {
      try {
        await apiRequest(`/pipettes/${p.replaced_by}`, 'PUT', {
          replacing: null,
          active: false,
          location: 'Склад'
        });
      } catch (e) {
        console.warn('Не удалось разорвать связь с заменой:', e.message);
      }
    }

    // Отменяем отправку + снимаем связь
    await apiRequest(`/pipettes/${id}`, 'PUT', {
      sentForCalibration: null,
      sentNote: null,
      active: true,
      replacedBy: null
    });

    showToast('Отправка отменена', 'success');
    await loadPipetteData();
  } catch (e) {
    showToast(e.message || 'Ошибка отмены', 'error');
  }
}

// ============================================================
// ИСТОРИЯ
// ============================================================
async function openHistoryModal(id) {
  const p = pipettes.find(x => x.id === id);
  if (!p) return;
  currentHistoryId = id;
  document.getElementById('history-title').textContent = `История поверок — ${p.id}`;
  await renderHistoryContent(p);
  closeCalibrationForm();
  document.getElementById('history-modal').classList.add('active');
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.remove('active');
  currentHistoryId = null;
  closeCalibrationForm();
}

async function renderHistoryContent(p) {
  const content = document.getElementById('history-content');
  const next = getNextDate(p);
  const status = calcStatus(p);
const statusLabels = {
  ok: 'В норме', warn: 'Скоро поверка', danger: 'Просрочена',
  inactive: 'Неактивна',
  sent: '<i class="fa-solid fa-box"></i> На поверке',
  fail: '<i class="fa-solid fa-xmark"></i> Брак',
  wip: '<i class="fa-solid fa-hourglass-half"></i> В процессе',
  unknown: '<i class="fa-solid fa-circle-question"></i> Не задано'
};

    let history = [];
  try {
    history = await apiRequest(`/pipettes/${p.id}/calibration`);
    // Сортировка: от новых к старым — самая свежая поверка сверху
    // (на случай, если сервер вернул в другом порядке)
    history.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  } catch (error) {
    console.error('Error loading history:', error);
  }

  let infoHtml = `
    <div class="info-grid">
      <div><label>Модель</label><span>${esc(p.model)}${p.manufacturer ? ' (' + esc(p.manufacturer) + ')' : ''}</span></div>
      <div><label>Серийный номер</label><span>${esc(p.serial || '—')}</span></div>
      <div><label>Объём</label><span>${p.volume ? esc(p.volume) + ' мкл' : '—'}</span></div>
      <div><label>Отдел</label><span>${esc(p.department || '—')}</span></div>
      <div><label>МПИ</label><span>${p.interval} мес.</span></div>
      <div><label>Последняя поверка</label><span>${formatDate(p.last_calibration)}</span></div>
      <div><label>Следующая поверка</label><span>${formatDate(next)}</span></div>
      <div><label>Статус</label><span><span class="status-badge status-${status}"><span class="status-dot"></span>${statusLabels[status]}</span></span></div>
      <div><label>Ответственный</label><span>${esc(p.responsible || '—')}</span></div>
      <div><label>Место хранения</label><span>${esc(p.location || '—')}</span></div>
      ${p.sent_for_calibration ? `<div><label>Отправлена на поверку</label><span>${formatDate(p.sent_for_calibration)}</span></div>` : ''}
      ${p.sent_note ? `<div><label>Примечание к отправке</label><span>${esc(p.sent_note)}</span></div>` : ''}
    </div>
  `;

  let histHtml = '';
  const resultLabels = { pass: 'Годен', fail: 'Брак', wip: 'В процессе' };

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
        <span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;margin-top:4px;margin-left:6px;${h.result === 'pass' ? 'background:#dcfce7;color:#166534;' : h.result === 'fail' ? 'background:#fee2e2;color:#991b1b;' : 'background:#e0f2fe;color:#0369a1;'}">${resultLabels[h.result] || h.result}</span>
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

// ============================================================
// ЭКСПОРТ
// ============================================================
const SYSTEM_EXPORT_FIELD_MAP = {
  id: { label: 'ID', get: p => p.id },
  serial: { label: 'Серийный', get: p => p.serial || '' },
  manufacturer: { label: 'Производитель', get: p => p.manufacturer || '' },
  model: { label: 'Модель', get: p => p.model },
  equipmentType: {
    label: 'Тип',
    get: p => {
      const t = _equipmentTypes.find(x => x.value === p.equipment_type);
      return t ? t.label : 'Прочее';
    }
  },
  volume: { label: 'Объём', get: p => p.volume || '' },
  department: { label: 'Отдел', get: p => p.department || '' },
  lastCalibration: { label: 'Дата поверки', get: p => formatDate(p.last_calibration) },
  nextCalibration: { label: 'Следующая', get: p => formatDate(getNextDate(p)) },
  interval: { label: 'МПИ', get: p => p.interval || '' },
  daysLeft: {
    label: 'Дней', get: p => {
      const s = calcStatus(p); const dl = daysLeft(p);
      return (s === 'inactive' || s === 'unknown') ? '—'
        : (s === 'sent' ? 'на поверке'
        : (s === 'wip' ? 'в процессе'
        : (s === 'fail' ? 'брак'
        : (dl < 0 ? 'просрочка ' + Math.abs(dl) + ' дн.' : dl + ' дн.'))));
    }
  },
  responsible: { label: 'Ответственный', get: p => p.responsible || '' },
  location: { label: 'Место', get: p => p.location || '' },
  status: {
    label: 'Статус', get: p => {
      const L = {
        ok: 'В норме', warn: 'Скоро поверка', danger: 'Просрочена',
        inactive: 'Неактивна', sent: 'На поверке', fail: 'Брак',
        wip: 'В процессе', unknown: 'Не задано'
      };
      return L[calcStatus(p)] || calcStatus(p);
    }
  },
  cert: { label: 'Свидетельство', get: p => p.cert || '' },
  notes: { label: 'Примечание', get: p => p.notes || '' }
};

// 🆕 Доступ к любому полю экспорта — системному или кастомному
function getExportField(id) {
  if (SYSTEM_EXPORT_FIELD_MAP[id]) return SYSTEM_EXPORT_FIELD_MAP[id];
  const custom = (_cachedFields || []).find(f => f.id === id);
  if (!custom) return null;
  return {
    label: custom.label,
    get: p => {
      const v = p[id];
      return (v === undefined || v === null) ? '' : String(v);
    }
  };
}

function getActiveExportFields() {
  if (exportFields && Array.isArray(exportFields) && exportFields.length > 0) {
    return exportFields.filter(f => !!getExportField(f));
  }
  return getExportFields().map(f => f.id);
}

async function exportToXlsx() {
  await refreshCurrentUser();
  if (!canExport()) { showToast('Нет прав на экспорт', 'error'); return; }

  const data = getFilteredPipettes();
  if (data.length === 0) { showToast('Нет данных для экспорта', 'error'); return; }

 const fields = getActiveExportFields();
  const headers = fields.map(f => {
    const def = getExportField(f);
    return def ? def.label : f;
  });
  // 🆕 Ключи строк = метки (совпадают с headers)
  const rows = data.map(p => {
    const obj = {};
    fields.forEach((f, i) => {
      const def = getExportField(f);
      obj[headers[i]] = def ? def.get(p) : '';
    });
    return obj;
  });
  
  showToast('Формирование Excel…', 'success');

    try {
    const sess = sessionStorage.getItem('pipette_session');
    if (!sess) {
      showToast('Сессия истекла, войдите заново', 'error');
      return;
    }
    const token = JSON.parse(sess).token;

    const res = await fetch('/api/export/xlsx', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
        body: JSON.stringify({
        mode: 'registry',
        meta: {
          title: 'Реестр оборудования — КГБУЗ «Краевая клиническая больница», КДЛ',
          date: new Date().toLocaleDateString('ru-RU'),
          recordCount: data.length,
          user: currentUser ? currentUser.fullName : '',
          userPosition: currentUser ? (currentUser.position || '') : ''
        },
        headers,
        rows,
        fields
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка экспорта');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipettes_${todayStr()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Экспортировано: ${data.length} записей`, 'success');
  } catch (e) {
    showToast(e.message || 'Ошибка экспорта', 'error');
  }
}

async function exportToPDF() {
  await refreshCurrentUser();
  if (!canExport()) { showToast('Нет прав на экспорт', 'error'); return; }
  const data = getFilteredPipettes();
  if (data.length === 0) { showToast('Нет данных для экспорта', 'error'); return; }

  const fields = getActiveExportFields();
  const today = new Date().toLocaleDateString('ru-RU');
  const user = currentUser ? currentUser.fullName : '';
  const userPosition = currentUser ? (currentUser.position || '') : '';

    const headerCells = fields
    .map(f => {
      const def = getExportField(f);
      return `<th>${esc(def ? def.label : f)}</th>`;
    })
    .join('');

  const rows = data.map(p => {
    const cells = fields.map(f => {
      const def = getExportField(f);
      const val = def ? def.get(p) : '';
      if (f === 'status') {
        const st = calcStatus(p);
        return `<td><span class="status-${st}">${esc(val)}</span></td>`;
      }
      if (f === 'model' && p.manufacturer) {
        return `<td>${esc(p.model)}<br><small>${esc(p.manufacturer)}</small></td>`;
      }
      if (f === 'responsible' && p.location) {
        return `<td>${esc(p.responsible || '—')}<br><small>${esc(p.location)}</small></td>`;
      }
         if (f === 'nextCalibration') {
        const st = calcStatus(p);
        if (st === 'sent') {
          return `<td>На поверке<br><small>с ${formatDate(p.sent_for_calibration)}</small></td>`;
        }
        if (st === 'unknown') {
          return `<td>—<br><small>дата не задана</small></td>`;
        }
        const dl = daysLeft(p);
        const dlText = st === 'inactive' ? '' : (dl < 0 ? 'просрочка ' + Math.abs(dl) + ' дн.' : dl + ' дн.');
        return `<td>${esc(val)}${dlText ? '<br><small>' + dlText + '</small>' : ''}</td>`;
      }
      return `<td>${esc(val)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

    const win = window.open('', '_blank');
  if (!win) {
    showToast('Разрешите всплывающие окна для экспорта в PDF', 'error');
    return;
  }
  win.document.write(`
    <!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
    <title>Реестр пипеток — ${today}</title>
    <style>
            @page { size: A4 landscape; margin: 12mm 8mm; }
      * { box-sizing: border-box; }

      body {
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 9pt;
        color: #1a1a2e;
        margin: 0;
      }

      h1 { font-size: 14pt; margin: 0 0 4px; color: #1e293b; }

      .meta {
        font-size: 9pt;
        color: #64748b;
        margin-bottom: 10px;
        border-bottom: 1px solid #cbd5e1;
        padding-bottom: 6px;
      }
      .meta b { color: #1e293b; }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 8pt;
        border: 1.5px solid #1e293b;
      }

      th {
        background: #1e293b;
        color: #fff;
        padding: 6px 5px;
        text-align: left;
        font-size: 7.5pt;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        border: 1px solid #1e293b;
        vertical-align: middle;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      td {
        padding: 5px 5px;
        border: 0.5px solid #94a3b8;
        vertical-align: top;
        word-wrap: break-word;
      }

      tbody tr:nth-child(even) td {
        background: #f8fafc;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      tbody td:first-child,
      thead th:first-child {
        border-left: 1.5px solid #1e293b;
      }
      tbody td:last-child,
      thead th:last-child {
        border-right: 1.5px solid #1e293b;
      }

      small {
        color: #94a3b8;
        font-size: 7pt;
        line-height: 1.2;
        display: block;
      }

      .status-ok       { color: #16a34a; font-weight: 600; }
      .status-warn     { color: #ca8a04; font-weight: 600; }
      .status-danger   { color: #dc2626; font-weight: 700; }
      .status-fail     { color: #991b1b; font-weight: 700; }
      .status-inactive { color: #94a3b8; }
      .status-sent     { color: #0ea5e9; font-weight: 600; }
      .status-wip      { color: #ca8a04; font-weight: 600; }

      .footer {
        margin-top: 12px;
        font-size: 8pt;
        color: #000;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid #cbd5e1;
        padding-top: 6px;
      }

      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
    </style></head><body>
    
       <h1>Реестр оборудования — КГБУЗ «Краевая клиническая больница», КДЛ</h1>
      <div class="meta">Дата: <b>${today}</b> · Записей: <b>${data.length}</b></div>
      <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
       <div class="footer">
        <div>Документ сформировал: <b>${esc(userPosition)}, ${esc(user)}</b></div>
        <div>Подпись: _______________</div>
      </div>
    </body></html>`);
  win.document.close();
  showToast(`PDF: ${fields.length} полей, ${data.length} записей`, 'success');
}

// ============================================================
// МЕНЮ ЭКСПОРТА
// ============================================================
function toggleExportMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('export-menu');
  menu.classList.toggle('show');
}

function closeExportMenu() {
  const menu = document.getElementById('export-menu');
  if (menu) menu.classList.remove('show');
}

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('export-dropdown');
  if (dropdown && !dropdown.contains(e.target)) {
    closeExportMenu();
  }
});

// ============================================================
// НАПОМИНАНИЯ
// ============================================================
// 🆕 Состояние напоминаний в текущей сессии
let _reminderScheduled = false;   // таймер уже поставлен
let _reminderDismissed = false;   // пользователь нажал «Позже» — не показывать до перезахода

function checkReminder() {
  if (!currentUser) return;

  // Уже запланировано или пользователь отложил
  if (_reminderScheduled || _reminderDismissed) return;

  // Модалка уже открыта — не дублировать
  const overlay = document.getElementById('reminder-overlay');
  if (overlay && overlay.classList.contains('active')) return;

  const key = 'pipette_last_reminder_' + currentUser.id;
  const lastShown = localStorage.getItem(key);
  const today = todayStr();
  if (lastShown === today) return;   // уже нажимали «Понятно» сегодня

  const dangerList = pipettes.filter(p => ['danger', 'fail'].includes(calcStatus(p)));
  const warnList = pipettes.filter(p => calcStatus(p) === 'warn');
  if (dangerList.length === 0 && warnList.length === 0) return;

  _reminderScheduled = true;
  setTimeout(() => showReminder(dangerList, warnList), 600);
}

function showReminder(dangerList, warnList) {
  const icon = document.getElementById('reminder-icon');
  const title = document.getElementById('reminder-title');
  const subtitle = document.getElementById('reminder-subtitle');
  const body = document.getElementById('reminder-body');

    if (dangerList.length > 0) {
    icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    title.textContent = 'Просрочены поверки!';
    title.style.color = '#dc2626';
    subtitle.textContent = `${dangerList.length} ${dangerList.length === 1 ? 'пипетка требует' : 'пипеток требуют'} срочной поверки`;
  } else {
    icon.innerHTML = '<i class="fa-solid fa-bell"></i>';
    title.textContent = 'Приближаются сроки поверки';
    title.style.color = '#eab308';
    subtitle.textContent = `${warnList.length} ${warnList.length === 1 ? 'пипетка подходит' : 'пипеток подходят'} к сроку поверки в течение ${settings.warnDays} дн.`;
  }

  let html = '';
  if (dangerList.length > 0) {
    html += `<div class="reminder-section"><div class="reminder-section-title danger"><i class="fa-solid fa-triangle-exclamation"></i> Просрочены (${dangerList.length})</div><ul class="reminder-list">`;
    dangerList.sort((a, b) => daysLeft(a) - daysLeft(b)).forEach(p => {
  const dl = daysLeft(p);
  const isFail = calcStatus(p) === 'fail';
  html += `<li class="danger">
    <div class="pip-info"><div class="pip-id">${esc(p.id)} — ${esc(p.model)}</div>
    <div class="pip-detail">${esc(p.department || 'без отдела')} · ${esc(p.responsible || '—')}</div></div>
    <div class="pip-days">${isFail ? 'брак' : 'просрочка ' + Math.abs(dl) + ' дн.'}</div>
  </li>`;
});
    html += '</ul></div>';
  }
  if (warnList.length > 0) {
    html += `<div class="reminder-section"><div class="reminder-section-title warn"><i class="fa-solid fa-triangle-exclamation"></i> Скоро поверка (${warnList.length})</div><ul class="reminder-list">`;
    warnList.sort((a, b) => daysLeft(a) - daysLeft(b)).forEach(p => {
      const dl = daysLeft(p);
      html += `<li class="warn">
        <div class="pip-info"><div class="pip-id">${esc(p.id)} — ${esc(p.model)}</div>
        <div class="pip-detail">${esc(p.department || 'без отдела')} · ${esc(p.responsible || '—')}</div></div>
        <div class="pip-days">${dl} дн.</div>
      </li>`;
    });
    html += '</ul></div>';
  }
  body.innerHTML = html;
  document.getElementById('reminder-overlay').classList.add('active');
}

function closeReminder(confirmed) {
  document.getElementById('reminder-overlay').classList.remove('active');

  // Сбрасываем флаг «таймер поставлен», чтобы при новом входе
  // в этом же сеансе (impersonate → вернуться) можно было снова показать
  _reminderScheduled = false;

  if (!currentUser) return;

  if (confirmed) {
    // «Понятно» — не показывать до завтра, даже после F5
    localStorage.setItem('pipette_last_reminder_' + currentUser.id, todayStr());
  } else {
    // «Позже» — не показывать в этой сессии.
    // После выхода и повторного входа — снова покажется.
    _reminderDismissed = true;
  }
}

// ============================================================
// UI АВТОРИЗАЦИИ
// ============================================================
function renderAuthUI() {
  const authContainer = document.getElementById('auth-container');
  const mainContent = document.getElementById('main-content');

  if (isAuthenticated()) {
    authContainer.classList.add('hidden');
    mainContent.classList.add('visible');

    document.getElementById('user-fullname').textContent = currentUser.fullName;
    let posText = currentUser.position +
      (currentUser.role === 'admin' ? ' (админ)'
        : currentUser.role === 'senior_lab' ? ' (ст. лаборант)' : '');
    if (currentUser.isActing) {
      posText += currentUser.actingForName
        ? ` · и.о. за ${currentUser.actingForName}`
        : ' · и.о.';
    }
    if (currentUser.department) posText += ' · ' + currentUser.department;
    document.getElementById('user-position').textContent = posText;

    const btnStop = document.getElementById('btn-impersonate-stop');
    if (btnStop) {
      btnStop.style.display = isImpersonating() ? 'inline-flex' : 'none';
    }

        const admin           = isAdmin();
    const canAdd          = canAddPipette();
    const canImportData   = canImport();
    const canExportData   = canExport();
    const canSettings     = canManageSettings();
    const canScan         = canScanBarcode();
    const canPrint        = canPrintLabels();

    document.querySelectorAll('.btn-add-pipette').forEach(el =>
      el.style.display = canAdd ? 'inline-flex' : 'none');
    document.querySelectorAll('.btn-import').forEach(el =>
      el.style.display = canImportData ? 'inline-flex' : 'none');
    document.querySelectorAll('.btn-export').forEach(el =>
      el.style.display = canExportData ? 'inline-flex' : 'none');
    document.querySelectorAll('.btn-settings').forEach(el =>
      el.style.display = canSettings ? 'inline-flex' : 'none');
    document.querySelectorAll('.btn-scan-barcode').forEach(el =>
      el.style.display = canScan ? 'inline-flex' : 'none');
    document.querySelectorAll('.btn-print-labels').forEach(el =>
      el.style.display = canPrint ? 'inline-flex' : 'none');

    const hasAnyRowAction = canEditPipette() || canDeletePipette() || canQuickCal() || canViewHistory();
    const actionsHeader = document.getElementById('actions-header');
    if (actionsHeader) actionsHeader.style.display = hasAnyRowAction ? '' : 'none';

    document.body.classList.toggle('can-manage', canAdd || canEditPipette() || canDeletePipette());
    document.body.classList.toggle('can-import', canImportData);
    document.body.classList.toggle('can-export', canExportData);
    document.body.classList.toggle('is-admin', admin);
    if (currentUser.mustChangePassword) {
      
      // Пока не сменит пароль — данные не грузим, показываем модалку
      openChangePasswordModal(true);
    } else {
      closeChangePasswordModal();

      if (_dataLoadedForUser !== currentUser.id) {
        _dataLoadedForUser = currentUser.id;
        loadPipetteData();
      }
    }
    
    } else {
    closeChangePasswordModal();
    authContainer.classList.remove('hidden');
    mainContent.classList.remove('visible');
    document.body.classList.remove('can-manage', 'can-import', 'can-export', 'is-admin');
    const btnStop = document.getElementById('btn-impersonate-stop');
    if (btnStop) btnStop.style.display = 'none';

    // 🆕 Сбрасываем состояние кнопки входа (после логаута)
    const loginBtn = document.getElementById('login-btn');
    const loginBtnIcon = document.getElementById('login-btn-icon');
    const loginBtnText = document.getElementById('login-btn-text');
    if (loginBtn) loginBtn.disabled = false;
    if (loginBtnIcon) loginBtnIcon.className = 'fa-solid fa-right-to-bracket';
    if (loginBtnText) loginBtnText.textContent = 'Войти';
    const uInput = document.getElementById('login-username');
    const pInput = document.getElementById('login-password');
    if (uInput) uInput.disabled = false;
    if (pInput) { pInput.disabled = false; pInput.value = ''; }

    _dataLoadedForUser = null;
  }
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
let _searchTimeout = null;
document.getElementById('search').addEventListener('input', () => {
  clearTimeout(_searchTimeout);
  _searchTimeout = setTimeout(() => {
    const savedScroll = window.scrollY;                 // 🆕 запомнили позицию
    document.getElementById('filter-panel').classList.remove('show');  // 🆕 закрыли панель фильтра
    currentPage = 1;
    render();
    updateSelectAllCheckbox();
    updateBulkCalButton();
    window.scrollTo(0, savedScroll);                     // 🆕 вернули позицию
  }, 150);
});

document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.getElementById('quick-cal-modal').addEventListener('click', e => { if (e.target.id === 'quick-cal-modal') closeQuickCalModal(); });
document.getElementById('history-modal').addEventListener('click', e => { if (e.target.id === 'history-modal') closeHistoryModal(); });
document.getElementById('bulk-send-modal').addEventListener('click', e => { if (e.target.id === 'bulk-send-modal') closeBulkSendModal(); });
document.getElementById('bulk-return-modal').addEventListener('click', e => { if (e.target.id === 'bulk-return-modal') closeBulkReturnModal(); });
document.getElementById('change-password-modal').addEventListener('click', e => {

  if (e.target.id === 'change-password-modal') {
    const canClose = !currentUser || !currentUser.mustChangePassword || isImpersonating();
    if (canClose) {
      closeChangePasswordModal();
    }
  }
});
document.getElementById('history-export-modal').addEventListener('click', e => {
  if (e.target.id === 'history-export-modal') closeHistoryExportModal();
});
document.getElementById('temp-password-modal').addEventListener('click', e => {
  if (e.target.id === 'temp-password-modal') closeTempPasswordModal();
});

const session = getSession();
if (session) {
  authToken = session.token;
  currentUser = session.user;
  renderAuthUI();
  refreshCurrentUser();
}
const lastLogin = localStorage.getItem('pipette_last_login');
if (lastLogin) {
  const u = document.getElementById('login-username');
  if (u) u.value = lastLogin;
}

// ============================================================
// СВОРАЧИВАНИЕ ШАПКИ
// ============================================================
function updateHeaderMiniStats() {
  const el = document.getElementById('header-mini-stats');
  if (!el) return;
  const ok = document.getElementById('stat-ok')?.textContent || '0';
  const total = document.getElementById('stat-total')?.textContent || '0';
  el.innerHTML = `<b>${ok}</b>/${total} в норме`;
}

function toggleHeaderCollapse() {
  const header = document.getElementById('main-header');
  if (!header) return;

  const collapsed = !header.classList.contains('collapsed');
  header.classList.toggle('collapsed', collapsed);

  try { localStorage.setItem('pipette_header_collapsed', collapsed ? '1' : '0'); } catch (e) {}

  const btn = document.getElementById('header-collapse-btn');
  if (btn) {
    const label = btn.querySelector('.collapse-label');
    if (label) label.textContent = collapsed ? '▼ Развернуть' : '▲ Свернуть';
    btn.title = collapsed ? 'Развернуть шапку' : 'Свернуть шапку';
  }
}

// Восстановление состояния при загрузке
(function initHeaderCollapse() {
  try {
    const saved = localStorage.getItem('pipette_header_collapsed');
    if (saved === '1') {
      const header = document.getElementById('main-header');
      if (header) header.classList.add('collapsed');
      const btn = document.getElementById('header-collapse-btn');
      if (btn) {
        const label = btn.querySelector('.collapse-label');
        if (label) label.textContent = '▼ Развернуть';
      }
    }
  } catch (e) {}
})();

// Обновляем mini-stats после каждого рендера
// (обёртка — оригинальный render останется работать)
(function wrapRenderForMiniStats() {
  if (typeof render !== 'function') return;
  const origRender = window.render;
  window.render = function() {
    const result = origRender.apply(this, arguments);
    try { updateHeaderMiniStats(); } catch (e) {}
    return result;
  };
})();

// ============================================================
// ИМПОРТ ДАННЫХ
// ============================================================
async function openImportModal() {
  await refreshCurrentUser();
  if (!canImport()) { showToast('Нет прав на импорт', 'error'); return; }
  document.getElementById('import-modal').classList.add('active');
}

function closeImportModal() {
  document.getElementById('import-modal').classList.remove('active');
  document.getElementById('import-file').value = '';

  // Сбросить прогресс, чтобы при повторном открытии не мигал старый текст
  const progress = document.getElementById('import-progress');
  if (progress) {
    progress.style.display = 'none';
    progress.textContent = '⏳ Загрузка…';
  }
}

async function handleImport() {
  await refreshCurrentUser();
  if (!canImport()) { showToast('Нет прав на импорт', 'error'); return; }

  const fileInput = document.getElementById('import-file');
  const file = fileInput.files[0];
  if (!file) { showToast('Выберите файл', 'error'); return; }
    
  // 🛡️ Старый формат .xls (Excel 97-2003) не поддерживается — ExcelJS
  // читает только .xlsx (Office Open XML). Показываем понятную подсказку.
  if (file.name.toLowerCase().endsWith('.xls')) {
    showToast(
      'Формат .xls не поддерживается. Пересохраните файл как .xlsx ' +
      '(Файл → Сохранить как → Книга Excel (*.xlsx))',
      'error'
    );
    fileInput.value = '';
    return;
  }
  
  const progress = document.getElementById('import-progress');
  if (progress) {
    progress.style.display = 'block';
    progress.textContent = '⏳ Загрузка и обработка файла…';
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1] || dataUrl;
      const res = await apiRequest('/import', 'POST', { file: base64, filename: file.name });

      let msg = `Импортировано: ${res.added}`;
      if (res.skipped > 0) msg += `, пропущено: ${res.skipped}`;
      if (res.errors > 0) msg += `, ошибок: ${res.errors}`;
      showToast(msg, res.added > 0 ? 'success' : 'error');

      if (res.skippedDetails && res.skippedDetails.length > 0) {
        console.log('⚠️ Пропущено:', res.skippedDetails);
      }
      if (res.errorDetails && res.errorDetails.length > 0) {
        console.log('❌ Ошибки:', res.errorDetails);
      }

      closeImportModal();
      currentPage = 1;
      await loadPipetteData();
    } catch (err) {
      if (progress) progress.textContent = '❌ ' + (err.message || 'Ошибка импорта');
      showToast('Ошибка импорта: ' + err.message, 'error');
    }
  };
  reader.readAsDataURL(file);
}
// ============================================================
// НАСТРОЙКИ
// ============================================================
async function openSettingsModal() {
  await refreshCurrentUser();
  if (!isAdmin()) { showToast('Доступно только администратору', 'error'); return; }

  // Сброс к списку разделов
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

  // 🆕 Фильтр пунктов по правам
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

  // 🆕 Проверка прав на конкретный раздел
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
    else if (id === 'general')     await renderGeneralSettings();
    else if (id === 'log')         await renderLogSettings();
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
}

document.getElementById('settings-modal').addEventListener('click', e => {
  if (e.target.id === 'settings-modal') closeSettingsModal();
});

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
        <td><div class="order-btns">
          <button class="btn btn-secondary btn-sm" onclick="moveFieldSetting(${i},-1)">▲</button>
          <button class="btn btn-secondary btn-sm" onclick="moveFieldSetting(${i},1)">▼</button>
        </div></td>
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

function addFieldSetting() {
  const id = prompt('ID нового поля (латиницей, без пробелов):');
  if (!id || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(id)) { showToast('Некорректный ID', 'error'); return; }
  if (_cachedFields.some(f => f.id === id)) { showToast('Поле с таким ID уже существует', 'error'); return; }
  _cachedFields.push({ id, label: id, type: 'text', required: false, enabled: true, options: [], default: '', order: _cachedFields.length + 1 });
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
      // Настроек вида нет — показываем все активные
      myPrefs.visibleFields = [...activeFieldIds];
    } else {
      // Настройки есть — добавляем все новые активные поля, которых там не было
      const visibleSet = new Set(myPrefs.visibleFields);
      for (const id of activeFieldIds) {
        if (!visibleSet.has(id)) {
          myPrefs.visibleFields.push(id);
        }
      }
      // Убираем из visibleFields те, что больше не активны
      const activeSet = new Set(activeFieldIds);
      myPrefs.visibleFields = myPrefs.visibleFields.filter(id => activeSet.has(id));
    }

    showToast('Поля сохранены', 'success');
    closeSettingsModal();
    await loadPipetteData();
  } catch (e) {
    // 🆕 Поля с данными → показать предупреждение и спросить подтверждение
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

      // Повторный PUT с флагом
      try {
        await apiRequest('/settings/fields?confirmDelete=true', 'PUT', _cachedFields);
        _cachedFields = await apiRequest('/settings/fields');

        // 🆕 Та же синхронизация prefs после удаления
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
  _cachedDepartmentsFull[idx].name = trimmed;

  // Проверяем дубли
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

  _cachedDepartmentsFull.push({ name, enabled: true });
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
  // Чистим и дедуплицируем
  const cleaned = [];
  const seen = new Set();

  for (const d of _cachedDepartmentsFull) {
    const name = (d.name || '').trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    cleaned.push({ name, enabled: d.enabled !== false });
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
            <button class="btn btn-secondary btn-sm" onclick="moveFilter(${i},-1)">▲</button>
            <button class="btn btn-secondary btn-sm" onclick="moveFilter(${i},1)">▼</button>
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

function addFilter() {
  const id = prompt('ID нового фильтра (латиницей):');
  if (!id || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(id)) { showToast('Некорректный ID', 'error'); return; }
  if (_cachedFilters.some(f => f.id === id)) { showToast('Уже есть', 'error'); return; }
  _cachedFilters.push({
    id,
    label: id,
    type: 'text',
    fieldId: '',
    enabled: true,
    optionsSource: '',
    order: _cachedFilters.length + 1
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

    // 🆕 Если панель открыта — перерисовать сразу, чтобы удалённые фильтры
    // исчезли без закрытия/открытия
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

// алиас для обратной совместимости
const EXPORT_FIELDS = SYSTEM_EXPORT_FIELDS;

async function renderExportSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    
    // 🆕 Подтягиваем актуальные поля
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

function resetUserSettingForm() {
  ['usr-edit-id', 'usr-login', 'usr-fullname', 'usr-position', 'usr-department'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('usr-role').value = 'user';
  document.getElementById('user-form-title').innerHTML = '<i class="fa-solid fa-plus"></i> Добавить пользователя';
  const onlyOwnCb = document.getElementById('usr-only-own-dept');
  if (onlyOwnCb) onlyOwnCb.checked = false;
  const isActingCb = document.getElementById('usr-is-acting');
  if (isActingCb) {
    isActingCb.checked = false;
    onActingChange(false);
  }
  const actingForSel = document.getElementById('usr-acting-for');
  if (actingForSel) actingForSel.value = '';
  document.querySelectorAll('#usr-permissions input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
    cb.disabled = false;
  });
}

async function onActingChange(checked) {
  const wrap = document.getElementById('usr-acting-for-wrap');
  const sel  = document.getElementById('usr-acting-for');
  if (!wrap || !sel) return;

  wrap.style.display = checked ? 'block' : 'none';

  if (!checked) {
    sel.value = '';
    return;
  }

  if (sel.dataset.loaded !== '1') {
    try {
      const users = await apiRequest('/users/acting-targets');
      sel.innerHTML = '<option value="">— выберите —</option>' +
        users.map(u =>
          `<option value="${esc(u.id)}">${esc(u.fullName)} — ${esc(u.department || 'без отдела')}</option>`
        ).join('');
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
    document.getElementById('usr-fullname').value = u.fullName || u.full_name;
    document.getElementById('usr-position').value = u.position;
        // 🛡️ Отдел: безопасная установка с защитой от «битого» значения
    const deptSel = document.getElementById('usr-department');
    // Чистим «битые» опции, оставшиеся от предыдущего редактирования
    Array.from(deptSel.options).forEach(o => {
      if (o.dataset.broken === '1') o.remove();
    });
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

  const isActingCb = document.getElementById('usr-is-acting');
    if (isActingCb) {
      isActingCb.checked = !!u.isActing;
      await onActingChange(isActingCb.checked);
      const sel = document.getElementById('usr-acting-for');
      if (sel) sel.value = u.actingForId || '';
    }

    const extra = u.extraPermissions || [];

    document.querySelectorAll('#usr-permissions input[type="checkbox"]').forEach(cb => {
      if (u.role === 'admin') {
        cb.checked = true;
        cb.disabled = true;
      } else {
        cb.disabled = false;
        cb.checked = extra.includes(cb.value);
      }
    });

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
  
  const onlyOwnCb = document.getElementById('usr-only-own-dept');
  const onlyOwnDepartment = onlyOwnCb ? onlyOwnCb.checked : false;
  const extraPermissions = [];
  const isActingCb   = document.getElementById('usr-is-acting');
  const isActing     = isActingCb ? isActingCb.checked : false;
  const actingForSel = document.getElementById('usr-acting-for');
  const actingForId  = isActing && actingForSel ? actingForSel.value.trim() : null;

  if (isActing && !actingForId) {
    showToast('Для и.о. нужно указать, за кого он исполняет', 'error');
    return;
  }
  if (role !== 'admin') {
    document.querySelectorAll('#usr-permissions input[type="checkbox"]:checked').forEach(cb => {
      extraPermissions.push(cb.value);
    });
  }

  try {
  const payload = { login, fullName, position, department, role,                     
                   onlyOwnDepartment, extraPermissions, isActing, actingForId };

    if (id) {
      await apiRequest('/users/' + id, 'PUT', payload);
      showToast('Пользователь обновлён', 'success');
    } else {
      const res = await apiRequest('/users', 'POST', payload);
      showToast('Пользователь создан', 'success');
      // Показать разовый пароль (alert + копия в буфер)
      setTimeout(() => {
        showTempPasswordModal(res.login, fullName, res.tempPassword);
      }, 300);
    }

       if (id === currentUser.id) {
      const me = (await apiRequest('/users')).find(x => x.id === id);
      if (me) {
        currentUser.fullName = me.fullName || me.full_name;
        currentUser.position = me.position;
        currentUser.department = me.department;
        currentUser.role = me.role;
        currentUser.onlyOwnDepartment = !!me.onlyOwnDepartment;
        currentUser.extraPermissions = me.extraPermissions || [];

        const origUser  = getOriginalUser();
        const origToken = getOriginalToken();
        if (origUser && origToken) {
          setSession(currentUser, authToken, origUser, origToken);
        } else {
          setSession(currentUser, authToken);
        }
        renderAuthUI();
        render();   // 🆕 перерисовать таблицу — обновятся кнопки ⋮ и столбец «Действия»
      }
    }
 
    resetUserSettingForm();
    renderUsersSettings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteUserSetting(id) {
    const ok = await showConfirm(
    'Удалить пользователя? Действие необратимо.',
    { icon: '👤', title: 'Удаление пользователя', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;
  try {
    await apiRequest('/users/' + id, 'DELETE');
    showToast('Удалён', 'success');
    renderUsersSettings();
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// ВКЛАДКА: СИСТЕМА
// ============================================================
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
            <label>Копий</label>
            <input type="number" id="bc-default-copies" value="1" min="1" max="50">
          </div>
          <div class="bc-cell">
            <label>Порт агента</label>
            <input type="number" id="bc-agent-port" value="9200">
          </div>
          <div class="bc-cell">
            <label>Макс. длина</label>
            <input type="number" id="bc-max-length" value="128" min="8" max="255">
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
            ℹ️ На этикетке 58×40 мм влезает <b>3–4 поля</b>
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

// ============================================================
// МАССОВАЯ ОТПРАВКА НА ПОВЕРКУ
// ============================================================
async function openBulkSendModal() {
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }

   // 🆕 Включаем все выбранные, не только видимые
  const selected = [...selectedPipettes].filter(id =>
    pipettes.some(p => p.id === id)
  );
    const toSend = selected.filter(id => {
    const p = pipettes.find(x => x.id === id);
    return p && !p.sent_for_calibration && isExternalCalibration(p.equipment_type);
  });

  if (toSend.length === 0) {
    showToast('Не выбрано ни одной единицы для внешней поверки.', 'error');
    return;
  }
  
  _bulkSendIds = [...toSend];

  document.getElementById('bulk-send-count').textContent = toSend.length;

  const listHtml = toSend.map(id => {
    const p = pipettes.find(x => x.id === id);
    if (!p) return '';
    return `<div style="padding:2px 0;">
      <strong>${esc(p.id)}</strong> — ${esc(p.model)} 
      <span style="color:#94a3b8;">(${esc(p.department || 'без отдела')})</span>
    </div>`;
  }).join('');
  document.getElementById('bulk-send-list').innerHTML = listHtml;

   document.getElementById('bulk-send-date').value = todayStr();
  document.getElementById('bulk-send-note').value = '';

  // 🆕 Открываем модалку СРАЗУ — не ждём загрузки замен
  document.getElementById('bulk-send-modal').classList.add('active');

  // Замены грузим фоном с параллелизмом
  loadReplacementOptions(toSend);
}

// 🆕 Параллельная загрузка замен с ограничением конкурентности
// 🆕 Инкрементальный рендер — блоки дописываются, не пересоздаются
async function loadReplacementOptions(ids) {
  const container = document.getElementById('replacement-options');
  if (!container) return;

  container.innerHTML = '<p id="repl-placeholder" style="color:#94a3b8;font-size:.85rem;">Загрузка складских…</p>';

  // ── Собираем задачи ──
  const tasks = [];
  for (const id of ids) {
    const p = pipettes.find(x => x.id === id);
    if (!p) continue;

    tasks.push(async () => {
      const url = `/pipettes/available-for-replacement?type=${encodeURIComponent(p.equipment_type)}&department=${encodeURIComponent(p.department || '')}&exclude=${encodeURIComponent(id)}`;
      const options = await apiRequest(url);
      return { id, p, options };
    });
  }

  // ── Ограничение конкурентности (batch по 5) ──
  const CONCURRENCY = 5;
  let rendered = 0;

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(t => t().catch(e => {
        console.warn('Ошибка загрузки замен:', e.message);
        return null;
      }))
    );

    // 🆕 Дописываем блоки, не пересоздавая контейнер
    const newHtml = batchResults
      .filter(r => r && r.options && r.options.length > 0)
      .map(r => buildReplacementBlock(r.id, r.p, r.options))
      .join('');

    if (newHtml) {
      // Первый блок — убираем плейсхолдер
      if (rendered === 0) {
        const ph = document.getElementById('repl-placeholder');
        if (ph) ph.remove();
      }
      container.insertAdjacentHTML('beforeend', newHtml);
      rendered++;
    }
  }

  // ── Финальный статус ──
  if (rendered === 0) {
    container.innerHTML = '<p style="color:#94a3b8;font-size:.85rem;">Нет доступных складских единиц того же типа.</p>';
  } else {
    // 🆕 Убираем возможный оставшийся плейсхолдер (если он не удалился)
    const ph = document.getElementById('repl-placeholder');
    if (ph) ph.remove();
  }
}

// 🆕 Вынесли рендер одного блока — чище и переиспользуемо
function buildReplacementBlock(id, p, options) {
  const safeName = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  let html = `<div style="margin-bottom:12px;padding:10px;background:#f8fafc;border-radius:8px;">
    <div style="font-weight:600;font-size:.85rem;color:#475569;margin-bottom:6px;">
      ${esc(id)} — ${esc(p.model)} (${esc(p.department || 'без отдела')})
    </div>
    <div style="font-size:.78rem;color:#64748b;margin-bottom:6px;">Складские того же типа:</div>
    <div style="display:flex;flex-direction:column;gap:4px;">`;

  for (const opt of options) {
    html += `
      <label style="display:flex;align-items:center;gap:8px;padding:6px;background:#fff;border-radius:6px;cursor:pointer;font-size:.82rem;">
        <input type="radio" name="repl-${safeName}" value="${esc(opt.id)}" data-for="${esc(id)}">
        <span><strong>${esc(opt.id)}</strong> — ${esc(opt.model)}
        ${opt.manufacturer ? `<span style="color:#94a3b8;">(${esc(opt.manufacturer)})</span>` : ''}
        ${opt.last_calibration ? `<span style="color:#94a3b8;margin-left:8px;">поверка: ${formatDate(opt.last_calibration)}</span>` : ''}
        </span>
      </label>`;
  }

  html += `
      <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;font-size:.82rem;color:#94a3b8;">
        <input type="radio" name="repl-${safeName}" value="" data-for="${esc(id)}" checked>
        <span>Без замены</span>
      </label>
    </div>
  </div>`;

  return html;
}

function closeBulkSendModal() {
  document.getElementById('bulk-send-modal').classList.remove('active');
  _bulkSendIds = [];
}

async function saveBulkSend(e) {
  e.preventDefault();
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
        
  const toSend = _bulkSendIds.filter(id => {
  const p = pipettes.find(x => x.id === id);
  return p && !p.sent_for_calibration && isExternalCalibration(p.equipment_type);
  });

  if (toSend.length === 0) {
    showToast('Не выбрано ни одной единицы для внешней поверки', 'error');
    return;
  }

  const sentDate = document.getElementById('bulk-send-date').value;
  const note = document.getElementById('bulk-send-note').value.trim();

  if (!sentDate) { showToast('Заполните поле «Дата отправки»', 'error'); return; }
  if (sentDate > todayStr()) {
    showToast('Дата не может быть в будущем', 'error');
    return;
  }

   if (toSend.length > 1) {
    const ok = await showConfirm(
      `Отправить на поверку ${toSend.length} единиц оборудования?`,
      { icon: '📦', title: 'Отправка на поверку', okText: 'Отправить', okClass: 'btn-warning' }
    );
    if (!ok) return;
  }

    // 🛡️ Собираем карту замен
  const replacements = {};
  document.querySelectorAll('#replacement-options input[type="radio"]:checked').forEach(rb => {
    const forId = rb.dataset.for;
    if (rb.value) replacements[forId] = rb.value;
  });

  try {
    const res = await apiRequest('/pipettes/bulk-send', 'POST', {
      ids: toSend, sentDate, note, replacements
    });

    let msg = `Отправлено на поверку: ${res.successful}`;
    if (res.skipped > 0) msg += `. Пропущено: ${res.skipped}`;
    if (res.skippedReplacements && res.skippedReplacements.length > 0) {
      msg += `. Замены не применены: ${res.skippedReplacements.length}`;
      console.warn('⚠️ Пропущенные замены:', res.skippedReplacements);
    }
    showToast(msg, res.successful > 0 ? 'success' : 'error');

    clearSelection();
    closeBulkSendModal();
    filterState = {};
    _filterRendered = false;
    currentPage = 1;
    await loadPipetteData();
  } catch (error) {
    showToast(error.message || 'Ошибка отправки', 'error');
  }
}

// ============================================================
// ПЕЧАТЬ АКТА ОТПРАВКИ
// ============================================================
async function printSendAct() {
  await refreshCurrentUser();  
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  const sendItems = _bulkSendIds.filter(id => {
  const p = pipettes.find(x => x.id === id);
  return p && !p.sent_for_calibration && isExternalCalibration(p.equipment_type);
  });

  if (sendItems.length === 0) {
    showToast('Нет единиц для печати', 'error');
    return;
  }

  const sentDate = document.getElementById('bulk-send-date').value
    || todayStr();
  const note = (document.getElementById('bulk-send-note').value || '').trim();
  const today = new Date().toLocaleDateString('ru-RU');
  const user = currentUser ? currentUser.fullName : '';
  const userPosition = currentUser ? (currentUser.position || '') : '';

  const rows = sendItems.map((id, index) => {
    const p = pipettes.find(x => x.id === id);
    if (!p) return '';
    return `
      <tr>
        <td style="text-align:center;">${index + 1}</td>
        <td><strong>${esc(p.id)}</strong></td>
        <td>${esc(p.model)}${p.manufacturer ? '<br><small>' + esc(p.manufacturer) + '</small>' : ''}</td>
        <td>${esc(p.serial || '—')}</td>
        <td>${p.volume ? esc(p.volume) + ' мкл' : '—'}</td>
        <td>${esc(p.department || '—')}</td>
        <td>${esc(p.responsible || '—')}</td>
        <td style="width:50px;"></td>
      </tr>
    `;
  }).join('');

const win = window.open('', '_blank');
  if (!win) {
    showToast('Разрешите всплывающие окна для печати акта', 'error');
    return;
  }
  win.document.write(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <title>Акт отправки на поверку — ${today}</title>
      <style>
        @page { size: A4 portrait; margin: 15mm 12mm; }
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1a1a2e; line-height: 1.5; }
        h1 { font-size: 15pt; margin: 0 0 6px; text-align: center; }
        .subtitle { font-size: 10pt; text-align: center; color: #64748b; margin-bottom: 20px; }
        .meta { margin-bottom: 15px; padding: 10px 12px; background: #f8fafc; border-radius: 6px; font-size: 9.5pt; }
        .meta div { margin-bottom: 3px; }
        .meta b { color: #1e293b; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 10px; }
        th { background: #1e293b; color: #fff; padding: 8px 6px; text-align: left; font-size: 8.5pt;
             text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        td { padding: 8px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        tr:nth-child(even) td { background: #f8fafc; }
        small { color: #94a3b8; font-size: 8pt; }
        .note-block { margin-top: 20px; padding: 10px 12px; background: #fef9c3;
                      border-left: 3px solid #eab308; border-radius: 6px; font-size: 9.5pt; color: #854d0e; }
        .signatures { margin-top: 40px; display: flex; justify-content: space-between; }
        .sig-block { width: 45%; }
        .sig-line { border-bottom: 1px solid #000; height: 30px; margin-bottom: 5px; }
        .sig-label { font-size: 8.5pt; color: #64748b; text-align: center; }
        .footer { margin-top: 30px; font-size: 8pt; color: #94a3b8; text-align: center; }
      </style>
    </head>
    <body>
      <h1>АКТ ОТПРАВКИ НА ПОВЕРКУ</h1>
      <div class="subtitle">КГБУЗ Краевая клиническая больница · Клинико-диагностическая лаборатория</div>

     <div class="meta">
        <div>Дата отправки: <b>${formatDate(sentDate)}</b></div>
        <div>Количество приборов: <b>${sendItems.length}</b></div>
        <div>Организация, производящая поверку: <b>ФБУ «Красноярский ЦСМ»</b></div>
       <div>Дата печати: <b>${today}</b></div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:5%; text-align:center;">№</th>
            <th style="width:11%;">Внутр. №</th>
            <th style="width:22%;">Модель / Произв.</th>
            <th style="width:13%;">Серийный №</th>
            <th style="width:10%;">Объём</th>
            <th style="width:15%;">Отдел</th>
            <th style="width:14%;">Ответственный</th>
            <th style="width:10%;">Прим.</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      ${note ? `<div class="note-block"><b>Примечание:</b> ${esc(note)}</div>` : ''}

           <div style="margin-top:30px;font-size:9.5pt;">
        <div>Документ сформировал: <b>${esc(userPosition)}, ${esc(user)}</b></div>
        <div style="margin-top:6px;">Подпись: _______________</div>
      </div>

      <div class="signatures">
        <div class="sig-block">
          <div class="sig-line"></div>
          <div class="sig-label">Сдал (ФИО, подпись)</div>
        </div>
        <div class="sig-block">
          <div class="sig-line"></div>
          <div class="sig-label">Принял (ФИО, подпись)</div>
        </div>
      </div>
      </body>
    </html>
  `);
  win.document.close();
  showToast('Окно печати открыто', 'success');
}

// ============================================================
// МАССОВЫЙ ВОЗВРАТ С ПОВЕРКИ
// ============================================================
async function openBulkReturnModal() {
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }

    // 🆕 Включаем все выбранные, не только видимые
  const selected = [...selectedPipettes].filter(id =>
    pipettes.some(p => p.id === id)
  );
     const sentItems = selected
    .map(id => pipettes.find(x => x.id === id))
    .filter(p => p && p.sent_for_calibration && isExternalCalibration(p.equipment_type));
  if (sentItems.length === 0) {
    showToast('Не выбрано ни одной единицы со статусом «На поверке»', 'error');
    return;
  }

  _bulkReturnIds = sentItems.map(p => p.id);

  document.getElementById('bulk-return-count').textContent = sentItems.length;

  const container = document.getElementById('bulk-return-items-container');
  container.innerHTML = `
    <div style="font-weight:600;color:#475569;margin-bottom:8px;font-size:.85rem;">
      Свидетельства по оборудованию:
    </div>
    <table class="field-settings-table">
      <thead>
        <tr>
          <th style="width:35%;">ID / Модель</th>
          <th style="width:40%;">Номер свидетельства</th>
          <th style="width:25%;">Результат</th>
        </tr>
      </thead>
      <tbody>
        ${sentItems.map(p => `
          <tr>
            <td>
              <strong>${esc(p.id)}</strong><br>
              <small style="color:#94a3b8;">${esc(p.model)}</small><br>
              <small style="color:#0ea5e9;">отправлена ${formatDate(p.sent_for_calibration)}</small>
            </td>
            <td>
              <input type="text" class="bulk-return-cert-input" 
                     data-id="${esc(p.id)}" 
                     placeholder="напр. С-АБ-...">
            </td>
            <td>
              <select class="bulk-return-result-input" data-id="${esc(p.id)}">
                <option value="pass">✅ Годен</option>
                <option value="fail">❌ Брак</option>
                <option value="wip">⏳ В процессе</option>
              </select>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('bulk-return-date').value = todayStr();
  document.getElementById('bulk-return-org').value = '';
  document.getElementById('bulk-return-result').value = 'pass';
  document.getElementById('bulk-return-note').value = '';
  document.getElementById('bulk-return-cert').value = '';
  document.getElementById('bulk-return-single-cert').checked = false;
  toggleSingleCert(false);

  renderReturnReplacements(sentItems);

  document.getElementById('bulk-return-modal').classList.add('active');
}

// 🆕 Блок возврата замен
function renderReturnReplacements(sentItems) {
  const container = document.getElementById('return-replacements');
  if (!container) return;

  const withRepl = sentItems.filter(p => p.replaced_by);
  if (withRepl.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  let html = `<div style="margin:15px 0;padding:12px;background:#eff6ff;border-left:3px solid #3b82f6;border-radius:8px;font-size:.85rem;">
    <div style="font-weight:600;color:#1e40af;margin-bottom:8px;">
      <i class="fa-solid fa-arrows-rotate"></i> На время поверки было выдано со склада:
    </div>`;

  withRepl.forEach(p => {
    html += `
      <label style="display:flex;align-items:flex-start;gap:8px;padding:6px;background:#fff;border-radius:6px;margin-bottom:4px;cursor:pointer;">
        <input type="checkbox" class="return-repl-cb" value="${esc(p.id)}" checked style="margin-top:3px;">
        <span>
          <strong>${esc(p.id)}</strong> → было заменено на
          <strong>${esc(p.replaced_by)}</strong>
          <br><small style="color:#64748b;">Вернуть замену на склад (Склад, не активна)</small>
          <br><small style="color:#f59e0b;">Снятие галочки оставит замену в работе</small>
        </span>
      </label>`;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function closeBulkReturnModal() {
  document.getElementById('bulk-return-modal').classList.remove('active');
  _bulkReturnIds = [];
}

function toggleSingleCert(checked) {
  document.getElementById('bulk-return-common-cert').style.display = checked ? 'block' : 'none';

  document.querySelectorAll('.bulk-return-cert-input').forEach(inp => {
    inp.disabled = checked;
    inp.style.opacity = checked ? '0.4' : '1';
    if (checked) inp.value = '';
  });
}

function applyBulkReturnResult(result) {
  document.querySelectorAll('.bulk-return-result-input').forEach(sel => {
    sel.value = result;
  });
}

async function saveBulkReturn(e) {
  e.preventDefault();
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }

  const date = document.getElementById('bulk-return-date').value;
  const org = document.getElementById('bulk-return-org').value.trim();
  const commonResult = document.getElementById('bulk-return-result').value;
  const note = document.getElementById('bulk-return-note').value.trim();
  const singleCert = document.getElementById('bulk-return-single-cert').checked;
  const commonCert = document.getElementById('bulk-return-cert').value.trim();

  if (!date) { showToast('Заполните поле «Дата поверки»', 'error'); return; }
  if (date > todayStr()) {
    showToast('Дата не может быть в будущем', 'error');
    return;
  }
  if (singleCert && !commonCert) {
    showToast('Укажите общий номер свидетельства', 'error');
    return;
  }

  const sentIds = _bulkReturnIds.filter(id => {
  const p = pipettes.find(x => x.id === id);
  return p && p.sent_for_calibration && isExternalCalibration(p.equipment_type);
  });

  const items = sentIds.map(id => {
    const certInput = document.querySelector(`.bulk-return-cert-input[data-id="${id}"]`);
    const resultInput = document.querySelector(`.bulk-return-result-input[data-id="${id}"]`);
    return {
      id,
      cert: singleCert ? commonCert : (certInput ? certInput.value.trim() : ''),
      result: resultInput ? resultInput.value : commonResult
    };
  });

  if (!singleCert) {
    const missingCert = items.filter(it => !it.cert);
    if (missingCert.length > 0) {
      const okMissing = await showConfirm(   
        `У ${missingCert.length} пипеток не указано свидетельство. Продолжить?`,  
        { icon: '⚠️', title: 'Нет свидетельства', okText: 'Продолжить', okClass: 'btn-warning' } 
      ); 
      if (!okMissing) return;
    }
  }

   if (items.length > 1) {
    const ok = await showConfirm(
      `Применить возврат для ${items.length} единиц оборудования?`,
      { icon: '📥', title: 'Возврат с поверки', okText: 'Применить', okClass: 'btn-success' }
    );
    if (!ok) return;
  }

    const returnReplacements = [];
  document.querySelectorAll('.return-repl-cb:checked').forEach(cb => {
    returnReplacements.push(cb.value);
  });

  try {
    const res = await apiRequest('/pipettes/bulk-return', 'POST', {
      items, date, org, note, returnReplacements
    });

    let msg = res.message || `Возврат оформлен для ${items.length} единиц`;
    let toastType = 'success';
    if (res.missingReplacements && res.missingReplacements.length > 0) {
      msg += `. ⚠️ Замены не возвращены на склад: ${res.missingReplacements.length}`;
      toastType = 'error';
      console.warn('⚠️ Пропущенные замены:', res.missingReplacements);
    }
        showToast(msg, toastType);

    clearSelection();
    closeBulkReturnModal();

    filterState = {};
    currentPage = 1;

    const calFilter = _activeFilters.find(f => f.type === 'date-period');
    if (calFilter && date) {
      filterState[calFilter.id] = {
        type: 'last_calibration',
        period: 'custom',
        from: date,
        to: date
      };
    }

    _filterRendered = false;
    await loadPipetteData();

    // 🆕 Подсказка, что таблица теперь отфильтрована
    if (calFilter && date) {
      showToast(`Таблица отфильтрована по дате ${date}. Сбросьте фильтр, чтобы увидеть всё.`, 'warn');
    }

    applyFilterStateToPanel();
  } catch (error) {
    showToast(error.message || 'Ошибка сохранения', 'error');
  }
}

// ============================================================
// УПРАВЛЕНИЕ ТИПАМИ ОБОРУДОВАНИЯ
// ============================================================

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
          <button class="btn btn-secondary btn-sm" onclick="moveEquipmentType(${i}, -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn btn-secondary btn-sm" onclick="moveEquipmentType(${i}, 1)" ${i === _cachedEquipmentTypes.length - 1 ? 'disabled' : ''}>▼</button>
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

function addEquipmentType() {
  const value = prompt('Ключ типа (латиница, без пробелов, например ph_meter):');
  if (!value) return;

  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) {
    showToast('Ключ должен начинаться с буквы и содержать только латиницу, цифры и _', 'error');
    return;
  }
  if (_cachedEquipmentTypes.some(t => t.value === trimmed)) {
    showToast('Тип с таким ключом уже существует', 'error');
    return;
  }

   _cachedEquipmentTypes.push({
    value: trimmed,
    label: trimmed,
    prefix: 'EQ',
    calibrationPlace: 'internal'
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

  // Дубли value
  const values = _cachedEquipmentTypes.map(t => t.value);
  const dupValues = values.filter((v, i) => values.indexOf(v) !== i);
  if (dupValues.length > 0) problems.push(`Дубли value: ${[...new Set(dupValues)].join(', ')}`);

  // Пустые label
  const emptyLabels = _cachedEquipmentTypes.filter(t => !t.label || !t.label.trim());
  if (emptyLabels.length > 0) problems.push(`Пустой label у: ${emptyLabels.map(t => t.value).join(', ')}`);

  // Пустые prefix
  const emptyPrefixes = _cachedEquipmentTypes.filter(t => !t.prefix || !t.prefix.trim());
  if (emptyPrefixes.length > 0) problems.push(`Пустой prefix у: ${emptyPrefixes.map(t => t.value).join(', ')}`);

  // Дубли prefix
  const prefixes = _cachedEquipmentTypes.map(t => t.prefix).filter(Boolean);
  const dupPrefixes = prefixes.filter((v, i) => prefixes.indexOf(v) !== i);
  if (dupPrefixes.length > 0) problems.push(`Дубли prefix: ${[...new Set(dupPrefixes)].join(', ')}`);
  const noPlace = _cachedEquipmentTypes.filter(t => !t.calibrationPlace);
  if (noPlace.length > 0) {
    problems.push(`Не указано место поверки у: ${noPlace.map(t => t.value).join(', ')}`);
  }

  if (problems.length > 0) {
    warn.style.display = 'block';
    warn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + problems.join('<br><i class="fa-solid fa-triangle-exclamation"></i> ');
  } else {
    warn.style.display = 'none';
  }
}

async function saveEquipmentTypes() {
  // Финальная валидация
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

  // Проверка prefix — если пустой, предупреждаем админа
  if (_cachedEquipmentTypes.some(t => !t.prefix || !t.prefix.trim())) {
    const ok = await showConfirm(
      'У некоторых типов не указан prefix. ID будет генерироваться с префиксом EQ. Продолжить?',
      { icon: '⚠️', title: 'Пустой prefix', okText: 'Продолжить', okClass: 'btn-warning' }
    );
    if (!ok) return;
  }
    _cachedEquipmentTypes.forEach(t => {
    if (!t.calibrationPlace) t.calibrationPlace = 'internal';
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

// Проверка прав при возврате в окно/вкладку
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isAuthenticated()) {
    refreshCurrentUser();
  }
});

window.addEventListener('focus', () => {
  if (isAuthenticated()) refreshCurrentUser();
});

// ============================================================
// СМЕНА ПАРОЛЯ
// ============================================================
function openChangePasswordModal(force) {
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
  if (notice) notice.style.display = force ? 'block' : 'none';

  // При impersonate — не блокируем, даём шанс вернуться
  const isImpersonatingNow = isImpersonating();
  const reallyForce = force && !isImpersonatingNow;

  if (cancelBtn) {
    cancelBtn.style.display = reallyForce ? 'none' : 'inline-flex';
    cancelBtn.textContent = (force && isImpersonatingNow) ? 'Позже' : 'Отмена';
  }

  if (modal) modal.classList.add('active');
  if (currentInput) setTimeout(() => currentInput.focus(), 100);
}

function closeChangePasswordModal() {
  const modal = document.getElementById('change-password-modal');
  if (modal) modal.classList.remove('active');
}

function validatePasswordClient(pwd) {
  const errors = [];
  if (!pwd || pwd.length < 8)     errors.push('Минимум 8 символов');
  if (!/[a-z]/.test(pwd))         errors.push('Хотя бы одна строчная буква');
  if (!/[A-Z]/.test(pwd))         errors.push('Хотя бы одна заглавная буква');
  if (!/[0-9]/.test(pwd))         errors.push('Хотя бы одна цифра');
  if (!/[^A-Za-z0-9]/.test(pwd))  errors.push('Хотя бы один спецсимвол');
  if (/\s/.test(pwd))             errors.push('Пробелы в пароле недопустимы');
  return { ok: errors.length === 0, errors };
}

async function submitChangePassword(e) {
  e.preventDefault();

  const errEl = document.getElementById('cp-error');
  const currentPwd = document.getElementById('cp-current').value;
  const newPwd     = document.getElementById('cp-new').value;
  const confirmPwd = document.getElementById('cp-confirm').value;

  const cpBtn = document.getElementById('cp-btn');
  const cpBtnIcon = document.getElementById('cp-btn-icon');
  const cpBtnText = document.getElementById('cp-btn-text');

  const resetCpBtn = () => {
    if (cpBtn) cpBtn.disabled = false;
    if (cpBtnIcon) cpBtnIcon.className = 'fa-solid fa-floppy-disk';
    if (cpBtnText) cpBtnText.textContent = 'Сохранить пароль';
  };

  errEl.textContent = '';

  const missing = [];
  if (!currentPwd) missing.push('Текущий пароль');
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
    const res = await apiRequest('/auth/change-password', 'POST', {
      currentPassword: currentPwd,
      newPassword: newPwd,
      confirmPassword: confirmPwd
    });

   currentUser.mustChangePassword = false;

    // Обновляем токен: сервер выдал свежий, т.к. старый уже невалиден
    if (res.token) {
      authToken = res.token;
    }

    setSession(currentUser, authToken, getOriginalUser(), getOriginalToken());
    showToast('Пароль успешно изменён', 'success');
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

  const ok = await showConfirm(
    `Сбросить пароль пользователя «${login}»?\n\n` +
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

  document.getElementById('temp-password-modal').classList.add('active');
}

function closeTempPasswordModal() {
  document.getElementById('temp-password-modal').classList.remove('active');
  _tempPasswordValue = '';
}

async function copyTempPassword() {
  if (!_tempPasswordValue) return;

  // Способ 1: navigator.clipboard (требует HTTPS или localhost)
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(_tempPasswordValue);
      showToast('Пароль скопирован в буфер обмена', 'success');
      return;
    }
  } catch (e) { /* fallback ниже */ }

  // 🆕 Способ 2: execCommand — работает и по HTTP
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
// ============================================================
// ЭКСПОРТ ИСТОРИИ ПОВЕРОК КОНКРЕТНОГО ОБОРУДОВАНИЯ
// ============================================================

// Открыть модалку выбора периода
function openHistoryExportModal() {
  if (!currentHistoryId) {
    showToast('Сначала откройте историю оборудования', 'error');
    return;
  }
  const p = pipettes.find(x => x.id === currentHistoryId);
  if (!p) return;

  document.getElementById('history-export-target').innerHTML =
    `Оборудование: <strong>${esc(p.id)}</strong> — ${esc(p.model)}`;

  document.getElementById('he-from').value = '';
  document.getElementById('he-to').value = '';
  document.getElementById('he-error').textContent = '';

  document.getElementById('history-export-modal').classList.add('active');
}

// Закрыть модалку
function closeHistoryExportModal() {
  document.getElementById('history-export-modal').classList.remove('active');
}

// Получить историю с фильтром по периоду
async function getFilteredHistoryForExport() {
  const p = pipettes.find(x => x.id === currentHistoryId);
  if (!p) return [];

  let history = await apiRequest(`/pipettes/${p.id}/calibration`);

  const from = document.getElementById('he-from').value;
  const to   = document.getElementById('he-to').value;

  // Фильтруем по дате (строки YYYY-MM-DD сравниваются лексикографически корректно)
  if (from) {
    history = history.filter(h => String(h.date).slice(0, 10) >= from);
  }
  if (to) {
    history = history.filter(h => String(h.date).slice(0, 10) <= to);
  }

  // Сортируем от новых к старым (свежая сверху)
  history.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return history;
}

// Экспорт в Excel (.xlsx) — нативный
async function exportHistoryToXlsx() {
  const errEl = document.getElementById('he-error');
  errEl.textContent = '';

  const p = pipettes.find(x => x.id === currentHistoryId);
  if (!p) return;

  const history = await getFilteredHistoryForExport();
  if (history.length === 0) {
    errEl.textContent = 'Нет записей за выбранный период';
    return;
  }

  const from = document.getElementById('he-from').value;
  const to   = document.getElementById('he-to').value;

  const resultLabels = { pass: 'Годен', fail: 'Брак', wip: 'В процессе' };

  const headers = ['Дата поверки', 'Свидетельство', 'Результат', 'Организация', 'Примечание'];
  const rows = history.map(h => ({
    'Дата поверки':   h.date ? formatDate(h.date) : '',
    'Свидетельство':  h.cert || '',
    'Результат':      resultLabels[h.result] || h.result || '',
    'Организация':    h.org || '',
    'Примечание':     h.note || ''
  }));

   const meta = {
    title: 'История поверок оборудования',
    equipmentId: p.id,
    model: p.model,
    manufacturer: p.manufacturer || '',
    serial: p.serial || '',
    department: p.department || '',
    period: (from || to) ? `${from || '…'} — ${to || '…'}` : 'вся история',
    recordCount: history.length,
    user: currentUser ? currentUser.fullName : '',
    userPosition: currentUser ? (currentUser.position || '') : ''
  };

    try {
    const sess = sessionStorage.getItem('pipette_session');
    if (!sess) {
      errEl.textContent = 'Сессия истекла, войдите заново';
      return;
    }
    const token = JSON.parse(sess).token;

    const res = await fetch('/api/export/xlsx', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mode: 'history', meta, headers, rows })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка экспорта');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `history_${p.id}_${todayStr()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);

    closeHistoryExportModal();
    showToast(`Экспортировано: ${history.length} записей`, 'success');
  } catch (e) {
    errEl.textContent = e.message || 'Ошибка экспорта';
    showToast(e.message || 'Ошибка экспорта', 'error');
  }
}

// Экспорт в PDF (открывает вкладку с реестром)
async function exportHistoryToPDF() {
  const errEl = document.getElementById('he-error');
  errEl.textContent = '';

  const p = pipettes.find(x => x.id === currentHistoryId);
  if (!p) return;

  const history = await getFilteredHistoryForExport();
  if (history.length === 0) {
    errEl.textContent = 'Нет записей за выбранный период';
    return;
  }

  const from = document.getElementById('he-from').value;
  const to   = document.getElementById('he-to').value;
  const periodText =
    (from || to) ? `Период: ${from || '…'} — ${to || '…'}` : 'Период: вся история';

  const user = currentUser ? currentUser.fullName : '';
  const userPosition = currentUser ? (currentUser.position || '') : '';
  const today = new Date().toLocaleDateString('ru-RU');
  const resultLabels = { pass: 'Годен', fail: 'Брак', wip: 'В процессе' };

  const rows = history.map((h, i) => `
    <tr>
      <td style="text-align:center;">${i + 1}</td>
      <td>${esc(formatDate(h.date))}</td>
      <td>${esc(h.cert || '—')}</td>
      <td>${esc(resultLabels[h.result] || h.result || '—')}</td>
      <td>${esc(h.org || '—')}</td>
      <td>${esc(h.note || '')}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
    <title>История поверок — ${esc(p.id)}</title>
    <style>
            @page { size: A4 portrait; margin: 12mm 10mm; }
      * { box-sizing: border-box; }

      body {
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 10pt;
        color: #1a1a2e;
        margin: 0;
      }

      h1 { font-size: 14pt; margin: 0 0 4px; }

      .meta {
        font-size: 9pt;
        color: #64748b;
        margin-bottom: 12px;
        border-bottom: 1px solid #cbd5e1;
        padding-bottom: 6px;
      }
      .meta b { color: #1e293b; }

      .info {
        padding: 10px 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        font-size: 9pt;
        margin-bottom: 12px;
      }
      .info div { margin-bottom: 3px; }
      .info b { color: #1e293b; }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 9pt;
        border: 1.5px solid #1e293b;
      }

      th {
        background: #1e293b;
        color: #fff;
        padding: 7px 6px;
        text-align: left;
        font-size: 8pt;
        text-transform: uppercase;
        border: 1px solid #1e293b;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      td {
        padding: 6px;
        border: 0.5px solid #94a3b8;
        vertical-align: top;
      }

      tbody tr:nth-child(even) td {
        background: #f8fafc;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      tbody td:first-child,
      thead th:first-child {
        border-left: 1.5px solid #1e293b;
      }
      tbody td:last-child,
      thead th:last-child {
        border-right: 1.5px solid #1e293b;
      }

       .footer {
        margin-top: 20px;
        font-size: 8pt;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid #cbd5e1;
        padding-top: 6px;
      }

      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
    </style></head><body>
    
       <h1>История поверок оборудования</h1>
      <div class="meta">Дата формирования: <b>${today}</b></div>

      <div class="info">
        <div><b>ID:</b> ${esc(p.id)}</div>
        <div><b>Модель:</b> ${esc(p.model)}${p.manufacturer ? ' (' + esc(p.manufacturer) + ')' : ''}</div>
        <div><b>Серийный номер:</b> ${esc(p.serial || '—')}</div>
        <div><b>Отдел:</b> ${esc(p.department || '—')}</div>
        <div><b>${periodText}</b></div>
        <div><b>Записей:</b> ${history.length}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:5%;text-align:center;">№</th>
            <th style="width:15%;">Дата</th>
            <th style="width:20%;">Свидетельство</th>
            <th style="width:12%;">Результат</th>
            <th style="width:20%;">Организация</th>
            <th>Примечание</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

       <div class="footer">
        <div>Документ сформировал: <b>${esc(userPosition)}, ${esc(user)}</b></div>
      <div>Подпись: _______________</div>
      </div>
    </body></html>
  `;

    // Открываем через Blob URL
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    showToast('Разрешите всплывающие окна для экспорта в PDF', 'error');
    return;
  }
  // Освобождаем URL через 10 сек
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  closeHistoryExportModal();
  showToast(`PDF: ${history.length} записей`, 'success');
}

// ============================================================
// ТЁМНАЯ ТЕМА
// ============================================================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('pipette_theme', theme); } catch (e) {}
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// Применяем сохранённую тему сразу (без мигания)
(function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('pipette_theme') || 'light'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
})();

// ============================================================
// 🆕 СПИСОК ПРАВ (16 штук, по 5 группам)
// ============================================================
  const ALL_PERMISSIONS = [
  { key: 'add_pipette',       group: 'Оборудование',      label: '➕ Добавление оборудования' },
  { key: 'edit_pipette',      group: 'Оборудование',      label: '✏️ Редактирование оборудования' },
  { key: 'delete_pipette',    group: 'Оборудование',      label: '🗑️ Удаление оборудования' },
  { key: 'quick_calibration', group: 'Оборудование',      label: '✓ Быстрая поверка' },
  { key: 'transfer_pipette',  group: 'Оборудование',      label: '🔀 Передача в другой отдел' },

  { key: 'bulk_send',         group: 'Поверки',           label: '📦 Отправка на поверку' },
  { key: 'bulk_return',       group: 'Поверки',           label: '📥 Возврат с поверки' },

  { key: 'import_data',       group: 'Данные',            label: '📥 Импорт данных' },
  { key: 'export_data',       group: 'Данные',            label: '📤 Экспорт данных' },

  { key: 'scan_barcode',      group: 'Штрихкоды',         label: '📷 Сканирование штрихкодов' },
  { key: 'print_labels',      group: 'Штрихкоды',         label: '🏷️ Печать этикеток' },
  { key: 'manage_barcodes',   group: 'Штрихкоды',         label: '🔧 Ручной ввод / сброс штрихкодов' },

  { key: 'manage_users',      group: 'Администрирование', label: '👥 Управление пользователями' },
  { key: 'manage_settings',   group: 'Администрирование', label: '⚙️ Настройки системы' },
  { key: 'manage_printers',   group: 'Администрирование', label: '🖨️ Управление принтерами' },
  { key: 'view_log',          group: 'Администрирование', label: '📜 Просмотр журнала' },

  { key: 'view_history',      group: 'Общие',             label: '📋 Просмотр истории поверок' },
];

// ============================================================
// 🆕 ПРОВЕРКИ ПРАВ
// ============================================================
function canAddPipette()    { return hasPermission('add_pipette')       || hasPermission('manage_pipettes'); }
function canEditPipette()   { return hasPermission('edit_pipette')      || hasPermission('manage_pipettes'); }
function canDeletePipette() { return hasPermission('delete_pipette')    || hasPermission('manage_pipettes'); }
function canQuickCal()      { return hasPermission('quick_calibration') || hasPermission('manage_pipettes'); }
function canTransferPipette() { return hasPermission('transfer_pipette') || hasPermission('manage_pipettes'); }
function canBulkSend()      { return hasPermission('bulk_send')         || hasPermission('manage_pipettes'); }
function canBulkReturn()    { return hasPermission('bulk_return')       || hasPermission('manage_pipettes'); }
function canImport()        { return hasPermission('import_data'); }
function canExport()        { return hasPermission('export_data'); }
function canScanBarcode()   { return hasPermission('scan_barcode'); }
function canPrintLabels()   { return hasPermission('print_labels'); }
function canManageBarcodes(){ return hasPermission('manage_barcodes'); }
function canManageUsers()   { return hasPermission('manage_users'); }
function canManageSettings(){ return hasPermission('manage_settings'); }
function canManagePrinters(){ return hasPermission('manage_printers'); }
function canViewLog()       { return hasPermission('view_log'); }
function canViewHistory()   { return true; }

// ============================================================
// 🆕 СКАНИРОВАНИЕ ШТРИХКОДОВ
// ============================================================
let _barcodeScanList = [];

function openBarcodeScannerModal() {
  _barcodeScanList = [];
  renderBarcodeScanList();
  const modal = document.getElementById('barcode-scanner-modal');
  const input = document.getElementById('barcode-input');
  const errEl = document.getElementById('barcode-scan-error');
  if (errEl) errEl.textContent = '';
  if (input) input.value = '';
  if (modal) modal.classList.add('active');
  if (input) setTimeout(() => input.focus(), 100);
}

function closeBarcodeScannerModal() {
  const modal = document.getElementById('barcode-scanner-modal');
  if (modal) modal.classList.remove('active');
}

async function handleBarcodeScan(raw) {
  const value = String(raw || '').trim();
  if (!value) return;
  const errEl = document.getElementById('barcode-scan-error');
  if (errEl) errEl.textContent = '';
  if (_barcodeScanList.some(x => x._scannedValue === value)) {
    if (errEl) errEl.textContent = 'Уже в списке';
    return;
  }
  try {
    const res = await apiRequest('/barcodes/lookup', 'POST', { barcode: value });
    if (_barcodeScanList.some(x => x.id === res.id)) {
      if (errEl) errEl.textContent = 'Уже в списке';
      return;
    }
    res._scannedValue = value;
    _barcodeScanList.push(res);
    renderBarcodeScanList();
  } catch (e) {
    if (errEl) errEl.textContent = e.message || 'Не найдено';
  }
}

function renderBarcodeScanList() {
  const list = document.getElementById('barcode-scan-list');
  const counter = document.getElementById('barcode-scan-count');
  const btnSend = document.getElementById('btn-scan-send');
  const btnReturn = document.getElementById('btn-scan-return');
  if (counter) counter.textContent = _barcodeScanList.length;
  if (!_barcodeScanList.length) {
    if (list) list.innerHTML = '<div style="color:#94a3b8;">Список пуст. Сканируйте штрихкоды.</div>';
    if (btnSend) btnSend.disabled = true;
    if (btnReturn) btnReturn.disabled = true;
    return;
  }
  if (list) {
    list.innerHTML = _barcodeScanList.map((p, i) => `
      <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #e2e8f0;">
        <div><strong>${esc(p.id)}</strong> — ${esc(p.model || '')}</div>
        <button class="btn btn-danger btn-sm" onclick="removeFromBarcodeScanList(${i})" style="padding:2px 8px;font-size:.7rem;">×</button>
      </div>
    `).join('');
  }
  const hasSendable = _barcodeScanList.some(p => !p.sent_for_calibration);
  const hasReturnable = _barcodeScanList.some(p => p.sent_for_calibration);
  if (btnSend) btnSend.disabled = !hasSendable;
  if (btnReturn) btnReturn.disabled = !hasReturnable;
}

function removeFromBarcodeScanList(idx) {
  _barcodeScanList.splice(idx, 1);
  renderBarcodeScanList();
}

function clearBarcodeScanList() {
  _barcodeScanList = [];
  renderBarcodeScanList();
}

function openBulkSendFromScanner() {
  const ids = _barcodeScanList.filter(p => !p.sent_for_calibration).map(p => p.id);
  if (!ids.length) { showToast('Нет позиций для отправки', 'error'); return; }
  selectedPipettes.clear();
  ids.forEach(id => selectedPipettes.add(id));
  closeBarcodeScannerModal();
  openBulkSendModal();
}

function openBulkReturnFromScanner() {
  const ids = _barcodeScanList.filter(p => p.sent_for_calibration).map(p => p.id);
  if (!ids.length) { showToast('Нет позиций для возврата', 'error'); return; }
  selectedPipettes.clear();
  ids.forEach(id => selectedPipettes.add(id));
  closeBarcodeScannerModal();
  openBulkReturnModal();
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('barcode-input');
  if (!input) return;
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = input.value;
      input.value = '';
      await handleBarcodeScan(value);
    }
  });
});

// ============================================================
// 🆕 ПЕЧАТЬ ЭТИКЕТОК
// ============================================================
function openBarcodePrintModal() {
  updateBarcodePrintScopeCounts();
  const hasSelected = selectedPipettes.size > 0;
  const selRadio = document.getElementById('bc-scope-selected');
  const filtRadio = document.getElementById('bc-scope-filtered');
  if (hasSelected && selRadio) selRadio.checked = true;
  else if (filtRadio) filtRadio.checked = true;

  apiRequest('/settings/system').then(s => {
    const copiesEl = document.getElementById('barcode-print-copies');
    if (copiesEl && s.barcode_default_copies) copiesEl.value = s.barcode_default_copies;
  }).catch(() => {});

  loadPrintersForBarcodePrint();
  const errEl = document.getElementById('barcode-print-error');
  if (errEl) errEl.textContent = '';
  document.getElementById('barcode-print-modal').classList.add('active');
}

function closeBarcodePrintModal() {
  document.getElementById('barcode-print-modal').classList.remove('active');
}

async function loadPrintersForBarcodePrint() {
  const container = document.getElementById('barcode-print-printer-options');
  if (!container) return;
  container.innerHTML = '<div class="bc-printer-empty">Загрузка…</div>';

  try {
    const data = await apiRequest('/barcode-printers/available');

    if (!data.printers || data.printers.length === 0) {
      container.innerHTML = `
        <label class="bc-printer-item">
          <input type="radio" name="bc-printer" value="pdf-a4" checked>
          <span>📄 PDF (A4)</span>
        </label>`;
      return;
    }

    const modeLabels = {
      'pdf-a4':      '📄 PDF (A4)',
      'pdf-zebra':   '🖨️ PDF 58×40 (Ctrl+P)',
      'zebra-ip':    '🌐 Zebra по сети (IP)',
      'zebra-agent': '⚡ Zebra (агент)',
    };

    const options = data.printers.map(p => {
      const isPreferred = (p.id === data.preferredId);
      const label = `${modeLabels[p.mode] || p.mode} — ${esc(p.name)}${p.department ? ' (' + esc(p.department) + ')' : ''}`;
      return `
        <label class="bc-printer-item">
          <input type="radio" name="bc-printer" value="printer:${p.id}" ${isPreferred ? 'checked' : ''}>
          <span>${label}${isPreferred ? ' <span class="bc-printer-hint">← ваш</span>' : ''}</span>
        </label>`;
    });

    options.push(`
      <label class="bc-printer-item">
        <input type="radio" name="bc-printer" value="pdf-a4" ${!data.preferredId ? 'checked' : ''}>
        <span>📄 PDF (A4, обычный принтер)</span>
      </label>`);

    container.innerHTML = options.join('');
  } catch (e) {
    container.innerHTML = `
      <label class="bc-printer-item">
        <input type="radio" name="bc-printer" value="pdf-a4" checked>
        <span>📄 PDF (A4)</span>
      </label>`;
  }
}

function updateBarcodePrintScopeCounts() {
  const selectedCount = [...selectedPipettes].filter(id => pipettes.some(p => p.id === id)).length;
  const el1 = document.getElementById('bc-scope-selected-count');
  if (el1) el1.textContent = selectedCount;

  const pageIds = getVisiblePageIds();
  const el2 = document.getElementById('bc-scope-page-count');
  if (el2) el2.textContent = pageIds.length;

  const filtered = getFilteredPipettes();
  const el3 = document.getElementById('bc-scope-filtered-count');
  if (el3) el3.textContent = filtered.length;
}

function getBarcodePrintIds() {
  const scope = document.querySelector('input[name="bc-scope"]:checked')?.value || 'filtered';
  if (scope === 'selected') return [...selectedPipettes].filter(id => pipettes.some(p => p.id === id));
  if (scope === 'page')     return getVisiblePageIds();
  if (scope === 'filtered') return getFilteredPipettes().map(p => p.id);
  return [];
}

async function submitBarcodePrint(ev) {
  const errEl = document.getElementById('barcode-print-error');
  if (errEl) errEl.textContent = '';

  const ids = getBarcodePrintIds();
  if (ids.length === 0) { if (errEl) errEl.textContent = 'Ничего не выбрано'; return; }

  if (ids.length > 500) {
    const ok = await showConfirm(
      `Печатается ${ids.length} этикеток. Продолжить?`,
      { icon: '⚠️', title: 'Много этикеток', okText: 'Продолжить', okClass: 'btn-warning' }
    );
    if (!ok) return;
  }

  const copies = Math.max(1, Math.min(50, parseInt(document.getElementById('barcode-print-copies').value, 10) || 1));

  const printerRadio = document.querySelector('input[name="bc-printer"]:checked');
  const printerValue = printerRadio ? printerRadio.value : 'pdf-a4';

  if (printerValue === 'pdf-a4') {
    await downloadBarcodePdf(ids, copies, 'a4');
    closeBarcodePrintModal();
    return;
  }

  const printerId = parseInt(printerValue.replace('printer:', ''), 10);

  const btn = ev && ev.target ? ev.target.closest('button') : null;
  const origHtml = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Печать…'; }

  try {
    const res = await apiRequest('/barcodes/print', 'POST', { ids, copies, printerId });

    if (res.mode === 'zebra-ip') {
      showToast(res.message || `Отправлено на «${res.printer}»`, 'success');
      closeBarcodePrintModal();
      return;
    }

    if (res.mode === 'zebra-agent') {
      const ok = await sendToLocalAgent(res.zpl, res.agentPort || 9200);
      if (ok) {
        showToast(`Отправлено на «${res.printer}»: ${res.printed} этикеток`, 'success');
        closeBarcodePrintModal();
      } else {
        showToast('Локальный агент не отвечает. Скачиваем PDF.', 'warn');
        await downloadBarcodePdf(ids, copies, 'zebra');
        closeBarcodePrintModal();
      }
      return;
    }

    if (res.mode === 'pdf-zebra') {
      await downloadBarcodePdf(ids, copies, 'zebra');
      closeBarcodePrintModal();
      showToast(`PDF 58×40 для «${res.printer || 'Zebra'}»: ${ids.length * copies} этикеток`, 'success');
      return;
    }

    if (res.mode === 'pdf-a4-fallback') {
      showToast(`⚠️ ${res.reason}. Скачиваем PDF.`, 'warn');
      await downloadBarcodePdf(ids, copies, 'a4');
      closeBarcodePrintModal();
      return;
    }

    if (res.mode === 'pdf-a4') {
      await downloadBarcodePdf(ids, copies, 'a4');
      closeBarcodePrintModal();
      return;
    }

    showToast('Неизвестный режим: ' + res.mode, 'error');
  } catch (e) {
    if (errEl) errEl.textContent = e.message || 'Ошибка печати';
  } finally {
    if (btn && origHtml) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

async function downloadBarcodePdf(ids, copies, layout) {
  const sess = sessionStorage.getItem('pipette_session');
  if (!sess) throw new Error('Сессия истекла');
  const token = JSON.parse(sess).token;
  const url = `/api/barcodes/labels.pdf?ids=${encodeURIComponent(ids.join(','))}&copies=${copies}&layout=${layout}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Ошибка генерации PDF');
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `labels_${layout}_${todayStr()}.pdf`;
  a.click();
  URL.revokeObjectURL(blobUrl);
  showToast(`PDF: ${ids.length} × ${copies} = ${ids.length * copies} этикеток`, 'success');
}

async function sendToLocalAgent(zpl, port) {
  try {
    const res = await fetch(`http://localhost:${port}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: zpl,
    });
    return res.ok;
  } catch (e) {
    console.warn('Local agent unavailable:', e.message);
    return false;
  }
}

// ============================================================
// 🆕 ОБЁРТКА generateFormFields — поле «Штрихкод» с кнопками
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

// ============================================================
// 🆕 НАСТРОЙКИ АДМИНА — принтеры
// ============================================================
let _cachedBarcodePrinters = [];

async function renderBarcodePrintersList() {
  const container = document.getElementById('barcode-printers-list');
  if (!container) return;

  try {
    _cachedBarcodePrinters = await apiRequest('/barcode-printers');

    if (_cachedBarcodePrinters.length === 0) {
      container.innerHTML = `<div class="bc-empty">Принтеров пока нет. Нажмите «Добавить принтер».</div>`;
      return;
    }

    const modeLabels = {
      'pdf-a4':      'PDF (A4)',
      'pdf-zebra':   'PDF 58×40',
      'zebra-ip':    'Zebra IP',
      'zebra-agent': 'Zebra агент',
    };

    let html = `<table class="bc-printers-table"><thead><tr>
      <th style="width:20%;">Название</th>
      <th style="width:16%;">Режим</th>
      <th style="width:20%;">Отдел</th>
      <th style="width:18%;">IP</th>
      <th style="width:9%;">Размер</th>
      <th style="width:5%;">Вкл</th>
      <th style="width:7%;">По&nbsp;ум.</th>
      <th style="width:5%;"></th>
    </tr></thead><tbody>`;

    for (const p of _cachedBarcodePrinters) {
      html += `
        <tr data-printer-id="${p.id}">
          <td><input type="text" value="${esc(p.name)}" onchange="updateBarcodePrinterField(${p.id}, 'name', this.value)"></td>
          <td>
            <select onchange="updateBarcodePrinterField(${p.id}, 'mode', this.value)">
              ${Object.entries(modeLabels).map(([v, l]) =>
                `<option value="${v}" ${p.mode === v ? 'selected' : ''}>${l}</option>`
              ).join('')}
            </select>
          </td>
          <td>
            <select onchange="updateBarcodePrinterField(${p.id}, 'department', this.value)">
              <option value="">— любой —</option>
              ${departmentsList.map(d => `<option value="${esc(d)}" ${p.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
            </select>
          </td>
          <td><input type="text" value="${esc(p.ip || '')}" onchange="updateBarcodePrinterField(${p.id}, 'ip', this.value)" placeholder="192.168.1.100"></td>
          <td>
            <select onchange="updateBarcodePrinterField(${p.id}, 'labelSize', this.value)">
              <option value="58x40" ${p.labelSize === '58x40' ? 'selected' : ''}>58×40</option>
              <option value="40x25" ${p.labelSize === '40x25' ? 'selected' : ''}>40×25</option>
              <option value="100x50" ${p.labelSize === '100x50' ? 'selected' : ''}>100×50</option>
            </select>
          </td>
          <td style="text-align:center;"><input type="checkbox" class="bc-chk" ${p.enabled ? 'checked' : ''} onchange="updateBarcodePrinterField(${p.id}, 'enabled', this.checked)"></td>
          <td style="text-align:center;"><input type="checkbox" class="bc-chk" ${p.isDefault ? 'checked' : ''} onchange="updateBarcodePrinterField(${p.id}, 'isDefault', this.checked)"></td>
          <td class="bc-printer-actions">
            <button class="btn btn-info btn-sm bc-icon-btn" onclick="checkPrinterById(${p.id})" title="Проверить связь"><i class="fa-solid fa-plug"></i></button>
            <button class="btn btn-success btn-sm bc-icon-btn" onclick="saveBarcodePrinter(${p.id})" title="Сохранить"><i class="fa-solid fa-floppy-disk"></i></button>
            <button class="btn btn-danger btn-sm bc-icon-btn" onclick="deleteBarcodePrinter(${p.id})" title="Удалить"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>`;
    }
    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div style="color:#dc2626;padding:10px;">Ошибка: ${esc(e.message)}</div>`;
  }
}

function updateBarcodePrinterField(id, field, value) {
  const p = _cachedBarcodePrinters.find(x => x.id === id);
  if (p) p[field] = value;
}

async function saveBarcodePrinter(id) {
  const p = _cachedBarcodePrinters.find(x => x.id === id);
  if (!p) return;
  try {
    await apiRequest('/barcode-printers/' + id, 'PUT', {
      name: p.name,
      department: p.department || '',
      mode: p.mode,
      ip: p.ip || '',
      port: p.port || 9100,
      labelSize: p.labelSize || '58x40',
      enabled: !!p.enabled,
      isDefault: !!p.isDefault,
      sortOrder: p.sortOrder || 0,
    });
    showToast(`Принтер «${p.name}» сохранён`, 'success');
  } catch (e) {
    showToast(e.message || 'Ошибка', 'error');
  }
}

async function deleteBarcodePrinter(id) {
  const p = _cachedBarcodePrinters.find(x => x.id === id);
  if (!p) return;
  const ok = await showConfirm(
    `Удалить принтер «${p.name}»?`,
    { icon: '🖨️', title: 'Удаление', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;
  try {
    await apiRequest('/barcode-printers/' + id, 'DELETE');
    showToast('Удалён', 'success');
    renderBarcodePrintersList();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function checkPrinterById(id) {
  const p = _cachedBarcodePrinters.find(x => x.id === id);
  if (!p) return;
  if (p.mode === 'zebra-ip') {
    try {
      const res = await apiRequest('/barcodes/printer-status', 'POST', { ip: p.ip, port: p.port });
      showToast(res.message, res.ok ? 'success' : 'error');
    } catch (e) {
      showToast(e.message, 'error');
    }
  } else if (p.mode === 'zebra-agent') {
    showToast('Проверка агента выполняется на компе пользователя', 'warn');
  } else {
    showToast('Для этого режима проверка связи не требуется', 'warn');
  }
}

async function addBarcodePrinter() {
  const name = prompt('Название принтера (например «Zebra КДЛ»):');
  if (!name || !name.trim()) return;
  const mode = prompt(
    'Режим:\n' +
    '1 — pdf-a4 (PDF A4)\n' +
    '2 — pdf-zebra (PDF 58×40, Ctrl+P)\n' +
    '3 — zebra-ip (прямая печать по сети)\n' +
    '4 — zebra-agent (через локальный агент)\n\n' +
    'Введите номер:',
    '2'
  );
  const modeMap = { '1': 'pdf-a4', '2': 'pdf-zebra', '3': 'zebra-ip', '4': 'zebra-agent' };
  const selectedMode = modeMap[mode];
  if (!selectedMode) { showToast('Отменено', 'error'); return; }

  let ip = null;
  let port = 9100;
  if (selectedMode === 'zebra-ip') {
    ip = prompt('IP адрес принтера (например 192.168.1.100):');
    if (!ip || !ip.trim()) { showToast('IP не указан', 'error'); return; }
    port = parseInt(prompt('Порт (по умолчанию 9100):', '9100') || '9100', 10) || 9100;
  }

  const department = prompt('Отдел (оставьте пустым для общего принтера):');

  try {
    await apiRequest('/barcode-printers', 'POST', {
      name: name.trim(),
      department: department ? department.trim() : '',
      mode: selectedMode,
      ip: ip ? ip.trim() : '',
      port,
      labelSize: '58x40',
      enabled: true,
      isDefault: false,
    });
    showToast('Принтер добавлен', 'success');
    renderBarcodePrintersList();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ============================================================
// 🆕 НАСТРОЙКИ ПЕЧАТИ — загрузка / сохранение
// ============================================================
async function loadBarcodeSettings() {
  try {
    const s = await apiRequest('/settings/system');
    const sizeEl = document.getElementById('bc-label-size');
    if (sizeEl) sizeEl.value = s.barcode_label_size || '58x40';
    const typeEl = document.getElementById('bc-type');
    if (typeEl) typeEl.value = s.barcode_type || 'code128';
    const copiesEl = document.getElementById('bc-default-copies');
    if (copiesEl) copiesEl.value = s.barcode_default_copies || 1;
    const agentEl = document.getElementById('bc-agent-port');
    if (agentEl) agentEl.value = s.barcode_agent_port || 9200;
    const maxEl = document.getElementById('bc-max-length');
    if (maxEl) maxEl.value = s.barcode_max_length || 128;
    const fbEl = document.getElementById('bc-fallback-to-pdf');
    if (fbEl) fbEl.checked = s.barcode_fallback_to_pdf !== '0';

    const container = document.getElementById('bc-label-fields');
    if (container) {
      const allFields = [
        { id: 'id',              label: 'Внутренний номер' },
        { id: 'model',           label: 'Модель' },
        { id: 'serial',          label: 'Серийный' },
        { id: 'inventorynumber', label: 'Инвентарный номер' },
        { id: 'department',      label: 'Отдел' },
        { id: 'responsible',     label: 'Ответственный' },
      ];
      let selected = ['id', 'model', 'serial', 'department'];
      try { selected = JSON.parse(s.barcode_label_fields || '[]'); } catch (e) {}
      container.innerHTML = allFields.map(f => `
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" class="bc-field-cb" value="${esc(f.id)}" ${selected.includes(f.id) ? 'checked' : ''}>
          ${esc(f.label)}
        </label>
      `).join('');
    }
  } catch (e) {
    console.warn('loadBarcodeSettings:', e);
  }
}

async function saveBarcodeSettings() {
  const fields = Array.from(document.querySelectorAll('.bc-field-cb:checked')).map(cb => cb.value);
  if (fields.length === 0) { showToast('Выберите хотя бы одно поле', 'error'); return; }
  const payload = {
    barcode_label_size: document.getElementById('bc-label-size').value,
    barcode_type: document.getElementById('bc-type').value,
    barcode_default_copies: document.getElementById('bc-default-copies').value,
    barcode_agent_port: document.getElementById('bc-agent-port').value,
    barcode_max_length: document.getElementById('bc-max-length').value,
    barcode_fallback_to_pdf: document.getElementById('bc-fallback-to-pdf').checked ? '1' : '0',
    barcode_label_fields: JSON.stringify(fields),
  };
  try {
    await apiRequest('/settings/system', 'PUT', payload);
    showToast('Настройки печати сохранены', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ============================================================
// 🆕 ПОЛЬЗОВАТЕЛИ — новая форма с правами
// ============================================================
async function renderUsersSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    const users = await apiRequest('/users');
    const roleLabels = { user: 'Пользователь', senior_lab: 'Ст. лаборант', admin: 'Администратор' };
    const curId = currentUser.id;

    let html = '<h3>Управление пользователями</h3>';
    html += `<table class="field-settings-table" style="margin-bottom:20px;"><thead><tr>
      <th>Логин</th><th>ФИО</th><th>Должность</th><th>Отдел</th><th>Роль</th><th>Права</th><th>Действия</th>
    </tr></thead><tbody>`;

    users.forEach(u => {
      const perms = u.extraPermissions || [];
      const isAdm = u.role === 'admin';
      const permText = isAdm
        ? '<span style="color:#dc2626;font-weight:700;">все</span>'
        : (perms.length === 0
            ? '<span style="color:#94a3b8;">нет</span>'
            : String(perms.length));

      html += `<tr>
        <td>${esc(u.login)}</td>
        <td>${esc(u.fullName || u.full_name)}</td>
        <td>${esc(u.position)}${u.isActing
          ? ` <span style="color:#eab308;font-weight:600;">(и.о.${u.actingForName ? ' за ' + esc(u.actingForName) : ''})</span>`
          : ''}</td>
        <td>${esc(u.department || '—')}</td>
        <td>${roleLabels[u.role] || u.role}</td>
        <td style="text-align:center;">${permText}</td>
        <td class="actions">
          <button class="btn btn-secondary btn-sm" onclick="editUserSetting('${u.id}')" title="Редактировать">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-primary btn-sm"
                  onclick="openUserViewModal('${u.id}', '${esc(u.fullName || u.full_name)}')"
                  title="Настроить видимые поля формы">
            <i class="fa-solid fa-list-check"></i>
          </button>
          ${u.id !== curId ? `
            <button class="btn btn-info btn-sm" onclick="impersonateUser('${u.id}')" title="Войти как">
              <i class="fa-solid fa-magnifying-glass"></i>
            </button>
            <button class="btn btn-warning btn-sm" onclick="resetUserPassword('${u.id}', '${esc(u.login)}')" title="Сбросить пароль">
              <i class="fa-solid fa-key"></i>
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteUserSetting('${u.id}')" title="Удалить">
              <i class="fa-solid fa-trash"></i>
            </button>` : ''}
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;">
          ${items.map(p => `
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:5px 8px;border-radius:6px;font-size:.85rem;line-height:1.3;">
              <input type="checkbox" class="usr-perm-cb" value="${esc(p.key)}" style="margin-top:2px;">
              <span>${esc(p.label)}</span>
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

      <div style="background:#f0f9ff;border-left:3px solid #0ea5e9;border-radius:8px;padding:14px;margin:16px 0;">
        <div style="font-weight:700;font-size:.95rem;color:#0369a1;margin-bottom:6px;">
          <i class="fa-solid fa-key"></i> Права доступа
        </div>
        <small style="color:#0c4a6e;display:block;margin-bottom:10px;font-size:.8rem;">
          Отмеченные права определяют, <strong>какие кнопки и действия доступны пользователю</strong>.
          Если право не выдано — элемент скрыт. По умолчанию все права выключены.
          Для роли «Администратор» все права выдаются автоматически.
        </small>

        <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyPermPreset('none')">Очистить</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyPermPreset('user')">👤 Пользователь</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyPermPreset('senior')">🔬 Ст. лаборант</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyPermPreset('manager')">📊 Менеджер</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyPermPreset('all')">⭐ Все права</button>
        </div>

        <div id="usr-permissions">${permsHtml}</div>
      </div>

      <div style="background:#fef9c3;border-left:3px solid #eab308;border-radius:8px;padding:12px;margin-bottom:12px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;color:#854d0e;">
          <input type="checkbox" id="usr-only-own-dept" style="width:18px;height:18px;">
          <i class="fa-solid fa-eye-slash"></i>
          Показывать только свой отдел
        </label>
        <small style="color:#92400e;display:block;margin-top:6px;margin-left:26px;font-size:.78rem;">
          Если включено — пользователь увидит только пипетки своего отдела. Отдел должен быть указан выше.
        </small>
      </div>

      <div style="background:#f0f9ff;border-left:3px solid #0ea5e9;border-radius:8px;padding:12px;margin-bottom:16px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;color:#0369a1;">
          <input type="checkbox" id="usr-is-acting" style="width:18px;height:18px;" onchange="onActingChange(this.checked)">
          <i class="fa-solid fa-user-clock"></i>
          Исполняющий обязанности (и.о.)
        </label>
        <small style="color:#0c4a6e;display:block;margin-top:6px;margin-left:26px;font-size:.78rem;">
          И.о. видит оборудование отдела основного и работает под его ФИО.
        </small>
        <div id="usr-acting-for-wrap" style="display:none;margin-top:10px;">
          <label style="font-size:.85rem;font-weight:600;color:#0369a1;margin-bottom:4px;display:block;">За кого исполняет *</label>
          <select id="usr-acting-for" style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:8px;">
            <option value="">— выберите —</option>
          </select>
        </div>
      </div>

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
    document.getElementById('usr-fullname').value = u.fullName || u.full_name;
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

  try {
    let userId = id;
    if (id) {
      await apiRequest('/users/' + id, 'PUT', payload);
      showToast('Пользователь обновлён', 'success');
    } else {
      const res = await apiRequest('/users', 'POST', payload);
      userId = res.id;
      showToast('Пользователь создан', 'success');
      setTimeout(() => showTempPasswordModal(res.login, fullName, res.tempPassword), 300);
    }

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
        currentUser.fullName = me.fullName || me.full_name;
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

    resetUserSettingForm();
    renderUsersSettings();
  } catch (e) { showToast(e.message, 'error'); }
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

// ============================================================
// 🆕 МОДАЛКА «Поля формы пользователя»
// ============================================================
let _userViewUserId = null;
let _userViewVisibleFields = [];

async function openUserViewModal(userId, userName) {
  if (!isAdmin()) return;
  _userViewUserId = userId;
  _userViewVisibleFields = [];

  document.getElementById('user-view-target').innerHTML =
    `Настройка полей формы для: <strong>${esc(userName || userId)}</strong>`;

  try {
    const prefs = await apiRequest(`/settings/user-preferences/${userId}`);
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

  const allEnabled = _cachedFields.filter(f => f.enabled).map(f => f.id);
  if (_userViewVisibleFields.length === 0) _userViewVisibleFields = [...allEnabled];

  renderUserViewContent();
  document.getElementById('user-view-modal').classList.add('active');
}

function closeUserViewModal() {
  document.getElementById('user-view-modal').classList.remove('active');
  _userViewUserId = null;
  _userViewVisibleFields = [];
}

function renderUserViewContent() {
  const c = document.getElementById('user-view-content');
  if (!c) return;
  const allFields = _cachedFields.filter(f => f.enabled).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (allFields.length === 0) {
    c.innerHTML = '<div class="prefs-empty">Нет активных полей формы</div>';
    return;
  }
  const visibleSet = new Set(_userViewVisibleFields);
  c.innerHTML = `
    <div class="prefs-list">
      ${allFields.map(f => `
        <label class="prefs-item">
          <input type="checkbox" ${visibleSet.has(f.id) ? 'checked' : ''} onchange="toggleUserViewField('${f.id}', this.checked)">
          <span class="prefs-label">${esc(f.label)}</span>
        </label>
      `).join('')}
    </div>
    <div class="prefs-hint">
      <i class="fa-solid fa-circle-info"></i>
      Отключённые поля не будут видны этому пользователю в форме добавления и редактирования.
      Остальные настройки — в форме редактирования пользователя.
    </div>
  `;
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

  let existing = {};
  try { existing = await apiRequest(`/settings/user-preferences/${_userViewUserId}`); } catch (e) {}

  const merged = { ...existing, visibleFields: _userViewVisibleFields };

  try {
    await apiRequest(`/settings/user-preferences/${_userViewUserId}`, 'PUT', merged);
    showToast('Поля формы сохранены', 'success');
    closeUserViewModal();

    // 🆕 Если настройки сохранили СЕБЕ — сразу обновить myPrefs и перерисовать
    if (_userViewUserId === currentUser.id) {
      myPrefs.visibleFields = [..._userViewVisibleFields];
      myPrefs._loaded = true;
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

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'user-view-modal') closeUserViewModal();
});

// ============================================================
// 🆕 СКАНИРОВАНИЕ ШТРИХ-КОДОВ КАМЕРОЙ ТЕЛЕФОНА
// ============================================================
let _cameraStream = null;
let _cameraRafId = null;
let _cameraZxingReader = null;
let _cameraTorchOn = false;
let _cameraTargetInput = null;
let _cameraLastResult = '';
let _cameraLastTime = 0;

async function openCameraScan(targetInputId = null) {
  _cameraTargetInput = targetInputId;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Браузер не поддерживает доступ к камере', 'error');
    return;
  }

  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.protocol !== 'https:' && !isLocal) {
    showToast('Камера работает только по HTTPS. Обратитесь к администратору.', 'error');
    return;
  }

  const modal = document.getElementById('camera-scan-modal');
  const status = document.getElementById('camera-scan-status');
  if (status) status.textContent = 'Запуск камеры…';
  if (modal) modal.classList.add('active');

  try {
    _cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    const video = document.getElementById('camera-scan-video');
    video.srcObject = _cameraStream;
    await video.play();

    if (status) status.textContent = 'Наведите камеру на штрих-код…';

    checkTorchSupport();
    startCameraDecoding(video);
  } catch (e) {
    console.error('Camera error:', e);
    let msg = 'Не удалось открыть камеру';
    if (e.name === 'NotAllowedError')       msg = 'Доступ к камере запрещён. Разрешите в настройках браузера.';
    else if (e.name === 'NotFoundError')    msg = 'Камера не найдена на устройстве.';
    else if (e.name === 'NotReadableError') msg = 'Камера занята другим приложением.';
    if (status) status.textContent = '❌ ' + msg;
    showToast(msg, 'error');
  }
}

function closeCameraScan() {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(t => t.stop());
    _cameraStream = null;
  }
  if (_cameraRafId) {
    cancelAnimationFrame(_cameraRafId);
    _cameraRafId = null;
  }
  if (_cameraZxingReader) {
    try { _cameraZxingReader.reset(); } catch (e) {}
    _cameraZxingReader = null;
  }
  _cameraTorchOn = false;
  _cameraLastResult = '';
  _cameraTargetInput = null;

  const video = document.getElementById('camera-scan-video');
  if (video) video.srcObject = null;

  const modal = document.getElementById('camera-scan-modal');
  if (modal) modal.classList.remove('active');

  const torchBtn = document.getElementById('camera-torch-btn');
  if (torchBtn) torchBtn.style.display = 'none';
}

function checkTorchSupport() {
  const torchBtn = document.getElementById('camera-torch-btn');
  if (!torchBtn || !_cameraStream) return;

  const track = _cameraStream.getVideoTracks()[0];
  if (!track) return;

  const caps = track.getCapabilities ? track.getCapabilities() : {};
  torchBtn.style.display = caps.torch ? 'inline-flex' : 'none';
}

async function toggleCameraTorch() {
  if (!_cameraStream) return;
  const track = _cameraStream.getVideoTracks()[0];
  if (!track) return;

  _cameraTorchOn = !_cameraTorchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: _cameraTorchOn }] });
  } catch (e) {
    console.warn('Torch error:', e);
    showToast('Фонарик не поддерживается', 'warn');
    _cameraTorchOn = false;
  }
}

function startCameraDecoding(video) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  try {
    _cameraZxingReader = new ZXing.BrowserMultiFormatReader();
  } catch (e) {
    console.warn('ZXing не загружен, будут только QR-коды:', e.message);
    _cameraZxingReader = null;
  }

  const tick = () => {
    if (!_cameraStream) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const w = video.videoWidth;
      const h = video.videoHeight;

      const maxSide = 640;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const cw = Math.floor(w * scale);
      const ch = Math.floor(h * scale);

      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      ctx.drawImage(video, 0, 0, cw, ch);
      const imageData = ctx.getImageData(0, 0, cw, ch);

      if (window.jsQR) {
        const qr = jsQR(imageData.data, cw, ch, { inversionAttempts: 'dontInvert' });
        if (qr && qr.data) {
          handleCameraResult(qr.data);
          return;
        }
      }

      if (_cameraZxingReader) {
        try {
          _cameraZxingReader.decodeFromCanvas(canvas)
            .then(result => {
              if (result && result.text) handleCameraResult(result.text);
            })
            .catch(() => {});
        } catch (e) {}
      }
    }

    _cameraRafId = requestAnimationFrame(tick);
  };

  _cameraRafId = requestAnimationFrame(tick);
}

function handleCameraResult(code) {
  const clean = String(code || '').trim();
  if (!clean) return;

  const now = Date.now();
  if (clean === _cameraLastResult && now - _cameraLastTime < 2000) return;
  _cameraLastResult = clean;
  _cameraLastTime = now;

  if (navigator.vibrate) navigator.vibrate(80);

  const status = document.getElementById('camera-scan-status');
  if (status) status.textContent = '✅ Найдено: ' + clean;

  let targetEl = null;
  if (_cameraTargetInput) targetEl = document.getElementById(_cameraTargetInput);

  if (targetEl) {
    targetEl.value = clean;
    targetEl.dispatchEvent(new Event('input', { bubbles: true }));
    showToast('Код вставлен', 'success');
    closeCameraScan();
    return;
  }

  const scannerInput = document.getElementById('barcode-input');
  const scannerModal = document.getElementById('barcode-scanner-modal');
  if (scannerInput && scannerModal && scannerModal.classList.contains('active')) {
    scannerInput.value = clean;
    scannerInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    closeCameraScan();
    return;
  }

  const searchInput = document.getElementById('search');
  if (searchInput) {
    searchInput.value = clean;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    showToast('Код вставлен в поиск', 'success');
  } else {
    showToast('Код: ' + clean, 'success');
  }

  closeCameraScan();
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'camera-scan-modal') closeCameraScan();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const m = document.getElementById('camera-scan-modal');
    if (m && m.classList.contains('active')) closeCameraScan();
  }
});

// ============================================================
// 🆕 УМНАЯ КНОПКА «СКАНИРОВАТЬ»
// Десктоп → USB-сканер, Телефон/планшет → камера
// ============================================================
function isMobileDevice() {
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|PlayBook|Silk/i.test(ua);
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const hasTouch = (navigator.maxTouchPoints || 0) > 0 || ('ontouchstart' in window);
  const narrowScreen = window.matchMedia('(max-width: 900px)').matches;

  return uaMobile || iPadOS || (hasTouch && narrowScreen);
}

function handleScanButton() {
  if (isMobileDevice()) {
    openCameraScan();
  } else {
    openBarcodeScannerModal();
  }
}

// 🆕 Подмена иконки кнопки «Сканировать» под устройство
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.btn-scan-barcode, [onclick*="handleScanButton"]').forEach(btn => {
    const icon = btn.querySelector('i');
    if (!icon) return;
    if (isMobileDevice()) {
      icon.className = 'fa-solid fa-camera';
      btn.title = 'Сканировать камерой';
    } else {
      icon.className = 'fa-solid fa-barcode';
      btn.title = 'Сканировать USB-сканером';
    }
  });
});
