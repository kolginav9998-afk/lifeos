// R3.11: бриф на день и итог дня, и другое из следующей партии.
import assert from 'node:assert/strict';
import { launch, tab, until } from './helpers.mjs';

const t = await launch({ ctxOptions: { permissions: ['clipboard-read', 'clipboard-write'] } });
const { page, errors } = t;
page.on('dialog', d => d.accept());
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);
const clearToast = () => page.evaluate(async () => (await import('./ui.js')).clearToast());
const evs = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);

// ---------- бриф на день и итог дня ----------
await page.evaluate(async () => {
  const store = await import('./store.js'), ev = await import('./events.js'), hb = await import('./habits.js'), md = await import('./meds.js'), pp = await import('./people.js');
  const t0 = ev.todayStr(), back = n => ev.addDays(t0, -n), [d, m] = ev.addDays(t0, 1).split('-').slice(1).reverse();
  await store.saveMany([ev.makeTask('Сдать отчёт', Date.now(), { due: back(2) }), ev.makeTask('Купить хлеб', Date.now() + 1, { due: t0 }), ev.makeTask('Позвонить маме', Date.now() + 2, { priority: 'high' }),
    ev.makeTask('Разобрать почту', Date.now() + 3), hb.makeHabit({ name: 'Вода', minimum: 'один глоток' }, Date.now() - 40 * 86400000), md.makeMed({ name: 'Витамин D', when: 'morning' }),
    pp.makePerson({ name: 'Анна', birthday: `${d}.${m}` })]);
});
await until(page, () => document.getElementById('day-brief'));
await page.locator('#day-brief').evaluate(d => { d.open = true; });
await page.locator('#day-summary').evaluate(d => { d.open = true; });
let brief = await text('#day-brief');
assert.match(brief, /Главное:/); assert.match(brief, /1\. ★ Позвонить маме/); assert.match(brief, /2\. Сдать отчёт \(просрочено\)/); assert.match(brief, /3\. Купить хлеб \(сегодня\)/); assert.match(brief, /И ещё дел в списке: 1/);
assert.match(brief, /Привычки на сегодня: Вода \(минимум: один глоток\)/); assert.match(brief, /Лекарства и добавки: Витамин D \(утром\)/); assert.match(brief, /День рождения: Анна \(завтра\)/);
assert.ok(!/null|undefined|NaN/.test(brief));
assert.match(await text('#day-summary'), /Задач сделано: 0/); assert.match(await text('#day-summary'), /Привычки: 0 из 1/);
// отметили дела и привычку: итог обновился, открытое состояние сохранилось
await page.locator('.item', { hasText: 'Купить хлеб' }).locator('.check').click();
await until(page, () => /Задач сделано: 1 \(из назначенных на сегодня: 1 из 1\)/.test(document.getElementById('day-summary').textContent));
assert.equal(await page.locator('#day-summary').evaluate(d => d.open), true, 'раскрытый итог не сворачивается при обновлении');
assert.match(await text('#day-summary'), /Осталось на сегодня и просрочено: 1 задача/);
assert.ok(!/3\. Купить хлеб/.test(await text('#day-brief')), 'сделанное из брифа ушло');
await clearToast(); await page.click('#brief-copy'); await toast(/Бриф скопирован/);
assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Бриф на \d{4}-\d{2}-\d{2}\nГлавное:\n1\. ★ Позвонить маме/);
await clearToast(); await page.click('#summary-copy'); await toast(/Итог скопирован/);
assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Итог дня \d{4}-\d{2}-\d{2}\nЗадач сделано: 1/);
// простой режим прячет обе карточки
await page.evaluate(async () => { (await import('./prefs.js')).setPref('simple', true); await (await import('./store.js')).refresh(); });
await until(page, () => !document.getElementById('day-brief'));
assert.equal(await page.locator('#day-cards').innerHTML().then(h => h.trim()), '', 'в скрытой разметке ничего не остаётся');
await page.evaluate(async () => { (await import('./prefs.js')).setPref('simple', false); await (await import('./store.js')).refresh(); });
await until(page, () => document.getElementById('day-brief'));


// ---------- когда есть 10 минут ----------
assert.equal(await page.locator('#ten-min').count(), 1, 'минимум привычки «Вода» уже предлагается');
await page.evaluate(async () => { const store = await import('./store.js'), ev = await import('./events.js'); await store.save(ev.makeTask('Позвонить в банк #быстро', Date.now() + 9, { due: ev.todayStr() })); });
await until(page, () => /Позвонить в банк/.test(document.getElementById('ten-min')?.textContent ?? ''));
await page.locator('#ten-min').evaluate(d => { d.open = true; });
assert.match(await text('#ten-min'), /Дело: Позвонить в банк/); assert.ok((await page.locator('#ten-min .ten-row').allTextContents()).every(r => !r.includes('#')), 'метка в строках списка не показывается');
assert.match(await text('#ten-min'), /Привычка, минимум: Вода \(один глоток\)/); assert.match(await text('#ten-min'), /Свои быстрые дела помечай в тексте задачи: #быстро/);

// ---------- разнообразие недели ----------
await page.click('#review summary');
await until(page, () => document.getElementById('review-variety'));
assert.match(await text('#review-variety'), /^Разнообразие недели: \d из 7 областей \(.*Дела.*\)/);
assert.match(await text('#review-variety'), /Пусто: /);


// ---------- второе окно приложения ----------
await tab(page, 'today');
assert.equal(await page.locator('#hint-tabs').count(), 0, 'пока окно одно, подсказки нет');
const p2 = await t.ctx.newPage();
await p2.goto(t.url); await until(p2, () => !document.getElementById('app').hidden);
await until(page, () => document.getElementById('hint-tabs'), null, 10000);
assert.match(await text('#hint-tabs'), /Приложение открыто ещё в окнах: 1\. Записи из других окон подтягиваются сами/);
// запись во втором окне появляется в первом без перезагрузки
await p2.evaluate(async () => { const st = await import('./store.js'), ev = await import('./events.js'); await st.save(ev.makeTask('Задача из второго окна', Date.now() + 77)); });
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'Задача из второго окна'), null, 10000);
assert.ok((await evs('task')).some(e => e.payload.text === 'Задача из второго окна'));
await page.click('#hint-tabs .chip'); await until(page, () => !document.getElementById('hint-tabs'));
await p2.evaluate(() => dispatchEvent(new Event('pagehide'))); await p2.close();
await page.waitForTimeout(300);

// ---------- проверка целостности при запуске ----------
await page.evaluate(async () => { const db = await import('./db.js'), st = await import('./store.js'), ev = await import('./events.js'); db.state.corrupt = ['a', 'b']; await st.save(ev.makeTask('Толчок для перерисовки', Date.now() + 88)); });
await until(page, () => document.getElementById('hint-integrity'));
assert.match(await text('#hint-integrity'), /Не удалось прочитать записей: 2\. Они не удалены и остаются на месте/);
await page.click('#hint-integrity .chip:has-text("Понятно")'); await until(page, () => !document.getElementById('hint-integrity'));
assert.equal(await page.evaluate(async () => (await import('./prefs.js')).getPref('integrityAsked') === (await import('./events.js')).todayStr()), true, 'до завтра не повторяем');
await page.evaluate(async () => { const db = await import('./db.js'), st = await import('./store.js'), pr = await import('./prefs.js'), ev = await import('./events.js'); pr.setPref('integrityAsked', ''); db.state.corrupt = []; db.state.idbOk = false; db.state.idbError = 'тест'; dispatchEvent(new CustomEvent('lifeos:tabs', { detail: 0 })); });     // перерисовка без обращения к базе (обращение вернуло бы idbOk)
await until(page, () => document.getElementById('hint-integrity'));
assert.match(await text('#hint-integrity'), /Основное хранилище не открылось \(тест\)\. Данные пока лежат в запасной копии/);
await page.click('#hint-integrity-backup'); await until(page, () => !document.getElementById('view-more').hidden);
await page.evaluate(async () => { const db = await import('./db.js'); db.state.idbOk = true; db.state.idbError = ''; });

// ---------- напоминание об архиве ----------
await tab(page, 'today');
await page.evaluate(async () => { const pr = await import('./prefs.js'), st = await import('./store.js'), ev = await import('./events.js'); pr.setPref('lastBackupAt', 0); await st.save(ev.makeTask('Для чипа', Date.now() + 111)); });
await until(page, () => document.getElementById('backup-chip'));
await tab(page, 'more');
assert.equal(await page.inputValue('#archive-remind'), '14', 'по умолчанию раз в две недели');
await page.selectOption('#archive-remind', '0');
assert.equal(await page.evaluate(async () => (await import('./prefs.js')).getPref('backupEveryDays')), 0);
await tab(page, 'today');
await page.evaluate(async () => { const st = await import('./store.js'), ev = await import('./events.js'); await st.save(ev.makeTask('Ещё для чипа', Date.now() + 122)); });
await until(page, () => !document.getElementById('backup-chip'));
await tab(page, 'more'); await page.selectOption('#archive-remind', '7');
await page.evaluate(async () => { (await import('./prefs.js')).setPref('lastBackupAt', Date.now() - 8 * 86400000); const st = await import('./store.js'), ev = await import('./events.js'); await st.save(ev.makeTask('И ещё', Date.now() + 133)); });
await tab(page, 'today'); await until(page, () => document.getElementById('backup-chip'));
await page.evaluate(async () => { (await import('./prefs.js')).setPref('lastBackupAt', Date.now() - 6 * 86400000); const st = await import('./store.js'), ev = await import('./events.js'); await st.save(ev.makeTask('И ещё раз', Date.now() + 144)); });
await until(page, () => !document.getElementById('backup-chip'));

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.11 OK');
