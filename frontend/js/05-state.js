'use strict';

// ============================================================
// СОСТОЯНИЕ
// ============================================================
let _loadPipettePromise = null;
let pipettes = [];          
let settings = { warnDays: 30 };
let sortField = 'nextCalibration';
let sortDir = 1;
let currentPage = 1;
let pageSize = 100;
let currentHistoryId = null;
let departmentsList = [];

// 🆕 Состояние серверной пагинации
let pagedState = {
  items: [],
  total: 0,
  page: 1,
  limit: 100,
  totalPages: 1,
  counters: { ok: 0, warn: 0, danger: 0, total: 0 },
};

// 🆕 Статистика + напоминания (с сервера)
let statsState = {
  counters: { ok: 0, warn: 0, danger: 0, total: 0 },
  reminders: { danger: [], warn: [] },
};

// ============================================================
// ЗАГРУЗКА ДАННЫХ
// ============================================================
async function loadPipetteData() {
  if (!isAuthenticated()) return;

  // 🆕 Если уже идёт загрузка — возвращаем тот же Promise
  if (_loadPipettePromise) return _loadPipettePromise;

  _loadPipettePromise = (async () => {
    try {
      // ── 1) prefs (нужны до синхронизации с fields) ──
      if (!myPrefs._loaded) {
        try {
          myPrefs = await apiRequest('/settings/my-preferences/effective') || {};
          myPrefs._loaded = true;
        } catch (e) {
          try {
            myPrefs = await apiRequest('/settings/my-preferences') || {};
            myPrefs._loaded = true;
          } catch (e2) {
            myPrefs = { _loaded: true };
          }
        }
      }

      // ── 2) Параллельно: settings, types, export, fields, responsibles, departments ──
      const needsResponsibles =
        currentUser.role === 'admin' ||
        isSeniorLab() ||
        canTransferPipette() ||
        canBulkChangeResponsible();

      const [
        settingsData,
        typesResult,
        exportResult,
        fieldsResult,
        responsiblesResult,
        departmentsResult,
      ] = await Promise.all([
        apiRequest('/settings/system').catch(() => null),
        apiRequest('/settings/equipment-types').catch(() => null),
        apiRequest('/settings/export').catch(() => null),
        apiRequest('/settings/fields').catch(() => []),
        needsResponsibles
          ? apiRequest('/users/responsibles').catch((e) => {
              console.warn('Не удалось загрузить список ответственных:', e.message);
              return [];
            })
          : Promise.resolve([]),
        apiRequest('/settings/departments').catch(() => []),
      ]);

      settings = { warnDays: parseInt(settingsData?.warn_days) || 30 };

      if (Array.isArray(typesResult) && typesResult.length > 0) {
        _equipmentTypes = typesResult;
      } else {
        _equipmentTypes = [
          { value: 'pipette',     label: 'Пипетка',     prefix: 'P', calibrationPlace: 'external', interval: 12 },
          { value: 'analyzer',    label: 'Анализатор',  prefix: 'A', calibrationPlace: 'external', interval: 12 },
          { value: 'thermometer', label: 'Термометр',   prefix: 'T', calibrationPlace: 'internal', interval: 12 },
          { value: 'scales',      label: 'Весы',        prefix: 'S', calibrationPlace: 'internal', interval: 12 },
          { value: 'photometer',  label: 'Фотометр',    prefix: 'F', calibrationPlace: 'internal', interval: 12 },
          { value: 'microscope',  label: 'Микроскоп',   prefix: 'M', calibrationPlace: 'internal', interval: 12 },
        ];
      }

      exportFields = exportResult;
      _cachedFields = Array.isArray(fieldsResult) ? fieldsResult : [];
      _responsibles = Array.isArray(responsiblesResult) ? responsiblesResult : [];
      departmentsList = Array.isArray(departmentsResult) ? departmentsResult : [];

      // ── 3) Синхронизация visibleFields с активными полями field_config ──
      if (Array.isArray(_cachedFields) && _cachedFields.length > 0) {
        const activeFieldIds = _cachedFields
          .filter(f => f.enabled)
          .map(f => f.id);

        const VIRTUAL_IDS = ['status', 'nextCalibration'];
        const hasUserSettings =
          Array.isArray(myPrefs.visibleFields) &&
          myPrefs.visibleFields.length > 0;

        if (!hasUserSettings) {
          myPrefs.visibleFields = [...activeFieldIds, ...VIRTUAL_IDS];
        } else {
          const allowedSet = new Set([...activeFieldIds, ...VIRTUAL_IDS]);
          const visibleSet = new Set(myPrefs.visibleFields);

          if (!myPrefs._virtualsInitialized) {
            for (const vid of VIRTUAL_IDS) {
              if (!visibleSet.has(vid)) visibleSet.add(vid);
            }
          }

          myPrefs.visibleFields = [...visibleSet].filter(id => allowedSet.has(id));
        }
      }

      // ── 4) filters (зависит от departments и types) ──
      await loadFilterConfig();

      // ── 5) Параллельно: paged + stats ──
      await Promise.all([loadPaged(), loadStats()]);

      render();
      checkReminder();
    } catch (error) {
      console.error('Error loading data:', error);
      if (error.message === 'Неавторизован') return;
      showToast('Ошибка загрузки данных', 'error');
    } finally {
      _loadPipettePromise = null;
    }
  })();

  return _loadPipettePromise;
}
// ============================================================
// 🆕 СЕРВЕРНАЯ ПАГИНАЦИЯ — загрузка одной страницы
// ============================================================
async function loadPaged() {
  if (!isAuthenticated()) return;

  try {
    const params = new URLSearchParams();
    params.set('page', String(currentPage));
    params.set('limit', String(pageSize));
    params.set('sort', sortField);
    params.set('dir', sortDir > 0 ? 'asc' : 'desc');

    const searchVal = (document.getElementById('search')?.value || '').trim();
    if (searchVal) params.set('search', searchVal);

    // Фильтры — только непустые значения
    const filtersObj = {};
    for (const [k, v] of Object.entries(filterState || {})) {
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'object' && v.period === '') continue;
      filtersObj[k] = v;
    }
    if (Object.keys(filtersObj).length > 0) {
      params.set('filters', JSON.stringify(filtersObj));
    }

    const data = await apiRequest('/pipettes/paged?' + params.toString());

    pagedState = {
      items: Array.isArray(data.items) ? data.items : [],
      total: Number(data.total) || 0,
      page: Number(data.page) || 1,
      limit: Number(data.limit) || pageSize,
      totalPages: Math.max(1, Number(data.totalPages) || 1),
      counters: data.counters || { ok: 0, warn: 0, danger: 0, total: 0, sent: 0, wip: 0, fail: 0, unknownDate: 0, inactive: 0 },
    };

    // Если сервер вернул другую страницу — синхронизируемся
    if (currentPage > pagedState.totalPages) {
      currentPage = pagedState.totalPages;
    }

    // 🆕 pipettes = текущая страница (для 07-actions, 09-form, 10-bulk)
    pipettes = pagedState.items;
  } catch (e) {
    console.error('loadPaged error:', e);
    showToast('Ошибка загрузки данных', 'error');
    pagedState = {
      items: [], total: 0, page: 1, limit: pageSize, totalPages: 1,
      counters: { ok: 0, warn: 0, danger: 0, total: 0 },
    };
    pipettes = [];
  }
}

// ============================================================
// 🆕 СТАТИСТИКА (напоминания) — для 16-reminders.js (этап B)
// ============================================================
async function loadStats() {
  if (!isAuthenticated()) return;

  try {
    const data = await apiRequest('/pipettes/stats');
    statsState = {
      counters: data.counters || { ok: 0, warn: 0, danger: 0, total: 0 },
      reminders: data.reminders || { danger: [], warn: [] },
    };
  } catch (e) {
    console.error('loadStats error:', e);
    statsState = {
      counters: { ok: 0, warn: 0, danger: 0, total: 0 },
      reminders: { danger: [], warn: [] },
    };
  }
}

// ============================================================
// 🆕 ID по фильтру (для экспорта/печати всего фильтра) — этап C
// ============================================================
async function loadIdsForExport() {
  try {
    const params = new URLSearchParams();
    const searchVal = (document.getElementById('search')?.value || '').trim();
    if (searchVal) params.set('search', searchVal);

    const filtersObj = {};
    for (const [k, v] of Object.entries(filterState || {})) {
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'object' && v.period === '') continue;
      filtersObj[k] = v;
    }
    if (Object.keys(filtersObj).length > 0) {
      params.set('filters', JSON.stringify(filtersObj));
    }

    const data = await apiRequest('/pipettes/ids?' + params.toString());
    return Array.isArray(data.ids) ? data.ids : [];
  } catch (e) {
    console.error('loadIdsForExport error:', e);
    return [];
  }
}

// ============================================================
// 🆕 Все записи по фильтру — для экспорта Excel/PDF (этап C)
// ============================================================
async function loadAllForExport() {
  try {
    const params = new URLSearchParams();
    params.set('sort', sortField);
    params.set('dir', sortDir > 0 ? 'asc' : 'desc');

    const searchVal = (document.getElementById('search')?.value || '').trim();
    if (searchVal) params.set('search', searchVal);

    const filtersObj = {};
    for (const [k, v] of Object.entries(filterState || {})) {
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'object' && v.period === '') continue;
      filtersObj[k] = v;
    }
    if (Object.keys(filtersObj).length > 0) {
      params.set('filters', JSON.stringify(filtersObj));
    }

    const data = await apiRequest('/pipettes/all?' + params.toString());
    return Array.isArray(data.items) ? data.items : [];
  } catch (e) {
    console.error('loadAllForExport error:', e);
    return [];
  }
}

// ============================================================
// Отделы / фильтры (без изменений)
// ============================================================
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

function syncFilterState() {
  const activeIds = new Set(_activeFilters.map(f => f.id));
  for (const id of Object.keys(filterState)) {
    if (!activeIds.has(id)) delete filterState[id];
  }

  for (const f of _activeFilters) {
    if (f.type !== 'select' || !Array.isArray(f.options) || f.options.length === 0) continue;
    const current = filterState[f.id];
    if (current === undefined || current === null || current === '') continue;
    const validValues = new Set(f.options.map(o => String(o.value)));
    if (!validValues.has(String(current))) delete filterState[f.id];
  }
}

// ============================================================
// СТАТУСЫ (клиентский fallback)
// ============================================================
function calcStatus(p) {
  return (p && p.computed_status) || 'unknown';
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
// КОЛОНКИ ТАБЛИЦЫ
// ============================================================
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

const SYSTEM_FIELD_IDS_IN_CONFIG = new Set([
  'id', 'serial', 'manufacturer', 'model', 'equipmentType',
  'volume', 'department', 'interval', 'lastCalibration', 'cert',
  'result', 'active', 'responsible', 'location', 'notes'
]);
let _allColumnsCache = null;
let _allColumnsCacheFor = null;
function getAllTableColumns() {
  // 🆕 Возврат из кэша, если _cachedFields не переприсваивался
  if (_allColumnsCache && _allColumnsCacheFor === _cachedFields) {
    return _allColumnsCache;
  }

  const result = [];
  const added = new Set();

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
      result.push({ id: f.id, label: f.label, sortable: true, field: f.id });
      added.add(f.id);
    }
  }

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

  // 🆕 Сохранить в кэш
  _allColumnsCache = result;
  _allColumnsCacheFor = _cachedFields;

  return result;
}

function getDefaultTableColumns() {
  const SYSTEM_SKIP_IN_TABLE = new Set(['id', 'equipmentType']);
  const cols = [];

  for (const f of (_cachedFields || [])) {
    if (!f.enabled) continue;
    if (SYSTEM_FIELD_IDS_IN_CONFIG.has(f.id)) {
      if (!SYSTEM_SKIP_IN_TABLE.has(f.id)) {
        const tableId = (f.id === 'equipmentType') ? 'type' : f.id;
        cols.push(tableId);
      }
    } else {
      cols.push(f.id);
    }
  }

  const lastCalIdx = cols.indexOf('lastCalibration');
  if (lastCalIdx !== -1) {
    cols.splice(lastCalIdx + 1, 0, 'nextCalibration');
  } else if (!cols.includes('nextCalibration')) {
    cols.push('nextCalibration');
  }

  if (!cols.includes('status')) cols.push('status');

  if (cols.length <= 2) return [...DEFAULT_TABLE_COLUMNS];
  return cols;
}

function findColumn(id) {
  return getAllTableColumns().find(c => c.id === id);
}

function getActiveTableColumns() {
  const allOrdered = getAllTableColumns();

  if (!myPrefs.visibleFields || !Array.isArray(myPrefs.visibleFields) || myPrefs.visibleFields.length === 0) {
    return getDefaultTableColumns();
  }

  const TABLE_ID_MAP = { equipmentType: 'type' };
  const visible = new Set(myPrefs.visibleFields);
  const cols = [];
  const added = new Set();

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

  const VIRTUAL_IDS = ['status', 'nextCalibration'];
  for (const vid of VIRTUAL_IDS) {
    if (!visible.has(vid)) continue;
    if (added.has(vid)) continue;
    const def = allOrdered.find(c => c.id === vid);
    if (!def) continue;

    if (vid === 'nextCalibration') {
      const lastCalIdx = cols.indexOf('lastCalibration');
      if (lastCalIdx !== -1) cols.splice(lastCalIdx + 1, 0, vid);
      else cols.push(vid);
    } else {
      cols.push(vid);
    }
    added.add(vid);
  }

  if (cols.length === 0) return getDefaultTableColumns();
  return cols;
}

async function refreshAfterSettingsChange() {
  currentPage = 1;
  await loadPaged();
  render();
}

function getActiveFormFields(allFields) {
  const enabled = allFields.filter(f => f.enabled);
  if (!myPrefs.visibleFields || !Array.isArray(myPrefs.visibleFields) || myPrefs.visibleFields.length === 0) {
    return enabled;
  }
  const visible = new Set(myPrefs.visibleFields);
  return enabled.filter(f => visible.has(f.id));
}

