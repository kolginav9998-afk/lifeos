// Доступность: axe-core на КАЖДОМ экране (список берётся из работающего приложения: вкладки и вторая строка переключателей) в светлой и тёмной теме,
// в обычном и «раскрытом» виде (раскрыты все «Ещё…», показаны спрятанные поля), плюс экран пароля, экран входа в аккаунт и окна поверх экранов.
// Затем клавиатура и диктор: ссылка «Перейти к содержимому», фокус на заголовке при смене экрана, окна (inert, Tab по кругу, Escape, возврат фокуса),
// уведомления в живой области, aria-expanded у поиска, кольцо фокуса в обеих темах, повторяющиеся id.
// Падает на нарушениях серьёзности serious/critical и на «нулевой терпимости» (правила, которые мы уже исправили: чтобы не вернулись); moderate/minor печатает.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, tab, until, root, eventually } from './helpers.mjs';
import { seedDemo } from './seed.mjs';
import { createServer } from '../server/node/server.js';

const AXE = fs.readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const THEMES = ['light', 'dark'];
const FAIL_IMPACT = new Set(['serious', 'critical']);
// Правила, которые мы исправили: любое срабатывание (даже moderate/minor) — ошибка, чтобы они не вернулись.
const ZERO = new Set(['heading-order', 'label', 'select-name', 'button-name', 'link-name', 'aria-required-parent', 'aria-allowed-role', 'aria-allowed-attr', 'landmark-one-main',
  'region', 'landmark-unique', 'duplicate-id', 'duplicate-id-aria', 'duplicate-id-active', 'list', 'listitem', 'scrollable-region-focusable', 'aria-hidden-focus', 'nested-interactive', 'label-content-name-mismatch']);
// Сознательно принятые нарушения. Каждая запись: правило, фрагмент селектора/разметки и ПРИЧИНА. Пусто, пока всё исправлено.
const ALLOW = [
  // { rule: 'color-contrast', match: /bt-box/, why: 'пример: цветной экран теста реакции — сам стимул, не текст интерфейса' },
];

const findings = [];
const allowed = f => ALLOW.some(a => a.rule === f.rule && (!a.match || a.match.test(f.target + ' ' + f.html)));
async function ensureAxe(page) { if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ content: AXE }); }
async function runAxe(page, label) {
  await ensureAxe(page);
  const run = () => page.evaluate(async tags => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({ target: n.target.join(' '), html: n.html.replace(/\s+/g, ' ').slice(0, 140), msg: (n.any[0] || n.all[0] || n.none[0] || {}).message || '' })) }));
  }, TAGS);
  let res = await run();
  if (res.some(v => v.id === 'color-contrast')) {                                   // переход темы мог ещё не доиграть: перепроверяем один раз
    await page.waitForTimeout(400);
    res = res.filter(v => v.id !== 'color-contrast').concat((await run()).filter(v => v.id === 'color-contrast'));
  }
  for (const v of res) for (const n of v.nodes) findings.push({ label, rule: v.id, impact: v.impact, help: v.help, target: n.target, html: n.html, msg: n.msg });
}
const settle = (page, ms = 250) => page.waitForTimeout(ms);
const setTheme = async (page, theme) => { await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await settle(page, 200); };
// «Раскрытый» вид экрана: открыты все <details>, показаны спрятанные блоки и поля (кроме окон) — так проверяются и формы, которые обычно закрыты.
const expand = async page => {
  await page.evaluate(() => {
    const v = [...document.querySelectorAll('#view > section')].find(x => !x.hidden);
    if (!v) return;
    for (const d of v.querySelectorAll('details')) d.open = true;
    for (const h of v.querySelectorAll('[hidden]')) if (!h.classList.contains('overlay')) h.hidden = false;
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));   // наблюдатель уровней заголовков срабатывает на следующем кадре
};
// Одинаковые id на странице (в том числе в спрятанных экранах): их читают диктор и тесты, берётся первый попавшийся.
const duplicateIds = page => page.evaluate(() => {
  const seen = new Map();
  for (const n of document.querySelectorAll('[id]')) seen.set(n.id, (seen.get(n.id) || 0) + 1);
  return [...seen].filter(([, c]) => c > 1).map(([id, c]) => `${id} ×${c}`);
});
const openScreen = async (page, s) => { await page.click(`#tabs button[data-tab="${s.group}"]`); if (s.view) await page.click(`#subnav button[data-view="${s.view}"]`); await settle(page); };

// ============================================================ 1. Экраны приложения ============================================================
const t = await launch({ ctxOptions: { bypassCSP: true } });
const p = t.page;
p.on('dialog', d => d.accept());
await p.goto(t.url);
await until(p, () => !document.getElementById('app').hidden);
await seedDemo(p);

// настоящий список экранов: каждая вкладка и кнопки второй строки (новые экраны подхватываются сами)
const groups = await p.$$eval('#tabs button[data-tab]', bs => bs.map(b => b.dataset.tab));
const screens = [];
for (const g of groups) {
  await p.click(`#tabs button[data-tab="${g}"]`);
  const views = await p.$$eval('#subnav button[data-view]', bs => bs.map(b => b.dataset.view));
  if (views.length) screens.push(...views.map(view => ({ group: g, view }))); else screens.push({ group: g, view: null });
}
assert.ok(screens.length >= 15, `найдено экранов: ${screens.length}`);
console.log(`экранов в приложении: ${screens.length} (${screens.map(s => s.view ?? s.group).join(', ')})`);

for (const theme of THEMES) {
  await setTheme(p, theme);
  for (const s of screens) {
    await openScreen(p, s);
    const name = `${theme} / ${s.view ?? s.group}`;
    await runAxe(p, name);
    const dups = await duplicateIds(p);
    assert.deepEqual(dups, [], `${name}: повторяющиеся id: ${dups.join(', ')}`);
    await expand(p);
    await runAxe(p, name + ' (раскрыто)');
  }
}

// ---------- сквозные проверки структуры ----------
await setTheme(p, 'light');
assert.equal(await p.locator('#tabs [role=tab], #tabs [aria-selected]').count(), 0, 'нижняя панель — навигация, а не набор вкладок (role=tab без tablist)');
assert.equal(await p.locator('#tabs button[aria-current=page]').count(), 1, 'текущий раздел помечен aria-current');
assert.equal(await p.locator('#subnav button[aria-current=page]').count() <= 1, true);
assert.equal(await p.locator('main:visible').count(), 1, 'ровно одна главная область');

// ---------- ссылка «Перейти к содержимому» и фокус при смене экрана ----------
await p.reload();                                                                      // свежая страница: точка отсчёта для Tab — начало документа
await until(p, () => !document.getElementById('app').hidden);
await p.keyboard.press('Tab');
assert.equal(await p.evaluate(() => document.activeElement?.id), 'skip-link', 'первый Tab — на ссылку «Перейти к содержимому»');
await eventually(() => p.locator('#skip-link').boundingBox(), b => assert.ok(b && b.y >= 0 && b.height > 20, 'ссылка видна, пока на ней фокус'));   // на медленной машине кадр с показом приходит позже
assert.match(await p.textContent('#skip-link'), /Перейти к содержимому/);
await p.keyboard.press('Enter');
assert.equal(await p.evaluate(() => document.activeElement?.id), 'view', 'Enter переносит фокус в главную область');
await p.click('#tabs button[data-tab="diary"]');
assert.equal(await p.evaluate(() => document.activeElement?.id), 'title', 'после смены экрана фокус на заголовке');
assert.equal(await p.evaluate(() => document.activeElement?.tagName), 'H1');

// ---------- уведомления идут в постоянную живую область, без повторов и шума ----------
await p.evaluate(async () => { const u = await import('./ui.js'); u.toast('Проверка озвучивания', { actionLabel: 'Отменить', onAction() {} }); });
await until(p, () => /Проверка озвучивания/.test(document.getElementById('sr-live').textContent));
assert.equal(await p.getAttribute('#sr-live', 'aria-live'), 'polite');
assert.match(await p.textContent('#sr-live'), /Отменить/, 'о кнопке действия в уведомлении сказано');
for (const theme of THEMES) { await setTheme(p, theme); await runAxe(p, `${theme} / уведомление с кнопкой`); }
await p.evaluate(async () => { const u = await import('./ui.js'); u.clearToast(); });
assert.equal(await p.textContent('#sr-live'), '', 'при очистке уведомления живая область тоже пустеет (в тексте могут быть названия дел и суммы)');

// ---------- поиск: aria-expanded, Escape, возврат фокуса ----------
await p.click('#search-btn');
assert.equal(await p.getAttribute('#search-btn', 'aria-expanded'), 'true');
await p.fill('#search-input', 'банк'); await settle(p, 150);
for (const theme of THEMES) { await setTheme(p, theme); await runAxe(p, `${theme} / панель поиска`); }
await p.keyboard.press('Escape');
assert.equal(await p.getAttribute('#search-btn', 'aria-expanded'), 'false');
assert.equal(await p.evaluate(() => document.activeElement?.id), 'search-btn', 'после Escape фокус вернулся на кнопку поиска');

// ---------- кольцо фокуса: у каждой остановки Tab оно есть и заметно в обеих темах ----------
for (const theme of THEMES) {
  await setTheme(p, theme);
  await tab(p, 'today');
  await p.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  const stops = [];
  for (let i = 0; i < 14; i++) {
    await p.keyboard.press('Tab');
    stops.push(await p.evaluate(() => {
      const a = document.activeElement, cs = getComputedStyle(a), bg = getComputedStyle(document.documentElement).backgroundColor;
      return { sel: a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\s+/)[0] : ''), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor, shadow: cs.boxShadow, bg };
    }));
  }
  const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const s of stops) {
    if (s.sel.startsWith('h1') || s.sel.startsWith('main') || s.sel.startsWith('body')) continue;                 // заголовок и главная область получают фокус программно — кольца нет сознательно
    assert.ok(s.style !== 'none' && s.width >= 2, `${theme}: у ${s.sel} нет кольца фокуса (${s.style} ${s.width}px)`);
    assert.ok(ratio(s.color, s.bg) >= 3, `${theme}: кольцо у ${s.sel} слабо видно: ${ratio(s.color, s.bg).toFixed(2)}`);
  }
}
await setTheme(p, 'light');

// ---------- окна поверх экрана: общее поведение (inert, Tab по кругу, Escape, возврат фокуса) ----------
await tab(p, 'diary');
await p.focus('#fw-open'); await p.keyboard.press('Enter');                            // со стороны клавиатуры, как у человека без мыши
await until(p, () => !document.getElementById('fw-host').hidden);
const dlg = await p.evaluate(() => { const d = document.getElementById('fw-host'); return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), label: d.getAttribute('aria-label'), inside: d.contains(document.activeElement), tabsInert: document.getElementById('tabs').inert, headerInert: document.querySelector('header.top').inert }; });
assert.deepEqual([dlg.role, dlg.modal, !!dlg.label, dlg.inside, dlg.tabsInert, dlg.headerInert], ['dialog', 'true', true, true, true, true], 'окно: роль, фокус внутри, остальное недоступно');
for (let i = 0; i < 7; i++) {                                                          // Tab ходит по кругу и не уходит из окна
  await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => document.getElementById('fw-host').contains(document.activeElement)), true, `Tab #${i + 1} вышел из окна`);
}
await p.keyboard.press('Shift+Tab');
assert.equal(await p.evaluate(() => document.getElementById('fw-host').contains(document.activeElement)), true);
for (const theme of THEMES) { await setTheme(p, theme); await runAxe(p, `${theme} / окно «Свободное письмо»`); }
await p.keyboard.press('Escape');
await until(p, () => document.getElementById('fw-host').hidden);
assert.equal(await p.evaluate(() => document.activeElement?.id), 'fw-open', 'после закрытия фокус вернулся туда, откуда окно открыли');
assert.equal(await p.evaluate(() => document.getElementById('tabs').inert || document.querySelector('header.top').inert), false, 'страница снова доступна');
// пока идёт таймер, Escape его не прерывает (там нет простой кнопки «Закрыть»)
await p.click('#fw-open'); await p.click('#fw-go');
await until(p, () => !!document.getElementById('fw-text'));
await p.keyboard.press('Escape');
assert.equal(await p.evaluate(() => document.getElementById('fw-host').hidden), false, 'Escape не обрывает идущее письмо');
await p.click('#fw-finish'); await until(p, () => document.getElementById('fw-host').hidden || document.getElementById('fw-done'));
if (await p.locator('#fw-done').count()) await p.click('#fw-done');
await until(p, () => document.getElementById('fw-host').hidden);

// окна: axe в обеих темах для остальных окон
async function overlayScan(name, open, ready, close) {
  await open();
  await until(p, ready);
  for (const theme of THEMES) { await setTheme(p, theme); await runAxe(p, `${theme} / окно «${name}»`); }
  await setTheme(p, 'light');
  await close();
}
await tab(p, 'today');
await overlayScan('Фокус', () => p.click('#focus-chip'), () => !document.getElementById('focus-host').hidden, async () => { await p.keyboard.press('Escape'); await until(p, () => document.getElementById('focus-host').hidden); });
await tab(p, 'health');
await overlayScan('Дыхание', () => p.click('#breath-start'), () => !document.getElementById('breath-host').hidden, async () => { await p.click('#breath-close'); await until(p, () => document.getElementById('breath-host').hidden); });
await tab(p, 'tests');
await overlayScan('Проверка', () => p.click('#bt-quick'), () => !document.getElementById('bt-run').hidden && !!document.getElementById('bt-state-ok'), async () => { await p.click('#bt-abort'); await until(p, () => document.getElementById('bt-run').hidden || !!document.getElementById('bt-run').querySelector('h3'), null, 10000); });
await tab(p, 'learn');
const startBtn = (await p.$('#learn-start')) ? '#learn-start' : null;
if (!startBtn) { await p.click('.track-card[data-track="english"]'); }
const sessOpener = startBtn || '#track-start';
await overlayScan('Повторение', () => p.click(sessOpener), () => !document.getElementById('sess').hidden && !!document.getElementById('sess-show'), async () => {
  await p.click('#sess-show');
  for (const theme of THEMES) { await setTheme(p, theme); await runAxe(p, `${theme} / окно «Повторение» (ответ)`); }
  await setTheme(p, 'light');
  await p.keyboard.press('Escape');                                                    // у окна повторения Escape был и раньше
  await until(p, () => document.getElementById('sess').hidden);
});
const back = await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
assert.ok(back !== 'BODY', `после закрытия повторения фокус не потерян (сейчас: ${back})`);
assert.equal(await p.evaluate(() => document.getElementById('tabs').inert), false);

const mainErrors = t.errors.filter(e => !/Failed to load resource/.test(e));
assert.deepEqual(mainErrors, [], 'нет ошибок в консоли:\n' + mainErrors.join('\n'));
await t.close();

// ============================================================ 2. Экран пароля ============================================================
{
  const PW = 'длинная-надёжная-фраза';
  const L = await launch({ ctxOptions: { bypassCSP: true } });
  const q = L.page;
  q.on('dialog', d => d.accept());
  await q.goto(L.url);
  await until(q, () => !document.getElementById('app').hidden);
  await tab(q, 'more');
  await q.evaluate(() => document.querySelector('#subnav button[data-view="more"]')?.click());
  await q.fill('#pw1', PW); await q.fill('#pw2', PW); await q.check('#pw-ack'); await q.click('#pw-enable');
  await until(q, () => document.getElementById('sec-status'), null, 20000);
  await q.reload();
  await until(q, () => !document.getElementById('lock').hidden);
  assert.equal(await q.evaluate(() => document.activeElement?.id), 'lock-input', 'на экране пароля фокус в поле пароля');
  assert.equal(await q.locator('main:visible').count(), 1, 'экран пароля — главная область');
  for (const theme of THEMES) { await setTheme(q, theme); await runAxe(q, `${theme} / экран пароля`); }
  await q.click('#forgot summary');
  for (const theme of THEMES) { await setTheme(q, theme); await runAxe(q, `${theme} / экран пароля («Забыл пароль» раскрыт)`); }
  await q.click('#forgot summary');
  await q.fill('#lock-input', PW); await q.click('#lock-btn');
  await until(q, () => !document.getElementById('app').hidden, null, 20000);
  assert.equal(await q.evaluate(() => document.activeElement?.id), 'title', 'после ввода пароля фокус на заголовке экрана');
  await L.close();
}

// ============================================================ 3. Экран входа в аккаунт ============================================================
{
  const server = createServer({ env: { ALLOWED_ORIGINS: '*', SETUP_CODE: 'код-123' } });
  await new Promise(r => server.server.listen(0, r));
  const G = await launch({ ctxOptions: { bypassCSP: true }, buildEnv: { LIFEOS_REQUIRE_ACCOUNT: '1', LIFEOS_SERVER_URL: `http://localhost:${server.server.address().port}` } });
  const g = G.page;
  g.on('dialog', d => d.accept());
  await g.goto(G.url);
  await until(g, () => document.getElementById('gate-register'));
  assert.ok(await g.evaluate(() => document.getElementById('gate-body').contains(document.activeElement)), 'на экране входа фокус внутри формы');
  assert.equal(await g.locator('main:visible').count(), 1);
  for (const theme of THEMES) { await setTheme(g, theme); await runAxe(g, `${theme} / вход: создание аккаунта`); }
  await g.fill('#gate-user', 'anna'); await g.fill('#gate-pass', 'длинная-надёжная-фраза'); await g.fill('#gate-pass2', 'длинная-надёжная-фраза'); await g.fill('#gate-setup', 'код-123');
  await g.click('#gate-register');
  await until(g, () => document.getElementById('gate-code'), null, 90000);
  assert.ok(await g.evaluate(() => document.getElementById('gate-body').contains(document.activeElement)), 'после смены шага фокус остался в экране входа');
  for (const theme of THEMES) { await setTheme(g, theme); await runAxe(g, `${theme} / вход: код восстановления`); }
  await g.check('#gate-code-ok'); await g.click('#gate-code-done');
  await until(g, () => !document.getElementById('app').hidden, null, 60000);
  await g.click('#profile-btn'); await settle(g, 400);
  await g.click('#acc-logout');
  await until(g, () => document.getElementById('gate-login'));
  for (const theme of THEMES) { await setTheme(g, theme); await runAxe(g, `${theme} / вход: пароль`); }
  await G.close(); server.close();
}

// ============================================================ Итог ============================================================
const open = findings.filter(f => !allowed(f));
const fails = open.filter(f => FAIL_IMPACT.has(f.impact) || ZERO.has(f.rule));
const soft = open.filter(f => !fails.includes(f));
const byRule = list => {
  const m = new Map();
  for (const f of list) { const k = `[${f.impact}] ${f.rule}: ${f.help}`; (m.get(k) ?? m.set(k, []).get(k)).push(f); }
  return [...m].map(([k, v]) => `${k} — ${v.length} шт.\n` + [...new Map(v.map(f => [f.target, f])).values()].slice(0, 6).map(f => `     ${f.label}: ${f.target}\n        ${f.html}\n        ${f.msg}`).join('\n')).join('\n');
};
if (soft.length) console.log(`\nЗамечания moderate/minor (не ошибка): ${soft.length}\n${byRule(soft)}`);
if (ALLOW.length) console.log(`\nСознательно принято: ${ALLOW.map(a => `${a.rule} (${a.why})`).join('; ')}`);
assert.equal(fails.length, 0, `\nНарушения доступности (${fails.length}):\n${byRule(fails)}`);
console.log(`E2E A11Y OK (замечаний без ошибки: ${soft.length})`);
