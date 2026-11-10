import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, tab, until, rawDisk, ymd } from './helpers.mjs';

const SECRET_TASK = 'секретная задача про зарплату';
const SECRET_NOTE = 'пароль от сейфа 4815162342';
const PW = 'длинная-надёжная-фраза';

async function fresh(opts) {
  const t = await launch(opts);
  t.page.on('dialog', d => d.accept());
  await t.page.goto(t.url);
  await until(t.page, () => !document.getElementById('app').hidden);
  return t;
}
const text = (page, sel) => page.textContent(sel);
const waitCount = (page, sel, n) => until(page, ([s, k]) => document.querySelectorAll(s).length === k, [sel, n]);
const expectToast = (page, re, timeout = 15000) => page.waitForFunction(([src, flags]) => {
  const t = document.getElementById('toast');
  return !t.hidden && new RegExp(src, flags).test(t.textContent);
}, [re.source, re.flags], { timeout }).catch(async e => { throw new Error(`Не появилось сообщение ${re}; сейчас: «${await page.textContent('#toast')}»`); });
const diskText = async page => JSON.stringify(await rawDisk(page));
async function addTask(page, t) { await tab(page, 'today'); await page.fill('#add-input', t); await page.press('#add-input', 'Enter'); await until(page, x => [...document.querySelectorAll('.item .text')].some(n => n.textContent.endsWith(x)), t); }
async function addNote(page, t) { await tab(page, 'notes'); await page.fill('#note-input', t); await page.click('#note-form button[type=submit]'); await waitCount(page, '.note', 1); }
async function enableViaUi(page, pw = PW) {
  await tab(page, 'more');
  await page.fill('#pw1', pw); await page.fill('#pw2', pw); await page.check('#pw-ack');
  await page.click('#pw-enable');
  await until(page, () => document.getElementById('sec-status'), null, 15000);
}
async function unlock(page, pw) { await page.fill('#lock-input', pw); await page.click('#lock-btn'); }
const lockVisible = page => page.locator('#lock').isVisible();

// =====================================================================
// 1. Включение защиты и шифрование на диске
// =====================================================================
let t = await fresh();
let { page, errors } = t;
await addTask(page, SECRET_TASK);
await addNote(page, SECRET_NOTE);
assert.ok((await diskText(page)).includes('секретная задача'), 'до включения защиты данные лежат открыто (ожидаемо)');

await tab(page, 'more');
// подсказка надёжности, «показать пароль», отказ от самых известных
await page.fill('#pw1', 'password');
assert.match(await text(page, '#pw-strength'), /Надёжность: очень слабый/);
await page.fill('#pw2', 'password'); await page.check('#pw-ack'); await page.click('#pw-enable');
await expectToast(page, /Слишком известный пароль/);
await page.fill('#pw1', PW);
assert.match(await text(page, '#pw-strength'), /Надёжность: (хороший|отличный)/);
assert.equal(await page.getAttribute('#pw1', 'type'), 'password');
await page.click('#pw-form .pw-wrap:first-of-type .reveal');
assert.equal(await page.getAttribute('#pw1', 'type'), 'text', 'пароль показан');
await page.click('#pw-form .pw-wrap:first-of-type .reveal');
assert.equal(await page.getAttribute('#pw1', 'type'), 'password');
await page.uncheck('#pw-ack');
// проверки формы: слабый пароль, несовпадение, нет галочки
await page.fill('#pw1', 'short'); await page.fill('#pw2', 'short'); await page.check('#pw-ack'); await page.click('#pw-enable');
await expectToast(page, /не короче 8/);
await page.fill('#pw1', PW); await page.fill('#pw2', PW + 'x'); await page.click('#pw-enable');
await expectToast(page, /не совпадают/);
await page.fill('#pw2', PW); await page.uncheck('#pw-ack'); await page.click('#pw-enable');
await expectToast(page, /Подтверди галочкой/);
assert.equal(await page.evaluate(() => localStorage.getItem('lifeos.vault.v1')), null, 'неудачные попытки ничего не включили');
await page.check('#pw-ack');
await page.click('#pw-enable');
await until(page, () => document.getElementById('sec-status'), null, 15000);
await expectToast(page, /Защита включена\. Зашифровано записей: 2/);

let disk = await diskText(page);
for (const s of ['секретная', 'зарплату', 'сейфа', '4815162342', 'Привет']) assert.ok(!disk.includes(s), `на диске нет открытого текста «${s}»`);
assert.ok(!disk.includes(PW), 'пароль нигде не хранится');
const raw = await rawDisk(page);
assert.ok(raw.idb.length === 2 && raw.idb.every(r => r.ct && r.iv && !r.payload && !r.type), 'в IndexedDB только зашифрованные записи');
assert.ok(JSON.parse(raw.ls).every(r => r.ct), 'и копия в localStorage тоже');
assert.equal(new Set(raw.idb.map(r => r.iv)).size, raw.idb.length, 'у каждой записи свой IV');

// приложение продолжает работать, новые записи тоже шифруются
await addTask(page, 'ещё одна секретная мысль');
disk = await diskText(page);
assert.ok(!disk.includes('мысль'));
assert.equal(await page.locator('#lock-top').isVisible(), true, 'кнопка «заблокировать» появилась');

// =====================================================================
// 2. Блокировка, неверный пароль, перебор
// =====================================================================
await page.click('#lock-top');
await until(page, () => !document.getElementById('lock').hidden);
assert.equal(await page.locator('#app').isVisible(), false);
let body = await page.evaluate(() => document.body.textContent);
assert.ok(!body.includes('секретная') && !body.includes('сейфа') && !body.includes('мысль'), 'в странице нет данных, пока заблокировано');

await page.fill('#lock-input', 'проверка-показа');
await page.click('#lock-reveal');
assert.equal(await page.getAttribute('#lock-input', 'type'), 'text');
await unlock(page, 'неверный-пароль-1');
await until(page, () => document.getElementById('lock-msg').textContent === 'Неверный пароль');
assert.equal(await page.getAttribute('#lock-input', 'type'), 'text', 'выбор «показать» сохраняется до новой блокировки');
await page.click('#lock-reveal');
assert.equal(await page.getAttribute('#lock-input', 'type'), 'password');
assert.equal(await lockVisible(page), true);
for (let i = 2; i <= 5; i++) { await until(page, () => !document.getElementById('lock-btn').disabled); await unlock(page, `неверный-пароль-${i}`); await page.waitForTimeout(150); }
await until(page, () => /Слишком много попыток/.test(document.getElementById('lock-msg').textContent), null, 10000);
assert.equal(await page.locator('#lock-btn').isDisabled(), true, 'после 5 ошибок вход временно закрыт');
await until(page, () => !document.getElementById('lock-btn').disabled, null, 10000);   // ждём окончания паузы

// перезагрузка: приложение стартует заблокированным, данных в DOM нет
await page.reload();
await until(page, () => !document.getElementById('lock').hidden);
assert.equal(await page.locator('#app').isVisible(), false);
body = await page.evaluate(() => document.body.textContent);
assert.ok(!body.includes('секретная'));

await unlock(page, PW);
await until(page, () => !document.getElementById('app').hidden);
await tab(page, 'today');
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'секретная задача про зарплату'));
assert.ok([...(await page.locator('.item .text').allTextContents())].includes('ещё одна секретная мысль'), 'все данные на месте после входа');
await tab(page, 'notes');
await waitCount(page, '.note', 1);
assert.equal(errors.filter(e => !/401|Failed to load resource/.test(e)).length, 0, errors.join('\n'));

// =====================================================================
// 3. Автоблокировка: сворачивание и «шторка приватности»
// =====================================================================
await tab(page, 'more');
await page.selectOption('#autolock', '-1');                                 // «никогда»
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
assert.equal(await page.evaluate(() => document.body.classList.contains('privacy')), true, 'шторка при сворачивании');
assert.equal(await page.locator('#app').isVisible(), false, 'содержимое скрыто для «недавних приложений»');
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
assert.equal(await page.evaluate(() => document.body.classList.contains('privacy')), false);
assert.equal(await lockVisible(page), false, 'при «никогда» остаёмся в приложении');

await page.selectOption('#autolock', '0');                                  // «сразу при сворачивании»
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
await until(page, () => !document.getElementById('lock').hidden);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
assert.equal(await lockVisible(page), true, 'осталось заблокированным');
await unlock(page, PW);
await until(page, () => !document.getElementById('app').hidden);

// =====================================================================
// 4. Смена пароля
// =====================================================================
await tab(page, 'more');
await page.click('#sec-box details:has(#pw-old) summary');
await page.fill('#pw-old', 'не-тот-пароль-1'); await page.fill('#pw-new1', 'новая-длинная-фраза'); await page.fill('#pw-new2', 'новая-длинная-фраза');
await page.click('#pw-change');
await expectToast(page, /Текущий пароль неверный/);
await page.fill('#pw-old', PW);
await page.click('#pw-change');
await until(page, () => /Пароль изменён/.test(document.getElementById('toast').textContent), null, 10000);
await page.click('#lock-now');
await until(page, () => !document.getElementById('lock').hidden);
await unlock(page, PW);                                                      // старый больше не подходит
await until(page, () => document.getElementById('lock-msg').textContent === 'Неверный пароль');
await until(page, () => !document.getElementById('lock-btn').disabled);
await unlock(page, 'новая-длинная-фраза');
await until(page, () => !document.getElementById('app').hidden);
await tab(page, 'today');
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'секретная задача про зарплату'));
const PW2 = 'новая-длинная-фраза';

// =====================================================================
// 5. Зашифрованная копия, открытая копия, потеря данных и восстановление
// =====================================================================
await tab(page, 'more');
await page.fill('#bk-pass', 'abc');
await page.click('#bk-enc');
await expectToast(page, /не короче 8/);
await page.fill('#bk-pass', 'пароль-для-копии');
const [encDl] = await Promise.all([page.waitForEvent('download'), page.click('#bk-enc')]);
await expectToast(page, /Копия проверена и сохранена \(записей: \d+\)/);
const encFile = await encDl.path();
const encText = fs.readFileSync(encFile, 'utf8');
assert.equal(JSON.parse(encText).app, 'lifeos-enc');
for (const s of ['секретная', 'сейфа', 'зарплату']) assert.ok(!encText.includes(s), 'в зашифрованной копии нет открытого текста');
const [plainDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);   // диалог-предупреждение принят
assert.ok(fs.readFileSync(await plainDl.path(), 'utf8').includes('секретная задача'), 'открытая копия читается без пароля (поэтому есть предупреждение)');

// полная потеря данных
await page.fill('#wipe-confirm', 'СТЕРЕТЬ');
await Promise.all([page.waitForNavigation(), page.click('#wipe-btn')]);
await until(page, () => !document.getElementById('app').hidden);
assert.equal(await page.locator('#lock-top').isVisible(), false, 'после стирания пароль тоже сброшен');
assert.equal(await page.locator('.item').count(), 0);
// восстановление
await tab(page, 'more');
await page.setInputFiles('#import-input', encFile);
await until(page, () => !document.getElementById('imp-row').hidden);
await expectToast(page, /введи пароль/);
await page.fill('#imp-pass', 'неверный-пароль-копии');
await page.click('#imp-go');
await until(page, () => /Неверный пароль копии/.test(document.getElementById('toast').textContent), null, 10000);
assert.equal(await page.locator('.item').count(), 0, 'с неверным паролем ничего не восстановлено');
await page.fill('#imp-pass', 'пароль-для-копии');
await page.click('#imp-go');
await until(page, () => /Восстановлено записей/.test(document.getElementById('toast').textContent), null, 10000);
await tab(page, 'today');
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'секретная задача про зарплату'));
await tab(page, 'notes');
await waitCount(page, '.note', 1);

// =====================================================================
// 6. Отключение защиты
// =====================================================================
await enableViaUi(page, PW);
await page.click('#sec-box details:has(#pw-off) summary');
await page.fill('#pw-off', 'не-тот-пароль-1');
await page.click('#pw-disable');
await expectToast(page, /Пароль неверный/);
assert.ok(!(await diskText(page)).includes('секретная'), 'после неудачной попытки данные остались зашифрованными');
await page.fill('#pw-off', PW);
await page.click('#pw-disable');
await until(page, () => /Защита отключена/.test(document.getElementById('toast').textContent), null, 15000);
assert.ok((await diskText(page)).includes('секретная задача'), 'после отключения данные снова открыты');
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
assert.equal(await lockVisible(page), false, 'вход по паролю больше не требуется');
await tab(page, 'today');
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'секретная задача про зарплату'));

// =====================================================================
// 7. Сбой посреди включения защиты: ключ создан, но не все записи зашифрованы
// =====================================================================
await page.evaluate(async () => { const v = await import('./vault.js'); await v.create('прерванное-включение'); });   // как будто приложение закрыли сразу после создания ключа
assert.ok((await diskText(page)).includes('секретная задача'), 'часть данных ещё открыта');
await page.reload();
await until(page, () => !document.getElementById('lock').hidden);
await unlock(page, 'прерванное-включение');
await until(page, () => !document.getElementById('app').hidden);
await expectToast(page, /Дошифровано записей: \d+/);
assert.ok(!(await diskText(page)).includes('секретная'), 'после входа шифрование доведено до конца');
await tab(page, 'today');
await until(page, () => [...document.querySelectorAll('.item .text')].some(n => n.textContent === 'секретная задача про зарплату'));

// =====================================================================
// 8. Подмена/порча записи: остальное читается, повреждённое не удаляется
// =====================================================================
await page.evaluate(async () => {
  const rq = indexedDB.open('lifeos', 1);
  await new Promise(res => { rq.onsuccess = res; });
  const db = rq.result;
  const all = await new Promise(res => { const r = db.transaction('events').objectStore('events').getAll(); r.onsuccess = () => res(r.result); });
  const victim = all[0];
  const ct = atob(victim.ct); const flipped = String.fromCharCode(ct.charCodeAt(0) ^ 1) + ct.slice(1);
  victim.ct = btoa(flipped);
  await new Promise(res => { const t = db.transaction('events', 'readwrite'); t.objectStore('events').put(victim); t.oncomplete = res; });
  db.close();
  localStorage.removeItem('lifeos.events.v1');          // чтобы копия не «починила» порчу
  window.__victim = victim.id;
});
const victimId = await page.evaluate(() => window.__victim);
await page.reload();
await until(page, () => !document.getElementById('lock').hidden);
await unlock(page, 'прерванное-включение');
await until(page, () => !document.getElementById('app').hidden);
await tab(page, 'more');
await until(page, () => !document.getElementById('corrupt').hidden);
assert.match(await text(page, '#corrupt'), /Не удалось прочитать записей: 1/);
assert.ok((await rawDisk(page)).idb.some(r => r.id === victimId), 'повреждённая запись не удалена с диска');
await tab(page, 'today');
assert.ok(await page.locator('.item').count() >= 1, 'остальные данные читаются');
assert.equal(errors.filter(e => !/Failed to load resource/.test(e)).length, 0, errors.join('\n'));
await t.close();

// =====================================================================
// 9. «Забыл пароль»: можно только стереть, данные не отдаются
// =====================================================================
t = await fresh(); ({ page, errors } = t);
await addTask(page, SECRET_TASK);
await enableViaUi(page);
await page.click('#lock-now');
await until(page, () => !document.getElementById('lock').hidden);
await page.click('#forgot summary');
assert.equal(await page.locator('#reset-btn').isDisabled(), true);
await page.fill('#reset-confirm', 'стереть');
assert.equal(await page.locator('#reset-btn').isDisabled(), false);
await Promise.all([page.waitForNavigation(), page.click('#reset-btn')]);
await until(page, () => !document.getElementById('app').hidden);
assert.equal(await page.locator('.item').count(), 0);
assert.ok(!(await diskText(page)).includes('секретная'));
await t.close();

// =====================================================================
// 10. Автоблокировка по времени (часы подменены)
// =====================================================================
t = await launch(); ({ page, errors } = t);
await page.clock.install();
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
await page.evaluate(async () => {
  const db = await import('./db.js'); const prefs = await import('./prefs.js');
  await db.enableLock('часы-идут-пароль'); prefs.setPref('autoLockMin', 5);
  document.getElementById('lock-top').hidden = false;
});
await page.clock.fastForward('04:00');
await page.click('#tabs button[data-tab="diary"]');                          // активность в 4-й минуте
await page.clock.fastForward('03:00');                                       // с последней активности 3 минуты
assert.equal(await lockVisible(page), false, 'пока активен — не блокируется');
await page.clock.fastForward('03:00');                                       // 6 минут без касаний
await until(page, () => !document.getElementById('lock').hidden);
await unlock(page, 'часы-идут-пароль');
await until(page, () => !document.getElementById('app').hidden);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.clock.fastForward('06:00');
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
await until(page, () => !document.getElementById('lock').hidden);
assert.equal(await page.locator('#app').isVisible(), false, 'после долгого сворачивания требуется пароль');
await t.close();

console.log('E2E SECURITY OK');
