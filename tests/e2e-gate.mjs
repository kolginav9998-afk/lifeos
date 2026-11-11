// Вход обязателен: пока не вошёл в аккаунт, приложение не открывается. Данные на устройстве переживают регистрацию, выход и повторный вход.
// Против настоящего сервера (Node + SQLite), сборка с включённым входом (в остальных тестах он отключён).
import assert from 'node:assert/strict';
import { launch, tab, until, newDevice } from './helpers.mjs';
import { createServer } from '../server/node/server.js';

const PW = 'длинная-надёжная-фраза';
const server = createServer({ env: { ALLOWED_ORIGINS: '*', SETUP_CODE: 'код-123' } });
await new Promise(r => server.server.listen(0, r));
const SERVER = `http://localhost:${server.server.address().port}`;

// ===== 1. Первый запуск: экран входа вместо приложения, данные на устройстве уже есть =====
const t = await launch({ buildEnv: { LIFEOS_REQUIRE_ACCOUNT: '1', LIFEOS_SERVER_URL: SERVER } });
const A = t.page;
A.on('dialog', d => d.accept());
await A.goto(t.url);
await until(A, () => !document.getElementById('gate').hidden);
assert.equal(await A.locator('#app').isHidden(), true, 'приложение закрыто до входа');
assert.equal(await A.locator('#tabs').isVisible(), false, 'нижней панели нет');
assert.equal(await A.locator('#lock').isHidden(), true);
// старые данные (до аккаунта) лежат на устройстве и должны остаться
await A.evaluate(async () => { const s = await import('./store.js'); const e = await import('./events.js'); await s.save(e.makeTask('купить хлеб')); });
await until(A, () => document.getElementById('gate-register'));                     // сервер найден сам, аккаунта нет — форма создания
assert.match(await A.textContent('#gate-msg'), /Аккаунта ещё нет/);
assert.equal(await A.locator('#gate-setup').isVisible(), true, 'сервер просит код установки');
assert.equal(await A.locator('#acc-user').count(), 0, 'id экрана входа не совпадают с id экрана профиля');

await A.fill('#gate-user', 'Владелец'); await A.fill('#gate-pass', PW); await A.fill('#gate-pass2', PW); await A.fill('#gate-setup', 'не-тот-код');
await A.click('#gate-register');
await until(A, () => /Неверный код установки/.test(document.getElementById('toast').textContent));
assert.equal(await A.locator('#app').isHidden(), true, 'с неверным кодом приложение не открылось');
assert.equal(server.store.getAccount(), null, 'аккаунт не создан');

await A.fill('#gate-setup', 'код-123');
await A.click('#gate-register');
await until(A, () => document.getElementById('gate-code'), null, 60000);
const code = await A.textContent('#gate-code');
assert.match(code, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/);
assert.equal(await A.locator('#app').isHidden(), true, 'пока код восстановления не подтверждён, приложение закрыто');
await A.check('#gate-code-ok'); await A.click('#gate-code-done');
await until(A, () => !document.getElementById('app').hidden, null, 30000);
assert.equal(await A.locator('#gate').isHidden(), true);
assert.equal(server.store.getAccount().username, 'владелец');

// данные на месте, аватар в шапке — первая буква логина
await until(A, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent.endsWith('купить хлеб')));
assert.equal((await A.textContent('#profile-btn')).trim(), 'В');

// ===== 2. Профиль: имя, значок, цвет =====
await A.click('#profile-btn');
assert.equal(await A.textContent('#title'), 'Профиль');
assert.equal(await A.textContent('#profile-who-name'), 'владелец', 'пока имени нет, показан логин');
await A.click('#profile-edit summary');
await A.fill('#pf-name', 'А');
await A.click('#pf-save');
await until(A, () => /хотя бы два/.test(document.getElementById('pf-err').textContent));
await A.fill('#pf-name', 'Анна Петрова'); await A.fill('#pf-motto', 'Шаг за шагом');
await A.click('.pf-avatar[data-v="🦊"]'); await A.click('.pf-color[data-v="teal"]');
assert.equal((await A.textContent('#pf-preview')).trim(), '🦊', 'предпросмотр меняется сразу');
await A.click('#pf-save');
await until(A, () => document.getElementById('profile-who-name')?.textContent === 'Анна Петрова');
assert.equal((await A.textContent('#profile-avatar')).trim(), '🦊');
assert.equal(await A.textContent('#profile-who-motto'), 'Шаг за шагом');
assert.equal((await A.textContent('#profile-btn')).trim(), '🦊');
assert.equal(await A.evaluate(() => document.getElementById('profile-btn').style.getPropertyValue('--av')), '#14b8a6');
// карточка версии и обновлений на месте
assert.match(await A.textContent('#upd-version'), /R3\.\d+/);
assert.equal(await A.locator('#upd-check').isVisible(), true);

// ===== 3. Перезапуск: пароль (защита включена вместе с аккаунтом), а не экран входа =====
await A.reload();
await until(A, () => !document.getElementById('lock').hidden);
assert.equal(await A.locator('#gate').isHidden(), true, 'вход в аккаунт не просят: устройство уже привязано');
await A.fill('#lock-input', PW); await A.click('#lock-btn');
await until(A, () => !document.getElementById('app').hidden);
await until(A, () => document.getElementById('profile-btn').textContent.trim() === '🦊', null, 15000);          // профиль сохранился и подтянулся


// без сети приложение открывается так же (вход проверяется на устройстве)
await t.ctx.setOffline(true);
await A.reload();
await until(A, () => !document.getElementById('lock').hidden);
await A.fill('#lock-input', PW); await A.click('#lock-btn');
await until(A, () => !document.getElementById('app').hidden);
await t.ctx.setOffline(false);

// ===== 4. Выход: снова экран входа, данные на устройстве остаются =====
await tab(A, 'account');
await A.click('#acc-logout');
await until(A, () => !document.getElementById('gate').hidden);
assert.equal(await A.locator('#app').isHidden(), true, 'после выхода приложение закрыто');
await until(A, () => document.getElementById('gate-login'));
assert.match(await A.textContent('#gate-msg'), /уже создан/);
await A.fill('#gate-user', 'владелец'); await A.fill('#gate-pass', 'неверный-пароль-1'); await A.click('#gate-login');
await until(A, () => /Неверное имя или пароль/.test(document.getElementById('toast').textContent));
assert.equal(await A.locator('#app').isHidden(), true);
await A.fill('#gate-pass', PW); await A.click('#gate-login');
await until(A, () => !document.getElementById('app').hidden, null, 30000);
await until(A, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent.endsWith('купить хлеб')));
assert.equal((await A.textContent('#profile-btn')).trim(), '🦊');

// ===== 5. Другое устройство: вход, данные и профиль подтянулись =====
const B = await newDevice(t);
await until(B.page, () => !document.getElementById('gate').hidden);
assert.equal(await B.page.locator('#app').isHidden(), true);
await until(B.page, () => document.getElementById('gate-login'));
await B.page.fill('#gate-user', 'ВЛАДЕЛЕЦ'); await B.page.fill('#gate-pass', PW); await B.page.click('#gate-login');
await until(B.page, () => !document.getElementById('app').hidden, null, 30000);
await until(B.page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent.endsWith('купить хлеб')), null, 20000);
await until(B.page, () => document.getElementById('profile-btn').textContent.trim() === '🦊', null, 20000);

for (const [name, e] of [['A', t.errors], ['B', B.errors]]) {
  const real = e.filter(x => !/Failed to load resource/.test(x));
  assert.deepEqual(real, [], `нет ошибок в консоли ${name}:\n${real.join('\n')}`);
}
await t.close();

// ===== 6. Сервер недоступен: понятное сообщение и кнопка «Повторить» =====
const dead = await launch({ buildEnv: { LIFEOS_REQUIRE_ACCOUNT: '1', LIFEOS_SERVER_URL: 'http://localhost:9' } });
await dead.page.goto(dead.url);
await until(dead.page, () => document.getElementById('gate-retry'), null, 20000);
assert.match(await dead.page.textContent('#gate-msg'), /Нет связи|не отвечает/);
assert.equal(await dead.page.locator('#app').isHidden(), true);
await dead.close();
server.close();
console.log('E2E GATE OK');
