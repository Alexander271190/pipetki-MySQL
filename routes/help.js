const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'frontend', 'uploads', 'help');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
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

router.post('/upload', authenticate, requireRole(['admin']), upload.single('file'), async (req, res) => {
  try {
    const { slug, title, requiredPermissions, sortOrder, enabled } = req.body;
    if (!slug || !/^[a-z][a-z0-9_-]*$/.test(slug)) return res.status(400).json({ error: 'Некорректный код' });
    if (!title) return res.status(400).json({ error: 'Заполните заголовок' });

    const [ex] = await db.query('SELECT id, file_path FROM help_docs WHERE slug = ?', [slug]);
    let filePath = ex.length ? ex[0].file_path : null;
    if (req.file) filePath = `uploads/help/${req.file.filename}`;
    else if (!ex.length) return res.status(400).json({ error: 'Файл обязателен' });

    const permsJson = requiredPermissions || '[]';
    const isEnabled = enabled === 'true' ? 1 : 0;
    const sort = parseInt(sortOrder, 10) || 0;

    if (ex.length) {
      await db.query(`UPDATE help_docs SET title=?, file_path=?, required_permissions=?, sort_order=?, enabled=? WHERE slug=?`,
        [String(title).trim(), filePath, permsJson, sort, isEnabled, slug]);
    } else {
      await db.query(`INSERT INTO help_docs (slug, title, file_path, required_permissions, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?)`,
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
