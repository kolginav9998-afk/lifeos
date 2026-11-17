// Быстрый вход по отпечатку в настоящем браузере. «Android-приложение» подменено: Capacitor и плагин NativeBiometric подставлены до загрузки страницы,
// «хранилище телефона» лежит в localStorage под служебным ключом __fake_phone (переживает перезагрузку, как настоящее; приложение трогает только lifeos.*).
// Проверяем: включение в профиле, блокировка → кнопка → вход, отказ отпечатка → вход паролем, смену пароля, устаревший пароль, стирание данных,
// вход в аккаунт по отпечатку и сайт без плагина (там кнопки нет). Чужие нативные плагины (уведомления, файлы, «Поделиться», обновление) заменены заглушками.
import assert from 'node:assert/strict';
import { launch, tab, until, appReady, waitText, waitToast, clearToast, waitVisible } from './helpers.mjs';
import { createServer } from '../server/node/server.js';

const PW = 'длинная-надёжная-фраза', PW2 = 'совсем-другая-фраза-22', PW3 = 'третья-новая-фраза-333';
const SERVER_KEY = 'app.lifeos.mobile';

// Выполняется в странице до всех скриптов приложения.
function nativeInit() {
  const KEY = '__fake_phone';
  let phone = null;
  try { phone = JSON.parse(localStorage.getItem(KEY)); } catch { /* пусто */ }
  phone = Object.assign({ calls: [], creds: {}, finger: 'ok', enrolled: true, lastPrompt: null }, phone || {});
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(phone)); } catch { /* страница без хранилища */ } };
  const delay = ms => new Promise(r => setTimeout(r, ms));
  window.__phone = phone; window.__phoneSave = save;
  const bio = {
    async isAvailable() {
      phone.calls.push('available'); save();
      return phone.enrolled ? { isAvailable: true, strongBiometryIsAvailable: true, biometryType: 3, deviceIsSecure: true, authenticationStrength: 1 }
        : { isAvailable: false, errorCode: 3, deviceIsSecure: true, authenticationStrength: 0 };
    },
    async verifyIdentity(o) {
      phone.calls.push('verify'); phone.lastPrompt = o; save(); await delay(40);
      if (phone.finger !== 'ok') { const e = new Error('отказ ' + phone.finger); e.code = phone.finger; throw e; }
    },
    async setCredentials(o) { phone.calls.push('set'); phone.creds[o.server] = { username: o.username, password: o.password }; save(); },
    async getCredentials(o) { phone.calls.push('get'); save(); const v = phone.creds[o.server]; if (!v) throw new Error('No credentials found'); return { ...v }; },
    async deleteCredentials() { phone.calls.push('delete'); phone.creds = {}; save(); },
  };
  const none = async () => ({});
  window.Capacitor = { isNativePlatform: () => true, registerPlugin: n => window.Capacitor.Plugins[n], Plugins: {
    NativeBiometric: bio,
    LocalNotifications: { checkPermissions: async () => ({ display: 'denied' }), requestPermissions: async () => ({ display: 'denied' }), getPending: async () => ({ notifications: [] }), cancel: none, schedule: none },
    Filesystem: { writeFile: async () => ({ uri: 'file:///cache/test' }) }, Share: { share: none },
    ApkInstaller: { info: async () => ({ canInstall: false, versionName: 'test' }), addListener: async () => ({ remove() {} }), cancel: none },
  } };
  // «проверку обновлений» при запуске не запускаем: в тесте нет GitHub
  try { if (!localStorage.getItem('lifeos.prefs.v1')) localStorage.setItem('lifeos.prefs.v1', JSON.stringify({ updateCheckedAt: Date.now() })); } catch { /* не критично */ }
}

const phoneCalls = page => page.evaluate(() => window.__phone.calls.slice());
const count = async (page, what) => (await phoneCalls(page)).filter(c => c === what).length;
const setFinger = (page, finger) => page.evaluate(f => { window.__phone.finger = f; window.__phoneSave(); }, finger);
const waitCalls = (page, what, n, timeout = 10000) => until(page, ([w, k]) => window.__phone.calls.filter(c => c === w).length >= k, [what, n], timeout);
const pref = (page, k) => page.evaluate(key => { try { return JSON.parse(localStorage.getItem('lifeos.prefs.v1') || '{}')[key]; } catch { return undefined; } }, k);
const failsOnDisk = page => page.evaluate(() => localStorage.getItem('lifeos.vault.fails'));
const savedCreds = page => page.evaluate(k => window.__phone.creds[k] ?? null, SERVER_KEY);
const lockVisible = page => page.locator('#lock').isVisible();

async function enableProtection(page, pw = PW) {
  await tab(page, 'more');
  await page.fill('#pw1', pw); await page.fill('#pw2', pw); await page.check('#pw-ack');
  await page.click('#pw-enable');
  await until(page, () => document.getElementById('sec-status'), null, 20000);
}
// Профиль → карточка «Быстрый вход»: ждём ответа телефона (переключатель становится доступным)
async function openCard(page) {
  await tab(page, 'account');
  await until(page, () => { const s = document.getElementById('qu-switch'); return !!s && !s.disabled; }, null, 10000);
}
async function enableViaCard(page, pw = PW) {
  await openCard(page);
  await page.click('#qu-switch');
  await page.fill('#qu-pass', pw);
  await clearToast(page);
  await page.click('#qu-go');
}
async function unlockWithPassword(page, pw) { await page.fill('#lock-input', pw); await page.click('#lock-btn'); }
// «Вернулись в приложение»: событие видимости страницы (настоящее приложение получает его, когда его открывают из списка недавних)
async function backgroundAndBack(page) {
  await page.evaluate(() => {
    const set = h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); };
    set(true); set(false);
  });
}

// =====================================================================
// 1. Приложение: включение, блокировка, вход отпечатком, отказы, смена пароля
// =====================================================================
let t = await launch();
let page = t.page;
await page.addInitScript(nativeInit);
page.on('dialog', d => d.accept());
await page.goto(t.url);
await appReady(page);
await enableProtection(page);

// --- карточка: пока вход выключен
await openCard(page);
assert.equal(await page.textContent('#qu-card h3'), 'Быстрый вход');
assert.match(await page.textContent('#qu-state'), /Выключен/);
assert.equal(await page.locator('#qu-pass').count(), 0, 'пока галочки нет, пароль не спрашивают');

// --- включение: неверный пароль → отказ отпечатка → успех
await page.click('#qu-switch');
await page.fill('#qu-pass', 'неверный-пароль-12');
await page.click('#qu-go');
await waitText(page, '#qu-msg', 'Неверный пароль');
assert.equal(await count(page, 'verify'), 0, 'с неверным паролем окно отпечатка не открывается');
assert.equal(await savedCreds(page), null);

await setFinger(page, '16');                                      // человек нажал «Отмена» в окне отпечатка
await page.fill('#qu-pass', PW); await page.click('#qu-go');
await waitText(page, '#qu-msg', /Отпечаток не подтверждён/);
assert.equal(await savedCreds(page), null, 'без подтверждения отпечатком пароль не сохраняется');
assert.equal(await pref(page, 'quickUnlock'), false);

await setFinger(page, 'ok');
await page.fill('#qu-pass', PW); await clearToast(page);
await page.click('#qu-go');
await waitToast(page, /Вход по отпечатку включён/);
await waitText(page, '#qu-state', /Включён/);
assert.equal(await page.isChecked('#qu-switch'), true);
const saved = await savedCreds(page);
assert.ok(saved, 'пароль сохранён в «хранилище телефона»');
assert.ok(!saved.username.includes('владелец') && saved.username.length >= 16, 'в поле «логин» плагина случайная строка');
assert.deepEqual(JSON.parse(saved.password), { v: 1, u: '', p: PW }, 'логин аккаунта пуст (аккаунта нет), пароль внутри');
assert.deepEqual((await phoneCalls(page)).filter(c => c !== 'available'), ['verify', 'verify', 'set'], 'порядок: отказ отпечатка, подтверждение, запись');
assert.equal(await pref(page, 'quickUnlock'), true);
assert.equal(await page.evaluate(async () => { const { cleanPrefs } = await import('./archive.js'); const { getPrefs } = await import('./prefs.js'); return Object.hasOwn(cleanPrefs(getPrefs()), 'quickUnlock'); }), false, 'отметка не едет в архив');

// --- ручная блокировка: кнопка есть, окно отпечатка само не открывается, вход по кнопке
const before = await count(page, 'verify');
await page.click('#lock-top');
await until(page, () => !document.getElementById('lock').hidden);
await waitVisible(page, '#lock-bio');
assert.equal(await page.textContent('#lock-bio'), 'Войти по отпечатку');
assert.equal(await page.evaluate(() => document.activeElement?.id), 'lock-bio', 'фокус на кнопке, поле пароля клавиатуру не открывает');
await page.waitForTimeout(500);
assert.equal(await count(page, 'verify'), before, 'после нажатия «Заблокировать» окно отпечатка не выскакивает само');
assert.equal(await page.locator('#lock-input').isVisible(), true, 'пароль остаётся запасным путём');
await page.click('#lock-bio');
await appReady(page);
let calls = await phoneCalls(page);
assert.equal(calls[calls.lastIndexOf('get') - 1], 'verify', 'сначала отпечаток, потом чтение пароля');
assert.equal(await page.evaluate(() => window.__phone.lastPrompt.maxAttempts), 3);
assert.equal(await page.evaluate(() => window.__phone.lastPrompt.useFallback), false);
assert.equal(await failsOnDisk(page), null, 'вход отпечатком не оставляет неверных попыток пароля');

// --- возвращение в приложение: окно отпечатка открывается само, но не зацикливается после отмены
await page.click('#lock-top');
await until(page, () => !document.getElementById('lock').hidden);
let n = await count(page, 'verify');
await backgroundAndBack(page);
await appReady(page);
assert.equal(await count(page, 'verify'), n + 1, 'вернулись к закрытому приложению: окно отпечатка само, одно');

await setFinger(page, '16');
await page.click('#lock-top');
await until(page, () => !document.getElementById('lock').hidden);
n = await count(page, 'verify');
await backgroundAndBack(page);
await waitCalls(page, 'verify', n + 1);
await page.waitForTimeout(300);
await backgroundAndBack(page);                                  // система вернула нас из окна отпечатка: второй раз подряд окно не открываем
await page.waitForTimeout(500);
assert.equal(await count(page, 'verify'), n + 1, 'после отмены окно отпечатка не зацикливается');
await waitText(page, '#lock-msg', '');
assert.equal(await lockVisible(page), true);

// --- отмена и «слишком много попыток» не считаются неверными попытками пароля; пароль работает
await page.click('#lock-bio');
await waitCalls(page, 'verify', n + 2);
assert.equal(await lockVisible(page), true, 'отмена: остаёмся на экране пароля');
await setFinger(page, '4');
const reads = await count(page, 'get');
await page.click('#lock-bio');
await waitText(page, '#lock-msg', /Слишком много попыток/);
assert.equal(await failsOnDisk(page), null, 'ошибки отпечатка не трогают счётчик неверных паролей');
assert.equal(await count(page, 'get'), reads, 'пароль при ошибке отпечатка не читался');
await setFinger(page, 'ok');
await unlockWithPassword(page, PW);
await appReady(page);

// --- перезапуск: при запуске окно отпечатка открывается само
n = await count(page, 'verify');
await page.reload();
await appReady(page);
assert.ok((await count(page, 'verify')) >= n + 1, 'при запуске приложения окно отпечатка открылось само');
// ... а если отменить, остаётся пароль
await setFinger(page, '16');
n = await count(page, 'verify');
await page.click('#lock-top');
await until(page, () => !document.getElementById('lock').hidden);
await page.reload();
await waitCalls(page, 'verify', n + 1);
await until(page, () => !document.getElementById('lock').hidden);
await unlockWithPassword(page, PW);
await appReady(page);
await setFinger(page, 'ok');

// --- смена пароля выключает быстрый вход и стирает сохранённый пароль
await tab(page, 'more');
await page.evaluate(() => { for (const d of document.querySelectorAll('#view details')) if (d.querySelector('#pw-change')) d.open = true; });
await page.fill('#pw-old', PW); await page.fill('#pw-new1', PW2); await page.fill('#pw-new2', PW2);
await clearToast(page);
await page.click('#pw-change');
await waitToast(page, /Пароль изменён\. Вход по отпечатку выключен/, 20000);
assert.equal(await pref(page, 'quickUnlock'), false);
assert.equal(await savedCreds(page), null, 'сохранённый пароль стёрт из хранилища телефона');
await page.click('#lock-top');
await until(page, () => !document.getElementById('lock').hidden);
assert.equal(await page.locator('#lock-bio').isHidden(), true, 'кнопки больше нет');
assert.equal(await page.evaluate(() => document.activeElement?.id), 'lock-input');
await unlockWithPassword(page, PW2);
await appReady(page);

// --- пароль сменили «на другом устройстве»: сохранённый перестал подходить
await enableViaCard(page, PW2);
await waitToast(page, /Вход по отпечатку включён/);
await page.evaluate(async ([a, b]) => { const v = await import('./vault.js'); await v.changePassword(a, b); }, [PW2, PW3]);       // как будто пароль изменён мимо этого экрана
await page.click('#lock-top');
await until(page, () => !document.getElementById('lock').hidden);
await page.click('#lock-bio');
await waitText(page, '#lock-msg', /Пароль изменился.*Вход по отпечатку выключен/);
assert.equal(await page.locator('#lock-bio').isHidden(), true, 'кнопка убрана');
assert.equal(await pref(page, 'quickUnlock'), false);
assert.equal(await savedCreds(page), null, 'старый пароль стёрт');
await unlockWithPassword(page, PW3);
await appReady(page);

// --- выключение переключателем
await enableViaCard(page, PW3);
await waitToast(page, /Вход по отпечатку включён/);
assert.ok(await savedCreds(page));
await page.click('#qu-switch');
await waitText(page, '#qu-state', /Выключен/);
assert.equal(await savedCreds(page), null);
assert.equal(await pref(page, 'quickUnlock'), false);

// --- нет сохранённых отпечатков в телефоне: переключатель закрыт, причина названа словами
await page.evaluate(() => { window.__phone.enrolled = false; window.__phoneSave(); });
await tab(page, 'today'); await tab(page, 'account');
await waitText(page, '#qu-state', /нет сохранённых отпечатков/);
assert.equal(await page.locator('#qu-switch').isDisabled(), true);
await page.evaluate(() => { window.__phone.enrolled = true; window.__phoneSave(); });
const bad1 = t.errors.filter(e => !/Failed to load resource/.test(e));
assert.deepEqual(bad1, [], 'нет ошибок в консоли (приложение):\n' + bad1.join('\n'));

// --- стирание данных стирает и сохранённый пароль
await tab(page, 'today'); await openCard(page);
await page.click('#qu-switch'); await page.fill('#qu-pass', PW3); await page.click('#qu-go');
await waitText(page, '#qu-state', /Включён/);
assert.ok(await savedCreds(page));
await page.evaluate(async () => { const d = await import('./db.js'); await d.wipeAll(); });
assert.equal(await savedCreds(page), null, 'после «Стереть всё» пароль в хранилище телефона не остаётся');

await t.close();

// =====================================================================
// 2. Сайт: плагина нет, кнопки нет, карточка говорит «только в приложении»
// =====================================================================
t = await launch();
page = t.page;
page.on('dialog', d => d.accept());
await page.goto(t.url);
await appReady(page);
await enableProtection(page);
await tab(page, 'account');
await waitText(page, '#qu-state', /Работает только в приложении для Android/);
assert.equal(await page.locator('#qu-switch').count(), 0, 'на сайте включить нельзя');
await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('lifeos.prefs.v1') || '{}'); p.quickUnlock = true; localStorage.setItem('lifeos.prefs.v1', JSON.stringify(p)); });   // даже оставшаяся отметка ничего не включает
await page.reload();
await until(page, () => !document.getElementById('lock').hidden);
assert.equal(await page.locator('#lock-bio').isHidden(), true, 'на сайте кнопки «Войти по отпечатку» нет');
assert.equal(await page.evaluate(() => document.activeElement?.id), 'lock-input', 'на сайте всё как раньше: фокус в поле пароля');
await unlockWithPassword(page, PW);
await appReady(page);
const bad2 = t.errors.filter(e => !/Failed to load resource/.test(e));
assert.deepEqual(bad2, [], 'нет ошибок в консоли (сайт):\n' + bad2.join('\n'));
await t.close();

// =====================================================================
// 3. Вход в аккаунт по отпечатку (настоящий сервер: Node + SQLite)
// =====================================================================
const server = createServer({ env: { ALLOWED_ORIGINS: '*', SETUP_CODE: 'код-123' } });
await new Promise(r => server.server.listen(0, r));
const SERVER = `http://localhost:${server.server.address().port}`;
t = await launch({ buildEnv: { LIFEOS_REQUIRE_ACCOUNT: '1', LIFEOS_SERVER_URL: SERVER } });
const A = t.page;
await A.addInitScript(nativeInit);
A.on('dialog', d => d.accept());
await A.goto(t.url);
await until(A, () => !document.getElementById('gate').hidden);
await until(A, () => document.getElementById('gate-register'), null, 15000);
assert.equal(await A.locator('#gate-bio').count(), 0, 'быстрый вход не включён: кнопки на экране входа нет');
await A.fill('#gate-user', 'Владелец'); await A.fill('#gate-pass', PW); await A.fill('#gate-pass2', PW); await A.fill('#gate-setup', 'код-123');
await A.click('#gate-register');
await until(A, () => document.getElementById('gate-code'), null, 60000);
await A.check('#gate-code-ok'); await A.click('#gate-code-done');
await appReady(A, 30000);

// включаем в профиле: логин аккаунта сохраняется вместе с паролем
await openCard(A);
await A.click('#qu-switch'); await A.fill('#qu-pass', PW); await A.click('#qu-go');
await waitText(A, '#qu-state', /Включён/);
assert.equal(JSON.parse((await savedCreds(A)).password).u, 'владелец', 'вместе с паролем сохранён логин аккаунта');

// выход из аккаунта выключает быстрый вход
await A.click('#acc-logout');
await until(A, () => !document.getElementById('gate').hidden);
assert.equal(await pref(A, 'quickUnlock'), false, 'выход из аккаунта выключил быстрый вход');
assert.equal(await savedCreds(A), null);
await until(A, () => document.getElementById('gate-login'), null, 15000);
assert.equal(await A.locator('#gate-bio').count(), 0);

// включён «в обход» (как если бы выход не успел его выключить): экран входа предлагает отпечаток
await A.evaluate(async pw => { const q = await import('./quick-unlock.js'); await q.enableQuickUnlock({ username: 'владелец', password: pw }); }, PW);
await A.reload();
await until(A, () => !document.getElementById('gate').hidden, null, 40000);           // защита паролем осталась: сначала экран блокировки (отпечаток открывается сам), потом, раз аккаунт не подключён, экран входа
assert.ok((await count(A, 'verify')) >= 2, 'экран блокировки открылся отпечатком без ввода пароля');
await until(A, () => document.getElementById('gate-bio'), null, 20000);
assert.equal(await A.textContent('#gate-bio'), 'Войти по отпечатку');
await A.click('#gate-bio');
await appReady(A, 40000);
assert.equal(await A.locator('#gate').isHidden(), true);
assert.equal(await A.evaluate(() => JSON.parse(localStorage.getItem('lifeos.account.v1')).username), 'владелец', 'вошли в аккаунт: логин и пароль подставлены из хранилища');
assert.equal(await failsOnDisk(A), null);
const bad3 = t.errors.filter(e => !/Failed to load resource/.test(e));
assert.deepEqual(bad3, [], 'нет ошибок в консоли (аккаунт):\n' + bad3.join('\n'));
await t.close();
server.close();
console.log('E2E QUICK-UNLOCK OK');
