// Новые тесты на логику, память и скорость: «бот» проходит каждый тест, отвечая верно по тому же генератору, что и приложение (зерно лежит в разметке).
// Проверяем экран 320 px, подписи для диктора, честные подписи («не IQ»), сохранённую запись и выгрузку. Ожидания — через until/waitText/eventually.
import assert from 'node:assert/strict';
import { launch, tab, until, appReady, waitText, waitCount, eventually } from './helpers.mjs';

const t = await launch({ viewport: { width: 320, height: 640 } });
const { page, errors } = t;
await page.goto(t.url);
await appReady(page);
// E2E_FONT=1.3 node tests/e2e-tests2.mjs — те же проверки при шрифте 130% (в приложении это значение настройки «Размер текста»)
if (process.env.E2E_FONT) await page.evaluate(f => document.documentElement.style.setProperty('--fs', f), process.env.E2E_FONT);
await tab(page, 'tests');
const text = sel => page.textContent(sel);
const SAVED = () => page.evaluate(async () => (await import('./store.js')).state.events.filter(e => e.type === 'testrun').map(e => e.payload).sort((a, b) => a.startedAt - b.startedAt));

// ---------- список: группы, пояснения, 320 px без горизонтальной прокрутки ----------
const ids = await page.evaluate(async () => (await import('./bt-core.js')).TESTS.map(x => x.id));
await waitCount(page, '.test-row', ids.length);
for (const id of ['matrices', 'seq12', 'verbal', 'rotation', 'corsi', 'stroop40', 'coding']) assert.ok(ids.includes(id), `в реестре есть ${id}`);
assert.ok(await page.locator('.tg-title').count() >= 4, 'тесты разбиты на группы');
assert.match(await text('[data-group="logic"]'), /Матрицы/);
assert.match(await text('.tg-note'), /не настоящий IQ-тест/, 'честная подпись у группы «Логика»');
await page.click('.test-row[data-test="matrices"] .what summary');
assert.match(await text('.test-row[data-test="matrices"] .what'), /Время не ограничено/, 'пояснение «Что измеряет этот тест»');
const noScroll = () => page.evaluate(() => { const r = document.getElementById('bt-run'); return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && (!r || r.hidden || r.scrollWidth <= r.clientWidth + 1); });
assert.ok(await noScroll(), 'список тестов без горизонтальной прокрутки при 320 px');

// ---------- общие помощники прохождения ----------
const startSingle = async id => {
  await page.click(`#bt-single-${id}`);
  await until(page, () => !!document.getElementById('bt-state-skip'));
  await page.click('#bt-state-skip');
  await until(page, () => !!document.getElementById('bt-go'));
};
const finish = async () => { await until(page, () => !!document.getElementById('bt-result'), null, 20000); };
const lastRun = async () => (await SAVED()).at(-1);

// ---------- 1. Матрицы ----------
await startSingle('matrices');
assert.ok(await noScroll(), 'вводный экран без горизонтальной прокрутки');
assert.match(await text('#bt-stage'), /описан словами для экранного диктора/, 'сказано про описание рисунков словами');
assert.ok(await page.locator('#bt-skip').isVisible(), 'тест зрительный: можно пропустить');
await page.click('#bt-go');
for (let i = 0; i < 12; i++) {
  await until(page, k => document.getElementById('mx-item')?.dataset.i === String(k), i);
  const { seed, level } = await page.evaluate(() => ({ ...document.getElementById('mx-item').dataset }));
  if (i === 0) {
    const label = await page.getAttribute('svg.mx-board', 'aria-label');
    assert.match(label, /Матрица три на три.*пропущена/, 'у рисунка есть описание словами');
    assert.equal(await page.locator('.mx-opt').count(), 6);
    for (const o of await page.locator('.mx-opt').all()) assert.match(await o.getAttribute('aria-label'), /^Вариант \d: /, 'у варианта есть имя');
    assert.ok(await noScroll(), 'задание без горизонтальной прокрутки при 320 px');
    const box = await page.locator('.mx-opt >> nth=0').boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `крупная цель нажатия: ${box.width}×${box.height}`);
    assert.equal(await page.locator('#mx-ok').isDisabled(), true, 'пока не выбран вариант, «Ответить» недоступна');
  }
  const correct = await page.evaluate(async ([s, l]) => (await import('./iq-matrices.js')).makeMatrix(Number(s), Number(l)).correct, [seed, level]);
  // 0 — верный, 1 — «Не знаю», остальные — неверный: ошибаемся в 4-м и 9-м задании, пропускаем 11-е
  if (i === 10) await page.click('#mx-idk');
  else {
    const pick = i === 3 || i === 8 ? (correct + 1) % 6 : correct;
    await page.click(`.mx-opt[data-i="${pick}"]`);
    assert.equal(await page.getAttribute(`.mx-opt[data-i="${pick}"]`, 'aria-pressed'), 'true');
    await page.click('#mx-ok');
  }
}
await finish();
assert.match(await text('#bt-result .res-row[data-test="matrices"]'), /9/, 'верных 9 из 12 (две ошибки и «Не знаю»)');
assert.match(await text('#bt-result .res-row[data-test="matrices"]'), /Верно 9 из 12/, 'сырой результат словами: верные ответы');
assert.match(await text('#bt-iq-line'), /Условный индекс логики: \d+ из 100 \(примерно от \d+ до \d+\) — не IQ/, 'в итоге есть условный индекс с диапазоном и пометкой «не IQ»');
assert.match(await text('#bt-iq-line'), /нет данных о других людях/, 'в итоге объяснено, почему это не IQ');
await page.click('#bt-done');
{
  const run = await lastRun(), m = run.tests.matrices;
  assert.ok(m.ok && m.metrics.n === 12 && m.metrics.correct === 9, JSON.stringify(m.metrics));
  assert.equal(m.metrics.maxScore, 78); assert.equal(m.metrics.score, 78 - 4 - 9 - 11);
  assert.ok(m.extra.seed > 0 && m.trials.length === 12, 'зерно и пробы сохранены');
  assert.equal(run.mode, 'single:matrices');
}

// ---------- 2. Числовые ряды: 12 заданий (выбор и ввод цифрами) ----------
await startSingle('seq12');
await page.click('#bt-go');
for (let i = 0; i < 12; i++) {
  await until(page, k => document.getElementById('sq-item')?.dataset.i === String(k), i);
  const { seed, level } = await page.evaluate(() => ({ ...document.getElementById('sq-item').dataset }));
  const item = await page.evaluate(async ([s, l]) => { const x = (await import('./iq-series.js')).makeSeriesItem(Number(s), Number(l)); return { answer: x.answer, options: x.options, terms: x.terms }; }, [seed, level]);
  if (i === 0) {
    assert.equal(await text('#sq-terms'), `${item.terms.join(',  ')},  ?`, 'ряд показан текстом');
    assert.equal(await page.locator('.series-opt').count(), 6);
    assert.ok(await noScroll(), 'ряд без горизонтальной прокрутки при 320 px');
    assert.equal(await page.getAttribute('#sq-mode', 'aria-expanded'), 'false');
  }
  if (i === 7) await page.click('#sq-idk');
  else if (i === 5) {                                              // ввод числа цифрами
    await page.click('#sq-mode');
    assert.equal(await page.getAttribute('#sq-mode', 'aria-expanded'), 'true');
    for (const ch of String(item.answer)) await page.click(`#kp-${ch}`);
    await waitText(page, '#sq-out', String(item.answer));
    await page.click('#kp-ok');
  } else {
    const v = i === 2 ? item.options.find(o => o !== item.answer) : item.answer;
    await page.click(`.series-opt[data-v="${v}"]`);
  }
}
await finish();
assert.match(await text('#bt-result .res-row[data-test="seq12"]'), /10/, 'верно 10 из 12 (ошибка и «Не знаю»)');
await page.click('#bt-done');
{
  const m = (await lastRun()).tests.seq12;
  assert.ok(m.ok && m.metrics.n === 12 && m.metrics.correct === 10 && m.metrics.typed === 1, JSON.stringify(m.metrics));
  assert.equal(m.metrics.maxScore, 78); assert.equal(m.metrics.score, 78 - 3 - 8);
  assert.ok(m.trials.some(x => x.typed === 1), 'ответ, введённый цифрами, помечен');
}

// ---------- 3. Слова и логика: 15 заданий ----------
await startSingle('verbal');
await page.click('#bt-go');
for (let i = 0; i < 15; i++) {
  await until(page, k => document.getElementById('vb-item')?.dataset.i === String(k), i);
  const { seed, id } = await page.evaluate(() => ({ ...document.getElementById('vb-item').dataset }));
  const item = await page.evaluate(async ([s, k]) => (await import('./iq-verbal.js')).makeVerbalSet(Number(s)).find((x, j) => j === Number(k)), [seed, i]);
  assert.equal(item.id, id, 'разметка и генератор показывают одно и то же задание');
  if (i === 0) {
    assert.ok(await noScroll(), 'слова и логика: без горизонтальной прокрутки при 320 px');
    assert.ok(await page.locator('.iq-tag').isVisible(), 'вид задания подписан словами');
    assert.equal(await page.locator('#vb-item h3').evaluate(n => document.activeElement === n), true, 'фокус на заголовке задания (для диктора)');
  }
  if (i === 4) await page.click('#vb-idk');
  else await page.click(`#vb-item .series-opt[data-i="${i === 9 ? (item.correct + 1) % item.options.length : item.correct}"]`);
}
await finish();
assert.match(await text('#bt-result .res-row[data-test="verbal"]'), /13/, 'верно 13 из 15');
await page.click('#bt-done');
{
  const m = (await lastRun()).tests.verbal;
  assert.ok(m.ok && m.metrics.n === 15 && m.metrics.correct === 13, JSON.stringify(m.metrics));
  assert.equal(m.trials.length, 15); assert.ok(m.extra.seed > 0);
}

// ---------- 4. Вращение фигур: «такая же или зеркальная?» и выбор из четырёх ----------
await startSingle('rotation');
assert.match(await text('#bt-stage'), /описана по рядам клеток/, 'сказано про описание фигур словами');
assert.ok(await page.locator('#bt-skip').isVisible(), 'зрительный тест можно пропустить');
await page.click('#bt-go');
for (let i = 0; i < 12; i++) {
  await until(page, k => document.getElementById('rt-item')?.dataset.i === String(k), i);
  const { seed, level, format } = await page.evaluate(() => ({ ...document.getElementById('rt-item').dataset }));
  const item = await page.evaluate(async ([s, l]) => { const x = (await import('./iq-rotation.js')).makeRotation(Number(s), Number(l)); return { correct: x.correct, n: x.options.length }; }, [seed, level]);
  if (i === 0 || i === 2) {
    assert.equal(format, i === 0 ? 'pair' : 'pick4');
    for (const im of await page.locator('.rt-img').all()) assert.match(await im.getAttribute('aria-label'), /Фигура из \d клеток, ряд 1:/, 'у фигуры есть описание по рядам');
    assert.ok(await noScroll(), `вращение (${format}): без горизонтальной прокрутки при 320 px`);
    const b = await page.locator(format === 'pair' ? '.series-opt >> nth=0' : '.mx-opt >> nth=0').boundingBox();
    assert.ok(b.height >= 44, `крупная цель нажатия: ${b.height}`);
  }
  if (format === 'pair') await page.click(`#rt-item .series-opt[data-i="${i === 1 ? 1 - item.correct : item.correct}"]`);
  else { await page.click(`.mx-opt[data-i="${i === 5 ? (item.correct + 1) % 4 : item.correct}"]`); await page.click('#mx-ok'); }
}
await finish();
assert.match(await text('#bt-result .res-row[data-test="rotation"]'), /10/, 'верно 10 из 12 (две ошибки)');
await page.click('#bt-done');
{
  const m = (await lastRun()).tests.rotation;
  assert.ok(m.ok && m.metrics.n === 12 && m.metrics.correct === 10, JSON.stringify(m.metrics));
  assert.equal(m.metrics.maxScore, 78); assert.equal(m.metrics.score, 78 - 2 - 6);
}

// ---------- управляемое время для тестов на скорость и память ----------
await page.clock.install({ time: new Date() });
const pauseClock = async () => { const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(now + 1000); };
await pauseClock();
const step = ms => page.clock.runFor(ms);
const snap = () => page.evaluate(() => {
  const q = id => document.getElementById(id), st = q('bt-stage');
  if (q('bt-result')) return { done: true };
  if (!st) return { none: true };
  const lit = [...document.querySelectorAll('.cs-blk')].findIndex(b => b.classList.contains('lit'));
  return { test: st.dataset.test, phase: st.dataset.phase, go: !!q('bt-go'), stateSkip: !!q('bt-state-skip'), lit: lit >= 0 ? lit : null,
    ink: q('s4-word')?.dataset.ink ?? null, kind: q('s4-word')?.dataset.kind ?? null, sym: q('cd-stim')?.dataset.sym ?? null,
    key: [...document.querySelectorAll('#cd-key .cd-cell')].map(c => Number(c.dataset.digit)) };
});

// ---------- 5. Блоки Корси: бот запоминает подсветку по DOM; длины 2–4 верно, на длине 5 дважды сбивается ----------
await page.click('#bt-single-corsi');
await until(page, () => !!document.getElementById('bt-state-skip')); await page.click('#bt-state-skip');
await until(page, () => !!document.getElementById('bt-go'));
assert.match(await text('#bt-stage'), /Блок 1 … Блок 9/, 'сказано про нумерацию блоков для диктора');
assert.equal(await page.isChecked('#cs-voice'), false, 'озвучка блоков по умолчанию выключена');
assert.ok(await page.locator('#bt-skip').isVisible());
await page.click('#bt-go');
{
  let seen = [], wasLit = null, failsAtFive = 0, checkedUi = false;
  for (let k = 0; k < 4000; k++) {
    const s = await snap();
    if (s.done) break;
    if (s.phase === 'show') {
      if (s.lit !== null && wasLit === null) seen.push(s.lit);
      wasLit = s.lit;
      if (!checkedUi && seen.length) {
        checkedUi = true;
        assert.equal(await page.locator('.cs-blk').count(), 9);
        assert.equal(await page.getAttribute('.cs-blk >> nth=2', 'aria-label'), 'Блок 3', 'у блока есть имя для диктора');
        assert.ok(await noScroll(), 'поле Корси без горизонтальной прокрутки при 320 px');
        const bb = await page.locator('.cs-blk >> nth=0').boundingBox();
        assert.ok(bb.width >= 40 && bb.height >= 40, `блок достаточно крупный: ${bb.width}×${bb.height}`);
      }
      await step(100);
    } else if (s.phase === 'input') {
      const order = seen.length >= 5 ? [...seen].reverse() : seen;
      if (seen.length >= 5) failsAtFive++;
      for (const b of order) await page.click(`.cs-blk[data-b="${b}"]`);
      seen = []; wasLit = null;
      await step(100);
    } else if (s.go) { await page.click('#bt-go'); await step(50); }
    else await step(100);
  }
  await finish();
  assert.equal(failsAtFive, 2, 'на длине 5 — две неудачи подряд, тест остановился');
}
assert.match(await text('#bt-result .res-row[data-test="corsi"]'), /4/, 'объём 4');
await page.click('#bt-done');
{
  const m = (await lastRun()).tests.corsi;
  assert.ok(m.ok && m.metrics.span === 4 && m.metrics.attempts === 5 && m.metrics.correct === 3 && m.metrics.score === 12, JSON.stringify(m.metrics));
  assert.equal(m.trials.length, 5); assert.deepEqual(m.trials.map(x => x.len), [2, 3, 4, 5, 5]);
}
await pauseClock();

// ---------- 6. Струп: 40 проб; ответ на совпадение 450 мс, на нейтральное 500, на несовпадение 650 (в управляемом времени) ----------
await page.click('#bt-single-stroop40');
await until(page, () => !!document.getElementById('bt-state-skip')); await page.click('#bt-state-skip');
await until(page, () => !!document.getElementById('bt-go'));
assert.ok(await page.locator('#bt-skip').isVisible(), 'тест на цвета можно пропустить');
await page.click('#bt-go');
{
  let answered = 0, wrongLeft = 3;
  for (let k = 0; k < 6000; k++) {
    const s = await snap();
    if (s.done) break;
    if (s.test === 'stroop40' && s.ink) {
      if (answered === 0) assert.ok(await noScroll(), 'Струп: без горизонтальной прокрутки при 320 px');
      await step(s.kind === 'con' ? 450 : s.kind === 'neu' ? 500 : 650);
      const wrong = s.kind === 'inc' && wrongLeft > 0 && (answered % 7 === 0 || answered > 30);
      const colors = ['red', 'blue', 'green', 'yellow'];
      const pick = wrong ? colors.find(c => c !== s.ink) : s.ink;
      if (wrong) wrongLeft--;
      await page.click(`.stroop-btn[data-c="${pick}"]`); answered++;
      await step(10);
    } else if (s.go) { await page.click('#bt-go'); await step(50); }
    else await step(10);                                            // мелкий шаг: время ответа в управляемых часах считается от появления слова
  }
  await finish();
  assert.equal(answered, 40);
}
await page.click('#bt-done');
{
  const m = (await lastRun()).tests.stroop40;
  assert.ok(m.ok && m.metrics.n === 40 && m.metrics.errorsIncongruent === 3 && m.metrics.correct === 37, JSON.stringify(m.metrics));
  assert.ok(m.metrics.meanCongruent >= 450 && m.metrics.meanCongruent <= 470, `совпадение: ${m.metrics.meanCongruent}`);
  assert.ok(m.metrics.meanNeutral >= 500 && m.metrics.meanNeutral <= 520, `нейтральные: ${m.metrics.meanNeutral}`);
  assert.ok(m.metrics.meanIncongruent >= 650 && m.metrics.meanIncongruent <= 670, `несовпадение: ${m.metrics.meanIncongruent}`);
  assert.ok(m.metrics.interference >= 130 && m.metrics.interference <= 170 && m.metrics.facilitation >= 30 && m.metrics.facilitation <= 70, JSON.stringify(m.metrics));
  assert.equal(m.trials.length, 40);
}
await pauseClock();

// ---------- 7. Кодирование символов: 90 секунд, ответ за секунду, каждый пятый — неверный ----------
await page.click('#bt-single-coding');
await until(page, () => !!document.getElementById('bt-state-skip')); await page.click('#bt-state-skip');
await until(page, () => !!document.getElementById('bt-go'));
assert.match(await text('#bt-stage'), /Знаки названы словами для экранного диктора/);
await page.click('#bt-go');
{
  let answered = 0;
  for (let k = 0; k < 4000; k++) {
    const s = await snap();
    if (s.done) break;
    if (s.test === 'coding' && s.sym !== null) {
      if (answered === 0) {
        assert.match(await page.getAttribute('#cd-key', 'aria-label'), /^Ключ: плюс — \d; крестик — \d;/, 'ключ описан словами');
        assert.match(await page.getAttribute('#cd-stim', 'aria-label'), /^Знак: /, 'знак назван словами');
        assert.ok(await noScroll(), 'кодирование: без горизонтальной прокрутки при 320 px');
        const bb = await page.locator('.cd-pad .kp >> nth=0').boundingBox();
        assert.ok(bb.height >= 44 && bb.width >= 44, `цифры крупные: ${bb.width}×${bb.height}`);
      }
      await step(1000);
      const right = s.key[Number(s.sym)], digit = answered % 5 === 4 ? (right % 9) + 1 : right;
      try { await page.click(`.cd-pad .kp[data-d="${digit}"]`, { timeout: 1500 }); answered++; } catch { /* время вышло во время шага: знака уже нет */ }
    } else if (s.go) { await page.click('#bt-go'); await step(50); }
    else await step(300);
  }
  await finish();
  assert.ok(answered >= 85 && answered <= 91, `ответов за 90 секунд: ${answered}`);
}
await page.click('#bt-done');
{
  const m = (await lastRun()).tests.coding;
  assert.ok(m.ok && m.metrics.n >= 85 && m.metrics.accuracy >= 0.78 && m.metrics.accuracy <= 0.82 && m.metrics.meanMs >= 1000 && m.metrics.meanMs <= 1150, JSON.stringify(m.metrics));
  assert.ok(m.metrics.correct >= 68 && m.metrics.perMinute >= 46 && m.metrics.perMinute <= 52, JSON.stringify(m.metrics));
}
await page.clock.resume();

// ---------- пропуск зрительного теста ----------
await page.click('#bt-single-matrices');
await until(page, () => !!document.getElementById('bt-state-skip'));
await page.click('#bt-state-skip');
await until(page, () => !!document.getElementById('bt-skip'));
await page.click('#bt-skip');
await finish();
assert.match(await text('#bt-result'), /пропущено: пропущено по желанию/);
await page.click('#bt-done');

// ---------- 8. Профиль характера (ориентир): самоописание, а не тест ----------
await until(page, () => !!document.getElementById('bt-profile'));
assert.match(await text('#pf-card-not'), /а не тест и не диагноз/, 'на карточке сказано, что это не тест и не диагноз');
await page.click('#bt-profile');
await until(page, () => !!document.getElementById('bt-state-skip')); await page.click('#bt-state-skip');
await until(page, () => !!document.getElementById('bt-go'));
assert.match(await text('#bt-stage'), /не проверялись на людях/, 'во вступлении честная оговорка');
await page.click('#bt-go');
for (let i = 0; i < 25; i++) {
  await until(page, k => document.getElementById('pf-item')?.dataset.i === String(k), i);
  if (i === 0) {
    assert.equal(await page.locator('#pf-item .series-opt').count(), 5);
    assert.equal(await page.locator('#pf-pos').evaluate(n => document.activeElement === n), true, 'фокус на заголовке утверждения');
    assert.ok(await noScroll(), 'профиль: без горизонтальной прокрутки при 320 px');
  }
  if (i === 3) await page.click('#pf-skip'); else await page.click(`#pf-item .series-opt[data-v="${i % 2 ? 4 : 2}"]`);
}
await finish();
assert.match(await text('#pf-n'), /Отвечено утверждений: 24 из 25/);
assert.match(await text('#pf-not'), /не сравнивается с другими людьми/);
assert.equal(await page.locator('#pf-result .pf-row').count(), 5);
assert.match(await text('#pf-result .pf-row[data-scale="order"]'), /Порядок и планирование.*из 5 · (скорее не про меня|посередине|скорее про меня)/s, 'число и слово, не только полоса');
assert.match(await page.getAttribute('#pf-result .pf-bar >> nth=0', 'aria-label'), /из 5/, 'полоса описана словами');
assert.ok(await noScroll(), 'итог профиля без горизонтальной прокрутки при 320 px');
await page.click('#bt-done');
{
  const run = await lastRun(), m = run.tests.selfprofile;
  assert.equal(run.mode, 'selfprofile'); assert.ok(m.ok && m.metrics.n === 24, JSON.stringify(m.metrics));
  assert.equal(m.trials.length, 25);
}
await until(page, () => !!document.getElementById('pf-last'));
assert.match(await text('#pf-last'), /Порядок и планирование: [\d,]+;/, 'на карточке видно последний результат');
assert.equal(await text('#bt-profile'), 'Заполнить ещё раз');
await page.click('details.run:first-of-type summary');
assert.match(await text('details.run[open]'), /Профиль характера \(ориентир\)/, 'прохождение профиля показывается в истории');

// ---------- условный индекс логики на экране тестов ----------
await until(page, () => !!document.getElementById('bt-iq') && !!document.getElementById('iq-value'));
{
  const cur = await page.evaluate(async () => { const st = await import('./store.js'), c = await import('./bt-core.js'), i = await import('./iq-index.js'); const runs = c.runsOf(st.state.events); const r = i.logicIndexNow(runs); return { ...r, runsWithLogic: i.logicProgress(runs).length }; });
  assert.equal(cur.items, 51, 'в основе 12 + 12 + 15 + 12 заданий последних прохождений');
  assert.deepEqual(cur.parts.map(p => p.id).sort(), ['matrices', 'rotation', 'seq12', 'verbal']);
  assert.ok(cur.index >= 70 && cur.index <= 85, `ожидаемый индекс по известным ответам около 78: ${cur.index}`);
  assert.ok(cur.hi - cur.lo >= 15 && cur.lo < cur.index && cur.index < cur.hi, `диапазон широкий: ${cur.lo}–${cur.hi}`);
  assert.equal(cur.runsWithLogic, 4, 'пропущенный тест в динамику не попал');
  assert.equal(await text('#iq-value strong'), String(cur.index));
  assert.match(await text('#iq-title'), /Условный индекс логики \(для интереса, не медицинский IQ\)/);
  assert.match(await text('#iq-range'), new RegExp(`от ${cur.lo} до ${cur.hi}`));
  assert.match(await text('#iq-from'), /Матрицы.*Числовые ряды: 12 заданий.*Слова и логика.*Вращение фигур/);
  assert.match(await text('#iq-not-iq'), /не IQ и не диагноз.*нет данных о других людях/);
  assert.match(await page.getAttribute('#iq-bar', 'aria-label'), new RegExp(`индекс ${cur.index}, примерный диапазон от ${cur.lo} до ${cur.hi}`), 'шкала описана словами');
  assert.match(await text('#iq-change'), /Последнее прохождение выше|Последнее прохождение ниже|в пределах случайного разброса/, 'динамика словами, не только цветом');
  assert.match(await page.getAttribute('#iq-spark', 'aria-label'), /^График индекса по прохождениям: \d+/);
  assert.equal(await page.evaluate(() => document.getElementById('iq-how').open), false);
  await page.click('#iq-how summary');
  assert.match(await text('#iq-how'), /неопределённость/);
  assert.ok(await noScroll(), 'карточка индекса без горизонтальной прокрутки при 320 px');
  assert.ok(await page.evaluate(() => { const r = document.getElementById('bt-iq').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }), 'карточка в пределах экрана');
}

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E TESTS2 OK');
