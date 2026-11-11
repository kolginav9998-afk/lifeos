// Обновление изнутри: проверка версии, кнопка «Обновить», разрешение на установку, ошибки. Нативный плагин и GitHub подменены.
import assert from 'node:assert/strict';
import { launch, tab, until } from './helpers.mjs';
import { VERSION } from '../version.js';
import { APK_LINK } from '../updater.js';

const t = await launch({ buildEnv: { LIFEOS_CSP_CONNECT: 'https://api.github.com' } });
const p = t.page;

// «Android-приложение»: подставляем Capacitor и плагин ApkInstaller до загрузки страницы.
await p.addInitScript(() => {
  const listeners = {};
  window.__apk = { calls: [], canInstall: true, failDownload: false };
  const apk = window.__apk;
  const plugin = {
    info: async () => { apk.calls.push('info'); return { canInstall: apk.canInstall, versionName: 'test' }; },
    openInstallSettings: async () => { apk.calls.push('settings'); apk.canInstall = true; },        // «человек» разрешил установку
    addListener: async (name, fn) => { listeners[name] = fn; return { remove: () => { delete listeners[name]; apk.calls.push('unlisten'); } }; },
    download: async ({ url }) => {
      apk.calls.push('download:' + url);
      if (apk.failDownload) throw new Error('Сервер ответил кодом 404');
      for (const r of [250, 500, 1000]) { listeners.progress?.({ received: r, total: 1000 }); await new Promise(res => setTimeout(res, 60)); }
      return { path: '/cache/updates/update.apk', size: 1000, sha256: 'ab'.repeat(32) };
    },
    install: async ({ path }) => { apk.calls.push('install:' + path); return { started: true, needsPermission: false }; },
    cancel: async () => { apk.calls.push('cancel'); },
  };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { ApkInstaller: plugin }, registerPlugin: n => window.Capacitor.Plugins[n] };
});

const asset = { name: 'lifeos.apk', size: 1000, browser_download_url: APK_LINK, digest: 'sha256:' + 'ab'.repeat(32) };
const release = version => ({ body: `<!-- lifeos-update ${JSON.stringify({ version, notes: ['Новое первое', 'Новое второе'] })} -->\nАвтосборка`, assets: [asset] });
let reply = { status: 200, json: release('R3.99') };
let asked = 0;
await p.route('https://api.github.com/**', route => { asked++; route.fulfill({ status: reply.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply.json ?? {}) }); });

await p.goto(t.url);
await until(p, () => !document.getElementById('app').hidden);

// ===== при запуске приложение само узнаёт о новой версии и говорит об этом один раз =====
await until(p, () => /Доступна новая версия R3\.99/.test(document.getElementById('toast').textContent), null, 10000);
assert.equal(asked, 1);
await p.click('#toast button');
assert.equal(await p.textContent('#title'), 'Профиль');
await until(p, () => document.getElementById('upd-go'));
assert.match(await p.textContent('#upd-status'), /Доступна новая версия R3\.99 \(1 КБ\)/);
assert.match(await p.textContent('#upd-card'), /Новое первое[\s\S]*Новое второе/);
assert.match(await p.textContent('#upd-version'), new RegExp(`${VERSION.replaceAll('.', '\\.')}.*Android-приложение`));

// ===== нет разрешения на установку: открываются настройки, скачивания ещё нет =====
await p.evaluate(() => { window.__apk.canInstall = false; });
await p.click('#upd-go');
await until(p, () => /Разреши установку/.test(document.getElementById('upd-status').textContent));
let calls = await p.evaluate(() => window.__apk.calls);
assert.ok(calls.includes('settings') && !calls.some(c => c.startsWith('download')), calls.join());

// ===== разрешил: скачивание с прогрессом и открытие установщика =====
await p.click('#upd-go');
await until(p, () => /Откроется окно Android/.test(document.getElementById('upd-status').textContent), null, 10000);
calls = await p.evaluate(() => window.__apk.calls);
assert.ok(calls.includes('download:' + APK_LINK), 'скачивается файл из выпуска');
assert.ok(calls.includes('install:/cache/updates/update.apk'), 'открыт установщик');
assert.ok(calls.indexOf('unlisten') > calls.findIndex(c => c.startsWith('download')), 'подписка на прогресс снята');

// ===== ошибка загрузки: понятный текст, ссылка для ручной установки и повтор =====
await p.click('#upd-check');
await until(p, () => document.getElementById('upd-go'));
await p.evaluate(() => { window.__apk.failDownload = true; window.__apk.calls.length = 0; });
await p.click('#upd-go');
await until(p, () => /404/.test(document.getElementById('upd-status').textContent));
assert.equal(await p.getAttribute('#upd-link', 'href'), APK_LINK);
assert.equal(await p.getAttribute('#upd-link', 'target'), '_blank');
assert.equal(await p.evaluate(() => window.__apk.calls.some(c => c.startsWith('install'))), false, 'после ошибки установка не открывалась');
await p.evaluate(() => { window.__apk.failDownload = false; });
await p.click('#upd-go');
await until(p, () => /Откроется окно Android/.test(document.getElementById('upd-status').textContent), null, 10000);

// ===== последняя версия, ограничение GitHub, нет сети =====
reply = { status: 200, json: release(VERSION) };
await p.click('#upd-check');
await until(p, () => /Установлена последняя версия/.test(document.getElementById('upd-status').textContent));
assert.equal(await p.locator('#upd-go').count(), 0, 'кнопки «Обновить» нет, когда обновлять нечего');
reply = { status: 403, json: { message: 'rate limit' } };
await p.click('#upd-check');
await until(p, () => /ограничил запросы/.test(document.getElementById('upd-status').textContent));
reply = { status: 200, json: { body: 'не наш выпуск', assets: [] } };
await p.click('#upd-check');
await until(p, () => /не найдены/.test(document.getElementById('upd-status').textContent));
await p.unroute('https://api.github.com/**');
await p.route('https://api.github.com/**', route => route.abort());
await p.click('#upd-check');
await until(p, () => /Нет связи/.test(document.getElementById('upd-status').textContent));

// «что нового» — в той же карточке
await p.click('#upd-changes summary');
assert.match(await p.textContent('#upd-changes'), /Что нового в R3/);

const real = t.errors.filter(x => !/Failed to load resource|ERR_FAILED/.test(x));
assert.deepEqual(real, [], 'нет ошибок в консоли:\n' + real.join('\n'));
await t.close();
console.log('E2E UPDATE OK');
