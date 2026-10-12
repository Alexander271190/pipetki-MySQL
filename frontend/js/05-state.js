'use strict';

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
    // 🆕 Эффективный вид: индивидуальное → шаблон → дефолт
    myPrefs = await apiRequest('/settings/my-preferences/effective') || {};
    myPrefs._loaded = true;
  } catch (e) {
    // 🛡️ Fallback на старый эндпоинт
    try {
      myPrefs = await apiRequest('/settings/my-preferences') || {};
      myPrefs._loaded = true;
    } catch (e2) {
      myPrefs = { _loaded: true };
    }
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

        // 🆕 СИНХРОНИЗАЦИЯ visibleFields с активными полями field_config.
if (Array.isArray(_cachedFields) && _cachedFields.length > 0) {
  const activeFieldIds = _cachedFields
    .filter(f => f.enabled)
    .map(f => f.id);

  // 🆕 Виртуальные колонки — их нет в field_config, но их надо сохранять
  const VIRTUAL_IDS = ['status', 'nextCalibration'];

  const hasUserSettings =
    Array.isArray(myPrefs.visibleFields) &&
    myPrefs.visibleFields.length > 0;

    if (!hasUserSettings) {
    // Настроек нет — показываем все активные + виртуальные
    myPrefs.visibleFields = [...activeFieldIds, ...VIRTUAL_IDS];
  } else {
    // Настройки есть — сохраняем только валидные (активные + виртуальные)
    const allowedSet = new Set([...activeFieldIds, ...VIRTUAL_IDS]);
    const visibleSet = new Set(myPrefs.visibleFields);

    // 🆕 Виртуальные добавляем ТОЛЬКО если пользователь ещё не открывал
    // модалку «Настроить видимые поля» после внедрения виртуальных.
    // Если он их видел и явно выключил — не навязываем обратно.
    if (!myPrefs._virtualsInitialized) {
      for (const vid of VIRTUAL_IDS) {
        if (!visibleSet.has(vid)) visibleSet.add(vid);
      }
    }

    myPrefs.visibleFields = [...visibleSet].filter(id => allowedSet.has(id));
  }
}

   // 🛡️ Список ответственных — для тех, кому он реально нужен
    // (админ, ст. лаборант, владелец transfer_pipette / bulk_change_responsible)
    const needsResponsibles =
      currentUser.role === 'admin' ||
      isSeniorLab() ||
      canTransferPipette() ||
      canBulkChangeResponsible();

    if (needsResponsibles) {
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

function calcStatusByDate(p) {
  // Брак и "в процессе" — дата не показательна
  if (p.last_result === 'fail') return null;
  if (p.last_result === 'wip')  return null;

  // Нет даты или интервала — не классифицируем
  if (!p.last_calibration || !p.interval) return null;

  const last = parseLocalDate(p.last_calibration);
  if (!last) return null;

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

    // 2. Виртуальные и дополнительные системные колонки — добавляем их
  //    в СПРАВОЧНИК, чтобы findColumn() мог их найти, если они включены
  //    в visibleFields. Но в саму таблицу они попадут только по решению
  //    getActiveTableColumns().
  const SYSTEM_EXTRA_COLUMNS = [
    { id: 'interval',        label: 'МПИ',         sortable: true,  field: 'interval' },
    { id: 'notes',           label: 'Примечание',  sortable: false, field: 'notes' },
    { id: 'result',          label: 'Результат',   sortable: false, field: 'last_result' },
    { id: 'active',          label: 'Активность',  sortable: false, field: 'active' },
    { id: 'nextCalibration', label: 'Следующая',   sortable: true,  field: 'nextCalibration' },
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

  // 🆕 Виртуальные колонки — их нет в field_config, но они есть в visibleFields
  const VIRTUAL_IDS = ['status', 'nextCalibration'];

  for (const vid of VIRTUAL_IDS) {
    if (!visible.has(vid)) continue;
    if (added.has(vid)) continue;

    const def = allOrdered.find(c => c.id === vid);
    if (!def) continue;

    // «Следующая» должна идти сразу после «Поверка»,
    // а если её нет — после «Дата поверки».
    if (vid === 'nextCalibration') {
      const lastCalIdx = cols.indexOf('lastCalibration');
      if (lastCalIdx !== -1) {
        cols.splice(lastCalIdx + 1, 0, vid);
      } else {
        cols.push(vid);
      }
    } else {
      // «Статус» — в конец
      cols.push(vid);
    }
    added.add(vid);
  }

  // Никаких принудительных колонок — только то, что пользователь включил
  // в «Настроить видимые поля». Если пользователь ничего не выбрал —
  // показываем дефолт, чтобы таблица не была совсем пустой.
  if (cols.length === 0) {
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
     } else if (sortField === 'lastCalibration') {
      va = String(a.last_calibration || '').toLowerCase();
      vb = String(b.last_calibration || '').toLowerCase();
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