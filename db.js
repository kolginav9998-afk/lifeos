// Хранилище: IndexedDB + зеркальная копия в localStorage.
// Если IndexedDB пуст или недоступен, а копия есть, данные восстанавливаются из копии.
// Если включена защита паролем, записи лежат зашифрованными (vault.js) в обоих местах.
// Нечитаемые записи НИКОГДА не удаляются молча: они остаются на месте и показываются как «повреждённые».
import * as vault from './vault.js';
import { LockedError } from './vault.js';

const DB_NAME = 'lifeos';
const STORE = 'events';
const LS_KEY = 'lifeos.events.v1';

export const state = { idbOk: null, idbError: '', lsOk: null, corrupt: [] };

function open() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB недоступен'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB: ошибка открытия'));
    req.onblocked = () => reject(new Error('IndexedDB заблокирован'));
  });
}

async function idbTx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

// idb-операция, которая не роняет приложение: ошибка запоминается для диагностики
async function idb(mode, fn) {
  try {
    const value = await idbTx(mode, fn);
    state.idbOk = true;
    return { ok: true, value };
  } catch (e) {
    state.idbOk = false;
    state.idbError = String(e?.message || e);
    return { ok: false, value: undefined };
  }
}

export function lsRead() {
  try { const v = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function lsWrite(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); state.lsOk = true; return true; }
  catch { state.lsOk = false; return false; }
}

// «Сырые» записи (как лежат на диске: обычные или зашифрованные)
async function rawAll() {
  const a = await idb('readonly', s => s.getAll());
  const ls = lsRead();
  if (a.ok && Array.isArray(a.value) && a.value.length >= ls.length) { if (a.value.length !== ls.length) lsWrite(a.value); return a.value; }
  if (ls.length) { if (a.ok) await idb('readwrite', s => { ls.forEach(r => s.put(r)); }); return ls; }
  return a.ok && Array.isArray(a.value) ? a.value : [];
}

async function writeRaw(recs) {
  const a = await idb('readwrite', s => { recs.forEach(r => s.put(r)); });
  const ids = new Set(recs.map(r => r.id));
  const b = lsWrite([...lsRead().filter(r => !ids.has(r.id)), ...recs]);
  if (!a.ok && !b) throw new Error('Не удалось сохранить данные: хранилище недоступно');
}

export async function getAll() {
  const raw = await rawAll();
  const out = [];
  const corrupt = [];
  for (const r of raw) {
    try { out.push(await vault.open(r)); }
    catch (e) { if (e instanceof LockedError) throw e; corrupt.push(r?.id ?? '?'); }
  }
  state.corrupt = corrupt;
  return out;
}

async function toRaw(ev) { return vault.hasVault() ? vault.seal(ev) : ev; }   // seal бросит LockedError, если заблокировано

export async function put(ev) { await writeRaw([await toRaw(ev)]); }
export async function putMany(evs) { if (evs.length) await writeRaw(await Promise.all(evs.map(toRaw))); }

export async function remove(id) { return removeMany([id]); }
export async function removeMany(ids) {
  if (vault.hasVault() && !vault.isUnlocked()) throw new LockedError();
  const set = new Set(ids);
  const a = await idb('readwrite', s => { ids.forEach(i => s.delete(i)); });
  const b = lsWrite(lsRead().filter(r => !set.has(r.id)));
  if (!a.ok && !b) throw new Error('Не удалось удалить: хранилище недоступно');
}

export async function counts() {
  const a = await idb('readonly', s => s.count());
  return { idb: a.ok && typeof a.value === 'number' ? a.value : null, ls: lsRead().length };
}

// ---- защита паролем ----

// Довести шифрование до конца: зашифровать записи, которые ещё лежат открытыми (после прерванного включения защиты).
export async function sealPending() {
  if (vault.status() !== 'unlocked') return 0;
  const plain = (await rawAll()).filter(r => !vault.isSealed(r));
  if (!plain.length) return 0;
  await writeRaw(await Promise.all(plain.map(r => vault.seal(r))));
  return plain.length;
}

export async function enableLock(password) {
  await getAll();                         // убедимся, что всё читается, прежде чем что-то менять
  await vault.create(password);
  return sealPending();                   // если здесь прервётся — довершится при следующем входе
}

export async function disableLock(password) {
  await vault.verify(password);
  const all = await getAll();             // расшифрованные события
  await writeRaw(all);                    // записываем открытыми
  vault.remove();                         // и только после этого убираем пароль
}

// Полная очистка: данные, пароль, профиль, настройки.
export async function wipeAll() {
  await idb('readwrite', s => s.clear());
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('lifeos.')) keys.push(k); }
    keys.forEach(k => localStorage.removeItem(k));
  } catch { /* хранилище недоступно */ }
  vault.lock();
  state.corrupt = [];
}
