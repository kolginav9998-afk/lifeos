// Сквозная проверка ежедневной батареи: «бот» проходит быструю проверку под управляемыми часами, затем аналитика и выгрузка.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, tab, until } from './helpers.mjs';

const t = await launch({ ctxOptions: { permissions: ['clipboard-read', 'clipboard-write'] } });
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);

// ---------- меню тестов ----------
await tab(page, 'tests');
assert.equal(await text('#title'), 'Проверка');
assert.deepEqual(await page.locator('#subnav button').allTextContents(), ['Учёба', 'Тесты', 'Аналитика', 'Цели']);
assert.equal(await page.locator('.test-row').count(), 10);
assert.match(await text('#bt-status'), /ещё не проходил/);

// управляемое время: часы ставим после загрузки и останавливаем
await page.clock.install({ time: new Date() });
const pause = async () => { const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(now + 1000); };
await pause();
const step = ms => page.clock.runFor(ms);

const snap = () => page.evaluate(() => {
  const st = document.getElementById('bt-stage'), q = id => document.getElementById(id);
  if (q('bt-result')) return { done: true };
  if (!st) return { none: true };
  return {
    test: st.dataset.test, phase: st.dataset.phase, go: !!q('bt-go'), stateOk: !!q('bt-state-ok'),
    boxState: q('bt-box')?.dataset.state ?? null, hasBox: !!q('bt-box'), stim: q('bt-stim')?.dataset.go ?? null,
    ink: q('bt-word')?.dataset.ink ?? null, digit: q('bt-digit')?.textContent ?? null,
    prompt: st.querySelector('p.muted')?.textContent ?? '', learnWord: q('bt-learn-word')?.textContent ?? null, recallWord: q('bt-recall-word')?.textContent ?? null,
    problem: q('bt-problem')?.textContent ?? null, next: q('bt-schulte-next')?.textContent ?? null, hold: q('bt-hold')?.dataset.target ?? null,
    opts: st.querySelectorAll('.series-opt').length,
  };
});
const tap = async (sel, o = {}) => { try { await page.click(sel, { timeout: 1500, ...o }); return true; } catch { return false; } };
const evalMath = s => { const e = s.replace(/\s*=\s*\?/, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-'); return Function(`"use strict";return (${e})`)(); };

async function runBot({ useState }) {
  const learned = new Set(); let digitsSeen = [], lastDigit = '', steps = 0, clicked = 0;
  for (; steps < 9000; steps++) {
    const s = await snap();
    if (s.done) return { steps };
    if (s.none) { await step(200); continue; }
    let adv = 150;
    if (s.go) { await page.click('#bt-go'); adv = 50; }
    else if (s.test === 'state') {
      if (useState) { await page.click('#bt-stage .rate[data-field="energy"][data-v="4"]'); await page.check('#bt-st-noise'); await page.click('#bt-state-ok'); } else await page.click('#bt-state-skip');
    }
    else if (s.phase === 'count') adv = 300;
    else if (s.test === 'reaction' && s.hasBox) { if (s.boxState === 'go') { await step(260); await tap('#bt-box'); adv = 50; } else adv = 300; }
    else if (s.test === 'gonogo' && s.stim !== null) { if (s.stim === '1') { await step(300); await tap('#bt-box'); } adv = 100; }
    else if (s.test === 'stroop' && s.ink) { await step(500); await tap(`.stroop-btn[data-c="${s.ink}"]`); adv = 50; }
    else if (s.test === 'digits' && s.phase === 'show') { if (s.digit && !lastDigit) digitsSeen.push(s.digit); lastDigit = s.digit; adv = 100; }
    else if (s.test === 'digits' && s.phase === 'input') {
      lastDigit = '';
      const seq = /наперёд/.test(s.prompt) ? [...digitsSeen].reverse() : digitsSeen;
      for (const d of seq) await page.click(`#kp-${d}`);
      await page.click('#kp-ok'); digitsSeen = []; adv = 50;
    }
    else if (s.test === 'digits') { lastDigit = ''; adv = 100; }
    else if (s.test === 'words' && s.learnWord) { learned.add(s.learnWord); adv = 300; }
    else if (s.test === 'words' && s.recallWord) { await step(300); await tap(learned.has(s.recallWord) ? '#bt-yes' : '#bt-no'); adv = 50; }
    else if (s.test === 'math' && s.problem) {
      const ans = String(evalMath(s.problem)); await step(400);
      for (const ch of ans) await page.click(`#kp-${ch}`);
      await page.click('#kp-ok'); adv = 50;
    }
    else if (s.test === 'series' && s.opts) { await step(400); await tap('.series-opt >> nth=0'); adv = 50; }
    else if (s.test === 'schulte' && s.next) { const k = s.next.match(/\d+/)[0]; await step(150); await tap(`.sh-cell[data-n="${k}"]`); adv = 20; }
    else if (s.test === 'time' && s.hold) {
      const b = await page.locator('#bt-hold').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down(); await step(Number(s.hold) * 1.1); await page.mouse.up(); adv = 1500;
    }
    else if (s.test === 'recall' && s.opts) { await step(400); await tap('.series-opt >> nth=0'); adv = 50; }
    await step(adv);
  }
  throw new Error('бот не дошёл до конца');
}

// ---------- быстрая проверка ----------
await page.click('#bt-quick');
assert.equal(await page.isVisible('#bt-run'), true);
const r1 = await runBot({ useState: true });
console.log('quick battery steps:', r1.steps);
assert.equal(await page.locator('#bt-result .res-row').count(), 7, 'слова, реакция, жми/не жми, цвет, цифры, счёт, знания: знания пропущены, т. к. нет карточек → 7 строк');
assert.match(await text('#bt-composite'), /норма накапливается/);
const row = id => text(`#bt-result .res-row[data-test="${id}"]`);
assert.match(await row('reaction'), /мс/);
assert.match(await row('digits'), /\d/);
assert.match(await text('#bt-result'), /пропущено: нет изученных карточек/);
await page.click('#bt-done');
assert.equal(await page.isVisible('#bt-run'), false);
assert.match(await text('#bt-status'), /Сегодня пройдено: 1/);

// что именно сохранено
const saved = await page.evaluate(async () => (await import('./store.js')).state.events.filter(e => e.type === 'testrun').map(e => e.payload));
assert.equal(saved.length, 1);
const run = saved[0];
assert.equal(run.mode, 'quick'); assert.equal(run.aborted, false);
assert.deepEqual(run.state, { energy: 4, caffeine3h: false, noise: true });
for (const id of ['reaction', 'gonogo', 'stroop', 'digits', 'math', 'words']) assert.ok(run.tests[id]?.metrics, `есть метрики: ${id}`);
assert.equal(run.tests.recall.skipped, 'нет изученных карточек');
assert.ok(run.tests.reaction.metrics.n === 5 && run.tests.reaction.trials.length >= 5, 'пробы реакции сохранены');
assert.ok(run.tests.words.metrics.hits >= 6 && run.tests.words.metrics.falseAlarms === 0, 'бот помнит слова: узнавание высокое');
assert.equal(run.tests.digits.metrics.forward, 7); assert.equal(run.tests.digits.metrics.backward, 7);
assert.ok(run.tests.math.metrics.n >= 10 && run.tests.math.metrics.accuracy === 1, `счёт: ${JSON.stringify(run.tests.math.metrics)}`);
assert.ok(run.tests.gonogo.metrics.commissions === 0, 'бот не нажимал на «не жми»');
assert.ok(run.tests.stroop.metrics.accuracy === 1);
assert.ok(run.env.app === 'web' && run.env.w > 0);
assert.ok(run.durationMs > 120000, `длительность в управляемом времени: ${run.durationMs}`);
assert.equal(await page.locator('.run').count(), 1);

// ---------- прерывание: сохраняется пройденное ----------
await page.click('#bt-single-reaction');
await until(page, () => !!document.getElementById('bt-go') || !!document.getElementById('bt-state-skip'));
await page.click('#bt-state-skip');
await until(page, () => !!document.getElementById('bt-go'));
await page.click('#bt-go');
await step(1000);
await page.click('#bt-abort');
await until(page, () => document.getElementById('bt-run').hidden);
assert.equal(await page.locator('.run').count(), 1, 'прерванный тест без результатов не сохраняется');

// ---------- повторение карточек → проверка знаний ----------
await page.clock.resume();
await tab(page, 'learn');
await page.click('.track-card[data-track="health"]');
await page.click('#track-start');
for (let i = 0; i < 5; i++) { await page.click('#sess-show'); await page.click('.grade.good'); }
await page.click('#sess-done');
await pause();
await tab(page, 'tests');
await page.click('#bt-single-recall');
await until(page, () => !!document.getElementById('bt-state-skip'));
await page.click('#bt-state-skip');
const r2 = await runBot({ useState: false });
const recallRow = await row('recall');
assert.match(recallRow, /%/);
await page.click('#bt-done');
const runs2 = await page.evaluate(async () => (await import('./store.js')).state.events.filter(e => e.type === 'testrun').map(e => e.payload));
assert.equal(runs2.length, 2);
const rc = runs2[1].tests.recall.metrics;
assert.ok(rc.n >= 4 && rc.n <= 5 && rc.byCategory.health.n === rc.n, `проверка знаний: ${JSON.stringify(rc)}`);
await page.clock.resume();

// ---------- аналитика на накопленных данных ----------
await page.evaluate(async () => {
  const store = await import('./store.js'); const core = await import('./bt-core.js'); const diary = await import('./diary.js');
  const base = new Date(); base.setHours(9, 0, 0, 0);
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const evs = [];
  for (let i = 30; i >= 3; i--) {
    const startedAt = base.getTime() - i * 86400000;
    const sleep = 5 + rnd() * 4, q = (sleep - 7) * 1.5 + (rnd() - 0.5);
    const r = (id, metrics) => [id, { metrics, ms: 20000, trials: [] }];
    const results = Object.fromEntries([
      r('reaction', { n: 5, median: Math.round(360 - 20 * q), mean: 370, sd: 30, best: 300, lapses: 0, falseStarts: 0 }),
      r('gonogo', { n: 16, hits: 11, omissions: 1, commissions: 1, correctRejections: 3, accuracy: 0.87, inhibition: 0.75, medianRT: 400, dPrime: 1.5 + 0.3 * q }),
      r('stroop', { n: 12, correct: 11, accuracy: 0.92, meanCongruent: 700, meanIncongruent: 900, interference: Math.round(220 - 15 * q), errorsIncongruent: 1 }),
      r('digits', { forward: 6, backward: 4, total: Math.round(10 + q), attempts: 8 }),
      r('math', { n: 12, correct: 10, accuracy: 0.83, meanMs: 3000, perMinute: 9 + q, maxLevel: 3 }),
    ]);
    const payload = core.makeRun({ mode: 'quick', startedAt, durationMs: 250000, state: null, results });
    evs.push(core.makeRunEvent(payload, startedAt));
    const d = new Date(startedAt); const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    evs.push(diary.makeCheckin('m', date, { sleepHours: Math.round(sleep * 4) / 4, mood: 3 }, '', startedAt));
  }
  await store.saveMany(evs);
});
await tab(page, 'insights');
assert.equal(await text('#title'), 'Аналитика');
await until(page, () => /Прохождений: 3\d/.test(document.getElementById('ins-count').textContent));
assert.ok(await page.locator('#ins-domains .zrow').count() >= 3, 'отклонения по областям');
await until(page, () => !!document.querySelector('.insight[data-id="rel-sleepHours-composite"]'));
assert.match(await text('.insight[data-id="rel-sleepHours-composite"]'), /не доказанная причина/);
assert.ok(await page.locator('#view-insights .entry[data-test="reaction"] svg.spark').count() === 1, 'график динамики');

// выгрузка
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ins-zip')]);
const zipPath = await dl.path();
const bytes = fs.readFileSync(zipPath);
assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');
assert.match(dl.suggestedFilename(), /^lifeos-analytics-\d{4}-\d{2}-\d{2}\.zip$/);
const listing = execFileSync('python3', ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(",".join(sorted(z.namelist())))', zipPath], { encoding: 'utf8' }).trim();
for (const n of ['README.txt', 'daily.csv', 'test_runs.csv', 'test_metrics.csv', 'test_trials.csv', 'testruns.json']) assert.ok(listing.includes(n), `в архиве есть ${n}`);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#ins-excel')]);
assert.match(fs.readFileSync(await dl2.path(), 'utf8'), /^﻿date;runs;composite/);
await page.click('#ins-copy');
assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Life OS[\s\S]*sleepHours/);

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E TESTS OK');
