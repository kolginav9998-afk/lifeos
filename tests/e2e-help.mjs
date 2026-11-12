// Справка и знакомство: экран «Справка» (поиск по словам, статья, кнопка действия), ссылки на неё из Профиля, Настроек, карточки обновления
// и общего поиска; подсказки на экране входа; знакомство из трёх карточек сразу после первого входа (один раз на устройстве).
import assert from 'node:assert/strict';
import { launch, tab, until, newDevice } from './helpers.mjs';
import { createServer } from '../server/node/server.js';
import { APK_LINK } from '../updater.js';

const noise = list => list.filter(x => !/Failed to load resource|Service Worker registration blocked/.test(x));
const active = p => p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

// ===== 1. Справка в обычной сборке =====
const t = await launch({ ctxOptions: { serviceWorkers: 'block' } });          // без офлайн-кэша: подмена ответа сайта (version.js) должна сработать
const p = t.page;
await p.goto(t.url);
await until(p, () => !document.getElementById('app').hidden);

await tab(p, 'help');
assert.equal(await p.textContent('#title'), 'Справка');
assert.deepEqual(await p.locator('#subnav button').allTextContents(), ['Настройки', 'Профиль', 'Справка'], 'Справка рядом с Настройками и Профилем');
assert.ok(await p.locator('#help-list .help-item').count() >= 14, 'в списке все вопросы');
assert.match(await p.textContent('#help-list .help-item >> nth=0'), /С чего начать/);

// поиск по словам и формам слов
for (const q of ['забыл', 'пароля', 'пароль', 'Забыла пароль']) {
  await p.fill('#help-search', q);
  assert.match(await p.textContent('#help-list .help-item >> nth=0 >> strong'), /Я забыл пароль/, `запрос «${q}»`);
  assert.match(await p.textContent('#help-status'), /Найдено ответов: \d+/);
}
await p.fill('#help-search', 'zzzz');
assert.match(await p.textContent('#help-status'), /Ничего не найдено/);
assert.ok(await p.locator('#help-list .help-item').count() >= 14, 'если не нашлось, вопросы всё равно видны');
// темы
await p.fill('#help-search', '');
await p.click('#help-groups .chip[data-group="privacy"]');
const privacy = await p.locator('#help-list .help-item strong').allTextContents();
assert.ok(privacy.includes('Что видит сервер') && privacy.includes('Как удалить свои данные') && !privacy.includes('Я забыл пароль'), 'в теме только её вопросы');
await p.click('#help-groups .chip[data-group="all"]');

// статья: шаги, честные границы, фокус на заголовке, кнопка действия
await p.fill('#help-search', 'забыл');
await p.click('#help-list .help-item >> nth=0');
assert.equal(await p.textContent('#help-title'), 'Я забыл пароль');
assert.equal(await active(p), 'help-title', 'фокус на заголовке статьи');
assert.ok(await p.locator('#help-article ol li').count() >= 8, 'пронумерованные шаги');
assert.match(await p.textContent('#help-limits'), /Честно о границах/);
assert.match(await p.textContent('#help-article'), /Если у тебя есть код восстановления[\s\S]*Если кода восстановления нет/);
assert.equal(await p.locator('#help-list').isVisible(), false, 'пока читаешь статью, списка нет');
await p.click('#help-back');
assert.equal(await p.locator('#help-list').isVisible(), true);
assert.equal(await p.evaluate(() => document.activeElement?.dataset?.article), 'forgot-password', 'после «Назад» фокус на той же строке списка');
await p.click('#help-list .help-item[data-article="forgot-password"]');
assert.equal(await p.textContent('#help-action'), 'Открыть Профиль');
await p.click('#help-action');
assert.equal(await p.textContent('#title'), 'Профиль');
assert.equal(await p.locator('#view-account').isVisible(), true);
assert.equal(await active(p), 'title', 'после перехода фокус на заголовке экрана');

// ссылка на справку из Профиля и из Настроек
await p.click('#acc-help');
assert.equal(await p.textContent('#title'), 'Справка');
assert.equal(await p.locator('#help-list').isVisible(), true, 'открывается список');
await tab(p, 'more');
await p.click('#set-help');
assert.equal(await p.textContent('#title'), 'Справка');

// «Как обновить приложение»: ссылка для ручной установки и переход к карточке обновления
await p.fill('#help-search', 'как обновить приложение');
await p.click('#help-list .help-item >> nth=0');
assert.equal(await p.textContent('#help-title'), 'Как обновить приложение');
assert.match(await p.textContent('#help-article'), /Установка неизвестных приложений/);
assert.equal(await p.getAttribute('#help-link', 'href'), APK_LINK);
assert.equal(await p.getAttribute('#help-link', 'target'), '_blank');
assert.equal(APK_LINK, 'https://github.com/kolginav9998-afk/lifeos/releases/download/latest-apk/lifeos.apk');
await p.click('#help-action');
assert.equal(await p.textContent('#title'), 'Профиль');
const nearTop = await p.evaluate(() => { const r = document.getElementById('upd-card').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2; });
assert.ok(nearTop, 'карточка обновления в видимой части экрана');

// в карточке обновления при ошибке есть «Что делать» → статья про обновление
await p.route(/\/version\.js\?t=/, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'не версия' }));
assert.equal(await p.locator('#upd-help').count(), 0, 'пока всё спокойно, ссылки нет');
await p.click('#upd-check');
await until(p, () => /Не удалось/.test(document.getElementById('upd-status').textContent));
await p.click('#upd-help');
assert.equal(await p.textContent('#title'), 'Справка');
assert.equal(await p.textContent('#help-title'), 'Как обновить приложение');
await p.unroute(/\/version\.js\?t=/);

// общий поиск: нет своих записей — предлагает ответ из справки
await p.click('#search-btn');
await p.fill('#search-input', 'забыл пароль');
await until(p, () => document.querySelector('#search-results .help-hit'));
assert.match(await p.textContent('#search-results'), /Ничего не найдено/);
assert.equal(await p.textContent('#search-results .help-hit >> nth=0'), 'Справка: Я забыл пароль');
await p.click('#search-results .help-hit >> nth=0');
assert.equal(await p.textContent('#help-title'), 'Я забыл пароль');
assert.equal(await p.locator('#search-panel').isVisible(), false);

// простой режим не прячет справку
await tab(p, 'more');
await p.check('#simple-mode');
await until(p, () => document.querySelectorAll('#tabs button').length === 3);
assert.ok((await p.locator('#subnav button').allTextContents()).includes('Справка'));
await p.uncheck('#simple-mode');
await until(p, () => document.querySelectorAll('#tabs button').length === 5);

// знакомство можно показать снова из справки; Escape закрывает, фокус остаётся на заголовке экрана
assert.equal(await p.locator('#tour').isVisible(), false, 'само не появляется');
await tab(p, 'help');
await p.fill('#help-search', 'начать');
await p.click('#help-list .help-item >> nth=0');
await p.click('#help-action');
await until(p, () => !document.getElementById('tour').hidden);
assert.equal(await p.textContent('#tour-step'), 'Шаг 1 из 3');
assert.equal(await active(p), 'tour-title');
await p.keyboard.press('Tab');
assert.equal(await active(p), 'tour-act', 'дальше по Tab — кнопка действия');
await p.keyboard.press('Escape');
assert.equal(await p.locator('#tour').isVisible(), false);
assert.equal(await active(p), 'title');
assert.deepEqual(noise(t.errors), [], 'нет ошибок в консоли:\n' + noise(t.errors).join('\n'));
await t.close();

// ===== 2. Вход и знакомство: сборка с обязательным входом и настоящим сервером =====
const PW = 'длинная-надёжная-фраза';
const server = createServer({ env: { ALLOWED_ORIGINS: '*', SETUP_CODE: 'код-123' } });
await new Promise(r => server.server.listen(0, r));
const SERVER = `http://localhost:${server.server.address().port}`;
const g = await launch({ buildEnv: { LIFEOS_REQUIRE_ACCOUNT: '1', LIFEOS_SERVER_URL: SERVER } });
const A = g.page;
A.on('dialog', d => d.accept());
await A.goto(g.url);
await until(A, () => document.getElementById('gate-register'));

// подсказки на экране входа
assert.equal(await A.locator('#gate-help li').first().isVisible(), false, 'свёрнуты');
await A.click('#gate-help summary');
assert.equal(await A.locator('#gate-help li').count(), 3);
const tips = await A.textContent('#gate-help');
assert.match(tips, /Нужна помощь\?/);
assert.match(tips, /Где код установки сервера\?[\s\S]*только при создании аккаунта/);
assert.match(tips, /Что за код восстановления\?[\s\S]*Забыл пароль/);
assert.match(tips, /Нет интернета\?[\s\S]*Повторить/);
assert.equal(await A.locator('#tour').isVisible(), false, 'до входа знакомства нет');

await A.fill('#gate-user', 'Владелец'); await A.fill('#gate-pass', PW); await A.fill('#gate-pass2', PW); await A.fill('#gate-setup', 'код-123');
await A.click('#gate-register');
await until(A, () => document.getElementById('gate-code'), null, 60000);
assert.equal(await A.locator('#tour').isVisible(), false, 'пока код восстановления не подтверждён, знакомства нет');
await A.check('#gate-code-ok'); await A.click('#gate-code-done');
await until(A, () => !document.getElementById('app').hidden, null, 30000);

// первое знакомство: карточка 1, фокус на заголовке, один раз на устройстве
await until(A, () => !document.getElementById('tour').hidden);
assert.equal(await A.textContent('#tour-step'), 'Шаг 1 из 3');
assert.equal(await A.textContent('#tour-title'), 'Это твой профиль: имя и значок');
assert.equal(await active(A), 'tour-title');
assert.equal(await A.evaluate(() => JSON.parse(localStorage.getItem('lifeos.prefs.v1')).tourDone), true, 'отмечено сразу, второй раз не покажем');
assert.equal(await A.getAttribute('#tour-close', 'aria-label'), 'Закрыть подсказки');
assert.equal(await A.getAttribute('#tour', 'aria-label'), 'Знакомство с приложением');
await A.keyboard.press('Tab');
assert.equal(await active(A), 'tour-act');
// карточка 1: открыть профиль; знакомство остаётся и показывает карточку 2
await A.click('#tour-act');
assert.equal(await A.textContent('#title'), 'Профиль');
assert.equal(await A.textContent('#tour-step'), 'Шаг 2 из 3');
assert.equal(await A.textContent('#tour-title'), 'Сохрани архив и код восстановления');
assert.equal(await active(A), 'title', 'фокус на открытом экране, а не отнят знакомством');
assert.ok(await A.locator('#acc-help').count() === 1, 'в Профиле (с аккаунтом) есть кнопка справки');
// карточка 2: «Позже» пропускает её
await A.click('#tour-later');
assert.equal(await A.textContent('#tour-step'), 'Шаг 3 из 3');
assert.equal(await A.textContent('#tour-title'), 'Обновления приходят кнопкой в Профиле');
assert.equal(await active(A), 'tour-title');
// карточка 3: показать кнопку обновления и закрыться
await A.click('#tour-act');
assert.equal(await A.locator('#tour').isVisible(), false);
assert.equal(await A.textContent('#title'), 'Профиль');
assert.ok(await A.evaluate(() => { const r = document.getElementById('upd-card').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2; }), 'карточка обновления на виду');

// действие «Открыть архив» из знакомства: настройки, карточка архива на виду
await tab(A, 'help');
await A.fill('#help-search', 'начать'); await A.click('#help-list .help-item >> nth=0'); await A.click('#help-action');
await A.click('#tour-later');
await A.click('#tour-act');
assert.equal(await A.textContent('#title'), 'Настройки');
assert.ok(await A.evaluate(() => { const r = document.getElementById('archive-box').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }), 'архив на виду');
assert.equal(await A.textContent('#tour-step'), 'Шаг 3 из 3');
await A.click('#tour-later');
assert.equal(await A.locator('#tour').isVisible(), false, '«Позже» на последней карточке закрывает знакомство');

// перезапуск и повторный вход на этом же устройстве знакомство не возвращают
await A.reload();
await until(A, () => !document.getElementById('lock').hidden);
await A.fill('#lock-input', PW); await A.click('#lock-btn');
await until(A, () => !document.getElementById('app').hidden);
await until(A, () => document.getElementById('profile-btn').textContent.trim() === 'В', null, 15000);
assert.equal(await A.locator('#tour').isVisible(), false);
await tab(A, 'account');
await A.click('#acc-logout');
await until(A, () => !document.getElementById('gate').hidden);
await until(A, () => document.getElementById('gate-login'));
await A.fill('#gate-user', 'владелец'); await A.fill('#gate-pass', PW); await A.click('#gate-login');
await until(A, () => !document.getElementById('app').hidden, null, 30000);
await until(A, () => document.getElementById('profile-btn').textContent.trim() === 'В', null, 15000);
await A.waitForTimeout(400);
assert.equal(await A.locator('#tour').isVisible(), false, 'на этом устройстве знакомство уже было');

// другое устройство: своё знакомство; Escape закрывает, фокус на заголовке экрана
const B = await newDevice(g);
await until(B.page, () => document.getElementById('gate-login'));
await B.page.fill('#gate-user', 'владелец'); await B.page.fill('#gate-pass', PW); await B.page.click('#gate-login');
await until(B.page, () => !document.getElementById('app').hidden, null, 30000);
await until(B.page, () => !document.getElementById('tour').hidden);
assert.equal(await B.page.textContent('#tour-step'), 'Шаг 1 из 3');
await B.page.keyboard.press('Escape');
assert.equal(await B.page.locator('#tour').isVisible(), false);
assert.equal(await active(B.page), 'title');
assert.equal(await B.page.evaluate(() => JSON.parse(localStorage.getItem('lifeos.prefs.v1')).tourDone), true);

for (const [name, e] of [['A', g.errors], ['B', B.errors]]) assert.deepEqual(noise(e), [], `нет ошибок в консоли ${name}:\n${noise(e).join('\n')}`);
await g.close();
server.server.close();
console.log('E2E HELP OK');
