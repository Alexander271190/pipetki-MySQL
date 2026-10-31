'use strict';
const db = require('../db');

let _cache = null;
let _cacheTime = 0;
const TTL = 60_000;

function slugify(text) {
  const ru = { 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya' };
  let s = String(text || '').toLowerCase().split('')
    .map(ch => ru[ch] !== undefined ? ru[ch] : ch).join('');
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return s || 'role';
}

async function getRoles({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && now - _cacheTime < TTL) return _cache;

  const [rows] = await db.query(
    'SELECT id, name, value, permissions, is_system, is_admin FROM roles ORDER BY is_system DESC, name'
  );
  _cache = rows.map(r => ({
    id: r.id,
    name: r.name,
    value: r.value,
    permissions: db.safeParse(r.permissions, []),
    isAdmin: !!r.is_admin,
    isSystem: !!r.is_system,
  }));
  _cacheTime = now;
  return _cache;
}

async function getRoleDef(value) {
  if (!value) return null;
  const all = await getRoles();
  return all.find(r => r.value === value) || null;
}

async function generateUniqueValue(name) {
  const base = slugify(name);
  const [rows] = await db.query("SELECT value FROM roles WHERE value LIKE ?", [`${base}%`]);
  const taken = new Set(rows.map(r => r.value));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

function invalidate() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = { getRoles, getRoleDef, generateUniqueValue, invalidate, slugify };
