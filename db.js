// Хранилище: IndexedDB + зеркальная копия в localStorage.
// Если IndexedDB пуст или недоступен, а копия есть, данные восстанавливаются из копии.
// Реальное удаление: убираем из обоих мест.
const DB_NAME = 'lifeos';
const STORE = 'events';
const LS_KEY = 'lifeos.events.v1';

export const state = { idbOk: null, idbError: '', lsOk: null };

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
async function safeIdb(mode, fn) {
  try {
    const r = await idbTx(mode, fn);
    state.idbOk = true;
    return r;
  } catch (e) {
    state.idbOk = false;
    state.idbError = String(e?.message || e);
    return undefined;
  }
}

export function lsRead() {
  try { const v = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function lsWrite(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); state.lsOk = true; }
  catch { state.lsOk = false; }
}

export async function getAll() {
  const idb = await safeIdb('readonly', s => s.getAll());
  const ls = lsRead();
  if (Array.isArray(idb) && idb.length >= ls.length) { lsWrite(idb); return idb; }
  // IndexedDB пуст/сломан, а копия полнее — восстанавливаем
  if (ls.length) { if (state.idbOk) await safeIdb('readwrite', s => { ls.forEach(e => s.put(e)); }); return ls; }
  return Array.isArray(idb) ? idb : [];
}

export async function put(ev) {
  await safeIdb('readwrite', s => s.put(ev));
  lsWrite([...lsRead().filter(e => e.id !== ev.id), ev]);
}
export async function remove(id) {
  await safeIdb('readwrite', s => s.delete(id));
  lsWrite(lsRead().filter(e => e.id !== id));
}
export async function putMany(evs) {
  await safeIdb('readwrite', s => { evs.forEach(e => s.put(e)); });
  const ids = new Set(evs.map(e => e.id));
  lsWrite([...lsRead().filter(e => !ids.has(e.id)), ...evs]);
}

export async function counts() {
  const idb = await safeIdb('readonly', s => s.count());
  return { idb: typeof idb === 'number' ? idb : null, ls: lsRead().length };
}
