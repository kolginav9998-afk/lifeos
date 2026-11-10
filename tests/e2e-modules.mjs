import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, tab, until, rawDisk } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const count = sel => page.locator(sel).count();
const waitCount = (sel, n) => until(page, ([s, k]) => document.querySelectorAll(s).length === k, [sel, n]);
const text = sel => page.textContent(sel);
const toastText = async () => { await page.waitForSelector('#toast:not([hidden])'); return text('#toast'); };

// ---------- приветствие ----------
assert.equal(await page.locator('#onboarding').isVisible(), true, 'для нового пользователя виден онбординг');
await page.click('#onboarding button:has-text("Понятно")');
await page.reload();
assert.equal(await page.locator('#onboarding').isVisible(), false, 'после «Понятно» не возвращается');

// ---------- привычки ----------
await tab(page, 'habits');
await page.fill('#habit-name', 'Python');
await page.fill('#habit-anchor', 'после завтрака');
await page.fill('#habit-min', 'открыть редактор');
await page.press('#habit-name', 'Enter');
await waitCount('.habit', 1);
assert.match(await text('.habit'), /Python · после: после завтрака/);
assert.match(await text('.habit .h-stats'), /Серия: 0 · Лучшая: 0 · Регулярность за 30 дн\.: 0% \(0 из 1\)/);
await page.click('.h-min');
await until(page, () => document.querySelector('.h-min.on'));
assert.match(await text('.h-min'), /✓ Минимум: открыть редактор/);
assert.match(await text('.h-stats'), /Серия: 1 · Лучшая: 1 · Регулярность за 30 дн\.: 100% \(1 из 1\)/);
await tab(page, 'today');
assert.match(await text('#summary'), /Привычки: 1\/1/);
await tab(page, 'habits');
await page.click('.h-min');                                  // повторное нажатие снимает отметку
await until(page, () => !document.querySelector('.h-min.on'));
assert.match(await toastText(), /Отметка снята/);
await page.click('#toast button');                           // «Вернуть»
await until(page, () => document.querySelector('.h-min.on'));
await page.click('.h-full');                                 // полная версия заменяет минимум
await until(page, () => document.querySelector('.h-full.on') && !document.querySelector('.h-min.on'));
await page.check('#heavy-day');                              // тяжёлый день: только минимум
await until(page, () => !document.querySelector('.h-full'));
await page.uncheck('#heavy-day');
await until(page, () => document.querySelector('.h-full'));
assert.equal(await count('.h-cal .dot'), 28);
assert.equal(await count('.h-cal .dot.full'), 1);

await page.click('.habit .more summary');                    // правка
await page.click('.habit .edit');
await page.fill('.edit-name', 'Python 2');
await page.click('form.editing .save');
await until(page, () => document.querySelector('.h-name')?.textContent === 'Python 2');
await page.click('.habit .more summary');                    // архив и возврат
await page.click('.habit .arch');
await waitCount('#habit-list .habit', 0);
await page.click('#view-habits details:has(#habit-archive) summary');
await waitCount('#habit-archive .habit', 1);
await page.click('#habit-archive .more summary');
await page.click('#habit-archive .arch');
await waitCount('#habit-list .habit', 1);
await page.click('.habit .more summary');                    // удаление с отменой
await page.click('.habit .del-habit');
await waitCount('.habit', 0);
assert.match(await toastText(), /Привычка удалена/);
await page.click('#toast button');
await waitCount('.habit', 1);
assert.equal(await count('.h-cal .dot.full'), 1, 'отметки вернулись вместе с привычкой');

// ---------- деньги ----------
await tab(page, 'money');
await page.fill('#exp-amount', '1 250,50');
await page.fill('#exp-category', 'Еда');
await page.fill('#exp-note', 'хлеб');
await page.press('#exp-note', 'Enter');
await waitCount('#exp-list .item', 1);
assert.match(await text('#month-total'), /^1\s250,50\s₽$/);
await page.fill('#exp-amount', '30000');
await page.fill('#exp-category', 'Жильё');
await page.press('#exp-amount', 'Enter');
await waitCount('#exp-list .item', 2);
assert.match(await text('#month-total'), /^31\s250,50\s₽$/);
assert.equal(await count('#cats .cat'), 2);
assert.match(await text('#cats'), /Жильё[\s\S]*96%/);
await page.fill('#exp-amount', 'abc');                       // неверная сумма
await page.press('#exp-amount', 'Enter');
assert.match(await toastText(), /Сумма: например/);
assert.equal(await count('#exp-list .item'), 2);
await page.fill('#exp-amount', '');

await page.click('#budget-btn');                             // бюджет
await page.fill('#budget-input', '50000');
await page.press('#budget-input', 'Enter');
await until(page, () => /осталось/.test(document.getElementById('budget-line').textContent));
assert.match(await text('#budget-line'), /Бюджет 50\s000\s₽ · осталось 18\s749,50\s₽/);

await page.locator('#exp-list .item', { hasText: 'хлеб' }).locator('.body').click();   // правка
assert.equal(await page.inputValue('#exp-amount'), '1250,5');
assert.equal(await text('#exp-form strong'), 'Изменить расход');
await page.fill('#exp-amount', '2000');
await page.click('#exp-form button[type=submit]');
await until(page, () => /^32\s000\s₽$/.test(document.getElementById('month-total').textContent));
assert.equal(await text('#exp-form strong'), 'Новый расход');
assert.equal(await page.inputValue('#exp-amount'), '');

assert.equal(await count('#month-chart .bar-col'), 6, 'график за 6 месяцев');
assert.equal(await count('#month-chart .bar-col.current'), 1);
await page.click('#hide-amounts');                           // скрыть суммы
assert.equal(await text('#month-total'), '•••• ₽');
assert.ok(!(await text('#exp-list')).match(/\d\s?000/), 'суммы в списке скрыты');
await page.click('#hide-amounts');
assert.match(await text('#month-total'), /^32\s000\s₽$/);

await page.click('#month-prev');                             // прошлый месяц — пусто
assert.match(await text('#exp-list') + await page.textContent('#view-money'), /расходов нет/);
await page.click('#month-next');
await waitCount('#exp-list .item', 2);

const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#csv-btn')]);
const csvText = fs.readFileSync(await csv.path(), 'utf8');
assert.ok(csvText.startsWith('﻿Дата;Сумма;Категория;Комментарий'));
assert.ok(csvText.includes(';2000,00;Еда;хлеб'));

await page.locator('#exp-list .item', { hasText: 'Жильё' }).locator('.del').click();   // удаление с отменой
await waitCount('#exp-list .item', 1);
assert.match(await toastText(), /Расход удалён/);
await page.click('#toast button');
await waitCount('#exp-list .item', 2);

// ---------- заметки ----------
await tab(page, 'notes');
await page.fill('#note-input', 'Первая заметка\nвторая строка с ёлкой');
await page.click('#note-form button[type=submit]');
await waitCount('.note', 1);
assert.equal(await text('.note-title'), 'Первая заметка');
await page.fill('#note-filter', 'нет такого');
assert.match(await text('#view-notes'), /Ничего не найдено/);
await page.fill('#note-filter', 'елко');                     // ё/е не важны
assert.equal(await count('.note'), 1);
await page.fill('#note-filter', '');
await page.click('.note');
await page.fill('.edit-note', 'Первая заметка (правка)');
await page.click('form.editing .save');
await until(page, () => document.querySelector('.note-title')?.textContent === 'Первая заметка (правка)');
await page.click('.note');
await page.click('form.editing .danger');
await waitCount('.note', 0);
assert.match(await toastText(), /Заметка удалена/);
await page.click('#toast button');
await waitCount('.note', 1);

// ---------- поиск ----------
await page.click('#search-btn');
await page.fill('#search-input', 'хлеб');
await waitCount('#search-results .result', 1);
assert.match(await text('#search-results'), /Расход/);
await page.fill('#search-input', 'python');
await waitCount('#search-results .result', 1);
assert.match(await text('#search-results'), /Привычка/);
await page.fill('#search-input', 'zzzz');
assert.match(await text('#search-results'), /Ничего не найдено/);
await page.fill('#search-input', 'хлеб');
await page.click('#search-results .result');
assert.equal(await text('#title'), 'Деньги', 'клик по результату открывает нужную вкладку');
assert.equal(await page.locator('#search-panel').isVisible(), false);

// ---------- горячие клавиши ----------
await page.locator('body').press('/');
assert.equal(await page.locator('#search-panel').isVisible(), true);
assert.equal(await page.evaluate(() => document.activeElement.id), 'search-input');
await page.keyboard.press('Escape');
assert.equal(await page.locator('#search-panel').isVisible(), false);
await tab(page, 'notes');
await page.locator('body').press('n');
assert.equal(await text('#title'), 'Сегодня');
assert.equal(await page.evaluate(() => document.activeElement.id), 'add-input');
await page.fill('#add-input', '/ и n внутри поля не срабатывают');
assert.equal(await text('#title'), 'Сегодня');
await page.fill('#add-input', '');

// ---------- профиль, тема, диагностика ----------
await tab(page, 'more');
await page.fill('#profile-name', 'Алекс');
await page.press('#profile-name', 'Enter');
await tab(page, 'today');
await until(page, () => document.querySelector('.hello')?.textContent === 'Привет, Алекс');
await tab(page, 'more');
await page.selectOption('#theme-select', 'dark');
assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
await page.reload();
assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', 'тема сохраняется');
await page.selectOption('#theme-select', 'auto');
assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null);
assert.match(await text('#stats'), /задачи|привычки/);
assert.match(await text('#stats'), /расходы: 2/);
assert.match(await text('#diag'), /Версия R2\.1/);
assert.match(await text('#diag'), /Запуск №\d+/);
assert.match(await text('#diag'), /Пароль: не задан/);

assert.match(await text('#remind-box'), /только в приложении для Android/, 'на сайте напоминания недоступны и это объяснено');
assert.match(await text('#stats'), /Последняя копия: ещё не делал/);
await tab(page, 'today');
assert.equal(await page.locator('#backup-chip').isVisible(), true, 'много данных и нет копии — предложение сделать копию');
await tab(page, 'more');
const [md] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
const mdText = fs.readFileSync(await md.path(), 'utf8');
for (const part of ['## Задачи', '## Привычки', 'Python 2', '## Заметки', 'Первая заметка (правка)', '## Расходы']) assert.ok(mdText.includes(part), part);

const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
assert.equal(JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8')).app, 'lifeos');
await until(page, () => /Последняя копия: сегодня/.test(document.getElementById('stats').textContent));
await tab(page, 'today');
assert.equal(await page.locator('#backup-chip').count(), 0, 'после копии предложение пропало');

// ---------- «Поделиться» и ярлыки ----------
await page.goto(t.url + '?title=Привет&text=мир&url=https%3A%2F%2Fexample.com');
await until(page, () => !document.getElementById('app').hidden && document.getElementById('add-input').value !== '');
assert.equal(await page.inputValue('#add-input'), 'Привет мир https://example.com');
assert.equal(await page.evaluate(() => location.search), '', 'чужой текст убран из адреса');
assert.equal(await count('.item:has-text("example.com")'), 0, 'сам по себе ничего не сохраняется');
await page.goto(t.url + '?add=expense');
await until(page, () => document.activeElement?.id === 'exp-amount');
assert.equal(await text('#title'), 'Деньги');
await page.goto(t.url + '?text=' + encodeURIComponent('<img src=x onerror=alert(1)>'));
await until(page, () => document.getElementById('add-input').value.startsWith('<img'));
assert.equal(await count('#view img'), 0, 'разметка из чужого текста не вставляется в страницу');

// ---------- стирание ----------
await tab(page, 'more');
assert.equal(await page.locator('#wipe-btn').isDisabled(), true);
await page.fill('#wipe-confirm', 'стереть');
assert.equal(await page.locator('#wipe-btn').isDisabled(), false);
await Promise.all([page.waitForNavigation(), page.click('#wipe-btn')]);
await until(page, () => !document.getElementById('app').hidden);
const disk = await rawDisk(page);
assert.deepEqual(disk.idb, [], 'IndexedDB пуст');
assert.ok(!disk.ls || disk.ls === '[]', 'копия в localStorage пуста');
assert.deepEqual(Object.keys(disk.all).filter(k => k.startsWith('lifeos.') && !['lifeos.meta', 'lifeos.prefs.v1'].includes(k) && disk.all[k] !== '[]'), []);
assert.equal(await page.locator('#onboarding').isVisible(), true, 'настройки тоже сброшены');

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E MODULES OK');
