const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validatePassword } = require('../middleware/passwordPolicy');
const router = express.Router();

// ============================================================
// Генератор разового пароля (12 символов, соответствует политике)
// ============================================================
function generateTempPassword() {
  const lower  = 'abcdefghijkmnpqrstuvwxyz';
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const spec   = '!@#$%^&*';
  const pick = (s) => s[Math.floor(Math.random() * s.length)];

  const chars = [
    pick(lower), pick(upper), pick(digits), pick(spec),
    pick(lower), pick(upper), pick(digits), pick(spec),
    pick(lower), pick(upper), pick(digits), pick(spec),
  ];

  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  const [users] = await db.query(
    'SELECT id, login, full_name, position, department, role, only_own_department, extra_permissions FROM users');
  res.json(users.map(u => ({
    ...u,
    onlyOwnDepartment: !!u.only_own_department,
    extraPermissions: JSON.parse(u.extra_permissions || '[]')
  })));
});

router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
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

  const [ex] = await db.query('SELECT id FROM users WHERE login = ?', [login]);
  if (ex.length) return res.status(409).json({ error: 'Логин уже занят' });

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Разовый пароль генерируется автоматически
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
});

router.put('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  const { login, fullName, position, department, role,
  onlyOwnDepartment, extraPermissions } = req.body;
  const id = req.params.id;

  // 1. Проверяем, что такой пользователь существует
  const [ex] = await db.query('SELECT id FROM users WHERE id = ?', [id]);
  if (!ex.length) return res.status(404).json({ error: 'Не найден' });

  // 2. Проверяем, что новый логин не занят ДРУГИМ пользователем
  const [dup] = await db.query(
    'SELECT id FROM users WHERE login = ? AND id <> ?',
    [login, id]
  );
  if (dup.length) return res.status(409).json({ error: 'Логин уже занят' });

  const onlyOwn = onlyOwnDepartment ? 1 : 0;

  // 3. Обновляем
    await db.query(
    `UPDATE users SET login=?, full_name=?, position=?, department=?, role=?,
       only_own_department=?, extra_permissions=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [login, fullName, position, department || '', role || 'user',
     onlyOwn, JSON.stringify(extraPermissions || []), id]
  );
  res.json({ message: 'Пользователь обновлён' });
  });

  router.delete('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  const [users] = await db.query('SELECT role FROM users WHERE id = ?', [req.params.id]);
  if (!users.length) return res.status(404).json({ error: 'Не найден' });

  if (users[0].role === 'admin') {
    const [admins] = await db.query(`SELECT id FROM users WHERE role = 'admin'`);
    if (admins.length <= 1) return res.status(400).json({ error: 'Нельзя удалить последнего админа' });
  }

  await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ message: 'Пользователь удалён' });
});

module.exports = router;
