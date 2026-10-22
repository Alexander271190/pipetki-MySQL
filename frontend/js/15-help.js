'use strict';

let _docsSections = [];
let _docsCurrentSection = null;
let _helpSections = [];
let _helpEditorMode = 'create';
let _helpEditorSlug = null;

// ============================================================
// 🆕 TinyMCE
// ============================================================
let _tinymceReadyPromise = null;

function ensureTinyMCE() {
  if (_tinymceReadyPromise) return _tinymceReadyPromise;
  _tinymceReadyPromise = new Promise((resolve) => {
    if (typeof tinymce === 'undefined') {
      console.error('TinyMCE не загружен. Проверьте /vendor/tinymce/tinymce.min.js');
      resolve(false);
      return;
    }

    tinymce.init({
      selector: '#he-content',
      license_key: 'gpl',
      min_height: 420,
      max_height: 700,
      branding: false,
      promotion: false,
      plugins: 'lists link image table code fullscreen searchreplace',
      toolbar: [
        'undo redo | styles fontfamily fontsize | bold italic underline strikethrough | forecolor backcolor',
        'alignleft aligncenter alignright alignjustify | bullist numlist outdent indent',
        'link table image myfile | removeformat code fullscreen'
      ],
      setup: (editor) => {
        editor.ui.registry.addButton('myfile', {
          text: 'Прикрепить файл',
          tooltip: 'Загрузить PDF, DOCX, XLSX или ZIP',
          onAction: () => {
            const input = document.getElementById('he-file-input');
            input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,.csv';
            input.value = '';
            input.click();
          }
        });
        editor.on('init', () => resolve(true));
      },
      images_upload_handler: async (blobInfo, progress) => {
        const fd = new FormData();
        fd.append('file', blobInfo.blob(), blobInfo.filename());
        const res = await fetch('/api/help/files/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken },
          body: fd
        });
        const data = await res.json();
        return data.url;
      },
      paste_data_images: true,
      automatic_uploads: true,
      file_picker_types: 'image file',
      file_picker_callback: (cb, value, meta) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = meta.filetype === 'image' ? 'image/*' : '.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt';
        input.onchange = async () => {
          const file = input.files[0];
          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch('/api/help/files/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken },
            body: fd
          });
          const data = await res.json();
          cb(data.url, { alt: file.name });
        };
        input.click();
      },
      extended_valid_elements: 'i[class|style]',
      content_css: '/fontawesome/css/all.min.css',
      skin: 'oxide',
      content_style: 'body { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; }'
    });
  });
  return _tinymceReadyPromise;
}

function getEditorContent() {
  const ed = tinymce.get('he-content');
  if (ed && !ed.isHidden()) return ed.getContent();
  return document.getElementById('he-content').value;
}

function setEditorContent(html) {
  const ed = tinymce.get('he-content');
  if (ed && !ed.isHidden()) ed.setContent(html);
  else document.getElementById('he-content').value = html;
}

// ============================================================
// ПРОСМОТР СПРАВКИ (для пользователей)
// ============================================================
async function openHotkeysHelp() {
  document.getElementById('docs-sidebar').innerHTML = `<p style="color:${COLORS.faint};padding:10px;">Загрузка…</p>`;
  document.getElementById('docs-content').innerHTML = '';
  UI.modal.open('hotkeys-modal');

  try {
    _docsSections = await apiRequest('/help/visible');
  } catch (e) {
    document.getElementById('docs-sidebar').innerHTML = '';
    document.getElementById('docs-content').innerHTML = `<p style="color:${COLORS.danger};padding:10px;">Ошибка: ${esc(e.message)}</p>`;
    return;
  }

  if (!Array.isArray(_docsSections) || _docsSections.length === 0) {
    document.getElementById('docs-content').innerHTML = `<p style="color:${COLORS.faint};padding:10px;">Разделы справки пока не добавлены.</p>`;
    return;
  }

  if (!_docsCurrentSection || !_docsSections.find(s => s.slug === _docsCurrentSection)) {
    _docsCurrentSection = _docsSections[0].slug;
  }

  renderDocsSidebar();
  renderDocsContent();
}

function closeHotkeysHelp() { UI.modal.close('hotkeys-modal'); }

function switchDocsSection(slug) {
  _docsCurrentSection = slug;
  renderDocsSidebar();
  renderDocsContent();
  const c = document.getElementById('docs-content');
  if (c) c.scrollTop = 0;
  const modal = document.getElementById('hotkeys-modal');
  if (modal) {
    const mb = modal.querySelector('.modal');
    if (mb) mb.scrollTop = 0;
  }
}

function renderDocsSidebar() {
  const c = document.getElementById('docs-sidebar');
  if (!c) return;
  c.innerHTML = `
    <div class="docs-sidebar-title">Разделы</div>
    ${_docsSections.map(s => `
      <button class="docs-nav-item ${s.slug === _docsCurrentSection ? 'active' : ''}"
              onclick="switchDocsSection('${esc(s.slug)}')">
        ${renderContent(s.title)}
      </button>
    `).join('')}
  `;
}

function renderDocsContent() {
  const c = document.getElementById('docs-content');
  if (!c) return;
  const sec = _docsSections.find(s => s.slug === _docsCurrentSection);
  if (!sec) { c.innerHTML = ''; return; }
  c.innerHTML = renderContent(sec.content || '');
}

function renderContent(content) {
  if (!content) return '';
  // Текст из БД уже в HTML. Просто подставляем иконки.
  return content.replace(/\{icon:\s*([a-z0-9-]+)\s*\}/gi, '<i class="fa-solid $1"></i>');
}

// ============================================================
// АДМИНКА
// ============================================================
async function renderHelpSettings() {
  const c = document.getElementById('settings-section-content');
  if (!c) return;
  c.innerHTML = `<p style="color:${COLORS.faint};">Загрузка…</p>`;

  try {
    _helpSections = await apiRequest('/help');
  } catch (e) {
    c.innerHTML = `<p style="color:${COLORS.danger};">Ошибка: ${esc(e.message)}</p>`;
    return;
  }
  if (!Array.isArray(_helpSections)) _helpSections = [];
  _helpSections.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  let html = `
    <p style="color:${COLORS.muted};font-size:.88rem;margin:0 0 14px;">
      Разделы справки для пользователей. Разделы автоматически скрываются у тех, у кого нет нужных прав.
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
        <th style="width:70px;">▲▼</th>
        <th>Название раздела</th>
        <th style="width:60px; text-align:center;">Показ</th>
        <th style="width:80px;">Действия</th>
      </tr>
    </thead>
    <tbody>`;

  _helpSections.forEach((s, i) => {
    const cleanTitle = s.title.replace(/\{icon:.*?\}/g, '').replace(/<[^>]+>/g, '').trim();
    html += `<tr>
      <td class="help-order-cell">
        <button class="btn btn-secondary btn-sm" onclick="moveHelpSection(${i}, -1)" ${i === 0 ? 'disabled' : ''} title="Выше">
            <i class="fa-solid fa-arrow-up"></i>
        </button>
        <button class="btn btn-secondary btn-sm" onclick="moveHelpSection(${i}, 1)" ${i === _helpSections.length - 1 ? 'disabled' : ''} title="Ниже">
            <i class="fa-solid fa-arrow-down"></i>
        </button>
      </td>
      <td><strong>${esc(cleanTitle)}</strong></td>
      <td style="text-align:center;">${s.enabled ? '✅' : '❌'}</td>
      <td class="help-admin-actions">
        <button class="row-actions-btn" onclick="openHelpActions(event, '${esc(s.slug)}')" title="Действия">
          <i class="fa-solid fa-ellipsis-vertical"></i>
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
  UI.modal.open('help-editor-modal');
  await ensureTinyMCE();

  if (mode === 'edit' && slug) {
    const s = _helpSections.find(x => x.slug === slug);
    if (!s) { showToast('Раздел не найден', 'error'); return; }
    document.getElementById('help-editor-title').innerHTML = '<i class="fa-solid fa-pen"></i> ' + esc(s.slug);

    document.getElementById('he-slug').value = s.slug;
    document.getElementById('he-slug').disabled = true;

    const cleanTitle = s.title.replace(/\{icon:.*?\}/g, '').replace(/<[^>]+>/g, '').trim();
    document.getElementById('he-title').value = cleanTitle;

    const iconMatch = s.title.match(/\{icon:[^}]+\}/);
    document.getElementById('he-title').dataset.icon = iconMatch ? iconMatch[0] : '';

    setEditorContent(s.content || '');

    document.getElementById('he-sort-order').value = s.sortOrder || 0;
    document.getElementById('he-enabled').checked = !!s.enabled;
    renderHelpPermissions(s.requiredPermissions || []);
  } else {
    document.getElementById('help-editor-title').innerHTML = '<i class="fa-solid fa-plus"></i> Новый раздел';

    const randomSlug = 'doc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    document.getElementById('he-slug').value = randomSlug;
    document.getElementById('he-slug').disabled = false;

    document.getElementById('he-title').value = '';
    document.getElementById('he-title').dataset.icon = '';
    setEditorContent('<p>Начните писать текст справки здесь...</p>');
    document.getElementById('he-sort-order').value = (_helpSections.length + 1) || 1;
    document.getElementById('he-enabled').checked = true;
  }

  setTimeout(() => {
    const ed = tinymce.get('he-content');
    if (ed) ed.focus();
  }, 200);
}

function closeHelpEditor() { UI.modal.close('help-editor-modal'); }

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

async function saveHelpEditor() {
  const errEl = document.getElementById('he-error');
  errEl.textContent = '';

  const slug = document.getElementById('he-slug').value.trim();
  const titleRaw = document.getElementById('he-title').value.trim();
  const content = getEditorContent();
  const sortOrder = parseInt(document.getElementById('he-sort-order').value, 10) || 0;
  const enabled = document.getElementById('he-enabled').checked;
  const icon = document.getElementById('he-title').dataset.icon || '';
  const title = (icon ? icon + ' ' : '') + titleRaw;

  const requiredPermissions = Array.from(
    document.querySelectorAll('#he-permissions input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  if (!slug || !/^[a-z][a-z0-9_-]*$/.test(slug)) {
    errEl.textContent = 'Внутренний код: латиница, начинается с буквы, только a-z 0-9 _';
    return;
  }
  if (!titleRaw) { errEl.textContent = 'Заполните заголовок'; return; }
  if (!content || content === '<p><br></p>') {
    errEl.textContent = 'Заполните содержимое раздела';
    return;
  }

  const payload = { title, content, requiredPermissions, sortOrder, enabled };

  try {
    if (_helpEditorMode === 'create') {
      payload.slug = slug;
      await UI.saveAction({
        successMsg: 'Раздел создан',
        closeFn: closeHelpEditor,
        reload: false
      }, () => apiRequest('/help', 'POST', payload));
    } else {
      await UI.saveAction({
        successMsg: 'Раздел обновлён',
        closeFn: closeHelpEditor,
        reload: false
      }, () => apiRequest('/help/' + encodeURIComponent(_helpEditorSlug), 'PUT', payload));
    }
    renderHelpSettings();
  } catch (e) { errEl.textContent = e.message || 'Ошибка'; }
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

function openHelpActions(ev, slug) {
  ev.stopPropagation();
  const items = [
    { label: '<i class="fa-solid fa-pen"></i> Изменить', action: () => openHelpEditor('edit', slug) },
    { label: '<i class="fa-solid fa-trash"></i> Удалить', class: 'item-danger', action: () => deleteHelpSection(slug) }
  ];
  renderRowActionsMenu(ev.currentTarget, items);
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('he-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;

      const fd = new FormData();
      fd.append('file', file);

      try {
        showToast('Загрузка файла...', 'success');
        const res = await fetch('/api/help/files/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken },
          body: fd
        });
        if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error || 'Ошибка');
        const data = await res.json();

        const ed = tinymce.get('he-content');
        let insertHtml = '';
        if (data.isImage) {
          insertHtml = `<p><img src="${data.url}" alt="${esc(file.name)}" style="max-width:100%; border-radius:8px;"></p>`;
        } else if (data.isPdf) {
          insertHtml = `<p>📄 <a href="${data.url}" target="_blank" rel="noopener">Скачать: ${esc(file.name)} (PDF)</a></p>`;
        } else {
          const ext = file.name.split('.').pop().toUpperCase();
          insertHtml = `<p>📎 <a href="${data.url}" target="_blank" rel="noopener">Скачать: ${esc(file.name)} (${ext})</a></p>`;
        }
        if (ed) ed.insertContent(insertHtml);
        showToast('Файл прикреплён!', 'success');
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
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
          `Загрузить ${sections.length} разделов?\n\nOK — заменить все. Отмена — добавить/обновить по коду.`,
          { icon: '📥', title: 'Импорт справки', okText: 'Заменить', okClass: 'btn-warning' }
        );
        const mode = ok ? 'replace' : 'merge';
        const res = await apiRequest('/help/import', 'POST', { sections, mode });
        showToast(res.message || 'Импорт завершён', 'success');
        renderHelpSettings();
      } catch (e) { showToast('Ошибка импорта: ' + e.message, 'error'); }
    });
  }
});

function printHelpSection() {
  const sec = _docsSections.find(s => s.slug === _docsCurrentSection);
  if (!sec) return;

  const cleanTitle = sec.title.replace(/\{icon:.*?\}/g, '').replace(/<[^>]+>/g, '').trim();
  const printWindow = window.open('', '_blank');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <title>Справка: ${cleanTitle}</title>
      <link rel="stylesheet" href="fontawesome/css/all.min.css">
      <link rel="stylesheet" href="style.css">
      <style>
        body { background: #fff !important; padding: 20px; font-size: 12pt; }
        .docs-content { overflow: visible !important; max-height: none !important; color: #000 !important; }
        .docs-content h1, .docs-content h2, .docs-content h3 { color: #000 !important; page-break-after: avoid; }
        .docs-hint { background: #f0f9ff !important; color: #000 !important; border-left: 3px solid #0ea5e9; }
        .docs-table th, .docs-table td { border: 1px solid #999 !important; color: #000 !important; }
        .docs-table th { background: #f1f5f9 !important; }
        @media print { @page { size: A4 portrait; margin: 15mm; } .docs-content { padding: 0 !important; } }
      </style>
    </head>
    <body>
      <div class="docs-content">${renderContent(sec.content)}</div>
      <script>window.onload = () => { window.print(); window.close(); };<\/script>
    </body>
    </html>
  `);
  printWindow.document.close();
}
