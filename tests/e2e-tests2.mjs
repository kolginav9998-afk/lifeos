// Новые тесты на логику, память и скорость: «бот» проходит каждый тест, отвечая верно по тому же генератору, что и приложение (зерно лежит в разметке).
// Проверяем экран 320 px, подписи для диктора, честные подписи («не IQ»), сохранённую запись и выгрузку. Ожидания — через until/waitText/eventually.
import assert from 'node:assert/strict';
import { launch, tab, until, appReady, waitText, waitCount, eventually } from './helpers.mjs';

const t = await launch({ viewport: { width: 320, height: 640 } });
const { page, errors } = t;
await page.goto(t.url);
await appReady(page);
await tab(page, 'tests');
const text = sel => page.textContent(sel);
const SAVED = () => page.evaluate(async () => (await import('./store.js')).state.events.filter(e => e.type === 'testrun').map(e => e.payload).sort((a, b) => a.startedAt - b.startedAt));

// ---------- список: группы, пояснения, 320 px без горизонтальной прокрутки ----------
const ids = await page.evaluate(async () => (await import('./bt-core.js')).TESTS.map(x => x.id));
await waitCount(page, '.test-row', ids.length);
for (const id of ['matrices', 'seq12', 'verbal', 'rotation']) assert.ok(ids.includes(id), `в реестре есть ${id}`);
assert.ok(await page.locator('.tg-title').count() >= 4, 'тесты разбиты на группы');
assert.match(await text('[data-group="logic"]'), /Матрицы/);
assert.match(await text('.tg-note'), /не настоящий IQ-тест/, 'честная подпись у группы «Логика»');
await page.click('.test-row[data-test="matrices"] .what summary');
assert.match(await text('.test-row[data-test="matrices"] .what'), /Время не ограничено/, 'пояснение «Что измеряет этот тест»');
const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
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

// ---------- пропуск зрительного теста ----------
await page.click('#bt-single-matrices');
await until(page, () => !!document.getElementById('bt-state-skip'));
await page.click('#bt-state-skip');
await until(page, () => !!document.getElementById('bt-skip'));
await page.click('#bt-skip');
await finish();
assert.match(await text('#bt-result'), /пропущено: пропущено по желанию/);
await page.click('#bt-done');

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E TESTS2 OK');
