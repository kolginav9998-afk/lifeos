// Экран «С нуля»: карта маршрута, смена маршрута, первый урок, задания с разбором, проверка и статус «Освоено», открытие следующего урока,
// входная проверка закрытого урока, быстрая проверка, иврит справа налево, отметки о внешних курсах, «Учёба» и поиск без закрытых уроков.
// Ответы на задания берутся из данных курса в самой странице.
import assert from 'node:assert/strict';
import { launch, tab, until, root } from './helpers.mjs';

import fs from 'node:fs';
import path from 'node:path';
// Настоящие уроки пишут другие команды и меняют каждый день: вместо c-zero-en.js и c-zero-he.js подставляем учебные маршруты из tests/fixtures (c-zero-hb.js остаётся настоящим).
const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const t = await launch({ ctxOptions: { serviceWorkers: 'block', bypassCSP: true } });
const { page, errors } = t;
await t.ctx.route('**/c-zero-en.js', r => r.fulfill({ contentType: 'text/javascript', body: fixture('zero-en.mjs') }));
await t.ctx.route('**/c-zero-he.js', r => r.fulfill({ contentType: 'text/javascript', body: fixture('zero-he.mjs') }));
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const noise = list => list.filter(x => !/Failed to load resource|Service Worker registration blocked/.test(x));
const rxEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// доступность: axe-core в светлой и тёмной теме на каждом состоянии экрана; серьёзные нарушения и «исправленные» правила — ошибка
const AXE = fs.readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const ZERO_RULES = new Set(['heading-order', 'label', 'select-name', 'button-name', 'link-name', 'aria-required-parent', 'aria-allowed-role', 'aria-allowed-attr', 'landmark-one-main', 'region', 'landmark-unique', 'duplicate-id', 'duplicate-id-aria', 'list', 'listitem', 'scrollable-region-focusable', 'aria-hidden-focus', 'nested-interactive', 'label-content-name-mismatch']);
const a11y = [];
async function ax(label) {
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ content: AXE });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await page.waitForTimeout(120);
    const res = await page.evaluate(async tags => (await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => `${n.target.join(' ')} :: ${n.html.replace(/\s+/g, ' ').slice(0, 110)}`) })), TAGS);
    for (const v of res) if (v.impact === 'serious' || v.impact === 'critical' || ZERO_RULES.has(v.id)) a11y.push(`${theme} / ${label}: [${v.impact}] ${v.id}: ${v.nodes.slice(0, 2).join(' | ')}`);
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

// данные курсов из самого приложения
const route = id => page.evaluate(async id => { const { trackById } = await import('./academy.js'); const t = trackById(id); return { id: t.id, title: t.title, lang: t.lang, lessons: t.lessons.map(l => ({ id: l.id, title: l.title, needs: l.needs ?? [], stage: l.stage, drills: l.drills, hasHe: /[֐-׿]/.test(JSON.stringify([l.body, l.table, l.words, l.showcase])) })) }; }, id);
const en = await route('enzero'), he = await route('hezero');
assert.ok(en.lessons.length >= 1 && he.lessons.length >= 1);

// помечаем уроки освоенными (как будто проверки пройдены daysAgo дней назад), чтобы открыть нужное место маршрута
const seed = (ids, daysAgo = 1) => page.evaluate(async ([ids, daysAgo]) => {
  const { makeZcheckEvent } = await import('./curriculum.js'); const store = await import('./store.js'); const { TRACKS, makeLessonDone } = await import('./academy.js');
  const evs = [];
  for (const id of ids) {
    const tr = TRACKS.find(x => x.lessons.some(l => l.id === id)), l = tr.lessons.find(x => x.id === id), ts = Date.now() - daysAgo * 86400000;
    const d = new Date(ts), ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    evs.push(makeLessonDone(tr, l, ymd, ts), makeZcheckEvent(tr, id, 'quiz', { n: 6, ok: 6 }, ts + 1000));
  }
  await store.saveMany(evs);
}, [ids, daysAgo]);

// ответить на задание в окне урока так, как оно устроено; read — «получилось»
async function answer(d, { hint = false } = {}) {
  if (hint && d.hint) await page.click('.zero-hint-btn');
  if (d.t === 'choose' || d.t === 'listen') await page.getByRole('button', { name: d.right, exact: true }).click();
  else if (d.t === 'typed') { await page.fill('.zero-input', d.ok[0]); await page.click('.zero-typed button[type=submit]'); }
  else if (d.t === 'order') { for (const tile of d.tiles) await page.locator('.zero-tiles:not(.zero-out) .zero-tile').filter({ hasText: new RegExp(`^${rxEsc(tile)}$`) }).first().click(); await page.getByRole('button', { name: 'Проверить', exact: true }).click(); }
  else if (d.t === 'match') {
    for (let i = 0; i < d.pairs.length; i++) { await page.locator('.zero-l').nth(i).click(); await page.locator('.zero-r').filter({ hasText: new RegExp(`^${rxEsc(d.pairs[i][1])}$`) }).first().click(); }
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  } else if (d.t === 'read') { await page.getByRole('button', { name: 'Прочитал(а): получилось' }).click(); return; }
  await page.waitForSelector('.zero-next');
}
// какое задание сейчас в окне: по виду, вопросу, крупному знаку и вариантам (в проверке порядок другой, чем в уроке)
const same = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
async function identify(pool) {
  const seen = await page.evaluate(() => {
    const r = document.querySelector('.zero-drill'), t = sel => [...r.querySelectorAll(sel)].map(x => x.textContent.trim());
    return { kind: r.dataset.kind, q: r.querySelector('.zero-q').textContent.trim(), big: r.querySelector('.zero-big')?.textContent.trim() ?? null, opts: t('.zero-opts .zero-opt'), tiles: t('.zero-tiles:not(.zero-out) .zero-tile'), lefts: t('.zero-l').map(x => x.replace(/^\d+\.\s*/, '')) };
  });
  const d = pool.find(x => x.t === seen.kind && x.q === seen.q && (x.big ?? null) === seen.big
    && (x.t === 'choose' || x.t === 'listen' ? same(seen.opts, [x.right, ...x.wrong]) : x.t === 'order' ? same(seen.tiles, x.tiles) : x.t === 'match' ? same(seen.lefts, x.pairs.map(p => p[0])) : true));
  assert.ok(d, `задание «${seen.q}» (${seen.kind}) есть в данных`);
  return d;
}
async function runItems(pool, n) {
  for (let i = 0; i < n; i++) {
    const d = await identify(pool);
    await answer(d);
    if (d.t !== 'read') await page.click('.zero-next');
  }
}

// ---------- 1. карта маршрута ----------
await tab(page, 'zero');
assert.equal(await text('#title'), 'С нуля');
assert.equal(await page.getAttribute('#view-zero .zero-routes .chip:first-child', 'aria-pressed'), 'true');
assert.equal(await page.locator('.zero-routes .chip').count(), 3, 'английский, иврит, библейский иврит');
assert.match(await text('#zero-summary'), /^Освоено уроков: 0 из \d+$/);
const first = page.locator(`#zero-row-${en.lessons[0].id}`);
assert.equal(await first.getAttribute('data-status'), 'new');
assert.match(await first.textContent(), /Новый/, 'статус словом');
assert.ok(await first.locator('svg').count() >= 1, 'и значком');
const lockedId = en.lessons.find(l => l.needs.length)?.id;
if (lockedId) {
  await page.evaluate(() => document.querySelectorAll('details.zero-stage').forEach(d => { d.open = true; }));
  assert.equal(await page.getAttribute(`#zero-row-${lockedId}`, 'data-status'), 'locked');
  assert.match(await text(`#zero-row-${lockedId}`), /Закрыто/);
}
assert.equal(await page.isDisabled('#zero-quick'), true, 'пока нечего проверять');
await ax('карта маршрута');

// смена маршрута
await page.click('.zero-routes [data-route="hezero"]');
assert.equal(await page.getAttribute('.zero-routes [data-route="hezero"]', 'aria-pressed'), 'true');
assert.equal(await text('.zero-progress-card h3'), he.title);
assert.equal(await page.locator(`#zero-row-${he.lessons[0].id}`).count(), 1);
await page.click('.zero-routes [data-route="enzero"]');
assert.equal(await text('.zero-progress-card h3'), en.title);

// ---------- 2. «Учёба»: карточка вместо списка уроков, поиск не раскрывает закрытое ----------
await tab(page, 'learn');
assert.equal(await page.locator('.track-card').count(), 9, 'три маршрута «с нуля» не перечислены как обычные курсы');
assert.match(await text('#learn-zero'), /Курсы с нуля/);
await page.click('.track-card[data-track="english"]');
assert.match(await text('#learn-zero-banner'), /Начинаешь с нуля/, 'мягкая подсказка на старом курсе');
await page.click('#learn-back');
await page.click('#learn-zero-open');
assert.equal(await text('#title'), 'С нуля');
if (lockedId) {
  const lockedTitle = en.lessons.find(l => l.id === lockedId).title;
  await page.click('#search-btn'); await page.fill('#search-input', lockedTitle.slice(0, 18));
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#search-results .result.course').filter({ hasText: lockedTitle }).count(), 0, 'название закрытого урока в поиске не светится');
  await page.click('#search-btn');
}
{
  const title = en.lessons[0].title;
  await page.click('#search-btn'); await page.fill('#search-input', title.slice(0, 18));
  await until(page, () => document.querySelector('#search-results .result.course'));
  await page.locator('#search-results .result.course').first().click();
  await until(page, () => !document.getElementById('zero-play').hidden);
  assert.equal(await text('#title'), 'С нуля', 'из поиска открывается экран «С нуля»');
  assert.equal((await text('#zero-play .zero-title')).trim(), title);
  await page.click('#zero-close');
}

// ---------- 3. первый урок: текст, задания с разбором, подсказка ----------
await tab(page, 'zero');
await page.click(`#zero-row-${en.lessons[0].id}`);
await until(page, () => !document.getElementById('zero-play').hidden);
assert.equal(await page.getAttribute('#zero-play', 'role'), 'dialog');
assert.equal((await text('#zero-play .zero-title')).trim(), en.lessons[0].title);
assert.match(await text('#zero-play .zero-statusline'), /Новый/);
await ax('страница урока');
await page.click('#zero-practice');
const axed = new Set();
const drills = en.lessons[0].drills;
for (let i = 0; i < drills.length; i++) {
  assert.match(await text('.zero-qh'), new RegExp(`Задание ${i + 1} из ${drills.length}`));
  const d = drills[i];
  if (!axed.has(d.t)) { axed.add(d.t); await ax(`задание «${d.t}»`); }
  if (i === 0 && (d.t === 'choose' || d.t === 'listen')) {                                  // неверный ответ: разбор показывает правильный
    const wrong = d.wrong[0];
    await page.getByRole('button', { name: wrong, exact: true }).click();
    assert.equal(await page.getAttribute('.zero-fb', 'data-result'), 'wrong');
    assert.match(await text('.zero-fb'), /Неверно/);
    assert.match(await text('.zero-fb'), new RegExp(`Правильный ответ: ${rxEsc(d.right)}`));
    await ax('разбор неверного ответа');
    await page.click('.zero-next');
    continue;
  }
  await answer(d);
  if (d.t !== 'read') { assert.equal(await page.getAttribute('.zero-fb', 'data-result'), 'right'); assert.match(await text('.zero-fb'), /Верно/); await page.click('.zero-next'); }
}
await until(page, () => /Задания пройдены/.test(document.querySelector('#zero-play .zero-title')?.textContent ?? ''));
await page.click('#zero-close');
assert.equal(await page.getAttribute(`#zero-row-${en.lessons[0].id}`, 'data-status'), 'seen', 'после заданий урок «Просмотрено», но ещё не освоен');
assert.match(await text(`#zero-row-${en.lessons[0].id}`), /Просмотрено/);
if (en.lessons[1]) assert.notEqual(await page.getAttribute(`#zero-row-${en.lessons[1].id}`, 'data-status'), 'new', 'следующий урок после просмотра не открывается');

// ---------- 4. проверка: подсказка не засчитывается, затем честное «Освоено» и открытие следующего урока ----------
const lesson0 = en.lessons[0];
await page.click(`#zero-row-${lesson0.id}`);
await page.click('#zero-check');
assert.match(await text('#zero-play .zero-intro'), /Нужно верных без подсказок: \d/);
await ax('вступление к проверке');
await page.click('#zero-start-check');
const n = await page.evaluate(async id => { const { makeCheck } = await import('./curriculum.js'); const { trackById } = await import('./academy.js'); return makeCheck(trackById('enzero').lessons.find(l => l.id === id), 'quiz', 1).n; }, lesson0.id);
assert.match(await text('.zero-qh'), new RegExp(`Вопрос 1 из ${n}`));
{ // первый вопрос: верный ответ, но с подсказкой, если она есть (такой ответ не засчитается)
  const d = await identify(lesson0.drills);
  const hinted = !!d.hint && (d.t === 'choose' || d.t === 'listen');
  await answer(d, { hint: hinted });
  if (hinted) assert.match(await text('.zero-fb'), /Подсказка была открыта/);
  await page.click('.zero-next');
  await runItems(lesson0.drills, n - 1);
  await until(page, () => document.getElementById('zero-result'));
  assert.equal(await page.getAttribute('#zero-result', 'data-kind'), 'quiz');
  if (hinted) {
    assert.equal(await page.getAttribute('#zero-result', 'data-status'), 'mastered', 'один ответ с подсказкой из шести не мешает (нужно 5 из 6)');
    assert.match(await text('#zero-result .zero-score'), new RegExp(`Верно без подсказок: ${n - 1} из ${n}`));
  }
}
if (await page.getAttribute('#zero-result', 'data-status') !== 'mastered') assert.fail('после проверки ожидали «Освоено»');
assert.match(await text('#zero-result .zero-newstatus'), /Освоено/);
await ax('итог проверки');
assert.match(await text('#zero-result'), /Результат записан/);
const saved = await page.evaluate(async () => (await import('./store.js')).state.events.filter(e => e.type === 'zcheck').map(e => ({ id: e.id, source: e.source, confidence: e.confidence, p: e.payload, ev: e.evidence })));
assert.equal(saved.length, 1);
assert.equal(saved[0].p.kind, 'quiz'); assert.equal(saved[0].p.lesson, lesson0.id); assert.equal(saved[0].p.n, n); assert.equal(saved[0].source, 'quiz');
assert.equal(saved[0].ev[0].kind, 'test_result'); assert.match(saved[0].ev[0].ref, new RegExp(`^${lesson0.id}:\\d+/${n}$`));
assert.match(saved[0].id, new RegExp(`^zc:${lesson0.id}:`));
if (en.lessons[1]) assert.match(await text('#zero-result .zero-opened'), /Открыл/);
await page.click('#zero-to-map');
assert.equal(await page.getAttribute(`#zero-row-${lesson0.id}`, 'data-status'), 'mastered');
assert.match(await text(`#zero-row-${lesson0.id}`), /Освоено/);
assert.match(await text('#zero-summary'), /^Освоено уроков: 1 из/);
if (en.lessons[1]) assert.equal(await page.getAttribute(`#zero-row-${en.lessons[1].id}`, 'data-status'), 'new', 'следующий урок открылся');

// ---------- 5. закрытый урок: что нужно и входная проверка ----------
const deep = en.lessons.find((l, i) => i >= 3 && l.needs.length);
if (deep) {
  await page.evaluate(() => document.querySelectorAll('details.zero-stage').forEach(d => { d.open = true; }));
  assert.equal(await page.getAttribute(`#zero-row-${deep.id}`, 'data-status'), 'locked');
  await page.click(`#zero-row-${deep.id}`);
  assert.match(await text('#zero-play .zero-lockmsg'), /Урок пока закрыт/);
  await ax('закрытый урок');
  assert.ok(await page.locator('#zero-play .zero-missing li').count() >= 1, 'список недостающих уроков');
  assert.equal(await page.locator('#zero-play .zero-p').count(), 0, 'текст закрытого урока не показан');
  // проходим входные проверки подряд, пока урок не откроется
  await page.click('#zero-placement');
  for (let guard = 0; guard < 40; guard++) {
    const head = (await text('#zero-play .zero-title')).trim();
    assert.match(head, /^Входная проверка: /);
    const target = en.lessons.find(l => head === `Входная проверка: ${l.title}`);
    assert.ok(target, `цель входной проверки найдена: ${head}`);
    await page.click('#zero-start-check');
    await runItems(target.drills, await page.evaluate(async id => { const { makeCheck } = await import('./curriculum.js'); const { trackById } = await import('./academy.js'); return makeCheck(trackById('enzero').lessons.find(l => l.id === id), 'placement', 1).n; }, target.id));
    await until(page, () => document.getElementById('zero-result'));
    assert.equal(await page.getAttribute('#zero-result', 'data-kind'), 'placement');
    assert.equal(await page.getAttribute('#zero-result', 'data-status'), 'mastered');
    assert.match(await text('#zero-result .zero-title'), /Засчитано по входной проверке/);
    if (await page.locator('#zero-next-placement').count()) { await page.click('#zero-next-placement'); continue; }
    await page.click('#zero-open-origin');
    break;
  }
  assert.equal((await text('#zero-play .zero-title')).trim(), deep.title, 'закрытый урок открылся и показывает содержимое');
  assert.ok(await page.locator('#zero-play .zero-p').count() >= 1);
  await page.click('#zero-close');
  assert.notEqual(await page.getAttribute(`#zero-row-${deep.id}`, 'data-status'), 'locked');
}

// ---------- 6. быстрая проверка: раз в сутки, урок называется только в конце ----------
await page.click('.zero-routes [data-route="hezero"]');
await seed([he.lessons[0].id], 2);
await until(page, () => !document.getElementById('zero-quick').disabled);
await page.click('#zero-quick');
await until(page, () => !document.getElementById('zero-play').hidden);
assert.equal(await text('#zero-play .sess-top .muted'), 'Быстрая проверка');
assert.equal(await page.locator('#zero-play .zero-title').count(), 0, 'название урока заранее не показано');
{
  const total = Number((/из (\d+)/.exec(await text('.zero-qh')) ?? [])[1]);
  assert.ok(total >= 3 && total <= 4, `вопросов ${total}`);
  await runItems([...he.lessons[0].drills], total);
  await until(page, () => document.getElementById('zero-result'));
  assert.equal(await page.getAttribute('#zero-result', 'data-kind'), 'surprise');
  assert.match(await text('#zero-result'), /Это был урок «/);
  assert.match(await text('#zero-result .zero-title'), /Подтверждено|Ты это помнишь/);
  await page.click('#zero-to-map');
}
assert.equal(await page.isDisabled('#zero-quick'), true, 'сегодня уже была');
assert.match(await text('.zero-quick'), /Сегодня быстрая проверка уже была/);

// ---------- 7. срок повторения: «Пора повторить» ----------
const bib = await route('hebib');
await seed([bib.lessons[0].id], 5);                                               // проверка пять дней назад, первый срок три дня
await until(page, () => document.getElementById('zero-due'));
assert.match(await text('#zero-due'), /Пора повторить: \d/);
assert.equal(await page.locator(`#zero-due [data-due="${bib.lessons[0].id}"]`).count(), 1);
await page.click('.zero-routes [data-route="hebib"]');
assert.equal(await page.getAttribute(`#zero-row-${bib.lessons[0].id}`, 'data-status'), 'review');
assert.match(await text(`#zero-row-${bib.lessons[0].id}`), /Пора повторить/);

// ---------- 8. иврит справа налево ----------
await page.click('.zero-routes [data-route="hezero"]');
const heLesson = he.lessons.find(l => l.hasHe);
if (heLesson) {
  const chain = new Set(); const need = id => { if (chain.has(id)) return; chain.add(id); for (const x of he.lessons.find(l => l.id === id)?.needs ?? []) need(x); }; need(heLesson.id); chain.delete(heLesson.id);
  const ext = [...chain].filter(id => he.lessons.some(l => l.id === id));
  await seed(ext, 1);
  await page.evaluate(() => document.querySelectorAll('details.zero-stage').forEach(d => { d.open = true; }));
  await page.click(`#zero-row-${heLesson.id}`);
  assert.ok(await page.locator('#zero-play [lang="he"][dir="rtl"]').count() >= 1, 'ивритский текст с lang="he" dir="rtl"');
  await ax('урок иврита');
  await page.click('#zero-close');
}
// плитки справа налево: собираем из заданий-образцов в самой странице
await page.evaluate(async () => {
  const { drillView } = await import('./view-zero-lesson.js');
  const host = document.createElement('div'); host.id = 'rtl-probe'; host.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:50;background:#fff;padding:8px';
  const v = drillView({ t: 'order', q: 'Собери слово', tiles: ['ש', 'ל', 'ו', 'ם'], dir: 'rtl' }, { seed: 3 });
  host.append(v.root); document.body.append(host);
});
for (const tile of ['ש', 'ל', 'ו', 'ם']) await page.locator('#rtl-probe .zero-tiles:not(.zero-out) .zero-tile').filter({ hasText: new RegExp(`^${tile}$`) }).first().click();
{
  const xs = await page.locator('#rtl-probe .zero-out .zero-tile').evaluateAll(a => a.map(b => b.getBoundingClientRect().left));
  assert.equal(xs.length, 4);
  assert.ok(xs[0] > xs[1] && xs[1] > xs[2] && xs[2] > xs[3], `плитки собираются справа налево: ${xs.join(', ')}`);
  assert.equal(await page.getAttribute('#rtl-probe .zero-out', 'dir'), 'rtl');
  assert.equal(await page.getAttribute('#rtl-probe .zero-tile', 'lang'), 'he');
}
await page.evaluate(() => document.getElementById('rtl-probe').remove());

// ---------- 9. внешние курсы: фильтры, ссылка наружу, отметка сохраняется ----------
await page.click('#zero-catalog-open');
assert.equal(await page.locator('.zero-res').count(), 20);
assert.match(await text('#zero-cat-status'), /Найдено: 20 из 20/);
await ax('каталог внешних курсов');
await page.selectOption('[data-filter="subject"]', 'hebrew');
assert.ok(await page.locator('.zero-res').count() >= 2 && await page.locator('.zero-res').count() < 20);
await page.selectOption('[data-filter="subject"]', '');
await page.selectOption('[data-filter="cost"]', 'free');
assert.equal(await page.locator('.zero-res:not([data-cost="free"])').count(), 0);
await page.selectOption('[data-filter="cost"]', '');
await page.selectOption('[data-filter="lang"]', 'ru');
assert.equal(await page.locator('.zero-res').count(), 1, 'на русском один курс');
await page.selectOption('[data-filter="lang"]', '');
{
  const a = page.locator('.zero-res').first().locator('a.zero-open');
  assert.equal(await a.getAttribute('target'), '_blank');
  assert.match(await a.getAttribute('rel'), /noopener/);
  assert.match(await a.getAttribute('href'), /^https:\/\//);
  assert.match(await text('.zero-res .zero-avail'), /Адрес не проверялся|Адрес открывался/);
}
{
  const row = page.locator('.zero-res[data-res="duolingo"]');
  await row.locator('select.zero-res-status').selectOption('in_progress');
  await until(page, () => document.getElementById('toast').textContent.includes('Отметка сохранена'));
  const res = await page.evaluate(async () => (await import('./store.js')).state.events.filter(e => e.type === 'resource').map(e => ({ id: e.id, p: e.payload })));
  assert.equal(res.length, 1); assert.equal(res[0].id, 'res:duolingo'); assert.equal(res[0].p.status, 'in_progress'); assert.equal(res[0].p.id, 'duolingo');
  await row.locator('select.zero-res-status').selectOption('completed');
  await until(page, async () => (await (await import('./store.js')).state.events.filter(e => e.type === 'resource' && e.payload.status === 'completed').length) === 1);
  assert.equal(await page.evaluate(async () => (await import('./store.js')).state.events.filter(e => e.type === 'resource').length), 1, 'одна запись на курс, она обновляется');
  assert.equal(await page.locator('.zero-res[data-res="duolingo"] select.zero-res-status').inputValue(), 'completed');
}
await page.click('#zero-catalog-back');
assert.equal(await page.locator('#zero-catalog-open').isVisible(), true);

// ---------- 10. узкий экран 320 px и шрифт 130 %: ничего не вылезает за край ----------
await page.setViewportSize({ width: 320, height: 640 });
await page.evaluate(() => document.documentElement.style.setProperty('--fs', '1.3'));
const layout = [];
const overflow = async label => {
  const r = await page.evaluate(() => {
    const d = document.documentElement, o = document.getElementById('zero-play');
    const wide = [...document.querySelectorAll('#view-zero *')].filter(n => n.getClientRects().length && !n.closest('.zero-table-wrap') && n.getBoundingClientRect().right > d.clientWidth + 1).slice(0, 3).map(n => `${n.tagName}.${n.className?.baseVal ?? n.className}`);
    return { page: d.scrollWidth - d.clientWidth, overlay: o && !o.hidden ? o.scrollWidth - o.clientWidth : 0, wide };
  });
  if (r.page > 1 || r.overlay > 1 || r.wide.length) layout.push(`${label}: ${JSON.stringify(r)}`);
};
await page.click('#zero-catalog-back').catch(() => {});
await page.click('.zero-routes [data-route="hezero"]');
await page.evaluate(() => document.querySelectorAll('details.zero-stage').forEach(d => { d.open = true; }));
await overflow('карта иврита');
await page.click(`#zero-row-${he.lessons[0].id}`);
await overflow('страница урока иврита');
await page.click('#zero-practice');
for (const [i, d] of he.lessons[0].drills.entries()) {
  await overflow(`задание ${i + 1} (${d.t})`);
  await answer(d);
  if (d.t !== 'read') { await overflow(`разбор ${i + 1} (${d.t})`); await page.click('.zero-next'); }
}
await page.click('#zero-close');
await page.click(`#zero-row-${he.lessons[2].id}`);
assert.match(await text('#zero-play .zero-lockmsg'), /Урок пока закрыт/);
await overflow('закрытый урок');
await page.click('#zero-close');
await page.click('#zero-catalog-open');
await overflow('каталог');
assert.deepEqual(layout, [], `вёрстка на 320 px и шрифте 130 %:\n${layout.join('\n')}`);

assert.deepEqual(a11y, [], `доступность:\n${a11y.join('\n')}`);
assert.deepEqual(noise(errors), [], `нет ошибок в консоли:\n${noise(errors).join('\n')}`);
await t.close();
console.log('E2E ZERO OK');
