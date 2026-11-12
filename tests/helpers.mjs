// Общие помощники для браузерных тестов: собирает веб-версию (с CSP), поднимает сервер, открывает Chromium.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const { chromium } = createRequire(import.meta.url)('playwright');
export const root = path.resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };

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

// Ждать, пока выполнится условие в странице (с понятной ошибкой).
export const until = (page, fn, arg, timeout = 5000) => page.waitForFunction(fn, arg, { timeout });

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
  await page.waitForFunction(() => !document.getElementById('app').hidden || !document.getElementById('lock').hidden || !document.getElementById('gate').hidden);
  return { ctx, page, errors };
}
