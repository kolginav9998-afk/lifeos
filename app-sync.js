// Склейка синхронизации с приложением: запуск после входа, остановка при блокировке, фоновые проходы.
import * as db from './db.js';
import * as vault from './vault.js';
import * as store from './store.js';
import * as clock from './clock.js';
import { createApi } from './api.js';
import { createAccountService } from './account.js';
import { createSync } from './sync.js';

export const api = createApi();
export const account = createAccountService({ api, deps: { enableLock: pw => db.enableLock(pw) } });

const STATE_KEY = 'lifeos.sync.state.v1';
const listeners = new Set();
export let status = { state: 'off', lastSyncAt: 0, pending: 0, error: null, bad: 0 };
export function onStatus(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); }
function setStatus(s) { status = { ...status, ...s }; for (const fn of listeners) { try { fn(status); } catch (e) { console.error(e); } } }

let engine = null, unsubWrite = null, interval = null, soonTimer = null, retryTimer = null, failures = 0;

const local = {
  metas: async () => new Map((await db.raw.all()).map(r => [r.id, r.u ?? 0])),
  get: id => db.raw.get(id),
  writeMany: recs => db.raw.writeMany(recs),
  deleteMany: ids => db.raw.deleteMany(ids),
  stampU: async (id, u) => { const r = await db.raw.get(id); if (r) await db.raw.writeMany([{ ...r, u }]); },
};
const loadState = () => { try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch { return null; } };
const saveState = st => { try { localStorage.setItem(STATE_KEY, JSON.stringify(st)); } catch { /* не критично */ } };

export async function start({ markAll = false } = {}) {
  stop();
  const a = account.info();
  if (!a) { setStatus({ state: 'off', pending: 0 }); return false; }
  if (!vault.isUnlocked()) { setStatus({ state: 'locked' }); return false; }
  await account.loadSession();
  engine = createSync({
    api, server: a.server, getToken: () => account.token(), local, clock, loadState, saveState,
    validate: async rec => { try { await vault.open(rec); return true; } catch { return false; } },
    onStatus: s => { setStatus(s); handleResult(s); },
    onApplied: ({ upserts, deletes }) => store.reload(upserts, deletes),
  });
  unsubWrite = db.onWrite(e => { engine?.notifyWrite(e); scheduleSoon(); });
  if (markAll) await engine.markAllDirty();
  setStatus({ state: 'idle', lastSyncAt: engine.status.lastSyncAt, pending: engine.dirtyIds().length, error: null, bad: 0 });
  if (!account.token()) { setStatus({ state: 'needs-login' }); return true; }
  interval = setInterval(() => { if (!document.hidden && navigator.onLine) syncNow(); }, 60_000);
  addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  syncNow();
  return true;
}

export function stop() {
  clearInterval(interval); clearTimeout(soonTimer); clearTimeout(retryTimer);
  interval = soonTimer = retryTimer = null; failures = 0;
  removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisible);
  unsubWrite?.(); unsubWrite = null;
  engine?.flush(); engine = null;
  account.clearMemory();
  setStatus({ state: account.isLinked() ? 'locked' : 'off', pending: 0 });
}

const onOnline = () => syncNow();
const onVisible = () => { if (!document.hidden) syncNow(); };

function scheduleSoon(delay = 2500) {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => syncNow(), delay);
}
function handleResult(s) {
  if (s.state === 'idle') { failures = 0; clearTimeout(retryTimer); }
  else if (s.state === 'offline' || s.state === 'error') {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => syncNow(), Math.max(s.retryAfterMs || 0, Math.min(300_000, 15_000 * 2 ** failures++)));
  }
}

export async function syncNow() { return engine ? engine.syncOnce() : { ok: false, error: new Error('sync_off') }; }
export const markAllDirty = () => engine?.markAllDirty();
export const flush = () => engine?.flush();
export const isRunning = () => !!engine;
