import test from 'node:test';
import assert from 'node:assert/strict';
import { speakable, foreignSide, canSpeak, speak, LANG } from '../speech.js';

test('озвучка: что именно произносится', () => {
  assert.equal(speakable('go (идти, ехать)'), 'go');
  assert.equal(speakable('went — gone'), 'went');
  assert.equal(speakable('  take   off (взлетать) '), 'take off');
  assert.equal(speakable('I ___ (work) in a bank.'), 'I in a bank.');
  assert.equal(speakable(''), ''); assert.equal(speakable(null), '');
});

test('озвучка: сторона карточки на изучаемом языке', () => {
  assert.deepEqual(foreignSide({ q: 'schedule (расписание)', a: 'расписание' }, 'english'), { side: 'q', text: 'schedule' });
  assert.deepEqual(foreignSide({ q: 'Как сказать «я голоден»?', a: "I'm hungry" }, 'english'), { side: 'a', text: "I'm hungry" });
  assert.deepEqual(foreignSide({ q: 'She ___ (work) in a bank. (Present Simple)', a: 'works — he/she/it + s' }, 'english'), { side: 'a', text: 'She works in a bank.' });
  assert.deepEqual(foreignSide({ q: 'ראש', a: 'голова (рош)' }, 'hebrew'), { side: 'q', text: 'ראש' });
  assert.equal(foreignSide({ q: 'Что такое API?', a: 'интерфейс программирования' }, 'english'), null, 'русский текст не озвучиваем');
  assert.equal(foreignSide({ q: 'ראש', a: 'голова' }, 'english'), null, 'иврит не озвучиваем английским голосом');
  assert.equal(foreignSide({ q: 'x', a: 'y' }, 'klingon'), null);
});

test('озвучка: без поддержки в среде ничего не ломается', () => {
  assert.equal(canSpeak(), false, 'в Node синтеза речи нет');
  let err = null;
  assert.equal(speak('hello', 'english', e => { err = e; }), false);
  assert.equal(err, null, 'отсутствие синтеза не считается ошибкой голоса');
  assert.deepEqual(LANG, { english: 'en-US', hebrew: 'he-IL' });
  // с поддержкой: проверяем, что язык и скорость выставляются, а ошибки голоса доходят до обработчика
  const calls = [];
  globalThis.speechSynthesis = { cancel: () => calls.push('cancel'), speak: u => { calls.push(['speak', u.text, u.lang, u.rate]); u.onerror({ error: 'language-unavailable' }); } };
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  try {
    assert.equal(canSpeak(), true);
    const errs = [];
    assert.equal(speak('hello', 'english', e => errs.push(e)), true);
    assert.deepEqual(calls, ['cancel', ['speak', 'hello', 'en-US', 0.9]]); assert.deepEqual(errs, ['language-unavailable']);
    assert.equal(speak('', 'english'), false, 'пустой текст не произносим');
  } finally { delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance; }
});
