// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
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
// ВАЛИДАЦИЯ ПАРОЛЯ (клиент)
// ============================================================
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