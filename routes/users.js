const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// ============================================================
// Генератор разового пароля (12 символов, соответствует политике)
// ============================================================
function generateTempPassword() {
  const lower  = 'abcdefghijkmnpqrstuvwxyz';
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const spec   = '!@#$%^&*';

  const pick = (s) => s[crypto.randomInt(0, s.length)];

  const chars = [
    pick(lower), pick(upper), pick(digits), pick(spec),
    pick(lower), pick(upper), pick(digits), pick(spec),
    pick(lower), pick(upper), pick(digits), pick(spec),
  ];

  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ============================================================
// СПИСОК ПОЛЬЗОВАТЕЛЕЙ
// ============================================================
router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  const [users] = await db.query(
    'SELECT id, login, full_name, position, department, role, only_own_department, extra_permissions FROM users');
  res.json(users.map(u => ({
    ...u,
    onlyOwnDepartment: !!u.only_own_department,
    extraPermissions: db.safeParse(u.extra_permissions, [])
  })));
});

// ============================================================
// СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ
// ============================================================
router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { login, fullName, position, department, role,
            onlyOwnDepartment, extraPermissions } = req.body;

    const missing = [];
    if (!login)    missing.push('Логин');
    if (!fullName) missing.push('ФИО');
    if (!position) missing.push('Должность');
    if (missing.length > 0) {
      const msg = missing.length === 1
        ? `Заполните поле «${missing[0]}»`
        : `Заполните поля: ${missing.map(m => `«${m}»`).join(', ')}`;
      return res.status(400).json({ error: msg });
    }

        if (onlyOwnDepartment && !department) {
      return res.status(400).json({
        error: 'Для галки «Только свой отдел» нужно указать отдел. ' +
               'Заполните поле «Отдел» или снимите галку.'
      });
    }

    const [ex] = await db.query('SELECT id FROM users WHERE login = ?', [login]);
    if (ex.length) return res.status(409).json({ error: 'Логин уже занят' });

    const id = 'u_' + crypto.randomBytes(8).toString('hex');

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await db.query(
      `INSERT INTO users
       (id, login, password, full_name, position, department, role,
        only_own_department, extra_permissions, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, login, passwordHash, fullName, position, department || '', role || 'user',
       onlyOwnDepartment ? 1 : 0, JSON.stringify(extraPermissions || [])]
    );

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Создание пользователя',
       `Создан ${login} (${fullName}), выдан разовый пароль`]
    );

    res.status(201).json({
      message: 'Пользователь создан',
      id,
      login,
      tempPassword
    });
  } catch (e) {
    console.error('POST /users error:', e);
    res.status(500).json({ error: 'Ошибка создания пользователя' });
  }
});

// ============================================================
// ОБНОВЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
// ============================================================
router.put('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { login, fullName, position, department, role,
            onlyOwnDepartment, extraPermissions } = req.body;
    const id = req.params.id;

    const missing = [];
    if (!login)    missing.push('Логин');
    if (!fullName) missing.push('ФИО');
    if (!position) missing.push('Должность');
    if (missing.length > 0) {
      return res.status(400).json({
        error: missing.length === 1
          ? `Заполните поле «${missing[0]}»`
          : `Заполните поля: ${missing.map(m => `«${m}»`).join(', ')}`
      });
    }

        if (onlyOwnDepartment && !department) {
      return res.status(400).json({
        error: 'Для галки «Только свой отдел» нужно указать отдел. ' +
               'Заполните поле «Отдел» или снимите галку.'
      });
    }

    const [ex] = await db.query('SELECT id, role FROM users WHERE id = ?', [id]);
    if (!ex.length) return res.status(404).json({ error: 'Не найден' });

    // Защита последнего админа: не даём понизить/лишить роль admin
    if (ex[0].role === 'admin' && role !== 'admin') {
      const [admins] = await db.query(
        `SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`
      );
      if (admins[0].c <= 1) {
        return res.status(400).json({ error: 'Нельзя понизить последнего администратора' });
      }
    }

    // Нельзя понизить себя (иначе можно случайно остаться без прав)
    if (ex[0].role === 'admin' && role !== 'admin' && id === req.user.id) {
      return res.status(400).json({ error: 'Нельзя понизить собственную роль администратора' });
    }

    const [dup] = await db.query(
      'SELECT id FROM users WHERE login = ? AND id <> ?',
      [login, id]
    );
    if (dup.length) return res.status(409).json({ error: 'Логин уже занят' });

    const onlyOwn = onlyOwnDepartment ? 1 : 0;

    await db.query(
      `UPDATE users SET login=?, full_name=?, position=?, department=?, role=?,
         only_own_department=?, extra_permissions=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [login, fullName, position, department || '', role || 'user',
       onlyOwn, JSON.stringify(extraPermissions || []), id]
    );

    res.json({ message: 'Пользователь обновлён' });
  } catch (e) {
    console.error('PUT /users error:', e);
    res.status(500).json({ error: 'Ошибка обновления пользователя' });
  }
});

// ============================================================
// УДАЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
// ============================================================
router.delete('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        error: 'Нельзя удалить собственную учётную запись'
      });
    }

    const [users] = await db.query('SELECT role FROM users WHERE id = ?', [req.params.id]);
    if (!users.length) return res.status(404).json({ error: 'Не найден' });

    if (users[0].role === 'admin') {
      const [admins] = await db.query(`SELECT id FROM users WHERE role = 'admin'`);
      if (admins.length <= 1) {
        return res.status(400).json({ error: 'Нельзя удалить последнего админа' });
      }
    }

    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'Пользователь удалён' });
  } catch (e) {
    console.error('DELETE /users error:', e);
    res.status(500).json({ error: 'Ошибка удаления пользователя' });
  }
});

// ============================================================
// СБРОС ПАРОЛЯ (админом)
// ============================================================
router.post('/:id/reset-password', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const userId = req.params.id;

    const [ex] = await db.query('SELECT id, login, full_name FROM users WHERE id = ?', [userId]);
    if (!ex.length) return res.status(404).json({ error: 'Пользователь не найден' });

    const user = ex[0];

    if (userId === req.user.id) {
      return res.status(400).json({
        error: 'Для смены своего пароля используйте «Сменить пароль» в шапке'
      });
    }

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);

    await db.query(
      `UPDATE users
       SET password = ?,
           must_change_password = 1,
           password_changed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [hash, userId]
    );

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Сброс пароля',
       `Выдан разовый пароль для ${user.login} (${user.full_name})`]
    );

    res.json({
      message: 'Разовый пароль выдан',
      tempPassword,
      login: user.login,
      fullName: user.full_name
    });
  } catch (e) {
    console.error('POST /users/:id/reset-password error:', e);
    res.status(500).json({ error: 'Ошибка сброса пароля' });
  }
});

module.exports = router;
