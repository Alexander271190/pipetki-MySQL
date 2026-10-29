'use strict';

let _docsSections = [];
let _docsCurrentSection = null;
let _currentDocType = null; // 'pdf' или 'docx'

async function openHotkeysHelp() {
  document.getElementById('docs-sidebar').innerHTML = `<p style="color:#94a3b8;padding:10px;">Загрузка…</p>`;
  document.getElementById('doc-preview-container').innerHTML = '';
  document.getElementById('doc-actions').style.display = 'none';
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
      // 🆕 Очищаем название от тегов {icon:...}, если они остались в БД
      const cleanTitle = s.title.replace(/\{icon:.*?\}/g, '').trim();
      return `
      <button class="docs-nav-item ${s.slug === _docsCurrentSection ? 'active' : ''}"
              style="display:block; width:100%; text-align:left; padding:10px; border-radius:6px; border:none; background:${s.slug === _docsCurrentSection ? '#eef2ff' : 'transparent'}; color:${s.slug === _docsCurrentSection ? '#4f46e5' : '#334155'}; font-weight:${s.slug === _docsCurrentSection ? '600' : '400'}; cursor:pointer; margin-bottom:4px; transition: background .15s;"
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

async function loadDocFile(slug) {
  const sec = _docsSections.find(s => s.slug === slug);
  const container = document.getElementById('doc-preview-container');
  const actions = document.getElementById('doc-actions');
  const downloadLink = document.getElementById('doc-download-link');

  container.innerHTML = '<div class="fa-solid fa-spinner fa-spin" style="font-size:2rem; color:#4f46e5; margin-top:50px;"></div>';
  actions.style.display = 'none';

  if (!sec || !sec.filePath) {
    container.innerHTML = '<p style="color:#dc2626;">Файл для этого раздела не прикреплен.</p>';
    return;
  }

  // Добавляем слеш в начало, если его нет
  const fileUrl = sec.filePath.startsWith('/') ? sec.filePath : '/' + sec.filePath;
  downloadLink.href = fileUrl;

  const ext = sec.filePath.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    _currentDocType = 'pdf';
    container.innerHTML = `<iframe src="${fileUrl}#toolbar=0" style="width:100%; height:100%; border:none; border-radius:8px; background:#fff;"></iframe>`;
    actions.style.display = 'flex';
  } 
  else if (ext === 'docx' || ext === 'doc') {
    _currentDocType = 'docx';
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('Файл не найден на сервере');
      const blob = await response.blob();
      
      container.innerHTML = '<div id="docx-render-area" style="width:100%; background:#fff; padding:30px; box-shadow: 0 4px 12px rgba(0,0,0,.1);"></div>';
      
      // Рендерим Word в HTML
      await window.docx.renderAsync(blob, document.getElementById('docx-render-area'), null, {
        className: "docx-preview",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        renderHeaders: true,
        renderFooters: true
      });
      actions.style.display = 'flex';
    } catch (e) {
      console.error(e);
      container.innerHTML = `<div style="text-align:center; margin-top:50px; color:#dc2626;">
        <p>Ошибка чтения Word файла.</p>
        <a href="${fileUrl}" download class="btn btn-secondary">Скачать оригинал</a>
      </div>`;
    }
  } else {
    container.innerHTML = `<p style="color:#dc2626;">Формат файла не поддерживается для предпросмотра. <br><br> <a href="${fileUrl}" download class="btn btn-secondary">Скачать файл</a></p>`;
  }
}

function printCurrentDoc() {
  if (_currentDocType === 'pdf') {
    const iframe = document.querySelector('#doc-preview-container iframe');
    if (iframe) iframe.contentWindow.print();
  } 
  else if (_currentDocType === 'docx') {
    const content = document.getElementById('docx-render-area').innerHTML;
    const win = window.open('', '_blank');
    
    win.document.write(`
      <html>
      <head>
        <title>Печать справки</title>
        <style>
          body { 
            font-family: 'Times New Roman', serif; 
            font-size: 12pt; 
            color: #000; 
            padding: 20px; 
            margin: 0;
          }
          /* Стили для рендера docx-preview */
          .docx-wrapper { background: transparent !important; padding: 0 !important; }
          table { 
            border-collapse: collapse; 
            width: 100%; 
            margin: 10px 0;
          } 
          th, td { 
            border: 1px solid #000 !important; 
            padding: 6px 10px; 
            font-size: 11pt;
          }
          th { background-color: #f1f5f9 !important; font-weight: bold; }
          h1 { font-size: 16pt; text-align: center; }
          h2 { font-size: 14pt; margin-top: 20px; }
          p { margin-bottom: 10px; line-height: 1.4; }
          @page { size: A4 portrait; margin: 15mm; }
        </style>
      </head>
      <body>${content}</body>
      </html>
    `);
    win.document.close();
    
    // Ждем полсекунды, чтобы браузер отрисовал HTML, и вызываем печать
    setTimeout(() => { 
      win.print(); 
      win.close(); 
    }, 500);
  }
}
