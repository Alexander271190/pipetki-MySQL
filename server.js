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
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
  }
  next(err);
});
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
app.use('/api/export',   wrapRouter(require('./routes/export')));
app.use('/api/barcodes',         wrapRouter(require('./routes/barcodes')));
app.use('/api/barcode-printers', wrapRouter(require('./routes/barcode-printers')));
app.use('/api/help',             wrapRouter(require('./routes/help')));
app.use('/api/view-templates', wrapRouter(require('./routes/view-templates')));
app.use('/api/equipment-templates', wrapRouter(require('./routes/equipment-templates')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// SPA-fallback — всё остальное отдаём как index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

const { errorHandler } = require('./middleware/errorHandler');
app.use(errorHandler);

// ============================================================
// Старт: ждём БД, инициализируем схему
// ============================================================
const db = require('./db');

async function waitForDatabase(maxAttempts = 90) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    let conn;
    try {
      conn = await db.pool.getConnection();
      await conn.query('SELECT 1');
      console.log('✅ MySQL подключён');
      return true;
    } catch (e) {
      const left = maxAttempts - attempt;
      console.log(`⏳ Ожидание MySQL... (${left} попыток осталось)`);
      await new Promise(r => setTimeout(r, 2000));
    } finally {
      if (conn) conn.release();
    }
  }
  return false;
}

(async () => {
  // 90 попыток × 2 сек = 3 минуты на старт
  const connected = await waitForDatabase(90);

  if (!connected) {
    console.error('❌ MySQL не ответил за 3 минуты. Приложение продолжит работу, когда БД поднимется.');
  }

  if (connected) {
    try {
      await db.initSchema();
      console.log('✅ Схема БД готова');
      try {
        const seeded = await db.seedInitialData();
        if (seeded) {
          console.log('👤 Начальные пользователи и данные созданы');
        }
      } catch (seedErr) {
        console.error('⚠️ Ошибка seed (схема создана):', seedErr.message);
      }
    } catch (e) {
      console.error('❌ Ошибка инициализации схемы:', e);
    }
  }

  // 🆕 Захватываем сервер, чтобы можно было закрыть его graceful
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server on http://0.0.0.0:${PORT}`);
  });

  // 🧹 Очистка audit_log (из коробки)
  try {
    const { startCleanupScheduler } = require('./utils/cleanup');
    startCleanupScheduler();
  } catch (e) {
    console.error('⚠️ Cleanup scheduler не запущен:', e.message);
  }

  // Если БД не поднялась при старте — пытаемся догнать её фоном
  let reconnectInterval = null;
  if (!connected) {
    reconnectInterval = setInterval(async () => {
      let conn;
      try {
        conn = await db.pool.getConnection();
        await conn.query('SELECT 1');
        console.log('✅ MySQL подключён (отложенное подключение)');

        try {
          await db.initSchema();
          console.log('✅ Схема БД готова');
          try {
            const seeded = await db.seedInitialData();
            if (seeded) {
              console.log('👤 Начальные пользователи и данные созданы');
            }
          } catch (seedErr) {
            console.error('⚠️ Ошибка seed (схема создана):', seedErr.message);
          }
        } catch (e) {
          console.error('❌ Ошибка инициализации схемы:', e);
        }

        clearInterval(reconnectInterval);
        reconnectInterval = null;
      } catch (e) {
        // тихо ждём следующей попытки
      } finally {
        if (conn) conn.release();
      }
    }, 5000);
  }

  // ═══════════════════════════════════════════════════════════
  // 🆕 Graceful shutdown (SIGTERM / SIGINT)
  // ═══════════════════════════════════════════════════════════
  let _shuttingDown = false;

  async function gracefulShutdown(signal) {
    if (_shuttingDown) {
      console.log(`⚠️ ${signal} получен повторно, уже останавливаемся...`);
      return;
    }
    _shuttingDown = true;

    console.log(`\n⚠️ ${signal} получен. Начинаем graceful shutdown...`);

    // Останавливаем переподключение к БД, если запущено
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }

    // 1) Перестаём принимать новые соединения
    const serverClosePromise = new Promise((resolve) => {
      server.close((err) => {
        if (err) {
          console.error('❌ Ошибка закрытия HTTP-сервера:', err.message);
        } else {
          console.log('✅ HTTP-сервер остановлен');
        }
        resolve();
      });
    });

    // 2) Ждём не более 10 секунд
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        console.warn('⚠️ Таймаут 10с, принудительное закрытие');
        resolve();
      }, 10000).unref();
    });

    await Promise.race([serverClosePromise, timeoutPromise]);

    // 3) Закрываем пул БД
    try {
      await db.pool.end();
      console.log('✅ Пул БД закрыт');
    } catch (e) {
      console.error('❌ Ошибка закрытия пула БД:', e.message);
    }

    console.log('👋 Завершение работы');
    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

  // 🆕 Ловим необработанные ошибки — чтобы не падать молча
  process.on('uncaughtException', (err) => {
    console.error('💥 uncaughtException:', err);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('💥 unhandledRejection:', reason);
  });
})();
