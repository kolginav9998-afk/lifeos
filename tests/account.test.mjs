// Аккаунт целиком: регистрация, вход на втором устройстве, смена пароля, восстановление, выход — с настоящим серверным кодом.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../api.js';
import { createAccountService, describeError, normalizeUsername } from '../account.js';
import * as vault from '../vault.js';
import { handle } from '../server/core.js';
import { openStore } from '../server/node/server.js';

const SERVER = 'https://sync.test';
const FAST = { iterations: 2000 };
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };

function world(env = {}) {
  const { store, close } = openStore(':memory:');
  let T = 1_800_000_000_000;
  const w = { store, close, now: () => T, advance: ms => { T += ms; } };
  w.api = createApi({ fetchImpl: async (url, init) => {
    const u = new URL(url);
    return handle(new Request(SERVER + u.pathname + u.search, { method: init.method, headers: { ...init.headers, 'x-forwarded-for': w.ip ?? '2.2.2.2' }, body: init.body }), store, env, T);
  } });
  return w;
}
// «Устройство»: своё хранилище + своя служба; перед действиями нужно сделать его активным (vault — один на процесс).
function device(w) {
  const storage = mem();
  const svc = createAccountService({ api: w.api, storage, now: w.now, authIter: 2000, deps: { enableLock: pw => vault.create(pw, FAST) } });
  return { storage, svc, use() { vault.useStorage(storage); } };
}
const PW = 'длинная-надёжная-фраза';
const ev = (id, text) => ({ id, type: 'task', ts: 1, payload: { text }, u: 1 });

test('регистрация на устройстве без защиты: включает защиту, создаёт код восстановления, запоминает сессию', async () => {
  const w = world(); const A = device(w); A.use();
  assert.equal(vault.status(), 'none');
  const r = await A.svc.register({ server: SERVER + '/', username: ' Владелец ', password: PW });
  assert.match(r.recoveryCode, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/);
  assert.equal(vault.status(), 'unlocked');
  assert.ok(vault.getMeta().rec, 'код восстановления записан в мету');
  assert.deepEqual([A.svc.info().server, A.svc.info().username], [SERVER, 'владелец']);
  assert.ok(A.svc.token()); assert.ok(A.storage.getItem('lifeos.account.sess'));
  assert.ok(!A.storage.getItem('lifeos.account.sess').includes(A.svc.token()), 'токен на диске только зашифрованным');
  assert.equal((await A.svc.checkServer(SERVER)).registered, true);
  w.close();
});

test('регистрация: слабый пароль, плохое имя, неверный пароль защиты — ничего не создаётся; второй аккаунт нельзя', async () => {
  const w = world(); const A = device(w); A.use();
  await assert.rejects(A.svc.register({ server: SERVER, username: 'владелец', password: 'коротк' }), /не короче/);
  await assert.rejects(A.svc.register({ server: SERVER, username: 'ab', password: PW }), e => e instanceof ApiError && e.code === 'bad_username');
  await assert.rejects(A.svc.register({ server: 'http://evil.example', username: 'владелец', password: PW }), /https/);
  assert.equal((await A.svc.checkServer(SERVER)).registered, false);
  assert.equal(vault.status(), 'none', 'неудачные попытки защиту не включили');
  await A.svc.register({ server: SERVER, username: 'владелец', password: PW });
  const B = device(w); B.use();
  await assert.rejects(B.svc.register({ server: SERVER, username: 'другой', password: PW }), e => e.code === 'account_exists');
  assert.equal(describeError(new ApiError(409, 'account_exists')), 'На этом сервере аккаунт уже создан. Войди в него.');
  // устройство с защитой: пароль должен совпадать
  A.use(); const C = device(w); C.use(); await vault.create('другой-пароль-12', FAST);
  await assert.rejects(C.svc.register({ server: SERVER, username: 'третий', password: PW }), vault.WrongPasswordError);
  w.close();
});

test('вход на втором устройстве: тот же пароль даёт тот же ключ — данные первого читаются', async () => {
  const w = world(); const A = device(w); A.use();
  await A.svc.register({ server: SERVER, username: 'владелец', password: PW });
  const sealed = await vault.seal(ev('t1', 'секрет с первого'));
  const B = device(w); B.use();
  const auth = await B.svc.authenticate({ server: SERVER, username: 'ВЛАДЕЛЕЦ', password: PW });
  assert.ok(auth.token && auth.meta.rec);
  assert.equal(await B.svc.compatibility(auth, PW, null), 'empty');
  assert.equal(await B.svc.compatibility(auth, PW, sealed), 'same');
  await B.svc.link(auth, PW);
  assert.equal(vault.status(), 'unlocked');
  assert.deepEqual(await vault.open(sealed), ev('t1', 'секрет с первого'));
  assert.equal(B.svc.info().username, 'владелец');
  vault.lock(); await vault.unlock(PW);
  assert.ok(await B.svc.loadSession(), 'сессия пережила блокировку');
  w.close();
});

test('вход: неверный пароль и чужое имя неотличимы; пауза после серии попыток; другой аккаунт даёт «другие данные»', async () => {
  const w = world(); const A = device(w); A.use();
  await A.svc.register({ server: SERVER, username: 'владелец', password: PW });
  const sealed = await vault.seal(ev('x', 'данные A'));
  const B = device(w); B.use();
  const bad1 = await B.svc.authenticate({ server: SERVER, username: 'владелец', password: 'неверный-пароль-1' }).catch(e => e);
  const bad2 = await B.svc.authenticate({ server: SERVER, username: 'нет-такого', password: PW }).catch(e => e);
  assert.deepEqual([bad1.status, bad1.code, bad2.status, bad2.code], [401, 'bad_credentials', 401, 'bad_credentials']);
  assert.equal(describeError(bad1), 'Неверное имя или пароль');
  for (let i = 0; i < 4; i++) await B.svc.authenticate({ server: SERVER, username: 'владелец', password: 'неверный-пароль-1' }).catch(() => {});
  const locked = await B.svc.authenticate({ server: SERVER, username: 'владелец', password: PW }).catch(e => e);
  assert.equal(locked.status, 429); assert.match(describeError(locked), /Подожди/);
  w.advance(2000);
  const auth = await B.svc.authenticate({ server: SERVER, username: 'владелец', password: PW });
  // у устройства уже есть свои зашифрованные данные другим ключом
  vault.useStorage(mem()); await vault.create('локальный-пароль-1', FAST);
  const foreign = await vault.seal(ev('f', 'чужой ключ'));
  assert.equal(await B.svc.compatibility(auth, PW, foreign), 'different');
  assert.equal(await B.svc.compatibility(auth, PW, sealed), 'same');
  w.close();
});

test('смена пароля: сервер и устройство обновляются вместе; другие устройства выходят; старый пароль не работает; данные те же', async () => {
  const w = world(); const A = device(w); A.use();
  await A.svc.register({ server: SERVER, username: 'владелец', password: PW });
  const sealed = await vault.seal(ev('k', 'не потеряй'));
  const B = device(w); B.use();
  await B.svc.link(await B.svc.authenticate({ server: SERVER, username: 'владелец', password: PW }), PW);
  A.use();
  await assert.rejects(A.svc.changePassword({ oldPassword: 'не-тот-пароль-1', newPassword: 'новый-пароль-22' }), vault.WrongPasswordError);
  await assert.rejects(A.svc.changePassword({ oldPassword: PW, newPassword: 'коротк' }), /не короче/);
  await A.svc.changePassword({ oldPassword: PW, newPassword: 'новый-пароль-22' });
  vault.lock();
  await assert.rejects(vault.unlock(PW), vault.WrongPasswordError);
  await vault.unlock('новый-пароль-22');
  assert.deepEqual(await vault.open(sealed), ev('k', 'не потеряй'), 'данные читаются прежним ключом');
  await A.svc.loadSession();
  assert.ok(A.svc.token(), 'сессия этого устройства жива');
  B.use(); await B.svc.loadSession();
  const probe = await w.api.pull(SERVER, B.svc.token(), 0).catch(e => e);
  assert.equal(probe.status, 401, 'сессия второго устройства закрыта');
  const again = await B.svc.authenticate({ server: SERVER, username: 'владелец', password: 'новый-пароль-22' });
  assert.ok(again.token);
  assert.equal((await B.svc.authenticate({ server: SERVER, username: 'владелец', password: PW }).catch(e => e)).status, 401);
  w.close();
});

test('забыл пароль: восстановление по коду на новом устройстве, данные читаются, сессии старые закрыты, код остаётся рабочим', async () => {
  const w = world(); const A = device(w); A.use();
  const { recoveryCode } = await A.svc.register({ server: SERVER, username: 'владелец', password: PW });
  const sealed = await vault.seal(ev('r', 'после восстановления'));
  const oldToken = A.svc.token();
  const B = device(w); B.use();
  await assert.rejects(B.svc.recover({ server: SERVER, username: 'владелец', code: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', newPassword: 'новый-пароль-22' }), e => e.status === 401);
  await assert.rejects(B.svc.recover({ server: SERVER, username: 'владелец', code: 'нет', newPassword: 'новый-пароль-22' }), vault.WrongRecoveryCodeError);
  await assert.rejects(B.svc.recover({ server: SERVER, username: 'владелец', code: recoveryCode, newPassword: 'коротк' }), /не короче/);
  await B.svc.recover({ server: SERVER, username: 'владелец', code: recoveryCode.toLowerCase(), newPassword: 'новый-пароль-22' });
  assert.deepEqual(await vault.open(sealed), ev('r', 'после восстановления'));
  assert.equal((await w.api.pull(SERVER, oldToken, 0).catch(e => e)).status, 401, 'старые сессии закрыты');
  assert.ok((await B.svc.authenticate({ server: SERVER, username: 'владелец', password: 'новый-пароль-22' })).token);
  assert.equal((await B.svc.authenticate({ server: SERVER, username: 'владелец', password: PW }).catch(e => e)).status, 401, 'старый пароль не работает');
  const again = await B.svc.recover({ server: SERVER, username: 'владелец', code: recoveryCode, newPassword: 'третий-пароль-333' });
  assert.equal(again.ok, true, 'код можно использовать повторно');
  w.close();
});

test('код восстановления для устройства, созданного без него: создаётся позже и работает; повторное создание отменяет прежний', async () => {
  const w = world(); const A = device(w); A.use();
  await vault.create(PW, FAST);                                  // защита уже была, кода нет
  const reg = await A.svc.register({ server: SERVER, username: 'владелец', password: PW });
  assert.ok(reg.recoveryCode, 'при регистрации код создаётся, если его не было');
  const code2 = await A.svc.createRecoveryCode(PW);
  assert.notEqual(code2, reg.recoveryCode);
  const B = device(w); B.use();
  await assert.rejects(B.svc.recover({ server: SERVER, username: 'владелец', code: reg.recoveryCode, newPassword: 'новый-пароль-22' }), e => e.status === 401, 'прежний код больше не подходит');
  await B.svc.recover({ server: SERVER, username: 'владелец', code: code2, newPassword: 'новый-пароль-22' });
  w.close();
});

test('выход: сессия закрыта на сервере и забыта локально, защита и данные остаются; удаление аккаунта стирает сервер', async () => {
  const w = world(); const A = device(w); A.use();
  await A.svc.register({ server: SERVER, username: 'владелец', password: PW });
  const t = A.svc.token();
  await A.svc.logout();
  assert.equal(A.svc.isLinked(), false); assert.equal(A.svc.token(), null);
  assert.equal((await w.api.pull(SERVER, t, 0).catch(e => e)).status, 401);
  assert.equal(vault.status(), 'unlocked', 'локальная защита осталась');
  await A.svc.link(await A.svc.authenticate({ server: SERVER, username: 'владелец', password: PW }), PW);
  await assert.rejects(A.svc.deleteServerAccount('не-тот-пароль-1'), e => e.status === 401);
  assert.equal((await A.svc.checkServer(SERVER)).registered, true);
  await A.svc.deleteServerAccount(PW);
  assert.equal((await A.svc.checkServer(SERVER)).registered, false);
  assert.equal(A.svc.isLinked(), false);
  w.close();
});

test('логин нормализуется одинаково на клиенте и сервере', () => {
  assert.equal(normalizeUsername('  ВЛАДЕЛЕЦ  '), 'владелец');
  assert.equal(normalizeUsername('ＡＢＣ'), 'abc');
});

test('сервер не LifeOS: понятная ошибка', async () => {
  const api = createApi({ fetchImpl: async () => new Response(JSON.stringify({ hello: 'world' }), { status: 200 }) });
  const svc = createAccountService({ api, storage: mem() });
  await assert.rejects(svc.checkServer('https://example.com'), e => e.code === 'not_lifeos');
});
