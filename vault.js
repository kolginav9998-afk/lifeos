// Хранилище ключа. Схема «конверт»:
//   случайный ключ данных (DEK) шифрует записи; DEK зашифрован ключом из пароля (KEK, PBKDF2)
//   и, по желанию, ещё и ключом из кода восстановления.
// Смена пароля = перешифровать только DEK (одна маленькая запись), данные не трогаем.
// Ключ данных живёт только в памяти (неизвлекаемый CryptoKey) и пропадает при блокировке.
// Та же «мета» хранится и на сервере (если подключён аккаунт), поэтому на другом устройстве
// тот же пароль даёт тот же ключ данных.

import { PBKDF2_ITER, randomBytes, deriveKey, deriveBits, importAesKey, encryptBytes, decryptBytes,
  textToBytes, bytesToText, b64, unb64, MIN_ITER, MAX_ITER } from './cryptoutil.js';

export class LockedError extends Error { constructor() { super('Приложение заблокировано'); this.name = 'LockedError'; } }
export class WrongPasswordError extends Error { constructor() { super('Неверный пароль'); this.name = 'WrongPasswordError'; } }
export class WrongRecoveryCodeError extends Error { constructor() { super('Неверный код восстановления'); this.name = 'WrongRecoveryCodeError'; } }
export class TooManyAttemptsError extends Error { constructor(ms) { super('Слишком много попыток'); this.name = 'TooManyAttemptsError'; this.waitMs = ms; } }

export const MIN_PASSWORD = 8;
export const REC_ITER = 200000;
const META = 'lifeos.vault.v1';
const FAILS = 'lifeos.vault.fails';
const AAD_DEK = textToBytes('lifeos-dek-v1');
const AAD_REC = textToBytes('lifeos-rec-v1');

let storage = globalThis.localStorage;
export function useStorage(s) { storage = s; dek = null; }   // для тестов
let dek = null;

const readJson = k => { try { return JSON.parse(storage.getItem(k) || 'null'); } catch { return null; } };

export function hasVault() { try { return !!storage.getItem(META); } catch { return false; } }
export const isUnlocked = () => dek !== null;
export function status() { return !hasVault() ? 'none' : dek ? 'unlocked' : 'locked'; }

const COMMON = ['password', 'password1', 'qwertyui', 'qwerty123', 'qwertyuiop', '12345678', '123456789', '1234567890', '11111111', '00000000', 'iloveyou', 'admin123',
  'letmein1', 'welcome1', 'йцукенгш', 'йцукенгшщзх', '12341234', 'abcd1234', 'qazwsxedc', '1q2w3e4r', 'password123', 'qwerty12', 'lifeos123'];

// Оценка надёжности для подсказки в форме (не заменяет проверку checkPassword).
export function passwordStrength(pw) {
  const p = String(pw ?? '');
  if (!p) return { score: 0, label: '' };
  if (COMMON.includes(p.toLowerCase())) return { score: 0, label: 'очень слабый: так обычно не делают' };
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (p.length >= 16) score++;
  const classes = [/[a-zа-яё]/.test(p), /[A-ZА-ЯЁ]/.test(p), /\d/.test(p), /[^\p{L}\d]/u.test(p)].filter(Boolean).length;
  if (classes >= 3) score++;
  if (new Set(p).size < Math.max(4, p.length / 3)) score = Math.max(0, score - 1);   // много повторов
  score = Math.min(4, score);
  return { score, label: ['очень слабый', 'слабый', 'средний', 'хороший', 'отличный'][score] };
}

export function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Пароль должен быть не короче ${MIN_PASSWORD} символов`;
  if (/^(.)\1+$/.test(pw)) return 'Пароль не должен состоять из одного повторяющегося символа';
  if (COMMON.includes(pw.toLowerCase())) return 'Слишком известный пароль: его подберут первым';
  return null;
}

// Задержка после неудачных попыток: первые 4 — без задержки, дальше 1 с, 2 с, 4 с … до 5 минут.
export function lockoutMs(fails) { return fails < 5 ? 0 : Math.min(1000 * 2 ** (fails - 5), 300000); }
export function failState(now = Date.now()) {
  const f = readJson(FAILS) || { n: 0, last: 0 };
  return { n: f.n, waitMs: Math.max(0, lockoutMs(f.n) - (now - f.last)) };
}
function recordFail(now = Date.now()) {
  const f = readJson(FAILS) || { n: 0, last: 0 };
  storage.setItem(FAILS, JSON.stringify({ n: f.n + 1, last: now }));
}
const clearFails = () => storage.removeItem(FAILS);

// ---------- мета ----------
export function parseMeta(m) {
  const okWrap = w => w && typeof w.iv === 'string' && typeof w.ct === 'string';
  if (!m || typeof m !== 'object' || (m.v !== 1 && m.v !== 2) || !m.salt || !okWrap(m.wrap) || !Number.isInteger(m.iter) || m.iter < MIN_ITER || m.iter > MAX_ITER) throw new Error('Повреждены данные входа');
  if (m.rec !== undefined && (!okWrap(m.rec.wrap) || !m.rec.salt || !Number.isInteger(m.rec.iter) || m.rec.iter < MIN_ITER || m.rec.iter > MAX_ITER)) throw new Error('Повреждены данные входа');
  return m;
}
function readMeta() { return parseMeta(readJson(META)); }
export function getMeta() { return hasVault() ? readMeta() : null; }
const writeMeta = m => storage.setItem(META, JSON.stringify(m));

// Собрать мету: ключ данных `raw`, обёрнутый ключом из пароля (и, если есть, прежним блоком кода восстановления).
export async function makeMeta(password, raw, { iterations = PBKDF2_ITER, rec = null, createdAt = Date.now() } = {}) {
  const salt = randomBytes(16);
  const kek = await deriveKey(password, salt, iterations);
  const wrap = await encryptBytes(kek, raw, AAD_DEK);
  return { v: 2, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64(salt), wrap, ...(rec ? { rec } : {}), createdAt, changedAt: Date.now() };
}

// Расшифровать ключ данных паролем. Неверный пароль -> WrongPasswordError.
export async function unwrapRaw(password, meta = readMeta()) {
  const kek = await deriveKey(password, unb64(meta.salt), meta.iter);
  try { return await decryptBytes(kek, meta.wrap, AAD_DEK); } catch { throw new WrongPasswordError(); }
}

// ---------- код восстановления ----------
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRecoveryCode() {
  const bytes = randomBytes(15);                                 // 120 бит = ровно 24 символа base32
  let acc = 0, bits = 0, out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { out += CROCKFORD[(acc >> (bits - 5)) & 31]; bits -= 5; }
    acc &= (1 << bits) - 1;
  }
  return out.match(/.{4}/g).join('-');
}
export function normalizeRecoveryCode(input) {
  const s = String(input ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{24}$/.test(s)) throw new WrongRecoveryCodeError();
  return s;
}
// Из кода — два независимых значения: ключ, обёртывающий ключ данных, и ключ входа для сервера.
export async function deriveRecovery(code, salt, iterations = REC_ITER) {
  const norm = normalizeRecoveryCode(code);
  const kek = await deriveKey(`lifeos-rec-kek-v1\u0000${norm}`, salt, iterations);
  const authKey = b64(await deriveBits(norm, salt, iterations, 'lifeos-rec-auth-v1'));
  return { kek, authKey };
}
// Создать код восстановления для ключа данных. Возвращает новый код, блок `rec` для меты и данные для сервера.
export async function makeRecovery(raw, iterations = REC_ITER) {
  const code = newRecoveryCode();
  const salt = randomBytes(16);
  const { kek, authKey } = await deriveRecovery(code, salt, iterations);
  const wrap = await encryptBytes(kek, raw, AAD_REC);
  return { code, rec: { iter: iterations, salt: b64(salt), wrap }, server: { authKey, salt: b64(salt), iter: iterations } };
}
export async function unwrapWithCode(code, meta) {
  if (!meta?.rec) throw new WrongRecoveryCodeError();
  const { kek } = await deriveRecovery(code, unb64(meta.rec.salt), meta.rec.iter);
  try { return await decryptBytes(kek, meta.rec.wrap, AAD_REC); } catch { throw new WrongRecoveryCodeError(); }
}

// ---------- жизненный цикл ----------
export async function create(password, { iterations = PBKDF2_ITER } = {}) {
  const weak = checkPassword(password);
  if (weak) throw new Error(weak);
  if (hasVault()) throw new Error('Пароль уже задан');
  const raw = randomBytes(32);
  writeMeta(await makeMeta(password, raw, { iterations }));
  dek = await importAesKey(raw);
}

export async function unlock(password, now = Date.now()) {
  const meta = readMeta();
  const { waitMs } = failState(now);
  if (waitMs > 0) throw new TooManyAttemptsError(waitMs);
  let raw;
  try { raw = await unwrapRaw(password, meta); } catch (e) { if (e instanceof WrongPasswordError) recordFail(now); throw e; }
  dek = await importAesKey(raw);
  clearFails();
}

export const lock = () => { dek = null; };

export async function changePassword(oldPassword, newPassword, { iterations = PBKDF2_ITER } = {}) {
  const weak = checkPassword(newPassword);
  if (weak) throw new Error(weak);
  const meta = readMeta();
  const raw = await unwrapRaw(oldPassword, meta);              // неверный старый пароль -> WrongPasswordError
  writeMeta(await makeMeta(newPassword, raw, { iterations, rec: meta.rec, createdAt: meta.createdAt }));
}

// Подготовить новую мету с другим паролем, ничего не записывая (для смены пароля вместе с сервером).
export async function prepareNewMeta(oldPassword, newPassword, { iterations = PBKDF2_ITER } = {}) {
  const weak = checkPassword(newPassword);
  if (weak) throw new Error(weak);
  const meta = readMeta();
  const raw = await unwrapRaw(oldPassword, meta);
  return makeMeta(newPassword, raw, { iterations, rec: meta.rec, createdAt: meta.createdAt });
}
export function commitMeta(meta) { writeMeta(parseMeta(meta)); }

// Добавить код восстановления в уже существующую защиту. Возвращает код (показать один раз) и данные для сервера.
export async function addRecovery(password) {
  const meta = readMeta();
  const raw = await unwrapRaw(password, meta);
  const r = await makeRecovery(raw);
  const next = { ...meta, v: 2, rec: r.rec, changedAt: Date.now() };
  return { code: r.code, meta: next, server: r.server };           // записать локально нужно через commitMeta, когда сервер принял
}

// Забыл пароль, но есть код: задать новый пароль (локально, без сети).
export async function resetWithCode(code, newPassword, { iterations = PBKDF2_ITER } = {}) {
  const weak = checkPassword(newPassword);
  if (weak) throw new Error(weak);
  const meta = readMeta();
  const raw = await unwrapWithCode(code, meta);
  writeMeta(await makeMeta(newPassword, raw, { iterations, rec: meta.rec, createdAt: meta.createdAt }));
  dek = await importAesKey(raw);
  clearFails();
}

// Принять мету с сервера (вход на новом устройстве): проверяем паролем и запоминаем.
export async function adoptMeta(meta, password) {
  parseMeta(meta);
  const raw = await unwrapRaw(password, meta);
  writeMeta(meta);
  dek = await importAesKey(raw);
  clearFails();
}
// То же, но по коду восстановления: ключ данных получаем кодом, а пароль задаём новый.
export async function adoptMetaWithCode(meta, code, newPassword, { iterations = PBKDF2_ITER } = {}) {
  parseMeta(meta);
  const weak = checkPassword(newPassword);
  if (weak) throw new Error(weak);
  const raw = await unwrapWithCode(code, meta);
  const next = await makeMeta(newPassword, raw, { iterations, rec: meta.rec, createdAt: meta.createdAt });
  return { meta: next, raw };
}
export async function installUnlocked(meta, raw) { writeMeta(parseMeta(meta)); dek = await importAesKey(raw); clearFails(); }

// Проверка пароля без разблокировки (для подтверждения опасных действий).
export async function verify(password) { await unwrapRaw(password, readMeta()); }

export function remove() { storage.removeItem(META); storage.removeItem(FAILS); dek = null; }

// ---------- запись <-> зашифрованная запись ----------
export const isSealed = rec => !!(rec && typeof rec.ct === 'string');

// Снаружи (вне шифртекста) лежат только id и метка времени u — она нужна для слияния при синхронизации.
export async function seal(ev) {
  if (!dek) throw new LockedError();
  const { iv, ct } = await encryptBytes(dek, textToBytes(JSON.stringify(ev)), textToBytes(ev.id));
  return { id: ev.id, v: 1, ...(Number.isFinite(ev.u) ? { u: ev.u } : {}), iv, ct };
}
export async function open(rec) {
  if (!isSealed(rec)) return rec;                            // обычная (ещё не зашифрованная) запись
  if (!dek) throw new LockedError();
  const ev = JSON.parse(bytesToText(await decryptBytes(dek, rec, textToBytes(rec.id))));
  if (ev.id !== rec.id) throw new Error('Запись повреждена или подменена');
  if (Number.isFinite(rec.u)) ev.u = rec.u;
  return ev;
}

// Подходит ли ключ данных `raw` к зашифрованной записи (чтобы не подменить ключ, которым уже зашифрованы локальные данные).
export async function canOpenWith(raw, rec) {
  try {
    const key = await importAesKey(raw);
    await decryptBytes(key, rec, textToBytes(rec.id));
    return true;
  } catch { return false; }
}
