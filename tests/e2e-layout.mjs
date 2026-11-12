// Устойчивость вёрстки: узкий экран 320×640 и крупный шрифт 130 % (настройка lifeos.prefs.v1 задаётся до загрузки страницы), КАЖДЫЙ экран приложения
// (список берётся из работающего приложения) в обычном и «раскрытом» виде, с длинными словами и большими суммами в данных.
// Проверяется: нет горизонтальной прокрутки страницы, ничего не вылезает за правый (и левый) край, подписи нижней панели помещаются,
// последнее содержимое можно прокрутить выше парящей панели, текст не налезает на соседей, окна поверх экрана не шире экрана.
import assert from 'node:assert/strict';
import { launch, tab, until } from './helpers.mjs';
import { seedDemo } from './seed.mjs';

// Данные «на разрыв»: слова без пробелов, длинные названия, большие суммы.
async function seedStress(page) {
  await page.evaluate(async () => {
    const s = await import('./store.js'); const E = await import('./events.js'); const H = await import('./habits.js');
    const M = await import('./money.js'); const N = await import('./notes.js');
    const today = E.todayStr(); const now = Date.now();
    const word = 'Сверхдлинноеслововбезединогопробеладляпроверкипереносатекстаивлезаниявкарточку';
    const evs = [
      E.makeProfile('Александра-Мария Константиновна Святополк-Четвертинская', now + 50, null, { avatar: '', color: 'amber', motto: word }),
      E.makeTask(word, now + 1, { due: today }),
      E.makeTask('Купить хлеб, молоко и всё остальное, что обычно забывают купить по дороге домой с работы в пятницу вечером', now + 2, { due: today }),
      H.makeHabit({ name: 'Ежедневная вечерняя растяжка всего тела перед сном ' + word, minimum: word, full: 'двадцать минут подряд без телефона' }, now + 3),
      M.makeExpense({ amount: '123456789', category: 'Категория-' + word, note: word, date: today }, now + 4),
      M.makeIncome({ amount: '9999999', category: 'Зарплата', date: today }, now + 5),
      N.makeNote(word + '\n' + word + ' https://example.org/очень/длинная/ссылка/без/пробелов/и/переносов/1234567890', now + 6),
    ];
    await s.saveMany(evs);
  });
  await page.waitForTimeout(400);
}

// Всё, что страница должна выдержать на данном экране. Возвращает список проблем.
const measure = page => page.evaluate(() => {
  const vw = innerWidth, bad = [];
  const rect = e => e.getBoundingClientRect();
  const shown = e => { const r = rect(e); if (!r.width || !r.height) return false; for (let n = e; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
  const name = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '');
  const inScroller = e => { for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  if (document.documentElement.scrollWidth > vw) bad.push(`страница шире экрана: ${document.documentElement.scrollWidth} > ${vw}`);
  const pool = [...document.querySelectorAll('header.top, header.top *, #subnav, #subnav *, #view > section:not([hidden]), #view > section:not([hidden]) *, #tabs, #tabs *')];
  for (const e of pool) {
    if (!shown(e)) continue;
    const r = rect(e);
    if ((r.right > vw + 0.5 || r.left < -0.5) && !inScroller(e) && !e.closest('svg')) bad.push(`за краем экрана: ${name(e)} [${Math.round(r.left)}..${Math.round(r.right)}] «${(e.textContent || '').trim().slice(0, 30)}»`);
    const cs = getComputedStyle(e);
    if (e.children.length === 0 && e.textContent.trim() && e.tagName !== 'SUMMARY' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) && cs.overflowX === 'visible' && cs.display !== 'inline'
      && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 6) bad.push(`текст шире своей рамки: ${name(e)} ${e.scrollWidth}>${e.clientWidth} «${e.textContent.trim().slice(0, 30)}»`);
  }
  const tabs = document.getElementById('tabs');
  for (const b of tabs.children) { const l = b.querySelector('span'); if (l && l.scrollWidth > b.clientWidth + 1) bad.push(`подпись вкладки не помещается: «${l.textContent}» ${l.scrollWidth}>${b.clientWidth}`); }
  const tabsTop = rect(tabs).top;
  window.scrollTo(0, document.documentElement.scrollHeight);
  const view = [...document.querySelectorAll('#view > section')].find(x => !x.hidden);
  const kids = view ? [...view.children].filter(c => !c.hidden && rect(c).height > 0 && !c.classList.contains('overlay')) : [];
  const last = kids.at(-1);
  if (last && rect(last).bottom > tabsTop + 1) bad.push(`последнее содержимое под нижней панелью: ${name(last)} низ ${Math.round(rect(last).bottom)} > верх панели ${Math.round(tabsTop)}`);
  window.scrollTo(0, 0);
  return bad;
});
const expand = page => page.evaluate(() => {
  const v = [...document.querySelectorAll('#view > section')].find(x => !x.hidden);
  if (!v) return;
  for (const d of v.querySelectorAll('details')) d.open = true;
  for (const h of v.querySelectorAll('[hidden]')) if (!h.classList.contains('overlay')) h.hidden = false;
});

const CONFIGS = [{ w: 320, h: 640, fs: 1 }, { w: 320, h: 640, fs: 1.3 }, { w: 390, h: 844, fs: 1.3 }];
const problems = [];
for (const cfg of CONFIGS) {
  const t = await launch({ viewport: { width: cfg.w, height: cfg.h }, ctxOptions: { bypassCSP: true } });
  const p = t.page;
  p.on('dialog', d => d.accept());
  if (cfg.fs !== 1) await t.ctx.addInitScript(fs => { try { localStorage.setItem('lifeos.prefs.v1', JSON.stringify({ fontScale: fs })); } catch { /* не критично */ } }, cfg.fs);
  await p.goto(t.url);
  await until(p, () => !document.getElementById('app').hidden);
  assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim()), String(cfg.fs), 'масштаб шрифта применён');
  await seedDemo(p); await seedStress(p);

  const groups = await p.$$eval('#tabs button[data-tab]', bs => bs.map(b => b.dataset.tab));
  const screens = [];
  for (const g of groups) {
    await p.click(`#tabs button[data-tab="${g}"]`);
    const views = await p.$$eval('#subnav button[data-view]', bs => bs.map(b => b.dataset.view));
    if (views.length) screens.push(...views.map(view => ({ group: g, view }))); else screens.push({ group: g, view: null });
  }
  assert.ok(screens.length >= 15, `экранов: ${screens.length}`);
  for (const s of screens) {
    await p.click(`#tabs button[data-tab="${s.group}"]`);
    if (s.view) await p.click(`#subnav button[data-view="${s.view}"]`);
    await p.waitForTimeout(200);
    const where = `${cfg.w}×${cfg.h}, шрифт ${cfg.fs * 100}% / ${s.view ?? s.group}`;
    for (const m of await measure(p)) problems.push(`${where}: ${m}`);
    await expand(p);
    for (const m of await measure(p)) problems.push(`${where} (раскрыто): ${m}`);
  }

  // окна поверх экрана не шире экрана
  const overlayWidth = async (name) => {
    const w = await p.evaluate(() => { const d = [...document.querySelectorAll('.overlay')].find(x => !x.hidden); return d ? { sw: d.scrollWidth, cw: d.clientWidth } : null; });
    if (w && w.sw > w.cw + 1) problems.push(`${cfg.w}×${cfg.h}, шрифт ${cfg.fs * 100}% / окно «${name}»: шире экрана ${w.sw} > ${w.cw}`);
  };
  await tab(p, 'diary');
  await p.click('#fw-open'); await until(p, () => !document.getElementById('fw-host').hidden); await overlayWidth('Свободное письмо');
  await p.keyboard.press('Escape'); await until(p, () => document.getElementById('fw-host').hidden);
  await tab(p, 'learn');
  if (!(await p.$('#learn-start'))) await p.click('.track-card[data-track="english"]');
  await p.click((await p.$('#learn-start')) ? '#learn-start' : '#track-start');
  await until(p, () => !document.getElementById('sess').hidden && !!document.getElementById('sess-show'));
  await overlayWidth('Повторение');
  await p.click('#sess-show'); await overlayWidth('Повторение (ответ)');
  await p.keyboard.press('Escape'); await until(p, () => document.getElementById('sess').hidden);

  const errs = t.errors.filter(e => !/Failed to load resource/.test(e));
  assert.deepEqual(errs, [], 'нет ошибок в консоли:\n' + errs.join('\n'));
  await t.close();
}
assert.deepEqual(problems, [], `\nПроблемы вёрстки (${problems.length}):\n${[...new Set(problems)].slice(0, 60).join('\n')}`);
console.log('E2E LAYOUT OK');
