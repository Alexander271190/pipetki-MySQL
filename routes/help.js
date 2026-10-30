const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'frontend', 'help-defaults');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Временное имя — потом переименуем в <slug>.<ext> в обработчике /upload
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `tmp_${Date.now()}${ext}`);
  },
});
   
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(allowed.includes(ext) ? null : new Error('Разрешены только PDF или Word'), allowed.includes(ext));
  },
});

let _helpCache = null;
let _helpCacheTime = 0;
const HELP_CACHE_TTL = 60_000;

async function getHelpDocsCached() {
  const now = Date.now();
  if (_helpCache && now - _helpCacheTime < HELP_CACHE_TTL) return _helpCache;
  
  // 🆕 ОБРАТИТЕ ВНИМАНИЕ: выбираем file_path
  const [rows] = await db.query(
    'SELECT id, slug, title, file_path, required_permissions, sort_order, enabled FROM help_docs ORDER BY sort_order ASC, id ASC'
  );
  for (const r of rows) {
    let rp = [];
    try { rp = JSON.parse(r.required_permissions || '[]'); } catch (e) { rp = []; }
    if (!Array.isArray(rp)) rp = [];
    r._requiredPerms = rp;
  }
  _helpCache = rows;
  _helpCacheTime = now;
  return rows;
}

function invalidateHelpCache() {
  _helpCache = null;
  _helpCacheTime = 0;
}

function canSeeSection(user, row) {
  if (user.role === 'admin') return true;
  let req = [];
  try { req = JSON.parse(row.required_permissions || '[]'); } catch (e) {}
  if (!Array.isArray(req) || req.length === 0) return true;
  const perms = user._perms || [];
  return req.some(p => perms.includes(p));
}

// 🆕 ИСПРАВЛЕННЫЙ МАРШРУТ /visible
router.get('/visible', authenticate, async (req, res) => {
  try {
    const rows = await getHelpDocsCached();
    const visible = rows
      .filter(r => r.enabled)
      .filter(r => canSeeSection(req.user, r));
      
    res.json(visible.map(r => ({ 
      id: r.id, 
      slug: r.slug, 
      title: r.title, 
      filePath: r.file_path   // Отдаем filePath
    })));
  } catch (e) {
    console.error('GET /help/visible:', e);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, slug, title, file_path, required_permissions, sort_order, enabled FROM help_docs ORDER BY sort_order ASC, id ASC');
    res.json(rows.map(r => ({
      id: r.id, slug: r.slug, title: r.title, 
      filePath: r.file_path,
      requiredPermissions: db.safeParse(r.required_permissions, []),
      sortOrder: r.sort_order, enabled: !!r.enabled,
    })));
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// 🆕 Вспомогательная функция транслитерации для авто-генерации кода
function slugifyTitle(text) {
  const ru = { 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya' };
  let res = text.toLowerCase().split('').map(ch => ru[ch] !== undefined ? ru[ch] : ch).join('');
  res = res.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return res || 'doc_' + Date.now().toString(36);
}

router.post('/upload', authenticate, requireRole(['admin']), upload.single('file'), async (req, res) => {
  try {
    let { slug, title, requiredPermissions, sortOrder, enabled } = req.body;
    if (!title) return res.status(400).json({ error: 'Заполните заголовок' });

    // 🆕 АВТО-ГЕНЕРАЦИЯ SLUG (если его нет, например, при создании нового)
    if (!slug) {
      const baseSlug = slugifyTitle(title);
      let finalSlug = baseSlug;
      let counter = 1;
      // Проверяем на дубликаты в базе
      while (true) {
        const [ex] = await db.query('SELECT id FROM help_docs WHERE slug = ?', [finalSlug]);
        if (ex.length === 0) break;
        finalSlug = `${baseSlug}_${counter++}`;
      }
      slug = finalSlug;
    }

    const [ex] = await db.query('SELECT id, file_path FROM help_docs WHERE slug = ?', [slug]);
        let filePath = ex.length ? ex[0].file_path : null;
    
    if (req.file) {
      // Переименовываем файл в <slug>.<ext> для корректной работы seedHelpDocs
      const ext = path.extname(req.file.filename).toLowerCase();
      const newName = `${slug}${ext}`;
      const oldPath = path.join(UPLOAD_DIR, req.file.filename);
      const newPath = path.join(UPLOAD_DIR, newName);

      // Удаляем старый файл с таким же slug, но другим расширением (например, был .docx, стал .pdf)
      for (const otherExt of ['.pdf', '.docx', '.doc']) {
        if (otherExt !== ext) {
          const otherPath = path.join(UPLOAD_DIR, `${slug}${otherExt}`);
          if (fs.existsSync(otherPath)) {
            try { fs.unlinkSync(otherPath); } catch (e) {}
          }
        }
      }

      try {
        fs.renameSync(oldPath, newPath);
        req.file.filename = newName; 
        filePath = `help-defaults/${newName}`;
      } catch (e) {
        console.error('Ошибка переименования:', e.message);
        return res.status(500).json({ error: 'Не удалось сохранить файл' });
      }
    } else if (!ex.length) {
      return res.status(400).json({ error: 'Файл обязателен для нового раздела' });
    }

    const permsJson = requiredPermissions || '[]';
    const isEnabled = enabled === 'true' ? 1 : 0;
    const sort = parseInt(sortOrder, 10) || 0;

    if (ex.length) {
      await db.query(`UPDATE help_docs SET title=?, file_path=?, required_permissions=?, sort_order=?, enabled=? WHERE slug=?`,
        [String(title).trim(), filePath, permsJson, sort, isEnabled, slug]);
    } else {
      // 🆕 Добавили передачу пустой строки для content, чтобы MySQL не ругался
      await db.query(`INSERT INTO help_docs (slug, title, content, file_path, required_permissions, sort_order, enabled) VALUES (?, ?, '', ?, ?, ?, ?)`,
        [slug, String(title).trim(), filePath, permsJson, sort, isEnabled]);
    }
    await logAction(req, 'Сохранение раздела справки', `${title} (${slug})`);
    invalidateHelpCache();
    res.json({ message: 'Раздел сохранен' });
  } catch (e) {
    console.error('POST /help/upload:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения' });
  }
});

router.delete('/:slug', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [ex] = await db.query('SELECT title, file_path FROM help_docs WHERE slug = ?', [req.params.slug]);
    if (!ex.length) return res.status(404).json({ error: 'Не найден' });
    if (ex[0].file_path) {
      const absolutePath = path.join(__dirname, '..', 'frontend', ex[0].file_path);
      if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    }
    await db.query('DELETE FROM help_docs WHERE slug = ?', [req.params.slug]);
    invalidateHelpCache();
    res.json({ message: 'Удалён' });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/reset', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    await db.query('DELETE FROM help_docs');
    await db.seedHelpDocs();
    invalidateHelpCache();
    res.json({ message: 'Справка восстановлена' });
  } catch (e) { res.status(500).json({ error: 'Ошибка сброса' }); }
});

module.exports = router;
