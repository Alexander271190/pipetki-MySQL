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
    { id: 'fields',          label: 'Поля формы' },
    { id: 'departments',     label: 'Отделы' },
    { id: 'filters',         label: 'Фильтры' },
    { id: 'export',          label: 'Экспорт' },
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
  { key: 'add_pipette',       group: 'Оборудование',      label: '➕ Добавление оборудования' },
  { key: 'edit_pipette',      group: 'Оборудование',      label: '✏️ Редактирование оборудования' },
  { key: 'delete_pipette',    group: 'Оборудование',      label: '🗑️ Удаление оборудования' },
  { key: 'quick_calibration', group: 'Оборудование',      label: '✓ Быстрая поверка' },
  { key: 'transfer_pipette',  group: 'Оборудование',      label: '🔀 Передача в другой отдел' },
  { key: 'bulk_change_responsible', group: 'Оборудование', label: '👤 Массовая смена ответственного' },

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