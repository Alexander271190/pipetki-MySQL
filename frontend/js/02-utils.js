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
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd',
    'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i',
    'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
    'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
    'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch',
    'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '',
    'э': 'e', 'ю': 'yu', 'я': 'ya'
  };
  return String(s)
    .toLowerCase()
    .split('')
    .map(ch => map[ch] !== undefined ? map[ch] : ch)
    .join('');
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

    icon.innerHTML = options.icon || '<i class="fa-solid fa-triangle-exclamation"></i>';
    title.textContent = options.title || 'Подтверждение';
    text.textContent  = message;
    okBtn.textContent = options.okText || 'ОК';
    okBtn.className   = 'btn ' + (options.okClass || 'btn-danger');
    const cancelBtn = modal.querySelector('.confirm-actions .btn-secondary');
    if (cancelBtn) cancelBtn.textContent = options.cancelText || 'Отмена';

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

// ============================================================
// PROMPT — замена нативного prompt()
// ============================================================
let _promptResolver = null;
let _promptValidator = null;

function showPrompt(message, options = {}) {
  if (_promptResolver) {
    const prev = _promptResolver;
    _promptResolver = null;
    try { prev(null); } catch (e) {}
  }

  return new Promise(resolve => {
    _promptResolver = resolve;
    _promptValidator = options.validator || null;

    const modal   = document.getElementById('prompt-modal');
    const iconEl  = document.getElementById('prompt-icon');
    const title   = document.getElementById('prompt-title');
    const msgEl   = document.getElementById('prompt-message');
    const input   = document.getElementById('prompt-input');
    const okBtn   = document.getElementById('prompt-ok-btn');
    const errEl   = document.getElementById('prompt-error');

    if (options.icon) {
      iconEl.innerHTML = '<i class="fa-solid ' + options.icon + '"></i>';
    } else {
      iconEl.innerHTML = '<i class="fa-solid fa-comment-dots"></i>';
    }

    title.textContent = options.title || 'Введите значение';
    msgEl.textContent = message;
    input.value       = options.defaultValue || '';
    input.placeholder = options.placeholder || '';
    input.type        = options.inputType || 'text';
    input.classList.remove('invalid');
    okBtn.textContent = options.okText || 'ОК';
    okBtn.className   = 'btn ' + (options.okClass || 'btn-primary');
    errEl.textContent = '';
    errEl.style.display = 'none';

    modal.classList.add('active');
    setTimeout(() => { input.focus(); input.select(); }, 100);
  });
}

function submitPrompt() {
  const input = document.getElementById('prompt-input');
  const errEl = document.getElementById('prompt-error');
  const value = input.value.trim();

  if (_promptValidator) {
    const err = _promptValidator(value);
    if (err) {
      errEl.textContent = err;
      errEl.style.display = 'block';
      input.classList.add('invalid');
      input.focus();
      return;
    }
  }

  input.classList.remove('invalid');
  errEl.textContent = '';
  errEl.style.display = 'none';

  const resolve = _promptResolver;
  _promptResolver = null;
  _promptValidator = null;

  document.getElementById('prompt-modal').classList.remove('active');
  if (resolve) resolve(value);
}

function resolvePrompt(value) {
  const modal = document.getElementById('prompt-modal');
  if (modal) modal.classList.remove('active');

  const resolve = _promptResolver;
  _promptResolver = null;
  _promptValidator = null;
  if (resolve) resolve(value);
}

document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('prompt-modal');
  if (!modal || !modal.classList.contains('active')) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    submitPrompt();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    resolvePrompt(null);
  }
});

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'prompt-modal') resolvePrompt(null);
});

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
// 🆕 Универсальное окно блокировки (снимает блокировку при "Да")
// ============================================================
async function showLockWarning(lockRes, actionName = 'выполнить действие') {
  const name = lockRes.lockedBy || 'Другой пользователь';
  const pos = lockRes.lockedByPosition;
  const posText = pos ? ` (${pos})` : '';
  const ok = await showConfirm(
    `Пользователь ${name}${posText} уже редактирует этот прибор.\n\nВы хотите снять блокировку, чтобы ${actionName.toLowerCase()}?`,
    { 
      icon: '<i class="fa-solid fa-lock" style="color: var(--warn);"></i>', 
      title: 'Внимание', 
      okText: 'Да', 
      cancelText: 'Нет', 
      okClass: 'btn-danger' 
    }
  );
  
  if (ok) {
    try {
      await apiRequest(`/pipettes/${lockRes.pipetteId}/lock`, 'DELETE');
      showToast('Блокировка снята', 'success');
      return true; 
    } catch (e) {
      showToast('Ошибка снятия блокировки', 'error');
      return false;
    }
  }
  
  return false; 
}

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
