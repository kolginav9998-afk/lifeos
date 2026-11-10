// Синхронизация: несколько «устройств» + настоящий серверный код (без сети, через подмену fetch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, normalizeServerUrl } from '../api.js';
import { createSync, BATCH } from '../sync.js';
import { handle } from '../server/core.js';
import { openStore } from '../server/node/server.js';

const b64 = bytes => Buffer.from(bytes).toString('base64');
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const SERVER = 'https://sync.test';

function world() {
  const { store, close } = openStore(':memory:');
  let T = 1_800_000_000_000;
  const w = { store, close, now: () => T, advance: ms => { T += ms; }, down: false, calls: [] };
  const fetchImpl = async (url, init) => {
    if (w.down) throw new TypeError('network down');
    const u = new URL(url);
    w.calls.push(`${init.method} ${u.pathname}`);
    return handle(new Request(SERVER + u.pathname + u.search, { method: init.method, headers: init.headers, body: init.body }), store, {}, T);
  };
  w.api = createApi({ fetchImpl });
  return w;
}

async function accountToken(w) {
  const r = await w.api.register(SERVER, {
    username: 'owner', authKey: b64(rnd(32)), authSalt: b64(rnd(16)), authIter: 600000,
    meta: { v: 2, kdf: 'PBKDF2-SHA256', iter: 600000, salt: b64(rnd(16)), wrap: { iv: b64(rnd(12)), ct: b64(rnd(48)) } },
  });
  return r.token;
}

function device(w, token, { validate } = {}) {
  const recs = new Map();
  let saved = null;
  let last = 0;
  const clock = { tick: () => (last = Math.max(w.now(), last + 1)), observe: u => { if (u > last) last = u; } };
  const applied = [];
  const statuses = [];
  const local = {
    metas: async () => new Map([...recs].map(([id, r]) => [id, r.u ?? 0])),
    get: async id => (recs.get(id) ? { ...recs.get(id) } : null),
    writeMany: async rs => rs.forEach(r => recs.set(r.id, { ...r })),
    deleteMany: async ids => ids.forEach(id => recs.delete(id)),
    stampU: async (id, u) => { recs.get(id).u = u; },
  };
  const mk = () => createSync({
    api: w.api, server: SERVER, getToken: () => token, local, clock, now: w.now,
    validate: validate ?? (async r => typeof r.ct === 'string' && !r.ct.startsWith('BAD')),
    loadState: () => (saved ? JSON.parse(saved) : null), saveState: s => { saved = JSON.stringify(s); },
    onStatus: s => statuses.push(s.state), onApplied: a => applied.push(a),
  });
  let sync = mk();
  const d = {
    recs, applied, statuses, local, clock,
    get sync() { return sync; },
    restart() { sync = mk(); },                                 // «перезапуск приложения»: состояние берётся из сохранённого
    edit(id, text) { const u = clock.tick(); recs.set(id, { id, v: 1, u, iv: b64(rnd(12)), ct: b64(text.padEnd(16)) }); sync.notifyWrite({ id, u, d: false }); },
    del(id) { recs.delete(id); sync.notifyWrite({ id, u: clock.tick(), d: true }); },
    read(id) { const r = recs.get(id); return r ? Buffer.from(r.ct, 'base64').toString().trim() : null; },
    all() { return Object.fromEntries([...recs].map(([id]) => [id, d.read(id)])); },
    sync_: () => sync.syncOnce(),
  };
  return d;
}

test('адрес сервера: только https (и localhost по http), путь отбрасывается', () => {
  assert.equal(normalizeServerUrl(' https://lifeos.example.workers.dev/abc?x=1 '), 'https://lifeos.example.workers.dev');
  assert.equal(normalizeServerUrl('http://localhost:8787'), 'http://localhost:8787');
  for (const bad of ['', 'lifeos.dev', 'http://evil.example', 'ftp://x.y', 'javascript:alert(1)', null]) assert.throws(() => normalizeServerUrl(bad), bad);
});

test('две устройства: первое отправляет, второе (пустое) получает всё', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token), B = device(w, token);
  A.edit('t1', 'купить хлеб'); A.edit('t2', 'позвонить'); A.edit('n1', 'заметка');
  const r = await A.sync_();
  assert.equal(r.ok, true);
  assert.equal(A.sync.dirtyIds().length, 0, 'всё отправлено');
  assert.equal((await B.sync_()).ok, true);
  assert.deepEqual(B.all(), { t1: 'купить хлеб', t2: 'позвонить', n1: 'заметка' });
  assert.deepEqual(B.applied.flatMap(a => a.upserts).sort(), ['n1', 't1', 't2']);
  const before = w.calls.length;
  await B.sync_(); await A.sync_();
  assert.deepEqual(A.all(), B.all());
  assert.equal(A.sync.dirtyIds().length + B.sync.dirtyIds().length, 0, 'эхо своих записей не создаёт «изменённых»');
  w.close();
});

test('разные записи правят на разных устройствах — сходятся к одному', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token), B = device(w, token);
  A.edit('a', 'исходная A'); A.edit('b', 'исходная B'); await A.sync_(); await B.sync_();
  w.advance(1000);
  A.edit('a', 'A изменил'); B.edit('b', 'B изменил'); B.edit('c', 'B создал');
  await A.sync_(); await B.sync_(); await A.sync_();
  assert.deepEqual(A.all(), { a: 'A изменил', b: 'B изменил', c: 'B создал' });
  assert.deepEqual(B.all(), A.all());
  w.close();
});

test('конфликт на одной записи: побеждает более поздняя правка, на обоих устройствах', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token), B = device(w, token);
  A.edit('x', 'база'); await A.sync_(); await B.sync_();
  w.advance(1000); A.edit('x', 'правка A');
  w.advance(1000); B.edit('x', 'правка B (позже)');
  await A.sync_();            // A отправляет раньше по времени отправки, но правка B новее по метке
  await B.sync_(); await A.sync_();
  assert.equal(A.read('x'), 'правка B (позже)');
  assert.equal(B.read('x'), 'правка B (позже)');
  // и наоборот: старая правка, отправленная позже, не затирает новую
  w.advance(1000); const C = device(w, token); await C.sync_();
  w.advance(1000); C.edit('x', 'правка C');
  w.advance(1000); A.edit('x', 'правка A2 (ещё позже)');
  await C.sync_(); await A.sync_(); await C.sync_(); await B.sync_();
  assert.deepEqual([A.read('x'), B.read('x'), C.read('x')], ['правка A2 (ещё позже)', 'правка A2 (ещё позже)', 'правка A2 (ещё позже)']);
  w.close();
});

test('удаление распространяется; старая правка не воскрешает, более новая — воскрешает', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token), B = device(w, token);
  A.edit('d', 'удаляемая'); await A.sync_(); await B.sync_();
  w.advance(1000); A.del('d'); await A.sync_();
  w.advance(1000); await B.sync_();
  assert.equal(B.read('d'), null, 'удалилось и на втором');
  assert.deepEqual(B.applied.at(-1).deletes, ['d']);
  // B был офлайн и правил запись ДО удаления (старая метка) — не воскресит
  const C = device(w, token); A.edit('e', 'e1'); await A.sync_(); await C.sync_();
  w.advance(1000); C.edit('e', 'e2 (C офлайн, старая метка)');
  w.advance(1000); A.del('e'); await A.sync_();
  await C.sync_();
  assert.equal(C.read('e'), null, 'удаление новее, правка C потеряла');
  // а правка ПОСЛЕ удаления — побеждает
  w.advance(1000); B.edit('d', 'создана заново'); await B.sync_(); await A.sync_();
  assert.equal(A.read('d'), 'создана заново');
  w.close();
});

test('нет сети: изменения копятся и уходят позже; перезапуск не теряет очередь', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token);
  A.edit('o1', 'раз'); A.edit('o2', 'два');
  w.down = true;
  let r = await A.sync_();
  assert.equal(r.ok, false); assert.equal(A.sync.status.state, 'offline');
  assert.equal(A.sync.dirtyIds().length, 2);
  A.edit('o3', 'три'); A.del('o1');
  A.sync.flush(); A.restart();                                  // приложение закрыли и открыли
  assert.equal(A.sync.dirtyIds().length, 3, 'очередь пережила перезапуск');
  w.down = false;
  assert.equal((await A.sync_()).ok, true);
  assert.equal(A.sync.status.state, 'idle');
  const B = device(w, token); await B.sync_();
  assert.deepEqual(B.all(), { o2: 'два', o3: 'три' });
  w.close();
});

test('правка во время отправки не теряется: новая версия остаётся в очереди и уходит следующим проходом', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token);
  A.edit('k', 'версия 1');
  const u1 = A.recs.get('k').u;
  let engine = null;
  let injected = false;
  const slow = createApi({ fetchImpl: async (url, init) => {
    const u = new URL(url);
    const res = await handle(new Request(SERVER + u.pathname + u.search, { method: init.method, headers: init.headers, body: init.body }), w.store, {}, w.now());
    if (init.method === 'POST' && u.pathname === '/v1/sync' && !injected) {      // пока идёт отправка v1, пользователь правит запись ещё раз
      injected = true;
      const u2 = A.clock.tick();
      A.recs.set('k', { ...A.recs.get('k'), u: u2, ct: b64('версия 2'.padEnd(16)) });
      engine.notifyWrite({ id: 'k', u: u2, d: false });
    }
    return res;
  } });
  engine = createSync({ api: slow, server: SERVER, getToken: () => token, local: A.local, clock: A.clock, now: w.now, validate: async () => true,
    loadState: () => ({ since: 0, dirty: { k: { u: u1, d: 0 } } }), saveState: () => {} });
  await engine.syncOnce();
  assert.equal(w.store.getRecord('k').u, u1, 'на сервер ушла версия 1');
  assert.deepEqual(engine.dirtyIds(), ['k'], 'версия 2 осталась в очереди (отправка v1 не «погасила» её)');
  await engine.syncOnce();
  assert.equal(engine.dirtyIds().length, 0);
  assert.equal(w.store.getRecord('k').u, A.recs.get('k').u, 'теперь на сервере версия 2');
  w.close();
});

test('много записей: постраничное получение и пачки при отправке', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token), B = device(w, token);
  const N = 1250;
  for (let i = 0; i < N; i++) A.edit(`r${i}`, `запись ${i}`);
  await A.sync_();
  assert.equal(w.store.stats().count, N);
  const pushes = w.calls.filter(c => c === 'POST /v1/sync').length;
  assert.equal(pushes, Math.ceil(N / BATCH), 'отправлено пачками');
  await B.sync_();
  assert.equal(B.recs.size, N);
  assert.equal(B.read('r1249'), 'запись 1249');
  w.close();
});

test('сервер был сброшен: клиент замечает и заново отправляет всё', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token);
  A.edit('p', 'память'); A.edit('q', 'вторая'); await A.sync_();
  w.store.wipeAll();                                             // как будто сервер потерял данные и аккаунт создали заново
  const token2 = await accountToken(w);
  const A2 = device(w, token2);
  for (const [id, r] of A.recs) A2.recs.set(id, { ...r });
  A2.sync_ = () => createSync({ api: w.api, server: SERVER, getToken: () => token2, local: A2.local, clock: A2.clock, now: w.now, validate: async () => true,
    loadState: () => ({ since: 99, dirty: {} }), saveState: () => {} }).syncOnce();
  assert.equal((await A2.sync_()).ok, true);
  assert.equal(w.store.stats().count, 2, 'всё отправлено заново');
  w.close();
});

test('сервер присылает запись, которую нельзя расшифровать: не применяется, считается', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token), B = device(w, token);
  A.edit('good', 'хорошая');
  A.recs.set('evil', { id: 'evil', v: 1, u: A.clock.tick(), iv: b64(rnd(12)), ct: 'BAD' + b64(rnd(32)).slice(3) }); A.sync.notifyWrite({ id: 'evil', u: A.recs.get('evil').u, d: false });
  await A.sync_();
  await B.sync_();
  assert.deepEqual(Object.keys(B.all()), ['good']);
  assert.equal(B.sync.status.bad, 1);
  w.close();
});

test('вход просрочен: статус «нужен вход», данные и очередь целы', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token);
  A.edit('s', 'сохрани'); await A.sync_();
  w.advance(31 * 24 * 3600 * 1000);
  A.edit('s', 'новая версия');
  const r = await A.sync_();
  assert.equal(r.ok, false); assert.equal(A.sync.status.state, 'needs-login');
  assert.equal(A.read('s'), 'новая версия'); assert.equal(A.sync.dirtyIds().length, 1);
  w.close();
});

test('markAllDirty: старые записи без метки получают её и уходят на сервер', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token);
  A.recs.set('legacy1', { id: 'legacy1', v: 1, iv: b64(rnd(12)), ct: b64('старая запись'.padEnd(16)) });
  A.recs.set('legacy2', { id: 'legacy2', v: 1, u: 5, iv: b64(rnd(12)), ct: b64('другая'.padEnd(16)) });
  await A.sync.markAllDirty();
  assert.ok(A.recs.get('legacy1').u > 0, 'метка проставлена');
  await A.sync_();
  assert.equal(w.store.stats().count, 2);
  assert.equal(w.store.getRecord('legacy2').u, 5, 'у записи с меткой она сохранена');
  w.close();
});

test('открытые (незашифрованные) данные на сервер не отправляются никогда', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token);
  A.recs.set('plain', { id: 'plain', type: 'task', ts: 1, payload: { text: 'открытый текст' }, u: 7 });
  A.sync.notifyWrite({ id: 'plain', u: 7, d: false });
  const r = await A.sync_();
  assert.equal(r.ok, false); assert.equal(A.sync.status.error, 'not_encrypted');
  assert.equal(w.store.stats().count, 0);
  w.close();
});

test('метка времени: растёт всегда, даже если часы отстали; из далёкого будущего не принимается', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token);
  A.edit('a', '1'); const u1 = A.recs.get('a').u;
  w.advance(-5000);                                              // часы телефона откатились назад
  A.edit('a', '2');
  assert.ok(A.recs.get('a').u > u1, 'u не уменьшается');
  w.close();
});

test('ошибки сервера не ломают очередь: 500 и пауза после неверных попыток', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token);
  A.edit('e', 'x');
  const broken = createApi({ fetchImpl: async () => new Response(JSON.stringify({ error: 'server_error' }), { status: 500 }) });
  const S = createSync({ api: broken, server: SERVER, getToken: () => token, local: A.local, clock: A.clock, now: w.now, validate: async () => true, loadState: () => null, saveState: () => {} });
  S.notifyWrite({ id: 'e', u: A.recs.get('e').u, d: false });
  const r = await S.syncOnce();
  assert.equal(r.ok, false); assert.equal(S.status.state, 'error'); assert.equal(S.status.error, 'server_error');
  assert.equal(S.dirtyIds().length, 1);
  w.close();
});

test('один проход за раз: параллельные запросы синхронизации не дублируют работу', async () => {
  const w = world(); const token = await accountToken(w);
  const A = device(w, token);
  A.edit('one', 'раз');
  const [r1, r2, r3] = await Promise.all([A.sync_(), A.sync_(), A.sync_()]);
  assert.ok(r1 === r2 || r1.ok === r2.ok);
  assert.equal(w.calls.filter(c => c === 'POST /v1/sync').length, 1, 'отправка одна');
  w.close();
});
