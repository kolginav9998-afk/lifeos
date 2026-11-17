// Сквозное шифрование переписки: ключи, общий секрет, шифрование туда и обратно, код безопасности.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateChatKeys, importPrivate, validPublic, sharedKey, encryptMessage, decryptMessage, safetyCode, newMessageId, toB64, fromB64, CHAT_INFO } from '../chat-crypto.js';

const pair = async () => { const k = await generateChatKeys(); return { ...k, key: await importPrivate(k.priv) }; };

test('ключи: открытый ключ в формате сервера (65 байт, первый байт 4), закрытый восстанавливается', async () => {
  const k = await generateChatKeys();
  assert.equal(fromB64(k.pub).length, 65); assert.equal(fromB64(k.pub)[0], 4);
  assert.ok(validPublic(k.pub));
  assert.ok(!validPublic('мусор') && !validPublic(toB64(new Uint8Array(65))) && !validPublic(toB64(new Uint8Array([4, 1, 2]))));
  assert.ok(await importPrivate(k.priv));
  assert.equal(await importPrivate('мусор'), null, 'повреждённый закрытый ключ: null, а не ошибка');
  assert.notEqual((await generateChatKeys()).pub, k.pub, 'ключи разные каждый раз');
  assert.equal(CHAT_INFO, 'lifeos-chat-v1');
});

test('шифрование туда и обратно: оба собеседника получают один общий ключ, порядок и регистр имён не важны', async () => {
  const a = await pair(), b = await pair();
  const ka = await sharedKey(a.key, b.pub, 'Владелец', 'Анна'), kb = await sharedKey(b.key, a.pub, 'анна', ' ВЛАДЕЛЕЦ ');
  const msg = { v: 1, id: newMessageId(), kind: 'text', ts: 1_800_000_000_000, text: 'Привет! Как насчёт кино в пятницу? ❤' };
  const sealed = await encryptMessage(ka, msg);
  assert.deepEqual(Object.keys(sealed).sort(), ['ct', 'iv']);
  assert.equal(fromB64(sealed.iv).length, 12);
  assert.deepEqual(await decryptMessage(kb, sealed), msg, 'Анна читает то, что написал владелец');
  const back = await encryptMessage(kb, { v: 1, id: 'x', kind: 'text', ts: 1, text: 'Давай!' });
  assert.equal((await decryptMessage(ka, back)).text, 'Давай!');
});

test('чужой ключ, подмена и повреждение не расшифровываются', async () => {
  const a = await pair(), b = await pair(), c = await pair();
  const kab = await sharedKey(a.key, b.pub, 'a', 'b'), kcb = await sharedKey(c.key, b.pub, 'c', 'b'), kac = await sharedKey(a.key, c.pub, 'a', 'c');
  const sealed = await encryptMessage(kab, { v: 1, id: '1', kind: 'text', ts: 1, text: 'секрет' });
  assert.equal(await decryptMessage(kcb, sealed), null, 'третий человек не читает');
  assert.equal(await decryptMessage(kac, sealed), null);
  const bytes = fromB64(sealed.ct); bytes[3] ^= 1;
  assert.equal(await decryptMessage(kab, { iv: sealed.iv, ct: toB64(bytes) }), null, 'испорченный байт замечен');
  assert.equal(await decryptMessage(kab, { iv: toB64(new Uint8Array(12)), ct: sealed.ct }), null, 'чужой iv');
  assert.equal(await decryptMessage(kab, { iv: 'x', ct: 'y' }), null);
  // соль зависит от имён: те же ключи с другими именами дают другой общий ключ
  const kOther = await sharedKey(a.key, b.pub, 'a', 'z');
  assert.equal(await decryptMessage(kOther, sealed), null);
  // сообщение другого формата (нет v: 1) не принимается
  const wrongFormat = await encryptMessage(kab, { hello: 1 });
  assert.equal(await decryptMessage(kab, wrongFormat), null);
});

test('общий ключ: плохие ключи отвергаются понятной ошибкой', async () => {
  const a = await pair();
  await assert.rejects(sharedKey(null, a.pub, 'a', 'b'), /bad_key/);
  await assert.rejects(sharedKey(a.key, 'мусор', 'a', 'b'), /bad_key/);
  await assert.rejects(sharedKey(a.key, toB64(new Uint8Array(65)), 'a', 'b'), /bad_key/);
});

test('длина шифртекста кратна 128 байтам плюс метка: по размеру нельзя точно судить о тексте; пробелы в конце не мешают', async () => {
  const a = await pair(), b = await pair();
  const k = await sharedKey(a.key, b.pub, 'a', 'b');
  const lens = new Set();
  for (const text of ['да', 'ок', 'привет', 'x'.repeat(30)]) lens.add(fromB64((await encryptMessage(k, { v: 1, id: '1', kind: 'text', ts: 1, text })).ct).length);
  assert.equal(lens.size, 1, 'короткие сообщения одной длины');
  assert.equal([...lens][0] % 128, 16, '128·n байт открытого текста плюс 16 байт метки AES-GCM');
  const long = await encryptMessage(k, { v: 1, id: '1', kind: 'text', ts: 1, text: 'я'.repeat(3000) });
  assert.ok(fromB64(long.ct).length < 16 * 1024, 'самое длинное сообщение (4000 знаков) влезает в предел сервера');
  assert.equal((await decryptMessage(k, long)).text.length, 3000);
});

test('код безопасности: 6 групп по 4 цифры, одинаков у обоих, меняется при подмене ключа', async () => {
  const a = await pair(), b = await pair(), evil = await pair();
  const c1 = await safetyCode(a.pub, b.pub), c2 = await safetyCode(b.pub, a.pub), c3 = await safetyCode(a.pub, evil.pub);
  assert.match(c1, /^\d{4}( \d{4}){5}$/);
  assert.equal(c1, c2);
  assert.notEqual(c1, c3);
  assert.equal(await safetyCode(a.pub, b.pub), c1, 'детерминирован');
});

test('идентификаторы сообщений: разные и безопасны для адреса', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newMessageId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{12}$/);
});
