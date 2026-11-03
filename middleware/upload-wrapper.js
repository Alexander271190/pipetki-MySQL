'use strict';
const multer = require('multer');

/**
 * Обёртка над multer.single(fieldName), которая:
 * - конвертирует MulterError (LIMIT_FILE_SIZE, LIMIT_UNEXPECTED_FILE)
 *   в аккуратные 400 с понятным текстом;
 * - пропускает err.status из fileFilter;
 * - всё остальное отдаёт как 500.
 */
function wrapSingleUpload(uploadInstance, fieldName) {
  return function uploadSingle(req, res, next) {
    uploadInstance.single(fieldName)(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Файл больше допустимого размера' });
      }
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: 'Ошибка загрузки: ' + err.message });
      }
      const status = Number(err.status) || 500;
      return res.status(status).json({ error: err.message || 'Ошибка загрузки файла' });
    });
  };
}

module.exports = { wrapSingleUpload };
