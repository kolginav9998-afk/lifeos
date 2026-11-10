// Общие помощники для браузерных тестов: собирает веб-версию (с CSP), поднимает сервер, открывает Chromium.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const { chromium } = createRequire(import.meta.url)('playwright');
export const root = path.resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };

export function build(target = 'web') { execFileSync('bash', ['scripts/build-web.sh', target], { cwd: root, stdio: 'pipe' }); }

export async function launch({ viewport = { width: 390, height: 844 }, ctxOptions = {} } = {}) {
  build('web');
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
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, locale: 'ru-RU', ...ctxOptions });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  return { url, browser, ctx, page, errors, close: async () => { await browser.close(); server.close(); } };
}

export const ymd = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const tab = (page, id) => page.click(`#tabs button[data-tab="${id}"]`);

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
