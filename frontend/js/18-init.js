'use strict';

// ============================================================
// UI АВТОРИЗАЦИИ
// ============================================================
function renderAuthUI() {
  const authContainer = document.getElementById('auth-container');
  const mainContent = document.getElementById('main-content');

  if (isAuthenticated()) {
    authContainer.classList.add('hidden');
    mainContent.classList.add('visible');

    document.getElementById('user-fullname').textContent = currentUser.fullName;
    let posText = currentUser.position +
      (currentUser.role === 'admin' ? ' (админ)'
        : currentUser.role === 'senior_lab' ? ' (ст. лаборант)' : '');
    if (currentUser.isActing) {
      posText += currentUser.actingForName
        ? ` · и.о. за ${currentUser.actingForName}`
        : ' · и.о.';
    }
    if (currentUser.department) posText += ' · ' + currentUser.department;
    document.getElementById('user-position').textContent = posText;

    const btnStop = document.getElementById('btn-impersonate-stop');
    if (btnStop) {
      btnStop.style.display = isImpersonating() ? 'inline-flex' : 'none';
    }

    const admin           = isAdmin();
    const canAdd          = canAddPipette();
    const canImportData   = canImport();
    const canExportData   = canExport();
    const canSettings     = canManageSettings();
    const canScan         = canScanBarcode() && !isMobileDevice();
    const canPrint        = canPrintLabels();

   document.querySelectorAll('.btn-add-pipette').forEach(el => {
      const isDropdown = el.classList.contains('dropdown-item');
      el.style.display = canAdd ? (isDropdown ? 'flex' : 'inline-flex') : 'none';
    });
    document.querySelectorAll('.btn-import').forEach(el =>
      el.style.display = canImportData ? 'inline-flex' : 'none');
    document.querySelectorAll('.btn-export').forEach(el =>
      el.style.display = canExportData ? 'inline-flex' : 'none');
    document.querySelectorAll('.btn-settings').forEach(el =>
      el.style.display = canSettings ? 'inline-flex' : 'none');
    document.querySelectorAll('.btn-scan-barcode').forEach(el =>
      el.style.display = canScan ? 'inline-flex' : 'none');
   const canViewAuditLog = canViewLog();
    document.querySelectorAll('.btn-audit-log').forEach(el =>
      el.style.display = canViewAuditLog ? 'flex' : 'none');
    document.querySelectorAll('.btn-print-labels').forEach(el =>
      el.style.display = canPrint ? 'inline-flex' : 'none');

    const hasAnyRowAction = canEditPipette() || canDeletePipette() || canQuickCal() || canViewHistory();
    const actionsHeader = document.getElementById('actions-header');
    if (actionsHeader) actionsHeader.style.display = hasAnyRowAction ? '' : 'none';

    document.body.classList.toggle('can-manage', canAdd || canEditPipette() || canDeletePipette());
    document.body.classList.toggle('can-import', canImportData);
    document.body.classList.toggle('can-export', canExportData);
    document.body.classList.toggle('is-admin', admin);
    if (currentUser.mustSetPassword) {
      openChangePasswordModal(true, 'setup');
    } else if (currentUser.mustChangePassword) {
      openChangePasswordModal(true, 'change');
    } else {
      closeChangePasswordModal();

      if (_dataLoadedForUser !== currentUser.id) {
        _dataLoadedForUser = currentUser.id;
        loadPipetteData();
      }
    }

    if (typeof updateMoreMenuVisibility === 'function') {
      setTimeout(updateMoreMenuVisibility, 0);
    }

  } else {
    closeChangePasswordModal();
    authContainer.classList.remove('hidden');
    mainContent.classList.remove('visible');
    document.body.classList.remove('can-manage', 'can-import', 'can-export', 'is-admin');
    const btnStop = document.getElementById('btn-impersonate-stop');
    if (btnStop) btnStop.style.display = 'none';

    const loginBtn = document.getElementById('login-btn');
    const loginBtnIcon = document.getElementById('login-btn-icon');
    const loginBtnText = document.getElementById('login-btn-text');
    if (loginBtn) loginBtn.disabled = false;
    if (loginBtnIcon) loginBtnIcon.className = 'fa-solid fa-right-to-bracket';
    if (loginBtnText) loginBtnText.textContent = 'Войти';
    const uInput = document.getElementById('login-username');
    const pInput = document.getElementById('login-password');
    if (uInput) uInput.disabled = false;
    if (pInput) { pInput.disabled = false; pInput.value = ''; }

    _dataLoadedForUser = null;
  }
}

// ============================================================
// МЕНЮ «ЕЩЁ ▼»
// ============================================================
function toggleMoreMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('more-menu');
  if (menu) menu.classList.toggle('show');
}

function closeMoreMenu() {
  const menu = document.getElementById('more-menu');
  if (menu) menu.classList.remove('show');
}

document.addEventListener('click', (e) => {
  const dd = document.getElementById('more-dropdown');
  if (dd && !dd.contains(e.target)) closeMoreMenu();
});

function updateMoreMenuVisibility() {
  const dd = document.getElementById('more-dropdown');
  if (!dd) return;
  const hasVisible = Array.from(dd.querySelectorAll('.dropdown-item'))
    .some(el => el.style.display !== 'none');
  dd.style.display = hasVisible ? 'inline-block' : 'none';
}

// ============================================================
// КОМПАКТНЫЙ РЕЖИМ
// ============================================================
function toggleCompactMode() {
  const isCompact = document.body.classList.toggle('compact-mode');
  try {
    localStorage.setItem('pipette_compact_mode', isCompact ? '1' : '0');
  } catch (e) {}
}

(function initCompactMode() {
  try {
    if (localStorage.getItem('pipette_compact_mode') === '1') {
      document.body.classList.add('compact-mode');
    }
  } catch (e) {}
})();

// ============================================================
// СВОРАЧИВАНИЕ ШАПКИ
// ============================================================
function updateHeaderMiniStats() {
  const el = document.getElementById('header-mini-stats');
  if (!el) return;
  const ok = document.getElementById('stat-ok')?.textContent || '0';
  const total = document.getElementById('stat-total')?.textContent || '0';
  el.innerHTML = `<i class="fa-solid fa-circle-check" style="opacity:.8;"></i> <b>${ok}</b>/${total} в норме`;
}

function toggleHeaderCollapse() {
  const header = document.getElementById('main-header');
  if (!header) return;

  const collapsed = !header.classList.contains('collapsed');
  header.classList.toggle('collapsed', collapsed);

  try { localStorage.setItem('pipette_header_collapsed', collapsed ? '1' : '0'); } catch (e) {}

  const btn = document.getElementById('header-collapse-btn');
  if (btn) {
    const label = btn.querySelector('.collapse-label');
    if (label) {
      label.innerHTML = collapsed
        ? '<i class="fa-solid fa-chevron-down"></i> Развернуть'
        : '<i class="fa-solid fa-chevron-up"></i> Свернуть';
    }
    btn.title = collapsed ? 'Развернуть шапку' : 'Свернуть шапку';
  }
} // 🆕 ВОТ ЭТА СКОБКА БЫЛА ПРОПУЩЕНА

(function initHeaderCollapse() {
  try {
    const header = document.getElementById('main-header');
    // 🆕 На ПК (шире 768px) принудительно разворачиваем шапку
    if (window.innerWidth > 768) {
      if (header) header.classList.remove('collapsed');
      return;
    }

    const saved = localStorage.getItem('pipette_header_collapsed');
    if (saved === '1') {
      if (header) header.classList.add('collapsed');
      const btn = document.getElementById('header-collapse-btn');
      if (btn) {
        const label = btn.querySelector('.collapse-label');
        if (label) label.innerHTML = '<i class="fa-solid fa-chevron-down"></i> Развернуть';
      }
    }
  } catch (e) {}
})();

// Автоматически разворачиваем шапку, если окно растянули на ПК
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    const header = document.getElementById('main-header');
    if (header && header.classList.contains('collapsed')) {
      header.classList.remove('collapsed');
      const btn = document.getElementById('header-collapse-btn');
      if (btn) {
        const label = btn.querySelector('.collapse-label');
        if (label) label.innerHTML = '<i class="fa-solid fa-chevron-up"></i> Свернуть';
      }
    }
  }
});

(function wrapRenderForMiniStats() {
  if (typeof render !== 'function') return;
  const origRender = window.render;
  window.render = function() {
    const result = origRender.apply(this, arguments);
    try { updateHeaderMiniStats(); } catch (e) {}
    return result;
  };
})();

// ============================================================
// ТЁМНАЯ ТЕМА
// ============================================================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('pipette_theme', theme); } catch (e) {}
  const btn = document.getElementById('theme-btn');
  if (btn) {
    btn.innerHTML = theme === 'dark'
      ? '<i class="fa-solid fa-sun"></i>'
      : '<i class="fa-solid fa-moon"></i>';
  }

  // 🆕 Синхронизация темы Jodit, если редактор открыт
  if (typeof helpEditor !== 'undefined' && helpEditor) {
    helpEditor.setTheme(theme === 'dark' ? 'dark' : 'default');
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

(function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('pipette_theme') || 'light'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('theme-btn');
  if (btn) {
    btn.innerHTML = saved === 'dark'
      ? '<i class="fa-solid fa-sun"></i>'
      : '<i class="fa-solid fa-moon"></i>';
  }
})();

// ============================================================
// ИМПОРТ ДАННЫХ
// ============================================================
let _importProgressTimer = null;

function showImportProgress(percent, text) {
  const wrap = document.getElementById('import-progress-wrap');
  const bar = document.getElementById('import-progress-bar');
  const pct = document.getElementById('import-progress-percent');
  const txt = document.getElementById('import-progress-text');
  if (!wrap) return;
  wrap.style.display = 'block';
  if (bar) bar.style.width = Math.min(100, Math.max(0, percent)) + '%';
  if (pct) pct.textContent = Math.round(percent) + '%';
  if (txt && text) txt.textContent = text;
}

function hideImportProgress() {
  const wrap = document.getElementById('import-progress-wrap');
  if (wrap) wrap.style.display = 'none';
  if (_importProgressTimer) {
    clearInterval(_importProgressTimer);
    _importProgressTimer = null;
  }
  showImportProgress(0, '');
}

function animateImportProgress(from, to, durationMs, text) {
  if (_importProgressTimer) clearInterval(_importProgressTimer);
  const start = Date.now();
  const step = 50;
  showImportProgress(from, text);
  _importProgressTimer = setInterval(() => {
    const elapsed = Date.now() - start;
    const t = Math.min(1, elapsed / durationMs);
    const eased = 1 - Math.pow(1 - t, 2);
    const current = from + (to - from) * eased;
    showImportProgress(current, text);
    if (t >= 1) {
      clearInterval(_importProgressTimer);
      _importProgressTimer = null;
    }
  }, step);
}

async function openImportModal() {
  await UI.guard(
    { permission: 'import_data', errorMsg: 'Нет прав на импорт' },
    async () => UI.modal.open('import-modal')
  );
}

function closeImportModal() {
  UI.modal.close('import-modal');
  document.getElementById('import-file').value = '';
  hideImportProgress();
}

async function handleImport() {
  await refreshCurrentUser();
  if (!canImport()) { showToast('Нет прав на импорт', 'error'); return; }

  const fileInput = document.getElementById('import-file');
  const file = fileInput.files[0];
  if (!file) { showToast('Выберите файл', 'error'); return; }

  if (file.name.toLowerCase().endsWith('.xls')) {
    showToast(
      'Формат .xls не поддерживается. Пересохраните файл как .xlsx ' +
      '(Файл → Сохранить как → Книга Excel (*.xlsx))',
      'error'
    );
    fileInput.value = '';
    return;
  }

  showImportProgress(0, '⏳ Чтение файла…');
  animateImportProgress(0, 20, 800, '⏳ Чтение файла…');

  const reader = new FileReader();

  reader.onprogress = (e) => {
    if (e.lengthComputable) {
      const p = (e.loaded / e.total) * 20;
      showImportProgress(p, '⏳ Чтение файла…');
    }
  };

  reader.onerror = () => {
    hideImportProgress();
    showToast('Ошибка чтения файла', 'error');
  };

  reader.onload = async (e) => {
    showImportProgress(20, '📤 Отправка на сервер…');
    animateImportProgress(20, 45, 1200, '📤 Отправка на сервер…');

    try {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1] || dataUrl;

      setTimeout(() => {
        showImportProgress(45, '⚙️ Обработка данных…');
        animateImportProgress(45, 90, 15000, '⚙️ Обработка данных…');
      }, 400);

      const res = await apiRequest('/import', 'POST', { file: base64, filename: file.name });

      showImportProgress(100, '✅ Импорт завершён');
      await new Promise(r => setTimeout(r, 400));

      let msg = `Импортировано: ${res.added}`;
      if (res.skipped > 0) msg += `, пропущено: ${res.skipped}`;
      if (res.errors > 0) msg += `, ошибок: ${res.errors}`;
      showToast(msg, res.added > 0 ? 'success' : 'error');

      if (res.skippedDetails && res.skippedDetails.length > 0) {
        console.log('⚠️ Пропущено:', res.skippedDetails);
      }
      if (res.errorDetails && res.errorDetails.length > 0) {
        console.log('❌ Ошибки:', res.errorDetails);
      }

      hideImportProgress();
      closeImportModal();
      currentPage = 1;
      await loadPipetteData();
    } catch (err) {
      showImportProgress(100, '❌ Ошибка импорта');
      setTimeout(() => hideImportProgress(), 1500);
      showToast('Ошибка импорта: ' + err.message, 'error');
    }
  };

  reader.readAsDataURL(file);
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ — общие обработчики
// ============================================================
let _searchTimeout = null;
document.getElementById('search').addEventListener('input', () => {
  clearTimeout(_searchTimeout);
  _searchTimeout = setTimeout(async () => {
    document.getElementById('filter-panel').classList.remove('show');
    currentPage = 1;
    await loadPaged();
    render();
    updateSelectAllCheckbox();
    updateBulkCalButton();
  }, 150);
});

// ============================================================
// ОБРАБОТЧИКИ «КЛИК МИМО» ДЛЯ ВСЕХ МОДАЛОК
// ============================================================
const modalCloseMap = {
  'history-modal':          closeHistoryModal,
  'import-modal':           closeImportModal,
  'barcode-scanner-modal':  closeBarcodeScannerModal,
  'barcode-print-modal':    closeBarcodePrintModal,
  'settings-modal':         closeSettingsModal,
  'history-export-modal':   closeHistoryExportModal,
  'temp-password-modal':    closeTempPasswordModal,
  'user-view-modal':        closeUserViewModal,
  'hotkeys-modal':          closeHotkeysHelp,
  'help-editor-modal':      closeHelpEditor,
  'audit-modal':            closeAuditModal,
  'equipment-audit-modal':  closeEquipmentAuditModal,
};
Object.entries(modalCloseMap).forEach(([id, fn]) => UI.modal.bindOutsideClick(id, fn));

// change-password-modal — НЕ закрывается кликом мимо
document.getElementById('change-password-modal').addEventListener('click', e => {
  if (e.target.id === 'change-password-modal') {
    return;
  }
});

const session = getSession();
if (session) {
  authToken = session.token;
  currentUser = session.user;
  renderAuthUI();
  refreshCurrentUser();
}
const lastLogin = localStorage.getItem('pipette_last_login');
if (lastLogin) {
  const u = document.getElementById('login-username');
  if (u) u.value = lastLogin;
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    try {
      if (typeof updateMoreMenuVisibility === 'function') {
        updateMoreMenuVisibility();
      }
    } catch (e) {}
  }, 100);
});

// ============================================================
// ГОРЯЧИЕ КЛАВИШИ
// ============================================================
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toUpperCase();
  const isInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');

  if (isInput) {
    if (e.key === 'Escape') {
      e.target.blur();
      const panel = document.getElementById('filter-panel');
      if (panel) panel.classList.remove('show');
    }
    return;
  }

        if (e.key === 'Escape') {
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal && confirmModal.classList.contains('active')) return;

    // 🆕 Закрываем ЛЮБУЮ активную модалку, у которой есть обработчик в modalCloseMap
    const activeModal = document.querySelector('.modal-overlay.active');
    if (activeModal && modalCloseMap[activeModal.id]) {
      modalCloseMap[activeModal.id]();
      return;
    }

    const panel = document.getElementById('filter-panel');
    if (panel && panel.classList.contains('show')) {
      panel.classList.remove('show');
    }
    return;
  }

  if (e.key === '?' && e.shiftKey) {
    e.preventDefault();
    openHotkeysHelp();
    return;
  }

  if (e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    const search = document.getElementById('search');
    if (search) search.focus();
    return;
  }

  if (e.key === 'F5') {
    e.preventDefault();
    if (typeof loadPipetteData === 'function') {
      loadPipetteData();
      if (typeof showToast === 'function') showToast('Данные обновлены', 'success');
    }
    return;
  }

  if (!e.ctrlKey && !e.metaKey) return;

  if (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') {
    e.preventDefault();
    if (typeof canAddPipette === 'function' && canAddPipette()) {
      openModal();
    }
    return;
  }

  if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
    e.preventDefault();
    const panel = document.getElementById('filter-panel');
    if (panel && !panel.classList.contains('show')) {
      toggleFilterPanel(e);
    } else if (panel) {
      panel.classList.remove('show');
    }
    return;
  }

  if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') {
    e.preventDefault();
    if (typeof canExport === 'function' && canExport()) {
      exportToXlsx();
    }
    return;
  }

    if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') {
    e.preventDefault();
    if (typeof canPrintLabels === 'function' && canPrintLabels()) {
      openBarcodePrintModal();
    }
    return;
  }

  // 🆕 Ctrl+H — история текущего прибора (если есть выбранный)
  if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') {
    e.preventDefault();
    const selected = [...selectedPipettes];
    if (selected.length === 1 && typeof openHistoryModal === 'function') {
      openHistoryModal(selected[0]);
    } else {
      showToast('Выберите ровно один прибор для истории', 'warn');
    }
    return;
  }

  // 🆕 Ctrl+Shift+A — аудит текущего прибора
  if ((e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') && e.shiftKey) {
    e.preventDefault();
    const selected = [...selectedPipettes];
    if (selected.length === 1 && typeof openEquipmentAuditModal === 'function') {
      openEquipmentAuditModal(selected[0]);
    } else {
      showToast('Выберите ровно один прибор для аудита', 'warn');
    }
    return;
  }
});

// ============================================================
// PULL-TO-REFRESH (Свайп вниз для обновления данных)
// ============================================================
(function initPullToRefresh() {
  if (!('ontouchstart' in window)) return;

  const tableWrapper = document.querySelector('.table-wrapper');
  if (!tableWrapper) return;

  const THRESHOLD = 80;
  const MAX_PULL  = 150;

  let startY = 0;
  let currentPull = 0;
  let isPulling = false;
  let isRefreshing = false;

  tableWrapper.addEventListener('touchstart', (e) => {
    if (isRefreshing) return;
    if (tableWrapper.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      isPulling = true;
      currentPull = 0;
    }
  }, { passive: true });

  tableWrapper.addEventListener('touchmove', (e) => {
    if (!isPulling || isRefreshing) return;
    const deltaY = e.touches[0].clientY - startY;

    if (deltaY <= 0) {
      isPulling = false;
      currentPull = 0;
      return;
    }

    if (deltaY > 10) e.preventDefault();

    currentPull = Math.min(deltaY, MAX_PULL);
  }, { passive: false });

  const finishPull = async () => {
    if (!isPulling) return;
    isPulling = false;

    if (currentPull >= THRESHOLD && !isRefreshing) {
      isRefreshing = true;
      try {
        if (typeof loadPipetteData === 'function') {
          await loadPipetteData();
        }
        if (typeof showToast === 'function') {
          showToast('Данные обновлены', 'success');
        }
      } catch (err) {
        console.error('Pull-to-refresh:', err);
      } finally {
        isRefreshing = false;
        currentPull = 0;
      }
    } else {
      currentPull = 0;
    }
  };

  tableWrapper.addEventListener('touchend', finishPull, { passive: true });
  tableWrapper.addEventListener('touchcancel', finishPull, { passive: true });
})();

// ============================================================
// КАСТОМНЫЙ РЕСАЙЗ МОДАЛОК (сохраняет скруглённый угол)
// ============================================================
(function initModalResize() {
  if (window.innerWidth < 768) return; // на мобильных не нужно

  let activeModal = null;
  let startX = 0, startY = 0;
  let startW = 0, startH = 0;
  let minW = 0, minH = 0;

  function onPointerDown(e) {
    // 🆕 Защита: e.target может быть document / window / текстом
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;

    const modal = t.closest('.modal');
    if (!modal) return;

    const rect = modal.getBoundingClientRect();
    const dx = rect.right - e.clientX;
    const dy = rect.bottom - e.clientY;

    // 🆕 Зона захвата 40×40 — покрывает padding: 24px
    if (dx < 0 || dy < 0) return;
    if (dx > 40 || dy > 40) return;

    e.preventDefault();
    activeModal = modal;
    startX = e.clientX;
    startY = e.clientY;
    startW = rect.width;
    startH = rect.height;

    const cs = getComputedStyle(modal);
    minW = parseInt(cs.minWidth, 10) || 400;
    minH = parseInt(cs.minHeight, 10) || 300;

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);

    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  }

  function onPointerMove(e) {
    if (!activeModal) return;
    const w = Math.max(minW, startW + (e.clientX - startX));
    const h = Math.max(minH, startH + (e.clientY - startY));
    activeModal.style.width = w + 'px';
    activeModal.style.height = h + 'px';
    activeModal.style.maxWidth = 'none';
    activeModal.style.maxHeight = 'none';
  }

  function onPointerUp() {
    if (!activeModal) return;
    activeModal = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  document.addEventListener('pointerdown', onPointerDown);
})();

// ============================================================
// 🆕 PULL-TO-REFRESH на странице авторизации (без спиннера)
// ============================================================
(function initAuthPullToRefresh() {
  if (!('ontouchstart' in window)) return;

  const auth = document.getElementById('auth-container');
  if (!auth) return;

  const THRESHOLD = 80;
  let startY = 0;
  let currentPull = 0;
  let isPulling = false;
  let isRefreshing = false;

  auth.addEventListener('touchstart', (e) => {
    if (isRefreshing) return;
    if (auth.classList.contains('hidden')) return;
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    if (scrollTop > 0) return;

    startY = e.touches[0].clientY;
    isPulling = true;
    currentPull = 0;
  }, { passive: true });

  auth.addEventListener('touchmove', (e) => {
    if (!isPulling || isRefreshing) return;
    const deltaY = e.touches[0].clientY - startY;
    if (deltaY <= 0) { isPulling = false; currentPull = 0; return; }
    if (deltaY > 10) e.preventDefault();
    currentPull = Math.min(deltaY, THRESHOLD * 2);
  }, { passive: false });

  const finishPull = () => {
    if (!isPulling) return;
    isPulling = false;
    if (currentPull >= THRESHOLD && !isRefreshing) {
      isRefreshing = true;
      location.reload();
      return;
    }
    currentPull = 0;
  };

  auth.addEventListener('touchend', finishPull, { passive: true });
  auth.addEventListener('touchcancel', finishPull, { passive: true });
})();
