const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const { withTransaction } = require('../utils/db-helper');
const HTMLtoDOCX = require('html-to-docx');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'frontend', 'uploads', 'help');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});

const ALLOWED_MIMES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip', 'application/x-zip-compressed',
  'text/plain', 'text/csv'
];

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ALLOWED_MIMES.includes(file.mimetype);
    cb(ok ? null : new Error('Недопустимый формат файла'), ok);
  },
});

function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  let s = html;
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  s = s.replace(/<\/?(iframe|object|embed|form|input|button)[^>]*>/gi, '');
  s = s.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
  return s;
}

let _helpCache = null;
let _helpCacheTime = 0;
const HELP_CACHE_TTL = 60_000;

async function getHelpDocsCached() {
  const now = Date.now();
  if (_helpCache && now - _helpCacheTime < HELP_CACHE_TTL) return _helpCache;
  const [rows] = await db.query(
    'SELECT id, slug, title, content, required_permissions, sort_order, enabled FROM help_docs ORDER BY sort_order ASC, id ASC'
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

// Получить видимые разделы для пользователя (с файлами)
router.get('/visible', authenticate, async (req, res) => {
  try {
    const rows = await getHelpDocsCached();
    const visible = rows
      .filter(r => r.enabled)
      .filter(r => canSeeSection(req.user, r));
      
    // 🆕 Отдаем filePath вместо старого content
    res.json(visible.map(r => ({ 
      id: r.id, 
      slug: r.slug, 
      title: r.title, 
      filePath: r.file_path 
    })));
  } catch (e) {
    console.error('GET /help/visible:', e);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

router.get('/images/list', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, filename, original_name, mime_type, size_bytes, uploaded_by, created_at FROM help_images ORDER BY created_at DESC LIMIT 200');
    res.json(rows.map(r => ({
      id: r.id, filename: r.filename, originalName: r.original_name,
      mimeType: r.mime_type, sizeBytes: r.size_bytes,
      url: '/uploads/help/' + r.filename, createdAt: r.created_at,
    })));
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.get('/export/all', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, slug, title, content, required_permissions, sort_order, enabled FROM help_docs ORDER BY sort_order ASC, id ASC');
    res.json(rows.map(r => ({
      slug: r.slug, title: r.title, content: r.content,
      requiredPermissions: db.safeParse(r.required_permissions, []),
      sortOrder: r.sort_order, enabled: !!r.enabled,
    })));
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, slug, title, content, required_permissions, sort_order, enabled FROM help_docs ORDER BY sort_order ASC, id ASC');
    res.json(rows.map(r => ({
      id: r.id, slug: r.slug, title: r.title, content: r.content,
      requiredPermissions: db.safeParse(r.required_permissions, []),
      sortOrder: r.sort_order, enabled: !!r.enabled,
    })));
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.get('/:slug', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, slug, title, content, required_permissions, sort_order, enabled FROM help_docs WHERE slug = ?', [req.params.slug]);
    if (!rows.length) return res.status(404).json({ error: 'Не найден' });

    const row = rows[0];
    if (!canSeeSection(req.user, row)) {
      return res.status(403).json({ error: 'Нет доступа к разделу' });
    }

    res.json({
      id: row.id, slug: row.slug, title: row.title, content: row.content,
      requiredPermissions: db.safeParse(row.required_permissions, []),
      sortOrder: row.sort_order, enabled: !!row.enabled,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { slug, title, content, requiredPermissions, sortOrder, enabled } = req.body || {};
    if (!slug || !/^[a-z][a-z0-9_-]*$/.test(slug)) return res.status(400).json({ error: 'Некорректный внутренний код' });
    if (!title || !content) return res.status(400).json({ error: 'Заполните заголовок и содержимое' });

    const [ex] = await db.query('SELECT id FROM help_docs WHERE slug = ?', [slug]);
    if (ex.length) return res.status(409).json({ error: 'Раздел уже существует' });

    await db.query(
      `INSERT INTO help_docs (slug, title, content, required_permissions, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [slug, String(title).trim(), sanitizeHtml(content),
       JSON.stringify(Array.isArray(requiredPermissions) ? requiredPermissions : []),
       parseInt(sortOrder, 10) || 0,
       enabled === false ? 0 : 1]
    );

    await logAction(req, 'Создание раздела справки', slug);
    invalidateHelpCache();
    res.status(201).json({ message: 'Создан' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

router.put('/:slug', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { title, content, requiredPermissions, sortOrder, enabled } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'Заполните заголовок и содержимое' });

    const [ex] = await db.query('SELECT id FROM help_docs WHERE slug = ?', [req.params.slug]);
    if (!ex.length) return res.status(404).json({ error: 'Не найден' });

    await db.query(
      `UPDATE help_docs SET title = ?, content = ?, required_permissions = ?,
         sort_order = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?`,
      [String(title).trim(), sanitizeHtml(content),
       JSON.stringify(Array.isArray(requiredPermissions) ? requiredPermissions : []),
       parseInt(sortOrder, 10) || 0,
       enabled === false ? 0 : 1,
       req.params.slug]
    );

    await logAction(req, 'Редактирование справки', req.params.slug);
    invalidateHelpCache();
    res.json({ message: 'Обновлён' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

router.delete('/:slug', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [ex] = await db.query('SELECT title FROM help_docs WHERE slug = ?', [req.params.slug]);
    if (!ex.length) return res.status(404).json({ error: 'Не найден' });
    await db.query('DELETE FROM help_docs WHERE slug = ?', [req.params.slug]);
    await logAction(req, 'Удаление раздела справки', ex[0].title);
    invalidateHelpCache();
    res.json({ message: 'Удалён' });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/reorder', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order — массив' });
    for (let i = 0; i < order.length; i++) {
      await db.query('UPDATE help_docs SET sort_order = ? WHERE slug = ?', [i, order[i]]);
    }
    invalidateHelpCache();
    res.json({ message: 'Порядок обновлён' });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/import', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { sections, mode } = req.body || {};
    if (!Array.isArray(sections)) return res.status(400).json({ error: 'sections — массив' });

    await withTransaction(async (conn) => {
      if (mode === 'replace') await conn.query('DELETE FROM help_docs');
      for (const s of sections) {
        if (!s.slug || !s.title || !s.content) continue;
        await conn.query(
          `INSERT INTO help_docs (slug, title, content, required_permissions, sort_order, enabled)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             title = VALUES(title), content = VALUES(content),
             required_permissions = VALUES(required_permissions),
             sort_order = VALUES(sort_order), enabled = VALUES(enabled)`,
          [s.slug, s.title, sanitizeHtml(s.content),
           JSON.stringify(Array.isArray(s.requiredPermissions) ? s.requiredPermissions : []),
           parseInt(s.sortOrder, 10) || 0,
           s.enabled === false ? 0 : 1]
        );
      }
    });
    invalidateHelpCache();
    res.json({ message: `Загружено: ${sections.length}` });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/files/upload', authenticate, requireRole(['admin']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не передан' });
    const f = req.file;
    await db.query(
      `INSERT INTO help_images (filename, original_name, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?)`,
      [f.filename, f.originalname, f.mimetype, f.size, req.user.id]
    );
    res.json({
      url: '/uploads/help/' + f.filename,
      filename: f.filename,
      originalName: f.originalname,
      isImage: f.mimetype.startsWith('image/'),
      isPdf: f.mimetype === 'application/pdf',
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка загрузки' }); }
});

router.post('/images/upload', authenticate, requireRole(['admin']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не передан' });
    const f = req.file;
    await db.query(
      `INSERT INTO help_images (filename, original_name, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?)`,
      [f.filename, f.originalname, f.mimetype, f.size, req.user.id]
    );
    res.json({ url: '/uploads/help/' + f.filename, filename: f.filename });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка загрузки' }); }
});

// ═══════════════════════════════════════════════════════════
// ЭКСПОРТ В WORD (.docx)
// ═══════════════════════════════════════════════════════════
router.post('/export-docx', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { title, htmlContent } = req.body;
    if (!htmlContent) return res.status(400).json({ error: 'Нет содержимого' });

    // 1. Санитизируем HTML
    let cleanHtml = sanitizeHtml(htmlContent);

    // 2. 🆕 Превращаем относительные пути картинок в абсолютные
    // Берем протокол из заголовков (для работы за Nginx/HTTPS)
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;
    cleanHtml = cleanHtml.replace(/src="(\/uploads\/[^"]+)"/g, `src="${baseUrl}$1"`);

    // 3. Оборачиваем в минимальный HTML-каркас
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${cleanHtml}</body></html>`;

    // 4. Конвертируем
    const buffer = await HTMLtoDOCX(fullHtml, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
    });

    const filename = encodeURIComponent(`Справка_${title || 'Раздел'}.docx`);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    console.error('DOCX Export error:', e);
    res.status(500).json({ error: 'Ошибка экспорта в Word' });
  }
});

module.exports = router;
