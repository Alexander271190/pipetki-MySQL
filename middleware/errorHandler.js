'use strict';
const { logError } = require('../utils/error-logger');

function errorHandler(err, req, res, next) {
  // Если уже отправили ответ — не дублируем
  if (res.headersSent) return next(err);

  const status = Number(err.status) || 500;
  const message = err.message || 'Internal Server Error';

  // Пишем в БД все ошибки >= 500, и только важные 4xx (403/409)
  const shouldLog = status >= 500 || status === 403 || status === 409;
  if (shouldLog) {
    logError({
      level: status >= 500 ? 'error' : 'warn',
      source: 'http',
      message: `${req.method} ${req.originalUrl || req.url} — ${message}`,
      stack: err.stack || null,
      req,
      statusCode: status,
    }).catch(() => {});
  }

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
