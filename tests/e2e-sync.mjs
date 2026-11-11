// Аккаунт и синхронизация между «устройствами» против настоящего сервера (Node + SQLite).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, tab, until, newDevice } from './helpers.mjs';
import { createServer } from '../server/node/server.js';

const PW = 'длинная-надёжная-фраза';
const server = createServer({ env: { ALLOWED_ORIGINS: '*' } });
await new Promise(r => server.server.listen(0, r));
const SERVER = `http://localhost:${server.server.address().port}`;

const t = await launch({ buildEnv: { LIFEOS_CSP_CONNECT: 'http://localhost:*' } });
const A = { page: t.page, errors: t.errors };
t.page.on('dialog', d => d.accept());
await t.page.goto(t.url);
await until(A.page, () => !document.getElementById('app').hidden);

const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('waitFor: условие не выполнилось: ' + fn.toString().slice(0, 80)); };
const hasTask = (page, text) => page.evaluate(x => [...document.querySelectorAll('.item .text')].some(n => n.textContent.endsWith(x)), text);
const waitTask = (page, text, present = true) => until(page, ([x, p]) => [...document.querySelectorAll('.item .text')].some(n => n.textContent.endsWith(x)) === p, [text, present], 20000);
const waitIdle = page => until(page, () => document.getElementById('sync-badge')?.dataset.state === 'idle', null, 30000);
async function addTask(page, text) { await tab(page, 'today'); await page.fill('#add-input', text); await page.press('#add-input', 'Enter'); await waitTask(page, text); }
async function syncNow(page) { await tab(page, 'account'); await page.click('#acc-sync-now'); await waitIdle(page); }
async function checkServer(page) {
  await tab(page, 'account');
  await page.fill('#acc-server', SERVER); await page.click('#acc-check');
  await until(page, () => /Сервер найден/.test(document.getElementById('acc-msg').textContent));
}
async function login(page, user = 'владелец', pw = PW) {
  await page.fill('#acc-user', user); await page.fill('#acc-pass', pw); await page.click('#acc-login');
}

// ===== 1. Устройство A: данные до аккаунта, регистрация, код восстановления =====
await addTask(A.page, 'купить хлеб');
await addTask(A.page, 'оплатить жильё');
await tab(A.page, 'notes'); await A.page.fill('#note-input', 'секретная заметка про зарплату'); await A.page.click('#note-form button[type=submit]');
await tab(A.page, 'more');
assert.match(await A.page.textContent('#settings-account'), /Не подключён/);
await A.page.click('#open-account');
assert.equal(await A.page.textContent('#title'), 'Профиль');
await checkServer(A.page);
assert.match(await A.page.textContent('#acc-msg'), /Аккаунта ещё нет/);
await A.page.fill('#acc-user', 'Владелец'); await A.page.fill('#acc-pass', PW); await A.page.fill('#acc-pass2', PW + 'x');
await A.page.click('#acc-register');
await until(A.page, () => /не совпадают/.test(document.getElementById('toast').textContent));
await A.page.fill('#acc-pass2', PW);
await A.page.click('#acc-register');
await until(A.page, () => document.getElementById('acc-code'), null, 60000);
const code = await A.page.textContent('#acc-code');
assert.match(code, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/);
assert.equal(await A.page.locator('#acc-code-done').isDisabled(), true, 'без подтверждения дальше нельзя');
await A.page.check('#acc-code-ok'); await A.page.click('#acc-code-done');
await waitIdle(A.page);
assert.equal(await A.page.locator('#lock-top').isVisible(), true, 'защита включилась вместе с аккаунтом');
await until(A.page, () => /Владелец|владелец/.test(document.getElementById('acc-name')?.textContent ?? ''));
assert.equal(server.store.getAccount().username, 'владелец');
assert.ok(server.store.stats().count >= 3, 'записи на сервере');

// сервер видит только шифртекст
const dump = JSON.stringify(server.store.db.all('SELECT * FROM records'));
for (const s of ['хлеб', 'жильё', 'зарплату', 'task', 'note']) assert.ok(!dump.includes(s), `на сервере нет открытого «${s}»`);
const acc = JSON.stringify(server.store.db.all('SELECT * FROM account'));
assert.ok(!acc.includes(PW), 'пароль на сервер не попал');

// ===== 2. Устройство B: вход, данные подтянулись =====
const B = await newDevice(t);
await checkServer(B.page);
assert.match(await B.page.textContent('#acc-msg'), /уже создан/);
await login(B.page, 'ВЛАДЕЛЕЦ', 'неверный-пароль-1');
await until(B.page, () => /Неверное имя или пароль/.test(document.getElementById('toast').textContent));
await login(B.page);
await waitTask(B.page, 'купить хлеб'); await waitTask(B.page, 'оплатить жильё');
await tab(B.page, 'notes');
await until(B.page, () => document.querySelector('.note-title')?.textContent.includes('секретная заметка'));
assert.equal(await B.page.locator('#lock-top').isVisible(), true, 'на втором устройстве тоже включена защита');
await B.page.reload();                                        // перезапуск: нужен пароль
await until(B.page, () => !document.getElementById('lock').hidden);
await B.page.fill('#lock-input', PW); await B.page.click('#lock-btn');
await until(B.page, () => !document.getElementById('app').hidden);
await waitTask(B.page, 'купить хлеб');
await waitIdle(B.page);

// ===== 3. Правки в обе стороны =====
await addTask(B.page, 'позвонить маме');
await waitFor(() => server.store.stats().count >= 4);
await syncNow(A.page); await tab(A.page, 'today');
await waitTask(A.page, 'позвонить маме');
// удаление на A доходит до B
await A.page.locator('.item', { hasText: 'купить хлеб' }).locator('.del').click();
await until(A.page, () => /Задача удалена/.test(document.getElementById('toast').textContent));
await syncNow(A.page);
await syncNow(B.page); await tab(B.page, 'today');
await waitTask(B.page, 'купить хлеб', false);

// ===== 4. Конфликт: обе стороны правят одну запись без сети =====
await t.ctx.setOffline(true); await B.ctx.setOffline(true);
await tab(A.page, 'today');
await A.page.locator('.item', { hasText: 'оплатить жильё' }).locator('.body').click();
await A.page.fill('.edit-text', 'жильё: правка A'); await A.page.click('form.editing .save');
await A.page.waitForTimeout(50);
await tab(B.page, 'today');
await B.page.locator('.item', { hasText: 'оплатить жильё' }).locator('.body').click();
await B.page.fill('.edit-text', 'жильё: правка B (позже)'); await B.page.click('form.editing .save');
await t.ctx.setOffline(false); await B.ctx.setOffline(false);
await syncNow(A.page); await syncNow(B.page); await syncNow(A.page);
await tab(A.page, 'today'); await tab(B.page, 'today');
await waitTask(A.page, 'жильё: правка B (позже)'); await waitTask(B.page, 'жильё: правка B (позже)');
assert.equal(await hasTask(A.page, 'жильё: правка A'), false, 'проигравшей версии нет ни на одном устройстве');

// ===== 5. Устройство C с чужими локальными данными: копия, присоединение, объединение =====
const C = await newDevice(t);
await addTask(C.page, 'локальная задача C');
await checkServer(C.page);
await login(C.page);
await until(C.page, () => document.getElementById('acc-join-go'), null, 30000);
assert.match(await C.page.textContent('#view-account'), /уже есть данные/);
const [dl] = await Promise.all([C.page.waitForEvent('download'), C.page.click('#acc-join-go')]);
const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
assert.equal(backup.app, 'lifeos-enc', 'перед присоединением сохранена зашифрованная копия');
await tab(C.page, 'today');
await waitTask(C.page, 'локальная задача C'); await waitTask(C.page, 'позвонить маме'); await waitTask(C.page, 'жильё: правка B (позже)');
await syncNow(C.page); await syncNow(A.page); await tab(A.page, 'today');
await waitTask(A.page, 'локальная задача C');

// ===== 6. Смена пароля на A: B теряет сессию и входит заново новым паролем =====
const PW2 = 'совершенно-новый-пароль';
await tab(A.page, 'account');
await A.page.click('#view-account details:has(#acc-new1) summary');
await A.page.fill('#acc-old', PW); await A.page.fill('#acc-new1', PW2); await A.page.fill('#acc-new2', PW2);
await A.page.click('#acc-change');
await until(A.page, () => /Пароль изменён/.test(document.getElementById('toast').textContent), null, 30000);
await tab(B.page, 'account'); await B.page.click('#acc-sync-now');
await until(B.page, () => document.getElementById('sync-badge').dataset.state === 'needs-login', null, 30000);
await until(B.page, () => document.getElementById('acc-relogin-pass'), null, 10000);
await B.page.fill('#acc-relogin-pass', PW); await B.page.click('#acc-relogin');
await until(B.page, () => /Неверное имя или пароль/.test(document.getElementById('toast').textContent), null, 20000);
await B.page.fill('#acc-relogin-pass', PW2); await B.page.click('#acc-relogin');
await waitIdle(B.page).catch(async e => {
  const dbg = await B.page.evaluate(() => ({ badge: document.getElementById('sync-badge')?.dataset.state, toast: document.getElementById('toast')?.textContent, status: document.getElementById('acc-status')?.textContent, detail: document.getElementById('acc-detail')?.textContent, view: document.getElementById('view-account')?.innerText.slice(0, 400) }));
  console.log('ОТЛАДКА B:', JSON.stringify(dbg, null, 1)); throw e;
});

// ===== 7. Забыл пароль: новое устройство входит по коду восстановления =====
const D = await newDevice(t);
await checkServer(D.page);
await D.page.click('#acc-forgot');
await D.page.fill('#acc-rec-user', 'владелец'); await D.page.fill('#acc-rec-code', 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'); await D.page.fill('#acc-rec-pass', 'пароль-после-сброса-1');
await D.page.click('#acc-rec-go');
await until(D.page, () => /Неверное имя или пароль|Неверный код|Ошибка/.test(document.getElementById('toast').textContent), null, 30000);
await D.page.fill('#acc-rec-code', code.toLowerCase()); await D.page.click('#acc-rec-go');
await until(D.page, () => /Пароль изменён, вход выполнен/.test(document.getElementById('toast').textContent), null, 60000);
await tab(D.page, 'today');
await waitTask(D.page, 'позвонить маме'); await waitTask(D.page, 'локальная задача C');
// и старые пароли больше не работают
const E = await newDevice(t);
await checkServer(E.page); await login(E.page, 'владелец', PW2);
await until(E.page, () => /Неверное имя или пароль/.test(document.getElementById('toast').textContent), null, 20000);

// ===== 8. Восстановление закрыло все сессии: B (локально ещё со старым паролем) входит заново; блокировка; выход =====
const PW3 = 'пароль-после-сброса-1';
await B.page.click('#lock-top');
await until(B.page, () => !document.getElementById('lock').hidden);
assert.equal(await B.page.locator('#sync-badge').isVisible(), false, 'пока заблокировано, синхронизации нет');
await B.page.fill('#lock-input', PW2); await B.page.click('#lock-btn');       // локально пароль ещё прежний
await until(B.page, () => !document.getElementById('app').hidden);
await until(B.page, () => document.getElementById('sync-badge').dataset.state === 'needs-login', null, 30000);
await tab(B.page, 'account');
await until(B.page, () => document.getElementById('acc-relogin-pass'), null, 10000);
await B.page.fill('#acc-relogin-pass', PW3); await B.page.click('#acc-relogin');
await waitIdle(B.page);
await B.page.click('#lock-top');                                              // теперь локальный пароль — новый
await B.page.fill('#lock-input', PW3); await B.page.click('#lock-btn');
await until(B.page, () => !document.getElementById('app').hidden);
await waitIdle(B.page);
await tab(B.page, 'account');
await B.page.click('#acc-logout');
await until(B.page, () => document.getElementById('sync-badge').hidden);
await tab(B.page, 'today');
assert.equal(await hasTask(B.page, 'позвонить маме'), true, 'данные остались на устройстве после выхода');

// ===== итог =====
for (const [name, e] of [['A', A.errors], ['B', B.errors], ['C', C.errors], ['D', D.errors], ['E', E.errors]]) {
  const real = e.filter(x => !/Failed to load resource/.test(x));
  assert.deepEqual(real, [], `нет ошибок в консоли ${name}:\n${real.join('\n')}`);
}
await t.close(); server.close();
console.log('E2E SYNC OK');
