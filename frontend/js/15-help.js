'use strict';

let _docsSections = [];

async function openHotkeysHelp() {
  document.getElementById('docs-sidebar').innerHTML = `<p style="color:#94a3b8;padding:10px;">Загрузка…</p>`;
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

  renderDocsSidebar();
}

function closeHotkeysHelp() {
  UI.modal.close('hotkeys-modal');
}

function renderDocsSidebar() {
  const c = document.getElementById('docs-sidebar');
  if (!c) return;
  
  c.innerHTML = _docsSections.map(s => {
    const cleanTitle = s.title.replace(/\{icon:.*?\}/g, '').trim();
    const hasFile = !!s.filePath;
    
    if (!hasFile) {
      return `
   <div class="help-link-item help-link-missing"
       data-file-title="${esc(cleanTitle)}"
       onclick="showMissingFileToast(this.dataset.fileTitle)">
      <i class="fa-solid fa-triangle-exclamation" style="font-size:1.4rem; color:#d97706; width: 24px; text-align: center;"></i>
       <span style="font-weight:500; color:var(--text-muted); flex:1;">${esc(cleanTitle)}</span>
      <span style="font-size:.7rem; color:#d97706; font-weight:600; white-space:nowrap;">нет файла</span>
  </div>
`;
    }
    
    const fileUrl = s.filePath.startsWith('/') ? s.filePath : '/' + s.filePath;
    const isPdf = s.filePath.toLowerCase().endsWith('.pdf');
    const icon = isPdf ? 'fa-file-pdf' : 'fa-file-word';
    const iconColor = isPdf ? '#dc2626' : '#0ea5e9';
    return `
        <a href="${fileUrl}" target="_blank" class="help-link-item"
        data-file-url="${esc(fileUrl)}"
         data-file-title="${esc(cleanTitle)}"
         onclick="return checkAndOpenHelpFile(event, this.dataset.fileUrl, this.dataset.fileTitle)">
        <i class="fa-solid ${icon}" style="font-size:1.4rem; color:${iconColor}; width: 24px; text-align: center;"></i>
        <span style="font-weight:500; color:var(--text-strong);">${esc(cleanTitle)}</span>
      </a>
    `;
  }).join('');
}

function showMissingFileToast(title) {
  showToast(`Раздел «${title}» пока без файла. Обратитесь к администратору.`, 'warn');
}

async function checkAndOpenHelpFile(e, url, title) {
  e.preventDefault();

  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) {
      window.open(url, '_blank');
    } else {
      showToast(`Файл раздела «${title}» не найден. Обратитесь к администратору.`, 'error');
    }
  } catch (err) {
    showToast(`Не удалось проверить файл: ${err.message}`, 'error');
  }

  return false;
}
