import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../vault.js';
import { encryptBytes, decryptBytes, deriveKey, randomBytes, textToBytes, bytesToText, b64, unb64 } from '../cryptoutil.js';

const FAST = { iterations: 2000 };
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
const ev = (id, text) => ({ id, type: 'task', ts: 1, payload: { text, done: false }, source: 'manual', confidence: 1, evidence: [] });

test('b64: туда-обратно, включая большие массивы и нули', () => {
  const big = new Uint8Array(200_000);
  for (let i = 0; i < big.length; i += 65536) big.set(randomBytes(Math.min(65536, big.length - i)), i);
  big[0] = 0; big[1] = 255;
  assert.deepEqual(unb64(b64(big)), big);
  assert.deepEqual(unb64(b64(new Uint8Array())), new Uint8Array());
});
test('AES-GCM: шифрует и расшифровывает; неверный ключ/AAD/подмена падают', async () => {
  const salt = randomBytes(16);
  const k1 = await deriveKey('пароль-1234', salt, 2000), k2 = await deriveKey('другой-пароль', salt, 2000);
  const box = await encryptBytes(k1, textToBytes('секрет'), textToBytes('aad'));
  assert.equal(bytesToText(await decryptBytes(k1, box, textToBytes('aad'))), 'секрет');
  await assert.rejects(decryptBytes(k2, box, textToBytes('aad')));
  await assert.rejects(decryptBytes(k1, box, textToBytes('другой aad')));
  const ct = unb64(box.ct); ct[0] ^= 1;
  await assert.rejects(decryptBytes(k1, { ...box, ct: b64(ct) }, textToBytes('aad')), 'подмена шифртекста');
  const box2 = await encryptBytes(k1, textToBytes('секрет'), textToBytes('aad'));
  assert.notEqual(box.iv, box2.iv, 'IV каждый раз новый');
  assert.notEqual(box.ct, box2.ct);
});
test('vault: создать, заблокировать, разблокировать, неверный пароль', async () => {
  const s = mem(); V.useStorage(s);
  assert.equal(V.status(), 'none');
  await V.create('надёжный-пароль', FAST);
  assert.equal(V.status(), 'unlocked');
  V.lock(); assert.equal(V.status(), 'locked');
  await assert.rejects(V.unlock('неверный-пароль'), V.WrongPasswordError);
  assert.equal(V.status(), 'locked');
  await V.unlock('надёжный-пароль');
  assert.equal(V.status(), 'unlocked');
  assert.ok(!JSON.stringify([...s._m]).includes('надёжный'), 'пароль нигде не хранится');
});
test('vault: слабые пароли отклоняются', async () => {
  V.useStorage(mem());
  await assert.rejects(V.create('short', FAST), /не короче/);
  await assert.rejects(V.create('aaaaaaaaaa', FAST), /повторяющегося/);
  assert.equal(V.status(), 'none');
});
test('vault: seal/open, чужой id и заблокированное состояние', async () => {
  V.useStorage(mem());
  await V.create('надёжный-пароль', FAST);
  const rec = await V.seal(ev('a', 'купить хлеб'));
  assert.ok(!JSON.stringify(rec).includes('хлеб'), 'в записи нет открытого текста');
  assert.deepEqual(await V.open(rec), ev('a', 'купить хлеб'));
  await assert.rejects(V.open({ ...rec, id: 'b' }), 'запись нельзя выдать за другую');
  V.lock();
  await assert.rejects(V.open(rec), V.LockedError);
  await assert.rejects(V.seal(ev('c', 'x')), V.LockedError);
  assert.deepEqual(await V.open(ev('plain', 'открытая')), ev('plain', 'открытая'), 'обычные записи читаются без ключа');
});
test('vault: ключ из другого хранилища не подходит', async () => {
  V.useStorage(mem()); await V.create('надёжный-пароль', FAST);
  const rec = await V.seal(ev('a', 'x'));
  V.useStorage(mem()); await V.create('надёжный-пароль', FAST);   // тот же пароль, другая соль и другой DEK
  await assert.rejects(V.open(rec));
});
test('vault: смена пароля не ломает старые записи', async () => {
  V.useStorage(mem());
  await V.create('старый-пароль-1', FAST);
  const rec = await V.seal(ev('a', 'данные'));
  await assert.rejects(V.changePassword('не-тот-пароль', 'новый-пароль-2', FAST), V.WrongPasswordError);
  await V.changePassword('старый-пароль-1', 'новый-пароль-2', FAST);
  V.lock();
  await assert.rejects(V.unlock('старый-пароль-1'), V.WrongPasswordError);
  await V.unlock('новый-пароль-2');
  assert.deepEqual(await V.open(rec), ev('a', 'данные'));
  await assert.rejects(V.changePassword('новый-пароль-2', 'abc', FAST), /не короче/);
});
test('vault: задержка после серии неудачных попыток', async () => {
  assert.equal(V.lockoutMs(0), 0); assert.equal(V.lockoutMs(4), 0);
  assert.equal(V.lockoutMs(5), 1000); assert.equal(V.lockoutMs(7), 4000);
  assert.equal(V.lockoutMs(50), 300000);
  V.useStorage(mem()); await V.create('надёжный-пароль', FAST); V.lock();
  let t = 1_000_000;
  for (let i = 0; i < 5; i++) await assert.rejects(V.unlock('неверно-неверно', t), V.WrongPasswordError);
  await assert.rejects(V.unlock('надёжный-пароль', t + 100), V.TooManyAttemptsError, 'даже верный пароль ждёт');
  await V.unlock('надёжный-пароль', t + 5000);
  assert.equal(V.failState(t + 5000).n, 0, 'после успеха счётчик сброшен');
});
test('vault: повреждённые метаданные не вызывают тихого сброса', async () => {
  const s = mem(); V.useStorage(s);
  s.setItem('lifeos.vault.v1', '{"v":1,"iter":5}');
  assert.equal(V.status(), 'locked');
  await assert.rejects(V.unlock('что-угодно-123'), /Повреждены/);
  assert.ok(s.getItem('lifeos.vault.v1'), 'данные входа не удалены');
});
test('vault.verify и remove', async () => {
  V.useStorage(mem()); await V.create('надёжный-пароль', FAST);
  await V.verify('надёжный-пароль');
  await assert.rejects(V.verify('нет-нет-нет-нет'), V.WrongPasswordError);
  V.remove(); assert.equal(V.status(), 'none');
});

// ---------- v2: код восстановления, подключение на втором устройстве ----------
import { deriveAuthKey } from '../cryptoutil.js';

test('код восстановления: формат, нормализация, ошибки', () => {
  const code = V.newRecoveryCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
  assert.notEqual(V.newRecoveryCode(), code);
  const plain = code.replace(/-/g, '');
  assert.equal(V.normalizeRecoveryCode(code.toLowerCase()), plain, 'регистр и дефисы не важны');
  assert.equal(V.normalizeRecoveryCode(` ${plain.slice(0, 8)} ${plain.slice(8)} `), plain);
  assert.equal(V.normalizeRecoveryCode('OIL0'.repeat(6)), '0110'.repeat(6), 'O→0, I/L→1');
  for (const bad of ['', 'abc', 'U'.repeat(24), '1'.repeat(23), '1'.repeat(25), null]) assert.throws(() => V.normalizeRecoveryCode(bad), V.WrongRecoveryCodeError, String(bad));
});

test('код восстановления: создать, сбросить пароль, неверный код, старый пароль больше не работает', async () => {
  V.useStorage(mem());
  await V.create('старый-пароль-1', FAST);
  const rec = await V.addRecovery('старый-пароль-1');
  assert.ok(rec.code && rec.meta.rec && rec.server.authKey.length === 44);
  assert.equal(V.getMeta().rec, undefined, 'пока не подтверждено, локально не записано');
  V.commitMeta(rec.meta);
  assert.ok(V.getMeta().rec);
  const sealed = await V.seal(ev('a', 'данные'));
  V.lock();
  await assert.rejects(V.resetWithCode('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'новый-пароль-22', FAST), V.WrongRecoveryCodeError);
  await assert.rejects(V.resetWithCode(rec.code, 'коротк', FAST), /не короче/);
  await V.resetWithCode(rec.code, 'новый-пароль-22', FAST);
  assert.equal(V.status(), 'unlocked');
  assert.deepEqual(await V.open(sealed), ev('a', 'данные'), 'данные читаются тем же ключом');
  V.lock();
  await assert.rejects(V.unlock('старый-пароль-1'), V.WrongPasswordError);
  await V.unlock('новый-пароль-22');
  assert.ok(V.getMeta().rec, 'код восстановления сохранился и работает снова');
  V.lock();
  await V.resetWithCode(rec.code.toLowerCase(), 'третий-пароль-333', FAST);
});

test('без кода восстановления сбросить пароль нельзя', async () => {
  V.useStorage(mem()); await V.create('надёжный-пароль', FAST); V.lock();
  await assert.rejects(V.resetWithCode('A'.repeat(24).replace(/A/g, '1'), 'новый-пароль-22', FAST), V.WrongRecoveryCodeError);
});

test('второе устройство: та же мета + тот же пароль = тот же ключ данных', async () => {
  const devA = mem(), devB = mem();
  V.useStorage(devA); await V.create('общий-пароль-1', FAST);
  const sealed = await V.seal(ev('x', 'с первого устройства'));
  const meta = JSON.parse(devA.getItem('lifeos.vault.v1'));
  V.useStorage(devB);
  assert.equal(V.status(), 'none');
  await assert.rejects(V.adoptMeta(meta, 'не-тот-пароль-1'), V.WrongPasswordError);
  assert.equal(V.status(), 'none', 'неудача ничего не записала');
  await V.adoptMeta(meta, 'общий-пароль-1');
  assert.equal(V.status(), 'unlocked');
  assert.deepEqual(await V.open(sealed), ev('x', 'с первого устройства'));
  assert.deepEqual(JSON.parse(devB.getItem('lifeos.vault.v1')), meta);
  await assert.rejects(V.adoptMeta({ v: 1 }, 'x'.repeat(10)), /Повреждены/);
});

test('смена пароля вместе с сервером: новая мета готовится без записи, фиксируется отдельно; код восстановления сохраняется', async () => {
  V.useStorage(mem()); await V.create('старый-пароль-1', FAST);
  const rec = await V.addRecovery('старый-пароль-1'); V.commitMeta(rec.meta);
  await assert.rejects(V.prepareNewMeta('не-тот-пароль-1', 'новый-пароль-22', FAST), V.WrongPasswordError);
  const before = JSON.stringify(V.getMeta());
  const next = await V.prepareNewMeta('старый-пароль-1', 'новый-пароль-22', FAST);
  assert.equal(JSON.stringify(V.getMeta()), before, 'prepare ничего не пишет');
  assert.deepEqual(next.rec, rec.meta.rec);
  V.commitMeta(next); V.lock();
  await V.unlock('новый-пароль-22');
});

test('вход на новом устройстве по коду восстановления: ключ данных получаем кодом, пароль задаём новый', async () => {
  const devA = mem();
  V.useStorage(devA); await V.create('пароль-устройства-1', FAST);
  const rec = await V.addRecovery('пароль-устройства-1'); V.commitMeta(rec.meta);
  const sealed = await V.seal(ev('q', 'секрет'));
  const serverMeta = V.getMeta();
  V.useStorage(mem());
  await assert.rejects(V.adoptMetaWithCode(serverMeta, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'новый-пароль-22', FAST), V.WrongRecoveryCodeError);
  const { meta, raw } = await V.adoptMetaWithCode(serverMeta, rec.code, 'новый-пароль-22', FAST);
  await V.installUnlocked(meta, raw);
  assert.deepEqual(await V.open(sealed), ev('q', 'секрет'));
  V.lock(); await V.unlock('новый-пароль-22');
});

test('ключ входа на сервер зависит от пароля и соли и не равен ключу шифрования', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const a = await deriveAuthKey('пароль-1234', salt, 2000);
  assert.equal(a.length, 44);
  assert.equal(a, await deriveAuthKey('пароль-1234', salt, 2000), 'детерминирован');
  assert.notEqual(a, await deriveAuthKey('пароль-1235', salt, 2000));
  assert.notEqual(a, await deriveAuthKey('пароль-1234', crypto.getRandomValues(new Uint8Array(16)), 2000));
  assert.notEqual(a, await deriveAuthKey('пароль-1234', salt, 2001));
});

test('seal/open переносят метку времени u снаружи шифртекста и она не подменяется внутри', async () => {
  V.useStorage(mem()); await V.create('надёжный-пароль', FAST);
  const rec = await V.seal({ ...ev('t', 'x'), u: 12345 });
  assert.equal(rec.u, 12345);
  assert.ok(!JSON.stringify(rec).includes('"type"'), 'тип записи скрыт');
  assert.equal((await V.open(rec)).u, 12345);
  assert.equal((await V.open({ ...rec, u: 99999 })).u, 99999, 'u берётся снаружи (нужна для слияния)');
  const noU = await V.seal(ev('n', 'y')); assert.equal('u' in noU, false);
});
