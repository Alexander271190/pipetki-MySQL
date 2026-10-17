'use strict';

// ============================================================
// СПРАВКА — просмотр + Markdown
// ============================================================
let _docsSections = [];
let _docsCurrentSection = null;

async function openHotkeysHelp() {
  const modal = document.getElementById('hotkeys-modal');
  if (!modal) return;

  document.getElementById('docs-sidebar').innerHTML = '<p style="color:#94a3b8;padding:10px;">Загрузка…</p>';
  document.getElementById('docs-content').innerHTML = '';
  modal.classList.add('active');

  try {
    _docsSections = await apiRequest('/help/visible');
  } catch (e) {
    document.getElementById('docs-sidebar').innerHTML = '';
    document.getElementById('docs-content').innerHTML =
      '<p style="color:#dc2626;padding:10px;">Ошибка загрузки справки: ' + esc(e.message) + '</p>';
    return;
  }

  if (!Array.isArray(_docsSections) || _docsSections.length === 0) {
    document.getElementById('docs-content').innerHTML =
      '<p style="color:#94a3b8;padding:10px;">Разделы справки пока не добавлены.</p>';
    return;
  }

  if (!_docsCurrentSection || !_docsSections.find(s => s.slug === _docsCurrentSection)) {
    _docsCurrentSection = _docsSections[0].slug;
  }

  renderDocsSidebar();
  renderDocsContent();
}

function closeHotkeysHelp() {
  const modal = document.getElementById('hotkeys-modal');
  if (modal) modal.classList.remove('active');
}

function switchDocsSection(slug) {
  _docsCurrentSection = slug;
  renderDocsSidebar();
  renderDocsContent();
  const c = document.getElementById('docs-content');
  if (c) c.scrollTop = 0;
}

function renderDocsSidebar() {
  const c = document.getElementById('docs-sidebar');
  if (!c) return;
  c.innerHTML = `
    <div class="docs-sidebar-title">Разделы</div>
    ${_docsSections.map(s => `
      <button class="docs-nav-item ${s.slug === _docsCurrentSection ? 'active' : ''}"
              onclick="switchDocsSection('${esc(s.slug)}')">
        ${inlineMd(s.title)}  
      </button>
    `).join('')}
  `;
}

function renderDocsContent() {
  const c = document.getElementById('docs-content');
  if (!c) return;
  const sec = _docsSections.find(s => s.slug === _docsCurrentSection);
  if (!sec) { c.innerHTML = ''; return; }
  c.innerHTML = renderMarkdown(sec.content || '');
}

function renderMarkdown(md) {
  const lines = String(md || '').split('\n');
  const out = [];
  let inUl = false, inOl = false, inTable = false;
  let tableRows = [];

  const flushUl = () => { if (inUl) { out.push('</ul>'); inUl = false; } };
  const flushOl = () => { if (inOl) { out.push('</ol>'); inOl = false; } };
  const flushTable = () => {
    if (!inTable) return;
    out.push('<table class="docs-table">');
    tableRows.forEach((r, i) => {
      const tag = i === 0 ? 'th' : 'td';
      out.push('<tr>' + r.map(cell => `<${tag}>${inlineMd(cell.trim())}</${tag}>`).join('') + '</tr>');
    });
    out.push('</table>');
    tableRows = []; inTable = false;
  };
  const flushAll = () => { flushUl(); flushOl(); flushTable(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^\|.*\|$/.test(trimmed)) {
      const cells = trimmed.replace(/^\||\|$/g, '').split('|');
      if (cells.every(c => /^[\s:-]+$/.test(c))) continue;
      flushUl(); flushOl();
      inTable = true;
      tableRows.push(cells);
      continue;
    } else {
      flushTable();
    }

    if (trimmed.startsWith('### ')) { flushAll(); out.push('<h3>' + inlineMd(trimmed.slice(4)) + '</h3>'); continue; }
    if (trimmed.startsWith('## '))  { flushAll(); out.push('<h2>' + inlineMd(trimmed.slice(3)) + '</h2>'); continue; }
    if (trimmed.startsWith('# '))   { flushAll(); out.push('<h1>' + inlineMd(trimmed.slice(2)) + '</h1>'); continue; }

    if (trimmed.startsWith('> ')) {
      flushUl(); flushOl();
      out.push('<div class="docs-hint">' + inlineMd(trimmed.slice(2)) + '</div>');
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      flushOl(); flushTable();
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push('<li>' + inlineMd(trimmed.replace(/^-\s+/, '')) + '</li>');
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      flushUl(); flushTable();
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push('<li>' + inlineMd(trimmed.replace(/^\d+\.\s+/, '')) + '</li>');
      continue;
    }

    flushAll();
    if (trimmed === '') continue;
    out.push('<p>' + inlineMd(trimmed) + '</p>');
  }

  flushAll();
  return out.join('');
}

function inlineMd(text) {
  let s = String(text || '');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*(.+?)\*/g, '<i>$1</i>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 🆕 Рендер FA-иконок в справке
  s = s.replace(/\{icon:\s*([a-z0-9-]+)\s*\}/g, '<i class="fa-solid $1 help-icon"></i>');
  
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:8px 0;">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  return s;
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'hotkeys-modal') closeHotkeysHelp();
});

// ============================================================
// АДМИНКА СПРАВКИ
// ============================================================
let _helpSections = [];
let _helpEditorMode = 'create';
let _helpEditorSlug = null;

async function renderHelpSettings() {
  const c = document.getElementById('settings-section-content');
  if (!c) return;
  c.innerHTML = '<p style="color:#94a3b8;">Загрузка…</p>';

  try {
    _helpSections = await apiRequest('/help');
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
    return;
  }
  if (!Array.isArray(_helpSections)) _helpSections = [];
  _helpSections.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  let html = `
    <p style="color:#64748b;font-size:.88rem;margin:0 0 14px;">
      Справка для пользователей. Разделы автоматически скрываются у тех, у кого нет нужных прав.
      Поддерживается Markdown: заголовки, списки, таблицы, ссылки, картинки.
    </p>

    <div class="help-actions-bar">
      <button class="btn btn-primary btn-sm" onclick="openHelpEditor('create')">
        <i class="fa-solid fa-plus"></i> Добавить раздел
      </button>
      <button class="btn btn-secondary btn-sm" onclick="exportHelpJson()">
        <i class="fa-solid fa-download"></i> Экспорт
      </button>
      <button class="btn btn-secondary btn-sm" onclick="importHelpJson()">
        <i class="fa-solid fa-upload"></i> Импорт
      </button>
      <button class="btn btn-warning btn-sm" onclick="resetHelpToFactory()">
        <i class="fa-solid fa-rotate-left"></i> Сбросить к заводской
      </button>
      <input type="file" id="help-import-input" accept=".json" style="display:none;">
    </div>
  `;

  if (_helpSections.length === 0) {
    html += `<div class="help-empty">Разделов пока нет.</div>`;
    c.innerHTML = html;
    return;
  }

  html += `<table class="help-admin-table">
    <thead>
      <tr>
        <th style="width:50px;">▲▼</th>
        <th style="width:110px;">Slug</th>
        <th>Заголовок</th>
        <th style="width:70px;">Права</th>
        <th style="width:60px;">Показ</th>
        <th style="width:130px;">Действия</th>
      </tr>
    </thead>
    <tbody>`;

  _helpSections.forEach((s, i) => {
    const permsText = (s.requiredPermissions && s.requiredPermissions.length > 0)
      ? String(s.requiredPermissions.length)
      : '<span style="color:#94a3b8;">все</span>';

    html += `<tr>
      <td class="help-order-cell">
        <button class="btn btn-secondary btn-sm" onclick="moveHelpSection(${i}, -1)" ${i === 0 ? 'disabled' : ''} title="Выше">
            <i class="fa-solid fa-arrow-up"></i>
        </button>
        <button class="btn btn-secondary btn-sm" onclick="moveHelpSection(${i}, 1)" ${i === _helpSections.length - 1 ? 'disabled' : ''} title="Ниже">
            <i class="fa-solid fa-arrow-down"></i>
        </button>
      </td>
      <td><code style="font-size:.78rem;">${esc(s.slug)}</code></td>
      <td>${esc(s.title)}</td>
      <td style="text-align:center;">${permsText}</td>
      <td style="text-align:center;">${s.enabled ? '✅' : '❌'}</td>
      <td class="help-admin-actions">
        <button class="btn btn-primary btn-sm bc-icon-btn" onclick="openHelpEditor('edit', '${esc(s.slug)}')" title="Изменить">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-danger btn-sm bc-icon-btn" onclick="deleteHelpSection('${esc(s.slug)}')" title="Удалить">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>`;
  });

  html += '</tbody></table>';
  c.innerHTML = html;
}

async function openHelpEditor(mode, slug) {
  _helpEditorMode = mode;
  _helpEditorSlug = slug || null;

  const errEl = document.getElementById('he-error');
  errEl.textContent = '';

  renderHelpPermissions([]);

  if (mode === 'edit' && slug) {
    const s = _helpSections.find(x => x.slug === slug);
    if (!s) { showToast('Раздел не найден', 'error'); return; }
    document.getElementById('help-editor-title').innerHTML = '<i class="fa-solid fa-pen"></i> ' + esc(s.slug);
    document.getElementById('he-slug').value = s.slug;
    document.getElementById('he-slug').disabled = true;
    document.getElementById('he-title').value = s.title;
    document.getElementById('he-content').value = s.content;
    document.getElementById('he-sort-order').value = s.sortOrder || 0;
    document.getElementById('he-enabled').checked = !!s.enabled;
    renderHelpPermissions(s.requiredPermissions || []);
  } else {
    document.getElementById('help-editor-title').innerHTML = '<i class="fa-solid fa-plus"></i> Новый раздел';
    document.getElementById('he-slug').value = '';
    document.getElementById('he-slug').disabled = false;
    document.getElementById('he-title').value = '';
    document.getElementById('he-content').value = '## Заголовок\n\nТекст раздела.\n\n- пункт 1\n- пункт 2\n';
    document.getElementById('he-sort-order').value = (_helpSections.length + 1) || 1;
    document.getElementById('he-enabled').checked = true;
  }

  updateHelpPreview();
  document.getElementById('help-editor-modal').classList.add('active');
}

function closeHelpEditor() {
  document.getElementById('help-editor-modal').classList.remove('active');
}

function renderHelpPermissions(selected) {
  const c = document.getElementById('he-permissions');
  if (!c) return;

  const groups = {};
  ALL_PERMISSIONS.forEach(p => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });
  const set = new Set(Array.isArray(selected) ? selected : []);

  let html = '';
  for (const [group, items] of Object.entries(groups)) {
    html += `
      <div class="help-perms-group">
        <div class="help-perms-group-title">${esc(group)}</div>
        <div class="help-perms-items">
          ${items.map(p => `
            <label class="help-perm-item">
              <input type="checkbox" value="${esc(p.key)}" ${set.has(p.key) ? 'checked' : ''}>
              <span>${p.label}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }
  c.innerHTML = html;
}

function updateHelpPreview() {
  const el = document.getElementById('he-content');
  const preview = document.getElementById('he-preview');
  if (!el || !preview) return;
  const md = el.value || '';
  preview.innerHTML = md.trim() ? renderMarkdown(md) : '<span style="color:#94a3b8;">Предпросмотр…</span>';
}

document.addEventListener('DOMContentLoaded', () => {
  const contentEl = document.getElementById('he-content');
  if (contentEl) {
    let t = null;
    contentEl.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(updateHelpPreview, 250);
    });
  }

  const imgInput = document.getElementById('he-image-input');
  if (imgInput) {
    imgInput.addEventListener('change', async () => {
      const file = imgInput.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('/api/help/images/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken },
          body: fd,
        });
        if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error || 'Ошибка');
        const data = await res.json();
        const md = `![${file.name}](${data.url})`;
        const el = document.getElementById('he-content');
        const start = el.selectionStart;
        el.value = el.value.slice(0, start) + md + el.value.slice(start);
        el.focus();
        updateHelpPreview();
        showToast('Картинка загружена', 'success');
      } catch (e) {
        showToast('Ошибка: ' + e.message, 'error');
      }
    });
  }

  const importInput = document.getElementById('help-import-input');
  if (importInput) {
    importInput.addEventListener('change', async () => {
      const file = importInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const sections = JSON.parse(text);
        if (!Array.isArray(sections)) throw new Error('Ожидается массив');

        const ok = await showConfirm(
          `Загрузить ${sections.length} разделов?\n\nOK — заменить все. Отмена — добавить/обновить по slug.`,
          { icon: '📥', title: 'Импорт справки', okText: 'Заменить', okClass: 'btn-warning' }
        );
        const mode = ok ? 'replace' : 'merge';

        const res = await apiRequest('/help/import', 'POST', { sections, mode });
        showToast(res.message || 'Импорт завершён', 'success');
        renderHelpSettings();
      } catch (e) {
        showToast('Ошибка импорта: ' + e.message, 'error');
      }
    });
  }
});

function heInsert(text) {
  const el = document.getElementById('he-content');
  if (!el) return;
  const start = el.selectionStart;
  const before = el.value.slice(0, start);
  const after = el.value.slice(el.selectionEnd);
  const insert = (before.endsWith('\n') || before === '' ? '' : '\n') + text;
  el.value = before + insert + after;
  el.selectionStart = el.selectionEnd = start + insert.length;
  el.focus();
  updateHelpPreview();
}

function heWrap(open, close) {
  const el = document.getElementById('he-content');
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = el.value.slice(start, end) || 'текст';
  const wrapped = open + selected + close;
  el.value = el.value.slice(0, start) + wrapped + el.value.slice(end);
  el.focus();
  updateHelpPreview();
}

function hePickImage() {
  const input = document.getElementById('he-image-input');
  if (input) { input.value = ''; input.click(); }
}

async function saveHelpEditor() {
  const errEl = document.getElementById('he-error');
  errEl.textContent = '';

  const slug = document.getElementById('he-slug').value.trim();
  const title = document.getElementById('he-title').value.trim();
  const content = document.getElementById('he-content').value;
  const sortOrder = parseInt(document.getElementById('he-sort-order').value, 10) || 0;
  const enabled = document.getElementById('he-enabled').checked;

  const requiredPermissions = Array.from(
    document.querySelectorAll('#he-permissions input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  if (!slug || !/^[a-z][a-z0-9_]*$/.test(slug)) {
    errEl.textContent = 'Slug: латиница, начинается с буквы, только a-z 0-9 _';
    return;
  }
  if (!title) { errEl.textContent = 'Заполните заголовок'; return; }
  if (!content.trim()) { errEl.textContent = 'Заполните текст'; return; }

  const payload = { title, content, requiredPermissions, sortOrder, enabled };

  try {
    if (_helpEditorMode === 'create') {
      payload.slug = slug;
      await apiRequest('/help', 'POST', payload);
      showToast('Раздел создан', 'success');
    } else {
      await apiRequest('/help/' + encodeURIComponent(_helpEditorSlug), 'PUT', payload);
      showToast('Раздел обновлён', 'success');
    }
    closeHelpEditor();
    renderHelpSettings();
  } catch (e) {
    errEl.textContent = e.message || 'Ошибка';
  }
}

async function deleteHelpSection(slug) {
  const s = _helpSections.find(x => x.slug === slug);
  const ok = await showConfirm(
    `Удалить раздел «${s ? s.title : slug}»?`,
    { icon: '🗑️', title: 'Удаление', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;
  try {
    await apiRequest('/help/' + encodeURIComponent(slug), 'DELETE');
    showToast('Удалён', 'success');
    renderHelpSettings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function moveHelpSection(idx, dir) {
  const to = idx + dir;
  if (to < 0 || to >= _helpSections.length) return;
  [_helpSections[idx], _helpSections[to]] = [_helpSections[to], _helpSections[idx]];
  _helpSections.forEach((s, i) => s.sortOrder = i);
  try {
    await apiRequest('/help/reorder', 'POST', { order: _helpSections.map(s => s.slug) });
    renderHelpSettings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function exportHelpJson() {
  try {
    const sections = await apiRequest('/help/export/all');
    const blob = new Blob([JSON.stringify(sections, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `help_${todayStr()}.json`; a.click();
    URL.revokeObjectURL(url);
  } catch (e) { showToast(e.message, 'error'); }
}

function importHelpJson() {
  const input = document.getElementById('help-import-input');
  if (input) { input.value = ''; input.click(); }
}

async function resetHelpToFactory() {
  const ok = await showConfirm(
    'Сбросить справку к заводской? Все ваши правки будут потеряны.',
    { icon: '⚠️', title: 'Сброс справки', okText: 'Сбросить', okClass: 'btn-danger' }
  );
  if (!ok) return;
  try {
    await apiRequest('/settings/reset-help', 'POST', {});
    showToast('Справка восстановлена', 'success');
    renderHelpSettings();
  } catch (e) { showToast(e.message, 'error'); }
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'help-editor-modal') closeHelpEditor();
});

// ============================================================
// РАЗДЕЛ: ШАБЛОНЫ ВИДА
// ============================================================
let _cachedViewTemplates = [];
let _editingTemplateId = null;

async function renderViewTemplatesSettings() {
  const c = document.getElementById('settings-section-content');
  try {
    _cachedFields = await apiRequest('/settings/fields');
    _cachedViewTemplates = await apiRequest('/view-templates');

    let html = `
      <p style="color:#64748b;font-size:.88rem;margin:0 0 14px;">
        Шаблоны вида — именованные наборы полей. Назначьте шаблон пользователю,
        и он увидит этот набор. <strong>Индивидуальные настройки перебивают шаблон.</strong>
      </p>
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <button class="btn btn-primary btn-sm" onclick="openViewTemplateEditor(null)">
          <i class="fa-solid fa-plus"></i> Создать шаблон
        </button>
      </div>
    `;

    if (_cachedViewTemplates.length === 0) {
      html += `<div class="help-empty">Шаблонов пока нет.</div>`;
      c.innerHTML = html;
      return;
    }

    html += `<table class="help-admin-table"><thead><tr>
      <th>Название</th>
      <th style="width:100px;">Полей</th>
      <th style="width:100px;">По умолч.</th>
      <th style="width:220px;">Действия</th>
    </tr></thead><tbody>`;

    _cachedViewTemplates.forEach(t => {
      html += `<tr>
        <td><strong>${esc(t.name)}</strong></td>
        <td>${t.visibleFields.length}</td>
        <td>${t.isDefault ? '✅' : '—'}</td>
        <td class="help-admin-actions">
          <button class="btn btn-primary btn-sm bc-icon-btn" onclick="openViewTemplateEditor(${t.id})" title="Изменить">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-secondary btn-sm bc-icon-btn" onclick="openApplyTemplateModal(${t.id})" title="Назначить">
            <i class="fa-solid fa-users"></i>
          </button>
          <button class="btn btn-danger btn-sm bc-icon-btn" onclick="deleteViewTemplate(${t.id})" title="Удалить">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>`;
    });
    html += `</tbody></table>`;
    c.innerHTML = html;
  } catch (e) {
    c.innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
  }
}

function openViewTemplateEditor(templateId) {
  _editingTemplateId = templateId;
  const tpl = templateId ? _cachedViewTemplates.find(t => t.id === templateId) : null;

  const VIRTUAL_COLUMNS = [
    { id: 'nextCalibration', label: 'Следующая поверка' },
    { id: 'status',          label: 'Статус' },
  ];

  const activeFields = _cachedFields
    .filter(f => f.enabled)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const defaultSelected = activeFields.map(f => f.id).concat(VIRTUAL_COLUMNS.map(v => v.id));
  const selected = new Set(tpl ? tpl.visibleFields : defaultSelected);

  const fieldsHtml = `
    <div style="font-weight:600;margin-bottom:6px;font-size:.85rem;color:#475569;">Поля формы</div>
    <div class="help-perms-grid">
      ${activeFields.map(f => `
        <label class="help-perm-item">
          <input type="checkbox" class="vt-field-cb" value="${esc(f.id)}" ${selected.has(f.id) ? 'checked' : ''}>
          <span>${esc(f.label)}</span>
        </label>
      `).join('')}
    </div>
    <div style="font-weight:600;margin:12px 0 6px;font-size:.85rem;color:#475569;">Виртуальные колонки</div>
    <div class="help-perms-grid">
      ${VIRTUAL_COLUMNS.map(v => `
        <label class="help-perm-item">
          <input type="checkbox" class="vt-field-cb" value="${esc(v.id)}" ${selected.has(v.id) ? 'checked' : ''}>
          <span>${esc(v.label)}</span>
        </label>
      `).join('')}
    </div>
  `;

  const c = document.getElementById('settings-section-content');
  c.innerHTML = `
    <h3>${templateId ? 'Редактирование шаблона' : 'Новый шаблон вида'}</h3>
    <div class="form-group">
      <label>Название шаблона *</label>
      <input type="text" id="vt-name" value="${esc(tpl ? tpl.name : '')}" placeholder="напр. Лаборант базовый">
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="vt-default" ${tpl && tpl.isDefault ? 'checked' : ''} style="width:16px;height:16px;">
        <span>Использовать по умолчанию для новых пользователей</span>
      </label>
    </div>
    <div class="form-group">${fieldsHtml}</div>
    <div id="vt-error" class="auth-error" style="margin-top:8px;"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="renderViewTemplatesSettings()">Отмена</button>
      <button class="btn btn-success" onclick="saveViewTemplate()">
        <i class="fa-solid fa-floppy-disk"></i> Сохранить
      </button>
    </div>
  `;
}

async function saveViewTemplate() {
  const errEl = document.getElementById('vt-error');
  errEl.textContent = '';

  const name = document.getElementById('vt-name').value.trim();
  const isDefault = document.getElementById('vt-default').checked;
  const fields = [...document.querySelectorAll('.vt-field-cb:checked')].map(cb => cb.value);

  if (!name) { errEl.textContent = 'Укажите название'; return; }
  if (fields.length === 0) { errEl.textContent = 'Выберите хотя бы одно поле'; return; }

  try {
    if (_editingTemplateId) {
      await apiRequest('/view-templates/' + _editingTemplateId, 'PUT', { name, visibleFields: fields, isDefault });
      showToast('Шаблон обновлён', 'success');
    } else {
      await apiRequest('/view-templates', 'POST', { name, visibleFields: fields, isDefault });
      showToast('Шаблон создан', 'success');
    }
    _editingTemplateId = null;
    renderViewTemplatesSettings();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function deleteViewTemplate(id) {
  const tpl = _cachedViewTemplates.find(t => t.id === id);
  const ok = await showConfirm(
    `Удалить шаблон «${tpl ? tpl.name : ''}»?\n\nУ пользователей, которым он назначен, вид вернётся к настройкам по умолчанию.`,
    { icon: '📋', title: 'Удаление шаблона', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) return;
  try {
    await apiRequest('/view-templates/' + id, 'DELETE');
    showToast('Шаблон удалён', 'success');
    renderViewTemplatesSettings();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function openApplyTemplateModal(templateId) {
  const tpl = _cachedViewTemplates.find(t => t.id === templateId);
  if (!tpl) return;

  let users = [];
  try { users = await apiRequest('/users'); } catch (e) {}

  const others = users.filter(u => u.role !== 'admin');
  if (others.length === 0) {
    showToast('Нет пользователей для назначения', 'error');
    return;
  }

  const c = document.getElementById('settings-section-content');
  c.innerHTML = `
    <h3>Назначить шаблон «${esc(tpl.name)}»</h3>
    <p style="color:#64748b;font-size:.85rem;">
      Отметьте пользователей. <strong>Индивидуальные настройки перебивают шаблон</strong>.
    </p>
    <div style="max-height:400px;overflow-y:auto;margin:12px 0;padding:8px;background:#f8fafc;border-radius:8px;">
      ${others.map(u => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;">
          <input type="checkbox" class="at-user-cb" value="${esc(u.id)}">
          <span>${esc(u.fullName)} — ${esc(u.position || '')}</span>
        </label>
      `).join('')}
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="renderViewTemplatesSettings()">Назад</button>
      <button class="btn btn-success" onclick="applyTemplateToUsers(${templateId})">
        <i class="fa-solid fa-check"></i> Назначить
      </button>
    </div>
  `;
}

async function applyTemplateToUsers(templateId) {
  const ids = [...document.querySelectorAll('.at-user-cb:checked')].map(cb => cb.value);
  if (ids.length === 0) { showToast('Выберите хотя бы одного', 'error'); return; }
  try {
    for (const uid of ids) {
      await apiRequest(`/view-templates/${templateId}/apply-to-user/${uid}`, 'POST');
    }
    showToast(`Назначено: ${ids.length}`, 'success');

    if (ids.includes(currentUser.id)) {
      myPrefs = { _loaded: false };
    }
    renderViewTemplatesSettings();
  } catch (e) {
    showToast(e.message, 'error');
  }
}
