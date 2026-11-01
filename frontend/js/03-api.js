// ============================================================
// API КЛИЕНТ
// ============================================================

// Технические сообщения — их не показываем пользователю, заменяем на generic
function _isTechnicalMessage(msg) {
  if (!msg) return true;
  return /^(ER_|Error:|SQL|Duplicate entry|Unknown column|Cannot read|TypeError|ReferenceError|SyntaxError)/i.test(msg)
      || /\bER_[A-Z_]+\b/.test(msg)
      || /\bsqlMessage\b/.test(msg)
      || /at\s+[\w.]+\s+\(/.test(msg); // stack trace
}

// Универсальный построитель человекочитаемого сообщения об ошибке
// Приоритет: 1) code из ERROR_HINTS → 2) осмысленный текст сервера → 3) HTTP-фоллбэк
function _buildErrorMessage(body, status) {
  const code = body && body.code;
  const fallbackKey = `http_${status}`;
  const serverError = (body && body.error && String(body.error).trim())
    ? String(body.error).trim()
    : null;

  if (code && ERROR_HINTS[code]) {
    const i = ERROR_HINTS[code];
    return i.hint ? `${i.title}\n${i.hint}` : i.title;
  }
  if (serverError && !_isTechnicalMessage(serverError)) {
    return serverError;
  }
  if (ERROR_HINTS[fallbackKey]) {
    const i = ERROR_HINTS[fallbackKey];
    return i.hint ? `${i.title}\n${i.hint}` : i.title;
  }
  return serverError || `Ошибка ${status}`;
}

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

  if (response.status === 403 && !endpoint.startsWith('/auth/')) {
    let body = null;
    try { body = await response.clone().json(); } catch (e) { /* ignore */ }
    if (body && body.code === 'password_change_required') {
      openChangePasswordModal(true, 'change');
      throw new Error('Требуется смена пароля');
    }
    if (body && body.code === 'password_setup_required') {
      openChangePasswordModal(true, 'setup');
      throw new Error('Требуется установка пароля');
    }
  }

  const now = Date.now();
  if (!endpoint.startsWith('/auth/') && now - _lastPermsCheck > 60_000) {
    _lastPermsCheck = now;
    refreshCurrentUser();
  }

  let result;
  try {
    result = await response.json();
  } catch (e) {
    result = { error: `Ошибка ${response.status}: сервер вернул некорректный ответ` };
  }

  if (!response.ok) {
    // ❗ ВАЖНО: result уже прочитан выше. Не читаем response.json() повторно.
    const message = _buildErrorMessage(result, response.status);
    const error = new Error(message);
    error.status = response.status;
    error.code = result.code || `http_${response.status}`;
    error.response = result;
    throw error;
  }
  return result;
}

// ============================================================
// СКАЧИВАНИЕ ФАЙЛОВ (с обработкой 401)
// ============================================================
async function downloadFile(url, options = {}, defaultFilename) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

  try {
    const response = await fetch(url, { ...options, headers });

    // Истекшая сессия
    if (response.status === 401) {
      clearSession();
      renderAuthUI();
      showToast('Сессия истекла, войдите заново', 'error');
      throw new Error('Неавторизован');
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const message = _buildErrorMessage(err, response.status);
      const error = new Error(message);
      error.status = response.status;
      error.code = err.code || `http_${response.status}`;
      error.response = err;
      throw error;
    }

    // Имя файла из заголовка или дефолтное
    const disposition = response.headers.get('Content-Disposition');
    let filename = defaultFilename;
    if (disposition && !defaultFilename) {
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match) filename = decodeURIComponent(match[1]);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'download';
    a.click();
    URL.revokeObjectURL(blobUrl);

    return true;
  } catch (e) {
    if (e.message !== 'Неавторизован') {
      showToast(e.message || 'Ошибка скачивания', 'error');
    }
    throw e;
  }
}
