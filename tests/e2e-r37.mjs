// R3.7: озвучка слов, говорение вслух, экзамен-режим, мини-квиз, письмо и др.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, tab, until } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);
const evs = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);

// ---------- учёба: говорение вслух ----------
await tab(page, 'learn');
assert.match(await text('#speak-week'), /За неделю: 0 из 60 мин/);
await page.click('#speak-english');
await until(page, () => !document.getElementById('speak-host').hidden);
const topic1 = await text('#speak-topic');
await page.click('#speak-other');
assert.notEqual(await text('#speak-topic'), topic1, '«другая тема» меняет тему');
await page.click('.speak-lang[data-lang="english"]');
await page.click('.speak-min[data-min="5"]');
assert.equal(await page.getAttribute('.speak-min[data-min="5"]', 'aria-pressed'), 'true');
await page.click('#speak-go');
await until(page, () => /^[45]:\d\d$/.test(document.getElementById('speak-clock')?.textContent ?? ''));
await page.click('#speak-stop');                                  // меньше минуты: не записываем
await toast(/Меньше минуты не записываю/);
assert.equal((await evs('speak')).length, 0);
assert.equal(await page.locator('#speak-host').isHidden(), true);
// запущенная сессия переживает перезапуск и дописывается, когда время вышло
await page.evaluate(() => localStorage.setItem('lifeos.speak.run', JSON.stringify({ startedAt: Date.now() - 400000, minutes: 5, lang: 'english', topic: 'Расскажи о дне' })));
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
await until(page, () => document.getElementById('speak-result'));            // экран «Учёба» открылся сам и дописал сессию
assert.equal(await text('#speak-result'), 'Записано');
const sp = (await evs('speak'))[0];
assert.equal(sp.payload.minutes, 5); assert.equal(sp.payload.lang, 'english');
await page.click('#speak-done');
await until(page, () => /За неделю: 5 из 60 мин \(английский 5\)/.test(document.getElementById('speak-week')?.textContent ?? ''));
assert.equal(await page.evaluate(() => localStorage.getItem('lifeos.speak.run')), null, 'незавершённая сессия не остаётся');
await tab(page, 'today'); await page.click('#journal summary');
assert.match(await text('#journal-list'), /5 мин \(английский\)/);

// ---------- учёба: кнопка озвучки на карточках ----------
await page.evaluate(async () => {
  const store = await import('./store.js'); const ac = await import('./academy.js'); const ev = await import('./events.js');
  const t = ac.TRACKS[0];
  await store.save(ac.makeLessonDone(t, t.lessons[0], ev.todayStr()));
});
await tab(page, 'learn');
await until(page, () => document.getElementById('learn-start'));
const canSpeak = await page.evaluate(() => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
await page.click('#learn-start');
await until(page, () => document.getElementById('sess-card'));
let found = false;
for (let i = 0; i < 5 && !found; i++) {
  await page.click('#sess-show');
  found = (await page.locator('#sess-speak').count()) > 0;
  await page.click('.grade.good');
}
assert.equal(found, canSpeak, canSpeak ? 'у английских карточек есть кнопка озвучки' : 'без синтеза речи кнопки нет');
await page.click('#sess-close');

// ---------- учёба: мини-квиз после урока и экзамен ----------
await tab(page, 'learn');
if (await page.locator('#learn-back').count()) await page.click('#learn-back');
await page.click('.track-card[data-track="english"]');
await page.locator('.lesson').first().locator('summary').click();
await page.locator('.lesson').first().locator('.quiz-start').click();
let right = 0;
for (let i = 0; i < 3; i++) {
  await until(page, () => document.querySelectorAll('.lesson[open] .quiz-opt').length === 4);
  assert.match(await text(`.lesson[open] .quiz > p.muted`), new RegExp(`Вопрос ${i + 1} из 3`));
  await page.locator('.lesson[open] .quiz-opt').first().click();
  await until(page, () => document.querySelector('.lesson[open] .quiz-opt.right'));
  if (await page.locator('.lesson[open] .quiz-opt.wrong').count() === 0) right++;
  await page.click('.lesson[open] .quiz-next');
}
assert.match(await text('.lesson[open] .quiz-result'), new RegExp(`Верно: ${right} из 3`));
await page.click('.lesson[open] .quiz-again');
await until(page, () => document.querySelectorAll('.lesson[open] .quiz-opt').length === 4);
const before = JSON.stringify((await evs('srs')).map(e => e.payload).sort((a, b) => a.card.localeCompare(b.card)));
await page.click('#track-exam');
await until(page, () => !document.getElementById('sess').hidden);
assert.match(await text('#sess-card'), /Экзамен/);
const total = Number((await text('#sess-pos')).split('/')[1]);
assert.ok(total >= 10 && total <= 20, `в экзамене ${total} карточек`);
for (let i = 0; i < total; i++) {
  await page.click('#sess-show');
  assert.equal(await page.locator('.grade .muted').count(), 0, 'в экзамене нет подсказок про интервалы');
  await page.click(i === 0 ? '.grade.again' : '.grade.good');
}
await until(page, () => document.getElementById('exam-line'));
assert.match(await text('#exam-line'), new RegExp(`Верно: ${total - 1} из ${total}`));
assert.equal(await page.locator('.exam-miss').count(), 1, 'ошибка показана в списке');
await page.click('#sess-done');
const after = JSON.stringify((await evs('srs')).map(e => e.payload).sort((a, b) => a.card.localeCompare(b.card)));
assert.equal(after, before, 'экзамен не меняет расписание повторений');
await page.click('#learn-back');
assert.equal(await page.locator('#exam-all').count(), 1);

// ---------- сон: что мешало, подсказка про кофе ----------
const day = n => page.evaluate(async k => { const ev = await import('./events.js'); return ev.addDays(ev.todayStr(), k); }, n);
await tab(page, 'diary');
await page.locator('#ci-m').evaluate(d => { d.open = true; });
await page.locator('#ci-m-reasons').evaluate(d => { d.open = true; });
await page.click('#ci-m .rate[data-field="sleepQuality"][data-v="2"]');
await page.check('#ci-mflag-noise'); await page.check('#ci-mflag-worry');
await page.click('#ci-m-save'); await toast(/Утро сохранено/);
const cm = (await evs('checkin')).find(e => e.payload.slot === 'm');
assert.equal(cm.payload.noise, true); assert.equal(cm.payload.worry, true); assert.equal('lateMeal' in cm.payload, false, 'невыбранное не записывается');
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
await tab(page, 'diary');
await page.locator('#ci-m').evaluate(d => { d.open = true; });
await until(page, () => document.getElementById('ci-mflag-noise').checked);
assert.equal(await page.isChecked('#ci-mflag-worry'), true); assert.equal(await page.isChecked('#ci-mflag-hot'), false);
// вчера вечером было четыре чашки кофе → подсказка на «Сегодня»
const yd = await day(-1);
await page.evaluate(async d => { const store = await import('./store.js'); const dr = await import('./diary.js'); await store.save(dr.makeCheckin('e', d, { caffeine: 4 }, '', Date.now())); }, yd);
await tab(page, 'today');
await until(page, () => document.getElementById('hint-caffeine'));
assert.match(await text('#hint-caffeine'), /4 чашки кофе или чая[\s\S]*до 14:00/);
await page.click('#hint-caffeine .chip:has-text("Понял")');
await until(page, () => !document.getElementById('hint-caffeine'));

// ---------- вечерний ритуал ----------
await tab(page, 'reflect');
assert.match(await text('#rit-progress'), /Сделано: 0 из 6/);
await page.check('#rit-screen'); await page.check('#rit-plan');
assert.match(await text('#rit-progress'), /Сделано: 2 из 6/);
await page.waitForFunction(() => import('./store.js').then(m => m.state.events.some(e => e.type === 'ritual')));
assert.deepEqual((await evs('ritual'))[0].payload.steps, ['screen', 'plan']);
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
await tab(page, 'reflect');
await until(page, () => document.getElementById('rit-screen')?.checked);
assert.equal(await page.isChecked('#rit-plan'), true); assert.equal(await page.isChecked('#rit-prep'), false);
await page.uncheck('#rit-screen'); await page.uncheck('#rit-plan');
await page.waitForFunction(() => import('./store.js').then(m => !m.state.events.some(e => e.type === 'ritual')));
assert.match(await text('#rit-progress'), /Сделано: 0 из 6/, 'без отметок запись удаляется');

// ---------- заготовки: привычки и заметка с покупками ----------
await tab(page, 'habits');
await page.locator('#habit-add').evaluate(d => { d.open = true; });
assert.equal(await page.locator('#habit-templates .tpl').count(), 9);
await page.click('#habit-templates .tpl:has-text("Свет утром")');
assert.equal(await page.inputValue('#habit-name'), 'Свет утром'); assert.match(await page.inputValue('#habit-full'), /10 минут на дневном свету/);
await tab(page, 'notes');
await page.selectOption('#note-tpl', 'groceries');
assert.match(await page.inputValue('#note-input'), /^Покупки на неделю: [\s\S]*Белок \(мясо, рыба, яйца, творог\):[\s\S]*#покупки/);

// ---------- письмо: счётчик слов, свободное письмо, книга года ----------
await tab(page, 'diary');
await page.fill('#diary-text', 'Утренняя запись #планы'); await page.click('#diary-save'); await toast(/Запись сохранена/);
await until(page, () => /Слов сегодня: 3 · записей подряд: 1/.test(document.getElementById('diary-stats').textContent));
await page.fill('#diary-text', 'Утренняя запись #планы и ещё несколько слов');            // несохранённый текст
await page.click('#fw-open'); await toast(/Сначала сохрани запись дня/);
assert.equal(await page.locator('#fw-host').isHidden(), true);
await page.click('#diary-save'); await toast(/Запись сохранена/);
await page.click('#fw-open');
await until(page, () => !document.getElementById('fw-host').hidden);
await page.click('.fw-min[data-min="3"]'); await page.click('#fw-go');
await page.fill('#fw-text', 'Просто пишу всё что приходит в голову');
assert.equal(await text('#fw-words'), '7 слов');
await page.click('#fw-finish');
await until(page, () => document.getElementById('fw-result'));
assert.match(await text('#fw-result'), /Сохранено в дневник/);
await page.click('#fw-done');
const dia = (await evs('diary'))[0];
assert.match(dia.payload.text, /^Утренняя запись #планы и ещё несколько слов\n\nСвободное письмо \(7 слов\):\nПросто пишу всё что приходит в голову$/);
await until(page, () => document.getElementById('diary-text').value.includes('Свободное письмо'));
// пустое письмо ничего не сохраняет
await page.click('#fw-open'); await page.click('#fw-go'); await page.click('#fw-finish'); await toast(/Ничего не написано/);
assert.equal((await evs('diary'))[0].payload.text, dia.payload.text);
// книга года
await tab(page, 'more');
await until(page, () => !document.getElementById('yearbook-row').hidden);
const year = await page.evaluate(async () => (await import('./events.js')).todayStr().slice(0, 4));
assert.deepEqual(await page.locator('#yearbook-year option').allTextContents(), [year]);
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-yearbook')]);
assert.equal(dl.suggestedFilename(), `lifeos-book-${year}.md`);
const book = fs.readFileSync(await dl.path(), 'utf8');
assert.ok(book.startsWith(`# Книга года ${year}`)); assert.match(book, /Записей: 1, слов: /); assert.match(book, /Свободное письмо \(7 слов\)/); assert.match(book, /Частые темы: #планы \(1\)/);

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.7 OK');
