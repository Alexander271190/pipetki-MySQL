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
    const error = new Error(result.error || 'Ошибка запроса');
    error.status = response.status;
    error.response = result;
    throw error;
  }
  return result;
}

// 🆕 Универсальная функция скачивания файлов с обработкой 401
async function downloadFile(url, options = {}, defaultFilename) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

  try {
    const response = await fetch(url, { ...options, headers });

    // 🆕 Обработка истекшей сессии
    if (response.status === 401) {
      clearSession();
      renderAuthUI();
      showToast('Сессия истекла, войдите заново', 'error');
      throw new Error('Неавторизован');
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка скачивания файла');
    }

    // Получаем имя файла из заголовка или используем дефолтное
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
