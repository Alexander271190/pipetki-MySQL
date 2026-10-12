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

    // Обязательная смена/установка пароля: сервер вернул 403 с кодом
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