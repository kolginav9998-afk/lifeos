// Склейка чата в настоящем браузере: ключи в журнале, зашифрованный кэш на устройстве, получение и отправка через настоящий сервер.
// «Анна» — второй человек: её ядро чата работает в Node против того же сервера.
import assert from 'node:assert/strict';
import { launch, until, appReady } from './helpers.mjs';
import { createServer } from '../server/node/server.js';
import { createApi } from '../api.js';
import { createChat } from '../chat-core.js';

const PW = 'длинная-надёжная-фраза';
const server = createServer({ env: { ALLOWED_ORIGINS: '*', SETUP_CODE: 'код-123' } });
await new Promise(r => server.server.listen(0, r));
const SERVER = `http://localhost:${server.server.address().port}`;
const t = await launch({ buildEnv: { LIFEOS_REQUIRE_ACCOUNT: '1', LIFEOS_SERVER_URL: SERVER } });
const A = t.page;
A.on('dialog', d => d.accept());
const b64 = n => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64');

// ===== владелец регистрируется в браузере =====
await A.goto(t.url);
await until(A, () => document.getElementById('gate-register'), null, 30000);
await A.fill('#gate-user', 'Владелец'); await A.fill('#gate-pass', PW); await A.fill('#gate-pass2', PW); await A.fill('#gate-setup', 'код-123');
await A.click('#gate-register');
await until(A, () => document.getElementById('gate-code'), null, 90000);
await A.check('#gate-code-ok'); await A.click('#gate-code-done');
await appReady(A, 30000);
await until(A, async () => (await import('./app-sync.js')).status.lastSyncAt > 0, null, 30000);
const ownerToken = await A.evaluate(async () => (await import('./app-sync.js')).account.token());

// ===== Анна регистрируется по приглашению (в Node) и открывает чат =====
const api = createApi();
const inv = await api.createInvite(SERVER, ownerToken);
const reg = await api.register(SERVER, { username: 'Анна', authKey: b64(32), authSalt: b64(16), authIter: 600000, invite: inv.code, meta: { v: 2, kdf: 'PBKDF2-SHA256', iter: 600000, salt: b64(16), wrap: { iv: b64(12), ct: b64(48) } } });
const annaKv = new Map(), annaJournal = { keys: null };
const anna = createChat({ api, base: SERVER, token: () => reg.token, me: () => 'Анна', getKeys: () => annaJournal.keys, putKeys: async k => { annaJournal.keys = k; },
  kv: { get: async k => annaKv.get(k), set: async (k, v) => { annaKv.set(k, v); } } });
await anna.init({ display: 'Аня' });

// ===== в браузере: чат готов, ключ в журнале, контакты =====
const info = await A.evaluate(async () => {
  const c = await import('./app-chat.js'), s = await import('./store.js');
  const chat = await c.getChat();
  const list = await chat.contacts();
  return { avail: c.available(), contacts: list.map(x => [x.username, x.keyStatus, x.display]), keyInJournal: s.state.events.some(e => e.type === 'chatkey' && e.payload.priv && e.payload.pub) };
});
assert.deepEqual(info, { avail: true, contacts: [['анна', 'ok', 'Аня']], keyInJournal: true });
assert.notEqual(server.store.getAccountByName('владелец').pub, null, 'открытый ключ владельца на сервере');

// ===== Анна пишет, браузер получает, расшифровывает, считает непрочитанное =====
await anna.contacts();
await anna.send('владелец', { kind: 'text', text: 'Привет из Node! ❤' });
const got = await A.evaluate(async () => {
  const c = await import('./app-chat.js');
  await c.refresh();
  const chat = await c.getChat();
  const th = chat.thread('анна').map(m => [m.out, m.body.text]);
  const n = c.unreadCount();
  await chat.markRead('анна'); await c.refresh();
  return { th, n, after: c.unreadCount() };
});
assert.deepEqual(got, { th: [[false, 'Привет из Node! ❤']], n: 1, after: 0 });

// ===== кэш на устройстве зашифрован: открытого текста в базе нет =====
const raw = await A.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open('lifeos-chat', 1);
  r.onsuccess = () => { const tx = r.result.transaction('kv', 'readonly'), q = tx.objectStore('kv').getAll(); q.onsuccess = () => res(JSON.stringify(q.result)); q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}));
assert.ok(raw.length > 50 && !raw.includes('Привет из Node') && !raw.includes('анна:thread'), 'в кэше только шифртекст');

// ===== браузер отвечает, Анна читает =====
await A.evaluate(async () => { const c = await import('./app-chat.js'); const chat = await c.getChat(); await chat.send('анна', { kind: 'text', text: 'Привет, Аня!' }); });
const annaGot = await anna.poll();
assert.equal(annaGot.added, 1);
assert.equal(anna.thread('владелец').at(-1).body.text, 'Привет, Аня!');

// ===== после перезагрузки страницы: ключ тот же, кэш читается, повторных сообщений нет =====
const pubBefore = server.store.getAccountByName('владелец').pub;
await A.reload();
await appReady(A, 60000).catch(async () => { /* после перезагрузки приложение просит пароль */ });
if (await A.locator('#lock').isVisible().catch(() => false)) { await A.fill('#lock-input', PW); await A.click('#lock-btn'); await appReady(A, 60000); }
await until(A, async () => (await import('./app-sync.js')).status.lastSyncAt > 0, null, 60000);
const again = await A.evaluate(async () => {
  const c = await import('./app-chat.js');
  await c.refresh();
  const chat = await c.getChat();
  return { th: chat.thread('анна').map(m => [m.out, m.body.text]), unread: c.unreadCount() };
});
assert.deepEqual(again, { th: [[false, 'Привет из Node! ❤'], [true, 'Привет, Аня!']], unread: 0 });
assert.equal(server.store.getAccountByName('владелец').pub, pubBefore, 'ключ не менялся');
console.log('E2E CHAT GLUE OK');
await t.browser.close(); server.close(); process.exit(0);
