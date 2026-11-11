// R3.5: люди и даты, цели, привычки («кем становлюсь», пересмотр), дневник мыслей, отметка питания, шаблон смены.
import assert from 'node:assert/strict';
import { launch, tab, until } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);
const evs = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);
const dm = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`; };

// ---------- люди ----------
await tab(page, 'people');
assert.equal(await text('#title'), 'Люди');
assert.deepEqual(await page.locator('#subnav button').allTextContents(), ['Задачи', 'Привычки', 'Люди']);
assert.match(await text('#pp-soon'), /нет/);
await page.click('#pp-new summary');
await page.click('#pp-add');
assert.match(await text('#pp-err'), /Напиши имя/);
await page.fill('#pp-name', 'Анна'); await page.fill('#pp-bday', 'abc'); await page.click('#pp-add');
assert.match(await text('#pp-err'), /например 12\.03/);
await page.fill('#pp-bday', dm(3) + '.1990'); await page.selectOption('#pp-cad', '14'); await page.click('#pp-add');
await until(page, () => document.querySelector('.pp-bd'));
assert.match(await text('.pp-bd'), /Анна — .*через 3 дн\.\), исполнится \d+/);
assert.match(await text('#pp-due'), /Всё в порядке/);
// человек, которому давно не писали
await page.evaluate(async () => {
  const store = await import('./store.js'); const p = await import('./people.js');
  const ev = p.makePerson({ name: 'Борис', cadenceDays: 30 });
  ev.payload.createdDate = '2020-01-01'; ev.payload.lastContact = '2020-01-10';
  await store.save(ev);
});
await until(page, () => document.querySelector('.pp-due-row'));
assert.match(await text('.pp-due-row'), /Борис/);
await tab(page, 'today');
assert.match(await text('#bday-chip'), /🎂 Анна: через 3 дн\./);
assert.match(await text('#contact-chip'), /Написать: 1/);
await page.click('#contact-chip');
assert.equal(await text('#title'), 'Люди');
await page.click('.pp-contact');
await toast(/Отмечено: Борис/);
await until(page, () => !document.querySelector('.pp-due-row'));
await page.locator('details.pp', { hasText: 'Борис' }).locator('summary').click();
await page.locator('details.pp', { hasText: 'Борис' }).locator('.pp-note').fill('любит шахматы, подарить книгу');
await page.locator('details.pp', { hasText: 'Борис' }).locator('.pp-save').click();
await toast(/Сохранено/);
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
await tab(page, 'people');
await page.locator('details.pp', { hasText: 'Борис' }).locator('summary').click();
assert.equal(await page.locator('details.pp', { hasText: 'Борис' }).locator('.pp-note').inputValue(), 'любит шахматы, подарить книгу');
const bor = (await evs('person')).find(p => p.payload.name === 'Борис');
assert.ok(bor.payload.lastContact && bor.payload.lastContact > '2025');

// ---------- цели ----------
await tab(page, 'okr');
assert.equal(await text('#title'), 'Цели');
assert.deepEqual(await page.locator('#subnav button').allTextContents(), ['Учёба', 'Тесты', 'Аналитика', 'Цели']);
assert.match(await text('#view-okr h3'), /Цели · \d-й квартал \d{4}/);
await page.click('#okr-new summary');
assert.match(await page.inputValue('#okr-due'), /^\d{4}-\d{2}-\d{2}$/, 'срок по умолчанию — конец квартала');
await page.click('#okr-add');
assert.match(await text('#okr-err'), /Назови цель/);
await page.fill('#okr-title', 'Форма к лету'); await page.click('#okr-add');
assert.match(await text('#okr-err'), /хотя бы один/);
const kr = i => page.locator('.kr-row').nth(i);
await kr(0).locator('.kr-text').fill('Пробежать за период'); await kr(0).locator('.kr-target').fill('50'); await kr(0).locator('.kr-unit').fill('км');
await kr(1).locator('.kr-text').fill('Сбросить вес'); await kr(1).locator('.kr-target').fill('5'); await kr(1).locator('.kr-unit').fill('кг');
await page.click('#okr-add');
await until(page, () => document.querySelector('.okr'));
assert.match(await text('.okr .okr-line'), /Выполнено 0%/);
assert.equal(await page.locator('.okr .kr').count(), 2);
await page.locator('.okr .kr').first().locator('.kr-now').fill('25');
await page.locator('.okr .kr').first().locator('.kr-save').click();
await until(page, () => /25 из 50 км/.test(document.querySelector('.okr .kr-line')?.textContent ?? ''));
assert.match(await text('.okr .okr-line'), /Выполнено 25%/);
await tab(page, 'today');
assert.match(await text('#okr-chip'), /Цели: 1/);
await tab(page, 'okr');
await page.click('.okr .okr-done');
await toast(/Цель закрыта/);
await until(page, () => document.getElementById('okr-closed'));
assert.match(await text('#okr-closed summary'), /Закрытые \(1\)/);
assert.equal(await page.locator('.okr').count(), 0);

// ---------- привычки: «кем становлюсь» и ежемесячный пересмотр ----------
await tab(page, 'habits');
await page.locator('#habit-add').evaluate(d => { d.open = true; });
await page.fill('#habit-name', 'Зарядка'); await page.fill('#habit-identity', 'я человек, который двигается каждый день');
await page.click('#habit-form button[type=submit]');
await until(page, () => document.querySelector('.habit .h-identity'));
assert.equal(await text('.habit .h-identity'), 'Я — человек, который двигается каждый день');
assert.equal(await page.isHidden('#habit-review'), true, 'пересмотр не нужен, пока привычки моложе двух недель');
await page.evaluate(async () => {
  const store = await import('./store.js'); const h = await import('./habits.js'); const ev = await import('./events.js');
  const today = ev.todayStr();
  const mk = (name, hits) => { const x = h.makeHabit({ name }); x.payload.startDate = ev.addDays(today, -20); return [x, ...Array.from({ length: hits }, (_, i) => h.makeHabitLog(x, ev.addDays(today, -1 - i), 'min'))]; };
  await store.saveMany([...mk('Растяжка', 3), ...mk('Чтение', 19)]);
});
await until(page, () => !document.getElementById('habit-review').hidden);
await page.locator('#habit-review').evaluate(d => { d.open = true; });
assert.equal(await page.locator('.review-row').count(), 2, 'в пересмотре только привычки старше 14 дней');
assert.match(await text('.review-row[data-advice="ease"]'), /Растяжка — 14% за 30 дн\. \(3 из 21\)/);
assert.match(await text('.review-row[data-advice="ease"] .hint'), /слишком тяжело/);
assert.match(await text('.review-row[data-advice="keep"]'), /Чтение — 90%/);
await page.click('.review-row[data-advice="ease"] .rv-arch');
await until(page, () => document.querySelectorAll('.review-row').length === 1);
assert.equal(await page.locator('#habit-archive .habit', { hasText: 'Растяжка' }).count(), 1, 'архивная привычка не теряется');
await page.click('#habit-review-done');
await toast(/Следующий пересмотр/);
assert.equal(await page.evaluate(async () => (await import('./prefs.js')).getPref('habitReview') === (await import('./events.js')).todayStr().slice(0, 7)), true);

// ---------- вечер: быстрая отметка питания ----------
await tab(page, 'diary');
await page.locator('#ci-e').evaluate(d => { d.open = true; });
assert.equal(await page.locator('#ci-flags input[type=checkbox]').count(), 3);
await page.check('#ci-flag-veg'); await page.check('#ci-flag-protein');
await page.click('#ci-e-save'); await toast(/Вечер сохранён/);
const ce = (await evs('checkin')).find(e => e.payload.slot === 'e');
assert.equal(ce.payload.veg, true); assert.equal(ce.payload.protein, true); assert.equal('sweets' in ce.payload, false, 'невыбранное не записывается');
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
await tab(page, 'diary');
await page.locator('#ci-e').evaluate(d => { d.open = true; });
await until(page, () => document.getElementById('ci-flag-veg').checked);
assert.equal(await page.isChecked('#ci-flag-protein'), true);
assert.equal(await page.isChecked('#ci-flag-sweets'), false);
await page.check('#ci-flag-sweets'); await page.uncheck('#ci-flag-veg');
await page.click('#ci-e-save'); await toast(/Вечер сохранён/);
const ce2 = (await evs('checkin')).find(e => e.payload.slot === 'e');
assert.equal(ce2.id, ce.id, 'повторное сохранение обновляет ту же запись'); assert.equal(ce2.payload.sweets, true); assert.equal('veg' in ce2.payload, false);

// ---------- дневник мыслей ----------
await tab(page, 'health');
assert.match(await text('#thought-card'), /не лечение/);
await page.locator('#th-form-box').evaluate(d => { d.open = true; });
await page.click('#th-add');
assert.match(await text('#th-err'), /Запиши мысль/);
await page.fill('#th-thought', 'Он мной недоволен'); await page.fill('#th-before', '11'); await page.click('#th-add');
assert.equal(await page.evaluate(() => document.getElementById('th-before').validity.rangeOverflow), true, 'браузер не даёт отправить оценку больше 10');
assert.equal((await evs('thought')).length, 0);
await page.fill('#th-situation', 'Начальник не ответил на письмо'); await page.selectOption('#th-emotion', 'тревога'); await page.fill('#th-before', '8');
await page.fill('#th-alt', 'Он, скорее всего, просто занят'); await page.fill('#th-after', '4');
await page.click('#th-add'); await toast(/Записано/);
await until(page, () => document.querySelector('.th-row'));
assert.match(await text('.th-row'), /тревога · 8 → 4/);
assert.match(await text('.th-row'), /Мысль: Он мной недоволен — Иначе: Он, скорее всего, просто занят/);
assert.match(await text('#th-stats'), /Стало легче 1 из 1 раз \(в среднем на 4 балла из 10\)/);
assert.equal(await page.inputValue('#th-thought'), '', 'форма очищена после записи');
await page.click('.th-row .chip.danger');
await until(page, () => !document.querySelector('.th-row'));
await page.click('#toast button');
await until(page, () => document.querySelector('.th-row'));
await tab(page, 'today');
await page.click('#journal summary');
assert.ok((await page.locator('#journal-list .j-kind').allTextContents()).includes('Мысль'));
assert.match(await text('#journal-list'), /тревога: Он мной недоволен/, 'мысль видна в журнале дня');

// ---------- заметки: передача смены ----------
await tab(page, 'notes');
await page.selectOption('#note-tpl', 'shift');
const shift = await page.inputValue('#note-input');
assert.match(shift, /^Смена: \S/); assert.match(shift, /Передаю следующей смене:/); assert.match(shift, /#работа #смена/);

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.5 OK');
