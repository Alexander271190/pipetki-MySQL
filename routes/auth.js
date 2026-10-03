const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { validatePassword } = require('../middleware/passwordPolicy');
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_key';

// Помечает роут как доступный, даже если требуется смена пароля
const allowWhenPasswordMustChange = (req, res, next) => {
  req.allowWhenPasswordMustChange = true;
  next();
};

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
    isActing: !!u.is_acting,
    actingForId: u.acting_for_id || null,
    actingForName: u.acting_full_name || null,
    actingDepartment: u.acting_department || null,
    extraPermissions: db.safeParse(u.extra_permissions, []),
    mustChangePassword: !!u.must_change_password,
    passwordChangedAt: u.password_changed_at || null
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

    // 🛡️ Если и.о. — подтягиваем данные основного
    if (u.is_acting && u.acting_for_id) {
      const [actingRows] = await db.query(
        'SELECT full_name, department FROM users WHERE id = ? LIMIT 1',
        [u.acting_for_id]
      );
      if (actingRows.length) {
        u.acting_full_name  = actingRows[0].full_name  || null;
        u.acting_department = actingRows[0].department || null;
      }
    }

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
router.get('/verify', allowWhenPasswordMustChange, authenticate, (req, res) => {
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

    // 🆕 Кто зашёл под target — сохраняем в токене
    const token = jwt.sign(
      {
        id: target.id,
        login: target.login,
        role: target.role,
        impersonatedBy: req.user.id,          // 🆕 id админа
        impersonatedByName: req.user.full_name // 🆕 имя админа
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Вход под пользователем', target.full_name]
    );

        if (target.is_acting && target.acting_for_id) {
      const [actingRows] = await db.query(
        'SELECT full_name, department FROM users WHERE id = ? LIMIT 1',
        [target.acting_for_id]
      );
      if (actingRows.length) {
        target.acting_full_name  = actingRows[0].full_name  || null;
        target.acting_department = actingRows[0].department || null;
      }
    }

    res.json({ token, user: userPublic(target) });
    
  } catch (e) {
    console.error('Impersonate error:', e);
    res.status(500).json({ error: 'Ошибка входа под пользователем' });
  }
});

// ============================================================
// ВОЗВРАТ К СВОЕЙ УЧЁТНОЙ ЗАПИСИ (конец impersonate-сессии)
// ============================================================
router.post('/stop-impersonate', authenticate, async (req, res) => {
  try {
    // Достаём id админа из JWT (установлен в middleware/auth.js)
    const adminId = req.impersonatedBy;
    if (!adminId) {
      return res.status(400).json({
        error: 'Вы не в режиме переключения'
      });
    }

    // Загружаем данные админа (для имени в логе)
    const [adminRows] = await db.query(
      'SELECT id, full_name, login FROM users WHERE id = ?',
      [adminId]
    );

    if (!adminRows.length) {
      // Админ был удалён — логируем хотя бы факт возврата
      await db.query(
        'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
        [
          adminId,
          req.impersonatedByName || 'admin (удалён)',
          'Возврат к своей учётной записи',
          `Работал под: ${req.user.full_name} (${req.user.login}); сам админ удалён`
        ]
      );
      return res.json({ message: 'Возврат залогирован (админ удалён)' });
    }

    const admin = adminRows[0];

    // 🆕 Логируем возврат от имени админа
    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [
        admin.id,
        admin.full_name,
        'Возврат к своей учётной записи',
        `Работал под: ${req.user.full_name} (${req.user.login})`
      ]
    );

    res.json({ message: 'Возврат залогирован' });
  } catch (e) {
    console.error('POST /auth/stop-impersonate error:', e);
    res.status(500).json({ error: 'Ошибка логирования возврата' });
  }
});


// ============================================================
// СМЕНА ПАРОЛЯ (свой аккаунт)
// ============================================================
router.post('/change-password', allowWhenPasswordMustChange, authenticate, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  const missing = [];
  if (!currentPassword) missing.push('Текущий пароль');
  if (!newPassword)     missing.push('Новый пароль');
  if (!confirmPassword) missing.push('Подтверждение пароля');

  if (missing.length > 0) {
    return res.status(400).json({
      error: missing.length === 1
        ? `Заполните поле «${missing[0]}»`
        : `Заполните поля: ${missing.map(m => `«${m}»`).join(', ')}`
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Пароли не совпадают' });
  }

  const oldOk = await bcrypt.compare(currentPassword, req.user.password);
  if (!oldOk) {
    return res.status(400).json({ error: 'Текущий пароль неверен' });
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
     SET password = ?,
         must_change_password = 0,
         password_changed_at = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [hash, new Date(), req.user.id]
  );

    await db.query(
    'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
    [req.user.id, req.user.full_name, 'Смена пароля', 'Пользователь сменил свой пароль']
  );

  // Перевыпускаем токен: password_changed_at стал новее старого iat,
  // иначе следующий же запрос словит 401 в middleware/auth.js
  const freshToken = jwt.sign(
    { id: req.user.id, login: req.user.login, role: req.user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ message: 'Пароль изменён', token: freshToken });
});


module.exports = router;
