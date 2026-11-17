// Склейка чата с приложением (R4.3): ядро chat-core + аккаунт (сервер, сессия, логин) + журнал (ключи чата) + кэш на устройстве.
// Кэш расшифрованной переписки лежит в отдельной базе IndexedDB «lifeos-chat»; каждая запись в ней зашифрована ключом защиты устройства
// (vault), не синхронизируется и стирается вместе с остальными данными (db.wipeAll). Ключи чата хранятся в журнале записей (тип chatkey)
// и потому едут между устройствами владельца в зашифрованном виде. Опрос сервера: раз в 15 секунд, пока открыт чат, и раз в минуту на фоне
// (сервиса push-уведомлений нет, поэтому сообщения приходят, пока приложение открыто).
//
// Для экранов:
//   available()                  — можно ли пользоваться чатом (вошёл в аккаунт, приложение разблокировано);
//   await getChat()              — ядро чата (см. chat-core.js): contacts, thread, send, unread, meetings, safety, acceptKey;
//   await refresh()              — спросить сервер сейчас; startPolling(fast) / stopPolling() / reset();
//   unreadCount(), onChat(fn)    — число непрочитанного и подписка на изменения (fn вызывается после каждого опроса и отправки).
import * as store from './store.js';
import * as vault from './vault.js';
import { api, account, status as syncStatus } from './app-sync.js';
import { createChat } from './chat-core.js';
import { chatKeysOf, chatKeyRecord } from './chat-crypto.js';

const DB = 'lifeos-chat';
let dbp = null;
const open = () => (dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => { dbp = null; rej(r.error); };
}));
const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
  const t = db.transaction('kv', mode), req = fn(t.objectStore('kv'));
  t.oncomplete = () => res(req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
}));
const me = () => account.info()?.username ?? '';
const kv = {
  get: async k => { const rec = await run('readonly', s => s.get(`${me()}:${k}`)); return rec ? (await vault.open(rec)).v : undefined; },
  set: async (k, v) => { const id = `${me()}:${k}`; const rec = await vault.seal({ id, v }); await run('readwrite', s => s.put(rec, id)); },
};

let chat = null, starting = null, timer = 0, fast = false, unread = 0, lastError = null;
const listeners = new Set();
const emit = () => { for (const fn of listeners) { try { fn({ unread, error: lastError }); } catch (e) { console.error(e); } } try { globalThis.dispatchEvent?.(new CustomEvent('lifeos:chat', { detail: { unread } })); } catch { /* не браузер */ } };

export const available = () => account.isLinked() && vault.isUnlocked();
export const unreadCount = () => unread;
export const lastChatError = () => lastError;
export function onChat(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function getChat() {
  if (!available()) throw new Error('Чат доступен после входа в аккаунт');
  // Пока журнал не подтянулся с сервера, ключа чата «нет» только потому, что он ещё не пришёл: создавать новый нельзя, он заменил бы настоящий.
  if (!chatKeysOf(store.state.events) && !(syncStatus.lastSyncAt > 0)) throw new Error('Подожди: данные ещё загружаются с сервера');
  if (!chat) {
    chat = createChat({ api, base: account.info().server, token: () => account.token(), me, kv, getKeys: () => chatKeysOf(store.state.events), putKeys: async k => { await store.save(chatKeyRecord(k)); } });
    starting = chat.init().catch(e => { chat = null; starting = null; throw e; });
  }
  await starting;
  return chat;
}

export async function refresh() {
  try {
    const c = await getChat();
    await c.contacts(); await c.poll();
    unread = await c.unreadTotal(); lastError = null;
  } catch (e) { lastError = e; throw e; } finally { emit(); }
}

export function startPolling(fastMode = false) {
  fast = !!fastMode; clearTimeout(timer);
  const tick = async () => { try { await refresh(); } catch { /* ошибка сохранена в lastError, экран её покажет */ } timer = setTimeout(tick, fast ? 15000 : 60000); };
  tick();
}
export const stopPolling = () => { clearTimeout(timer); timer = 0; };
export function setFast(f) { if (!!f !== fast && timer) startPolling(f); else fast = !!f; }
// При выходе из аккаунта: остановить опрос и забыть собеседников в памяти (кэш на устройстве остаётся до стирания данных).
export function reset() { stopPolling(); chat = null; starting = null; unread = 0; lastError = null; emit(); }
