// R3.3: старт-чеклист, слово дня, вопрос дня, дыхание, итоги недели, эксперименты, запрос к ИИ из урока.
import assert from 'node:assert/strict';
import { launch, tab, until, ymd } from './helpers.mjs';

const t = await launch({ ctxOptions: { permissions: ['clipboard-read', 'clipboard-write'] } });
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);
const evs = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);

// ---------- старт: пять шагов ----------
assert.equal(await page.locator('#onboarding li[data-step]').count(), 5);
assert.equal(await page.locator('#onboarding li.done').count(), 0);
await page.fill('#add-input', 'первая задача'); await page.press('#add-input', 'Enter');
await until(page, () => document.querySelector('#onboarding li[data-step="task"].done'));
assert.equal(await page.locator('#onboarding li.done').count(), 1);

// ---------- слово дня ----------
assert.equal(await page.isVisible('#wotd'), true);
assert.equal(await page.locator('.wotd-row').count(), 2);
const first = page.locator('.wotd-row[data-track="english"]');
assert.equal(await first.locator('span.muted').isHidden(), true, 'перевод скрыт');
await first.locator('.wotd-show').click();
assert.equal(await first.locator('span.muted').isVisible(), true, 'перевод открылся по касанию');
await page.click('#wotd button:has-text("скрыть")');
assert.equal(await page.isVisible('#wotd'), false);

// ---------- дневник: вопрос дня и «в этот день» ----------
await tab(page, 'diary');
const q = await text('#diary-question');
assert.ok(q.length > 15 && q.endsWith('?'), q);
await page.click('#diary-ask');
assert.ok((await page.inputValue('#diary-text')).startsWith(q + '\n'), 'вопрос вставлен в запись');
await page.type('#diary-text', 'Ответ про день #вопрос');
await page.click('#diary-save'); await toast(/Запись сохранена/);
await page.evaluate(async () => {
  const store = await import('./store.js'); const diary = await import('./diary.js'); const ev = await import('./events.js');
  const d = new Date(); d.setDate(d.getDate() - 30);
  await store.save(diary.makeDiary(ev.todayStr(d.getTime()), { text: 'Месяц назад я начинал этот путь' }, d.getTime()));
});
await page.click('#diary-prev'); await page.click('#diary-today');
await until(page, () => /30 дней назад/.test(document.getElementById('diary-past').textContent));
assert.match(await text('#diary-past'), /Месяц назад я начинал этот путь/);

// ---------- дыхание ----------
await tab(page, 'health');
await page.click('#breath-start');
assert.equal(await page.isVisible('#breath-host'), true);
await page.click('#breath-go');
assert.equal(await page.getAttribute('#breath-circle', 'data-phase'), 'in');
assert.match(await text('#breath-word'), /Вдох/);
await page.click('#breath-stop');                                       // слишком коротко — не записывается
await page.click('#breath-skip');
assert.equal(await page.isVisible('#breath-host'), false);
assert.equal((await evs('breath')).length, 0, 'меньше 20 секунд не сохраняем');
await page.click('#breath-start');
await page.selectOption('#breath-min', '180');
await page.locator('#breath-host .rate[data-v="4"]').click();
await page.clock.install({ time: new Date() });
await page.click('#breath-go');
await page.clock.runFor(5000);
assert.match(await text('#breath-word'), /Выдох/);
await page.clock.runFor(176500);
await until(page, () => document.getElementById('breath-result'));
assert.match(await text('#breath-result'), /Готово/);
await page.locator('#breath-host .rate[data-v="2"]').click();
await until(page, () => document.getElementById('breath-host').hidden);
const breaths = await evs('breath');
assert.equal(breaths.length, 1); assert.equal(breaths[0].payload.before, 4); assert.equal(breaths[0].payload.after, 2); assert.ok(breaths[0].payload.seconds >= 175);
await page.clock.resume();

// ---------- итоги недели ----------
await tab(page, 'diary');
await page.locator('#ci-m').evaluate(d => { d.open = true; });
await page.fill('#ci-bed', '23:00'); await page.fill('#ci-wake', '06:30'); await page.click('#ci-m-save'); await toast(/Утро сохранено/);
await page.locator('#ci-e').evaluate(d => { d.open = true; });
await page.click('#ci-e .stepper[data-field="exercise"] button[aria-label="Тренировка: больше"]'); await page.click('#ci-e-save'); await toast(/Вечер сохранён/);
await tab(page, 'today');
await until(page, () => /Сон: в среднем 7,5 ч/.test(document.getElementById('review-health')?.textContent ?? ''));
assert.match(await text('#review-health'), /Активность: 30 из 150 минут/);

// ---------- урок: запрос к ИИ ----------
await tab(page, 'learn');
await page.click('.track-card[data-track="data"]');
await page.click('.lesson[data-lesson="ds-01"] summary');
await page.click('button[data-ai-check="ds-01"]');
await toast(/Скопировано/);
const prompt = await page.evaluate(() => navigator.clipboard.readText());
assert.match(prompt, /Цикл работы с данными/); assert.match(prompt, /Задание:/); assert.match(prompt, /Мой ответ: <вставь свой ответ>/);

// ---------- эксперименты ----------
await tab(page, 'insights');
await page.click('#exp-new summary');
await page.selectOption('#exp-preset', 'caffeine14');
assert.equal(await page.inputValue('#exp-title'), 'Кофе только до 14:00');
assert.equal(await page.inputValue('#exp-metric'), 'sleepQuality');
await page.fill('#exp-title', ''); await page.click('#exp-start');
assert.match(await text('#exp-err'), /Назови эксперимент/);
await page.fill('#exp-title', 'Кофе только до 14:00'); await page.click('#exp-start');
await toast(/Эксперимент начат\. Сегодня фаза [AB]/);
await until(page, () => document.querySelector('.exp[data-state="active"]'));
assert.match(await text('.exp[data-state="active"] .big'), /^Сегодня фаза (A: живи как обычно|B: Последний кофе)/);
assert.match(await text('.exp[data-state="active"]'), /День 1 из 14/);
assert.match(await text('.exp[data-state="active"]'), /нужно хотя бы по 5/);
await tab(page, 'today');
assert.match(await text('.exp-chip'), /Эксперимент: фаза [AB]/);
await page.click('.exp-chip');
assert.equal(await text('#title'), 'Аналитика');
await page.click('button[data-stop]');
await until(page, () => document.querySelector('.exp[data-state="cancelled"]'));
assert.equal(await page.locator('.exp-chip').count(), 0, 'остановленный эксперимент не показывается на «Сегодня»');
await page.locator('.exp[data-state="cancelled"] .chip.danger').click();
await until(page, () => !document.querySelector('.exp'));

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.3 OK');
