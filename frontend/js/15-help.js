'use strict';

let _docsSections = [];
let _docsCurrentSection = null;

async function openHotkeysHelp() {
  document.getElementById('docs-sidebar').innerHTML = `<p style="color:#94a3b8;padding:10px;">Загрузка…</p>`;
  document.getElementById('doc-preview-container').innerHTML = '<p style="color: #94a3b8;">Выберите раздел слева</p>';
  UI.modal.open('hotkeys-modal');

  try {
    _docsSections = await apiRequest('/help/visible');
  } catch (e) {
    document.getElementById('docs-sidebar').innerHTML = `<p style="color:#dc2626;">Ошибка: ${esc(e.message)}</p>`;
    return;
  }

  if (!Array.isArray(_docsSections) || _docsSections.length === 0) {
    document.getElementById('docs-sidebar').innerHTML = `<p style="color:#94a3b8;">Разделы пока не добавлены.</p>`;
    return;
  }

  // Автоматически выбираем первый раздел
  if (!_docsCurrentSection || !_docsSections.find(s => s.slug === _docsCurrentSection)) {
    _docsCurrentSection = _docsSections[0].slug;
  }

  renderDocsSidebar();
  loadDocFile(_docsCurrentSection);
}

function closeHotkeysHelp() {
  UI.modal.close('hotkeys-modal');
}

function renderDocsSidebar() {
  const c = document.getElementById('docs-sidebar');
  if (!c) return;
  c.innerHTML = `
    <div class="docs-sidebar-title" style="font-size:.75rem; font-weight:700; color:#64748b; margin-bottom:8px;">РАЗДЕЛЫ</div>
    ${_docsSections.map(s => {
      const cleanTitle = s.title.replace(/\{icon:.*?\}/g, '').trim();
      return `
      <button class="docs-nav-item ${s.slug === _docsCurrentSection ? 'active' : ''}"
              onclick="switchDocSection('${esc(s.slug)}')">
        ${esc(cleanTitle)}
      </button>
    `}).join('')}
  `;
}

function switchDocSection(slug) {
  _docsCurrentSection = slug;
  renderDocsSidebar();
  loadDocFile(slug);
}

// 🆕 Загрузка карточки документа (без рендера самого файла)
async function loadDocFile(slug) {
  const sec = _docsSections.find(s => s.slug === slug);
  const container = document.getElementById('doc-preview-container');

  if (!sec || !sec.filePath) {
    container.innerHTML = '<p style="color:#dc2626; font-weight:600;">Файл для этого раздела не прикреплен.</p>';
    return;
  }

  const fileUrl = sec.filePath.startsWith('/') ? sec.filePath : '/' + sec.filePath;
  const fileName = sec.filePath.split('/').pop();
  const cleanTitle = sec.title.replace(/\{icon:.*?\}/g, '').trim();
  const isPdf = fileName.toLowerCase().endsWith('.pdf');

  // 🆕 Рендерим красивую карточку
  container.innerHTML = `
    <div class="help-file-card">
      <div class="help-file-icon">
        <i class="fa-solid ${isPdf ? 'fa-file-pdf' : 'fa-file-word'}"></i>
      </div>
      <h3>${esc(cleanTitle)}</h3>
      <p class="help-file-name">${esc(fileName)}</p>
      
      <div class="help-file-actions">
        <a href="${fileUrl}" target="_blank" class="btn btn-primary">
          <i class="fa-solid fa-up-right-from-square"></i> Открыть
        </a>
        <a href="${fileUrl}" download class="btn btn-secondary">
          <i class="fa-solid fa-download"></i> Скачать файл
        </a>
      </div>
    </div>
  `;
}
