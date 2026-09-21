const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { validatePassword } = require('../middleware/passwordPolicy');
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_key';

// ============================================================
// ВХОД
// ============================================================
function userPublic(u) {
  return {
    id: u.id,
    login: u.login,
    fullName: u.full_name,
    position: u.position,
    department: u.department,
    role: u.role,
    onlyOwnDepartment: !!u.only_own_department,
    extraPermissions: JSON.parse(u.extra_permissions || '[]'),
    mustChangePassword: !!u.must_change_password
  };
}

router.post('/login', async (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    const missing = [];
    if (!login)    missing.push('Логин');
    if (!password) missing.push('Пароль');
    const msg = missing.length === 1
      ? `Заполните поле «${missing[0]}»`
      : `Заполните поля: ${missing.map(m => `«${m}»`).join(', ')}`;
    return res.status(400).json({ error: msg });
  }
  
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE login = ?', [login]);
    if (!rows.length)
      return res.status(401).json({ error: 'Неверный логин или пароль' });

    const passwordOk = await bcrypt.compare(password, rows[0].password);
    if (!passwordOk)
      return res.status(401).json({ error: 'Неверный логин или пароль' });

    const u = rows[0];
    const token = jwt.sign({ id: u.id, login: u.login, role: u.role }, JWT_SECRET, { expiresIn: '24h' });

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action) VALUES (?, ?, ?)',
      [u.id, u.full_name, 'Вход в систему']
    );

        res.json({ token, user: userPublic(u) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ============================================================
// ПРОВЕРКА СЕССИИ
// ============================================================
router.get('/verify', authenticate, (req, res) => {
  res.json({ user: userPublic(req.user) });
});
// ============================================================
// ВХОД ПОД ДРУГИМ ПОЛЬЗОВАТЕЛЕМ (impersonate)
// ============================================================
router.post('/impersonate/:userId', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Только администратор может входить под другими' });
    }

    const [targets] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.userId]);
    if (!targets.length) return res.status(404).json({ error: 'Пользователь не найден' });

    const target = targets[0];
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'Вы уже вошли под этой учётной записью' });
    }

    const token = jwt.sign(
      { id: target.id, login: target.login, role: target.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Вход под пользователем', target.full_name]
    );

    res.json({ token, user: userPublic(target) });
    
  } catch (e) {
    console.error('Impersonate error:', e);
    res.status(500).json({ error: 'Ошибка входа под пользователем' });
  }
});

// ============================================================
// СМЕНА ПАРОЛЯ (свой аккаунт)
// ============================================================
router.post('/change-password', authenticate, async (req, res) => {
  const { newPassword, confirmPassword } = req.body;

  if (!newPassword || !confirmPassword) {
    const missing = [];
    if (!newPassword)     missing.push('Новый пароль');
    if (!confirmPassword) missing.push('Подтверждение пароля');
    return res.status(400).json({
      error: missing.length === 1
        ? `Заполните поле «${missing[0]}»`
        : `Заполните поля: ${missing.map(m => `«${m}»`).join(', ')}`
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Пароли не совпадают' });
  }

  const v = validatePassword(newPassword);
  if (!v.ok) {
    return res.status(400).json({
      error: 'Пароль не соответствует требованиям:\n• ' + v.errors.join('\n• ')
    });
  }
  
  const same = await bcrypt.compare(newPassword, req.user.password);
  if (same) {
    return res.status(400).json({ error: 'Новый пароль должен отличаться от текущего' });
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await db.query(
    `UPDATE users
     SET password = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [hash, req.user.id]
  );

  await db.query(
    'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
    [req.user.id, req.user.full_name, 'Смена пароля', 'Пользователь сменил свой пароль']
  );

  res.json({ message: 'Пароль изменён' });
});


module.exports = router;
