// «График» и «Зарплата»: выбор графика, отметка дней (отпуск, часы), календарь с клавиатуры, норма, рабочий таймер (под управляемым временем),
// оклад → налог → на руки, переработки по минутам ×2 с точными суммами, ступени и округление, запись дохода, итог месяца, «а что если», узкий экран 320 px и шрифт 130 %.
// Числа не зависят от текущей даты: график «5 через 2», норма 160 ч вручную, оклад 160 000 ₽ → час = 1000 ₽; переработка 47 минут по ×2 = 1566,67 ₽.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, tab, appReady, waitText, waitCount, waitVisible, waitAttr, waitToast, waitValue, eventually, settleTheme, root, ymd } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.goto(t.url); await appReady(page);
const evs = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);
const today = ymd(0);
const attr = (sel, name) => page.getAttribute(sel, name);

// ---------- календарь РФ: подставной ответ isdayoff.ru (первая среда месяца — праздник) ----------
const monthStart = today.slice(0, 7);
let holiday = null;
for (let d = 1; d <= 7 && !holiday; d++) { const k = `${monthStart}-${String(d).padStart(2, '0')}`; if (new Date(`${k}T12:00:00`).getDay() === 3) holiday = k; }
const codesFor = year => {
  let out = '';
  for (let i = 0; i < ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365); i++) { const dt = new Date(Date.UTC(year, 0, 1 + i)), dow = dt.getUTCDay(); out += dt.toISOString().slice(0, 10) === holiday || dow === 0 || dow === 6 ? '1' : '0'; }
  return out;
};
await page.context().route('https://isdayoff.ru/**', r => r.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: codesFor(Number(new URL(r.request().url()).searchParams.get('year'))) }));

// ---------- график: «5 через 2» ставится сам, человек только исправляет; потом мастер ----------
await tab(page, 'schedule');
await waitVisible(page, '#sch-auto');                                              // подсказка: график поставлен сам
await waitCount(page, '#sch-grid .cal-day', { min: 28 });
await waitText(page, '#sch-pattern', /5 через 2/);
await waitText(page, '#sch-stats', /Отработано/);
await waitText(page, '#sch-cal', /подставлены по производственному календарю/);   // календарь пришёл из подставного ответа
await waitAttr(page, `#sch-d-${holiday}`, 'aria-label', /выходной/);                        // праздничная среда стала выходным без ручной отметки (после ответа календаря)
await page.click('#sch-auto-change');
await waitVisible(page, '#sch-wiz');
await waitAttr(page, '#sch-wiz-tpls button[data-tpl="w52"]', 'aria-pressed', 'true');
await page.click('#sch-wiz-tpls button[data-tpl="c22"]');                         // цикл: нужна дата первого дня
await waitVisible(page, '#sch-wiz-start');
await waitCount(page, '#sch-wiz-strip .chip', 14);
await page.click('#sch-wiz-tpls button[data-tpl="cus"]');                         // свой цикл: порядок дней собирается кнопками
await waitVisible(page, '#sch-wiz-steps');
await page.click('#sch-wiz-form button:has-text("Начать заново")');
await page.click('#sch-wiz-apply');
await waitText(page, '#sch-wiz-err', /хотя бы один день/);
await page.click('#sch-wiz-tpls button[data-tpl="w52"]');
await waitVisible(page, '#sch-wiz-start', false);
await page.click('#sch-wiz-apply');
await waitVisible(page, '#sch-wiz', false);
await waitVisible(page, '#sch-auto', false);                                           // сохранение в мастере делает график обычным: подсказка исчезла
await waitCount(page, '#sch-grid .cal-day', { min: 28, max: 31 });
const cfgs = await eventually(() => evs('workcfg'), r => assert.equal(r.length, 1));
assert.equal(cfgs[0].id, 'workcfg'); assert.equal(cfgs[0].payload.pattern.kind, 'week'); assert.deepEqual(cfgs[0].payload.pattern.week, ['d', 'd', 'd', 'd', 'd', '', '']);

// календарь: роли, полные даты в названиях кнопок, одна кнопка в порядке Tab, сегодня отмечен
const grid = await page.evaluate(() => {
  const g = document.getElementById('sch-grid'), days = [...g.querySelectorAll('.cal-day')];
  return { role: g.getAttribute('role'), label: g.getAttribute('aria-label'), rows: g.querySelectorAll('[role=row]').length, cells: g.querySelectorAll('[role=gridcell]').length, heads: g.querySelectorAll('[role=columnheader]').length,
    n: days.length, tab0: g.querySelectorAll('.cal-day[tabindex="0"]').length, curr: g.querySelectorAll('[aria-current="date"]').length, labels: days.every(b => /^[а-я]+, \d+ [а-я]+ \d{4}\./.test(b.getAttribute('aria-label'))), today: g.querySelector('[aria-current="date"]')?.dataset.date };
});
assert.deepEqual([grid.role, grid.heads, grid.curr, grid.tab0, grid.labels, grid.today], ['grid', 7, 1, 1, true, today]);
assert.ok(grid.rows >= 5 && grid.cells === (grid.rows - 1) * 7 && /^Календарь: /.test(grid.label), JSON.stringify(grid));
assert.match(await attr(`#sch-d-${today}`, 'aria-label'), /Сегодня\./);
// с клавиатуры: стрелки, Enter открывает день, Escape закрывает и возвращает фокус на день
await page.focus(`#sch-d-${today}`);
await page.keyboard.press('ArrowRight');
await eventually(() => page.evaluate(() => document.activeElement?.dataset?.date ?? ''), d => assert.equal(d, ymd(1)));
await page.keyboard.press('ArrowLeft');
await eventually(() => page.evaluate(() => document.activeElement?.dataset?.date ?? ''), d => assert.equal(d, today));
await page.keyboard.press('Enter');
await waitVisible(page, '#sch-day');
await waitText(page, '#sch-day-title', /^[а-я]+, \d+ [а-я]+ \d{4}$/);
assert.equal(await page.evaluate(() => document.getElementById('sch-day').getAttribute('aria-modal')), 'true');
await page.keyboard.press('Escape');
await waitVisible(page, '#sch-day', false);
await eventually(() => page.evaluate(() => document.activeElement?.id), id => assert.equal(id, `sch-d-${today}`), 3000);

// отметки дней: рабочие дни месяца (не сегодня), по цвету «День»
const works = (await page.$$eval('#sch-grid .cal-day.sc1', bs => bs.map(b => b.dataset.date))).filter(d => d !== today);
assert.ok(works.length >= 3, `рабочих дней в месяце: ${works.length}`);
const [vac, otDay, editDay] = works;
await page.click(`#sch-d-${vac}`); await waitVisible(page, '#sch-day');                       // отпуск
await page.click('#sch-day .work-kinds button[data-kind="vacation"]');
await waitAttr(page, '#sch-day .work-kinds button[data-kind="vacation"]', 'aria-pressed', 'true');
await page.click('#sch-day-save'); await waitVisible(page, '#sch-day', false);
await waitAttr(page, `#sch-d-${vac}`, 'aria-label', /Отпуск/);
await waitText(page, '#sch-leave', /Отпуск: 1 дн\./);
assert.match(await attr(`#sch-d-${vac}`, 'class'), /k-vacation/);
await page.click(`#sch-d-${vac}`); await waitVisible(page, '#sch-day');                       // вернуть как в графике
await page.click('#sch-day-reset'); await waitVisible(page, '#sch-day', false);
await waitAttr(page, `#sch-d-${vac}`, 'aria-label', /Рабочий день, смена «День»/);
await waitVisible(page, '#sch-leave', false);
await eventually(() => evs('workday'), r => assert.equal(r.length, 0));

// норма часов вручную, лишний выходной, типы смен
await page.click('#sch-norm summary');
await page.selectOption('#sch-norm-mode', 'manual');
await page.fill('#sch-norm-hours', '160');
await page.click('#sch-norm-save');
await waitToast(page, /Сохранено/);
await waitText(page, '#sch-stats', /Норма: 160 ч/);
await page.fill('#sch-off-date', '2027-01-01'); await page.click('#sch-off-add');
await waitText(page, '#sch-off-list', /1 января 2027/);
await page.click('#sch-off-list button');
await waitText(page, '#sch-off-list', /Пока нет/);
await page.click('#sch-shifts summary');
await waitCount(page, '#sch-shifts-list fieldset', 1);
await page.click('#sch-shift-add'); await waitCount(page, '#sch-shifts-list fieldset', 2);
await page.click('#sch-shifts-list fieldset:nth-child(2) button.danger'); await waitCount(page, '#sch-shifts-list fieldset', 1);

// «Сегодня»: строка про смену
await tab(page, 'today');
await waitText(page, '#work-today', /^Сегодня (смена «День» 09:00–18:00|выходной)/);

// ---------- зарплата: оклад → налог → на руки ----------
await tab(page, 'salary');
await waitVisible(page, '#sal-quick');
await page.fill('#sal-q-base', '160000');
await page.click('#sal-q-save');
await waitText(page, '#sal-net', /^139\s200\s₽$/);                                           // 160 000 − 13 %
await waitText(page, '#sal-hero-sub', /Начислено до налога: 160\s000\s₽ · налог: 20\s800\s₽ \(13 %\)/);
assert.match(await page.textContent('#sal-disclaimer'), /приблизительный, по твоим настройкам; это не бухгалтерия и не налоговая консультация/);
assert.match(await page.textContent('#sal-ot-line'), /переработок нет/);
const pays = await eventually(() => evs('paycfg'), r => assert.equal(r.length, 1));
assert.deepEqual([pays[0].payload.baseMinor, pays[0].payload.tax, pays[0].payload.ot.multMille], [16_000_000, { kind: 'flat', rateBp: 1300 }, 2000]);

// переработка 47 минут: 09:00–18:47 при плане 09:00–18:00 с часовым перерывом
await tab(page, 'schedule');
await page.click(`#sch-d-${otDay}`); await waitVisible(page, '#sch-day');
await page.fill('#sch-day-afrom', '09:00'); await page.fill('#sch-day-ato', '18:47');
await page.click('#sch-day-save'); await waitVisible(page, '#sch-day', false);
await waitAttr(page, `#sch-d-${otDay}`, 'aria-label', /Отмечено 09:00–18:47, 8 ч 47 мин/);
await waitText(page, `#sch-d-${otDay} .cal-mk`, '✓');
await tab(page, 'salary');
await waitText(page, '#sal-net', /^140\s563\s₽$/);
await waitText(page, '#sal-hero-sub', /Начислено до налога: 161\s566,67\s₽ · налог: 21\s003,67\s₽ \(13 %\)/);
await waitText(page, '#sal-ot-line', /: 47 мин\. Каждая минута ×2\. Итого 1\s566,67\s₽\./);
await waitText(page, '#sal-dl .ot dt', 'Переработки: 47 мин'); await waitText(page, '#sal-dl .ot dd', /^1\s566,67\s₽$/);
await waitText(page, '#sal-dl .tax dt', 'Налог: плоская ставка 13 %'); await waitText(page, '#sal-dl .tax dd', /^−21\s003,67\s₽$/);
await waitText(page, '#sal-dl .gross dd', /^161\s566,67\s₽$/); await waitText(page, '#sal-dl .net dd', /^140\s563\s₽$/);

// «Часы»: быстрая правка отметки
await page.click('#sal-tab-hours');
await waitText(page, `#sal-hours-list [data-date="${otDay}"]`, /\+47 мин сверх плана/);
await waitText(page, '#sal-hours-totals', /переработка к оплате: 47 мин$/);
await page.click(`#sal-hours-list [data-date="${editDay}"] button`);
await waitVisible(page, '#sal-he');
await page.click('#sal-he-plan-btn');
await waitValue(page, '#sal-he-from', '09:00'); await waitValue(page, '#sal-he-to', '18:00');
await page.click('#sal-he-save'); await waitVisible(page, '#sal-he', false);
await waitText(page, `#sal-hours-list [data-date="${editDay}"]`, /09:00–18:00, 8 ч/);
await eventually(() => evs('workday'), r => assert.equal(r.length, 2));
await page.click(`#sal-hours-list [data-date="${editDay}"] button`); await page.click('#sal-he-clear'); await page.click('#sal-he-save');
await eventually(() => evs('workday'), r => assert.equal(r.length, 1), 6000);

// настройки: коэффициент ×3, ступень «первые минуты», округление, проверка ввода
await page.click('#sal-tab-settings');
await page.fill('#sal-s-otmult', '3'); await page.click('#sal-s-save'); await waitToast(page, /Настройки зарплаты сохранены/);
await page.click('#sal-tab-calc');
await waitText(page, '#sal-ot-line', /Каждая минута ×3\. Итого 2\s350\s₽\./);
await page.click('#sal-tab-settings');
await page.fill('#sal-s-otmult', '2'); await page.fill('#sal-s-ot1min', '30'); await page.fill('#sal-s-ot1mult', '1,5'); await page.click('#sal-s-save');
await page.click('#sal-tab-calc');
await waitText(page, '#sal-ot-line', /Первые 30 мин ×1,5, остальные 17 мин ×2\. Итого 1\s316,67\s₽\./);
await page.click('#sal-tab-settings');
await page.fill('#sal-s-ot1min', ''); await page.selectOption('#sal-s-otround', 'd15'); await page.click('#sal-s-save');
await page.click('#sal-tab-calc');
await waitText(page, '#sal-ot-line', /: 45 мин\. Каждая минута ×2\. Итого 1\s500\s₽\./);
await page.click('#sal-tab-settings');
await page.selectOption('#sal-s-otround', 'min'); await page.fill('#sal-s-taxrate', '150'); await page.click('#sal-s-save');
await waitText(page, '#sal-s-err', /Процент не больше 100/);
assert.equal((await evs('paycfg'))[0].payload.tax.rateBp, 1300, 'неверный ввод не сохраняется');
await page.fill('#sal-s-taxrate', '13');
await page.selectOption('#sal-s-taxpreset', 'ru');                                           // пример шкалы: таблица ступеней
await waitCount(page, '#sal-s-brackets .work-br', 5);
await waitText(page, '#sal-s-taxnow', /Шкала из 5 ступеней, пороги за год/);
assert.match(await page.textContent('#sal-s-tax'), /пример, проверь актуальные ставки/);
await page.selectOption('#sal-s-taxpreset', 'flat'); await page.click('#sal-s-save'); await waitToast(page, /Настройки зарплаты сохранены/);
await page.click('#sal-tab-calc');
await waitText(page, '#sal-net', /^140\s563\s₽$/);

// запись дохода через money.js, итог месяца, разовая премия
await page.click('#sal-income');
await waitToast(page, /Записано в доходы: 140\s563\s₽/);
const inc = await eventually(() => evs('income'), r => assert.equal(r.length, 1));
assert.deepEqual([inc[0].payload.amountMinor, inc[0].payload.category, inc[0].payload.date], [14_056_300, 'Зарплата', today]);
await waitText(page, '#sal-income', 'Записать как доход ещё раз');
await page.fill('#sal-actual', '140000'); await page.click('#sal-close-save');
await waitText(page, '#sal-compare', /Расчёт был 140\s563\s₽, пришло 140\s000\s₽: меньше на 563\s₽\./);
await page.fill('#sal-x-name', 'Премия'); await page.fill('#sal-x-amt', '10000'); await page.click('#sal-x-add');
await waitText(page, '#sal-net', /^149\s263\s₽$/);                                           // +10 000 до налога = +8 700 на руки
await page.click('#sal-x-list button');
await waitText(page, '#sal-net', /^140\s563\s₽$/);
const pms = await evs('paymonth'); assert.equal(pms.length, 1); assert.equal(pms[0].payload.actualNetMinor, 14_000_000);
await tab(page, 'salary'); await page.fill('#sal-buy-amt', '8000'); await waitText(page, '#sal-buy-out', /Это около \d+ ч .*мин работы.*ставка на руки около/);          // покупка в часах работы
await page.fill('#sal-buy-amt', 'abc'); await waitText(page, '#sal-buy-out', /Введи цену числом/); await page.fill('#sal-buy-amt', '');
await tab(page, 'money'); await page.click('#kind-income');
await waitText(page, '#exp-list', /\+140\s563\s₽/);

// аналитика: выводы, сравнение месяцев, «а что если»
await tab(page, 'salary'); await page.click('#sal-tab-analytics');
await waitText(page, '#sal-insights', /Переработки дали 1 % дохода: 1\s566,67\s₽ из 161\s566,67\s₽ до налога \(47 мин\)/);
await waitText(page, '#sal-insights', /пришло 140\s000\s₽: меньше на 563\s₽ \(0 %\)/);
await waitCount(page, '#sal-bars li', 6);
await page.evaluate(() => { const r = document.getElementById('sal-wi-ot'); r.value = '1'; r.dispatchEvent(new Event('input', { bubbles: true })); });
await waitText(page, '#sal-wi-out', /На руки около 142\s303\s₽ вместо 140\s563\s₽: больше на 1\s740\s₽\./);
assert.match(await page.textContent('#sal-an-body'), /приблизительный/);

// ---------- рабочий таймер под управляемым временем ----------
await tab(page, 'schedule');
await page.clock.install({ time: new Date() });
{ const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(now + 1000); }
await waitVisible(page, '#sch-timer-start');
await page.click('#sch-timer-start');
await waitText(page, '#sch-elapsed', 'Прошло: 0 мин');
await page.clock.runFor(95 * 60000);
await waitText(page, '#sch-elapsed', 'Прошло: 1 ч 35 мин');
await page.click('#sch-timer-stop');
await waitToast(page, /Записано: (35 мин|1 ч 35 мин)/);                                       // у рабочего дня вычитается часовой перерыв
await waitVisible(page, '#sch-timer-done');
const wd = (await eventually(() => evs('workday'), r => assert.equal(r.filter(e => e.id === `wd:${today}`).length, 1))).find(e => e.id === `wd:${today}`);
const [h1, m1] = wd.payload.actual.from.split(':').map(Number), [h2, m2] = wd.payload.actual.to.split(':').map(Number);
assert.equal(((h2 * 60 + m2) - (h1 * 60 + m1) + 1440) % 1440, 95, 'таймер записал 95 минут');
await page.clock.resume();

// ---------- доступность (axe) на экранах с данными: второй контекст без CSP, чтобы подключить axe; те же данные кладём напрямую ----------
{
  const AXE = fs.readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
  const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  const ZERO = new Set(['heading-order', 'label', 'select-name', 'button-name', 'link-name', 'aria-required-parent', 'aria-required-children', 'aria-allowed-role', 'aria-allowed-attr', 'duplicate-id', 'duplicate-id-aria', 'list', 'listitem', 'nested-interactive', 'label-content-name-mismatch', 'aria-valid-attr-value']);
  const ctx2 = await t.browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', bypassCSP: true });
  const p2 = await ctx2.newPage();
  await p2.goto(t.url); await appReady(p2);
  await p2.evaluate(async () => {
    const S = await import('./store.js'), W = await import('./schedule.js'), P = await import('./salary.js'), E = await import('./events.js'), d = n => E.addDays(E.todayStr(), n);
    const pay = P.normalizePay({ baseMinor: 16_000_000, allowances: [{ name: 'Проезд', amountMinor: 100_000, taxable: false }], deductions: [{ name: 'Профсоюз', pctBp: 100, when: 'after' }], advance: { day: 25, pct: 40 }, salaryDay: 10 });
    await S.saveMany([W.makeWorkcfg(W.cfgFromTemplate('w52', d(0))), P.makePaycfg(pay, null), W.makeWorkday({ date: d(-3), kind: 'work', shift: 'd', actual: { from: '09:00', to: '18:47' } }), W.makeWorkday({ date: d(2), kind: 'vacation' }), W.makeWorkday({ date: d(3), kind: 'sick' })]);
  });
  const found = [];
  const axeRun = async label => {
    await p2.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60)))));      // уровни заголовков (aria-level) выставляются на следующем кадре: ждём его, иначе на медленном CI ловим гонку
    if (!(await p2.evaluate(() => typeof window.axe !== 'undefined'))) await p2.addScriptTag({ content: AXE });
    const run = () => p2.evaluate(async tags => (await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => `${n.target.join(' ')} :: ${n.html.replace(/\s+/g, ' ').slice(0, 110)}`) })), TAGS);
    let res = await run();
    if (res.some(v => v.id === 'color-contrast')) { await p2.waitForTimeout(400); res = res.filter(v => v.id !== 'color-contrast').concat((await run()).filter(v => v.id === 'color-contrast')); }
    for (const v of res) found.push({ label, ...v });
  };
  const openAll = sel => p2.evaluate(s => { for (const d of document.querySelectorAll(`${s} details`)) d.open = true; }, sel);
  for (const theme of ['light', 'dark']) {
    await p2.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await settleTheme(p2, theme);
    await tab(p2, 'schedule'); await waitCount(p2, '#sch-grid .cal-day', { min: 28 }); await openAll('#view-schedule'); await axeRun(`${theme} / график`);
    await p2.click(`#sch-d-${today}`); await waitVisible(p2, '#sch-day'); await axeRun(`${theme} / окно дня`); await p2.click('#sch-day-close'); await waitVisible(p2, '#sch-day', false);
    await p2.click('#sch-wiz-open'); await waitVisible(p2, '#sch-wiz'); await axeRun(`${theme} / мастер графика`); await p2.click('#sch-wiz-close'); await waitVisible(p2, '#sch-wiz', false);
    await tab(p2, 'salary');
    for (const k of ['calc', 'hours', 'settings', 'analytics']) {
      await p2.click(`#sal-tab-${k}`); await p2.waitForTimeout(150);
      if (k === 'settings') await openAll('#view-salary');
      await axeRun(`${theme} / зарплата: ${k}`);
    }
  }
  const bad = found.filter(f => f.impact === 'serious' || f.impact === 'critical' || ZERO.has(f.id));
  for (const f of found.filter(f => !bad.includes(f))) console.log(`axe (не блокирует) ${f.label}: ${f.id} [${f.impact}] ${f.nodes.slice(0, 2).join(' | ')}`);
  assert.deepEqual(bad.map(f => `${f.label}: ${f.id} [${f.impact}] ${f.nodes.slice(0, 3).join(' | ')}`), [], 'доступность: нарушения на экранах «График» и «Зарплата»');
  await ctx2.close();
}

// ---------- узкий экран и крупный шрифт: ничего не вылезает за край ----------
const overflow = () => page.evaluate(() => {
  const vw = innerWidth, bad = [];
  if (document.documentElement.scrollWidth > vw) bad.push(`страница шире экрана ${document.documentElement.scrollWidth} > ${vw}`);
  const scope = [...document.querySelectorAll('#view > section:not([hidden]) *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.closest('[hidden],svg,.sr-only,select'); });
  for (const e of scope) { const r = e.getBoundingClientRect(); if (r.right > vw + 0.5 || r.left < -0.5) bad.push(`за краем: ${e.tagName}#${e.id}.${e.className} «${(e.textContent || '').trim().slice(0, 24)}»`); }
  for (const d of document.querySelectorAll('.overlay:not([hidden])')) if (d.scrollWidth > d.clientWidth + 1) bad.push(`окно шире экрана ${d.id}`);
  for (const l of document.querySelectorAll('#sch-grid .cal-day .cal-l, #sch-grid .cal-day .cal-n')) if (l.scrollWidth > l.clientWidth + 1 && l.clientWidth) bad.push(`подпись дня не помещается: ${l.textContent}`);
  return bad;
});
for (const fs of [1, 1.3]) {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(f => document.documentElement.style.setProperty('--fs', String(f)), fs);
  const where = `320 px, шрифт ${fs * 100} %`;
  await tab(page, 'schedule'); await page.evaluate(() => { for (const d of document.querySelectorAll('#view-schedule details')) d.open = true; });
  assert.deepEqual(await overflow(), [], `${where}: график`);
  await page.click(`#sch-d-${otDay}`); await waitVisible(page, '#sch-day');
  assert.deepEqual(await overflow(), [], `${where}: окно дня`);
  await page.click('#sch-day-close'); await waitVisible(page, '#sch-day', false);
  await page.click('#sch-wiz-open'); await waitVisible(page, '#sch-wiz');
  assert.deepEqual(await overflow(), [], `${where}: мастер графика`);
  await page.click('#sch-wiz-close'); await waitVisible(page, '#sch-wiz', false);
  await tab(page, 'salary');
  for (const k of ['calc', 'hours', 'settings', 'analytics']) {
    await page.click(`#sal-tab-${k}`);
    if (k === 'settings') await page.evaluate(() => { for (const d of document.querySelectorAll('#view-salary details')) d.open = true; });
    assert.deepEqual(await overflow(), [], `${where}: зарплата / ${k}`);
  }
}

const real = errors.filter(x => !/Failed to load resource/.test(x));
assert.deepEqual(real, [], `нет ошибок в консоли:\n${real.join('\n')}`);
await t.close();
console.log('E2E WORK OK');
