import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, SCALES, ANSWER_LABELS, PROFILE_TITLE, PROFILE_NOT, scoreProfile, scaleWord, compareScale, profileLine, MIN_PER_SCALE } from '../iq-profile.js';

test('профиль: 25 утверждений, пять шкал по пять, в каждой есть обратные, тексты и номера не повторяются', () => {
  assert.equal(ITEMS.length, 25);
  assert.equal(new Set(ITEMS.map(i => i.id)).size, 25); assert.equal(new Set(ITEMS.map(i => i.text)).size, 25);
  for (const s of SCALES) {
    const items = ITEMS.filter(i => i.scale === s.key);
    assert.equal(items.length, 5, s.key);
    assert.ok(items.filter(i => i.rev).length >= 2 && items.filter(i => !i.rev).length >= 2, `${s.key}: есть утверждения в обе стороны`);
    assert.ok(s.title && s.about.length > 20);
  }
  for (const i of ITEMS) { assert.ok(i.text.length > 20 && /[.]$/.test(i.text) && !/\s{2,}/.test(i.text), i.id); assert.ok(SCALES.some(s => s.key === i.scale)); }
  assert.equal(ANSWER_LABELS.length, 5);
});

test('профиль: честные подписи — самоописание, не диагноз, не сравнение с другими', () => {
  assert.match(PROFILE_TITLE, /ориентир/);
  assert.match(PROFILE_NOT, /а не тест и не диагноз/); assert.match(PROFILE_NOT, /не проверялись на людях/); assert.match(PROFILE_NOT, /не сравнивается с другими людьми/);
});

test('профиль: подсчёт — обратные утверждения переворачиваются, пропуски не считаются, мало ответов — нет значения', () => {
  const all = v => Object.fromEntries(ITEMS.map(i => [i.id, v]));
  const fives = scoreProfile(all(5));
  assert.equal(fives.n, 25);
  for (const s of SCALES) { const rev = ITEMS.filter(i => i.scale === s.key && i.rev).length; assert.equal(fives[s.key], Math.round(((5 - rev) * 5 + rev * 1) / 5 * 100) / 100, `${s.key}: при всех «5»`); }
  const mixed = Object.fromEntries(ITEMS.map(i => [i.id, i.rev ? 1 : 5]));                    // согласен с «прямыми», не согласен с «обратными»
  assert.deepEqual(Object.keys(scoreProfile(mixed)).filter(k => k !== 'n').map(k => scoreProfile(mixed)[k]), [5, 5, 5, 5, 5]);
  const some = { ...all(3), q01: null, q02: null, q03: null };                              // на шкалу «порядок» осталось два ответа
  const r = scoreProfile(some);
  assert.equal(r.order, null); assert.equal(r.curiosity, 3); assert.equal(r.n, 22); assert.ok(MIN_PER_SCALE === 3);
  assert.equal(scoreProfile({}).n, 0);
  assert.equal(scoreProfile({ q01: 9, q02: 'a', q04: 2.5 }).order, null, 'неверные значения игнорируются');
});

test('профиль: слова описывают середину шкалы, сравнение — только при сдвиге от полубалла', () => {
  assert.deepEqual([1, 2.39, 2.4, 3, 3.6, 3.61, 5].map(scaleWord), ['скорее не про меня', 'скорее не про меня', 'посередине', 'посередине', 'посередине', 'скорее про меня', 'скорее про меня']);
  assert.equal(scaleWord(null), 'мало ответов');
  assert.deepEqual([[3.5, 3], [3, 3.5], [3.2, 3], [null, 3]].map(([a, b]) => compareScale(a, b)), ['more', 'less', 'same', null]);
  assert.match(profileLine({ order: 3.4, curiosity: null, social: 2, calm: 4, care: 5 }), /^Порядок и планирование: 3,4; Любопытство к новому: —;/);
});
