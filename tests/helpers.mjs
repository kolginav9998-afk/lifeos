// Общие помощники для браузерных тестов: собирает веб-версию (с CSP), поднимает сервер, открывает Chromium.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const { chromium } = createRequire(import.meta.url)('playwright');
export const root = path.resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };

// ---------- режим нагрузки: поиск «гонок» (облачный CI медленнее этой машины) ----------
// E2E_STRESS=1 (то же, что cpu:4,idb:60) или E2E_STRESS=cpu:6,idb:100 node tests/e2e-<имя>.mjs
//  cpu — во сколько раз замедлить JS страницы (CDP Emulation.setCPUThrottlingRate);
//  idb — средняя задержка (мс) перед завершением каждой транзакции IndexedDB: запись доходит до экрана позже, как на слабом телефоне.
// Тест, который читает страницу сразу после события, не дождавшись перерисовки, в этом режиме падает почти всегда.
// Все ожидания (until, wait*, eventually) растягиваются во столько же раз, во сколько замедлен процессор.
function parseStress(v) {
  if (!v || v === '0' || v === 'off') return null;
  const s = { cpu: 4, idb: 60 };
  if (v !== '1' && v !== 'on') for (const part of v.split(',')) { const [k, n] = part.split(':'); if (k in s && Number(n) >= 0) s[k] = Number(n); }
  return s;
}
export const STRESS = parseStress(process.env.E2E_STRESS);
const SCALE = STRESS ? Math.max(1, STRESS.cpu) : 1;
const slowIdb = ms => {                                           // выполняется в странице (init-скрипт): откладывает oncomplete транзакций
  const d = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
  if (!d || !d.set) return;
  const later = window.setTimeout.bind(window), clock = performance.now.bind(performance);     // настоящие таймер и часы: page.clock.install подменяет их в странице, а задержка записи должна идти по реальному времени
  const queue = [];                                                // IndexedDB сообщает о завершении транзакций строго по порядку; задержка этот порядок не меняет
  let last = 0, timer = 0;
  const pump = () => {
    timer = 0;
    while (queue.length && queue[0].due <= clock()) { try { queue.shift().run(); } catch (err) { later(() => { throw err; }, 0); } }
    if (queue.length) timer = later(pump, Math.max(1, queue[0].due - clock()));
  };
  Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
    configurable: true, enumerable: d.enumerable, get: d.get,
    set(fn) {
      d.set.call(this, typeof fn === 'function' ? function (e) {
        last = Math.max(clock() + ms * (0.4 + Math.random() * 1.2), last);
        queue.push({ due: last, run: () => fn.call(this, e) });
        if (!timer) timer = later(pump, Math.max(1, last - clock()));
      } : fn);
    },
  });
};
async function armStress(ctx) {
  if (STRESS.idb) await ctx.addInitScript(slowIdb, STRESS.idb);
  const throttle = async p => { try { await (await ctx.newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: STRESS.cpu }); } catch { /* страница уже закрыта */ } };
  ctx.on('page', throttle);
  for (const p of ctx.pages()) await throttle(p);
}

// Для автотестов вход в аккаунт по умолчанию не требуется (LIFEOS_REQUIRE_ACCOUNT=0); тест входа включает его обратно.
export function build(target = 'web', env = {}) { execFileSync('bash', ['scripts/build-web.sh', target], { cwd: root, stdio: 'pipe', env: { ...process.env, LIFEOS_REQUIRE_ACCOUNT: '0', ...env } }); }

export async function launch({ viewport = { width: 390, height: 844 }, ctxOptions = {}, buildEnv = {} } = {}) {
  build('web', buildEnv);
  const dir = path.join(root, 'dist');
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const p = path.join(dir, u === '/' ? 'index.html' : u);
    if (!p.startsWith(dir)) { res.writeHead(403); return res.end(); }
    fs.readFile(p, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
      res.end(buf);
    });
  }).listen(0);
  const url = `http://localhost:${server.address().port}/`;
  // В облачной сборке, если браузер Playwright не поставился, тесты идут на Google Chrome, уже стоящем на машине (PW_CHROMIUM_PATH).
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  if (STRESS) {                                                     // каждый контекст, созданный тестом (в том числе «второе устройство»), тоже под нагрузкой
    console.log(`[E2E_STRESS] cpu ×${STRESS.cpu}, IndexedDB +${STRESS.idb} мс`);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...a) => { const c = await newContext(...a); await armStress(c); return c; };
  }
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, locale: 'ru-RU', ...ctxOptions });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  return { url, browser, ctx, page, errors, close: async () => { await browser.close(); server.close(); } };
}

export const ymd = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// Нижняя панель — группы вкладок; экраны внутри группы переключаются второй строкой.
const GROUP_OF = { today: 'today', habits: 'today', people: 'today', diary: 'diary', health: 'diary', workouts: 'diary', notes: 'diary', reflect: 'diary', learn: 'grow', skills: 'grow', tests: 'grow', insights: 'grow', okr: 'grow', money: 'money', plans: 'money', more: 'more', account: 'more', help: 'more' };
const FIRST_OF = { today: 'today', diary: 'diary', grow: 'learn', money: 'money', more: 'more' };
export async function tab(page, id) {
  const g = GROUP_OF[id] ?? id;
  await page.click(`#tabs button[data-tab="${g}"]`);
  if (id !== FIRST_OF[g] && id !== g) await page.click(`#subnav button[data-view="${id}"]`);
}

// ---------- ожидания ----------
// Правило для тестов: прочитанное сразу после события (клик, ввод, перезагрузка) может быть ещё старым, потому что запись в IndexedDB
// и перерисовка экрана идут позже события. Поэтому проверка значения, которое меняет приложение, идёт через wait*: они опрашивают
// страницу (waitForFunction), пока значение не станет нужным, а если не станет, падают с понятным «сейчас на странице: …».
// Это те же проверки, что assert, только с ожиданием.

// Ждать, пока выполнится условие в странице.
// ВАЖНО: page.waitForFunction НЕ дожидается Promise, который вернуло условие: Promise всегда «истинный», и ожидание заканчивается сразу.
// Поэтому условие с await, import() или .then() (оно возвращает Promise) проверяется опросом со стороны теста (page.evaluate ждёт Promise по-настоящему);
// обычное условие опрашивается внутри страницы на каждом кадре. Исключение внутри асинхронного условия значит «ещё не готово».
const asksPromise = fn => typeof fn === 'function' && (fn.constructor?.name === 'AsyncFunction' || /\bawait\b|\bimport\s*\(|\.then\s*\(/.test(String(fn)));
export function until(page, fn, arg, timeout = 5000) {
  return asksPromise(fn) ? pollEvaluate(page, fn, arg, timeout) : page.waitForFunction(fn, arg, { timeout: timeout * SCALE });
}
async function pollEvaluate(page, fn, arg, timeout) {
  const ms = timeout * SCALE, end = Date.now() + ms;
  let last = '(условие ни разу не вернуло значение)';
  for (;;) {
    try { const v = await page.evaluate(fn, arg); if (v) return v; last = `условие вернуло ${JSON.stringify(v)}`; }
    catch (e) { if (/has been closed|Target closed/.test(e.message)) throw e; last = String(e.message).split('\n')[0]; }
    if (Date.now() >= end) throw new Error(`until: за ${ms} мс не дождались; ${last}\nусловие: ${String(fn).slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 40));
  }
}

// Общая часть: pred возвращает false или { v: найденное значение }; probe читает, что сейчас на странице, для сообщения об ошибке.
async function waitFn(page, what, pred, arg, probe, timeout) {
  const ms = timeout * SCALE;
  try {
    const h = await page.waitForFunction(pred, arg, { timeout: ms });
    const r = await h.jsonValue(); await h.dispose();
    return r.v;
  } catch (e) {
    if (!/Timeout/.test(e.message)) throw e;                      // закрытая страница и т. п. — как есть
    let seen; try { seen = await page.evaluate(probe, arg); } catch { seen = '(не удалось прочитать)'; }
    throw new Error(`${what}: за ${ms} мс не дождались; сейчас на странице: ${JSON.stringify(seen)}`, { cause: e });
  }
}
const matcher = x => (x instanceof RegExp ? { re: x.source, flags: x.flags } : { str: String(x) });

// Текст элемента: строка — совпадение целиком (без пробелов по краям), RegExp — поиск. Возвращает найденный текст.
export const waitText = (page, selector, expected, timeout = 5000) => waitFn(page, `waitText(${selector}, ${expected})`,
  a => { const n = document.querySelector(a.selector); if (!n) return false; const t = n.textContent; return (a.m.re !== undefined ? new RegExp(a.m.re, a.m.flags).test(t) : t.trim() === a.m.str) ? { v: t } : false; },
  { selector, m: matcher(expected) }, a => document.querySelector(a.selector)?.textContent ?? '(элемента нет)', timeout);

// Значение поля ввода (input, textarea, select).
export const waitValue = (page, selector, expected, timeout = 5000) => waitFn(page, `waitValue(${selector}, ${expected})`,
  a => { const n = document.querySelector(a.selector); if (!n) return false; const t = n.value; return (a.m.re !== undefined ? new RegExp(a.m.re, a.m.flags).test(t) : t === a.m.str) ? { v: t } : false; },
  { selector, m: matcher(expected) }, a => { const n = document.querySelector(a.selector); return n ? n.value : '(элемента нет)'; }, timeout);

// Флажок: отмечен или нет.
export const waitChecked = (page, selector, checked = true, timeout = 5000) => waitFn(page, `waitChecked(${selector}, ${checked})`,
  a => { const n = document.querySelector(a.selector); return n && n.checked === a.checked ? { v: n.checked } : false; },
  { selector, checked: Boolean(checked) }, a => { const n = document.querySelector(a.selector); return n ? `checked=${n.checked}` : '(элемента нет)'; }, timeout);

// Число элементов: число — точно столько, { min, max } — в пределах (любой предел можно опустить).
export const waitCount = (page, selector, n, timeout = 5000) => waitFn(page, `waitCount(${selector}, ${JSON.stringify(n)})`,
  a => { const c = document.querySelectorAll(a.selector).length; return c >= a.min && (a.max === null || c <= a.max) ? { v: c } : false; },
  { selector, min: typeof n === 'number' ? n : n.min ?? 0, max: typeof n === 'number' ? n : n.max ?? null }, a => document.querySelectorAll(a.selector).length, timeout);

// Атрибут элемента (null — атрибута нет): строка, RegExp или null.
export const waitAttr = (page, selector, name, expected, timeout = 5000) => waitFn(page, `waitAttr(${selector}, ${name}, ${expected})`,
  a => { const n = document.querySelector(a.selector); if (!n) return false; const t = n.getAttribute(a.name); const ok = a.m === null ? t === null : t !== null && (a.m.re !== undefined ? new RegExp(a.m.re, a.m.flags).test(t) : t === a.m.str); return ok ? { v: t } : false; },
  { selector, name, m: expected === null ? null : matcher(expected) }, a => { const n = document.querySelector(a.selector); return n ? n.getAttribute(a.name) : '(элемента нет)'; }, timeout);

// Элемент показан или скрыт (скрыт — в том числе если его нет на странице).
export async function waitVisible(page, selector, visible = true, timeout = 5000) {
  const ms = timeout * SCALE;
  try { await page.locator(selector).first().waitFor({ state: visible ? 'visible' : 'hidden', timeout: ms }); }
  catch (e) { throw new Error(`waitVisible(${selector}, ${visible}): за ${ms} мс не дождались`, { cause: e }); }
}

// Всплывающее сообщение: показано сейчас и текст подходит. Спрятанное сообщение хранит старый текст, поэтому одного текста мало.
export const waitToast = (page, expected, timeout = 5000) => waitFn(page, `waitToast(${expected})`,
  a => { const n = document.getElementById('toast'); if (!n || n.hidden) return false; const t = n.textContent; return (a.m.re !== undefined ? new RegExp(a.m.re, a.m.flags).test(t) : t.includes(a.m.str)) ? { v: t } : false; },
  { m: matcher(expected) }, () => { const n = document.getElementById('toast'); return n ? `${n.hidden ? '[скрыто] ' : ''}${n.textContent}` : '(нет окна сообщений)'; }, timeout);
// Убрать сообщение перед действием, чтобы следующее waitToast увидело новое, а не оставшееся от прошлого шага.
export const clearToast = page => page.evaluate(() => { const n = document.getElementById('toast'); if (n) { n.hidden = true; n.replaceChildren(); } });

// Приложение открыто И записи уже загружены из хранилища (интерфейс показывается раньше данных: после перезагрузки проверки списков без этого гоняются).
export const appReady = (page, timeout = 15000) => until(page, async () => !document.getElementById('app').hidden && (await import('./perf.js')).startup().data !== null, null, timeout);

// Повторять «прочитать → проверить», пока проверка (assert) не пройдёт или не выйдет время; потом вернуть последнее прочитанное.
// Для значений, которых нет в DOM: записи в store, содержимое IndexedDB, localStorage. Проверка остаётся обычным assert.
export async function eventually(read, check, timeout = 5000) {
  const end = Date.now() + timeout * SCALE;
  for (;;) {
    try { const v = await read(); check(v); return v; }
    catch (e) {
      const again = e instanceof assert.AssertionError || /Execution context was destroyed|Cannot find context/.test(e?.message ?? '');
      if (!again || Date.now() >= end) throw e;
      await new Promise(r => setTimeout(r, 60));
    }
  }
}

// Повторить действие целиком, если перерисовка экрана «съела» его на полпути (например, закрыла только что раскрытый блок). Ошибка последней попытки уходит наружу.
export async function retry(fn, timeout = 8000) {
  const end = Date.now() + timeout * SCALE;
  for (;;) {
    try { return await fn(); }
    catch (e) { if (Date.now() >= end) throw e; await new Promise(r => setTimeout(r, 100)); }
  }
}

// Прочитать «сырые» данные из IndexedDB и localStorage — то, что реально лежит на диске.
export async function rawDisk(page) {
  return page.evaluate(async () => {
    const idb = await new Promise(res => {
      const rq = indexedDB.open('lifeos', 1);
      rq.onsuccess = () => { const db = rq.result; const r = db.transaction('events').objectStore('events').getAll(); r.onsuccess = () => { db.close(); res(r.result); }; r.onerror = () => res(null); };
      rq.onerror = () => res(null);
    });
    return { idb, ls: localStorage.getItem('lifeos.events.v1'), all: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])) };
  });
}

// Второе (третье…) «устройство»: отдельный контекст браузера = отдельное хранилище, тот же сайт.
export async function newDevice(t, { viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await t.browser.newContext({ viewport, acceptDownloads: true, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(t.url);
  await page.waitForFunction(() => !document.getElementById('app').hidden || !document.getElementById('lock').hidden || !document.getElementById('gate').hidden, null, { timeout: 5000 * SCALE });
  return { ctx, page, errors };
}
