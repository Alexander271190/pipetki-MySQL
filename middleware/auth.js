const jwt = require('jsonwebtoken');
const db = require('../db');
const roleCache = require('../utils/roles');
const { USER_COLUMNS } = require('../routes/pipettes/_helpers');

const JWT_SECRET = process.env.JWT_SECRET;

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
    const [rows] = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [decoded.id]);
    if (!rows.length) return res.status(401).json({ error: 'Пользователь не найден' });

    const user = rows[0];

    // Пароль изменён после выдачи токена
    if (user.password_changed_at && !user.must_set_password && !user.must_change_password) {
      const pwdTs = new Date(user.password_changed_at).getTime() / 1000;
      const iat = decoded.iat || 0;
      if (pwdTs > iat + 2) {
        return res.status(401).json({ error: 'Пароль был изменён, войдите заново' });
      }
    }

    // Блокировки по паролю
    if (user.must_set_password && !req.allowWhenPasswordMustChange) {
      return res.status(403).json({
        error: 'Требуется установка пароля администратора',
        code: 'password_setup_required',
      });
    }

    if (user.must_change_password && !req.allowWhenPasswordMustChange) {
      return res.status(403).json({
        error: 'Требуется смена пароля',
        code: 'password_change_required',
      });
    }

    // Подтягиваем данные для и.о.
    if (user.is_acting && user.acting_for_id) {
      const [actingRows] = await db.query(
        'SELECT id, full_name, department FROM users WHERE id = ? LIMIT 1',
        [user.acting_for_id]
      );
      if (actingRows.length) {
        user.acting_full_name  = actingRows[0].full_name  || null;
        user.acting_department = actingRows[0].department || null;
      } else {
        user.acting_full_name  = null;
        user.acting_department = null;
      }
    }

    // Получаем права из роли
    try {
      user._roleDef = await roleCache.getRoleDef(user.role);
    } catch (e) {
      console.warn('roleCache недоступен, fallback:', e.message);
      user._roleDef = null;
    }

    user._isAdmin = user._roleDef
      ? !!user._roleDef.isAdmin
      : user.role === 'admin'; // fallback

    user._perms = user._isAdmin
      ? ['*']
      : [
          ...(user._roleDef?.permissions || []),
          ...db.safeParse(user.extra_permissions, []),
        ];

    req.impersonatedBy     = decoded.impersonatedBy     || null;
    req.impersonatedByName = decoded.impersonatedByName || null;
    req.user = user;
    next();
  } catch (e) {
    console.error('Auth error:', e);
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
  if (req.user._isAdmin) return next();
  const perms = req.user._perms || [];
  if (!perms.includes(perm)) return res.status(403).json({ error: 'Недостаточно прав' });
  next();
};

const requireAnyPermission = (perms) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (req.user._isAdmin) return next();
  const userPerms = req.user._perms || [];
  if (perms.some(p => userPerms.includes(p))) return next();
  return res.status(403).json({ error: 'Недостаточно прав' });
};

const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (!req.user._isAdmin) return res.status(403).json({ error: 'Недостаточно прав' });
  next();
};

module.exports = { authenticate, requireRole, requirePermission, requireAnyPermission, requireAdmin };
