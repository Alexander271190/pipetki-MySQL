const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'frontend', 'uploads', 'help');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Только изображения'), ok);
  },
});

function canSeeSection(user, row) {
  if (user.role === 'admin') return true;
  let req = [];
  try { req = JSON.parse(row.required_permissions || '[]'); } catch (e) {}
  if (!Array.isArray(req) || req.length === 0) return true;
  const perms = db.safeParse(user.extra_permissions, []);
  return req.some(p => perms.includes(p));
}

// GET /api/help/visible
router.get('/visible', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, slug, title, content, required_permissions, sort_order FROM help_docs WHERE enabled = 1 ORDER BY sort_order ASC, id ASC'
    );
    const visible = rows.filter(r => canSeeSection(req.user, r));
    res.json(visible.map(r => ({ id: r.id, slug: r.slug, title: r.title, content: r.content })));
  } catch (e) {
    console.error('GET /help/visible:', e);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

// GET /api/help/images/list
router.get('/images/list', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM help_images ORDER BY created_at DESC LIMIT 200');
    res.json(rows.map(r => ({
      id: r.id, filename: r.filename, originalName: r.original_name,
      mimeType: r.mime_type, sizeBytes: r.size_bytes,
      url: '/uploads/help/' + r.filename, createdAt: r.created_at,
    })));
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// GET /api/help/export/all
router.get('/export/all', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM help_docs ORDER BY sort_order ASC, id ASC');
    res.json(rows.map(r => ({
      slug: r.slug, title: r.title, content: r.content,
      requiredPermissions: db.safeParse(r.required_permissions, []),
      sortOrder: r.sort_order, enabled: !!r.enabled,
    })));
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// GET /api/help
router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM help_docs ORDER BY sort_order ASC, id ASC');
    res.json(rows.map(r => ({
      id: r.id, slug: r.slug, title: r.title, content: r.content,
      requiredPermissions: db.safeParse(r.required_permissions, []),
      sortOrder: r.sort_order, enabled: !!r.enabled,
    })));
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/help
router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { slug, title, content, requiredPermissions, sortOrder, enabled } = req.body || {};
    if (!slug || !/^[a-z][a-z0-9_-]*$/.test(slug)) return res.status(400).json({ error: 'Некорректный slug' });
    if (!title || !content) return res.status(400).json({ error: 'Заполните заголовок и содержимое' });

    const [ex] = await db.query('SELECT id FROM help_docs WHERE slug = ?', [slug]);
    if (ex.length) return res.status(409).json({ error: 'Slug занят' });

    await db.query(
      `INSERT INTO help_docs (slug, title, content, required_permissions, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [slug, String(title).trim(), content,
       JSON.stringify(Array.isArray(requiredPermissions) ? requiredPermissions : []),
       parseInt(sortOrder, 10) || 0,
       enabled === false ? 0 : 1]
    );

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Создание раздела справки', slug]
    );
    res.status(201).json({ message: 'Создан' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

// PUT /api/help/:slug
router.put('/:slug', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { title, content, requiredPermissions, sortOrder, enabled } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'Заполните заголовок и содержимое' });

    const [ex] = await db.query('SELECT id FROM help_docs WHERE slug = ?', [req.params.slug]);
    if (!ex.length) return res.status(404).json({ error: 'Не найден' });

    await db.query(
      `UPDATE help_docs SET title = ?, content = ?, required_permissions = ?,
         sort_order = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?`,
      [String(title).trim(), content,
       JSON.stringify(Array.isArray(requiredPermissions) ? requiredPermissions : []),
       parseInt(sortOrder, 10) || 0,
       enabled === false ? 0 : 1,
       req.params.slug]
    );

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Редактирование справки', req.params.slug]
    );
    res.json({ message: 'Обновлён' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

// DELETE /api/help/:slug
router.delete('/:slug', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const [ex] = await db.query('SELECT title FROM help_docs WHERE slug = ?', [req.params.slug]);
    if (!ex.length) return res.status(404).json({ error: 'Не найден' });
    await db.query('DELETE FROM help_docs WHERE slug = ?', [req.params.slug]);
    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Удаление раздела справки', ex[0].title]
    );
    res.json({ message: 'Удалён' });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/help/reorder
router.post('/reorder', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order — массив' });
    for (let i = 0; i < order.length; i++) {
      await db.query('UPDATE help_docs SET sort_order = ? WHERE slug = ?', [i, order[i]]);
    }
    res.json({ message: 'Порядок обновлён' });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/help/import
router.post('/import', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { sections, mode } = req.body || {};
    if (!Array.isArray(sections)) return res.status(400).json({ error: 'sections — массив' });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
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
          [s.slug, s.title, s.content,
           JSON.stringify(Array.isArray(s.requiredPermissions) ? s.requiredPermissions : []),
           parseInt(s.sortOrder, 10) || 0,
           s.enabled === false ? 0 : 1]
        );
      }
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

    res.json({ message: `Загружено: ${sections.length}` });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/help/images/upload
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

// DELETE /api/help/images/:filename
router.delete('/images/:filename', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    try { fs.unlinkSync(path.join(UPLOAD_DIR, filename)); } catch (e) {}
    await db.query('DELETE FROM help_images WHERE filename = ?', [filename]);
    res.json({ message: 'Удалено' });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

module.exports = router;
