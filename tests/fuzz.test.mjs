// Грязные файлы архива: что бы ни лежало в файле, импорт либо понятно отказывает, либо отдаёт только корректные записи. Без зависаний и порчи объектов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parseImport, cleanEvent, depthOk, MAX_PAYLOAD_DEPTH, MAX_IMPORT_EVENTS } from '../events.js';
import { encryptBackup, readBackup, backupKind } from '../backup.js';
import { MIN_ITER } from '../cryptoutil.js';
import { importPlan, planEvents, cleanPrefs } from '../archive.js';
import { makeRng } from '../stats.js';

const ev = (id, type, payload, ts = 1_700_000_000_000) => ({ id, type, ts, payload, source: 'manual', confidence: 1, evidence: [] });
const sample = () => serialize(['task', 'note', 'habit', 'expense', 'skill', 'srs', 'checkin'].flatMap((t, i) => [ev(`${t}:1`, t, { text: `текст ${i}`, n: i, list: [1, { a: null }], done: false }), ev(`${t}:2`, t, { text: 'второй' }, 5)]), 42, { version: 'R3.10', prefs: { theme: 'dark', daysOff: [0, 6] } });

// Каждая запись из результата обязана проходить строгую проверку.
function assertClean(r) {
  assert.ok(Array.isArray(r.events) && Number.isInteger(r.skipped) && r.skipped >= 0);
  for (const e of r.events) assert.ok(cleanEvent(e), `в результате некорректная запись: ${JSON.stringify(e).slice(0, 120)}`);
  assert.equal(new Set(r.events.map(e => e.id)).size <= r.events.length, true);
}
function tryParse(text) {
  try { const r = parseImport(text); assertClean(r); return r; }
  catch (e) { assert.ok(e instanceof Error && typeof e.message === 'string' && e.message.length > 0, 'ошибка должна быть понятной'); assert.ok(!(e instanceof RangeError), `стек: ${e.message}`); return null; }
}

test('случайные порчи файла: удаление, вставка, перестановка, обрезка — всегда ошибка или чистый результат', () => {
  const rng = makeRng(2026), base = sample(), junk = ['"', '{', '}', '[', ']', ',', ':', 'null', 'true', '\u0000', '\\u00zz', '\n', '9e999', '-0', '"__proto__"', '{"__proto__":{"x":1}}'];
  let parsed = 0, rejected = 0;
  for (let i = 0; i < 1500; i++) {
    let s = base;
    for (let k = 0, n = 1 + Math.floor(rng() * 4); k < n; k++) {
      const pos = Math.floor(rng() * s.length), op = Math.floor(rng() * 5);
      if (op === 0) s = s.slice(0, pos) + s.slice(pos + 1 + Math.floor(rng() * 8));
      else if (op === 1) s = s.slice(0, pos) + junk[Math.floor(rng() * junk.length)] + s.slice(pos);
      else if (op === 2) s = s.slice(0, pos);
      else if (op === 3) { const q = Math.floor(rng() * s.length); s = s.slice(0, Math.min(pos, q)) + s.slice(Math.max(pos, q)) + s.slice(Math.min(pos, q), Math.max(pos, q)); }
      else s = s.slice(0, pos) + String.fromCharCode(Math.floor(rng() * 0xd7ff)) + s.slice(pos);
    }
    tryParse(s) ? parsed++ : rejected++;
  }
  assert.ok(parsed > 0 && rejected > 0, `разные исходы: принято ${parsed}, отклонено ${rejected}`);
});

test('неправильные типы вместо полей: записи отбрасываются, остальные читаются', () => {
  const wrong = [null, undefined, 0, 1, -1, NaN, 'строка', true, [], [1, 2], {}, { a: 1 }, 1e308, '', ' '];
  const base = { id: 'x', type: 'note', ts: 1, payload: { t: 1 }, source: 'manual', confidence: 1, evidence: [] };
  let kept = 0, dropped = 0;
  for (const field of ['id', 'type', 'ts', 'payload', 'source', 'confidence', 'evidence', 'u']) for (const w of wrong) {
    const r = parseImport(JSON.stringify({ app: 'lifeos', schema: 1, events: [{ ...base, [field]: w }, ev('good', 'note', { text: 'ок' })] }));
    assertClean(r); assert.ok(r.events.some(e => e.id === 'good'), `хорошая запись потерялась (${field}=${JSON.stringify(w)})`);
    r.events.length === 2 ? kept++ : dropped++;
  }
  assert.ok(kept > 0 && dropped > 0);
  for (const data of [null, 5, 'x', [], { app: 'другое' }, { app: 'lifeos' }, { app: 'lifeos', events: 'нет' }, { app: 'lifeos', events: {} }, { app: 'lifeos', schema: 'x', events: [] }, { app: 'lifeos', schema: -3, events: [] }])
    assert.doesNotThrow(() => { try { parseImport(JSON.stringify(data)); } catch (e) { assert.ok(e instanceof Error); } }, JSON.stringify(data));
});

test('вложенность: слишком глубокие данные отбрасываются без падения стека', () => {
  assert.equal(MAX_PAYLOAD_DEPTH, 24);
  let deep = {}; for (let i = 0; i < 20000; i++) deep = { a: deep };
  assert.equal(depthOk(deep), false); assert.equal(depthOk({ a: { b: { c: [1, { d: 1 }] } } }), true);
  let ok = { v: 1 }; for (let i = 0; i < MAX_PAYLOAD_DEPTH - 1; i++) ok = { a: ok };          // ровно предел вложенности
  assert.equal(depthOk(ok), true); assert.equal(depthOk({ a: ok }), false, 'на уровень глубже предела');
  const text = '{"app":"lifeos","schema":1,"events":[{"id":"deep","type":"note","ts":1,"payload":' + '{"a":'.repeat(5000) + '1' + '}'.repeat(5000) + '},{"id":"fine","type":"note","ts":2,"payload":{"t":1}}]}';
  const r = parseImport(text);
  assert.deepEqual(r.events.map(e => e.id), ['fine']); assert.equal(r.skipped, 1);
  const arrays = '{"app":"lifeos","schema":1,"events":[{"id":"arr","type":"note","ts":1,"payload":{"a":' + '['.repeat(3000) + ']'.repeat(3000) + '}}]}';
  assert.equal(parseImport(arrays).events.length, 0);
  assert.doesNotThrow(() => importPlan([], parseImport(text).events));
});

test('служебные имена не портят объекты: __proto__, constructor, prototype', () => {
  const text = '{"app":"lifeos","schema":1,"__proto__":{"polluted":"да"},"prefs":{"__proto__":{"polluted":"да"},"theme":"dark"},"events":[{"id":"p","type":"note","ts":1,"payload":{"__proto__":{"polluted":"да"},"constructor":{"prototype":{"polluted":"да"}},"text":"ок"}}]}';
  const r = parseImport(text);
  assert.equal(({}).polluted, undefined); assert.equal(Object.prototype.polluted, undefined); assert.equal([].polluted, undefined);
  assert.equal(r.events.length, 1); assert.deepEqual(cleanPrefs(r.prefs), { theme: 'dark' });
  const plan = importPlan([ev('p', 'note', { text: 'ок' })], r.events); planEvents(plan, 'replace'); assert.equal(({}).polluted, undefined);
});

test('слишком много записей и огромные строки отклоняются понятно', () => {
  assert.throws(() => parseImport(JSON.stringify({ app: 'lifeos', schema: 1, events: new Array(MAX_IMPORT_EVENTS + 1).fill(0) })), /Слишком много записей/);
  const big = parseImport(JSON.stringify({ app: 'lifeos', schema: 1, events: [ev('big', 'note', { text: 'я'.repeat(2_000_000) })] }));
  assert.equal(big.events.length, 1, 'длинный текст сам по себе не вредит (ограничения на текст есть в интерфейсе)');
});

test('зашифрованный файл: случайные порчи дают ошибку пароля или повреждения, не падение', async () => {
  const rng = makeRng(77), text = await encryptBackup([ev('a', 'note', { text: 'секрет' })], 'длинный-пароль-1', { iterations: MIN_ITER });
  assert.equal(backupKind(text), 'encrypted');
  const d = JSON.parse(text);
  let ok = 0, bad = 0;
  for (let i = 0; i < 60; i++) {
    const broken = { ...d }, key = ['salt', 'iv', 'ct', 'iter', 'v', 'kdf'][Math.floor(rng() * 6)];
    if (key === 'iter') broken.iter = [0, -1, 1e12, 'x', null, 1.5][Math.floor(rng() * 6)];
    else if (typeof d[key] === 'string') { const pos = Math.floor(rng() * d[key].length); broken[key] = d[key].slice(0, pos) + (d[key][pos] === 'A' ? 'B' : 'A') + d[key].slice(pos + 1); }
    else broken[key] = rng() > 0.5 ? 2 : null;
    try { const r = await readBackup(JSON.stringify(broken), 'длинный-пароль-1'); assert.deepEqual(r.events.map(e => e.id), ['a'], 'если файл прочитался, то правильно'); ok++; }          // порча подписи kdf или лишних битов base64 данные не меняет
    catch (e) { assert.ok(e instanceof Error && e.message.length > 0 && !(e instanceof RangeError)); bad++; }
  }
  assert.ok(bad >= 30, `большинство порч отклонено (${bad} из 60, прочитано ${ok})`);
  await assert.rejects(() => readBackup('{"app":"lifeos-enc"}', 'х'), /Это не зашифрованная копия/);
});
