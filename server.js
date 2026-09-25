const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Раздача статики
app.use(express.static(path.join(__dirname, 'frontend')));

const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function wrapRouter(router) {
  const methods = ['get', 'post', 'put', 'delete', 'patch'];
  for (const m of methods) {
    const orig = router[m].bind(router);
    router[m] = (path, ...handlers) => {
      const wrapped = handlers.map(h =>
        typeof h === 'function' && h.constructor.name === 'AsyncFunction'
          ? asyncHandler(h)
          : h
      );
      return orig(path, ...wrapped);
    };
  }
  return router;
}

// API
app.use('/api/auth',     wrapRouter(require('./routes/auth')));
app.use('/api/pipettes', wrapRouter(require('./routes/pipettes')));
app.use('/api/users',    wrapRouter(require('./routes/users')));
app.use('/api/settings', wrapRouter(require('./routes/settings')));
app.use('/api/log',      wrapRouter(require('./routes/log')));
app.use('/api/import',   wrapRouter(require('./routes/import')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// SPA-fallback — всё остальное отдаём как index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ============================================================
// Старт: ждём БД, инициализируем схему
// ============================================================
const db = require('./db');

(async () => {
  let retries = 30;
  while (retries > 0) {
    try {
      const conn = await db.pool.getConnection();
      await conn.query('SELECT 1');
      conn.release();
      console.log('✅ MySQL подключён');
      break;
    } catch (e) {
      retries--;
      console.log(`⏳ Ожидание MySQL... (${retries} попыток осталось)`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (retries === 0) {
    console.error('❌ Не удалось подключиться к MySQL');
    process.exit(1);
  }

    try {
    const seeded = await db.initSchema();
    console.log('✅ Схема БД готова');
    if (seeded) {
      console.log('👤 Начальные пользователи и данные созданы');
    }
  } catch (e) {
    console.error('❌ Ошибка инициализации схемы:', e);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server on http://0.0.0.0:${PORT}`);
  });
})();
