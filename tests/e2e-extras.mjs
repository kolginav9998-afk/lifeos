import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, tab, until } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const count = sel => page.locator(sel).count();
const waitCount = (sel, n) => until(page, ([s, k]) => document.querySelectorAll(s).length === k, [sel, n]);
const text = sel => page.textContent(sel);
async function addMoney(amount, category, note = '') {
  await page.fill('#exp-amount', amount); await page.fill('#exp-category', category); await page.fill('#exp-note', note);
  await page.press('#exp-amount', 'Enter');
}

// ---------- быстрые повторные траты ----------
await tab(page, 'money');
assert.equal(await page.locator('#quick-exp').isVisible(), false, 'пока частых трат нет');
await addMoney('350', 'Еда'); await waitCount('#exp-list .item', 1);
await addMoney('350', 'Еда'); await waitCount('#exp-list .item', 2);
await until(page, () => !document.getElementById('quick-exp').hidden);
assert.match(await text('#quick-exp'), /Еда 350\s₽/);
await page.click('#quick-exp .chip');
await waitCount('#exp-list .item', 3);
await until(page, () => /Добавлено: Еда 350/.test(document.getElementById('toast').textContent));
await page.click('#toast button');                               // отменить
await waitCount('#exp-list .item', 2);

// ---------- доходы и баланс ----------
assert.equal(await page.getAttribute('#kind-expense', 'aria-pressed'), 'true');
await page.click('#kind-income');
assert.equal(await text('#exp-form strong'), 'Новый доход');
assert.equal(await text('#kind-caption'), 'Доходы за месяц');
assert.equal(await page.locator('#budget-btn').isVisible(), false, 'бюджет — только для расходов');
assert.match(await text('#view-money'), /доходов нет/);
await addMoney('100 000', 'Зарплата', 'аванс');
await waitCount('#exp-list .item', 1);
assert.match(await text('#month-total'), /^100\s000\s₽$/);
assert.match(await text('#exp-list'), /\+100\s000\s₽/);
assert.equal(await count('#exp-list .amount.plus'), 1);
assert.match(await text('#balance-line'), /Доходы 100\s000\s₽ · Расходы 700\s₽ · Баланс \+99\s300\s₽/);
assert.match(await text('#exp-cats').catch(() => '') + await page.evaluate(() => [...document.querySelectorAll('#exp-cats option')].map(o => o.value).join(',')), /Зарплата,Подработка/, 'категории доходов');
await page.click('#exp-list .body');                              // правка дохода
assert.equal(await text('#exp-form strong'), 'Изменить доход');
await page.fill('#exp-amount', '120000');
await page.click('#exp-form button[type=submit]');
await until(page, () => /^120\s000\s₽$/.test(document.getElementById('month-total').textContent));
await page.click('#kind-expense');
assert.match(await text('#month-total'), /^700\s₽$/);
assert.equal(await page.locator('#budget-btn').isVisible(), true);
assert.match(await text('#balance-line'), /Баланс \+119\s300\s₽/);

const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#csv-btn')]);
const csvText = fs.readFileSync(await csv.path(), 'utf8');
assert.ok(csvText.includes('Доход;') && csvText.includes(';120000,00;Зарплата;аванс') && csvText.includes('Расход;'));

await page.click('#search-btn'); await page.fill('#search-input', 'аванс');
await waitCount('#search-results .result:not(.course)', 1);
assert.match(await text('#search-results'), /Доход/);
await page.click('#search-btn');

// ---------- шаблоны привычек ----------
await tab(page, 'habits');
assert.equal(await count('#habit-templates .tpl'), 8);
await page.click('#habit-templates .tpl:has-text("Зарядка")');
assert.equal(await page.inputValue('#habit-name'), 'Зарядка');
assert.equal(await page.inputValue('#habit-min'), '5 приседаний');
assert.equal(await page.inputValue('#habit-anchor'), 'после пробуждения');
await page.press('#habit-name', 'Enter');
await waitCount('.habit', 1);
assert.equal(await page.locator('#habit-add').evaluate(d => d.open), false, 'форма свернулась');
await page.click('.h-min');

// ---------- журнал дня ----------
await tab(page, 'today');
await page.fill('#add-input', 'сделать отчёт'); await page.press('#add-input', 'Enter');
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'сделать отчёт'));
await page.locator('.item', { hasText: 'сделать отчёт' }).locator('.check').click();
await until(page, () => document.getElementById('done-count').textContent === '1');
await page.click('#journal summary');
const kinds = await page.locator('#journal-list .j-kind').allTextContents();
assert.deepEqual([...kinds].sort(), ['Доход', 'Задача', 'Привычка', 'Расход', 'Расход'].sort());
assert.match(await text('#journal-list'), /Зарядка — минимум/);
assert.match(await text('#journal-list'), /\+120\s000\s₽ · Зарплата — аванс/);
const yesterday = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
await page.fill('#journal-date', yesterday);
assert.match(await text('#journal-list'), /записей нет/);

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E EXTRAS OK');
