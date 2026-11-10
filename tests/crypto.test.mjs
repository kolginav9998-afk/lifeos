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
