import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, tab, until, ymd } from './helpers.mjs';

const t = await launch();
const { page, ctx, errors } = t;
await page.goto(t.url);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();                                  // чтобы SW взял страницу под контроль

const count = sel => page.locator(sel).count();
const waitCount = (sel, n) => until(page, ([s, k]) => document.querySelectorAll(s).length === k, [sel, n]);
async function add(text, { due, repeat, high } = {}) {
  await page.fill('#add-input', text);
  if (due) await page.fill('#add-due', due);
  if (repeat) await page.selectOption('#add-repeat', repeat);
  if (high) await page.check('#add-high');
  await page.press('#add-input', 'Enter');
  await until(page, tx => [...document.querySelectorAll('.item .text')].some(n => n.textContent.endsWith(tx)), text);
}

// ---------- данные прошлой версии: записаны «по-старому» прямо в IndexedDB, новая версия обязана их показать ----------
await page.evaluate(() => new Promise((resolve, reject) => {
  const rq = indexedDB.open('lifeos', 1);
  rq.onsuccess = () => {
    const db = rq.result, tx = db.transaction('events', 'readwrite'), st = tx.objectStore('events');
    st.put({ id: 'legacy-r0', type: 'task', ts: 1793900000000, payload: { text: 'задача из старой версии R0', done: false, doneAt: null }, source: 'manual', confidence: 1, evidence: [] });
    st.put({ id: 'legacy-r1', type: 'task', ts: 1793900001000, payload: { text: 'жильё из версии R1', done: false, doneAt: null, due: '2099-01-10', repeat: { type: 'monthly', day: 10 } }, source: 'manual', confidence: 1, evidence: [] });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
  rq.onerror = () => reject(rq.error);
}));
await page.reload();
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'задача из старой версии R0'));
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'жильё из версии R1'));
await page.locator('.item', { hasText: 'задача из старой версии R0' }).locator('.body').click();      // старую запись можно править
await page.fill('.edit-text', 'старая задача, исправлена'); await page.click('form.editing .save');
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'старая задача, исправлена'));
await page.locator('.item', { hasText: 'старая задача, исправлена' }).locator('.del').click();
await page.locator('.item', { hasText: 'жильё из версии R1' }).locator('.del').click();
await waitCount('.item', 0);

// ---------- офлайн ----------
await ctx.setOffline(true);
await page.reload();
for (const x of ['one', 'two', 'three', 'four', 'five']) await add(x);
await waitCount('ul.open .item', 5);
await page.locator('ul.open .item').first().locator('.check').click();
await waitCount('ul.open .item', 4);
assert.equal(await page.textContent('#done-count'), '1');
await page.reload();
await waitCount('ul.open .item', 4);
assert.match(await page.textContent('#status'), /офлайн/);
await ctx.setOffline(false);

// ---------- экспорт открытым JSON ----------
await tab(page, 'more');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
const file = await dl.path();
const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(exported.app, 'lifeos');
assert.equal(exported.events.filter(e => e.type === 'task').length, 5);

// удалить всё и вернуть импортом
await tab(page, 'today');
for (let i = 4; i > 0; i--) { await page.locator('ul.open .item .del').first().click(); await waitCount('ul.open .item', i - 1); }
await page.locator('#done-block summary').click();
await page.locator('#done-list .item .del').first().click();
await waitCount('.item', 0);
await tab(page, 'more');
await page.setInputFiles('#import-input', file);
await tab(page, 'today');
await waitCount('ul.open .item', 4);
assert.equal(await page.textContent('#done-count'), '1', 'импорт восстановил');

// ---------- двойное хранение ----------
await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('lifeos'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.reload();
await waitCount('ul.open .item', 4);                  // восстановлено из копии localStorage
await page.evaluate(() => localStorage.removeItem('lifeos.events.v1'));
await page.reload();
await waitCount('ul.open .item', 4);                  // восстановлено из IndexedDB

// ---------- сроки, повторы, группы ----------
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('lifeos'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.reload();
await add('просроченная', { due: ymd(-2) });
await add('на сегодня', { due: ymd(0) });
await add('жильё', { due: ymd(0), repeat: 'monthly' });
await add('потом', { due: ymd(5) });
await add('без срока');
assert.equal(await count('#g-overdue .item'), 1);
assert.equal(await count('#g-today .item'), 2);
assert.equal(await count('#g-upcoming .item'), 1);
assert.equal(await count('#g-nodate .item'), 1);
assert.match(await page.textContent('#g-overdue .meta'), /просрочено на 2 дн/);
assert.match(await page.textContent('#g-today'), /каждый месяц/);

await page.locator('#g-today .item', { hasText: 'жильё' }).locator('.check').click();      // следующая — через месяц
await waitCount('#g-upcoming .item', 2);
assert.equal(await count('#g-today .item'), 1);
await page.locator('#done-block summary').click();
await page.locator('#done-list .item', { hasText: 'жильё' }).locator('.check').click();     // отмена: лишняя исчезает
await waitCount('#g-upcoming .item', 1);
await waitCount('#g-today .item', 2);
assert.equal(await count('.item:has-text("жильё")'), 1, 'ровно одна «жильё»');

// ---------- редактирование ----------
await page.locator('#g-upcoming .item', { hasText: 'потом' }).locator('.body').click();
await page.waitForSelector('form.item.editing');
await page.fill('.edit-text', 'потом изменено');
await page.fill('.edit-due', ymd(0));
await page.selectOption('.edit-repeat', 'weekly');
await page.check('.edit-high');
await page.click('form.editing .save');
await waitCount('#g-today .item', 3);
assert.match(await page.textContent('#g-today'), /★ потом изменено[\s\S]*каждую неделю/);
assert.equal(await count('#g-upcoming .item'), 0);
// отмена не меняет; пустой текст не сохраняется; быстрые даты работают
await page.locator('#g-today .item', { hasText: 'потом изменено' }).locator('.body').click();
await page.fill('.edit-text', 'не должно сохраниться');
await page.click('form.editing .cancel');
await page.waitForSelector('form.editing', { state: 'detached' });
assert.equal(await count('.item:has-text("не должно сохраниться")'), 0);
await page.locator('#g-today .item', { hasText: 'потом изменено' }).locator('.body').click();
await page.fill('.edit-text', '');
await page.click('form.editing .save');
assert.equal(await count('form.editing'), 1, 'форма осталась открытой');
await page.click('form.editing .chip:has-text("Завтра")');
assert.equal(await page.inputValue('.edit-due'), ymd(1));
await page.fill('.edit-text', 'потом изменено');
await page.click('form.editing .save');
await waitCount('#g-today .item', 2);
await waitCount('#g-upcoming .item', 1);

// редактор не теряет введённое, когда данные обновились в фоне (отметка другой задачи)
await page.locator('#g-today .item', { hasText: 'на сегодня' }).locator('.body').click();
await page.fill('.edit-text', 'набираю текст');
await page.locator('#g-overdue .item .check').click();       // другая задача выполнена -> перерисовка
await waitCount('#g-overdue .item', 0);
assert.equal(await page.inputValue('.edit-text'), 'набираю текст', 'введённое сохранилось');
await page.click('form.editing .cancel');

// ---------- разбор дат в тексте ----------
await page.fill('#add-input', 'купить хлеб завтра');
await page.waitForSelector('#add-hint:not([hidden])');
assert.match(await page.textContent('#add-hint'), /Распознано — срок: завтра/);
await page.press('#add-input', 'Enter');
await until(page, () => [...document.querySelectorAll('#g-upcoming .text')].some(n => n.textContent === 'купить хлеб'));
await page.fill('#add-input', 'позвонить завтра');
await page.click('#add-hint .link');                         // «Не надо» — оставить как есть
await page.press('#add-input', 'Enter');
await until(page, () => [...document.querySelectorAll('#g-nodate .text')].some(n => n.textContent === 'позвонить завтра'));
await page.fill('#add-input', 'оплатить жильё 10 числа каждого месяца');
await page.press('#add-input', 'Enter');
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'оплатить жильё'));
assert.match(await page.locator('.item', { hasText: 'оплатить жильё' }).textContent(), /каждый месяц/);

// ---------- отмена удаления ----------
await page.locator('#g-nodate .item', { hasText: 'позвонить завтра' }).locator('.del').click();
await page.waitForSelector('#toast:not([hidden])');
assert.match(await page.textContent('#toast'), /Задача удалена/);
assert.equal(await count('.item:has-text("позвонить завтра")'), 0);
await page.click('#toast button');
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'позвонить завтра'));

// сводка и итоги недели отрисованы
assert.match(await page.textContent('#summary'), /Задач: \d+/);
await page.click('#review summary');
assert.match(await page.textContent('#review'), /Сделано задач/);
assert.equal(await count('#review .bar-col'), 7);

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E TASKS OK');
