const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_key';

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
      // Пароль был изменён после выдачи токена → старый токен недействителен.
    // 🆕 Пропускаем проверку, если пользователь ещё не сменил/не установил пароль —
    // в этом случае он всё равно будет заблокирован блоками must_set_password /
    // must_change_password ниже.
    if (user.password_changed_at
        && !user.must_set_password
        && !user.must_change_password) {
      const pwdTs = new Date(user.password_changed_at).getTime() / 1000;
      const iat = decoded.iat || 0;
      if (pwdTs > iat + 2) {
        return res.status(401).json({ error: 'Пароль был изменён, войдите заново' });
      }
    }
  // 🆕 Админ ещё не установил пароль → блокируем всё, кроме спец-роутов
    if (user.must_set_password && !req.allowWhenPasswordMustChange) {
      return res.status(403).json({
        error: 'Требуется установка пароля администратора',
        code: 'password_setup_required',
      });
    }

  // Обязательная смена пароля: блокируем всё, кроме помеченных роутов
    if (user.must_change_password && !req.allowWhenPasswordMustChange) {
      return res.status(403).json({
        error: 'Требуется смена пароля',
        code: 'password_change_required',
      });
    }

        // 🛡️ Если и.о. — подтягиваем данные основного
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
    req.impersonatedBy     = decoded.impersonatedBy     || null;
    req.impersonatedByName = decoded.impersonatedByName || null;
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

const requireAnyPermission = (perms) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (req.user.role === 'admin') return next();
  const userPerms = db.safeParse(req.user.extra_permissions, []);
  if (perms.some(p => userPerms.includes(p))) return next();
  return res.status(403).json({ error: 'Недостаточно прав' });
};

module.exports = { authenticate, requireRole, requirePermission, requireAnyPermission };
