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

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.10 OK');
