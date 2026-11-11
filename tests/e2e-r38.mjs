// R3.8: диалоги, возвращение к урокам, обратные карточки и скрытая транскрипция, ассоциации, план «от дивана», план дня и др.
import assert from 'node:assert/strict';
import { launch, tab, until } from './helpers.mjs';

const t = await launch({ ctxOptions: { permissions: ['clipboard-read', 'clipboard-write'] } });
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);
const evs = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);

// ---------- английский: диалоги ----------
await tab(page, 'learn');
await page.click('.track-card[data-track="english"]');
assert.equal(await page.locator('.lesson').count(), 16);
assert.match(await text('.lesson[data-lesson="en-13"] summary'), /Диалог: в кафе/);
assert.match(await text('.lesson[data-lesson="en-16"] summary'), /Диалог: у врача/);
await page.click('#learn-back');

// ---------- возвращение к пройденным урокам ----------
assert.equal(await page.locator('#revisit').count(), 0);
await page.evaluate(async () => {
  const store = await import('./store.js'); const ac = await import('./academy.js'); const ev = await import('./events.js');
  const t = ac.TRACKS[0];
  await store.save(ac.makeLessonDone(t, t.lessons[0], ev.addDays(ev.todayStr(), -40)));
});
await until(page, () => document.getElementById('revisit'));
assert.match(await text('#revisit'), /Пора вернуться к уроку[\s\S]*пройден 40 дн\. назад/);
await page.click('#revisit-open');
await until(page, () => document.querySelector('.lesson[open]'));
assert.equal(await page.getAttribute('.lesson[open]', 'data-lesson'), 'en-01');
await page.click('#learn-back');
await page.click('#revisit-done'); await toast(/через месяц/);
await until(page, () => !document.getElementById('revisit'));
const lessonEv = (await evs('lesson'))[0];
assert.ok(lessonEv.payload.revisited, 'отметка «повторил» сохранена');

// ---------- обратные карточки и скрытая транскрипция ----------
const info = await page.evaluate(async () => {
  const store = await import('./store.js'); const ac = await import('./academy.js'); const sr = await import('./srs.js'); const ev = await import('./events.js');
  const today = ev.todayStr(), back = n => ev.addDays(today, -n);
  const he = ac.cardsOfTrack(ac.trackById('hebrew')).filter(c => c.kind === 'deck' && /[֐-׿]/.test(c.q) && / — /.test(c.a)).slice(0, 25);
  const enw = ac.cardsOfTrack(ac.trackById('english')).filter(c => c.kind === 'deck' && /^[A-Za-z][A-Za-z' -]*$/.test(c.q)).slice(0, 25);
  const mk = (c, due) => ac.makeSrsEvent({ ...sr.newState(c.id, back(20)), box: 3, due, last: back(5), hist: [[back(5), 2]] });
  await store.saveMany([...he.map(c => mk(c, back(1))), ...enw.map(c => mk(c, today))]);      // сначала идёт иврит (срок раньше)
  return { today, n: he.length + enw.length };
});
assert.equal(info.n, 50);
await tab(page, 'learn');
await until(page, () => document.getElementById('learn-start'));
await page.click('#learn-start');
await until(page, () => document.getElementById('sess-card'));
let reversed = 0, hidden = 0, straight = 0;
for (let i = 0; i < 14; i++) {
  const head = await text('#sess-card span.muted');
  const front = await text('#sess-q');
  const isReversed = /обратное направление/.test(head);
  await page.click('#sess-show');
  const back = await text('#sess-a');
  if (isReversed) {
    reversed++;
    assert.ok(/[А-Яа-яЁё]/.test(front) && !/[֐-׿]/.test(front), `обратная карточка спрашивает перевод: ${front}`);
    assert.ok(/[A-Za-z֐-׿]/.test(back), `ответ — слово: ${back}`);
  } else straight++;
  if (await page.locator('#sess-translit-btn').count()) {
    hidden++;
    assert.ok(!/ — /.test(back), `транскрипция скрыта: ${back}`);
    await page.click('#sess-translit-btn');
    assert.match(await text('#sess-translit'), /^Транскрипция: [а-яё' -]+$/i);
  }
  await page.click('.grade.good');
}
assert.ok(reversed >= 1 && straight >= 1, `оба направления встречаются (обратных ${reversed}, прямых ${straight})`);
assert.ok(hidden >= 1, 'у выученных слов иврита транскрипция скрыта и открывается кнопкой');
await page.click('#sess-close');

// ---------- свои карточки: ассоциация ----------
await page.click('.track-card[data-track="my"]');
await page.fill('#my-q', 'Quay'); await page.fill('#my-a', 'набережная'); await page.fill('#my-hint', 'Читается «ки»: как «ключ»');
await page.click('#my-add'); await toast(/Карточка добавлена/);
await until(page, () => document.querySelector('#my-list .entry'));
assert.match(await text('#my-list'), /Ассоциация: Читается «ки»: как «ключ»/);
const ucard = (await evs('ucard'))[0];
assert.equal(ucard.payload.hint, 'Читается «ки»: как «ключ»');
await page.click('#learn-back');

// ---------- заготовки: план «от дивана», замещение ----------
await tab(page, 'notes');
await page.selectOption('#note-tpl', 'couch');
const couch = await page.inputValue('#note-input');
assert.match(couch, /^План «от дивана»: старт \d{4}-\d{2}-\d{2}/); assert.match(couch, /Неделя 8: 20 минут бега без остановки/); assert.match(couch, /согласуй нагрузку с врачом/);
await tab(page, 'habits');
await page.locator('#habit-add').evaluate(d => { d.open = true; });
assert.equal(await page.locator('#habit-templates .tpl').count(), 9);
await page.click('#habit-templates .tpl:has-text("Одно замещение в день")');
assert.equal(await page.inputValue('#habit-name'), 'Одно замещение в день'); assert.match(await page.inputValue('#habit-min'), /заменить один напиток водой/);

// ---------- здоровье: мягкое предупреждение о цели по весу ----------
await tab(page, 'health');
await page.evaluate(async () => { const store = await import('./store.js'); const hl = await import('./health.js'); await store.save(hl.makeMeasure({ kind: 'weight', value: '75' })); });
await page.click('#hp-box summary');
await page.fill('#hp-height', '175'); await page.fill('#hp-goal', '48'); await page.click('#hp-save'); await toast(/Сохранено/);
await until(page, () => /Внимание: Цель 48 кг/.test(document.getElementById('health-summary').textContent));
assert.match(await text('#health-summary'), /при росте 175 см даёт ИМТ 15,7: это ниже ориентира 18,5/);
assert.match(await text('#health-summary'), /Цель далеко от текущего веса \(больше 30%\)/);
await page.fill('#hp-goal', '70'); await page.click('#hp-save'); await toast(/Сохранено/);
await until(page, () => !/Внимание:/.test(document.getElementById('health-summary').textContent));

// ---------- «Сегодня»: план дня ----------
await tab(page, 'today');
const mins = await page.evaluate(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
await page.evaluate(async () => {
  const store = await import('./store.js'); const ev = await import('./events.js');
  const today = ev.todayStr();
  await store.saveMany([ev.makeTask('Отчёт по складу', Date.now(), { due: today, priority: 'high' }), ev.makeTask('Позвонить поставщику', Date.now() + 1, { due: today })]);
});
if (mins <= 16 * 60) {
  await until(page, () => !document.getElementById('plan-day').hidden);
  await page.locator('#plan-day summary').click();
  assert.ok((await page.locator('.plan-row[data-kind="task"]').count()) >= 2, 'две задачи в плане');
  assert.ok(!/null/.test(await text('#plan-day')), 'в карточке плана нет текста «null»');
  assert.match(await text('.plan-row[data-kind="task"] >> nth=0'), /^\d\d:\d\d–\d\d:\d\d Отчёт по складу/, 'важное идёт первым');
  await page.click('#plan-copy'); await toast(/План скопирован/);
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^План дня \d{4}-\d{2}-\d{2}\n\d\d:\d\d–\d\d:\d\d  Отчёт по складу/);
} else console.log('поздний час: проверку плана дня пропускаем (блоки не помещаются до вечера)');

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.8 OK');
