// Меню «Куда зайти»: вкладка «Меню» открывает список разделов, поиск по словам находит нужный раздел, плитка ведёт на экран.
import assert from 'node:assert/strict';
import { launch, appReady, waitText, waitCount, eventually } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.goto(t.url); await appReady(page);

// нижняя панель: пять понятных вкладок
assert.deepEqual(await page.locator('#tabs button span').allTextContents(), ['Сегодня', 'Дом', 'Деньги', 'Учёба', 'Меню']);

// «Меню» — первый экран своей вкладки
await page.click('#tabs button[data-tab="more"]');
await waitText(page, '#title', 'Меню');
assert.deepEqual(await page.locator('#subnav button').allTextContents(), ['Все разделы', 'Профиль', 'Настройки', 'Справка']);
await waitCount(page, '.menu-sec', 7);
assert.ok(await page.locator('.menu-tile').count() >= 20, 'плитки по всем разделам');
assert.equal(await page.locator('#menu-results').isHidden(), true);

// поиск обычными словами
await page.fill('#menu-search', 'стирка');
await eventually(() => page.locator('#menu-results .menu-tile[data-screen="home"]').count(), n => assert.equal(n, 1, 'по слову «стирка» нашёлся «Дом»'));
assert.match(await page.textContent('#menu-status'), /Найдено разделов: \d+/);
assert.equal(await page.locator('#menu-sections').isHidden(), true, 'пока ищем, плитки по разделам спрятаны');

// плитка ведёт на экран, вкладка внизу подсвечена
await page.click('#menu-results .menu-tile[data-screen="home"]');
await waitText(page, '#title', 'Дом');
assert.equal(await page.locator('#tabs button[data-tab="home"][aria-current="page"]').count(), 1);

// вернулись в меню: поиск очищен; пустой поиск говорит понятно
await page.click('#tabs button[data-tab="more"]');
await waitText(page, '#title', 'Меню');
assert.equal(await page.inputValue('#menu-search'), '');
await page.fill('#menu-search', 'qwertyuiop');
await waitText(page, '#menu-status', /Ничего не найдено/);

// с клавиатуры: ввод, Tab на первую находку, Enter
await page.fill('#menu-search', 'зарплату');
await eventually(() => page.locator('#menu-results .menu-tile').first().getAttribute('data-screen'), s => assert.equal(s, 'salary'));
await page.focus('#menu-search');
await page.keyboard.press('Tab');
await page.keyboard.press('Enter');
await waitText(page, '#title', 'Зарплата');
assert.equal(await page.evaluate(() => document.activeElement?.id), 'title', 'после перехода фокус на заголовке нового экрана');

// плитка из раздела «Учёба» открывает «С нуля»
await page.click('#tabs button[data-tab="more"]');
await page.click('.menu-tile[data-screen="zero"]');
await waitText(page, '#title', 'С нуля');

const real = errors.filter(x => !/Failed to load resource/.test(x));
assert.deepEqual(real, [], `нет ошибок в консоли:\n${real.join('\n')}`);
await t.close();
console.log('E2E MENU OK');
