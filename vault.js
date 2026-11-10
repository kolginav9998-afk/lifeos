// Хранилище ключа. Схема «конверт»:
//   случайный ключ данных (DEK) шифрует записи; DEK зашифрован ключом из пароля (KEK, PBKDF2).
// Смена пароля = перешифровать только DEK (одна маленькая запись), данные не трогаем.
// Ключ данных живёт только в памяти (неизвлекаемый CryptoKey) и пропадает при блокировке.

import { PBKDF2_ITER, randomBytes, deriveKey, importAesKey, encryptBytes, decryptBytes,
  textToBytes, bytesToText, b64, unb64, MIN_ITER, MAX_ITER } from './cryptoutil.js';

export class LockedError extends Error { constructor() { super('Приложение заблокировано'); this.name = 'LockedError'; } }
export class WrongPasswordError extends Error { constructor() { super('Неверный пароль'); this.name = 'WrongPasswordError'; } }
export class TooManyAttemptsError extends Error { constructor(ms) { super('Слишком много попыток'); this.name = 'TooManyAttemptsError'; this.waitMs = ms; } }

export const MIN_PASSWORD = 8;
const META = 'lifeos.vault.v1';
const FAILS = 'lifeos.vault.fails';
const AAD_DEK = textToBytes('lifeos-dek-v1');

let storage = globalThis.localStorage;
export function useStorage(s) { storage = s; dek = null; }   // для тестов
let dek = null;

const readJson = k => { try { return JSON.parse(storage.getItem(k) || 'null'); } catch { return null; } };

export function hasVault() { try { return !!storage.getItem(META); } catch { return false; } }
export const isUnlocked = () => dek !== null;
export function status() { return !hasVault() ? 'none' : dek ? 'unlocked' : 'locked'; }

export function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Пароль должен быть не короче ${MIN_PASSWORD} символов`;
  if (/^(.)\1+$/.test(pw)) return 'Пароль не должен состоять из одного повторяющегося символа';
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

function readMeta() {
  const m = readJson(META);
  if (!m || m.v !== 1 || !m.salt || !m.wrap || !Number.isInteger(m.iter) || m.iter < MIN_ITER || m.iter > MAX_ITER) throw new Error('Повреждены данные входа');
  return m;
}

export async function create(password, { iterations = PBKDF2_ITER } = {}) {
  const weak = checkPassword(password);
  if (weak) throw new Error(weak);
  if (hasVault()) throw new Error('Пароль уже задан');
  const salt = randomBytes(16), raw = randomBytes(32);
  const kek = await deriveKey(password, salt, iterations);
  const wrap = await encryptBytes(kek, raw, AAD_DEK);
  storage.setItem(META, JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64(salt), wrap, createdAt: Date.now() }));
  dek = await importAesKey(raw);
}

async function unwrap(password, meta) {
  const kek = await deriveKey(password, unb64(meta.salt), meta.iter);
  try { return await decryptBytes(kek, meta.wrap, AAD_DEK); } catch { throw new WrongPasswordError(); }
}

export async function unlock(password, now = Date.now()) {
  const meta = readMeta();
  const { waitMs } = failState(now);
  if (waitMs > 0) throw new TooManyAttemptsError(waitMs);
  let raw;
  try { raw = await unwrap(password, meta); } catch (e) { if (e instanceof WrongPasswordError) recordFail(now); throw e; }
  dek = await importAesKey(raw);
  clearFails();
}

export const lock = () => { dek = null; };

export async function changePassword(oldPassword, newPassword, { iterations = PBKDF2_ITER } = {}) {
  const weak = checkPassword(newPassword);
  if (weak) throw new Error(weak);
  const meta = readMeta();
  const raw = await unwrap(oldPassword, meta);               // неверный старый пароль -> WrongPasswordError
  const salt = randomBytes(16);
  const kek = await deriveKey(newPassword, salt, iterations);
  const wrap = await encryptBytes(kek, raw, AAD_DEK);
  storage.setItem(META, JSON.stringify({ ...meta, iter: iterations, salt: b64(salt), wrap, changedAt: Date.now() }));
}

// Проверка пароля без разблокировки (для подтверждения опасных действий).
export async function verify(password) { await unwrap(password, readMeta()); }

export function remove() { storage.removeItem(META); storage.removeItem(FAILS); dek = null; }

// ---- запись <-> зашифрованная запись ----
export const isSealed = rec => !!(rec && typeof rec.ct === 'string');

export async function seal(ev) {
  if (!dek) throw new LockedError();
  const { iv, ct } = await encryptBytes(dek, textToBytes(JSON.stringify(ev)), textToBytes(ev.id));
  return { id: ev.id, v: 1, iv, ct };
}
export async function open(rec) {
  if (!isSealed(rec)) return rec;                            // обычная (ещё не зашифрованная) запись
  if (!dek) throw new LockedError();
  const ev = JSON.parse(bytesToText(await decryptBytes(dek, rec, textToBytes(rec.id))));
  if (ev.id !== rec.id) throw new Error('Запись повреждена или подменена');
  return ev;
}
