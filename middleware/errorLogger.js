'use strict';
const { logError } = require('../utils/error-logger');

function errorLogger(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    try {
      const status = res.statusCode;

    
      const shouldLog = status >= 500 || status === 409 || status === 403;

      if (shouldLog) {
        let msg = (body && body.error) ? body.error : ('HTTP ' + status);
        let friendly = '';
        if (req.originalUrl.includes('/pipettes') && req.method === 'POST') {
          friendly = `Создание прибора: ${msg}`;
        } else if (req.originalUrl.includes('/pipettes') && req.method === 'PUT') {
          friendly = `Редактирование прибора: ${msg}`;
        } else if (req.originalUrl.includes('/lock')) {
          friendly = `Блокировка: ${msg}`;
        } else {
          friendly = `${req.method} ${req.originalUrl || req.url} — ${msg}`;
        }
        logError({
          level: status >= 500 ? 'error' : 'warn',
          source: 'http',
          message: friendly,
          stack: null,
          req,
          statusCode: status,
        }).catch(() => {});
      }   
    } catch (e) {
      
    }

    return originalJson(body);
  };

  next();
}

module.exports = { errorLogger };
