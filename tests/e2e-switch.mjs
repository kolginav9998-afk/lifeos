// Несколько аккаунтов на одном устройстве: выход, регистрация по приглашению, вход в другой аккаунт и возврат.
// Главное: данные одного аккаунта НЕ попадают в другой (ни при регистрации, ни при входе). Против настоящего сервера (Node + SQLite).
import assert from 'node:assert/strict';
import { launch, tab, until, appReady } from './helpers.mjs';
import { createServer } from '../server/node/server.js';

const PW = 'длинная-надёжная-фраза', PW2 = 'другая-надёжная-фраза-2';
const server = createServer({ env: { ALLOWED_ORIGINS: '*', SETUP_CODE: 'код-123' } });
await new Promise(r => server.server.listen(0, r));
const SERVER = `http://localhost:${server.server.address().port}`;
const t = await launch({ buildEnv: { LIFEOS_REQUIRE_ACCOUNT: '1', LIFEOS_SERVER_URL: SERVER } });
const A = t.page;
A.on('dialog', d => d.accept());

const texts = () => A.evaluate(() => [...document.querySelectorAll('.item .text')].map(n => n.textContent));
const addTask = text => A.evaluate(async x => { const s = await import('./store.js'); const e = await import('./events.js'); await s.save(e.makeTask(x)); }, text);
const hasTask = text => until(A, x => [...document.querySelectorAll('.item .text')].some(n => n.textContent.endsWith(x)), text);
const gateReady = () => until(A, () => !document.getElementById('gate').hidden && (document.getElementById('gate-login') || document.getElementById('gate-register')), null, 30000);
async function finishCode() { await until(A, () => document.getElementById('gate-code'), null, 90000); await A.check('#gate-code-ok'); await A.click('#gate-code-done'); await appReady(A, 30000); }
async function logout() { await tab(A, 'account'); await A.click('#acc-logout'); await gateReady(); }
async function login(user, pw) { await until(A, () => document.getElementById('gate-login')); await A.fill('#gate-user', user); await A.fill('#gate-pass', pw); await A.click('#gate-login'); }
const rowsOf = name => server.store.stats(server.store.getAccountByName(name).id).count;

// ===== 1. Владелец создаёт аккаунт; на устройстве его задача; он готовит приглашение =====
await A.goto(t.url);
await until(A, () => document.getElementById('gate-register'), null, 30000);
await A.fill('#gate-user', 'Владелец'); await A.fill('#gate-pass', PW); await A.fill('#gate-pass2', PW); await A.fill('#gate-setup', 'код-123');
await A.click('#gate-register');
await finishCode();
await addTask('задача владельца');
await hasTask('задача владельца');
await until(A, () => document.getElementById('sync-badge') && !/…|ждёт|не/i.test(document.getElementById('sync-badge').textContent) || true);
await A.waitForTimeout(1500);
const ownerToken = await A.evaluate(async () => (await import('./app-sync.js')).account.token());
const inv = await (await fetch(`${SERVER}/v1/invites`, { method: 'POST', headers: { authorization: `Bearer ${ownerToken}` } })).json();
assert.match(inv.code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);

// ===== 2. Выход; на экране входа есть «У меня есть приглашение» =====
await logout();
assert.equal(await A.locator('#app').isHidden(), true);
assert.equal(await A.locator('#gate-inv-box').count(), 1);
const ownerRows = rowsOf('владелец');
assert.ok(ownerRows >= 1, 'задача владельца на сервере');

// ===== 3. Анна регистрируется по приглашению на этом же телефоне: данные владельца стираются только с согласия =====
await A.click('#gate-inv-box > summary');
await A.fill('#gate-inv-code', inv.code); await A.fill('#gate-inv-user', 'Анна'); await A.fill('#gate-inv-pass', PW2); await A.fill('#gate-inv-pass2', PW2);
assert.equal(await A.locator('#gate-inv-wipe').count(), 1, 'на устройстве чужие данные: просят согласие на стирание');
await A.click('#gate-inv-register');
await until(A, () => /Отметь согласие/.test(document.getElementById('toast').textContent));
assert.equal(server.store.getAccountByName('анна'), null, 'без согласия аккаунт не создан и данные не тронуты');
await A.check('#gate-inv-wipe');
await A.click('#gate-inv-register');
await finishCode();
assert.deepEqual((await texts()).filter(x => x.includes('владельца')), [], 'у Анны нет задач владельца');
assert.equal(server.store.getAccountByName('анна').invited_by, server.store.getAccountByName('владелец').id);
assert.equal(rowsOf('владелец'), ownerRows, 'данные владельца на сервере не изменились');
await addTask('задача Анны');
await hasTask('задача Анны');
await A.waitForTimeout(1500);

// ===== 4. Анна выходит; владелец входит на этом же устройстве: чужие данные не присоединяются, а стираются по согласию =====
await logout();
await login('Владелец', PW);
await until(A, () => document.getElementById('gate-switch-go'), null, 60000);
assert.match(await A.textContent('#gate-switch-msg'), /аккаунта «анна»/);
assert.equal(await A.locator('#app').isHidden(), true, 'пока не подтверждено, приложение закрыто');
// отмена: ничего не стёрто, возвращаемся к входу
await A.click('#gate-switch-cancel');
await until(A, () => document.getElementById('gate-login'));
// ещё раз и подтвердить
await login('Владелец', PW);
await until(A, () => document.getElementById('gate-switch-go'), null, 60000);
await A.click('#gate-switch-go');
await appReady(A, 60000);
await hasTask('задача владельца');
assert.deepEqual((await texts()).filter(x => x.includes('Анны')), [], 'задачи Анны у владельца не появились');
await A.waitForTimeout(1500);
const rowsAfter = rowsOf('владелец'), annaRows = rowsOf('анна');
assert.equal(rowsAfter, ownerRows, 'в аккаунт владельца ничего чужого не загружено');
assert.ok(annaRows >= 1, 'данные Анны остались на сервере');
// в журнале владельца на сервере только его записи: расшифровать нельзя, но число записей и порядок номеров свои
assert.equal(server.store.stats(server.store.getAccountByName('владелец').id).seq, ownerRows);

// ===== 5. Владелец снова входит в Анну: теперь стирается владелец, Анна получает свои данные =====
await logout();
await login('Анна', PW2);
await until(A, () => document.getElementById('gate-switch-go'), null, 60000);
assert.match(await A.textContent('#gate-switch-msg'), /аккаунта «владелец»/);
await A.click('#gate-switch-go');
await appReady(A, 60000);
await hasTask('задача Анны');
assert.deepEqual((await texts()).filter(x => x.includes('владельца')), []);
assert.equal(rowsOf('владелец'), ownerRows);

assert.deepEqual(t.errors.filter(e => !/net::|Failed to load|favicon/i.test(String(e))), [], 'в консоли без ошибок');
console.log('E2E SWITCH OK');
await t.browser.close(); server.close(); process.exit(0);
