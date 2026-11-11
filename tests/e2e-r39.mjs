// R3.9: отложенные мысли, «что нового», главная метрика, тепловая карта, рекорды, день отдыха, тихие часы и др.
import assert from 'node:assert/strict';
import { launch, tab, until } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);
const evs = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);
const day = n => page.evaluate(async k => { const ev = await import('./events.js'); return ev.addDays(ev.todayStr(), k); }, n);

// ---------- «что нового» ----------
assert.equal(await page.locator('#whatsnew').isHidden(), true, 'первая установка: ничего не показываем');
await page.evaluate(async () => (await import('./prefs.js')).setPref('lastSeenVersion', 'R3.7'));
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
await until(page, () => !document.getElementById('whatsnew').hidden);
const ver = await page.evaluate(async () => (await import('./version.js')).VERSION);
assert.match(await text('#whatsnew'), new RegExp(`Что нового в ${ver}`)); assert.match(await text('#whatsnew'), /R3\.8/);
assert.ok(!/null/.test(await text('#whatsnew')));
await page.click('#whatsnew-ok');
await until(page, () => document.getElementById('whatsnew').hidden);
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
assert.equal(await page.locator('#whatsnew').isHidden(), true, 'после «Понятно» не возвращается');

// ---------- отложенные мысли ----------
await tab(page, 'reflect');
await page.click('#park-add'); assert.match(await text('#park-err'), /несколько слов/);
await page.fill('#park-text', 'Не забыть про справку для банка');
assert.equal(await page.inputValue('#park-for'), await day(1), 'по умолчанию на завтра');
await page.fill('#park-for', await day(0)); await page.click('#park-add'); await toast(/Отложено/);
await page.fill('#park-text', 'Подумать про отпуск'); await page.click('#park-add'); await toast(/Отложено/);
await until(page, () => document.querySelectorAll('.park-row').length === 2);
assert.equal(await page.locator('.park-row.due').count(), 1, 'на сегодня назначено одно');
await tab(page, 'today');
await until(page, () => !document.getElementById('parked').hidden);
assert.match(await text('#parked'), /Не забыть про справку для банка/); assert.ok(!/Подумать про отпуск/.test(await text('#parked')), 'завтрашнее пока не показываем');
await page.click('#parked .park-snooze');
await until(page, () => document.getElementById('parked').hidden);
assert.equal((await evs('parked')).find(e => /справку/.test(e.payload.text)).payload.forDate, await day(1), '«ещё на день» переносит срок');
await tab(page, 'reflect');
await page.locator('.park-row .chip.danger').first().click();
await until(page, () => document.querySelectorAll('.park-row').length === 1);
await page.click('#toast button');
await until(page, () => document.querySelectorAll('.park-row').length === 2);

// ---------- главная метрика ----------
await page.evaluate(async () => {
  const store = await import('./store.js'); const ev = await import('./events.js'); const dr = await import('./diary.js');
  const today = ev.todayStr(), back = n => ev.addDays(today, -n);
  await store.saveMany([dr.makeCheckin('m', today, { mood: 4 }, '', Date.now()), dr.makeCheckin('m', back(1), { mood: 2 }, '', Date.now()), dr.makeCheckin('m', back(3), { mood: 5 }, '', Date.now())]);
});
await tab(page, 'today');
await page.click('#review summary');
await until(page, () => /Дней с делом за 30 дней: 3 · подряд: 2/.test(document.getElementById('review-active')?.textContent ?? ''));

// ---------- тепловая карта настроения ----------
await tab(page, 'diary');
assert.equal(await page.locator('#mood-heat .mh-cell').count(), 84);
assert.equal(await page.locator('#mood-heat .mh-cell.mh-4').count(), 1, 'сегодня настроение 4');
assert.equal(await page.locator('#mood-heat .mh-cell.mh-2').count(), 1); assert.equal(await page.locator('#mood-heat .mh-cell.mh-5').count(), 1);
assert.ok(!/null/.test(await text('#mood-heat')));

// ---------- рекорды в тестах ----------
await page.evaluate(async () => {
  const store = await import('./store.js'); const core = await import('./bt-core.js');
  const evs = [400, 330, 360].map((median, i) => {
    const startedAt = new Date().setHours(9, 0, 0, 0) - (3 - i) * 86400000;
    const payload = core.makeRun({ mode: 'quick', startedAt, durationMs: 1000, results: { reaction: { metrics: { n: 5, median, mean: 370, sd: 30, best: 300, lapses: 0, falseStarts: 0 }, ms: 1, trials: [] } } });
    return core.makeRunEvent(payload, startedAt);
  });
  await store.saveMany(evs);
});
await tab(page, 'tests');
await until(page, () => document.querySelector('.test-row[data-test="reaction"] .test-record'));
assert.match(await text('.test-row[data-test="reaction"] .test-record'), /рекорд: 330 мс \(/);
assert.equal(await page.locator('.test-row[data-test="stroop"] .test-record').count(), 0, 'без результатов рекорда нет');

// ---------- подсказка про день отдыха ----------
await page.evaluate(async () => {
  const store = await import('./store.js'); const ev = await import('./events.js'); const dr = await import('./diary.js');
  const today = ev.todayStr();
  await store.saveMany([0, 1, 2, 3].map(i => dr.makeCheckin('e', ev.addDays(today, -i), { focus: 2 }, '', Date.now() + i)));
});
await tab(page, 'today');
await until(page, () => document.getElementById('hint-rest'));
assert.match(await text('#hint-rest'), /4 вечера подряд ты отметил низкий фокус/);
await page.click('#hint-rest .chip:has-text("Понял")');
await until(page, () => !document.getElementById('hint-rest'));


// ---------- отсрочка покупок: сутки ожидания ----------
const sleepless = () => page.waitForTimeout(150);
await tab(page, 'plans');
await page.click('#wish-add'); assert.match(await text('#wish-err'), /Напиши, что хочешь купить/);
await page.fill('#wish-text', 'Новые наушники'); await page.fill('#wish-amt', '4500'); await page.click('#wish-add'); await toast(/Записано/);
await until(page, () => document.querySelector('.wish-row.wait'));
assert.match(await text('.wish-row.wait'), /Новые наушники/); assert.match(await text('.wish-row.wait'), /Подождём ещё 2[34] час/);
assert.equal(await page.locator('.wish-row.wait .wish-keep, .wish-row.wait .wish-drop').count(), 0, 'пока сутки не прошли, решать рано');
await page.evaluate(async () => { const store = await import('./store.js'); const w = await import('./wishes.js'); await store.save(w.makeWish({ text: 'Кофемашина', amountMinor: 3000000 }, Date.now() - 25 * 3600000)); });
await until(page, () => document.querySelector('.wish-row.ready'));
assert.match(await text('.wish-row.ready'), /Кофемашина/); assert.match(await text('.wish-row.ready'), /Сутки прошли/);
await tab(page, 'today');
await until(page, () => !document.getElementById('money-nudge').hidden);
assert.match(await text('#money-nudge'), /Сутки прошли: всё ещё нужно\?/); assert.match(await text('#money-nudge'), /Кофемашина/); assert.ok(!/Новые наушники/.test(await text('#money-nudge')), 'ждущее желание не показываем');
await page.click('#money-nudge .nudge-drop'); await toast(/Хорошее решение/);
await until(page, () => document.getElementById('money-nudge').hidden);
await page.click('#toast button');
await until(page, () => !document.getElementById('money-nudge').hidden);
assert.equal((await evs('wish')).find(w => w.payload.text === 'Кофемашина').payload.status, 'wait', 'отмена возвращает желание на решение');
await page.click('#money-nudge .nudge-drop'); await until(page, () => document.getElementById('money-nudge').hidden);
await tab(page, 'plans');
await until(page, () => document.getElementById('wish-stats'));
assert.match(await text('#wish-stats'), /отказов от покупок 1, сохранено 30\s000/);
assert.equal(await page.locator('#wish-closed .wish-row.dropped').count(), 1);
const closedWish = (await evs('wish')).find(w => w.payload.text === 'Кофемашина'); assert.equal(closedWish.payload.status, 'dropped');

// ---------- долги и займы ----------
await page.click('#debt-add'); assert.match(await text('#debt-err'), /Укажи, кто это/);
await page.fill('#debt-who', 'Анна'); await page.fill('#debt-amt', '5000'); await page.fill('#debt-due', await day(-1)); await page.fill('#debt-note', 'за билеты'); await page.click('#debt-add'); await toast(/Записано/);
await page.fill('#debt-who', 'Борис'); await page.selectOption('#debt-dir', 'i_owe'); await page.fill('#debt-amt', '2000'); await page.fill('#debt-due', await day(10)); await page.click('#debt-add');
await until(page, () => document.querySelectorAll('.debt-row').length === 2);
assert.match(await text('#debt-totals'), /Мне должны: 5\s000\s₽ · Я должен: 2\s000\s₽/);
assert.equal(await page.locator('.debt-row.late').count(), 1, 'просрочен только долг Анны'); assert.match(await text('.debt-row.late'), /Срок прошёл/);
const anna = '.debt-row[data-dir="owe_me"]';
await page.fill(`${anna} .debt-pay-amt`, '9999'); await page.click(`${anna} .debt-part`); await toast(/Больше, чем осталось/);
await page.fill(`${anna} .debt-pay-amt`, '1500'); await page.click(`${anna} .debt-part`); await toast(/Возврат записан/);
await until(page, () => /Осталось 3\s500\s₽ из 5\s000\s₽/.test(document.querySelector('.debt-row[data-dir="owe_me"]').textContent));
await tab(page, 'today');
await until(page, () => !document.getElementById('money-nudge').hidden);
assert.match(await text('#money-nudge'), /Просрочен возврат/); assert.match(await text('#money-nudge'), /Анна: 3\s500\s₽ \(мне должны\)/); assert.ok(!/Борис/.test(await text('#money-nudge')));
await page.click('#money-nudge .nudge-debt-open');
await until(page, () => !document.getElementById('view-plans').hidden);
await page.click(`${anna} .debt-all`); await toast(/Долг закрыт/);
await until(page, () => document.querySelectorAll('#debt-closed .debt-row.done').length === 1);
await tab(page, 'today'); await until(page, () => document.getElementById('money-nudge').hidden);
assert.equal(await page.locator('#money-nudge').innerHTML().then(h => h.trim()), '', 'скрытое напоминание не хранит имён');
assert.equal((await evs('debt')).filter(d => d.payload.settled).length, 1);

// ---------- калькулятор автоматизации ----------
await tab(page, 'plans');
await page.click('#auto-card summary');
assert.match(await text('#auto-result'), /Заполни первые два поля/);
await page.fill('#auto-min', '15'); await page.fill('#auto-week', '10'); await page.fill('#auto-people', '3'); await page.fill('#auto-build', '20'); await page.fill('#auto-rate', '500');
assert.match(await text('#auto-result'), /Экономия: 7,5 ч в неделю, 390 ч в год\. В деньгах около 195\s000\s₽ в год\. Настройка \(20 ч\) окупится примерно за 3 нед\. Вывод: стоит делать\./);
await page.fill('#auto-min', '0'); assert.match(await text('#auto-result'), /Минут на операцию: от 0,1 до 600/);
assert.equal(await page.locator('#auto-result.error').count(), 1);
assert.equal((await page.evaluate(async () => (await import('./store.js')).state.events.filter(e => /auto/.test(e.type)).length)), 0, 'калькулятор ничего не сохраняет');

// ---------- привычка: план «если помешает» ----------
await tab(page, 'habits');
await page.locator('#habit-add').evaluate(d => { d.open = true; });
await page.fill('#habit-name', 'Зарядка'); await page.fill('#habit-plan', 'Если нет времени, то хотя бы 5 приседаний'); await page.click('#habit-form button[type=submit]');
await until(page, () => document.querySelector('.habit .h-plan'));
assert.equal(await text('.habit .h-plan'), 'Если помешает: нет времени, то хотя бы 5 приседаний');
assert.equal(await page.inputValue('#habit-plan'), '', 'форма очищена');
await page.click('.habit .more summary'); await page.click('.habit .more .edit');
await until(page, () => document.querySelector('.edit-plan'));
assert.equal(await page.inputValue('.edit-plan'), 'Если нет времени, то хотя бы 5 приседаний');
await page.fill('.edit-plan', 'Если устал, то 2 минуты'); await page.click('.editing .save');
await until(page, () => document.querySelector('.habit .h-plan'));
assert.equal(await text('.habit .h-plan'), 'Если помешает: устал, то 2 минуты');
assert.equal((await evs('habit'))[0].payload.plan, 'Если устал, то 2 минуты');

// ---------- необычно крупная трата: предупреждение ----------
await page.evaluate(async () => {
  const store = await import('./store.js'); const ev = await import('./events.js'); const m = await import('./money.js');
  const today = ev.todayStr();
  await store.saveMany([30000, 35000, 40000, 32000, 38000, 36000].map((amount, i) => m.makeExpense({ amount, category: 'Еда', date: ev.addDays(today, -(i + 1) * 2) }, Date.now() + i)));
});
await tab(page, 'money');
await page.fill('#exp-amount', '2000'); await page.fill('#exp-category', 'Еда'); await page.click('#exp-form button[type=submit]');
await toast(/Это заметно больше обычного для «Еда» \(обычно около 355\s₽\)/);
const nExp = async () => (await evs('expense')).length;
assert.equal(await nExp(), 7);
await page.click('#toast button'); await until(page, () => true); await sleepless();
assert.equal(await nExp(), 6, 'отмена убирает запись');
await page.evaluate(async () => (await import('./ui.js')).clearToast());
await page.fill('#exp-amount', '400'); await page.fill('#exp-category', 'Еда'); await page.click('#exp-form button[type=submit]');
await until(page, () => true); await sleepless(); assert.equal(await nExp(), 7); assert.ok(!/заметно больше обычного/.test(await text('#toast')), 'обычная трата без предупреждения');
await tab(page, 'today');
await page.fill('#add-input', 'потратил 3000 на продукты'); await page.click('#cap-chip');
await toast(/заметно больше обычного для «Еда»/);

// ---------- случайная заметка из прошлого ----------
await tab(page, 'notes');
assert.equal(await page.locator('#note-past').isVisible(), false, 'без старых заметок кнопки нет');
await page.evaluate(async () => {
  const store = await import('./store.js'); const n = await import('./notes.js');
  await store.saveMany([n.makeNote('Идея про старый проект: собрать всё в одну таблицу', Date.now() - 40 * 86400000), n.makeNote('Свежая заметка про сегодня', Date.now())]);
});
await until(page, () => document.getElementById('note-past') && !document.getElementById('note-past').closest('.row').hidden);
await page.click('#note-past');
await until(page, () => !document.getElementById('note-past-box').hidden);
assert.match(await text('#note-past-text'), /Идея про старый проект/); assert.ok(!/Свежая заметка/.test(await text('#note-past-box')), 'свежие заметки не предлагаем');
await page.click('#note-past-next'); assert.match(await text('#note-past-text'), /Идея про старый проект/, 'единственная старая заметка');
await page.click('#note-past-open');
await until(page, () => document.querySelector('.edit-note'));
assert.match(await page.inputValue('.edit-note'), /Идея про старый проект/); assert.equal(await page.locator('#note-past-box').isHidden(), true);
await page.click('.editing .cancel');

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.9 OK');
