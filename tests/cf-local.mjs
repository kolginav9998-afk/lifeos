import assert from 'node:assert/strict';
import { createApi } from '../api.js';
import { createAccountService } from '../account.js';
import * as vault from '../vault.js';
// Проверка Cloudflare-версии сервера в локальном окружении Cloudflare (workerd).
//   cd server/cloudflare && npx wrangler dev --local --port 8799 --persist-to /tmp/lifeos-cf
//   node tests/cf-local.mjs     (сервер должен быть чистым)
const BASE = process.env.SYNC_URL || 'http://127.0.0.1:8799';
const PW = 'длинная-надёжная-фраза';
const api = createApi();
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const b64 = n => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64');
const rec = (id, u) => ({ id, u, d: 0, v: 1, iv: b64(12), ct: b64(64) });
const device = () => { const storage = mem(); return { storage, svc: createAccountService({ api, storage, authIter: 2000, deps: { enableLock: pw => vault.create(pw, { iterations: 2000 }) } }), use: () => vault.useStorage(storage) }; };
const t0 = Date.now();
const A = device(); A.use();
assert.equal((await api.status(BASE)).registered, false);
const r = await A.svc.register({ server: BASE, username: 'Владелец', password: PW });
assert.ok(r.recoveryCode);
await assert.rejects(device().svc.register({ server: BASE, username: 'другой', password: PW }), e => e.code === 'account_exists');
const tok = A.svc.token();
let p = await api.push(BASE, tok, [rec('a', 100), rec('b', 100), rec('c', 100)]);
assert.deepEqual([p.accepted, p.stale.length, p.seq], [3, 0, 3]);
p = await api.push(BASE, tok, [rec('a', 50)]); assert.deepEqual(p.stale, [{ id: 'a', u: 100 }]);
p = await api.push(BASE, tok, [{ id: 'b', u: 300, d: 1 }]); assert.equal(p.accepted, 1);
const pull = await api.pull(BASE, tok, 0);
assert.deepEqual(pull.records.map(x => [x.id, x.d]).sort(), [['a', 0], ['b', 1], ['c', 0]]);
assert.equal((await api.pull(BASE, tok, 1, 1)).more, true);
// второе устройство
const B = device(); B.use();
const auth = await B.svc.authenticate({ server: BASE, username: 'ВЛАДЕЛЕЦ', password: PW });
await B.svc.link(auth, PW);
assert.equal((await api.pull(BASE, B.svc.token(), 0)).records.length, 3);
// смена пароля, старые сессии закрыты
A.use(); await A.svc.changePassword({ oldPassword: PW, newPassword: 'новый-пароль-22' });
assert.equal((await api.pull(BASE, B.svc.token(), 0).catch(e => e)).status, 401);
assert.equal((await B.svc.authenticate({ server: BASE, username: 'владелец', password: PW }).catch(e => e)).status, 401);
// восстановление по коду
const C = device(); C.use();
await C.svc.recover({ server: BASE, username: 'владелец', code: r.recoveryCode, newPassword: 'после-сброса-33' });
assert.equal((await api.pull(BASE, C.svc.token(), 0)).records.length, 3);
// перебор: пауза
for (let i = 0; i < 5; i++) await C.svc.authenticate({ server: BASE, username: 'владелец', password: 'неверный-пароль-1' }).catch(() => {});
const locked = await C.svc.authenticate({ server: BASE, username: 'владелец', password: 'после-сброса-33' }).catch(e => e);
assert.equal(locked.status, 429, 'после 5 неверных попыток вход временно закрыт');
// удаление
C.use(); await C.svc.loadSession();
const del = await api.deleteAccount(BASE, C.svc.token(), 'x'.repeat(43) + '=').catch(e => e);
assert.ok(del.status === 401 || del.status === 429, 'без верного пароля не удаляется');
// ---- несколько аккаунтов (R4.3): приглашение, контакты, переписка, изоляция, администратор; настоящая база Cloudflare ----
const call = async (m, p, { body, token } = {}) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const metaOf = () => ({ v: 2, kdf: 'PBKDF2-SHA256', iter: 600000, salt: b64(16), wrap: { iv: b64(12), ct: b64(48) } });
const owner = C.svc.token();
assert.equal((await call('POST', '/v1/register', { body: { username: 'Анна', authKey: b64(32), authSalt: b64(16), authIter: 600000, meta: metaOf() } })).status, 409, 'без приглашения нельзя');
const inv = await call('POST', '/v1/invites', { token: owner });
assert.equal(inv.status, 201);
const reg = await call('POST', '/v1/register', { body: { username: 'Анна', authKey: b64(32), authSalt: b64(16), authIter: 600000, meta: metaOf(), invite: inv.body.code } });
assert.equal(reg.status, 201);
const anna = reg.body.token;
assert.equal((await call('POST', '/v1/register', { body: { username: 'Борис', authKey: b64(32), authSalt: b64(16), authIter: 600000, meta: metaOf(), invite: inv.body.code } })).status, 403, 'приглашение одноразовое');
assert.deepEqual((await call('GET', '/v1/contacts', { token: owner })).body.contacts.map(x => x.username), ['анна']);
assert.equal((await call('POST', '/v1/keys', { token: anna, body: { pub: Buffer.from([4, ...crypto.getRandomValues(new Uint8Array(64))]).toString('base64'), display: 'Аня' } })).status, 200);
// одинаковый id записи у двух аккаунтов не пересекается
assert.equal((await call('POST', '/v1/sync', { token: anna, body: { records: [rec('a', 7)] } })).body.accepted, 1);
assert.deepEqual((await call('GET', '/v1/sync?since=0', { token: anna })).body.records.map(x => [x.id, x.u, x.s]), [['a', 7, 1]]);
assert.equal((await call('GET', '/v1/sync?since=0', { token: owner })).body.records.find(x => x.id === 'a').u, 100, 'у владельца запись a осталась своя');
const m1 = { iv: b64(12), ct: b64(80) };
assert.equal((await call('POST', '/v1/chat/send', { token: owner, body: { to: 'анна', ...m1 } })).status, 201);
assert.deepEqual((await call('GET', '/v1/chat/inbox?after=0', { token: anna })).body.messages.map(x => [x.from, x.to, x.ct === m1.ct]), [['владелец', 'анна', true]]);
assert.equal((await call('GET', '/v1/admin/accounts', { token: owner })).body.accounts.length, 2);
assert.equal((await call('GET', '/v1/admin/accounts', { token: anna })).status, 404, 'обычному человеку админ-маршрутов как будто нет');
assert.equal((await call('POST', '/v1/admin/accounts/анна/disable', { token: owner })).status, 200);
assert.equal((await call('GET', '/v1/meta', { token: anna })).status, 401);
assert.equal((await call('DELETE', '/v1/admin/accounts/анна', { token: owner })).status, 200);
assert.deepEqual((await call('GET', '/v1/contacts', { token: owner })).body.contacts, []);
console.log('CF LOCAL OK за', ((Date.now() - t0) / 1000).toFixed(1), 'с');
