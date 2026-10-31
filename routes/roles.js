'use strict';
const express = require('express');
const db = require('../db');
const { authenticate, requireAnyPermission } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const roleCache = require('../utils/roles');

const router = express.Router();

// GET — список (доступен всем авторизованным)
router.get('/', authenticate, async (req, res) => {
  try {
    res.json(await roleCache.getRoles({ force: true }));
  } catch (e) {
    console.error('GET /roles:', e);
    res.status(500).json({ error: 'Ошибка загрузки ролей' });
  }
});

// POST — создать (требует manage_users)
router.post('/', authenticate, requireAnyPermission(['manage_users']), async (req, res) => {
  try {
    const { name, permissions, isAdmin } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Укажите название' });
    }
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'permissions должен быть массивом' });
    }

    const cleanName = String(name).trim();
    const [dup] = await db.query('SELECT id FROM roles WHERE name = ?', [cleanName]);
    if (dup.length) return res.status(409).json({ error: 'Роль с таким названием уже существует' });

    const value = await roleCache.generateUniqueValue(cleanName);
    
    // Только настоящий админ может создавать роли с флагом is_admin
    const finalIsAdmin = (req.user._isAdmin && isAdmin) ? 1 : 0;
    
    const [result] = await db.query(
      'INSERT INTO roles (name, value, permissions, is_admin, is_system) VALUES (?, ?, ?, ?, 0)',
      [cleanName, value, JSON.stringify(permissions), finalIsAdmin]
    );

    roleCache.invalidate();
    await logAction(req, 'Создание роли', cleanName);
    res.status(201).json({ id: result.insertId, message: 'Роль создана' });
  } catch (e) {
    console.error('POST /roles:', e);
    res.status(500).json({ error: 'Ошибка создания роли' });
  }
});

// PUT — обновить (требует manage_users)
router.put('/:id', authenticate, requireAnyPermission(['manage_users']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, permissions, isAdmin } = req.body || {};

    const [ex] = await db.query('SELECT * FROM roles WHERE id = ?', [id]);
    if (!ex.length) return res.status(404).json({ error: 'Роль не найдена' });

    if (ex[0].value === 'admin') {
      return res.status(400).json({ error: 'Роль «Администратор» изменить нельзя' });
    }

    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Укажите название' });
    if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions должен быть массивом' });

    const cleanName = String(name).trim();
    const [dup] = await db.query(
      'SELECT id FROM roles WHERE name = ? AND id <> ?', [cleanName, id]
    );
    if (dup.length) return res.status(409).json({ error: 'Роль с таким названием уже существует' });

    // Для системных ролей user/senior_lab запрещаем менять is_admin
    let finalIsAdmin = isAdmin ? 1 : 0;
    if (ex[0].value === 'user' || ex[0].value === 'senior_lab') {
      finalIsAdmin = ex[0].is_admin;
    }
    
    // Не-админ не может менять флаг is_admin ни у одной роли
    if (!req.user._isAdmin) {
      finalIsAdmin = ex[0].is_admin;
    }

    await db.query(
      'UPDATE roles SET name = ?, permissions = ?, is_admin = ? WHERE id = ?',
      [cleanName, JSON.stringify(permissions), finalIsAdmin, id]
    );
    roleCache.invalidate();
    await logAction(req, 'Изменение роли', cleanName);
    res.json({ message: 'Роль обновлена' });
  } catch (e) {
    console.error('PUT /roles:', e);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// DELETE (требует manage_users)
router.delete('/:id', authenticate, requireAnyPermission(['manage_users']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [ex] = await db.query('SELECT * FROM roles WHERE id = ?', [id]);
    if (!ex.length) return res.status(404).json({ error: 'Роль не найдена' });

    if (ex[0].is_system) {
      return res.status(400).json({ error: 'Системную роль удалить нельзя' });
    }

    const [used] = await db.query(
      'SELECT COUNT(*) AS c FROM users WHERE role = ?', [ex[0].value]
    );
    if (used[0].c > 0) {
      return res.status(400).json({
        error: `Роль назначена ${used[0].c} пользователям. Сначала смените им роль.`
      });
    }

    await db.query('DELETE FROM roles WHERE id = ?', [id]);
    roleCache.invalidate();
    await logAction(req, 'Удаление роли', ex[0].name);
    res.json({ message: 'Роль удалена' });
  } catch (e) {
    console.error('DELETE /roles:', e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
