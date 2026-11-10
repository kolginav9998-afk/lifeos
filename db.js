// Хранилище: IndexedDB + зеркальная копия в localStorage (пока данных немного).
// Если IndexedDB пуст или недоступен, а копия есть, данные восстанавливаются из копии.
// Если включена защита паролем, записи лежат зашифрованными (vault.js) в обоих местах.
// Нечитаемые записи НИКОГДА не удаляются молча: они остаются на месте и показываются как «повреждённые».
// Каждая запись получает метку u (логические часы) — по ней сливаются данные при синхронизации.
import * as vault from './vault.js';
import * as clock from './clock.js';
import { LockedError } from './vault.js';

const DB_NAME = 'lifeos';
const STORE = 'events';
const LS_KEY = 'lifeos.events.v1';
const MIRROR_OFF = 'lifeos.mirror.off';
const MIRROR_MAX = 900_000;                     // больше — копию в localStorage не ведём (лимит ~5 МБ и скорость)

export const state = { idbOk: null, idbError: '', lsOk: null, corrupt: [], mirrorOff: false };
try { state.mirrorOff = localStorage.getItem(MIRROR_OFF) === '1'; } catch { /* нет хранилища */ }

// Подписка на локальные записи (нужна синхронизации, чтобы отмечать изменённое).
const writeHooks = new Set();
export function onWrite(fn) { writeHooks.add(fn); return () => writeHooks.delete(fn); }
const emitWrite = (id, u, d) => { for (const fn of writeHooks) { try { fn({ id, u, d }); } catch (e) { console.error(e); } } };

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
  if (state.mirrorOff) return [];
  try { const v = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function lsWrite(list) {
  if (state.mirrorOff) return true;
  try {
    const text = JSON.stringify(list);
    if (text.length > MIRROR_MAX) {                 // данных стало много: копию отключаем, основное хранилище — IndexedDB
      localStorage.removeItem(LS_KEY); localStorage.setItem(MIRROR_OFF, '1'); state.mirrorOff = true; return true;
    }
    localStorage.setItem(LS_KEY, text); state.lsOk = true; return true;
  } catch { state.lsOk = false; return false; }
}

// «Сырые» записи (как лежат на диске: обычные или зашифрованные)
async function rawAll() {
  const a = await idb('readonly', s => s.getAll());
  const ls = lsRead();
  if (a.ok && Array.isArray(a.value) && a.value.length >= ls.length) { if (!state.mirrorOff && a.value.length !== ls.length) lsWrite(a.value); return a.value; }
  if (ls.length) { if (a.ok) await idb('readwrite', s => { ls.forEach(r => s.put(r)); }); return ls; }
  return a.ok && Array.isArray(a.value) ? a.value : [];
}

async function writeRaw(recs) {
  const a = await idb('readwrite', s => { recs.forEach(r => s.put(r)); });
  const ids = new Set(recs.map(r => r.id));
  const b = state.mirrorOff ? true : lsWrite([...lsRead().filter(r => !ids.has(r.id)), ...recs]);
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

// Прочитать выбранные записи (после синхронизации обновляем только изменившиеся).
export async function getMany(ids) {
  const out = [];
  for (const id of ids) {
    const a = await idb('readonly', s => s.get(id));
    const rec = a.ok ? a.value : lsRead().find(r => r.id === id);
    if (!rec) continue;
    try { out.push(await vault.open(rec)); } catch (e) { if (e instanceof LockedError) throw e; state.corrupt.push(id); }
  }
  return out;
}

async function toRaw(ev) { return vault.hasVault() ? vault.seal(ev) : ev; }   // seal бросит LockedError, если заблокировано
const stamp = ev => ({ ...ev, u: clock.tick() });

export async function put(ev) {
  const s = stamp(ev);
  await writeRaw([await toRaw(s)]);
  emitWrite(s.id, s.u, false);
  return s;
}
export async function putMany(evs) {
  if (!evs.length) return [];
  const ss = evs.map(stamp);
  await writeRaw(await Promise.all(ss.map(toRaw)));
  for (const s of ss) emitWrite(s.id, s.u, false);
  return ss;
}

export async function remove(id) { return removeMany([id]); }
export async function removeMany(ids) {
  if (vault.hasVault() && !vault.isUnlocked()) throw new LockedError();
  const set = new Set(ids);
  const a = await idb('readwrite', s => { ids.forEach(i => s.delete(i)); });
  const b = state.mirrorOff ? true : lsWrite(lsRead().filter(r => !set.has(r.id)));
  if (!a.ok && !b) throw new Error('Не удалось удалить: хранилище недоступно');
  for (const id of ids) emitWrite(id, clock.tick(), true);
}

export async function counts() {
  const a = await idb('readonly', s => s.count());
  return { idb: a.ok && typeof a.value === 'number' ? a.value : null, ls: state.mirrorOff ? null : lsRead().length };
}

// ---- доступ для синхронизации: пишет и удаляет БЕЗ отметок «изменено» ----
export const raw = {
  all: rawAll,
  async get(id) {
    const a = await idb('readonly', s => s.get(id));
    if (a.ok && a.value) return a.value;
    return lsRead().find(r => r.id === id) ?? null;
  },
  async ids() { return (await rawAll()).map(r => r.id); },
  writeMany: recs => (recs.length ? writeRaw(recs) : Promise.resolve()),
  async deleteMany(ids) {
    const set = new Set(ids);
    const a = await idb('readwrite', s => { ids.forEach(i => s.delete(i)); });
    const b = state.mirrorOff ? true : lsWrite(lsRead().filter(r => !set.has(r.id)));
    if (!a.ok && !b) throw new Error('Не удалось удалить: хранилище недоступно');
  },
};

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

// Полная очистка: данные, пароль, профиль, настройки, привязка к аккаунту.
export async function wipeAll() {
  await idb('readwrite', s => s.clear());
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('lifeos.')) keys.push(k); }
    keys.forEach(k => localStorage.removeItem(k));
  } catch { /* хранилище недоступно */ }
  vault.lock();
  state.corrupt = []; state.mirrorOff = false;
}
