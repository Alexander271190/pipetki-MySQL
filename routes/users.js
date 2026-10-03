const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// ============================================================
// СПИСОК ОТВЕТСТВЕННЫХ (для поля «Ответственный»)
// Доступно всем авторизованным пользователям
// ============================================================
router.get('/responsibles', authenticate, async (req, res, next) => {
  // 🆕 Доступ: админ, ст. лаборант, или владелец права transfer_pipette / manage_pipettes
  const allowed =
    req.user.role === 'admin' ||
    req.user.role === 'senior_lab' ||
    (db.safeParse(req.user.extra_permissions, []) || []).some(p =>
      p === 'transfer_pipette' || p === 'manage_pipettes'
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
// СПИСОК ОСНОВНЫХ СОТРУДНИКОВ (для селекта «за кого»)
// ============================================================
router.get('/acting-targets', authenticate, requireRole(['admin']), async (req, res) => {
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
router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  const [users] = await db.query(
    `SELECT id, login, full_name, position, department, role,
            only_own_department, extra_permissions, is_acting, acting_for_id,
            must_change_password
     FROM users`);

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
router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { login, fullName, position, department, role,
            onlyOwnDepartment, extraPermissions, isActing, actingForId } = req.body;
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

    // 🆕 По умолчанию права пустые — админ сам выдаёт
    const initialPermissions = role === 'admin' ? [] : (Array.isArray(extraPermissions) ? extraPermissions : []);

    await db.query(
      `INSERT INTO users
       (id, login, password, full_name, position, department, role,
        only_own_department, extra_permissions, is_acting, acting_for_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, login, passwordHash, fullName, position, department || '', role || 'user',
       onlyOwnDepartment ? 1 : 0, JSON.stringify(initialPermissions),
       isActing ? 1 : 0, isActing && actingForId ? actingForId : null]
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
            onlyOwnDepartment, extraPermissions, isActing, actingForId } = req.body;
    const id = req.params.id;

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

    // 🆕 Проверка и.о. — вставлено СЮДА
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

    // 🆕 Загружаем СТАРОЕ состояние для diff-логирования
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

    // 🆕 Собираем diff — что изменилось
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

    // Сравнение extra_permissions (нормализуем через safeParse)
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

    // 🆕 Пишем в audit_log
    const isSelf = (id === req.user.id);
    const action = isSelf ? 'Редактирование своего профиля' : 'Редактирование пользователя';
    const details = changes.length
      ? `${login} (${fullName}): ${changes.join('; ')}`
      : `${login} (${fullName}): без значимых изменений`;

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, action, details]
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
        // 🆕 Сбрасываем ссылки у и.о.
    await db.query(
      `UPDATE users SET is_acting = 0, acting_for_id = NULL,
       updated_at = CURRENT_TIMESTAMP
       WHERE acting_for_id = ?`,
      [req.params.id]
    );

    // 🆕 Загружаем данные удаляемого для audit_log
    const [targetRows] = await db.query(
      `SELECT login, full_name, position, department, role,
              only_own_department, extra_permissions, is_acting
       FROM users WHERE id = ?`,
      [req.params.id]
    );
    const target = targetRows[0];

    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);

    // 🆕 Пишем в audit_log с полной информацией о том, кого удалили
    const details = [
      `${target.login} (${target.full_name})`,
      `должность: ${target.position || '—'}`,
      `отдел: ${target.department || '—'}`,
      `роль: ${target.role}`,
    ].join(', ');

    await db.query(
      'INSERT INTO audit_log (user_id, user_full_name, action, details) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.full_name, 'Удаление пользователя', details]
    );

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
           password_changed_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [hash, new Date(), userId]
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
