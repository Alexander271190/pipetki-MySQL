'use strict';

// ============================================================
// НАПОМИНАНИЯ
// ============================================================
let _reminderScheduled = false;
let _reminderDismissed = false;

function checkReminder() {
  if (!currentUser) return;

  if (_reminderScheduled || _reminderDismissed) return;

  const overlay = document.getElementById('reminder-overlay');
  if (overlay && overlay.classList.contains('active')) return;

  const key = 'pipette_last_reminder_' + currentUser.id;
  const lastShown = localStorage.getItem(key);
  const today = todayStr();
  if (lastShown === today) return;

  const dangerList = pipettes.filter(p => ['danger', 'fail'].includes(calcStatus(p)));
  const warnList = pipettes.filter(p => calcStatus(p) === 'warn');
  if (dangerList.length === 0 && warnList.length === 0) return;

  _reminderScheduled = true;
  setTimeout(() => showReminder(dangerList, warnList), 600);
}

function showReminder(dangerList, warnList) {
  const icon = document.getElementById('reminder-icon');
  const title = document.getElementById('reminder-title');
  const subtitle = document.getElementById('reminder-subtitle');
  const body = document.getElementById('reminder-body');

    if (dangerList.length > 0) {
    icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    title.textContent = 'Просрочены поверки!';
    title.style.color = '#dc2626';
    subtitle.textContent = `${dangerList.length} ${dangerList.length === 1 ? 'пипетка требует' : 'пипеток требуют'} срочной поверки`;
  } else {
    icon.innerHTML = '<i class="fa-solid fa-bell"></i>';
    title.textContent = 'Приближаются сроки поверки';
    title.style.color = '#eab308';
    subtitle.textContent = `${warnList.length} ${warnList.length === 1 ? 'пипетка подходит' : 'пипеток подходят'} к сроку поверки в течение ${settings.warnDays} дн.`;
  }

  let html = '';
  if (dangerList.length > 0) {
    html += `<div class="reminder-section"><div class="reminder-section-title danger"><i class="fa-solid fa-triangle-exclamation"></i> Просрочены (${dangerList.length})</div><ul class="reminder-list">`;
    dangerList.sort((a, b) => daysLeft(a) - daysLeft(b)).forEach(p => {
  const dl = daysLeft(p);
  const isFail = calcStatus(p) === 'fail';
  html += `<li class="danger">
    <div class="pip-info"><div class="pip-id">${esc(p.id)} — ${esc(p.model)}</div>
    <div class="pip-detail">${esc(p.department || 'без отдела')} · ${esc(p.responsible || '—')}</div></div>
    <div class="pip-days">${isFail ? 'брак' : 'просрочка ' + Math.abs(dl) + ' дн.'}</div>
  </li>`;
});
    html += '</ul></div>';
  }
  if (warnList.length > 0) {
    html += `<div class="reminder-section"><div class="reminder-section-title warn"><i class="fa-solid fa-triangle-exclamation"></i> Скоро поверка (${warnList.length})</div><ul class="reminder-list">`;
    warnList.sort((a, b) => daysLeft(a) - daysLeft(b)).forEach(p => {
      const dl = daysLeft(p);
      html += `<li class="warn">
        <div class="pip-info"><div class="pip-id">${esc(p.id)} — ${esc(p.model)}</div>
        <div class="pip-detail">${esc(p.department || 'без отдела')} · ${esc(p.responsible || '—')}</div></div>
        <div class="pip-days">${dl} дн.</div>
      </li>`;
    });
    html += '</ul></div>';
  }
  body.innerHTML = html;
  document.getElementById('reminder-overlay').classList.add('active');
}

function closeReminder(confirmed) {
  document.getElementById('reminder-overlay').classList.remove('active');

  _reminderScheduled = false;

  if (!currentUser) return;

  if (confirmed) {
    localStorage.setItem('pipette_last_reminder_' + currentUser.id, todayStr());
  } else {
    _reminderDismissed = true;
  }
}