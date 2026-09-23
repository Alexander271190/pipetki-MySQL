const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_key';

const PUBLIC_WHEN_FORCED = new Set([
  'POST /api/auth/change-password',
  'GET /api/auth/verify',
]);

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!rows.length) return res.status(401).json({ error: 'Пользователь не найден' });

    const user = rows[0];

    // Пароль был изменён после выдачи токена → старый токен недействителен
    if (user.password_changed_at && decoded.iat) {
      const pwdTs = new Date(user.password_changed_at).getTime() / 1000;
      if (pwdTs > decoded.iat) {
        return res.status(401).json({ error: 'Пароль был изменён, войдите заново' });
      }
    }

    // Обязательная смена пароля: блокируем всё, кроме смены/verify
    if (user.must_change_password) {
      const routeKey = `${req.method} ${req.baseUrl}${req.path}`;
      if (!PUBLIC_WHEN_FORCED.has(routeKey)) {
        return res.status(403).json({
          error: 'Требуется смена пароля',
          code: 'password_change_required',
        });
      }
    }

    req.user = user;
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка аутентификации' });
  }
};

const requireRole = (roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
  next();
};

const requirePermission = (perm) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (req.user.role === 'admin') return next();   // админ всегда может всё
  const perms = db.safeParse(req.user.extra_permissions, []);
  if (!perms.includes(perm)) return res.status(403).json({ error: 'Недостаточно прав' });
  next();
};

module.exports = { authenticate, requireRole, requirePermission };
