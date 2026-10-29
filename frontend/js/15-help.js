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

// 🆕 Рендерим просто список ссылок
function renderDocsSidebar() {
  const c = document.getElementById('docs-sidebar');
  if (!c) return;
  
  c.innerHTML = _docsSections.map(s => {
    const cleanTitle = s.title.replace(/\{icon:.*?\}/g, '').trim();
    const fileUrl = s.filePath ? (s.filePath.startsWith('/') ? s.filePath : '/' + s.filePath) : '#';
    const isPdf = s.filePath && s.filePath.toLowerCase().endsWith('.pdf');
    const icon = isPdf ? 'fa-file-pdf' : 'fa-file-word';
    const iconColor = isPdf ? '#dc2626' : '#0ea5e9'; // Красный для PDF, Синий для Word
    
    return `
      <a href="${fileUrl}" target="_blank" class="docs-nav-item" style="display:flex; align-items:center; gap:12px; text-decoration:none; padding:12px; border-radius:8px; margin-bottom:4px; background:var(--card); border:1px solid var(--border);">
        <i class="fa-solid ${icon}" style="font-size:1.4rem; color:${iconColor}; width: 24px; text-align: center;"></i>
        <span style="font-weight:500; color:var(--text-strong);">${esc(cleanTitle)}</span>
      </a>
    `;
  }).join('');
}
