'use strict';
const { logError } = require('../utils/error-logger');

function errorLogger(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    try {
      const status = res.statusCode;

      // Логируем только серьёзные: 500, 409, 403
      // 404 (не найдено) и 400 (валидация) — не пишем, чтобы не засорять
      const shouldLog = status >= 500 || status === 409 || status === 403;

      if (shouldLog) {
        const msg = (body && body.error) ? body.error : ('HTTP ' + status);
        logError({
          level: status >= 500 ? 'error' : 'warn',
          source: 'http',
          message: `${req.method} ${req.originalUrl || req.url} — ${msg}`,
          stack: null,
          req,
          statusCode: status,
        }).catch(() => {});
      }
    } catch (e) {
      // Не роняем ответ, если что-то пошло не так
    }

    return originalJson(body);
  };

  next();
}

module.exports = { errorLogger };
