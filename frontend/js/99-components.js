'use strict';

// ============================================================
// УНИВЕРСАЛЬНЫЕ UI-КОМПОНЕНТЫ
// ============================================================
window.UI = {

  // ────────────────────────────────────────────────────────
  // 1. ИКОНКА
  // ────────────────────────────────────────────────────────
  icon(key, extraClass = '') {
    return `<i class="fa-solid ${ICONS[key] || key} ${extraClass}"></i>`;
  },

  // ────────────────────────────────────────────────────────
  // 2. КНОПКА-ИКОНКА
  // ────────────────────────────────────────────────────────
  iconBtn(iconKey, onClick, title, btnClass = 'btn-secondary') {
    return `<button type="button" class="btn ${btnClass} btn-sm btn-icon-only"
              onclick="${onClick}" title="${title}">
      <i class="fa-solid ${ICONS[iconKey] || iconKey}"></i>
    </button>`;
  },

  // ────────────────────────────────────────────────────────
  // 3. КНОПКИ ↑/↓
  // ────────────────────────────────────────────────────────
  moveBtns(index, total, moveFnName) {
    const upDisabled   = index === 0         ? 'disabled' : '';
    const downDisabled = index === total - 1 ? 'disabled' : '';
    return `<div class="order-btns">
      <button type="button" class="btn btn-secondary btn-sm"
              onclick="${moveFnName}(${index}, -1)" ${upDisabled} title="Выше">
        <i class="fa-solid fa-arrow-up"></i>
      </button>
      <button type="button" class="btn btn-secondary btn-sm"
              onclick="${moveFnName}(${index}, 1)" ${downDisabled} title="Ниже">
        <i class="fa-solid fa-arrow-down"></i>
      </button>
    </div>`;
  },

  // ────────────────────────────────────────────────────────
  // 4. ЧЕКБОКС
  // ────────────────────────────────────────────────────────
  checkbox(onChangeCode, checked, extraClass = '') {
    return `<input type="checkbox" class="${extraClass}"
              ${checked ? 'checked' : ''} onchange="${onChangeCode}">`;
  },

  // ────────────────────────────────────────────────────────
  // 5. ТАБЛИЦА НАСТРОЕК
  // ────────────────────────────────────────────────────────
  settingsTable(headers, rowsHtml, extraClass = '') {
    return `<table class="field-settings-table ${extraClass}">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
  },

  // ────────────────────────────────────────────────────────
  // 6. МОДАЛКИ
  // ────────────────────────────────────────────────────────
  modal: {
    open(id) {
      const el = document.getElementById(id);
      if (el) el.classList.add('active');
    },
    close(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('active');

      // Сбрасываем размеры, чтобы при следующем открытии модалка была стандартной
      const modal = el.querySelector('.modal');
      if (modal) {
        modal.style.width = '';
        modal.style.height = '';
        modal.style.maxWidth = '';
        modal.style.maxHeight = '';
      }
    },
    closeAll() {
      document.querySelectorAll('.modal-overlay.active').forEach(el => {
        el.classList.remove('active');
        // Сбрасываем размеры
        const modal = el.querySelector('.modal');
        if (modal) {
          modal.style.width = '';
          modal.style.height = '';
          modal.style.maxWidth = '';
          modal.style.maxHeight = '';
        }
      });
    },
    bindOutsideClick(id, closeFn) {
      const el = document.getElementById(id);
      if (!el) return;
      
      let isMouseDownOnModal = false;
      
      el.addEventListener('pointerdown', (e) => {
        const modal = el.querySelector('.modal');
        if (modal && modal.contains(e.target)) {
          isMouseDownOnModal = true;
        } else {
          isMouseDownOnModal = false;
        }
      });

      el.addEventListener('click', e => {
        if (e.target.id === id) {
          // Если мышь нажата на самой модалке (например, тянем за угол ресайза) — игнорируем
          if (isMouseDownOnModal) {
            isMouseDownOnModal = false;
            return;
          }
          
          if (typeof closeFn === 'function') closeFn();
          else UI.modal.close(id);
        }
      });
    }
  },

  // ────────────────────────────────────────────────────────
  // 7. GUARD — единая проверка перед действием
  // ────────────────────────────────────────────────────────
  guard: async function(options, action) {
    await refreshCurrentUser();
    if (!requirePasswordChange()) return;

    if (options.role && (!currentUser || currentUser.role !== options.role)) {
      showToast(options.errorMsg || 'Недостаточно прав', 'error');
      return;
    }

    if (options.permission) {
      const perms = Array.isArray(options.permission) ? options.permission : [options.permission];
      if (!perms.some(p => hasPermission(p))) {
        showToast(options.errorMsg || 'Недостаточно прав', 'error');
        return;
      }
    }

    if (typeof options.check === 'function' && !options.check()) return;

    await action();
  },

  // ────────────────────────────────────────────────────────
  // 8. SAVE ACTION — паттерн сохранения
  // ────────────────────────────────────────────────────────
  saveAction: async function(options, action) {
    const btn = typeof options.btn === 'string' 
      ? document.querySelector(options.btn) 
      : options.btn;
    const origHtml = btn ? btn.innerHTML : null;
    
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Сохранение…';
    }
    
    try {
      const result = await action();
      if (options.successMsg) showToast(options.successMsg, 'success');
      if (typeof options.closeFn === 'function') options.closeFn();
      if (options.reload !== false && typeof loadPipetteData === 'function') {
        await loadPipetteData();
      }
      return result;
    } catch (e) {
      showToast(e.message || 'Ошибка сохранения', 'error');
      throw e;
    } finally {
      if (btn && origHtml) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },

  // ────────────────────────────────────────────────────────
  // 9. РЕНДЕР БЕЙДЖА СТАТУСА
  // ────────────────────────────────────────────────────────
  renderStatusBadge(status) {
    const label = STATUS_LABELS[status] || status;
    const icon  = STATUS_ICONS[status] || '';
    return `<span class="status-badge status-${status}">
      <span class="status-dot"></span>
      <i class="fa-solid ${icon}"></i> ${label}
    </span>`;
  },

  // ────────────────────────────────────────────────────────
  // 10. РЕНДЕР ТОЧКИ СТАТУСА (рядом с ID)
  // ────────────────────────────────────────────────────────
  renderStatusDot(status) {
    const color = STATUS_COLORS[status] || COLORS.faint;
    const title = STATUS_LABELS[status] || status;
    return `<span class="status-dot-inline" style="background:${color};" title="${title}"></span>`;
  },

  // ────────────────────────────────────────────────────────
  // 11. РЕНДЕР ПОЛЯ ФОРМЫ
  // ────────────────────────────────────────────────────────
  renderField(field, value) {
    const val = value == null ? '' : String(value);
    const id = `p-${field.id}`;
    const req = field.required ? 'required' : '';
    const ph = esc(field.label);

    switch (field.type) {
      case 'textarea':
        return `<textarea id="${id}" data-field-id="${field.id}" rows="2" 
                  placeholder="${ph}" ${req}>${esc(val)}</textarea>`;
      case 'date': {
        const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return `<input type="date" id="${id}" data-field-id="${field.id}" 
                  value="${m ? `${m[1]}-${m[2]}-${m[3]}` : ''}" ${req}>`;
      }
      case 'number':
        return `<input type="number" id="${id}" data-field-id="${field.id}" 
                  value="${esc(val)}" ${req}>`;
      case 'select':
        return `<select id="${id}" data-field-id="${field.id}" ${req}></select>`;
      default:
        return `<input type="text" id="${id}" data-field-id="${field.id}" 
                  value="${esc(val)}" placeholder="${ph}" ${req}>`;
    }
  },

  // ────────────────────────────────────────────────────────
  // 12. БЛОКИ-ПОДСКАЗКИ
  // ────────────────────────────────────────────────────────
  infoBlock(html) {
    return `<div class="info-block">${html}</div>`;
  },
  warningBlock(html) {
    return `<div class="warning-block">${html}</div>`;
  },
  successBlock(html) {
    return `<div class="success-block">${html}</div>`;
  },
  dangerBlock(html) {
    return `<div class="danger-block">${html}</div>`;
  }
};
