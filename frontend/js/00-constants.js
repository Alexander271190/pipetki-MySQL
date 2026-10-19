'use strict';

// ============================================================
// ГЛОБАЛЬНЫЕ КОНСТАНТЫ
// ============================================================

// ── Статусы приборов ──
const STATUS_LABELS = {
  ok:       'В норме',
  warn:     'Скоро поверка',
  danger:   'Просрочена',
  inactive: 'Неактивна',
  sent:     'На поверке',
  fail:     'Брак',
  wip:      'В процессе',
  unknown:  'Не задано'
};

const STATUS_ICONS = {
  ok:       'fa-circle-check',
  warn:     'fa-clock',
  danger:   'fa-triangle-exclamation',
  inactive: 'fa-circle-pause',
  sent:     'fa-box',
  fail:     'fa-xmark',
  wip:      'fa-hourglass-half',
  unknown:  'fa-circle-question'
};

const STATUS_COLORS = {
  ok:       '#16a34a',
  warn:     '#eab308',
  danger:   '#dc2626',
  inactive: '#94a3b8',
  sent:     '#0ea5e9',
  fail:     '#dc2626',
  wip:      '#eab308',
  unknown:  '#94a3b8'
};

const STATUS_ORDER = {
  danger:   1,
  fail:     2,
  wip:      3,
  warn:     4,
  sent:     5,
  ok:       6,
  inactive: 7,
  unknown:  8
};

// ── Результаты поверки ──
const RESULT_LABELS = {
  pass: 'Годен',
  fail: 'Брак',
  wip:  'В процессе'
};

// ── Роли ──
const ROLE_LABELS = {
  user:       'Пользователь',
  senior_lab: 'Ст. лаборант',
  admin:      'Администратор'
};

// ── Иконки (ключ → FA-класс) ──
const ICONS = {
  trash:      'fa-trash',
  edit:       'fa-pen',
  add:        'fa-plus',
  save:       'fa-floppy-disk',
  spinner:    'fa-spinner fa-spin',
  close:      'fa-xmark',
  check:      'fa-check',
  arrowUp:    'fa-arrow-up',
  arrowDown:  'fa-arrow-down',
  arrowLeft:  'fa-arrow-left',
  arrowRight: 'fa-arrow-right',
  history:    'fa-clock-rotate-left',
  transfer:   'fa-right-left',
  box:        'fa-box',
  boxOpen:    'fa-box-open',
  barcode:    'fa-barcode',
  print:      'fa-print',
  warning:    'fa-triangle-exclamation',
  users:      'fa-users',
  gear:       'fa-gear',
  key:        'fa-key',
  lock:       'fa-lock',
  rotateLeft: 'fa-rotate-left',
  wand:       'fa-wand-magic-sparkles',
  plug:       'fa-plug',
  fileLines:  'fa-file-lines',
  bell:       'fa-bell'
};

// ── Цвета (для JS-рендера) ──
const COLORS = {
  danger:  '#dc2626',
  success: '#16a34a',
  warning: '#eab308',
  info:    '#0ea5e9',
  primary: '#4f46e5',
  text:    '#1a1a2e',
  muted:   '#64748b',
  faint:   '#94a3b8'
};
