// ============================================================
// ПОЛИТИКА ПАРОЛЯ
// ============================================================
const MIN_LENGTH = 8;

function validatePassword(password) {
  const errors = [];

  if (!password || typeof password !== 'string') {
    return { ok: false, errors: ['Пароль не задан'] };
  }
  if (password.length < MIN_LENGTH)   errors.push(`Минимум ${MIN_LENGTH} символов`);
  if (!/[a-z]/.test(password))        errors.push('Хотя бы одна строчная буква (a-z)');
  if (!/[A-Z]/.test(password))        errors.push('Хотя бы одна заглавная буква (A-Z)');
  if (!/[0-9]/.test(password))        errors.push('Хотя бы одна цифра (0-9)');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Хотя бы один спецсимвол (!@#$%^&* и т.п.)');
  if (/\s/.test(password))            errors.push('Пробелы в пароле недопустимы');
  
  return { ok: errors.length === 0, errors };
}

module.exports = { validatePassword, MIN_LENGTH };
