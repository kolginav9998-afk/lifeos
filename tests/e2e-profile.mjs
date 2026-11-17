// «Профиль»: открыть через аватар и через «Меню», пустое состояние, период, цифры на экране совпадают с расчётом, кнопки разделов, «Изменить профиль»,
// календарь активности (сетка, слова, таблица), «Поделиться итогом» (скопировать, сохранить файлом), скрытие сумм, клавиатура, доступность (axe в обеих темах)
// и узкий экран 320 px с крупным шрифтом. Запуск в режиме замедления: E2E_STRESS=1 node tests/e2e-profile.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, tab, until, appReady, root, waitText, waitCount, waitVisible, waitAttr, waitToast, eventually, settleTheme } from './helpers.mjs';
import { seedDemo } from './seed.mjs';

const AXE = fs.readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const t = await launch({ ctxOptions: { bypassCSP: true } });
const { page, errors } = t;
await t.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(t.url).origin });
page.on('dialog', d => d.accept());
await page.goto(t.url);
await appReady(page);

// Что должно быть на экране, по расчёту в самом приложении (profile-stats.js), и что нарисовано: сравниваем слово в слово.
const expected = period => page.evaluate(async p => {
  const S = await import('./profile-stats.js'), st = await import('./store.js'), prefs = await import('./prefs.js');
  const hide = prefs.getPref('hideAmounts');
  return S.statsOverview(st.state.events, Date.now(), p).map(s => ({ id: s.id, empty: s.empty, tiles: s.tiles.map(x => [x.label, hide && x.private ? null : x.value, x.hint ?? '']) }));
}, period);
const drawn = () => page.$$eval('#pr-body .pr-sec', secs => secs.map(s => ({ id: s.dataset.sec, empty: !!s.querySelector('.empty'), tiles: [...s.querySelectorAll('.pr-tile')].map(x => [x.querySelector('dt').textContent, x.querySelector('dd.pr-v').textContent, x.querySelector('dd.pr-hint')?.textContent ?? '']) })));
const same = (want, got, what) => assert.deepEqual(got.map(s => ({ ...s, tiles: s.tiles.map((x, i) => (want.find(w => w.id === s.id).tiles[i]?.[1] === null ? [x[0], null, x[2]] : x)) })), want, what);
const sec = id => `#pr-sec-${id}`;
const valueOf = (id, key) => page.$eval(`${sec(id)} .pr-tile[data-key="${key}"] .pr-v`, n => n.textContent);
const open = async () => { await page.click('#profile-btn'); await waitText(page, '#title', 'Профиль'); };

// ---------- аватар открывает профиль; пустой журнал: все разделы на месте и честно пусты ----------
assert.equal(await page.getAttribute('#profile-btn', 'aria-label'), 'Профиль: без имени');
await open();
assert.equal(await page.locator('#tabs button[data-tab="more"][aria-current="page"]').count(), 1, 'нижняя вкладка «Меню» подсвечена');
assert.equal(await page.getAttribute('#subnav button[data-view="profile"]', 'aria-current'), 'page');
assert.equal(await page.evaluate(() => document.activeElement.id), 'title', 'после перехода фокус на заголовке экрана');
await waitCount(page, '#pr-body .pr-sec', 12);
await waitCount(page, '#pr-body .pr-sec .empty', 12);
assert.deepEqual(await page.$$eval('#pr-body .pr-sec h3', hs => hs.map(h => h.textContent)), ['Приложение', 'Записи по группам', 'Дела', 'Привычки', 'Здоровье и самочувствие', 'Деньги', 'Работа и зарплата', 'Тренировки', 'Учёба', 'Тесты и проверки', 'Условный индекс логики', 'Дом'], 'разделы в заданном порядке');
assert.equal(await page.textContent('#pr-sec-habits .empty-t'), 'Пока нет данных');
assert.match(await page.textContent('#pr-sec-habits .empty-p'), /Заведи первую привычку/);
assert.equal(await page.textContent('#pr-sec-habits .empty-a'), 'Завести привычку');
assert.equal(await page.textContent('#pr-name'), 'Без имени');
assert.match(await page.textContent('#pr-days'), /счёт дней/);
assert.equal(await page.getAttribute('#pr-grid', 'aria-hidden'), 'true', 'сетка календаря для диктора скрыта: вместо неё слова и таблица');
assert.match(await page.textContent('#pr-cal-text'), /За 26 недель .* записей не было/);
// «Поделиться» без данных: честно, без пустого файла
await page.click('#pr-share'); await waitVisible(page, '#pr-share-win');
assert.match(await page.textContent('#pr-share-note'), /Пока нечем делиться/);
assert.equal(await page.isDisabled('#pr-share-copy'), true); assert.equal(await page.isDisabled('#pr-share-save'), true);
await page.click('#pr-share-close'); await waitVisible(page, '#pr-share-win', false);
assert.equal(await page.evaluate(() => document.activeElement.id), 'pr-share', 'после закрытия фокус вернулся на «Поделиться итогом»');
// кнопка пустого раздела ведёт туда, где его заполнить
await page.click('#pr-sec-habits .empty-a'); await waitText(page, '#title', 'Привычки');
await open();

// ---------- данные: общие демо-данные и несколько своих ----------
await seedDemo(page);
await page.evaluate(async () => {
  const s = await import('./store.js'), E = await import('./events.js'), W = await import('./workouts.js'), Sp = await import('./speaking.js'), Dc = await import('./diction.js');
  const S = await import('./schedule.js'), P = await import('./salary.js'), T = await import('./salary-tax.js'), B = await import('./bt-core.js'), Pl = await import('./planning.js');
  const today = E.todayStr(), d = n => E.addDays(today, n), now = Date.now(), noon = n => { const [y, m, dd] = d(n).split('-').map(Number); return new Date(y, m - 1, dd, 12).getTime(); };
  let w = W.startWorkout({ name: 'Силовая', date: d(-1), now: noon(-1) - 45 * 60000 }); w = W.addExercise(w, 'Жим лёжа', 'reps'); w = W.addSet(w, 0, { reps: 8, kg: 60 });
  const mk = (startedAt, results) => B.makeRunEvent(B.makeRun({ mode: 'single', startedAt, durationMs: 60000, results }), startedAt);
  const goal = Pl.makeGoal({ title: 'Отпуск', targetMinor: 100000 }, noon(-20));
  await s.saveMany([W.finishWorkout(w, { now: noon(-1) }), Sp.makeSpeak({ lang: 'english', seconds: 600, date: d(-1) }, noon(-1)), Dc.makeDiction({ kind: 'warmup', seconds: 120, date: d(0) }, now),
    S.makeWorkcfg(S.cfgFromTemplate('w52', d(-30)), null, noon(-30)), P.makePaycfg({ mode: 'salary', baseMinor: 16000000, currency: 'RUB', tax: T.presetTax('flat') }, null, noon(-30)),
    goal, Pl.makeGoalMove(goal.id, 40000, { date: d(-10) }, noon(-10)),
    mk(noon(-3), { reaction: { metrics: { n: 8, median: 312, mean: 320, sd: 30, best: 250, lapses: 0, falseStarts: 0 }, ms: 8000, trials: [] } }),
    mk(noon(0), { matrices: { metrics: { n: 12, correct: 9, accuracy: 0.75, meanMs: 9000, score: 12, maxScore: 18 }, ms: 90000, trials: [] } })]);
});
await waitCount(page, '#pr-body .pr-sec .empty', 0);                                         // с данными пустых разделов нет
assert.equal(await page.textContent('#pr-name'), 'Анна Петрова');
assert.equal(await page.textContent('#pr-motto'), 'Шаг за шагом');
assert.equal((await page.textContent('#pr-avatar')).trim(), '🦊');
assert.equal(await page.getAttribute('#profile-btn', 'aria-label'), 'Профиль: Анна Петрова');
const days = await page.evaluate(async () => (await import('./profile-stats.js')).appFacts((await import('./store.js')).state.events).daysWith);
assert.ok(days >= 100, `«с нами» считается с первой записи (старые вещи дома): ${days}`);
assert.match(await page.textContent('#pr-days'), new RegExp(`^Вы с нами ${days} (день|дня|дней)$`));
assert.equal(await valueOf('app', 'app.days'), String(days));
assert.equal(await valueOf('home', 'home.items'), '4', 'четыре вещи из общих демо-данных');
assert.equal(await valueOf('habits', 'habits.active'), '3');
assert.equal(await valueOf('tasks', 'tasks.overdue'), '1');
assert.match(await page.textContent(`${sec('health')} .pr-tile[data-key="health.weight.last"] .pr-v`), /^\d+,\d кг$/);
assert.equal(await page.textContent(`${sec('tests')} .pr-tile[data-key="tests.last.matrices"] .pr-l`), 'Матрицы');
assert.match(await page.textContent(`${sec('logic')} .pr-tile[data-key="logic.index"] .pr-l`), /^Условный индекс логики$/);
assert.match(await page.textContent(`${sec('logic')} .pr-tile[data-key="logic.index"] .pr-hint`), /не IQ и не диагноз/);
assert.equal(await valueOf('work', 'work.days'), await page.evaluate(async () => { const S = await import('./schedule.js'), E = await import('./events.js'), st = await import('./store.js'); const t = E.todayStr(); return String(S.monthSummary(t.slice(0, 7), S.cfgOf(st.state.events), S.workdaysOf(st.state.events), t).workdays); }));

// ---------- период: неделя, месяц, всё время; цифры на экране — те же, что считает приложение ----------
assert.equal(await page.getAttribute('#pr-p-month', 'aria-pressed'), 'true', 'по умолчанию — месяц');
for (const [id, kind, phrase] of [['pr-p-week', 'week', /^Сделано за 7 дней$/], ['pr-p-all', 'all', /^Сделано за всё время$/], ['pr-p-month', 'month', /^Сделано за [а-я]+$/]]) {
  await page.click(`#${id}`);
  await waitAttr(page, `#${id}`, 'aria-pressed', 'true');
  assert.equal(await page.locator('#pr-body .seg[aria-pressed="true"]').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), id, 'после нажатия фокус остался на той же кнопке');
  await eventually(() => page.textContent(`${sec('tasks')} .pr-tile[data-key="tasks.done"] .pr-l`), l => assert.match(l, phrase));
  same(await expected(kind), await drawn(), `период ${kind}`);
  assert.equal(await page.locator(`${sec('tasks')} .pr-tile[data-key="tasks.done.all"]`).count(), kind === 'all' ? 0 : 1, 'плитка «Сделано всего» есть, пока период не «всё время»: иначе она повторила бы первую');
  assert.match(await page.textContent('#pr-range'), kind === 'all' ? /^Период: за всё время\./ : /^Период: \d/);
}
await page.click('#pr-p-month');

// ---------- разделы без периода не меняются, разделы с периодом меняют подпись ----------
const appBefore = await page.textContent(sec('app'));
await page.click('#pr-p-week'); await waitAttr(page, '#pr-p-week', 'aria-pressed', 'true');
assert.equal(await page.textContent(sec('app')), appBefore, 'раздел «Приложение» от периода не зависит');
assert.match(await page.textContent(`${sec('money')} .pr-tile[data-key="money.expense"] .pr-l`), /^Расход за 7 дней$/);
await page.click('#pr-p-month');

// ---------- кнопка раздела ведёт на его экран; фокус на заголовке; вернуться можно через аватар ----------
await page.click('#pr-open-habits');
await waitText(page, '#title', 'Привычки');
assert.equal(await page.evaluate(() => document.activeElement.id), 'title');
assert.equal(await page.locator('#tabs button[data-tab="today"][aria-current="page"]').count(), 1);
await open();
for (const [id, title] of [['tasks', 'Сегодня'], ['money', 'Деньги'], ['home', 'Дом'], ['work', 'График работы'], ['workouts', 'Тренировки'], ['learning', 'Учёба'], ['app', 'Рефлексия']]) {
  await page.click(`#pr-open-${id}`); await waitText(page, '#title', title); await open();
}
assert.equal(await page.getAttribute('#pr-open-money', 'aria-label'), 'Открыть раздел «Деньги»');
assert.equal(await page.textContent('#pr-open-money'), 'Открыть раздел');

// ---------- через «Меню» ----------
await tab(page, 'menu'); await waitText(page, '#title', 'Меню');
await page.fill('#menu-search', 'статистика');
await eventually(() => page.locator('#menu-results .menu-tile[data-screen="profile"]').count(), n => assert.equal(n, 1, 'по слову «статистика» нашёлся профиль'));
await page.click('#menu-results .menu-tile[data-screen="profile"]');
await waitText(page, '#title', 'Профиль');
await tab(page, 'menu'); await waitText(page, '#title', 'Меню');
assert.equal(await page.textContent('.menu-tile[data-screen="profile"] strong'), 'Профиль и статистика');
assert.equal(await page.textContent('.menu-tile[data-screen="account"] strong'), 'Аккаунт и вход');
await page.click('.menu-tile[data-screen="profile"]'); await waitText(page, '#title', 'Профиль');

// ---------- «Изменить профиль» ведёт на аккаунт с открытой формой, форма там уже есть ----------
await page.click('#pr-edit');
await waitText(page, '#title', 'Аккаунт');
assert.equal(await page.evaluate(() => document.getElementById('profile-edit').open), true, 'форма имени, значка и цвета раскрыта');
assert.equal(await page.inputValue('#pf-name'), 'Анна Петрова');
assert.equal(await page.evaluate(() => document.activeElement.id), 'title');
await open();

// ---------- календарь активности ----------
assert.equal(await page.locator('#pr-grid .pr-cell').count(), 26 * 7);
assert.ok(await page.locator('#pr-grid .pr-cell.pr-future').count() <= 6, 'после сегодняшнего дня не больше шести клеток');
assert.ok(await page.locator('#pr-grid .pr-cell:is(.pr-l1,.pr-l2,.pr-l3,.pr-l4)').count() >= 4, 'дни с записями закрашены');
assert.ok(await page.locator('#pr-grid .pr-cell.pr-l4').count() >= 1, 'самый насыщенный день — самый тёмный');
assert.match(await page.textContent('#pr-cal-text'), /^За 26 недель \(.+\) активных дней: \d+ из \d+, всего \d+ .*Больше всего записей было/);
assert.equal(await page.locator('#pr-legend li').count(), 5);
assert.equal(await page.evaluate(() => document.getElementById('pr-cal-more').open), false, 'таблица по неделям свёрнута');
await page.click('#pr-cal-more summary');
await waitCount(page, '#pr-cal-table tbody tr', 26);
assert.deepEqual(await page.$$eval('#pr-cal-table thead th', ths => ths.map(x => x.textContent)), ['Неделя', 'Записей', 'Активных дней']);
const tableTotal = await page.$$eval('#pr-cal-table tbody tr td:nth-child(2)', tds => tds.reduce((s, x) => s + Number(x.textContent), 0));
assert.equal(tableTotal, await page.evaluate(async () => (await import('./profile-stats.js')).activityByDay((await import('./store.js')).state.events).total), 'таблица даёт ту же сумму, что и календарь');
await page.click('#pr-cal-more summary');

// ---------- «Поделиться итогом»: текст виден заранее, копируется и сохраняется файлом ----------
await page.click('#pr-share'); await waitVisible(page, '#pr-share-win');
assert.equal(await page.getAttribute('#pr-share-win', 'role'), 'dialog');
assert.equal(await page.evaluate(() => document.activeElement.id), 'pr-share-title', 'фокус в окне, на заголовке');
const shareText = await page.inputValue('#pr-share-text');
assert.match(shareText.split('\n')[0], /^Мои итоги в приложении «Компас» \(\d/);
assert.ok(shareText.split('\n').length >= 5 && shareText.split('\n').length <= 12, `короткий текст: ${shareText}`);
assert.ok(!/₽|кг|Анна|Куртка|Зарядка|вес|сон|настроен/i.test(shareText), `в тексте нет денег, здоровья и названий: ${shareText}`);
assert.match(await page.textContent('#pr-share-note'), /Денег, здоровья и названий в нём нет/);
await page.click('#pr-share-copy');
await waitToast(page, /Итог скопирован/);
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), shareText, 'в буфере именно тот текст, что на экране');
const [file] = await Promise.all([page.waitForEvent('download'), page.click('#pr-share-save')]);
assert.match(file.suggestedFilename(), /^itogi-\d{4}-\d{2}-\d{2}\.txt$/);
assert.equal(fs.readFileSync(await file.path(), 'utf8'), shareText, 'в файле тот же текст');
for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.getElementById('pr-share-win').contains(document.activeElement)), true, `Tab #${i + 1} остался в окне`); }
await page.keyboard.press('Escape'); await waitVisible(page, '#pr-share-win', false);
assert.equal(await page.evaluate(() => document.activeElement.id), 'pr-share');

// ---------- «Скрывать суммы» прячет деньги и в плитках профиля ----------
await page.evaluate(async () => (await import('./prefs.js')).setPref('hideAmounts', true));
await tab(page, 'menu'); await page.click('.menu-tile[data-screen="profile"]'); await waitText(page, '#title', 'Профиль');
for (const key of ['money.income', 'money.expense', 'money.balance', 'money.saved']) assert.match(await valueOf('money', key), /^•••• ₽$/, key);
assert.match(await valueOf('work', 'work.pay.net'), /^•••• ₽$/);
assert.doesNotMatch(await page.textContent(sec('money')), /\d{3}/, 'цифры сумм не видны');
assert.equal(await valueOf('app', 'app.total') !== '', true, 'остальные числа на месте');
await page.evaluate(async () => (await import('./prefs.js')).setPref('hideAmounts', false));
await tab(page, 'menu'); await page.click('.menu-tile[data-screen="profile"]'); await waitText(page, '#title', 'Профиль');
assert.match(await valueOf('money', 'money.income'), /₽$/);

// ---------- клавиатура: Enter на «Открыть раздел», фокус не теряется при пересчёте ----------
await page.focus('#pr-p-all'); await page.keyboard.press('Enter');
await waitAttr(page, '#pr-p-all', 'aria-pressed', 'true');
assert.equal(await page.evaluate(() => document.activeElement.id), 'pr-p-all');
await page.focus('#pr-p-month'); await page.keyboard.press('Enter'); await waitAttr(page, '#pr-p-month', 'aria-pressed', 'true');
await page.focus('#pr-open-tasks'); await page.keyboard.press('Enter'); await waitText(page, '#title', 'Сегодня');
await open();
// пока экран открыт, новая запись сама попадает в цифры, а фокус остаётся
await page.focus('#pr-p-week');
const before = Number(await valueOf('app', 'app.total'));
await page.evaluate(async () => { const s = await import('./store.js'), N = await import('./notes.js'); await s.save(N.makeNote('Ещё одна заметка', Date.now())); });
await eventually(async () => Number(await valueOf('app', 'app.total')), n => assert.equal(n, before + 1));
assert.equal(await page.evaluate(() => document.activeElement.id), 'pr-p-week', 'фокус не потерян после пересчёта');
await page.click('#pr-p-month');

// ---------- доступность: axe в обеих темах (пустой экран был бы тем же кодом, здесь — с данными) ----------
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const ZERO = new Set(['heading-order', 'label', 'select-name', 'button-name', 'link-name', 'aria-required-parent', 'aria-allowed-role', 'aria-allowed-attr', 'landmark-one-main', 'region', 'landmark-unique', 'duplicate-id', 'duplicate-id-aria', 'list', 'listitem', 'definition-list', 'dlitem', 'scrollable-region-focusable', 'aria-hidden-focus', 'nested-interactive', 'label-content-name-mismatch', 'color-contrast']);
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
  for (const [id, name] of [['pr-p-week', 'неделя'], ['pr-p-month', 'месяц'], ['pr-p-all', 'всё время']]) { await page.click(`#${id}`); await waitAttr(page, `#${id}`, 'aria-pressed', 'true'); await axe(`${theme} / ${name}`); }
  await page.click('#pr-p-month');
  await page.click('#pr-cal-more summary'); await axe(`${theme} / таблица по неделям`); await page.click('#pr-cal-more summary');
  await page.click('#pr-share'); await waitVisible(page, '#pr-share-win'); await axe(`${theme} / окно «Поделиться итогом»`); await page.click('#pr-share-close'); await waitVisible(page, '#pr-share-win', false);
}
await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
const main = errors.filter(e => !/Failed to load resource/.test(e));
assert.deepEqual(main, [], 'нет ошибок в консоли:\n' + main.join('\n'));
await t.close();

// ============================================================ пустой экран: доступность ============================================================
{
  const E = await launch({ ctxOptions: { bypassCSP: true } });
  const p = E.page;
  await p.goto(E.url); await appReady(p);
  await p.click('#profile-btn'); await waitText(p, '#title', 'Профиль'); await waitCount(p, '#pr-body .pr-sec .empty', 12);
  for (const theme of ['light', 'dark']) {
    await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await settleTheme(p, theme);
    if (!(await p.evaluate(() => typeof window.axe !== 'undefined'))) await p.addScriptTag({ content: AXE });
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    let bad = await p.evaluate(async tags => (await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target.join(' ') + ' :: ' + n.html.slice(0, 100)) })), TAGS);
    if (bad.some(v => v.id === 'color-contrast')) { await p.waitForTimeout(400); bad = await p.evaluate(async tags => (await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target.join(' ') + ' :: ' + n.html.slice(0, 100)) })), TAGS); }
    assert.deepEqual(bad.filter(v => ['serious', 'critical'].includes(v.impact) || ZERO.has(v.id)), [], `${theme} / пустой профиль: нарушения доступности`);
  }
  const e0 = E.errors.filter(e => !/Failed to load resource/.test(e));
  assert.deepEqual(e0, [], 'нет ошибок в консоли (пустой экран):\n' + e0.join('\n'));
  await E.close();
}

// ============================================================ узкий экран и крупный шрифт ============================================================
for (const cfg of [{ w: 320, h: 640, fs: 1.3 }, { w: 320, h: 640, fs: 1 }]) {
  const L = await launch({ viewport: { width: cfg.w, height: cfg.h }, ctxOptions: { bypassCSP: true, acceptDownloads: true } });
  const p = L.page;
  if (cfg.fs !== 1) await L.ctx.addInitScript(fs => { try { localStorage.setItem('lifeos.prefs.v1', JSON.stringify({ fontScale: fs })); } catch { /* не критично */ } }, cfg.fs);
  await p.goto(L.url); await appReady(p);
  const measure = () => p.evaluate(() => {
    const vw = innerWidth, bad = [];
    if (document.documentElement.scrollWidth > vw) bad.push(`страница шире экрана: ${document.documentElement.scrollWidth} > ${vw}`);
    const scope = [...document.querySelectorAll('#view-profile, #view-profile *, .overlay:not([hidden]), .overlay:not([hidden]) *')];
    const shown = e => { for (let n = e; n && n !== document.body; n = n.parentElement) if (n.hidden || getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden') return false; return true; };
    for (const e of scope) {
      if (!shown(e) || e.closest('svg') || e.closest('[hidden]') || (getComputedStyle(e).position === 'fixed' && !e.classList.contains('overlay'))) continue;
      const r = e.getBoundingClientRect();
      if (!r.width) continue;
      if (r.right > vw + 0.5 || r.left < -0.5) bad.push(`за краем: ${e.tagName.toLowerCase()}.${e.className} [${Math.round(r.left)}..${Math.round(r.right)}] «${(e.textContent || '').trim().slice(0, 24)}»`);
      if (!e.children.length && e.textContent.trim() && !/^(INPUT|TEXTAREA|SELECT|OPTION|SUMMARY)$/.test(e.tagName) && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).display !== 'inline') bad.push(`текст шире рамки: ${e.className} ${e.scrollWidth}>${e.clientWidth} «${e.textContent.trim().slice(0, 24)}»`);
    }
    const last = document.querySelector('#view-profile #pr-body').lastElementChild, tabs = document.getElementById('tabs').getBoundingClientRect().top;
    window.scrollTo(0, document.documentElement.scrollHeight);
    if (last && last.getBoundingClientRect().bottom > tabs + 1) bad.push('последний блок под нижней панелью');
    window.scrollTo(0, 0);
    return bad;
  });
  const check = async what => { const bad = await measure(); assert.deepEqual(bad, [], `${cfg.w}px, шрифт ${cfg.fs * 100}%, ${what}:\n${bad.join('\n')}`); };
  await p.click('#profile-btn'); await waitText(p, '#title', 'Профиль');
  await check('пустой профиль');
  // данные «на разрыв»: длинное имя и девиз без пробелов, огромные суммы, много записей
  const word = 'Сверхдлинноеслововбезпробеловдляпроверкипереносатекставкарточке';
  await p.evaluate(async word => {
    const s = await import('./store.js'), E = await import('./events.js'), M = await import('./money.js'), Hb = await import('./habits.js'), Hm = await import('./home.js'), Pl = await import('./planning.js');
    const now = Date.now(), today = E.todayStr(now), ago = n => { const [y, m, d] = E.addDays(today, -n).split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); }, evs = [E.makeProfile('Александра-Мария Константиновна Святополк-Четвертинская', now, null, { avatar: '', color: 'amber', motto: word })];
    const habit = Hb.makeHabit({ name: 'Ежедневная вечерняя растяжка всего тела перед сном ' + word }, ago(40)); evs.push(habit);
    for (let i = 0; i < 40; i++) { evs.push(Hb.makeHabitLog(habit, E.addDays(today, -i), 'full', ago(i))); evs.push(E.completeTask(E.makeTask(`${word} ${i}`, ago(i + 1)), ago(i)).updated); }
    evs.push(M.makeExpense({ amount: '123456789', category: word, note: word, date: today }, now), M.makeIncome({ amount: '99999999', category: 'Зарплата', date: today }, now));
    const g = Pl.makeGoal({ title: word, targetMinor: 999999999 }, ago(5)); evs.push(g, Pl.makeGoalMove(g.id, 888888888, { date: today }, now));
    evs.push(Hm.makeItem({ name: word, kind: 'clothes' }, ago(90)));
    await s.saveMany(evs);
  }, word);
  await waitCount(p, '#pr-body .pr-sec .empty', { max: 8 });
  await check('с данными, месяц');
  for (const id of ['pr-p-week', 'pr-p-all']) { await p.click(`#${id}`); await waitAttr(p, `#${id}`, 'aria-pressed', 'true'); await check(`период ${id}`); }
  await p.click('#pr-p-month');
  await p.click('#pr-cal-more summary'); await check('таблица по неделям'); await p.click('#pr-cal-more summary');
  await p.click('#pr-share'); await waitVisible(p, '#pr-share-win'); await check('окно «Поделиться итогом»'); await p.click('#pr-share-close'); await waitVisible(p, '#pr-share-win', false);
  const e2 = L.errors.filter(e => !/Failed to load resource/.test(e));
  assert.deepEqual(e2, [], 'нет ошибок в консоли:\n' + e2.join('\n'));
  await L.close();
}
console.log('E2E PROFILE OK');
