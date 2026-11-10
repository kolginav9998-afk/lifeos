// Запуск: node tests/e2e.mjs  (поднимает свой статический сервер)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));

await page.goto(url);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); // чтобы SW взял контроль

// офлайн
await ctx.setOffline(true);
await page.reload();
for (const t of ['one', 'two', 'three', 'four', 'five']) {
  await page.fill('#add-input', t);
  await page.press('#add-input', 'Enter');
}
await page.waitForFunction(() => document.querySelectorAll('ul.open .item').length === 5, null, { timeout: 3000 });

// выполнить
await page.locator('ul.open .item').first().locator('.check').click();
await page.waitForFunction(() => document.querySelectorAll('ul.open .item').length === 4);
assert.equal(await page.textContent('#done-count'), '1');

// перезапуск — данные на месте
await page.reload();
assert.equal(await page.locator('ul.open .item').count(), 4, 'после перезапуска');
assert.equal(await page.textContent('#done-count'), '1');
assert.match(await page.textContent('#status'), /офлайн/);
await ctx.setOffline(false);

// экспорт
await page.click('details.data summary');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
const file = await dl.path();
const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(exported.events.length, 5);

// удалить всё, импортировать обратно
for (let i = 4; i > 0; i--) {
  await page.locator('ul.open .item .del').first().click();
  await page.waitForFunction(n => document.querySelectorAll('ul.open .item').length === n, i - 1);
}
await page.locator('#done-block summary').click();
await page.locator('#done-list .item .del').first().click();
await page.waitForFunction(() => document.querySelectorAll('.item').length === 0);
await page.setInputFiles('#import-input', file);
await page.waitForFunction(() => document.querySelectorAll('ul.open .item').length === 4);
assert.equal(await page.textContent('#done-count'), '1', 'импорт восстановил');

// IndexedDB стёрт, а копия в localStorage жива — данные восстанавливаются
await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('lifeos'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('ul.open .item').length === 4);
assert.match(await page.textContent('#diag'), /Запуск №\d+/);

// и наоборот: стёрт localStorage, IndexedDB жив
await page.evaluate(() => localStorage.removeItem('lifeos.events.v1'));
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('ul.open .item').length === 4);

// ---- R1: сроки и повтор ----
await page.evaluate(() => { localStorage.clear(); });
await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('lifeos'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.reload();
const ymd = off => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
async function add(text, due, repeat) {
  await page.fill('#add-input', text);
  if (due) await page.fill('#add-due', due);
  if (repeat) await page.selectOption('#add-repeat', repeat);
  await page.press('#add-input', 'Enter');
  await page.waitForFunction(t => [...document.querySelectorAll('.item .text')].some(n => n.textContent === t), text);
}
await add('просроченная', ymd(-2));
await add('на сегодня', ymd(0));
await add('жильё', ymd(0), 'monthly');
await add('потом', ymd(5));
await add('без срока');
assert.equal(await page.locator('#g-overdue .item').count(), 1);
assert.equal(await page.locator('#g-today .item').count(), 2);
assert.equal(await page.locator('#g-upcoming .item').count(), 1);
assert.equal(await page.locator('#g-nodate .item').count(), 1);
assert.match(await page.textContent('#g-overdue .meta'), /просрочено на 2 дн/);
assert.match(await page.textContent('#g-today'), /каждый месяц/);

// отметить «жильё»: появляется следующая через месяц, в разделе «Скоро»
await page.locator('#g-today .item', { hasText: 'жильё' }).locator('.check').click();
await page.waitForFunction(() => document.querySelectorAll('#g-upcoming .item').length === 2);
assert.match(await page.textContent('#g-upcoming'), /жильё/);
assert.equal(await page.locator('#g-today .item').count(), 1);

// отменить: следующая исчезает, дубля нет
await page.locator('#done-block summary').click();
await page.locator('#done-list .item', { hasText: 'жильё' }).locator('.check').click();
await page.waitForFunction(() => document.querySelectorAll('#g-upcoming .item').length === 1);
await page.waitForFunction(() => document.querySelectorAll('#g-today .item').length === 2);
assert.equal(await page.locator('.item', { hasText: 'жильё' }).count(), 1, 'ровно одна «жильё»');

// переживает перезапуск
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('#g-today .item').length === 2);
assert.match(await page.textContent('#g-overdue'), /просроченная/);

// манифест
const man = await (await ctx.request.get(url + 'manifest.webmanifest')).json();
assert.equal(man.display, 'standalone');

assert.deepEqual(errors, [], 'нет ошибок в консоли: ' + errors.join('; '));
await browser.close(); server.close();
console.log('E2E OK');
