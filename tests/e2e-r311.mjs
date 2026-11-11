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

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.11 OK');
