// «С нуля» на НАСТОЯЩИХ маршрутах (без учебных данных): карты трёх маршрутов, закрытый библейский иврит до этапа огласовок (hz-19), поиск без закрытых уроков,
// иврит справа налево, прохождение целого урока и проверки по настоящим заданиям, узкий экран 320 px со шрифтом 130 %. Проверки общие: не зависят от того, что написано в уроках.
import assert from 'node:assert/strict';
import { launch, tab, until } from './helpers.mjs';

const t = await launch({ ctxOptions: { serviceWorkers: 'block' } });
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const noise = list => list.filter(x => !/Failed to load resource|Service Worker registration blocked/.test(x));
const rxEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const routes = await page.evaluate(async () => {
  const { TRACKS } = await import('./academy.js');
  return TRACKS.filter(t => t.zero).map(t => ({ id: t.id, title: t.title, lessons: t.lessons.map(l => ({ id: l.id, title: l.title, needs: l.needs ?? [], milestone: l.milestone ?? null, plain: !!l.plain, drills: l.drills, hasHe: /[\u0590-\u05FF]/.test(JSON.stringify([l.body, l.table, l.words, l.showcase])) })) }));
});
const byId = Object.fromEntries(routes.map(r => [r.id, r]));
const all = routes.flatMap(r => r.lessons), lesson = id => all.find(l => l.id === id);
assert.deepEqual(routes.map(r => r.id), ['enzero', 'hezero', 'hebib']);

const closure = (id, acc = new Set()) => { for (const n of lesson(id).needs) if (!acc.has(n)) { acc.add(n); closure(n, acc); } return acc; };
const seed = (ids, daysAgo = 1) => page.evaluate(async ([ids, daysAgo]) => {
  const { makeZcheckEvent } = await import('./curriculum.js'); const store = await import('./store.js'); const { TRACKS, makeLessonDone } = await import('./academy.js');
  const evs = [];
  for (const id of ids) {
    const tr = TRACKS.find(x => x.lessons.some(l => l.id === id)), l = tr.lessons.find(x => x.id === id), ts = Date.now() - daysAgo * 86400000, d = new Date(ts);
    evs.push(makeLessonDone(tr, l, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, ts), makeZcheckEvent(tr, id, 'quiz', { n: 6, ok: 6 }, ts + 1000));
  }
  await store.saveMany(evs);
}, [ids, daysAgo]);
const openStages = () => page.evaluate(() => document.querySelectorAll('details.zero-stage').forEach(d => { d.open = true; }));

async function answer(d) {
  if (d.t === 'choose' || d.t === 'listen') await page.getByRole('button', { name: d.right, exact: true }).click();
  else if (d.t === 'typed') { await page.fill('.zero-input', d.ok[0]); await page.click('.zero-typed button[type=submit]'); }
  else if (d.t === 'order') { for (const tile of d.tiles) await page.locator('.zero-tiles:not(.zero-out) .zero-tile').filter({ hasText: new RegExp(`^${rxEsc(tile)}$`) }).first().click(); }
  else if (d.t === 'match') { for (let i = 0; i < d.pairs.length; i++) { await page.locator('.zero-l').nth(i).click(); await page.locator('.zero-r').filter({ hasText: new RegExp(`^${rxEsc(d.pairs[i][1])}$`) }).first().click(); } }
  else if (d.t === 'read') { await page.getByRole('button', { name: 'Прочитал(а): получилось' }).click(); return; }
  if (d.t === 'order' || d.t === 'match') await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await page.waitForSelector('.zero-next');
}
const same = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
async function identify(pool) {
  const seen = await page.evaluate(() => {
    const r = document.querySelector('.zero-drill'), tx = sel => [...r.querySelectorAll(sel)].map(x => x.textContent.trim());
    return { kind: r.dataset.kind, q: r.querySelector('.zero-q').textContent.trim(), big: r.querySelector('.zero-big')?.textContent.trim() ?? null, opts: tx('.zero-opts .zero-opt'), tiles: tx('.zero-tiles:not(.zero-out) .zero-tile'), lefts: tx('.zero-l').map(x => x.replace(/^\d+\.\s*/, '')) };
  });
  const d = pool.find(x => x.t === seen.kind && x.q === seen.q && (x.big ?? null) === seen.big
    && (x.t === 'choose' || x.t === 'listen' ? same(seen.opts, [x.right, ...x.wrong]) : x.t === 'order' ? same(seen.tiles, x.tiles) : x.t === 'match' ? same(seen.lefts, x.pairs.map(p => p[0])) : true));
  assert.ok(d, `задание «${seen.q}» (${seen.kind}) есть в данных`);
  return d;
}
// пройти весь урок: текст, все задания по порядку, затем проверку; в конце — «Освоено»
async function fullLesson(id) {
  const l = lesson(id);
  await openStages();
  await page.click(`#zero-row-${id}`);
  await page.click('#zero-practice');
  for (const [i, d] of l.drills.entries()) {
    assert.match(await text('.zero-qh'), new RegExp(`Задание ${i + 1} из ${l.drills.length}`));
    await answer(d);
    if (d.t !== 'read') await page.click('.zero-next');
  }
  await until(page, () => /Задания пройдены/.test(document.querySelector('#zero-play .zero-title')?.textContent ?? ''));
  await page.click('#zero-to-check');
  await page.click('#zero-start-check');
  for (let i = 0; i < 6; i++) { const d = await identify(l.drills); await answer(d); await page.click('.zero-next'); }
  await until(page, () => document.getElementById('zero-result'));
  assert.equal(await page.getAttribute('#zero-result', 'data-status'), 'mastered', `${id}: после проверки без подсказок урок освоен`);
  await page.click('#zero-to-map');
}

// ---------- 1. карты трёх маршрутов ----------
await tab(page, 'zero');
for (const r of routes) {
  await page.click(`.zero-routes [data-route="${r.id}"]`);
  await openStages();
  assert.equal(await text('.zero-progress-card h3'), r.title);
  assert.equal(await page.locator('.zero-row').count(), r.lessons.length, `${r.id}: все уроки на карте`);
  assert.match(await text('#zero-summary'), new RegExp(`^Освоено уроков: 0 из ${r.lessons.length}$`));
  const open = await page.locator('.zero-row:not([data-status="locked"])').evaluateAll(a => a.map(b => b.dataset.lesson));
  assert.deepEqual(open, r.lessons.filter(l => !l.needs.length).map(l => l.id), `${r.id}: в начале открыты только входы маршрута`);
}
await page.click('.zero-routes [data-route="enzero"]');
{ // карта из сорока уроков на узком экране: ничего не вылезает за край
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => document.documentElement.style.setProperty('--fs', '1.3'));
  await openStages();
  const r = await page.evaluate(() => { const d = document.documentElement; return { over: d.scrollWidth - d.clientWidth, wide: [...document.querySelectorAll('#view-zero *')].filter(n => n.getClientRects().length && n.getBoundingClientRect().right > d.clientWidth + 1).length }; });
  assert.ok(r.over <= 1 && r.wide === 0, `карта на 320 px: ${JSON.stringify(r)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.style.setProperty('--fs', '1'));
}

// ---------- 2. библейский иврит закрыт до этапа огласовок ----------
const milestone = all.find(l => l.milestone === 'niqqud');
assert.ok(milestone, 'в иврите есть урок с этапом niqqud');
await page.click('.zero-routes [data-route="hebib"]');
await openStages();
const bibFirst = byId.hebib.lessons[0];
assert.ok(bibFirst.needs.includes(milestone.id) || closure(bibFirst.id).has(milestone.id), 'библейский иврит строится после огласовок современного');
assert.equal(await page.getAttribute(`#zero-row-${bibFirst.id}`, 'data-status'), 'locked');
await page.click(`#zero-row-${bibFirst.id}`);
assert.match(await text('#zero-play .zero-lockmsg'), /Урок пока закрыт/);
assert.ok(await page.locator(`#zero-play .zero-missing li[data-lesson="${milestone.id}"]`).count() >= 1, 'в списке недостающих — урок с огласовками');
assert.equal(await page.locator('#zero-play .zero-p').count(), 0, 'текст закрытого урока не показан');
await page.click('#zero-placement');
assert.match(await text('#zero-play .zero-title'), /^Входная проверка: /, 'входная проверка начинается с самой ранней недостающей предпосылки');
await page.click('#zero-close');

// ---------- 3. поиск и «Учёба» ----------
{
  const closed = byId.hebib.lessons[0];
  await page.click('#search-btn'); await page.fill('#search-input', closed.title.slice(0, 20)); await page.waitForTimeout(150);
  assert.equal(await page.locator('#search-results .result.course').filter({ hasText: closed.title }).count(), 0, 'закрытый урок в поиске не светится');
  await page.click('#search-btn');
  await tab(page, 'learn');
  assert.equal(await page.locator('.track-card').count(), 9, 'курсы «с нуля» не перечислены как обычные курсы');
  assert.match(await text('#learn-zero'), /Курсы с нуля/);
  await page.click('.track-card[data-track="hebrew"]');
  assert.match(await text('#learn-zero-banner'), /Начинаешь с нуля/);
  await page.click('#learn-back');
  await tab(page, 'zero');
}

// ---------- 4. иврит: текст справа налево, сборка слова, «простые» уроки без огласовок ----------
const rtlLesson = byId.hezero.lessons.find(l => l.drills.some(d => d.t === 'order' && d.dir === 'rtl') && l.needs.length);
assert.ok(rtlLesson, 'в иврите есть урок со сборкой слова справа налево');
const heLesson = byId.hezero.lessons.find(l => l.hasHe && l.needs.length);
assert.ok(heLesson, 'в иврите есть урок с ивритским текстом на странице');
await seed([...closure(heLesson.id), ...closure(rtlLesson.id)], 1);
await page.click('.zero-routes [data-route="hezero"]');
await openStages();
await page.click(`#zero-row-${heLesson.id}`);
assert.ok(await page.locator('#zero-play [lang="he"][dir="rtl"]').count() >= 1, 'ивритский текст страницы урока: lang="he" dir="rtl"');
await page.click('#zero-close');
await page.click(`#zero-row-${rtlLesson.id}`);
await page.click('#zero-practice');
{
  const i = rtlLesson.drills.findIndex(d => d.t === 'order' && d.dir === 'rtl');
  for (let k = 0; k < i; k++) { const d = rtlLesson.drills[k]; await answer(d); if (d.t !== 'read') await page.click('.zero-next'); }
  const d = rtlLesson.drills[i];
  assert.equal(await page.getAttribute('.zero-out', 'dir'), 'rtl');
  for (const tile of d.tiles) await page.locator('.zero-tiles:not(.zero-out) .zero-tile').filter({ hasText: new RegExp(`^${rxEsc(tile)}$`) }).first().click();
  const xs = await page.locator('.zero-out .zero-tile').evaluateAll(a => a.map(b => b.getBoundingClientRect().left));
  assert.equal(xs.length, d.tiles.length);
  assert.ok(xs.every((x, k) => k === 0 || xs[k - 1] > x), `плитки идут справа налево: ${xs.join(', ')}`);
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  assert.equal(await page.getAttribute('.zero-fb', 'data-result'), 'right');
}
await page.click('#zero-close');
const plain = byId.hezero.lessons.find(l => l.plain);
assert.ok(plain, 'есть урок «без огласовок» (plain)');
await seed([...closure(plain.id)], 1);
await fullLesson(plain.id);                                  // настоящий урок целиком: задания, проверка, «Освоено»
assert.equal(await page.getAttribute(`#zero-row-${plain.id}`, 'data-status'), 'mastered');

// ---------- 5. английский: первый урок целиком и открытие следующего ----------
await page.click('.zero-routes [data-route="enzero"]');
const e1 = byId.enzero.lessons[0], e2 = byId.enzero.lessons[1];
await fullLesson(e1.id);
assert.equal(await page.getAttribute(`#zero-row-${e2.id}`, 'data-status'), 'new', 'после освоения первого урока открылся второй');

// ---------- 6. после огласовок библейский иврит открывается ----------
await seed([...closure(bibFirst.id)], 1);
await page.click('.zero-routes [data-route="hebib"]');
await until(page, id => document.querySelector(`#zero-row-${id}`)?.dataset.status === 'new', bibFirst.id);
await page.click(`#zero-row-${bibFirst.id}`);
assert.ok(await page.locator('#zero-play .zero-p').count() >= 1, 'открытый урок показывает текст');
await page.click('#zero-close');

assert.deepEqual(noise(errors), [], `нет ошибок в консоли:\n${noise(errors).join('\n')}`);
await t.close();
console.log('E2E ZERO REAL OK');
