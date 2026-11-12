import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, lockoutMs, normalizeUsername } from '../server/core.js';
import { openStore, createServer } from '../server/node/server.js';

const b64 = bytes => Buffer.from(bytes).toString('base64');
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const authKey = () => b64(rnd(32));
const wrap = () => ({ iv: b64(rnd(12)), ct: b64(rnd(48)) });
const meta = (withRec = false) => ({ v: 2, kdf: 'PBKDF2-SHA256', iter: 600000, salt: b64(rnd(16)), wrap: wrap(), ...(withRec ? { rec: { iter: 200000, salt: b64(rnd(16)), wrap: wrap() } } : {}) });
const ORIGIN = 'https://kolginav9998-afk.github.io';

function ctx(env = {}) {
  const { store, close } = openStore(':memory:');
  let t = 1_800_000_000_000;
  const clock = { now: () => t, advance: ms => { t += ms; } };
  const call = async (method, path, { body, token, ip = '1.1.1.1', origin } = {}) => {
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip };
    if (token) headers.authorization = `Bearer ${token}`;
    if (origin) headers.origin = origin;
    const req = new Request(`https://sync.test${path}`, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const res = await handle(req, store, env, clock.now());
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  return { store, close, call, clock };
}
const regBody = (over = {}) => ({ username: 'Владелец', authKey: authKey(), authSalt: b64(rnd(16)), authIter: 600000, meta: meta(), ...over });
async function registered(c, over = {}) {
  const body = regBody(over);
  const r = await c.call('POST', '/v1/register', { body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { ...r.body, body };
}
const rec = (id, u, extra = {}) => ({ id, u, d: 0, v: 1, iv: b64(rnd(12)), ct: b64(rnd(64)), ...extra });

test('статус: до и после регистрации; заголовки безопасности', async () => {
  const c = ctx();
  let r = await c.call('GET', '/v1/status');
  assert.deepEqual([r.status, r.body.registered, r.body.setupCodeRequired], [200, false, false]);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  await registered(c);
  r = await c.call('GET', '/v1/status');
  assert.equal(r.body.registered, true);
  c.close();
});

test('регистрация: проверка полей', async () => {
  const c = ctx();
  const bad = async (over, code) => { const r = await c.call('POST', '/v1/register', { body: regBody(over) }); assert.equal(r.status, 400, JSON.stringify(over)); assert.equal(r.body.error, code); };
  await bad({ username: 'ab' }, 'bad_username');
  await bad({ username: 'a b c' }, 'bad_username');
  await bad({ username: 'x'.repeat(65) }, 'bad_username');
  await bad({ authKey: 'короткий' }, 'bad_auth');
  await bad({ authKey: b64(rnd(16)) }, 'bad_auth');
  await bad({ authSalt: b64(rnd(4)) }, 'bad_auth');
  await bad({ authIter: 5 }, 'bad_auth');
  await bad({ meta: null }, 'bad_meta');
  await bad({ meta: { ...meta(), v: 9 } }, 'bad_meta');
  await bad({ meta: { ...meta(), iter: 1 } }, 'bad_meta');
  await bad({ meta: { ...meta(), wrap: { iv: 'x', ct: 'y' } } }, 'bad_meta');
  await bad({ meta: { ...meta(), huge: 'x'.repeat(9000) } }, 'bad_meta');
  await bad({ recovery: { authKey: 'нет', salt: b64(rnd(16)), iter: 200000 } }, 'bad_recovery');
  assert.equal((await c.call('GET', '/v1/status')).body.registered, false, 'неудачные попытки ничего не создали');
  const r = await c.call('POST', '/v1/register', { body: regBody({ recovery: { authKey: authKey(), salt: b64(rnd(16)), iter: 200000 } }) });
  assert.equal(r.status, 201);
  c.close();
});

test('аккаунт один: повторная регистрация отклоняется, одновременные — только одна проходит', async () => {
  const c = ctx();
  const results = await Promise.all(Array.from({ length: 6 }, () => c.call('POST', '/v1/register', { body: regBody() })));
  assert.equal(results.filter(r => r.status === 201).length, 1, 'ровно одна регистрация');
  assert.equal(results.filter(r => r.status === 409).length, 5);
  c.close();
});

test('код установки: без него регистрация закрыта', async () => {
  const c = ctx({ SETUP_CODE: 'секрет-123' });
  assert.equal((await c.call('GET', '/v1/status')).body.setupCodeRequired, true);
  let r = await c.call('POST', '/v1/register', { body: regBody() });
  assert.deepEqual([r.status, r.body.error], [403, 'bad_setup_code']);
  r = await c.call('POST', '/v1/register', { body: regBody({ setupCode: 'не-тот' }) });
  assert.equal(r.status, 403);
  r = await c.call('POST', '/v1/register', { body: regBody({ setupCode: 'секрет-123' }) });
  assert.equal(r.status, 201);
  c.close();
});

test('вход: параметры (в т.ч. «обманные» для чужого логина), успех, неверный пароль, логин без учёта регистра', async () => {
  const c = ctx();
  const { body } = await registered(c);
  const real = await c.call('POST', '/v1/login/params', { body: { username: 'ВЛАДЕЛЕЦ' } });
  assert.deepEqual(real.body, { salt: body.authSalt, iter: 600000 });
  const fake1 = await c.call('POST', '/v1/login/params', { body: { username: 'кто-то' } });
  const fake2 = await c.call('POST', '/v1/login/params', { body: { username: 'кто-то' } });
  assert.deepEqual(fake1.body, fake2.body, 'обманные параметры постоянны');
  assert.ok(fake1.body.salt.length === 24 && fake1.body.iter === 600000, 'выглядят как настоящие');
  assert.notEqual(fake1.body.salt, real.body.salt);
  const ok = await c.call('POST', '/v1/login', { body: { username: ' Владелец ', authKey: body.authKey } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.meta, body.meta, 'мета возвращается как была');
  assert.ok(ok.body.token.length >= 40);
  const bad = await c.call('POST', '/v1/login', { body: { username: 'владелец', authKey: authKey() } });
  const badUser = await c.call('POST', '/v1/login', { body: { username: 'другой', authKey: body.authKey } });
  assert.deepEqual([bad.status, bad.body], [401, { error: 'bad_credentials' }]);
  assert.deepEqual([badUser.status, badUser.body], [401, { error: 'bad_credentials' }], 'неотличимо от неверного пароля');
  c.close();
});

test('вход: пауза после 5 неверных попыток, независимо по адресам, сброс после успеха', async () => {
  assert.deepEqual([0, 4, 5, 6, 9, 30].map(lockoutMs), [0, 0, 1000, 2000, 16000, 900000]);
  const c = ctx();
  const { body } = await registered(c);
  const attempt = (ip, key = authKey()) => c.call('POST', '/v1/login', { ip, body: { username: 'владелец', authKey: key } });
  for (let i = 0; i < 5; i++) assert.equal((await attempt('9.9.9.9')).status, 401);
  let r = await attempt('9.9.9.9', body.authKey);
  assert.equal(r.status, 429, 'даже верный пароль ждёт');
  assert.equal(r.body.retryAfterMs, 1000);
  assert.equal((await attempt('8.8.8.8', body.authKey)).status, 200, 'другой адрес не заблокирован');
  c.clock.advance(1100);
  assert.equal((await attempt('9.9.9.9', body.authKey)).status, 200, 'после паузы вход работает');
  assert.equal((await attempt('9.9.9.9')).status, 401);
  assert.equal((await attempt('9.9.9.9')).status, 401);
  assert.equal(c.store.getFails('ip:9.9.9.9').n, 2, 'счётчик начат заново');
  c.close();
});

test('сессии: без токена и с чужим — 401, выход закрывает токен, истёкшая не работает', async () => {
  const c = ctx();
  const s = await registered(c);
  assert.equal((await c.call('GET', '/v1/sync?since=0')).status, 401);
  assert.equal((await c.call('GET', '/v1/sync?since=0', { token: 'x'.repeat(43) })).status, 401);
  assert.equal((await c.call('GET', '/v1/sync?since=0', { token: s.token })).status, 200);
  assert.equal((await c.call('POST', '/v1/logout', { token: s.token })).status, 200);
  assert.equal((await c.call('GET', '/v1/sync?since=0', { token: s.token })).status, 401);
  const l = (await c.call('POST', '/v1/login', { body: { username: 'владелец', authKey: s.body.authKey } })).body;
  c.clock.advance(31 * 24 * 3600 * 1000);
  assert.equal((await c.call('GET', '/v1/sync?since=0', { token: l.token })).status, 401, 'истёкшая сессия');
  c.close();
});

test('синхронизация: отправка, получение, курсор, постраничность', async () => {
  const c = ctx();
  const { token } = await registered(c);
  let r = await c.call('POST', '/v1/sync', { token, body: { records: [rec('a', 100), rec('b', 100), rec('c', 100)] } });
  assert.deepEqual([r.status, r.body.accepted, r.body.stale, r.body.seq], [200, 3, [], 3]);
  r = await c.call('GET', '/v1/sync?since=0', { token });
  assert.deepEqual(r.body.records.map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual([r.body.more, r.body.seq], [false, 3]);
  r = await c.call('GET', '/v1/sync?since=1&limit=1', { token });
  assert.deepEqual([r.body.records.map(x => x.id), r.body.more, r.body.seq], [['b'], true, 2]);
  r = await c.call('GET', '/v1/sync?since=2&limit=5', { token });
  assert.deepEqual([r.body.records.map(x => x.id), r.body.more, r.body.seq], [['c'], false, 3]);
  r = await c.call('GET', '/v1/sync?since=99', { token });
  assert.deepEqual([r.body.records, r.body.more], [[], false]);
  c.close();
});

test('синхронизация: побеждает большее u, равное — идемпотентно, старое отклоняется, удаление — запись-надгробие', async () => {
  const c = ctx();
  const { token } = await registered(c);
  const push = recs => c.call('POST', '/v1/sync', { token, body: { records: recs } });
  const get = async () => (await c.call('GET', '/v1/sync?since=0', { token })).body.records;
  await push([rec('x', 100, { ct: b64(rnd(32)) })]);
  const v1 = (await get())[0];
  let r = await push([rec('x', 50)]);
  assert.deepEqual([r.body.accepted, r.body.stale], [0, [{ id: 'x', u: 100 }]], 'старое отклонено');
  assert.equal((await get())[0].ct, v1.ct, 'содержимое не изменилось');
  r = await push([rec('x', 200)]);
  assert.equal(r.body.accepted, 1);
  const v2 = (await get())[0];
  assert.equal(v2.u, 200); assert.ok(v2.s > v1.s, 'новая версия получила новый номер');
  r = await push([rec('x', 200)]);
  assert.equal(r.body.accepted, 1, 'равное u принимается (повтор отправки безопасен)');
  r = await push([{ id: 'x', u: 300, d: 1 }]);
  assert.equal(r.body.accepted, 1);
  const t = (await get())[0];
  assert.deepEqual([t.d, t.iv, t.ct, t.u], [1, null, null, 300], 'надгробие без содержимого');
  r = await push([rec('x', 250)]);
  assert.deepEqual(r.body.stale, [{ id: 'x', u: 300 }], 'старая правка не «воскрешает» удалённое');
  r = await push([rec('x', 400)]);
  assert.equal(r.body.accepted, 1, 'более новая запись создаёт заново');
  c.close();
});

test('синхронизация: проверка записей и ограничений', async () => {
  const c = ctx();
  const { token } = await registered(c);
  const push = recs => c.call('POST', '/v1/sync', { token, body: { records: recs } });
  for (const bad of [rec('', 1), rec('x'.repeat(101), 1), rec('a', -1), rec('a', 1.5), rec('a', 1, { iv: 'x' }), rec('a', 1, { ct: '!!!!' }), rec('a', 1, { iv: b64(rnd(8)) }),
    rec('a', 1, { ct: 'A'.repeat(256 * 1024 + 4) }), null, 5, 'строка']) {
    const r = await push([rec('ok', 1), bad]);
    assert.equal(r.status, 400, JSON.stringify(bad)?.slice(0, 60));
  }
  assert.equal(c.store.stats().count, 0, 'пачка с плохой записью не применяется вовсе');
  assert.equal((await push(Array.from({ length: 201 }, (_, i) => rec('r' + i, 1)))).status, 400, 'не больше 200 в пачке');
  assert.equal((await push(Array.from({ length: 200 }, (_, i) => rec('r' + i, 1)))).body.accepted, 200);
  assert.equal((await c.call('POST', '/v1/sync', { token, body: { records: 'нет' } })).status, 400);
  c.close();
});

test('синхронизация: время устройства из далёкого будущего ограничивается', async () => {
  const c = ctx();
  const { token } = await registered(c);
  await c.call('POST', '/v1/sync', { token, body: { records: [rec('f', 99_999_999_999_999)] } });
  const r = (await c.call('GET', '/v1/sync?since=0', { token })).body.records[0];
  assert.equal(r.u, c.clock.now() + 24 * 3600 * 1000, 'не дальше суток вперёд');
  c.close();
});

test('смена пароля: нужен старый, остальные сессии закрываются, новый работает, старый нет', async () => {
  const c = ctx();
  const reg = await registered(c);
  const second = (await c.call('POST', '/v1/login', { body: { username: 'владелец', authKey: reg.body.authKey } })).body.token;
  const next = { newAuthKey: authKey(), newAuthSalt: b64(rnd(16)), newAuthIter: 650000, newMeta: meta(true) };
  let r = await c.call('POST', '/v1/password', { token: reg.token, body: { oldAuthKey: authKey(), ...next } });
  assert.equal(r.status, 401, 'неверный старый пароль');
  r = await c.call('POST', '/v1/password', { token: reg.token, body: { oldAuthKey: reg.body.authKey, ...next } });
  assert.equal(r.status, 200);
  assert.equal((await c.call('GET', '/v1/sync?since=0', { token: reg.token })).status, 200, 'текущая сессия жива');
  assert.equal((await c.call('GET', '/v1/sync?since=0', { token: second })).status, 401, 'другие закрыты');
  assert.equal((await c.call('POST', '/v1/login', { body: { username: 'владелец', authKey: reg.body.authKey } })).status, 401, 'старый пароль не работает');
  const l = await c.call('POST', '/v1/login', { body: { username: 'владелец', authKey: next.newAuthKey } });
  assert.equal(l.status, 200); assert.deepEqual(l.body.meta, next.newMeta);
  assert.deepEqual((await c.call('POST', '/v1/login/params', { body: { username: 'владелец' } })).body, { salt: next.newAuthSalt, iter: 650000 });
  c.close();
});

test('восстановление по коду: неверный код, успешный, одноразовый токен, срок токена', async () => {
  const c = ctx();
  const recovery = { authKey: authKey(), salt: b64(rnd(16)), iter: 200000 };
  const reg = await registered(c, { recovery, meta: meta(true) });
  await c.call('POST', '/v1/sync', { token: reg.token, body: { records: [rec('keep', 5)] } });
  assert.deepEqual((await c.call('POST', '/v1/recover/params', { body: { username: 'владелец' } })).body, { salt: recovery.salt, iter: 200000 });
  let r = await c.call('POST', '/v1/recover', { body: { username: 'владелец', recoveryAuthKey: authKey() } });
  assert.equal(r.status, 401);
  r = await c.call('POST', '/v1/recover', { body: { username: 'владелец', recoveryAuthKey: reg.body.authKey } });
  assert.equal(r.status, 401, 'ключ пароля не подходит как ключ восстановления');
  r = await c.call('POST', '/v1/recover', { body: { username: 'владелец', recoveryAuthKey: recovery.authKey } });
  assert.equal(r.status, 200); assert.deepEqual(r.body.meta, reg.body.meta);
  const finish = body => c.call('POST', '/v1/recover/finish', { body });
  const next = { newAuthKey: authKey(), newAuthSalt: b64(rnd(16)), newAuthIter: 600000, newMeta: meta(true) };
  assert.equal((await finish({ resetToken: 'x'.repeat(43), ...next })).status, 401);
  const done = await finish({ resetToken: r.body.resetToken, ...next });
  assert.equal(done.status, 200);
  assert.equal((await finish({ resetToken: r.body.resetToken, ...next })).status, 401, 'токен одноразовый');
  assert.equal((await c.call('GET', '/v1/sync?since=0', { token: reg.token })).status, 401, 'старые сессии закрыты');
  assert.equal((await c.call('GET', '/v1/sync?since=0', { token: done.body.token })).body.records.length, 1, 'данные на месте');
  assert.equal((await c.call('POST', '/v1/login', { body: { username: 'владелец', authKey: next.newAuthKey } })).status, 200);
  // срок токена
  const r2 = await c.call('POST', '/v1/recover', { body: { username: 'владелец', recoveryAuthKey: recovery.authKey } });
  c.clock.advance(11 * 60 * 1000);
  assert.equal((await finish({ resetToken: r2.body.resetToken, ...next })).status, 401, 'токен просрочен');
  c.close();
});

test('восстановление недоступно, если кода не создавали; перебор кода тоже ограничивается', async () => {
  const c = ctx();
  await registered(c);
  const r = await c.call('POST', '/v1/recover', { body: { username: 'владелец', recoveryAuthKey: authKey() } });
  assert.equal(r.status, 401);
  for (let i = 0; i < 5; i++) await c.call('POST', '/v1/recover', { body: { username: 'владелец', recoveryAuthKey: authKey() } });
  assert.equal((await c.call('POST', '/v1/recover', { body: { username: 'владелец', recoveryAuthKey: authKey() } })).status, 429);
  c.close();
});

test('обновление меты и добавление кода восстановления', async () => {
  const c = ctx();
  const reg = await registered(c);
  assert.equal((await c.call('POST', '/v1/meta', { token: reg.token, body: { meta: { v: 7 } } })).status, 400);
  const recovery = { authKey: authKey(), salt: b64(rnd(16)), iter: 200000 };
  const m2 = meta(true);
  assert.equal((await c.call('POST', '/v1/meta', { token: reg.token, body: { meta: m2, recovery } })).status, 200);
  assert.deepEqual((await c.call('GET', '/v1/meta', { token: reg.token })).body.meta, m2);
  assert.equal((await c.call('POST', '/v1/recover', { body: { username: 'владелец', recoveryAuthKey: recovery.authKey } })).status, 200);
  c.close();
});

test('удаление аккаунта: нужен пароль, стирает всё, затем можно зарегистрироваться заново', async () => {
  const c = ctx();
  const reg = await registered(c);
  await c.call('POST', '/v1/sync', { token: reg.token, body: { records: [rec('a', 1)] } });
  assert.equal((await c.call('DELETE', '/v1/account', { token: reg.token, body: { authKey: authKey() } })).status, 401);
  assert.equal(c.store.stats().count, 1);
  assert.equal((await c.call('DELETE', '/v1/account', { token: reg.token, body: { authKey: reg.body.authKey } })).status, 200);
  assert.deepEqual([c.store.stats().count, c.store.getAccount()], [0, null]);
  assert.equal((await c.call('GET', '/v1/sync?since=0', { token: reg.token })).status, 401);
  assert.equal((await c.call('POST', '/v1/register', { body: regBody() })).status, 201);
  assert.equal(c.store.stats().seq, 0, 'журнал начат заново');
  c.close();
});

test('CORS и служебные запросы', async () => {
  const c = ctx();
  let r = await c.call('GET', '/v1/status', { origin: ORIGIN });
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(r.headers.get('vary'), 'Origin');
  r = await c.call('GET', '/v1/status', { origin: 'https://evil.example' });
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'чужой сайт не получает разрешения');
  r = await c.call('OPTIONS', '/v1/sync', { origin: 'https://localhost' });
  assert.equal(r.status, 204);
  assert.match(r.headers.get('access-control-allow-headers'), /authorization/);
  const any = ctx({ ALLOWED_ORIGINS: '*' });
  assert.equal((await any.call('GET', '/v1/status', { origin: 'http://anything:1' })).headers.get('access-control-allow-origin'), 'http://anything:1');
  assert.equal((await c.call('GET', '/v1/нет')).status, 404);
  assert.equal((await c.call('PUT', '/v1/status')).status, 404);
  assert.equal((await c.call('GET', '/')).status, 404);
  c.close(); any.close();
});

test('мусорные запросы никогда не дают 500', async () => {
  const c = ctx();
  const reg = await registered(c);
  const junk = [undefined, '', '{', 'null', '[]', '"x"', '123', '{"records":[{}]}', '{"username":{}}', '{"authKey":[]}', '{"records":null}', JSON.stringify({ username: 1, authKey: 2 }), '\u0000\u0001', 'x'.repeat(5000)];
  const targets = [['POST', '/v1/register'], ['POST', '/v1/login'], ['POST', '/v1/login/params'], ['POST', '/v1/recover'], ['POST', '/v1/recover/params'], ['POST', '/v1/recover/finish'],
    ['POST', '/v1/sync'], ['POST', '/v1/password'], ['POST', '/v1/meta'], ['DELETE', '/v1/account']];
  for (const [m, p] of targets) for (const body of junk) {
    const r = await c.call(m, p, { body, token: p.startsWith('/v1/register') || p.includes('login') || p.includes('recover') ? undefined : reg.token, ip: `5.5.5.${Math.floor(Math.random() * 250)}` });
    assert.ok(r.status >= 200 && r.status < 500, `${m} ${p} ${String(body).slice(0, 20)} → ${r.status}`);
  }
  const big = await c.call('POST', '/v1/sync', { token: reg.token, body: 'x'.repeat(3 * 1024 * 1024 + 10) });
  assert.equal(big.status, 413);
  assert.equal(c.store.stats().count, 0);
  assert.ok(c.store.getAccount(), 'аккаунт цел');
  c.close();
});

test('имя пользователя нормализуется', () => {
  assert.equal(normalizeUsername('  ÉÉ  '), 'éé');
  assert.equal(normalizeUsername('ＡＢＣ'), 'abc');
});

test('настоящий HTTP-сервер: регистрация, синхронизация и CORS через сокет', async () => {
  const { server, close } = createServer({ env: { ALLOWED_ORIGINS: ORIGIN } });
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const reg = await post('/v1/register', regBody());
  assert.equal(reg.status, 201);
  assert.equal(reg.headers.get('access-control-allow-origin'), ORIGIN);
  const { token } = await reg.json();
  const push = await post('/v1/sync', { records: [rec('net', 1)] }, token);
  assert.equal((await push.json()).accepted, 1);
  const pull = await (await fetch(`${base}/v1/sync?since=0`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(pull.records[0].id, 'net');
  assert.equal((await fetch(base + '/v1/sync', { method: 'OPTIONS', headers: { origin: ORIGIN } })).status, 204);
  close();
});

test('код восстановления остаётся рабочим после смены пароля и после самого восстановления', async () => {
  const c = ctx();
  const recovery = { authKey: authKey(), salt: b64(rnd(16)), iter: 200000 };
  const reg = await registered(c, { recovery, meta: meta(true) });
  const next = () => ({ newAuthKey: authKey(), newAuthSalt: b64(rnd(16)), newAuthIter: 600000, newMeta: meta(true) });
  let cur = reg.body.authKey;
  for (let i = 0; i < 2; i++) {                                    // две смены пароля подряд
    const n = next();
    assert.equal((await c.call('POST', '/v1/password', { token: reg.token, body: { oldAuthKey: cur, ...n } })).status, 200);
    cur = n.newAuthKey;
    reg.token = (await c.call('POST', '/v1/login', { body: { username: 'владелец', authKey: cur } })).body.token;
  }
  const r = await c.call('POST', '/v1/recover', { body: { username: 'владелец', recoveryAuthKey: recovery.authKey } });
  assert.equal(r.status, 200, 'код восстановления работает после смен пароля');
  assert.equal((await c.call('POST', '/v1/recover/finish', { body: { resetToken: r.body.resetToken, ...next() } })).status, 200);
  assert.equal((await c.call('POST', '/v1/recover', { body: { username: 'владелец', recoveryAuthKey: recovery.authKey } })).status, 200, 'и после восстановления');
  c.close();
});

// ---------- R4.0: безопасность сервера ----------
test('заголовки безопасности есть у любого ответа, ошибки не раскрывают внутренности', async () => {
  const c = ctx();
  for (const r of [await c.call('GET', '/v1/status'), await c.call('GET', '/v1/нет'), await c.call('POST', '/v1/login', { body: '{' })]) {
    assert.match(r.headers.get('strict-transport-security'), /max-age=\d+/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  const broken = { getAccount() { throw new Error('секретный-путь /var/db/lifeos.sqlite'); } };
  const orig = console.error; console.error = () => {};
  try {
    const res = await handle(new Request('https://sync.test/v1/status'), broken, {}, 1);
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: 'server_error' });
    assert.ok(!/секретный|sqlite|Error/.test(text), 'в ответе нет подробностей сбоя');
  } finally { console.error = orig; }
  c.close();
});

test('«обманные» параметры входа неотличимы от настоящих: длина соли, число итераций, смена вместе с настоящими', async () => {
  const c = ctx();
  const recovery = { authKey: authKey(), salt: b64(rnd(16)), iter: 200000 };
  const reg = await registered(c, { authIter: 650000, recovery, meta: meta(true) });
  const params = async (p, u) => (await c.call('POST', p, { body: { username: u } })).body;
  const realL = await params('/v1/login/params', 'владелец'), fakeL = await params('/v1/login/params', 'чужой');
  assert.deepEqual([realL.iter, fakeL.iter, fakeL.salt.length], [650000, 650000, realL.salt.length], 'то же число итераций и та же длина соли');
  const realR = await params('/v1/recover/params', 'владелец'), fakeR = await params('/v1/recover/params', 'чужой');
  assert.deepEqual([realR.iter, fakeR.iter, fakeR.salt.length], [200000, 200000, realR.salt.length], 'и для кода восстановления');
  assert.notEqual(fakeR.salt, fakeL.salt);
  // у настоящего пользователя после смены пароля новая соль; у «обманных» тоже: постоянство не выдаёт настоящий логин
  const before = fakeL.salt;
  const next = { newAuthKey: authKey(), newAuthSalt: b64(rnd(16)), newAuthIter: 650000, newMeta: meta(true) };
  assert.equal((await c.call('POST', '/v1/password', { token: reg.token, body: { oldAuthKey: reg.body.authKey, ...next } })).status, 200);
  const after = (await params('/v1/login/params', 'чужой')).salt;
  assert.notEqual(after, before);
  assert.equal((await params('/v1/login/params', 'чужой')).salt, after, 'между сменами значение постоянно');
  assert.equal((await params('/v1/login/params', 'владелец')).salt, next.newAuthSalt);
  c.close();
});

test('код установки: подбор ограничен паузой, на занятом сервере ответ не зависит от кода', async () => {
  const c = ctx({ SETUP_CODE: 'секрет-123' });
  for (let i = 0; i < 5; i++) assert.equal((await c.call('POST', '/v1/register', { body: regBody({ setupCode: 'не-тот' + i }) })).status, 403);
  const locked = await c.call('POST', '/v1/register', { body: regBody({ setupCode: 'секрет-123' }) });
  assert.deepEqual([locked.status, locked.body.error], [429, 'locked'], 'даже верный код ждёт');
  c.clock.advance(2000);
  assert.equal((await c.call('POST', '/v1/register', { body: regBody({ setupCode: 'секрет-123' }) })).status, 201);
  const a = await c.call('POST', '/v1/register', { ip: '3.3.3.3', body: regBody({ setupCode: 'секрет-123' }) });
  const b = await c.call('POST', '/v1/register', { ip: '3.3.3.3', body: regBody({ setupCode: 'неверный' }) });
  assert.deepEqual([a.status, a.body, b.status, b.body], [409, { error: 'account_exists' }, 409, { error: 'account_exists' }], 'по ответу код не угадать');
  c.close();
});

test('размеры: вход и служебные запросы до 64 КБ, синхронизация до 3 МБ; поток без Content-Length тоже обрывается', async () => {
  const c = ctx();
  const reg = await registered(c);
  const bigLogin = JSON.stringify({ username: 'x'.repeat(70 * 1024), authKey: authKey() });
  assert.equal((await c.call('POST', '/v1/login', { body: bigLogin })).status, 413);
  assert.equal((await c.call('POST', '/v1/login/params', { body: bigLogin })).status, 413);
  assert.equal((await c.call('POST', '/v1/recover', { body: bigLogin })).status, 413);
  const ok = await c.call('POST', '/v1/sync', { token: reg.token, body: { records: Array.from({ length: 4 }, (_, i) => rec('big' + i, 5, { ct: Buffer.alloc(190 * 1024, 1).toString('base64') })) } });
  assert.deepEqual([ok.status, ok.body.accepted], [200, 4], 'крупная пачка записей проходит');
  const stream = new ReadableStream({ start(ctrl) { for (let i = 0; i < 100; i++) ctrl.enqueue(new TextEncoder().encode('x'.repeat(1024))); ctrl.close(); } });
  const res = await handle(new Request('https://sync.test/v1/login', { method: 'POST', body: stream, duplex: 'half', headers: { 'x-forwarded-for': '1.2.3.4' } }), c.store, {}, c.clock.now());
  assert.equal(res.status, 413, 'потоковое тело без длины остановлено на лимите');
  c.close();
});

test('сессия живёт не дольше 180 дней, даже если ею пользуются', async () => {
  const c = ctx();
  const reg = await registered(c);
  for (let day = 20; day <= 160; day += 20) {
    c.clock.advance(20 * 24 * 3600 * 1000);
    assert.equal((await c.call('GET', '/v1/sync?since=0', { token: reg.token })).status, 200, `день ${day}`);
  }
  c.clock.advance(25 * 24 * 3600 * 1000);
  assert.equal((await c.call('GET', '/v1/sync?since=0', { token: reg.token })).status, 401, 'на 185-й день токен перестал работать');
  assert.equal((await c.call('POST', '/v1/login', { body: { username: 'владелец', authKey: reg.body.authKey } })).status, 200, 'новый вход работает');
  c.close();
});

test('адрес клиента для защиты от подбора: присланные клиентом заголовки подделать адрес не дают', async () => {
  const { clientIp } = await import('../server/node/server.js');
  const req = h => ({ headers: h, socket: { remoteAddress: '10.0.0.5' } });
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6' }), false), '10.0.0.5');
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }), true), '7.7.7.7', 'за доверенным прокси берётся последний адрес цепочки');
  assert.equal(clientIp(req({}), true), '10.0.0.5');
  const { server, close } = createServer({ env: {} });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  assert.deepEqual([server.requestTimeout, server.headersTimeout], [30000, 15000]);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, ip) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
  assert.equal((await post('/v1/register', regBody(), '1.1.1.1')).status, 201);
  let last;
  for (let i = 0; i < 6; i++) last = await post('/v1/login', { username: 'владелец', authKey: authKey() }, `9.9.9.${i}`);
  assert.equal(last.status, 429, 'каждый раз «новый» адрес в заголовке, а сокет один: пауза действует');
  close();
});

test('Cloudflare Worker: посторонние адреса отсекаются до базы, сбой объекта не показывает подробностей', async () => {
  const { edgeReply } = await import('../server/core.js');
  const r = edgeReply(new Request('https://x.test/', { headers: { origin: ORIGIN } }), {}, 404, 'not_found');
  assert.deepEqual([r.status, await r.json(), r.headers.get('access-control-allow-origin'), r.headers.get('x-content-type-options')], [404, { error: 'not_found' }, ORIGIN, 'nosniff']);
  const w = (await import('node:fs')).readFileSync(new URL('../server/cloudflare/worker.js', import.meta.url), 'utf8');
  assert.match(w, /startsWith\('\/v1\/'\)/); assert.match(w, /catch \{[\s\S]*503/);
  const ig = (await import('node:fs')).readFileSync(new URL('../server/cloudflare/.gitignore', import.meta.url), 'utf8');
  assert.match(ig, /^\.wrangler\/$/m, 'локальное состояние wrangler не попадает в репозиторий');
});
