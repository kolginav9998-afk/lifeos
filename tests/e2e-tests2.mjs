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
for (const id of ['matrices']) assert.ok(ids.includes(id), `в реестре есть ${id}`);
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
