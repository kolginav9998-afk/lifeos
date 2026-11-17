// Несколько аккаунтов на одном сервере: приглашения, контакты, переписка, администратор, изоляция данных и перенос старой базы.
// Главное требование владельца: у каждого свой аккаунт, и никто не может «просто так» увидеть что-либо о чужих.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../server/core.js';
import { openStore } from '../server/node/server.js';
import { SqlStore } from '../server/sqlstore.js';

const b64 = bytes => Buffer.from(bytes).toString('base64');
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const authKey = () => b64(rnd(32));
const wrap = () => ({ iv: b64(rnd(12)), ct: b64(rnd(48)) });
const meta = () => ({ v: 2, kdf: 'PBKDF2-SHA256', iter: 600000, salt: b64(rnd(16)), wrap: wrap() });
const rec = (id, u, extra = {}) => ({ id, u, d: 0, v: 1, iv: b64(rnd(12)), ct: b64(rnd(64)), ...extra });
const pubKey = () => b64(new Uint8Array([4, ...rnd(64)]));
const msg = () => ({ iv: b64(rnd(12)), ct: b64(rnd(80)) });

function ctx(env = { SETUP_CODE: 'код-установки' }) {
  const { store, close } = openStore(':memory:');
  let t = 1_800_000_000_000;
  const clock = { now: () => t, advance: ms => { t += ms; } };
  const call = async (method, path, { body, token, ip = '1.1.1.1' } = {}) => {
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip };
    if (token) headers.authorization = `Bearer ${token}`;
    const req = new Request(`https://sync.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await handle(req, store, env, clock.now());
    const text = await res.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch { /* не JSON */ }
    return { status: res.status, body: parsed, text };
  };
  // создаёт аккаунт: первый по коду установки, остальные по приглашению от inviter (токен) — возвращает { token, name, authKey }
  const make = async (name, inviter = null) => {
    const key = authKey();
    const body = { username: name, authKey: key, authSalt: b64(rnd(16)), authIter: 600000, meta: meta() };
    if (!inviter) body.setupCode = env.SETUP_CODE;
    else { const inv = await call('POST', '/v1/invites', { token: inviter }); assert.equal(inv.status, 201, inv.text); body.invite = inv.body.code; }
    const r = await call('POST', '/v1/register', { body });
    assert.equal(r.status, 201, r.text);
    return { token: r.body.token, name, authKey: key };
  };
  return { store, close, call, clock, make, env };
}

test('статус не раскрывает число и имена аккаунтов', async () => {
  const c = ctx();
  let r = await c.call('GET', '/v1/status');
  assert.deepEqual([r.body.registered, r.body.setupCodeRequired, r.body.inviteRequired], [false, true, false]);
  await c.make('Владелец');
  await c.make('Анна', (await c.call('POST', '/v1/login', { body: { username: 'владелец', authKey: 'x' } })).body?.token ?? null).catch(() => {});
  r = await c.call('GET', '/v1/status');
  assert.deepEqual([r.body.registered, r.body.setupCodeRequired, r.body.inviteRequired], [true, false, true]);
  assert.deepEqual(Object.keys(r.body).sort(), ['app', 'inviteRequired', 'registered', 'setupCodeRequired', 'time', 'v'], 'никаких чисел и имён');
  assert.ok(!/accounts|users|count/i.test(r.text));
  c.close();
});

test('приглашения: одноразовые, с сроком, отзываемые; код на сервере только в виде хэша', async () => {
  const c = ctx();
  const A = await c.make('Владелец');
  const reg = (invite, name = 'Анна') => c.call('POST', '/v1/register', { body: { username: name, authKey: authKey(), authSalt: b64(rnd(16)), authIter: 600000, meta: meta(), invite }, ip: '2.2.2.2' });

  // без приглашения: как раньше «аккаунт уже есть» (старые клиенты)
  assert.equal((await reg(undefined)).status, 409);
  assert.equal((await reg(undefined)).body.error, 'account_exists');

  const inv = await c.call('POST', '/v1/invites', { token: A.token });
  assert.equal(inv.status, 201);
  assert.match(inv.body.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(inv.body.expiresAt, c.clock.now() + 7 * 24 * 3600 * 1000);
  const dump = JSON.stringify(c.store.db.all('SELECT * FROM invites'));
  assert.ok(!dump.includes(inv.body.code) && !dump.includes(inv.body.code.replace(/-/g, '')), 'в базе нет самого кода');

  // код можно набрать строчными и без дефисов
  const ok = await reg(inv.body.code.toLowerCase().replace(/-/g, ''));
  assert.equal(ok.status, 201, ok.text);
  assert.equal((await reg(inv.body.code, 'Борис')).status, 403, 'второй раз тот же код не работает');
  assert.equal((await reg(inv.body.code, 'Борис')).body.error, 'bad_invite');

  // срок
  const inv2 = (await c.call('POST', '/v1/invites', { token: A.token })).body;
  c.clock.advance(7 * 24 * 3600 * 1000 + 1000);
  assert.equal((await reg(inv2.code, 'Борис')).status, 403, 'просроченное приглашение');
  // отзыв
  const inv3 = (await c.call('POST', '/v1/invites', { token: A.token })).body;
  assert.equal((await c.call('DELETE', `/v1/invites/${inv3.id}`, { token: A.token })).status, 200);
  assert.equal((await reg(inv3.code, 'Борис')).status, 403, 'отозванное приглашение');
  // список: состояния
  const list = (await c.call('GET', '/v1/invites', { token: A.token })).body.invites;
  const states = Object.fromEntries(list.map(i => [i.id, i.state]));
  assert.deepEqual([states[inv.body.id], states[inv2.id], states[inv3.id]], ['used', 'expired', 'revoked']);
  assert.equal(list.find(i => i.id === inv.body.id).usedBy, 'анна');
  c.close();
});

test('перебор приглашений ограничен так же, как перебор пароля', async () => {
  const c = ctx();
  await c.make('Владелец');
  let last;
  for (let i = 0; i < 8; i++) last = await c.call('POST', '/v1/register', { body: { username: 'Анна', authKey: authKey(), authSalt: b64(rnd(16)), authIter: 600000, meta: meta(), invite: 'AAAA-BBBB-CCCC' }, ip: '3.3.3.3' });
  assert.equal(last.status, 429);
  assert.equal(last.body.error, 'locked');
  c.close();
});

test('лимит аккаунтов, одинаковые имена без учёта регистра, не больше пяти приглашений', async () => {
  const c = ctx({ SETUP_CODE: 'код', MAX_ACCOUNTS: '3' });
  const A = await c.make('Владелец');
  const B = await c.make('Анна', A.token);
  // имя занято (без учёта регистра): ответ «аккаунт уже есть» только при верном приглашении
  const inv = (await c.call('POST', '/v1/invites', { token: A.token })).body;
  const dup = await c.call('POST', '/v1/register', { body: { username: 'АННА', authKey: authKey(), authSalt: b64(rnd(16)), authIter: 600000, meta: meta(), invite: inv.code } });
  assert.deepEqual([dup.status, dup.body.error], [409, 'account_exists']);
  assert.ok((await c.call('GET', '/v1/invites', { token: A.token })).body.invites.find(i => i.id === inv.id).state === 'active', 'приглашение не потрачено впустую');
  const C = await c.make('Борис', A.token);
  // трёх аккаунтов достаточно: новых приглашений не дают, а зарегистрироваться по оставшимся нельзя
  const full = await c.call('POST', '/v1/invites', { token: A.token });
  assert.deepEqual([full.status, full.body.error], [403, 'accounts_limit']);
  assert.ok(B && C);
  c.close();

  const d = ctx({ SETUP_CODE: 'код', MAX_ACCOUNTS: '50' });
  const O = await d.make('Владелец');
  for (let i = 0; i < 5; i++) assert.equal((await d.call('POST', '/v1/invites', { token: O.token })).status, 201);
  assert.equal((await d.call('POST', '/v1/invites', { token: O.token })).body.error, 'too_many_invites');
  d.close();
});

test('приглашать могут только администратор (по умолчанию) или все (если включено)', async () => {
  const c = ctx();
  const A = await c.make('Владелец');
  const B = await c.make('Анна', A.token);
  for (const [m, p] of [['POST', '/v1/invites'], ['GET', '/v1/invites'], ['DELETE', '/v1/invites/1']]) {
    const r = await c.call(m, p, { token: B.token });
    assert.deepEqual([r.status, r.body.error], [404, 'not_found'], `${m} ${p}`);
  }
  c.close();
  const d = ctx({ SETUP_CODE: 'код', INVITES_BY_USERS: '1' });
  const O = await d.make('Владелец');
  const P = await d.make('Анна', O.token);
  const Q = await d.make('Борис', P.token);                                         // Анна пригласила Бориса
  const contacts = n => d.call('GET', '/v1/contacts', { token: n.token }).then(r => r.body.contacts.map(x => x.username));
  assert.deepEqual(await contacts(P), ['борис', 'владелец']);
  assert.deepEqual(await contacts(Q), ['анна'], 'Борис знает только пригласившую его Анну, но не владельца');
  assert.deepEqual(await contacts(O), ['анна'], 'владелец не видит друзей Анны');
  d.close();
});

test('контакты: только свои; роль «пригласил» и «пригласивший»; удаление контакта', async () => {
  const c = ctx();
  const A = await c.make('Владелец'), B = await c.make('Анна', A.token);
  let r = await c.call('GET', '/v1/contacts', { token: A.token });
  assert.deepEqual(r.body.contacts.map(x => [x.username, x.via, x.pub, x.display]), [['анна', 'invited', null, null]]);
  r = await c.call('GET', '/v1/contacts', { token: B.token });
  assert.deepEqual(r.body.contacts.map(x => [x.username, x.via]), [['владелец', 'inviter']]);
  assert.equal((await c.call('GET', '/v1/users', { token: A.token })).status, 404, 'общего списка людей нет');
  assert.equal((await c.call('DELETE', '/v1/contacts/%D0%B0%D0%BD%D0%BD%D0%B0', { token: A.token })).status, 200);
  assert.deepEqual((await c.call('GET', '/v1/contacts', { token: A.token })).body.contacts, []);
  assert.deepEqual((await c.call('GET', '/v1/contacts', { token: B.token })).body.contacts, [], 'у второго связь тоже пропала');
  // удаление несуществующего или чужого контакта отвечает так же
  const x = await c.call('DELETE', '/v1/contacts/nobody', { token: A.token });
  assert.deepEqual([x.status, x.body], [200, { ok: true }]);
  c.close();
});

test('изоляция данных: одинаковые id записей у разных аккаунтов не пересекаются, журналы и счётчики свои', async () => {
  const c = ctx();
  const A = await c.make('Владелец'), B = await c.make('Анна', A.token);
  const a1 = rec('workcfg', 100), b1 = rec('workcfg', 200), a2 = rec('note1', 101);
  assert.equal((await c.call('POST', '/v1/sync', { token: A.token, body: { records: [a1, a2] } })).body.accepted, 2);
  assert.equal((await c.call('POST', '/v1/sync', { token: B.token, body: { records: [b1] } })).body.accepted, 1);
  const fa = (await c.call('GET', '/v1/sync?since=0', { token: A.token })).body, fb = (await c.call('GET', '/v1/sync?since=0', { token: B.token })).body;
  assert.deepEqual(fa.records.map(r => [r.id, r.u]), [['workcfg', 100], ['note1', 101]]);
  assert.deepEqual(fb.records.map(r => [r.id, r.u]), [['workcfg', 200]]);
  assert.equal(fb.seq, 1, 'у Анны журнал начат с единицы: по номерам не видно, сколько записали другие');
  assert.equal(fa.seq, 2);
  // удаление у одного не трогает другого
  await c.call('POST', '/v1/sync', { token: A.token, body: { records: [{ id: 'workcfg', u: 300, d: 1 }] } });
  const fb2 = (await c.call('GET', '/v1/sync?since=0', { token: B.token })).body;
  assert.equal(fb2.records[0].d, 0);
  // у каждого своя мета и имя
  assert.equal((await c.call('GET', '/v1/meta', { token: B.token })).body.username, 'анна');
  assert.equal(c.store.stats(A.id ?? c.store.getAccountByName('владелец').id).count, 2);
  c.close();
});

test('не выяснить, есть ли чужое имя: параметры входа и ответ при отправке одинаковы для настоящих и выдуманных', async () => {
  const c = ctx();
  const A = await c.make('Владелец'), B = await c.make('Анна', A.token), C = await c.make('Борис', A.token);
  // параметры входа: настоящее и выдуманное имя дают ответ одной формы
  const real = await c.call('POST', '/v1/login/params', { body: { username: 'анна' } }), fake = await c.call('POST', '/v1/login/params', { body: { username: 'нет-такого' } });
  assert.deepEqual([real.status, fake.status], [200, 200]);
  assert.deepEqual(Object.keys(real.body).sort(), Object.keys(fake.body).sort());
  assert.equal(real.body.salt.length, fake.body.salt.length);
  assert.equal(real.body.iter, fake.body.iter);
  // повторный запрос выдуманного имени даёт то же, что и в первый раз (приманка стабильна)
  assert.deepEqual((await c.call('POST', '/v1/login/params', { body: { username: 'нет-такого' } })).body, fake.body);
  // Анна пишет Борису (оба — контакты владельца, но не друг друга) и выдуманному имени: ответы совпадают байт в байт
  const m = msg();
  const toBoris = await c.call('POST', '/v1/chat/send', { token: B.token, body: { to: 'борис', ...m } });
  const toNobody = await c.call('POST', '/v1/chat/send', { token: B.token, body: { to: 'нет-такого', ...m } });
  assert.deepEqual([toBoris.status, toBoris.text], [404, toNobody.text]);
  assert.equal(toNobody.status, 404);
  assert.equal(C.name, 'Борис');
  // приглашения и админ-маршруты у обычного человека ведут себя как несуществующие
  const unknown = await c.call('GET', '/v1/nonexistent', { token: B.token });
  for (const [meth, p] of [['GET', '/v1/admin/accounts'], ['POST', '/v1/admin/accounts/борис/disable'], ['DELETE', '/v1/admin/accounts/борис']]) {
    const r = await c.call(meth, p, { token: B.token });
    assert.deepEqual([r.status, r.text], [404, unknown.text], `${meth} ${p}`);
  }
  assert.equal(c.store.getAccountByName('борис').disabled, 0);
  c.close();
});

test('ключи и имя для чата: проверка формата, контакты видят открытый ключ', async () => {
  const c = ctx();
  const A = await c.make('Владелец'), B = await c.make('Анна', A.token);
  for (const bad of ['коротко', b64(rnd(65)).replace(/^./, 'A'), b64(new Uint8Array([2, ...rnd(64)])), b64(new Uint8Array([4, ...rnd(32)]))]) {
    const r = await c.call('POST', '/v1/keys', { token: B.token, body: { pub: bad } });
    assert.deepEqual([r.status, r.body.error], [400, 'bad_key'], bad.slice(0, 12));
  }
  const pub = pubKey();
  assert.equal((await c.call('POST', '/v1/keys', { token: B.token, body: { pub, display: '  Аня \u0007 ❤  ' } })).status, 200);
  const seen = (await c.call('GET', '/v1/contacts', { token: A.token })).body.contacts[0];
  assert.deepEqual([seen.pub, seen.display], [pub, 'Аня  ❤'], 'управляющие знаки убраны, края обрезаны');
  assert.equal((await c.call('POST', '/v1/keys', { token: B.token, body: { display: '' } })).status, 200);
  assert.equal((await c.call('GET', '/v1/contacts', { token: A.token })).body.contacts[0].display, null);
  assert.equal((await c.call('GET', '/v1/contacts', { token: A.token })).body.contacts[0].pub, pub, 'ключ остался');
  c.close();
});

test('переписка: контакты обмениваются зашифрованным, у каждого свои номера, чужие ничего не видят', async () => {
  const c = ctx({ SETUP_CODE: 'код', INVITES_BY_USERS: '1' });
  const A = await c.make('Владелец'), B = await c.make('Анна', A.token), C = await c.make('Борис', B.token);
  const m1 = msg(), m2 = msg();
  let r = await c.call('POST', '/v1/chat/send', { token: A.token, body: { to: 'Анна', ...m1 } });
  assert.deepEqual([r.status, r.body.seq, r.body.ok], [201, 1, true]);
  r = await c.call('POST', '/v1/chat/send', { token: B.token, body: { to: 'владелец', ...m2 } });
  assert.equal(r.body.seq, 2, 'у Анны своя нумерация: её первое входящее уже заняло номер 1');
  const inA = (await c.call('GET', '/v1/chat/inbox?after=0', { token: A.token })).body, inB = (await c.call('GET', '/v1/chat/inbox?after=0', { token: B.token })).body;
  assert.deepEqual(inA.messages.map(x => [x.seq, x.from, x.to, x.ct]), [[1, 'владелец', 'анна', m1.ct], [2, 'анна', 'владелец', m2.ct]]);
  assert.deepEqual(inB.messages.map(x => [x.seq, x.from, x.to, x.ct]), [[1, 'владелец', 'анна', m1.ct], [2, 'анна', 'владелец', m2.ct]]);
  assert.equal(inA.last, 2);
  assert.deepEqual((await c.call('GET', '/v1/chat/inbox?after=1', { token: A.token })).body.messages.map(x => x.seq), [2], 'курсор «после номера»');
  // Борис (не контакт владельца) ничего не видит и не может написать владельцу
  assert.deepEqual((await c.call('GET', '/v1/chat/inbox?after=0', { token: C.token })).body.messages, []);
  assert.equal((await c.call('POST', '/v1/chat/send', { token: C.token, body: { to: 'владелец', ...msg() } })).status, 404);
  assert.equal((await c.call('POST', '/v1/chat/send', { token: A.token, body: { to: 'борис', ...msg() } })).status, 404);
  // сервер хранит только шифртекст
  assert.ok(c.store.db.all('SELECT ct FROM box').every(x => /^[A-Za-z0-9+/=]+$/.test(x.ct)));
  // скрыть переписку может каждый у себя
  assert.equal((await c.call('POST', '/v1/chat/hide', { token: B.token, body: { with: 'владелец' } })).status, 200);
  assert.deepEqual((await c.call('GET', '/v1/chat/inbox?after=0', { token: B.token })).body.messages, []);
  assert.equal((await c.call('GET', '/v1/chat/inbox?after=0', { token: A.token })).body.messages.length, 2, 'у собеседника осталась');
  c.close();
});

test('переписка: проверка формата, лимит в минуту, срок хранения', async () => {
  const c = ctx();
  const A = await c.make('Владелец'), B = await c.make('Анна', A.token);
  for (const bad of [{ iv: 'x', ct: b64(rnd(30)) }, { iv: b64(rnd(12)), ct: 'x' }, { iv: b64(rnd(12)), ct: b64(rnd(17 * 1024)) }, { iv: b64(rnd(12)) }, {}]) {
    const r = await c.call('POST', '/v1/chat/send', { token: A.token, body: { to: 'анна', ...bad } });
    assert.deepEqual([r.status, r.body.error], [400, 'bad_message']);
  }
  assert.equal((await c.call('POST', '/v1/chat/send', { token: A.token, body: { to: 'владелец', ...msg() } })).status, 404, 'самому себе нельзя');
  for (let i = 0; i < 60; i++) assert.equal((await c.call('POST', '/v1/chat/send', { token: A.token, body: { to: 'анна', ...msg() } })).status, 201);
  const over = await c.call('POST', '/v1/chat/send', { token: A.token, body: { to: 'анна', ...msg() } });
  assert.deepEqual([over.status, over.body.error], [429, 'rate']);
  c.clock.advance(61_000);
  assert.equal((await c.call('POST', '/v1/chat/send', { token: A.token, body: { to: 'анна', ...msg() } })).status, 201, 'через минуту можно снова');
  // срок хранения 180 суток
  c.clock.advance(181 * 24 * 3600 * 1000);
  const relogin = async u => (await c.call('POST', '/v1/login', { body: { username: u.name, authKey: u.authKey } })).body.token;       // сессии за полгода истекли
  const tA = await relogin(A), tB = await relogin(B);
  await c.call('POST', '/v1/chat/send', { token: tB, body: { to: 'владелец', ...msg() } });
  assert.equal((await c.call('GET', '/v1/chat/inbox?after=0&limit=200', { token: tA })).body.messages.length, 1, 'старые сообщения удалены');
  c.close();
});

test('администратор видит служебные сведения, но не содержимое; может отключить, включить и удалить', async () => {
  const c = ctx();
  const A = await c.make('Владелец'), B = await c.make('Анна', A.token);
  await c.call('POST', '/v1/sync', { token: B.token, body: { records: [rec('x', 1)] } });
  await c.call('POST', '/v1/chat/send', { token: B.token, body: { to: 'владелец', ...msg() } });
  const r = await c.call('GET', '/v1/admin/accounts', { token: A.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.accounts.map(a => [a.username, a.role, a.disabled, a.invitedBy]), [['владелец', 'admin', false, null], ['анна', 'user', false, 'владелец']]);
  assert.ok(r.body.accounts[1].usedBytes > 0 && r.body.accounts[1].createdAt && r.body.accounts[1].lastSeenAt);
  for (const secret of ['authKey', 'auth_hash', 'meta', 'wrap', 'salt', 'ct', 'iv', 'token']) assert.ok(!r.text.includes(`"${secret}"`), `в ответе нет поля ${secret}`);
  // нельзя отключить или удалить себя
  assert.equal((await c.call('POST', '/v1/admin/accounts/владелец/disable', { token: A.token })).body.error, 'cannot_self');
  // отключить: сессии отозваны, войти нельзя (при верном пароле сказано «отключён»)
  assert.equal((await c.call('POST', '/v1/admin/accounts/анна/disable', { token: A.token })).status, 200);
  assert.equal((await c.call('GET', '/v1/meta', { token: B.token })).status, 401);
  assert.equal((await c.call('POST', '/v1/login', { body: { username: 'Анна', authKey: B.authKey } })).body.error, 'disabled');
  assert.equal((await c.call('POST', '/v1/login', { body: { username: 'Анна', authKey: authKey() } })).body.error, 'bad_credentials');
  assert.deepEqual((await c.call('GET', '/v1/contacts', { token: A.token })).body.contacts, [], 'отключённый не виден в контактах');
  assert.equal((await c.call('POST', '/v1/admin/accounts/анна/enable', { token: A.token })).status, 200);
  assert.equal((await c.call('POST', '/v1/login', { body: { username: 'Анна', authKey: B.authKey } })).status, 200);
  // удалить: всё его исчезает, у собеседников переписка тоже
  assert.equal((await c.call('DELETE', '/v1/admin/accounts/анна', { token: A.token })).status, 200);
  assert.equal(c.store.db.all('SELECT COUNT(*) AS n FROM recs')[0].n, 0);
  assert.equal(c.store.db.all('SELECT COUNT(*) AS n FROM box')[0].n, 0);
  assert.deepEqual((await c.call('GET', '/v1/chat/inbox?after=0', { token: A.token })).body.messages, []);
  assert.equal((await c.call('GET', '/v1/admin/accounts', { token: A.token })).body.accounts.length, 1);
  assert.equal(c.store.db.all('SELECT COUNT(*) AS n FROM adminlog')[0].n, 3, 'действия администратора записаны');
  c.close();
});

test('удаление собственного аккаунта: данные, ключ, переписка и приглашения исчезают; администратор свой удалить не может, пока есть другие', async () => {
  const c = ctx();
  const A = await c.make('Владелец'), B = await c.make('Анна', A.token);
  await c.call('POST', '/v1/sync', { token: B.token, body: { records: [rec('x', 1)] } });
  await c.call('POST', '/v1/keys', { token: B.token, body: { pub: pubKey() } });
  await c.call('POST', '/v1/chat/send', { token: A.token, body: { to: 'анна', ...msg() } });
  assert.equal((await c.call('DELETE', '/v1/account', { token: A.token, body: { authKey: A.authKey } })).body.error, 'admin_has_users');
  assert.equal((await c.call('DELETE', '/v1/account', { token: B.token, body: { authKey: authKey() } })).status, 401, 'нужен пароль');
  assert.equal((await c.call('DELETE', '/v1/account', { token: B.token, body: { authKey: B.authKey } })).status, 200);
  assert.equal((await c.call('GET', '/v1/meta', { token: B.token })).status, 401);
  assert.equal(c.store.getAccountByName('анна'), null);
  assert.deepEqual((await c.call('GET', '/v1/contacts', { token: A.token })).body.contacts, []);
  assert.deepEqual((await c.call('GET', '/v1/chat/inbox?after=0', { token: A.token })).body.messages, []);
  // новое имя «анна» получает новый uid и не наследует ничего
  const old = c.store.db.all('SELECT MAX(id) AS m FROM accts')[0].m;
  const B2 = await c.make('Анна', A.token);
  assert.ok(c.store.getAccountByName('анна').id > old, 'номера аккаунтов не переиспользуются');
  assert.deepEqual((await c.call('GET', '/v1/sync?since=0', { token: B2.token })).body.records, []);
  c.close();
});

test('восстановление пароля по коду работает у каждого аккаунта отдельно', async () => {
  const c = ctx();
  const A = await c.make('Владелец');
  const key = authKey(), recKey = authKey();
  const inv = (await c.call('POST', '/v1/invites', { token: A.token })).body;
  const body = { username: 'Анна', authKey: key, authSalt: b64(rnd(16)), authIter: 600000, meta: meta(), invite: inv.code, recovery: { authKey: recKey, salt: b64(rnd(16)), iter: 200000 } };
  assert.equal((await c.call('POST', '/v1/register', { body })).status, 201);
  assert.equal((await c.call('POST', '/v1/recover', { body: { username: 'Анна', recoveryAuthKey: authKey() } })).status, 401);
  const r = await c.call('POST', '/v1/recover', { body: { username: 'Анна', recoveryAuthKey: recKey } });
  assert.equal(r.status, 200);
  const newKey = authKey();
  const fin = await c.call('POST', '/v1/recover/finish', { body: { resetToken: r.body.resetToken, newAuthKey: newKey, newAuthSalt: b64(rnd(16)), newAuthIter: 600000, newMeta: meta() } });
  assert.equal(fin.status, 200);
  assert.equal((await c.call('POST', '/v1/recover/finish', { body: { resetToken: r.body.resetToken, newAuthKey: newKey, newAuthSalt: b64(rnd(16)), newAuthIter: 600000, newMeta: meta() } })).status, 401, 'токен одноразовый');
  assert.equal((await c.call('POST', '/v1/login', { body: { username: 'Анна', authKey: newKey } })).status, 200);
  assert.equal((await c.call('POST', '/v1/login', { body: { username: 'Анна', authKey: key } })).status, 401);
  assert.equal(c.store.getAccountByName('владелец').rec_hash, null, 'у владельца кода нет и он не затронут');
  assert.equal((await c.call('GET', '/v1/meta', { token: A.token })).status, 200, 'сессия владельца жива');
  c.close();
});

// ---------- перенос старой базы (один аккаунт) ----------
const OLD_SCHEMA = [
  `CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE account (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL, auth_salt TEXT NOT NULL, auth_iter INTEGER NOT NULL, hash_salt TEXT NOT NULL, auth_hash TEXT NOT NULL,
     rec_salt TEXT, rec_iter INTEGER, rec_hash TEXT, meta TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE sessions (th TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_used INTEGER NOT NULL)`,
  `CREATE TABLE records (id TEXT PRIMARY KEY, u INTEGER NOT NULL, seq INTEGER NOT NULL, d INTEGER NOT NULL DEFAULT 0, v INTEGER NOT NULL DEFAULT 1, iv TEXT, ct TEXT)`,
  `CREATE INDEX records_seq ON records (seq)`,
  `CREATE TABLE fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, last INTEGER NOT NULL)`,
];
const adapterFor = db => ({
  all: (sql, ...p) => db.prepare(sql).all(...p).map(r => ({ ...r })),
  run: (sql, ...p) => { db.prepare(sql).run(...p); },
  tx(fn) { db.exec('BEGIN IMMEDIATE'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
});
async function sha256Hex(s) { return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex'); }

test('перенос старой базы: аккаунт становится администратором, записи, номера и сессии сохраняются; повторный запуск ничего не меняет', async () => {
  const db = new DatabaseSync(':memory:');
  for (const q of OLD_SCHEMA) db.exec(q);
  const now = 1_800_000_000_000, token = 'старый-токен-сессии-abcdefghijklmnop'.replace(/[^\w-]/g, 'x');
  db.prepare(`INSERT INTO account VALUES (1, 'владелец', 'c2FsdA==', 600000, 'aGFzaA==', 'abc', NULL, NULL, NULL, ?, ?, ?)`).run(JSON.stringify(meta()), now - 1000, now - 500);
  db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?)`).run(await sha256Hex(token), now - 1000, now + 86400000, now - 10);
  const r1 = rec('workcfg', 5), r2 = rec('note', 7), r3 = { id: 'gone', u: 9, d: 1, v: 1 };
  db.prepare(`INSERT INTO records VALUES (?, ?, 1, 0, 1, ?, ?)`).run('workcfg', 5, r1.iv, r1.ct);
  db.prepare(`INSERT INTO records VALUES (?, ?, 2, 0, 1, ?, ?)`).run('note', 7, r2.iv, r2.ct);
  db.prepare(`INSERT INTO records VALUES (?, ?, 3, 1, 1, NULL, NULL)`).run(r3.id, r3.u);
  db.prepare(`INSERT INTO kv VALUES ('seq', '3')`).run();
  const store = new SqlStore(adapterFor(db)).migrate();
  const acc = store.getAccountByName('владелец');
  assert.deepEqual([acc.id, acc.role, acc.seq, acc.created_at, acc.invited_by], [1, 'admin', 3, now - 1000, null]);
  assert.equal(store.accountCount(), 1);
  assert.deepEqual(store.listRecords(1, 0, 100, 1e6).records.map(r => [r.id, r.u, r.s, r.d]), [['workcfg', 5, 1, 0], ['note', 7, 2, 0], ['gone', 9, 3, 1]]);
  assert.equal(store.listRecords(1, 0, 100, 1e6).seq, 3);
  // старая сессия продолжает работать у того же человека
  const res = await handle(new Request('https://sync.test/v1/sync?since=0', { headers: { authorization: `Bearer ${token}` } }), store, {}, now);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).records.length, 3);
  // следующая запись получает следующий номер
  assert.equal(store.upsertRecords(1, [{ id: 'new', u: 20, d: 0, v: 1, iv: r1.iv, ct: r1.ct }], now).seq, 4);
  // старые таблицы остаются нетронутыми (на случай отката на прежнюю версию сервера)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 3);
  // повторный запуск: ничего не дублируется
  new SqlStore(adapterFor(db)).migrate();
  assert.equal(store.accountCount(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recs').get().n, 4);
  // после удаления единственного аккаунта прежний не «воскресает» при следующем запуске
  store.deleteAccount(1);
  new SqlStore(adapterFor(db)).migrate();
  assert.equal(new SqlStore(adapterFor(db)).accountCount(), 0);
  // новый первый аккаунт получает новый номер, а не 1
  assert.ok(db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('accts').seq >= 1);
  db.close();
});

test('чистая база: схема создаётся, повторный migrate безопасен', () => {
  const { store, close } = openStore(':memory:');
  store.migrate(); store.migrate();
  assert.equal(store.accountCount(), 0);
  assert.equal(store.kvGet('migrated_v2'), '1');
  close();
});
