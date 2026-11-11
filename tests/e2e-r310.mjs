// R3.10: цели уроков, конспект → карточка, дневник практики с недельными целями, подсказка «нового давно нет» и др.
import assert from 'node:assert/strict';
import { launch, tab, until } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);
const clearToast = () => page.evaluate(async () => (await import('./ui.js')).clearToast());
const evs = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);
const day = n => page.evaluate(async k => { const ev = await import('./events.js'); return ev.addDays(ev.todayStr(), k); }, n);

// ---------- цели уроков и конспект → карточка ----------
await tab(page, 'learn');
await page.click('.track-card[data-track="english"]');
await page.click('.lesson[data-lesson="en-01"] summary');
assert.equal(await text('.lesson[data-lesson="en-01"] .lesson-goal'), 'После урока я смогу: выбирать пять частотных слов на день и повторять их вечером');
assert.match(await text('.lesson[data-lesson="en-13"] .lesson-goal'), /^После урока я смогу: заказать еду и напиток/);
assert.equal(await page.locator('.lesson .lesson-goal').count(), 16, 'цель у каждого урока курса');
assert.ok(!/null/.test(await text('.lesson[data-lesson="en-01"]')));
await page.click('.note-card[data-note-card="en-01"]'); await toast(/Сначала запиши конспект/);
await page.fill('.lesson[data-lesson="en-01"] .lesson-note', 'Учить по пять слов в день и повторять вечером'); await clearToast();
await page.click('.note-card[data-note-card="en-01"]'); await toast(/Карточка добавлена в «Свои карточки»/);
let cards = await evs('ucard'); assert.equal(cards.length, 1);
assert.equal(cards[0].id, 'ucard:ln-en-01'); assert.match(cards[0].payload.q, /: что главное\?$/); assert.equal(cards[0].payload.a, 'Учить по пять слов в день и повторять вечером');
await clearToast();
await page.fill('.lesson[data-lesson="en-01"] .lesson-note', 'Пять слов в день, вечером повторение'); await page.click('.note-card[data-note-card="en-01"]'); await toast(/Карточка обновлена/);
cards = await evs('ucard'); assert.equal(cards.length, 1, 'вторая карточка не создаётся'); assert.equal(cards[0].payload.a, 'Пять слов в день, вечером повторение');
await page.click('#toast button');                                      // «Отменить» возвращает прежний текст
await until(page, () => true); await page.waitForTimeout(200);
assert.equal((await evs('ucard'))[0].payload.a, 'Учить по пять слов в день и повторять вечером');
await page.click('#learn-back');
await page.click('.track-card[data-track="my"]');
await until(page, () => /что главное/.test(document.getElementById('view-learn').textContent));
await page.click('#learn-back');

// ---------- дневник практики и недельные цели ----------
assert.match(await text('#practice-card'), /Пока нет занятий за неделю/);
await page.evaluate(async () => {
  const store = await import('./store.js'), ev = await import('./events.js'), ac = await import('./academy.js'), sp = await import('./speaking.js');
  const t0 = ev.todayStr(), en = ac.trackById('english');
  await store.saveMany([ac.makeLessonDone(en, en.lessons[0], ev.addDays(t0, -1)), sp.makeSpeak({ lang: 'english', seconds: 1200, date: t0 }, Date.now())]);
});
await until(page, () => document.querySelector('.prac-row[data-track="english"]'));
const lessonMin = await page.evaluate(async () => (await import('./academy.js')).trackById('english').lessons[0].minutes);
assert.match(await text('.prac-row[data-track="english"] .prac-sum'), new RegExp(`^${lessonMin + 20} мин$`));
assert.match(await text('.prac-row[data-track="english"]'), new RegExp(`уроки ${lessonMin}, говорение 20`));
assert.match(await text('#practice-total'), new RegExp(`Всего за 7 дней: ${lessonMin + 20} мин`));
await page.locator('#goal-box').evaluate(d => { d.open = true; });
await page.fill('#goal-minutes', '5'); await page.click('#goal-save'); assert.match(await text('#goal-err'), /Цель на неделю: от 10 до 1000 минут/);
await page.selectOption('#goal-track', 'english'); await page.fill('#goal-minutes', '60'); await page.click('#goal-save'); await toast(/Цель на неделю задана/);
await until(page, () => /из 60 мин/.test(document.querySelector('.prac-row[data-track="english"] .prac-sum')?.textContent ?? ''));
assert.equal((await evs('learngoal'))[0].payload.minutes, 60);
await page.locator('#goal-box').evaluate(d => { d.open = true; });
await page.selectOption('#goal-track', 'hebrew'); await page.fill('#goal-minutes', '15'); await page.click('#goal-save');
await until(page, () => document.querySelector('.prac-row[data-track="hebrew"]'));
assert.match(await text('.prac-row[data-track="hebrew"]'), /0 из 15 мин/); assert.match(await text('.prac-row[data-track="hebrew"]'), /пока без занятий/);
await clearToast();
await page.click('.prac-row[data-track="hebrew"] .goal-del'); await toast(/Цель убрана/);
await until(page, () => !document.querySelector('.prac-row[data-track="hebrew"]'));
await page.click('#toast button'); await until(page, () => document.querySelector('.prac-row[data-track="hebrew"]'));
await page.evaluate(async () => { const st = await import('./store.js'); await st.remove('learngoal:hebrew'); });
await until(page, () => !document.querySelector('.prac-row[data-track="hebrew"]'));
// цель выполнена
await page.evaluate(async () => { const st = await import('./store.js'), pr = await import('./practice.js'); await st.save(pr.makeLearnGoal('english', 10)); });
await until(page, () => /Цель недели выполнена/.test(document.querySelector('.prac-row[data-track="english"]')?.textContent ?? ''));

// ---------- «нового давно нет» ----------
await page.click('.track-card[data-track="english"]');
assert.equal(await page.locator('#plateau').count(), 0, 'пока занятия свежие, подсказки нет');
await page.evaluate(async () => {
  const store = await import('./store.js'), ev = await import('./events.js'), ac = await import('./academy.js'), srs = await import('./srs.js');
  const t0 = ev.todayStr(), en = ac.trackById('english'), back = n => ev.addDays(t0, -n);
  const old = await store.remove(ac.lessonEventId(en.lessons[0].id));                    // урок «сегодняшних» занятий заменяем давним
  const lessons = [0, 1].map(i => ac.makeLessonDone(en, en.lessons[i], back(60 - i)));
  const cards = ac.cardsOfTrack(en).slice(0, 6), hist = Array.from({ length: 10 }, (_, i) => [back(2 * i + 1), 2]);
  const states = cards.map(c => ac.makeSrsEvent({ ...srs.newState(c.id, back(50)), reps: 10, last: hist[0][0], hist }));
  await store.saveMany([...lessons, ...states]);
});
await page.click('#learn-back'); await page.click('.track-card[data-track="english"]');
await until(page, () => document.getElementById('plateau'));
assert.match(await text('#plateau'), /Нового давно нет/); assert.match(await text('#plateau'), /За последние 4 недели было 11 дней занятий/, '10 дней повторений и сегодняшнее говорение');
await page.click('#plateau-open');
await until(page, () => document.querySelector('.lesson[data-lesson="en-03"][open]'));


// ---------- аналитика: полоса нормы, сравнение недель, факторы месяца, панель 90 дней, отметки событий ----------
await tab(page, 'insights');
assert.equal(await page.locator('#week-compare .cmp-row[data-key="composite"]').count(), 0, 'проверок ещё нет — строки нет');
assert.equal(await page.locator('#week-compare .cmp-row[data-key="study"]').count(), 1, 'минуты учёбы из дневника практики уже есть');
assert.match(await text('#top-factors'), /Нужно хотя бы 12 дней/);
await page.evaluate(async () => {
  const store = await import('./store.js'), ev = await import('./events.js'), core = await import('./bt-core.js'), dr = await import('./diary.js'), st = await import('./stats.js');
  const rng = st.makeRng(77), out = [], t0 = ev.todayStr();
  for (let i = 44; i >= 0; i--) {
    const d = ev.addDays(t0, -i), startedAt = new Date(`${d}T09:00:00`).getTime(), sleep = 5 + Math.round(rng() * 40) / 10, q = (sleep - 7) * 2 + (rng() - 0.5);
    const m = {
      reaction: { n: 5, median: Math.round(360 - 20 * q), mean: 380, sd: 40, best: 300, lapses: 0, falseStarts: 0 },
      gonogo: { n: 16, hits: 11, omissions: 1, commissions: 1, correctRejections: 3, accuracy: 0.87, inhibition: 0.75, medianRT: 400, dPrime: +(1.5 + 0.3 * q).toFixed(2) },
      stroop: { n: 12, correct: 11, accuracy: 0.92, meanCongruent: 700, meanIncongruent: 900, interference: Math.round(220 - 15 * q), errorsIncongruent: 1 },
      digits: { forward: 6, backward: 4, total: Math.round(10 + q), attempts: 8 },
      math: { n: 12, correct: 10, accuracy: 0.83, meanMs: 3000, perMinute: +(9 + q).toFixed(1), maxLevel: 3 },
    }, results = {};
    for (const [id, mm] of Object.entries(m)) results[id] = { metrics: mm, ms: 30000, trials: [] };
    out.push(core.makeRunEvent(core.makeRun({ mode: 'quick', startedAt, durationMs: 300000, state: null, results }), startedAt), dr.makeCheckin('m', d, { sleepHours: sleep, mood: 3 + (i % 3), stress: 1 + (i % 4) }, '', startedAt + 1000));
  }
  out.push({ id: 'sick:e2e', type: 'sick', ts: Date.now(), payload: { from: ev.addDays(t0, -12), to: ev.addDays(t0, -10) }, source: 'manual', confidence: 1, evidence: [] });
  await store.saveMany(out);
});
await until(page, () => document.querySelector('#week-compare .cmp-row'), null, 15000);
assert.ok(await page.locator('#week-compare .cmp-row').count() >= 3);
assert.match(await text('#week-compare'), /Результат проверок/); assert.match(await text('#week-compare'), /Сон/);
assert.match(await text('#week-compare'), /В этих периодах были дни режима болезни: 3/, 'режим болезни объясняет часть различий');
assert.equal(await page.locator('#week-compare .cmp-arrow').first().getAttribute('role'), 'img');
await until(page, () => document.querySelector('#top-factors .factor-row'), null, 15000);
assert.equal(await page.locator('#top-factors .factor-row').first().getAttribute('data-key'), 'sleepHours');
assert.equal(await page.locator('#top-factors .factor-row').first().getAttribute('data-level'), 'possible');
assert.match(await text('#top-factors .factor-row'), /1\. Сон, часов/); assert.match(await text('#top-factors'), /не доказывают причину/);
await page.locator('#panel90').evaluate(d => { d.open = true; });
assert.ok(await page.locator('#panel90 .cmp-row').count() >= 2); assert.match(await text('#panel90'), /Последние 90 дней против предыдущих 90/);
assert.match(await text('#dyn-legend'), /Серая полоса/);
assert.ok(await page.locator('.entry[data-test="reaction"] svg .spark-band').count() === 1, 'полоса нормы на графике реакции');
assert.ok(await page.locator('.entry[data-test="reaction"] svg .spark-mark.sick').count() === 1, 'отметка режима болезни на графике');
assert.match(await page.locator('.entry[data-test="reaction"] svg .spark-mark.sick title').textContent(), /режим болезни/);
assert.match(await text('.entry[data-test="reaction"] .cv-line'), /^Разброс результатов: \d+% от среднего/);
assert.equal(await page.locator('.entry[data-test="gonogo"] .cv-line').count(), 0, 'у d′ коэффициент вариации не показываем');
await tab(page, 'tests');
await until(page, () => document.querySelector('.test-row[data-test="reaction"] svg .spark-band'));
assert.ok(!/null|undefined/.test(await page.locator('#view-insights').evaluate(n => n.textContent)));


// ---------- привычки по дням недели ----------
await tab(page, 'habits');
await page.locator('#habit-add').evaluate(d => { d.open = true; });
assert.equal(await page.locator('#habit-form .hday-box:checked').count(), 7, 'по умолчанию отмечены все дни');
await page.fill('#habit-name', 'Йога');
for (const d of [0, 2, 4, 6]) await page.uncheck(`#habit-form .hday-box[data-day="${d}"]`);
assert.equal(await page.locator('#habit-form .hday-box:checked').count(), 3);
await page.click('#habit-form button[type=submit]');
await until(page, () => document.querySelector('.habit .h-days'));
assert.equal(await text('.habit .h-days'), 'Дни: пн, ср, пт');
assert.equal(await page.locator('#habit-form .hday-box:checked').count(), 7, 'форма вернулась к «каждый день»');
const schedToday = await page.evaluate(async () => { const ev = await import('./events.js'), h = await import('./habits.js'), st = await import('./store.js'); return h.isScheduled(st.state.events.find(e => e.type === 'habit'), ev.todayStr()); });
assert.equal(await page.locator('.habit .h-off').count(), schedToday ? 0 : 1, 'в выходной день привычки видна пометка');
if (!schedToday) assert.match(await text('.habit .h-off'), /Сегодня по расписанию выходной/);
assert.equal(await page.locator('.habit .h-cal .dot.off').count() > 0, true, 'в календаре дни вне расписания приглушены');
// правка расписания
await page.click('.habit .more summary'); await page.click('.habit .more .edit');
await until(page, () => document.querySelector('form.editing .hday-box'));
assert.deepEqual(await page.locator('form.editing .hday-box:checked').evaluateAll(b => b.map(x => x.dataset.day).sort()), ['1', '3', '5']);
for (const d of [1, 3, 5]) await page.uncheck(`form.editing .hday-box[data-day="${d}"]`);
await page.click('form.editing .save'); await toast(/Выбери хотя бы один день недели/);
for (const d of [2, 4]) await page.check(`form.editing .hday-box[data-day="${d}"]`);
await page.click('form.editing .save');
await until(page, () => document.querySelector('.habit .h-days') && /вт, чт/.test(document.querySelector('.habit .h-days').textContent));
assert.deepEqual((await evs('habit'))[0].payload.days, [2, 4]);
// пустое имя не мешает: добавление без дней
await page.locator('#habit-add').evaluate(d => { d.open = true; });
await page.fill('#habit-name', 'Без дней');
for (let d = 0; d < 7; d++) await page.uncheck(`#habit-form .hday-box[data-day="${d}"]`);
await clearToast(); await page.click('#habit-form button[type=submit]'); await toast(/Выбери хотя бы один день недели/);
assert.equal((await evs('habit')).length, 1, 'привычка без дней не создаётся');

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.10 OK');
