// R3.4: умный ввод, тренировки (и далее — таймер фокуса, отчёты, деньги, заметки, мелочи «Сегодня»).
import assert from 'node:assert/strict';
import { launch, tab, until } from './helpers.mjs';

const t = await launch({ ctxOptions: { permissions: ['clipboard-read', 'clipboard-write'] } });
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);
const evs = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);

// ---------- умный ввод ----------
await page.fill('#add-input', 'потратил 350 на кофе');
await until(page, () => document.getElementById('cap-chip'));
assert.match(await text('#cap-chip'), /расход 350.*Еда.*кофе/);
await page.click('#cap-chip');
await toast(/Добавлено: расход/);
let ex = await evs('expense');
assert.equal(ex.length, 1); assert.equal(ex[0].payload.amountMinor, 35000); assert.equal(ex[0].payload.category, 'Еда');
assert.equal(await page.inputValue('#add-input'), '', 'поле очищено');
assert.equal(await page.isVisible('#cap-suggest'), false);
await page.fill('#add-input', 'вес 72,4');
await page.click('#cap-chip');
await toast(/Добавлено: замер: Вес/);
const ms = await evs('measure');
assert.equal(ms.length, 1); assert.equal(ms[0].payload.value, 72.4);
await page.fill('#add-input', 'заметка: проверить договор аренды');
await page.click('#cap-chip');
await toast(/Добавлено: заметка/);
assert.equal((await evs('note')).length, 1);
await page.fill('#add-input', 'позвонить маме');
assert.equal(await page.isVisible('#cap-suggest'), false, 'обычная задача не перехватывается');
await page.fill('#add-input', 'купить хлеб 60');
assert.equal(await page.isVisible('#cap-suggest'), false);
await page.fill('#add-input', 'кофе 250');
await until(page, () => document.getElementById('cap-chip'));
assert.match(await text('#cap-suggest'), /Возможно, это/);
await page.press('#add-input', 'Enter');                                  // Enter по-прежнему создаёт задачу
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'кофе 250'));

// ---------- тренировки ----------
await tab(page, 'workouts');
assert.equal(await text('#title'), 'Тренировки');
assert.equal(await text('#wk-days'), '0 из 2');
assert.match(await text('#wk-about'), /Без оборудования/);
await page.click('#wk-start');
await until(page, () => document.getElementById('wk-active'));
assert.equal(await page.locator('.wk-ex').count(), 5);
assert.match(await text('.wk-ex[data-ex="0"] .wk-hint'), /Начни с комфортного/);
await page.fill('#wk-reps-0', '10'); await page.click('#wk-add-0');
await until(page, () => document.querySelectorAll('.wk-ex[data-ex="0"] .wk-sets li').length === 1);
assert.match(await text('#wk-rest-left'), /Отдых: 1:/);
assert.equal(await page.inputValue('#wk-reps-0'), '10', 'поле подхода заполнено прошлым значением');
await page.fill('#wk-reps-0', '9'); await page.click('#wk-add-0');
await until(page, () => document.querySelectorAll('.wk-ex[data-ex="0"] .wk-sets li').length === 2);
await page.fill('#wk-reps-4', '30'); await page.click('#wk-add-4');
await until(page, () => document.querySelectorAll('.wk-ex[data-ex="4"] .wk-sets li').length === 1);
await page.fill('#wk-reps-1', '0'); await page.click('#wk-add-1');
assert.match(await text('#toast'), /повторений/);
// тренировка переживает перезапуск
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
await tab(page, 'workouts');
await until(page, () => document.getElementById('wk-active'));
assert.equal(await page.locator('.wk-ex[data-ex="0"] .wk-sets li').count(), 2);
assert.match(await text('#wk-active'), /подходов: 3/);
// добавить своё упражнение
await page.fill('#wk-newex', 'Подтягивания'); await page.click('#wk-newex-add');
await until(page, () => document.querySelectorAll('.wk-ex').length === 6);
// завершить
await page.click('#wk-finish');
await page.click('#wk-finish-form .rate[data-v="7"]');
await page.fill('#wk-note', 'легко пошло');
await page.click('#wk-finish-ok');
await toast(/Тренировка сохранена/);
await until(page, () => document.getElementById('wk-week'));
assert.equal(await text('#wk-days'), '1 из 2');
assert.equal(await page.locator('details[data-wk]').count(), 1);
assert.match(await text('details[data-wk] summary'), /Дом: всё тело A/);
// вторая тренировка: подсказка и рекорд
await page.click('#wk-start');
await until(page, () => document.getElementById('wk-active'));
assert.match(await text('.wk-ex[data-ex="0"] .wk-hint'), /В прошлый раз: 10, 9\. Сегодня попробуй 11 повт\./);
await page.fill('#wk-reps-0', '12'); await page.click('#wk-add-0');
await until(page, () => document.querySelectorAll('.wk-ex[data-ex="0"] .wk-sets li').length === 1);
await page.click('#wk-finish'); await page.click('#wk-finish-ok');
await toast(/Новые рекорды: Приседания: 12 повт\./);
await until(page, () => document.getElementById('wk-records'));
assert.equal(await text('#wk-days'), '1 из 2', 'два тренинга в один день — это один силовой день');
await tab(page, 'today');
assert.match(await text('#strength-chip'), /Силовые: 1\/2/);
await page.click('#journal summary');
assert.ok((await page.locator('#journal-list .j-kind').allTextContents()).includes('Тренировка'));

// ---------- фокус-таймер (под управляемым временем) ----------
await tab(page, 'today');
await page.clock.install({ time: new Date() });
{ const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(now + 1000); }
assert.equal(await text('#focus-chip'), 'Фокус');
await page.click('#focus-chip');
assert.equal(await page.isVisible('#focus-host'), true);
await page.click('.focus-min[data-min="50"]');
await page.fill('#focus-label', 'Отчёт по складу');
await page.click('#focus-go');
assert.equal(await text('#focus-clock'), '50:00');
assert.equal(await text('#focus-sub'), 'Отчёт по складу');
await page.clock.runFor(3 * 60000);
assert.equal(await text('#focus-clock'), '47:00');
await page.click('#focus-stop');
await toast(/Меньше 5 минут/);
assert.equal((await evs('focus')).length, 0, 'короткая сессия не записывается');
assert.equal(await page.isVisible('#focus-host'), false);
await page.click('#focus-chip');
await page.click('#focus-go');                                           // 25 минут по умолчанию
await page.clock.runFor(25 * 60000 + 1000);
await until(page, () => document.getElementById('focus-result'));
assert.match(await text('#focus-result'), /Готово/);
await page.click('#focus-done');
const fs = await evs('focus');
assert.equal(fs.length, 1); assert.equal(fs[0].payload.minutes, 25); assert.equal(fs[0].payload.completed, true);
await until(page, () => document.getElementById('focus-chip').textContent === 'Фокус: 25 мин');
await page.click('#focus-chip');
await page.click('.focus-min[data-min="90"]'); await page.click('#focus-go');
await page.clock.runFor(30 * 60000);
await page.click('#focus-stop');                                         // остановка после 30 минут — записывается
await until(page, () => document.getElementById('focus-result'));
assert.match(await text('#focus-result'), /Записано/);
await page.click('#focus-done');
assert.equal((await evs('focus')).at(-1).payload.minutes + (await evs('focus'))[0].payload.minutes, 55);
await page.clock.resume();
await until(page, () => /Фокус: 55 мин за неделю/.test(document.getElementById('review-focus')?.textContent ?? ''));

// ---------- сон и отчёты ----------
await page.evaluate(async () => {
  const store = await import('./store.js'); const diary = await import('./diary.js'); const ev = await import('./events.js');
  const batch = [];
  for (let i = 0; i < 6; i++) { const d = new Date(); d.setDate(d.getDate() - i); batch.push(diary.makeCheckin('m', ev.todayStr(d.getTime()), { bed: '23:30', wake: '07:00', sleepHours: 6 + (i % 3) * 0.5, mood: 4 }, '', d.getTime())); }
  await store.saveMany(batch);
});
await tab(page, 'health');
await until(page, () => !document.getElementById('sleep-card').hidden);
assert.match(await text('#sleep-card'), /Сон за 14 дней/);
assert.match(await text('#sleep-card'), /недосып за неделю/);
assert.match(await text('#sleep-card'), /Режим: стабильный/);
assert.ok(await page.locator('#sleep-card svg.spark').count() === 1);
await tab(page, 'insights');
await page.click('#rep-month-copy');
await toast(/Отчёт скопирован/);
const monthMd = await page.evaluate(() => navigator.clipboard.readText());
assert.match(monthMd, /^# Мой месяц: /); assert.match(monthMd, /## Сон и самочувствие/); assert.ok(!monthMd.includes('Ответ про день'));
await page.click('#rep-doc-copy');
await until(page, async () => (await navigator.clipboard.readText()).startsWith('# Сводка для врача'));
const docMd = await page.evaluate(() => navigator.clipboard.readText());
assert.match(docMd, /не диагноз/); assert.match(docMd, /## Вес/);
const [dlm] = await Promise.all([page.waitForEvent('download'), page.click('#rep-month-file')]);
assert.match(dlm.suggestedFilename(), /^lifeos-month-\d{4}-\d{2}\.md$/);
const [dld] = await Promise.all([page.waitForEvent('download'), page.click('#rep-doc-file')]);
assert.match(dld.suggestedFilename(), /^lifeos-doctor-\d{4}-\d{2}-\d{2}\.md$/);

// ---------- планы: лимиты, копилки, подписки, прогноз ----------
await tab(page, 'plans');
assert.equal(await text('#title'), 'Планы');
assert.deepEqual(await page.locator('#subnav button').allTextContents(), ['Деньги', 'Планы']);
assert.match(await text('#plan-forecast'), /Потрачено за/);
// лимит по «Еда»: расход 350 ₽ уже есть
await page.selectOption('#lim-cat', 'Еда'); await page.fill('#lim-amt', '400'); await page.click('#lim-save');
await until(page, () => document.querySelector('.lim-row[data-cat="Еда"][data-status="warn"]'));
assert.match(await text('.lim-row[data-cat="Еда"]'), /350.*из 400/);
await page.fill('#lim-amt', 'abc'); await page.click('#lim-save');
assert.match(await text('#lim-err'), /Сумма/);
await page.fill('#lim-amt', '300'); await page.click('#lim-save');
await until(page, () => document.querySelector('.lim-row[data-cat="Еда"][data-status="over"]'));
assert.match(await text('.lim-row[data-cat="Еда"]'), /превышен на/);
// копилка
await page.fill('#goal-title', 'Отпуск'); await page.fill('#goal-target', '100000'); await page.click('#goal-add');
await until(page, () => document.querySelector('.goal'));
await page.fill('.goal .goal-amt', '25000'); await page.click('.goal .goal-plus');
await until(page, () => /25 000.*из 100 000 .*25%/.test(document.querySelector('.goal .goal-line')?.textContent.replace(/[\u00a0\u202f]/g, ' ') ?? ''));
await page.fill('.goal .goal-amt', '5000'); await page.click('.goal .goal-minus');
await until(page, () => /20 000.*из 100 000/.test(document.querySelector('.goal .goal-line')?.textContent.replace(/[\u00a0\u202f]/g, ' ') ?? ''));
await page.fill('#goal-title', ''); await page.click('#goal-add');
assert.match(await text('#goal-err'), /Назови цель/);
// подписка
await page.fill('#sub-name', 'Музыка'); await page.fill('#sub-amt', '299'); await page.fill('#sub-day', '5'); await page.click('#sub-add');
await until(page, () => document.querySelector('.sub'));
assert.match(await text('#sub-total'), /Активных: 1 · 299.*в месяц/);
const beforeExp = (await evs('expense')).length;
await page.click('.sub .sub-pay');
await toast(/Записан расход: Музыка/);
assert.equal((await evs('expense')).length, beforeExp + 1);
assert.equal((await evs('expense')).at(-1).payload.category, 'Подписки');
await page.click('.sub .sub-toggle');
await until(page, () => document.querySelector('.sub.off'));
await page.click('.sub .sub-toggle');
await page.fill('#sub-name', 'Облако'); await page.fill('#sub-amt', '1200'); await page.selectOption('#sub-period', 'year'); await page.fill('#sub-month', '3'); await page.click('#sub-add');
await until(page, () => document.querySelectorAll('.sub').length === 2);
assert.match((await text('#sub-total')).replace(/[\u00a0\u202f]/g, ' '), /Активных: 2 · 399 ₽ в месяц/);
await page.locator('.sub', { hasText: 'Облако' }).locator('.chip.danger').click();
await until(page, () => document.querySelectorAll('.sub').length === 1);
await page.locator('.goal .chip.danger').click();
await until(page, () => !document.querySelector('.goal'));
await page.click('#toast button');
await until(page, () => document.querySelector('.goal'));

// ---------- заметки: шаблоны, теги, ссылки ----------
await tab(page, 'notes');
await page.selectOption('#note-tpl', 'meeting');
assert.match(await page.inputValue('#note-input'), /^Встреча: \nДата: \d{4}-\d{2}-\d{2}/);
assert.match(await page.inputValue('#note-input'), /#встреча/);
await page.fill('#note-input', 'Встреча с поставщиком\nСм. [[Проект склад]] #работа');
await page.click('#note-form button[type=submit]');
await page.fill('#note-input', 'Проект склад\nПлан приёмки #работа #склад');
await page.click('#note-form button[type=submit]');
await until(page, () => document.querySelectorAll('#note-list .note').length === 3);
assert.match(await text('.tag-chip[data-tag="работа"]'), /#работа · 2/);
await page.click('.tag-chip[data-tag="работа"]');
assert.equal(await page.inputValue('#note-filter'), '#работа');
await until(page, () => document.querySelectorAll('#note-list .note').length === 2);
await page.locator('#note-list .note', { hasText: 'Встреча с поставщиком' }).click();
await until(page, () => document.querySelector('form.editing'));
assert.match(await text('.note-links'), /→ Проект склад/);
await page.click('.note-links .link-chip');
await until(page, () => /^Проект склад/.test(document.querySelector('form.editing textarea').value));
assert.match(await text('.note-links'), /← Встреча с поставщиком/);
await page.click('form.editing .cancel');
await page.click('.tag-chip[data-tag="работа"]');

// ---------- «Сегодня»: перенос просроченного, тяжёлый день, размер текста ----------
await tab(page, 'today');
const addTask = async (t, { due, high } = {}) => {
  await page.fill('#add-input', t);
  if (due) await page.fill('#add-due', due);
  if (high) await page.check('#add-high');
  await page.press('#add-input', 'Enter');
  await until(page, tx => [...document.querySelectorAll('.item .text')].some(n => n.textContent.endsWith(tx)), t);
};
const yd = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
await addTask('Старая задача 1', { due: yd(-3) });
await addTask('Старая задача 2', { due: yd(-1) });
await until(page, () => document.querySelectorAll('#g-overdue .item').length === 2);
await page.click('#move-overdue');
await toast(/Перенесено на сегодня: 2/);
await until(page, () => document.querySelectorAll('#g-overdue .item').length === 0);
assert.ok(await page.locator('#g-today .item', { hasText: 'Старая задача 1' }).count() === 1);
await page.click('#toast button');                                          // «Отменить» возвращает просрочку
await until(page, () => document.querySelectorAll('#g-overdue .item').length === 2);
await addTask('Срочный отчёт', { high: true });
await addTask('Без срока 1'); await addTask('Без срока 2');
await page.click('#heavy-chip');
await until(page, () => !document.getElementById('minimum').hidden);
assert.equal(await page.locator('#minimum .item').count(), 3);
assert.match(await text('#minimum .item:first-child'), /Срочный отчёт/);
assert.equal(await page.isVisible('#g-nodate'), false); assert.equal(await page.isVisible('#review'), false);
assert.match(await text('#heavy-chip'), /включён/);
await page.click('#heavy-off');
await until(page, () => document.getElementById('minimum').hidden);
assert.equal(await page.isVisible('#review'), true);
await tab(page, 'more');
await page.selectOption('#font-select', '1.3');
assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim()), '1.3');
assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize)), 20.8);
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize)), 20.8, 'размер текста запоминается');
await tab(page, 'more'); await page.selectOption('#font-select', '1');

// ---------- поиск по курсам и календарь ----------
await tab(page, 'today');
await page.click('#search-btn'); await page.fill('#search-input', 'шэдоуинг');
await until(page, () => document.querySelector('#search-results .result.course[data-track="english"]'));
await page.click('#search-results .result.course[data-track="english"]');
assert.equal(await text('#title'), 'Учёба');
await until(page, () => document.querySelector('.lesson[data-lesson="en-03"][open]'));
assert.match(await text('.lesson[data-lesson="en-03"]'), /Шэдоуинг/);
await page.click('#search-btn'); await page.fill('#search-input', 'went gone');
await until(page, () => [...document.querySelectorAll('#search-results .result.course .kind')].some(n => n.textContent === 'Слово'));
await page.click('#search-btn');
await tab(page, 'more');
const [ics] = await Promise.all([page.waitForEvent('download'), page.click('#export-ics')]);
assert.match(ics.suggestedFilename(), /^lifeos-calendar-\d{4}-\d{2}-\d{2}\.ics$/);
const icsText = (await import('node:fs')).readFileSync(await ics.path(), 'utf8');
assert.ok(icsText.startsWith('BEGIN:VCALENDAR\r\n') && icsText.includes('SUMMARY:Старая задача 1') && icsText.includes('SUMMARY:Списание: Музыка'));

// ---------- план недели и проверка данных ----------
await tab(page, 'today');
await page.click('#review summary');
await page.click('#plan-week');
await toast(/План недели создан/);
assert.ok((await evs('note')).some(n => n.payload.text.startsWith('План недели:')));
await tab(page, 'more');
await page.click('#data-check');
await until(page, () => document.querySelectorAll('#data-check-out p[data-check]').length >= 1);
assert.ok((await text('#data-check-out')).length > 10);

// ---------- лекарства ----------
await tab(page, 'health');
assert.match(await text('#meds-card'), /Список пуст/);
await page.click('#meds-card summary');
await page.click('#med-add');
assert.match(await text('#med-err'), /Назови/);
await page.fill('#med-name', 'Витамин D'); await page.fill('#med-dose', '2000 МЕ'); await page.selectOption('#med-when', 'morning'); await page.click('#med-add');
await until(page, () => document.querySelector('.med'));
assert.match(await text('.med'), /Витамин D · 2000 МЕ · утром/);
await page.check('.med .med-take');
await until(page, async () => (await import('./store.js')).state.events.some(e => e.type === 'medlog'));
assert.equal(await page.isChecked('.med .med-take'), true);
await page.uncheck('.med .med-take');
await until(page, async () => !(await import('./store.js')).state.events.some(e => e.type === 'medlog'));
await page.check('.med .med-take');
await page.click('.med .med-toggle');
await until(page, () => document.querySelector('.med.off'));
await page.click('.med .med-toggle');
await tab(page, 'insights');
await page.click('#rep-doc-copy');
await until(page, async () => (await navigator.clipboard.readText()).includes('Витамин D 2000 МЕ'));

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.4 OK');
