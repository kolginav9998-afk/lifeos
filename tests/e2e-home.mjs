// «Дом»: добавить вещь (только название и вид), «Надел» и «Постирал» с отменой, стирка пачкой, подробности, правка, копия, состояние, удаление,
// поиск и фильтры, итоги, клавиатура, доступность (axe с данными в обеих темах) и узкий экран 320 px с крупным шрифтом.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, tab, until, appReady, root, waitText, waitCount, waitToast, waitVisible, waitValue, clearToast, eventually, settleTheme } from './helpers.mjs';

const AXE = fs.readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const t = await launch({ ctxOptions: { bypassCSP: true } });
const { page, errors } = t;
page.on('dialog', d => d.accept());
await page.goto(t.url);
await appReady(page);
const events = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);
const names = () => page.$$eval('#hm-list .hm-name', ns => ns.map(n => n.textContent));
const card = name => page.locator('#hm-list .hm-card', { has: page.locator('.hm-name', { hasText: name }) });
async function addItem(name, { kind, more = {} } = {}) {
  await page.click('#hm-add');
  await waitVisible(page, '#hm-edit');
  await page.fill('#hm-f-name', name);
  if (kind) await page.selectOption('#hm-f-kind', kind);
  if (Object.keys(more).length) {
    if (!(await page.locator('#hm-more').evaluate(d => d.open))) await page.click('#hm-more summary');
    for (const [id, v] of Object.entries(more)) await page.fill(`#hm-f-${id}`, v);
  }
  await page.click('#hm-save');
  await waitVisible(page, '#hm-edit', false);
}

// ---------- пустой экран ----------
await tab(page, 'home');
await waitText(page, '#title', 'Дом');
await waitText(page, '#hm-list .empty-t', 'Здесь пока пусто');
assert.equal(await page.getAttribute('#hm-tab-items', 'aria-pressed'), 'true');
await page.click('#hm-tab-laundry'); await waitText(page, '#hm-wash-list .empty-t', 'Стирать пока нечего');
await page.click('#hm-tab-totals'); await waitText(page, '.hm-totals .empty-t', 'Итогов пока нет');
await page.click('#hm-tab-items');

// ---------- добавить вещь: только название и вид ----------
await page.click('#hm-add');
await waitVisible(page, '#hm-edit');
assert.equal(await page.getAttribute('#hm-edit', 'role'), 'dialog');
assert.equal(await page.evaluate(() => document.activeElement.id), 'hm-f-name', 'фокус в поле названия');
assert.equal(await page.locator('#hm-more').evaluate(d => d.open), false, 'остальные параметры свёрнуты');
await page.click('#hm-save');                                                          // пустое название
await waitText(page, '#hm-edit-err', /Напиши название/);
await page.fill('#hm-f-name', '  Куртка   зимняя '); await page.selectOption('#hm-f-kind', 'clothes');
await page.click('#hm-save');
await waitVisible(page, '#hm-edit', false);
await waitCount(page, '#hm-list .hm-card', 1);
await waitText(page, '#hm-list .hm-name', 'Куртка зимняя');
await waitText(page, '#hm-list .hm-stat', 'Надето 0 раз · Стирано 0 раз');
await waitToast(page, /Добавлено: «Куртка зимняя»/);
const [jacket] = await eventually(() => events('item'), r => assert.equal(r.length, 1));
assert.match(jacket.id, /^item:[0-9a-z]+$/); assert.equal(jacket.payload.kind, 'clothes'); assert.equal(jacket.payload.qty, 1); assert.equal(jacket.payload.status, 'active'); assert.equal(jacket.payload.care.how, 'machine');
assert.equal(await page.evaluate(() => document.activeElement.id), 'hm-add', 'после закрытия окна фокус вернулся на «Добавить вещь»');

// ---------- «Надел» и «Постирал» с отменой ----------
const wear = '#hm-list .hm-q[data-fk$="|wear"]', wash = '#hm-list .hm-q[data-fk$="|wash"]';
await clearToast(page); await page.click(wear);
await waitToast(page, /«Куртка зимняя»: надето 1 раз/); await waitText(page, '#hm-list .hm-stat', /^Надето 1 раз/);
assert.equal(await page.evaluate(() => document.activeElement.dataset.fk?.endsWith('|wear')), true, 'после нажатия фокус остался на той же кнопке');
await clearToast(page); await page.click(wear);
await waitToast(page, /надето 2 раза/); await waitText(page, '#hm-list .hm-stat', /^Надето 2 раза/);
await page.click('#toast button');                                                     // отменить второе надевание
await waitText(page, '#hm-list .hm-stat', /^Надето 1 раз/);
await waitToast(page, /Отметка отменена/);
await clearToast(page); await page.click(wash);
await waitToast(page, /стирка отмечена/); await waitText(page, '#hm-list .hm-stat', 'Надето 1 раз · Стирано 1 раз');
{
  const logs = await eventually(() => events('itemlog'), r => assert.equal(r.length, 2));
  assert.deepEqual(logs.map(l => l.payload.kind).sort(), ['wash', 'wear']);
  assert.ok(logs.every(l => l.payload.item === jacket.id && /^\d{4}-\d{2}-\d{2}$/.test(l.payload.date) && l.id.startsWith(`ilog:${jacket.id}:`)));
}

// ---------- шаблон «Футболка» и стирка пачкой ----------
await page.click('#hm-add'); await waitVisible(page, '#hm-edit');
await page.click('.hm-tpl .chip:has-text("Футболка")');
await waitValue(page, '#hm-f-name', 'Футболка'); await waitValue(page, '#hm-f-wears', '1'); await waitValue(page, '#hm-f-how', 'machine');
await page.click('#hm-save-more');                                                      // «Сохранить и добавить ещё»: окно остаётся, поля очищены
await waitCount(page, '#hm-list .hm-card', 2);
await waitValue(page, '#hm-f-name', '');
assert.equal(await page.evaluate(() => document.activeElement.id), 'hm-f-name');
await page.fill('#hm-f-name', 'Полотенце'); await page.selectOption('#hm-f-kind', 'towels');
await waitValue(page, '#hm-f-days', '7'); await waitValue(page, '#hm-f-wears', '3');          // правила для полотенец подставились сами
await page.click('#hm-save'); await waitVisible(page, '#hm-edit', false);
await waitCount(page, '#hm-list .hm-card', 3);
await clearToast(page);
await card('Футболка').locator('.hm-q[data-fk$="|wear"]').click();
await waitText(page, '#hm-tab-laundry', 'Стирка (1)');
await eventually(() => card('Футболка').locator('.hm-badge').allTextContents(), r => assert.match(r.join(' '), /Пора стирать/));
await page.click('#hm-tab-laundry');
await waitCount(page, '#hm-wash-list .hm-row', 1);
await waitText(page, '#hm-wash-list .hm-rname', 'Футболка');
await waitText(page, '#hm-wash-list .hm-mtext', 'Надето 1 из 1 · пора стирать');
assert.equal(await page.isChecked('#hm-wash-list .hm-row input'), true, 'то, что пора стирать, отмечено заранее');
await waitText(page, '#hm-wash-go', 'Загрузил(а) — отметить стирку (1)');
await page.uncheck('#hm-wash-list .hm-row input'); await waitText(page, '#hm-wash-go', 'Загрузил(а) — отметить стирку'); assert.equal(await page.isDisabled('#hm-wash-go'), true);
await page.check('#hm-wash-list .hm-row input');
await clearToast(page); await page.click('#hm-wash-go');
await waitToast(page, /«Футболка»: стирка отмечена/);
await waitText(page, '#hm-tab-laundry', 'Стирка'); await waitText(page, '#hm-wash-list .empty-t', 'Стирать пока нечего');
await page.click('#hm-tab-items');
// «носили, но ещё не пора»: куртку надели, правил у неё нет — её можно постирать раньше срока
await clearToast(page); await card('Куртка').locator('.hm-q[data-fk$="|wear"]').click(); await waitToast(page, /надето 2 раза/);
await page.click('#hm-tab-laundry');
await waitText(page, '#hm-wash-list .hm-soon summary', 'Носили, но ещё не пора (1)');
assert.equal(await page.isDisabled('#hm-wash-go'), true, 'без галочки кнопка не активна');
await page.check('#hm-wash-list .hm-soon input'); await waitText(page, '#hm-wash-go', /\(1\)$/);
await page.click('#hm-wash-go'); await waitText(page, '#hm-wash-list .empty-t', 'Стирать пока нечего');
await page.click('#hm-tab-items');
assert.equal((await events('itemlog')).filter(l => l.payload.kind === 'wash').length, 3);

// ---------- подробности, правка, история ----------
await card('Куртка').locator('.hm-open').click();
await waitVisible(page, '#hm-detail');
await waitText(page, '#hm-detail .hm-title', 'Куртка зимняя');
assert.equal(await page.evaluate(() => document.activeElement.className.includes('hm-title')), true, 'фокус на названии вещи');
assert.match(await page.textContent('#hm-detail .hm-lines'), /Надето 2 раза · Стирано 2 раза/);
await page.click('#hm-detail [data-fk$="|edit"]');                                        // подробности закрываются, открывается правка
await waitVisible(page, '#hm-edit'); await waitVisible(page, '#hm-detail', false);
await waitValue(page, '#hm-f-name', 'Куртка зимняя');
await eventually(() => page.evaluate(() => document.activeElement.id), id => assert.equal(id, 'hm-f-name'), 2000);
assert.equal(await page.locator('#hm-more').evaluate(d => d.open), true, 'при правке параметры раскрыты');
await page.fill('#hm-f-place', 'Шкаф в прихожей'); await page.fill('#hm-f-brand', 'Columbia'); await page.fill('#hm-f-price', '12 500,50'); await page.fill('#hm-f-bought', '2026-01-10'); await page.fill('#hm-f-tags', 'зима, пуховик');
await page.fill('#hm-f-wears', '0'); await page.click('#hm-save');
await waitText(page, '#hm-edit-err', /Стирать после/);                                  // ошибка проверки показана, окно не закрылось
await page.fill('#hm-f-wears', '20'); await page.click('#hm-save');
await waitVisible(page, '#hm-edit', false);
await waitToast(page, /Сохранено/);
await card('Куртка').locator('.hm-open').click(); await waitVisible(page, '#hm-detail');
await waitText(page, '#hm-detail .hm-dl', /Где лежит\s*Шкаф в прихожей/);
{
  const dl = await page.textContent('#hm-detail .hm-dl');
  assert.match(dl, /Columbia/); assert.match(dl, /12\s500,50\s₽/); assert.match(dl, /зима, пуховик/); assert.match(dl, /после 20 надеваний/);
  const [item] = (await events('item')).filter(e => e.id === jacket.id);
  assert.equal(item.ts, jacket.ts, 'время создания не меняется'); assert.equal(item.payload.priceMinor, 1250050); assert.equal(item.payload.care.washEveryWears, 20); assert.deepEqual(item.payload.tags, ['зима', 'пуховик']);
}
await page.click('#hm-addlog summary');
await page.selectOption('#hm-log-kind', 'repair'); await page.fill('#hm-log-note', 'зашил карман'); await page.click('#hm-log-save');
await waitText(page, '#hm-detail .hm-hist li:first-child .hm-hk', 'Ремонт · зашил карман');
await page.selectOption('#hm-log-kind', 'move'); await page.click('#hm-log-save');
await waitText(page, '#hm-detail .error', /куда переложил/);                           // без нового места «переложил» не записывается
await page.fill('#hm-log-place', 'Балкон'); await page.click('#hm-log-save');
await waitText(page, '#hm-detail .hm-hist li:first-child .hm-hk', /Перемещение: Балкон · было: Шкаф в прихожей/);
await waitText(page, '#hm-detail .hm-dl', /Где лежит\s*Балкон/);
const histBefore = await page.locator('#hm-detail .hm-hrow').count();
await page.click('#hm-detail [data-fk$="|undo"]');                                      // отмена последней записи
await waitCount(page, '#hm-detail .hm-hrow', histBefore - 1);
await clearToast(page);

// копия, состояние, удаление
await page.click('#hm-detail [data-fk$="|copy"]');
await waitVisible(page, '#hm-edit'); await waitValue(page, '#hm-f-name', 'Куртка зимняя'); await waitValue(page, '#hm-f-brand', 'Columbia');
assert.match(await page.textContent('#hm-edit .sess-top strong'), /Копия вещи/);
await page.fill('#hm-f-name', 'Куртка летняя'); await page.click('#hm-save'); await waitVisible(page, '#hm-edit', false);
await waitToast(page, /Добавлено: «Куртка летняя»/);
await waitCount(page, '#hm-list .hm-card', 4);
assert.equal(await page.evaluate(() => document.activeElement.id.startsWith('hm-o-')), true, 'фокус вернулся на карточку, с которой открыли подробности');
await card('Куртка летняя').locator('.hm-open').click(); await waitVisible(page, '#hm-detail');
await clearToast(page); await page.click('#hm-detail [data-fk$="|st-sold"]');
await waitToast(page, /«Куртка летняя»: продано/);
await page.click('#hm-detail-close'); await waitCount(page, '#hm-list .hm-card', 3);          // проданное скрыто из обычного списка
await page.click('#hm-gone'); await waitCount(page, '#hm-list .hm-card', 1);
await waitText(page, '#hm-list .hm-badge', /Продано/); assert.equal(await page.locator('#hm-list .hm-q').count(), 0, 'у проданной вещи нет кнопок «Надел»');
await card('Куртка летняя').locator('.hm-open').click(); await waitVisible(page, '#hm-detail');
await page.click('#hm-detail [data-fk$="|del"]');
await waitVisible(page, '#hm-detail .hm-confirm'); await waitText(page, '#hm-detail .hm-confirm p', /Удалить «Куртка летняя»/);
await page.click('#hm-detail [data-fk$="|no"]'); await waitVisible(page, '#hm-detail .hm-confirm', false);
await page.click('#hm-detail [data-fk$="|del"]'); await clearToast(page); await page.click('#hm-detail [data-fk$="|yes"]');
await waitVisible(page, '#hm-detail', false); await waitToast(page, /Удалено: «Куртка летняя»/);
await waitCount(page, '#hm-list .hm-card', 3); await waitVisible(page, '#hm-gone', false);       // проданного больше нет: список вернулся к обычному
await page.click('#toast button');                                                      // вернуть удалённое
await waitVisible(page, '#hm-gone');
await page.click('#hm-gone'); await waitCount(page, '#hm-list .hm-card', 1); await page.click('#hm-gone'); await waitCount(page, '#hm-list .hm-card', 3);

// ---------- поиск и фильтры ----------
await addItem('Кроссовки белые', { kind: 'shoes', more: { place: 'Обувница', color: 'белый' } });
await addItem('Чайник', { kind: 'kitchen', more: { place: 'Кухня', brand: 'Bosch' } });
await waitCount(page, '#hm-list .hm-card', 5);
await page.fill('#hm-q', 'кроссовок'); await waitCount(page, '#hm-list .hm-card', 1); await waitText(page, '#hm-list .hm-name', 'Кроссовки белые');
await waitText(page, '#hm-count', 'Показано: 1 из 5');
await page.fill('#hm-q', 'ботинки'); await waitText(page, '#hm-list .hm-name', 'Кроссовки белые');      // «ботинки» — слово вида «Обувь»
await page.fill('#hm-q', 'самолёт'); await waitText(page, '#hm-list .empty-t', 'Ничего не нашлось');
await page.click('#hm-list .empty-a'); await waitValue(page, '#hm-q', ''); await waitCount(page, '#hm-list .hm-card', 5);
await page.fill('#hm-q', 'кухня'); await waitText(page, '#hm-list .hm-name', 'Чайник'); await page.fill('#hm-q', '');
await waitCount(page, '#hm-kinds .hm-kind:not(#hm-gone)', 5);                            // «Все» и четыре вида; рядом отдельная кнопка «Проданное и выброшенное»
await page.click('#hm-kinds .hm-kind:has-text("Одежда")'); await waitCount(page, '#hm-list .hm-card', 2);
assert.equal(await page.getAttribute('#hm-kinds .hm-kind:has-text("Одежда")', 'aria-pressed'), 'true');
assert.equal(await page.evaluate(() => document.activeElement.textContent.startsWith('Одежда')), true, 'фокус остался на нажатом фильтре');
await page.click('#hm-kinds .hm-kind:has-text("Одежда")'); await waitCount(page, '#hm-list .hm-card', 5);
await page.selectOption('#hm-place', 'Кухня'); await waitCount(page, '#hm-list .hm-card', 1); await page.selectOption('#hm-place', '');
await page.selectOption('#hm-sort', 'worn'); await eventually(names, n => assert.equal(n[0], 'Куртка зимняя'));
await page.selectOption('#hm-sort', 'name'); await eventually(names, n => assert.deepEqual(n, [...n].sort((a, b) => a.localeCompare(b, 'ru'))));
await page.click('#search-btn'); await page.fill('#search-input', 'Columbia');           // общий поиск находит вещь
await waitCount(page, '#search-results .result:not(.course)', 2); assert.match(await page.textContent('#search-results'), /Вещь/);          // зимняя куртка и её копия
await page.click('#search-results .result'); await waitText(page, '#title', 'Дом');

// ---------- итоги ----------
await page.click('#hm-tab-totals');
await waitText(page, '#hm-body .hm-big3 .big', '5');
await waitCount(page, '#hm-body .hm-bars .bar-col', 6);
await waitText(page, '#hm-body .hm-top li .hm-link', 'Куртка зимняя');
await page.click('#hm-by-kind'); await waitCount(page, '#hm-chart .cat', 1); assert.equal(await page.getAttribute('#hm-by-kind', 'aria-pressed'), 'true');
await page.click('#hm-by-month'); await waitCount(page, '#hm-body .hm-bars', 1);
await page.click('#hm-tab-items');

// ---------- клавиатура: Escape закрывает окно, фокус возвращается ----------
await page.focus('#hm-add'); await page.keyboard.press('Enter');
await waitVisible(page, '#hm-edit');
for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.getElementById('hm-edit').contains(document.activeElement)), true, `Tab #${i + 1} остался в окне`); }
await page.keyboard.press('Escape'); await waitVisible(page, '#hm-edit', false);
assert.equal(await page.evaluate(() => document.activeElement.id), 'hm-add');

// ---------- доступность: axe с данными, обе темы, вкладки и окна ----------
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const ZERO = new Set(['heading-order', 'label', 'select-name', 'button-name', 'link-name', 'aria-required-parent', 'aria-allowed-role', 'aria-allowed-attr', 'landmark-one-main', 'region', 'landmark-unique', 'duplicate-id', 'duplicate-id-aria', 'list', 'listitem', 'scrollable-region-focusable', 'aria-hidden-focus', 'nested-interactive', 'label-content-name-mismatch', 'color-contrast']);
async function axe(label) {
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ content: AXE });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const run = () => page.evaluate(async tags => (await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target.join(' ') + ' :: ' + n.html.slice(0, 100)) })), TAGS);
  let bad = await run();
  if (bad.some(v => v.id === 'color-contrast')) { await page.waitForTimeout(400); bad = await run(); }
  const fails = bad.filter(v => ['serious', 'critical'].includes(v.impact) || ZERO.has(v.id));
  assert.deepEqual(fails, [], `${label}: нарушения доступности`);
}
for (const theme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await settleTheme(page, theme);
  await page.click('#hm-tab-items'); await axe(`${theme} / вещи`);
  await page.click('#hm-tab-laundry'); await axe(`${theme} / стирка`);
  await page.click('#hm-tab-totals'); await axe(`${theme} / итоги`);
  await page.click('#hm-tab-items');
  await page.click('#hm-add'); await waitVisible(page, '#hm-edit'); await axe(`${theme} / окно «Новая вещь»`);
  await page.click('#hm-more summary'); await axe(`${theme} / окно «Новая вещь», параметры`); await page.click('#hm-edit-close'); await waitVisible(page, '#hm-edit', false);
  await card('Куртка зимняя').locator('.hm-open').click(); await waitVisible(page, '#hm-detail'); await page.click('#hm-addlog summary'); await axe(`${theme} / окно подробностей`);
  await page.click('#hm-detail [data-fk$="|del"]'); await axe(`${theme} / подтверждение удаления`);
  await page.click('#hm-detail-close'); await waitVisible(page, '#hm-detail', false);
}
await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
const main = errors.filter(e => !/Failed to load resource/.test(e));
assert.deepEqual(main, [], 'нет ошибок в консоли:\n' + main.join('\n'));
await t.close();

// ============================================================ узкий экран и крупный шрифт ============================================================
for (const cfg of [{ w: 320, h: 640, fs: 1.3 }, { w: 320, h: 640, fs: 1 }]) {
  const L = await launch({ viewport: { width: cfg.w, height: cfg.h }, ctxOptions: { bypassCSP: true } });
  const p = L.page;
  if (cfg.fs !== 1) await L.ctx.addInitScript(fs => { try { localStorage.setItem('lifeos.prefs.v1', JSON.stringify({ fontScale: fs })); } catch { /* не критично */ } }, cfg.fs);
  await p.goto(L.url); await appReady(p);
  const word = 'Сверхдлинноеслововбезпробеловдляпроверкипереносатекставкарточке';
  await p.evaluate(async word => {
    const s = await import('./store.js'), H = await import('./home.js'), now = Date.now(), evs = [];
    const items = [H.makeItem({ name: word, kind: 'clothes', place: word, brand: word, color: 'очень-тёмно-синий', size: 'XXXL', qty: 12, priceMinor: 99999999900, tags: [word], note: word, care: { how: 'machine', temp: 40, washEveryWears: 1 } }, now),
      H.makeItem({ name: 'Постельное бельё в цветочек с длинным названием для проверки', kind: 'bedding', place: 'Верхняя полка в шкафу в спальне', warranty: new Date(now + 5 * 864e5).toISOString().slice(0, 10) }, now + 1),
      H.makeItem({ name: 'Дрель', kind: 'tools', priceMinor: 450000, bought: '2026-01-05' }, now + 2), H.makeItem({ name: 'Шкаф', kind: 'furniture' }, now + 3)];
    evs.push(...items);
    for (let i = 0; i < 4; i++) for (const it of items.slice(0, 3)) evs.push(H.makeLog(it, it.payload.kind === 'tools' ? 'use' : 'wear', {}, now + 10 + i * 5 + items.indexOf(it)));
    await s.saveMany(evs);
  }, word);
  await tab(p, 'home'); await waitCount(p, '#hm-list .hm-card', 4);
  const measure = () => p.evaluate(() => {
    const vw = innerWidth, bad = [];
    if (document.documentElement.scrollWidth > vw) bad.push(`страница шире экрана: ${document.documentElement.scrollWidth} > ${vw}`);
    const scope = [...document.querySelectorAll('#view-home, #view-home *, .overlay:not([hidden]), .overlay:not([hidden]) *')];
    const shown = e => { for (let n = e; n && n !== document.body; n = n.parentElement) if (n.hidden || getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden') return false; return true; };
    for (const e of scope) {
      if (!shown(e) || e.closest('svg') || e.closest('[hidden]') || e.closest('.hm-kinds') || getComputedStyle(e).position === 'fixed' && !e.classList.contains('overlay')) continue;       // полоса видов прокручивается по горизонтали
      const r = e.getBoundingClientRect();
      if (!r.width) continue;
      if (r.right > vw + 0.5 || r.left < -0.5) bad.push(`за краем: ${e.tagName.toLowerCase()}.${e.className} [${Math.round(r.left)}..${Math.round(r.right)}] «${(e.textContent || '').trim().slice(0, 24)}»`);
      if (!e.children.length && e.textContent.trim() && !/^(INPUT|TEXTAREA|SELECT|OPTION|SUMMARY)$/.test(e.tagName) && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).display !== 'inline') bad.push(`текст шире рамки: ${e.className} ${e.scrollWidth}>${e.clientWidth} «${e.textContent.trim().slice(0, 24)}»`);
    }
    return bad;
  });
  const check = async what => { const bad = await measure(); assert.deepEqual(bad, [], `${cfg.w}px, шрифт ${cfg.fs * 100}%, ${what}:\n${bad.join('\n')}`); };
  await check('вещи');
  await p.click('#hm-tab-laundry'); await check('стирка');
  await p.click('#hm-tab-totals'); await check('итоги'); await p.click('#hm-by-kind'); await check('итоги по видам');
  await p.click('#hm-tab-items');
  await p.click('#hm-add'); await waitVisible(p, '#hm-edit'); await p.click('#hm-more summary'); await check('окно «Новая вещь»'); await p.click('#hm-edit-close'); await waitVisible(p, '#hm-edit', false);
  await p.locator('#hm-list .hm-open').first().click(); await waitVisible(p, '#hm-detail'); await p.click('#hm-addlog summary'); await check('окно подробностей');
  await p.click('#hm-detail [data-fk$="|edit"]'); await waitVisible(p, '#hm-edit'); await check('окно «Изменить вещь»');
  await p.click('#hm-edit-close'); await waitVisible(p, '#hm-edit', false);
  const e2 = L.errors.filter(e => !/Failed to load resource/.test(e));
  assert.deepEqual(e2, [], 'нет ошибок в консоли:\n' + e2.join('\n'));
  await L.close();
}
console.log('E2E HOME OK');
