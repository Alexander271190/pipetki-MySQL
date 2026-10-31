const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const roleCache = require('../utils/roles');

const router = express.Router();

// ============================================================
// ПРЕСЕТЫ ПРАВ
// ============================================================
router.get('/presets', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name, permissions FROM permission_presets ORDER BY name');
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      permissions: db.safeParse(r.permissions, [])
    })));
  } catch (e) {
    console.error('GET /users/presets:', e);
    res.status(500).json({ error: 'Ошибка загрузки пресетов' });
  }
});

router.post('/presets', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, permissions } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Укажите название пресета' });
    }
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'Ожидается массив прав' });
    }
    const cleanName = String(name).trim();
    const [ex] = await db.query('SELECT id FROM permission_presets WHERE name = ?', [cleanName]);
    if (ex.length) return res.status(409).json({ error: 'Пресет с таким названием уже существует' });

    const [result] = await db.query(
      'INSERT INTO permission_presets (name, permissions, created_by) VALUES (?, ?, ?)',
      [cleanName, JSON.stringify(permissions), req.user.id]
    );
    res.status(201).json({ id: result.insertId, name: cleanName, permissions });
  } catch (e) {
    console.error('POST /users/presets:', e);
    res.status(500).json({ error: 'Ошибка сохранения пресета' });
  }
});

router.delete('/presets/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM permission_presets WHERE id = ?', [req.params.id]);
    res.json({ message: 'Пресет удалён' });
  } catch (e) {
    console.error('DELETE /users/presets:', e);
    res.status(500).json({ error: 'Ошибка удаления пресета' });
  }
});

// ============================================================
// СПИСОК ОТВЕТСТВЕННЫХ
// ============================================================
router.get('/responsibles', authenticate, async (req, res, next) => {
  const allowed =
    req.user._isAdmin ||
    req.user.role === 'senior_lab' ||
    (req.user._perms || []).some(p =>
      p === 'transfer_pipette' ||
      p === 'manage_pipettes' ||
      p === 'bulk_change_responsible'
    );
  if (!allowed) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }

  try {
    const [users] = await db.query(
      'SELECT id, full_name, login, department FROM users ORDER BY full_name'
    );
    res.json(users.map(u => ({
      id: u.id,
      fullName: u.full_name,
      login: u.login,
      department: u.department
    })));
  } catch (e) {
    console.error('GET /users/responsibles:', e);
    res.status(500).json({ error: 'Ошибка загрузки списка ответственных' });
  }
});

// ============================================================
// Генератор разового пароля
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
// СПИСОК ОСНОВНЫХ СОТРУДНИКОВ
// ============================================================
router.get('/acting-targets', authenticate, requireAdmin, async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT id, full_name, department, position
       FROM users
       WHERE (is_acting = 0 OR is_acting IS NULL)
       ORDER BY full_name`
    );
    res.json(users.map(u => ({
      id: u.id,
      fullName: u.full_name,
      department: u.department,
      position: u.position
    })));
  } catch (e) {
    console.error('GET /users/acting-targets:', e);
    res.status(500).json({ error: 'Ошибка загрузки списка' });
  }
});

// ============================================================
// СПИСОК ПОЛЬЗОВАТЕЛЕЙ
// ============================================================
router.get('/', authenticate, requireAdmin, async (req, res) => {
  const [users] = await db.query(`
    SELECT u.id, u.login, u.full_name, u.position, u.department, u.role,
           u.only_own_department, u.extra_permissions, u.is_acting, u.acting_for_id,
           u.must_change_password, r.name AS role_name, r.is_admin AS role_is_admin
    FROM users u
    LEFT JOIN roles r ON r.value = u.role
  `);

  const actingIds = users.filter(u => u.acting_for_id).map(u => u.acting_for_id);
  const actingById = {};
  if (actingIds.length > 0) {
    const ph = actingIds.map(() => '?').join(',');
    const [actingRows] = await db.query(
      `SELECT id, full_name, department FROM users WHERE id IN (${ph})`,
      actingIds
    );
    for (const r of actingRows) {
      actingById[r.id] = { fullName: r.full_name, department: r.department };
    }
  }

  res.json(users.map(u => ({
    id:                u.id,
    login:             u.login,
    fullName:          u.full_name,
    position:          u.position,
    department:        u.department,
    role:              u.role,
    roleName:          u.role_name || u.role,
    isAdmin:           !!u.role_is_admin,
    onlyOwnDepartment: !!u.only_own_department,
    isActing:          !!u.is_acting,
    actingForId:       u.acting_for_id || null,
    actingForName:     u.acting_for_id && actingById[u.acting_for_id]
      ? actingById[u.acting_for_id].fullName : null,
    extraPermissions:  db.safeParse(u.extra_permissions, []),
    mustChangePassword: !!u.must_change_password
  })));
});

// ============================================================
// СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ
// ============================================================
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { login, fullName, position, department, role,
            onlyOwnDepartment, extraPermissions, isActing, actingForId } = req.body;

    const roleDef = await roleCache.getRoleDef(role || 'user');
    if (!roleDef) {
      return res.status(400).json({ error: `Неизвестная роль: ${role || 'user'}` });
    }

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

    if (isActing && !actingForId) {
      return res.status(400).json({
        error: 'Для и.о. нужно указать, за кого он исполняет обязанности'
      });
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

    const initialPermissions = roleDef.isAdmin ? [] : (Array.isArray(extraPermissions) ? extraPermissions : []);

    await db.query(
      `INSERT INTO users
       (id, login, password, full_name, position, department, role,
        only_own_department, extra_permissions, is_acting, acting_for_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, login, passwordHash, fullName, position, department || '', role || 'user',
       onlyOwnDepartment ? 1 : 0, JSON.stringify(initialPermissions),
       isActing ? 1 : 0, isActing && actingForId ? actingForId : null]
    );

    await logAction(req, 'Создание пользователя', `Создан ${login} (${fullName}), выдан разовый пароль`);

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
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { login, fullName, position, department, role,
            onlyOwnDepartment, extraPermissions, isActing, actingForId } = req.body;
    const id = req.params.id;

    const roleDef = await roleCache.getRoleDef(role || 'user');
    if (!roleDef) {
      return res.status(400).json({ error: `Неизвестная роль: ${role || 'user'}` });
    }

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

    if (isActing && !actingForId) {
      return res.status(400).json({
        error: 'Для и.о. нужно указать, за кого он исполняет обязанности'
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

    const oldRoleDef = await roleCache.getRoleDef(ex[0].role);
    if (oldRoleDef?.isAdmin && !roleDef.isAdmin) {
      const [admins] = await db.query(`
        SELECT COUNT(*) AS c FROM users u
        JOIN roles r ON r.value = u.role
        WHERE r.is_admin = 1
      `);
      if (admins[0].c <= 1) {
        return res.status(400).json({ error: 'Нельзя понизить последнего администратора' });
      }
      if (id === req.user.id) {
        return res.status(400).json({ error: 'Нельзя понизить собственную роль администратора' });
      }
    }

    const [dup] = await db.query(
      'SELECT id FROM users WHERE login = ? AND id <> ?',
      [login, id]
    );
    if (dup.length) return res.status(409).json({ error: 'Логин уже занят' });

    const onlyOwn = onlyOwnDepartment ? 1 : 0;

    const [oldRows] = await db.query(
      `SELECT login, full_name, position, department, role,
              only_own_department, extra_permissions, is_acting, acting_for_id
       FROM users WHERE id = ?`,
      [id]
    );
    const old = oldRows[0];

    await db.query(
      `UPDATE users SET login=?, full_name=?, position=?, department=?, role=?,
         only_own_department=?, extra_permissions=?,
         is_acting=?, acting_for_id=?,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [login, fullName, position, department || '', role || 'user',
       onlyOwn, JSON.stringify(extraPermissions || []),
       isActing ? 1 : 0, isActing && actingForId ? actingForId : null, id]
    );

    const changes = [];

    if (old.login !== login) {
      changes.push(`логин: «${old.login}» → «${login}»`);
    }
    if (old.full_name !== fullName) {
      changes.push(`ФИО: «${old.full_name}» → «${fullName}»`);
    }
    if (old.position !== position) {
      changes.push(`должность: «${old.position}» → «${position}»`);
    }
    if ((old.department || '') !== (department || '')) {
      changes.push(`отдел: «${old.department || '—'}» → «${department || '—'}»`);
    }
    if (old.role !== (role || 'user')) {
      changes.push(`роль: ${old.role} → ${role || 'user'}`);
    }
    if (!!old.only_own_department !== !!onlyOwnDepartment) {
      changes.push(`только свой отдел: ${old.only_own_department ? 'вкл' : 'выкл'} → ${onlyOwnDepartment ? 'вкл' : 'выкл'}`);
    }
    if (!!old.is_acting !== !!isActing) {
      changes.push(`и.о.: ${old.is_acting ? 'вкл' : 'выкл'} → ${isActing ? 'вкл' : 'выкл'}`);
    }

    const oldPerms = db.safeParse(old.extra_permissions, []).sort();
    const newPerms = (extraPermissions || []).slice().sort();
    const permsChanged =
      oldPerms.length !== newPerms.length ||
      oldPerms.some((p, i) => p !== newPerms[i]);

    if (permsChanged) {
      const added = newPerms.filter(p => !oldPerms.includes(p));
      const removed = oldPerms.filter(p => !newPerms.includes(p));
      const parts = [];
      if (added.length)   parts.push(`+${added.join(', ')}`);
      if (removed.length) parts.push(`-${removed.join(', ')}`);
      changes.push(`права: ${parts.join(' ')}`);
    }

    const isSelf = (id === req.user.id);
    const action = isSelf ? 'Редактирование своего профиля' : 'Редактирование пользователя';
    const details = changes.length
      ? `${login} (${fullName}): ${changes.join('; ')}`
      : `${login} (${fullName}): без значимых изменений`;

    await logAction(req, action, details);

    res.json({ message: 'Пользователь обновлён' });
  } catch (e) {
    console.error('PUT /users error:', e);
    res.status(500).json({ error: 'Ошибка обновления пользователя' });
  }
});

// ============================================================
// УДАЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
// ============================================================
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        error: 'Нельзя удалить собственную учётную запись'
      });
    }

    const [users] = await db.query('SELECT role FROM users WHERE id = ?', [req.params.id]);
    if (!users.length) return res.status(404).json({ error: 'Не найден' });

    const targetRoleDef = await roleCache.getRoleDef(users[0].role);
    if (targetRoleDef?.isAdmin) {
      const [admins] = await db.query(`
        SELECT COUNT(*) AS c FROM users u
        JOIN roles r ON r.value = u.role
        WHERE r.is_admin = 1
      `);
      if (admins[0].c <= 1) {
        return res.status(400).json({ error: 'Нельзя удалить последнего админа' });
      }
    }

    await db.query(
      `UPDATE users SET is_acting = 0, acting_for_id = NULL,
       updated_at = CURRENT_TIMESTAMP
       WHERE acting_for_id = ?`,
      [req.params.id]
    );

    const [targetRows] = await db.query(
      `SELECT login, full_name, position, department, role,
              only_own_department, extra_permissions, is_acting
       FROM users WHERE id = ?`,
      [req.params.id]
    );
    const target = targetRows[0];

    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);

    const details = [
      `${target.login} (${target.full_name})`,
      `должность: ${target.position || '—'}`,
      `отдел: ${target.department || '—'}`,
      `роль: ${target.role}`,
    ].join(', ');

    await logAction(req, 'Удаление пользователя', details);

    res.json({ message: 'Пользователь удалён' });
  } catch (e) {
    console.error('DELETE /users error:', e);
    res.status(500).json({ error: 'Ошибка удаления пользователя' });
  }
});

// ============================================================
// СБРОС ПАРОЛЯ (админом)
// ============================================================
router.post('/:id/reset-password', authenticate, requireAdmin, async (req, res) => {
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
           password_changed_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [hash, new Date(), userId]
    );

    await logAction(req, 'Сброс пароля', `Выдан разовый пароль для ${user.login} (${user.full_name})`);

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
