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
let _equipmentTypesDraft = []; 
let _responsibles = [];                
let _bulkSendIds = [];    
let _bulkReturnIds = [];
let _dataLoadedForUser = null;
const USERS_CACHE_TTL = 30_000;
let _cachedUsersList = null;
let _cachedUsersTime = 0;

// ============================================================
// 🆕 СТРУКТУРА РАЗДЕЛОВ НАСТРОЕК
// ============================================================
const SETTINGS_SECTIONS = [
   {
    group: 'Оборудование и данные',
  items: [
    { id: 'fields',          label: 'Поля формы' },
    { id: 'departments',     label: 'Отделы' },
    { id: 'filters',         label: 'Фильтры' },
    { id: 'export', label: 'Печать документов' },
    { id: 'equipment',       label: 'Типы оборудования' },
    { id: 'view-templates',  label: 'Шаблоны вида' },
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
    { id: 'help',        label: 'Справка' },
    { id: 'general',     label: 'Общие' },
    { id: 'log',         label: 'Журнал действий' },
  ]
}
];

// ============================================================
// 🆕 СПИСОК ПРАВ (16 штук, по 5 группам)
// ============================================================
  const ALL_PERMISSIONS = [
  { key: 'add_pipette',       group: 'Оборудование', label: '<i class="fa-solid fa-plus"></i> Добавление оборудования' },
  { key: 'edit_pipette',      group: 'Оборудование', label: '<i class="fa-solid fa-pen"></i> Редактирование оборудования' },
  { key: 'delete_pipette',    group: 'Оборудование', label: '<i class="fa-solid fa-trash"></i> Удаление оборудования' },
  { key: 'quick_calibration', group: 'Оборудование', label: '<i class="fa-solid fa-clipboard-check"></i> Быстрая поверка' },
  { key: 'transfer_pipette',  group: 'Оборудование', label: '<i class="fa-solid fa-right-left"></i> Передача в другой отдел' },
  { key: 'bulk_change_responsible', group: 'Оборудование', label: '<i class="fa-solid fa-user-pen"></i> Массовая смена ответственного' },

  { key: 'bulk_send',         group: 'Поверки',      label: '<i class="fa-solid fa-box"></i> Отправка на поверку' },
  { key: 'bulk_return',       group: 'Поверки',      label: '<i class="fa-solid fa-box-open"></i> Возврат с поверки' },

  { key: 'import_data',       group: 'Данные',       label: '<i class="fa-solid fa-download"></i> Импорт данных' },
  { key: 'export_data', group: 'Данные', label: '<i class="fa-solid fa-print"></i> Печать документов' },

  { key: 'scan_barcode',      group: 'Штрихкоды',    label: '<i class="fa-solid fa-barcode"></i> Сканирование штрихкодов' },
  { key: 'print_labels',      group: 'Штрихкоды',    label: '<i class="fa-solid fa-tag"></i> Печать этикеток' },
  { key: 'manage_barcodes',   group: 'Штрихкоды',    label: '<i class="fa-solid fa-wand-magic-sparkles"></i> Ручной ввод / сброс штрихкодов' },

  { key: 'manage_users',      group: 'Администрирование', label: '<i class="fa-solid fa-users"></i> Управление пользователями' },
  { key: 'manage_settings',   group: 'Администрирование', label: '<i class="fa-solid fa-gear"></i> Настройки системы' },
  { key: 'manage_printers',   group: 'Администрирование', label: '<i class="fa-solid fa-print"></i> Управление принтерами' },
  { key: 'view_log',          group: 'Администрирование', label: '<i class="fa-solid fa-scroll"></i> Просмотр журнала' },

  { key: 'view_history',      group: 'Общие',        label: '<i class="fa-solid fa-clock-rotate-left"></i> Просмотр истории поверок' },
  { key: 'view_audit',        group: 'Общие',        label: '<i class="fa-solid fa-clipboard-list"></i> Просмотр аудита изменений' },
];
