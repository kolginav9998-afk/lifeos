// R3.6: рефлексия (намерение дня, вечерний обзор, итоги недели, решения, радости), подсказки на «Сегодня».
import assert from 'node:assert/strict';
import { launch, tab, until } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);
const evs = type => page.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);
const inject = (fn, arg) => page.evaluate(`(async () => { const store = await import('./store.js'); const ev = await import('./events.js'); const dr = await import('./diary.js'); const rf = await import('./reflect.js'); const today = ev.todayStr(); const arg = ${JSON.stringify(arg ?? null)}; ${fn} })()`);

// ---------- намерение дня ----------
await tab(page, 'today');
assert.equal(await page.isVisible('#intent-form'), true);
await page.click('#intent-save');
await toast(/одну строку/);
await page.fill('#intent-input', 'Сначала самое тяжёлое');
await page.press('#intent-input', 'Enter');
await until(page, () => document.getElementById('intent-text'));
assert.equal(await text('#intent-text'), 'Сначала самое тяжёлое');
await page.click('#intent-edit');
assert.equal(await page.inputValue('#intent-input'), 'Сначала самое тяжёлое');
await page.fill('#intent-input', 'Только важное'); await page.press('#intent-input', 'Enter');
await until(page, () => document.getElementById('intent-text')?.textContent === 'Только важное');
assert.equal((await evs('intention')).length, 1, 'правка обновляет ту же запись');
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
assert.equal(await text('#intent-text'), 'Только важное', 'намерение пережило перезапуск');

// ---------- подсказки: перегруз, мало сил, долго низкое настроение ----------
assert.equal(await page.locator('.hint-card').count(), 0, 'без причин подсказок нет');
await inject(`await store.saveMany(Array.from({ length: 8 }, (_, i) => ev.makeTask('дело ' + i, Date.now() + i, { due: today })));`);
await until(page, () => document.getElementById('hint-overload'));
assert.match(await text('#hint-overload'), /8 дел/);
await page.click('#hint-overload .chip:has-text("Справлюсь")');
await until(page, () => !document.getElementById('hint-overload'));

await inject(`await store.save(dr.makeCheckin('m', today, { energy: 1, mood: 3 }, '', Date.now()));`);
await until(page, () => document.getElementById('hint-light'));
assert.match(await text('#hint-light'), /мало сил/);
assert.equal(await page.isVisible('#minimum'), false);
await page.click('#hint-light-on');
await until(page, () => !document.getElementById('minimum').hidden);
assert.equal(await page.locator('#hint-light').count(), 0, 'в тяжёлом дне подсказка исчезает');

await inject(`await store.saveMany(Array.from({ length: 10 }, (_, i) => dr.makeCheckin('m', ev.addDays(today, -(i + 1)), { mood: 2 }, '', Date.now() + i)));`);
await until(page, () => document.getElementById('hint-lowmood'));
assert.match(await text('#hint-lowmood'), /не слабость/);
assert.match(await text('#hint-lowmood'), /экстренную службу/);
await page.click('#hint-lowmood-hide');
await until(page, () => !document.getElementById('hint-lowmood'));
await page.click('#heavy-off');
await until(page, () => document.getElementById('minimum').hidden);

// ---------- «Рефлексия»: вечерний обзор ----------
await tab(page, 'reflect');
assert.equal(await text('#title'), 'Рефлексия');
assert.deepEqual(await page.locator('#subnav button').allTextContents(), ['Дневник', 'Здоровье', 'Тренировки', 'Заметки', 'Рефлексия']);
assert.equal(await page.locator('#lowmood').isHidden(), true, 'отложенное предупреждение не повторяется');
await page.click('#rv-save'); await toast(/хотя бы на один/);
await page.fill('#rv-win', 'Закрыл отчёт'); await page.fill('#rv-learn', 'Начинать с трудного');
await page.click('#rv-save'); await toast(/Обзор дня сохранён/);
assert.match(await text('#rv-state'), /сохранён/);
const rv = (await evs('dayreview'))[0];
assert.equal(rv.payload.win, 'Закрыл отчёт'); assert.equal('miss' in rv.payload, false);

// ---------- итоги недели ----------
assert.match(await text('#wk-label'), /Неделя с \d/);
await page.fill('#wk-went', 'Три тренировки'); await page.fill('#wk-change', 'Ложиться раньше');
await page.click('#wk-save'); await toast(/Итоги недели сохранены/);
await inject(`const w = rf.makeWeekReflection(ev.addDays(today, -7), { went: 'Закончил урок', blocked: 'Усталость' }, Date.now()); await store.save(w);`);
await until(page, () => !document.getElementById('wk-past').hidden);
await page.locator('#wk-past summary').click();
assert.match(await text('#wk-past'), /Закончил урок/);

// ---------- решения ----------
await page.locator('#dec-new').evaluate(d => { d.open = true; });
await page.fill('#dec-title', 'аб'); await page.click('#dec-add');
assert.match(await text('#dec-err'), /несколькими словами/);
await page.fill('#dec-title', 'Перейти на сменный график'); await page.fill('#dec-expect', 'Успею учиться вечером');
await page.click('#dec-add');
await until(page, () => document.querySelector('.dec'));
assert.match(await text('.dec'), /Перейти на сменный график/);
assert.match(await text('.dec .badge'), /до \d/);
assert.equal(await page.locator('.dec.due').count(), 0);
// срок возврата наступил → чип на «Сегодня»
await inject(`const d = store.state.events.find(e => e.type === 'decision'); await store.save({ ...d, payload: { ...d.payload, revisit: ev.addDays(today, -1) } });`);
await until(page, () => document.querySelector('.dec.due'));
assert.match(await text('.dec .badge'), /пора оценить/);
await tab(page, 'today');
assert.match(await text('#decision-chip'), /Решения: 1 пора оценить/);
await page.click('#decision-chip');
assert.equal(await text('#title'), 'Рефлексия');
await page.locator('.dec details summary').click();
await page.click('.dec .dec-close'); await toast(/как получилось/);
await page.selectOption('.dec .dec-verdict', 'better'); await page.fill('.dec .dec-outcome', 'Времени на учёбу стало больше');
await page.click('.dec .dec-close'); await toast(/Итог записан/);
await until(page, () => document.getElementById('dec-closed'));
assert.match(await text('#dec-closed summary'), /Оценённые \(1\)/);
assert.match(await text('#dec-stats'), /Оценено решений: 1\. Лучше ожиданий: 1/);
assert.equal(await page.locator('.dec').count(), 0);

// ---------- копилка радостей ----------
await page.fill('#joy-text', 'я'); await page.click('#joy-add');
assert.match(await text('#joy-err'), /несколько слов/);
await page.fill('#joy-text', 'Тёплый вечер на балконе'); await page.click('#joy-add');
await until(page, () => document.querySelector('.joy-row'));
await page.click('#joy-random');
assert.match(await text('#joy-pick'), /Тёплый вечер на балконе/);
await page.click('.joy-row .chip.danger');
await until(page, () => !document.querySelector('.joy-row'));
await page.click('#toast button');
await until(page, () => document.querySelector('.joy-row'));

// ---------- «что меня заряжает» ----------
const ideas = await page.locator('.chg-idea').allTextContents();
assert.equal(ideas.length, 5);
await page.locator('.chg-idea').first().click();
await until(page, () => document.querySelector('.chg-row'));
assert.ok(!(await page.locator('.chg-idea').allTextContents()).includes(ideas[0]), 'добавленная идея исчезает из подсказок');
assert.equal(await text('.chg-row'), ideas[0].replace('＋ ', '') + '✕');
await page.fill('#chg-text', 'Позвонить брату'); await page.click('#chg-add');
await until(page, () => document.querySelectorAll('.chg-row').length === 2);
await page.locator('.chg-row').first().locator('.chip.danger').click();
await until(page, () => document.querySelectorAll('.chg-row').length === 1);

// ---------- здоровье: режим болезни ----------
await tab(page, 'health');
assert.match(await text('#sick-card'), /Заболел или нет сил/);
await page.click('#sick-start'); await toast(/Режим болезни включён/);
await until(page, () => document.getElementById('sick-end'));
assert.match(await text('#sick-card'), /С .* · 1 день/);
await tab(page, 'today');
assert.match(await text('#sick-banner'), /привычки и серии на паузе/);
assert.equal(await page.locator('#test-chip').count(), 0, 'проверка дня отложена');
await tab(page, 'habits');
assert.equal(await page.isVisible('#habit-sick'), true);
await tab(page, 'health');
await page.click('#sick-end'); await toast(/Серии продолжатся/);
await until(page, () => document.getElementById('sick-start'));
await tab(page, 'today');
assert.equal(await page.locator('#sick-banner').count(), 0);
assert.equal(await page.locator('#test-chip').count(), 1, 'после выздоровления проверка снова доступна');
assert.equal((await evs('sick')).length, 1); assert.ok((await evs('sick'))[0].payload.to, 'период закрыт');

// ---------- здоровье: неделя замеров давления ----------
await tab(page, 'health');
assert.equal(await page.locator('#bp-protocol').isHidden(), true);
await page.evaluate(async () => {
  const store = await import('./store.js'); const ev = await import('./events.js'); const hl = await import('./health.js');
  const today = ev.todayStr();
  const m = (time, s, d, k) => hl.makeMeasure({ kind: 'bp', value: s, value2: d, date: today, time }, Date.now() + k);
  await store.saveMany([m('07:30', 124, 80, 1), m('07:31', 122, 78, 2), m('20:00', 130, 84, 3), m('20:02', 128, 82, 4)]);
});
await until(page, () => !document.getElementById('bp-protocol').hidden);
assert.match(await text('#bp-protocol'), /Замеров: 4\. Полных дней: 1 из 7/);
assert.match(await text('#bp-protocol'), /утром 123\/79 \(2\), вечером 129\/83 \(2\), всего 126\/81 \(4\)/);
assert.equal(await page.locator('.bp-day.full').count(), 1);
assert.equal(await page.locator('.bp-day').count(), 7);
assert.match(await text('#bp-protocol .hint'), /не меньше 12 замеров/);

// ---------- здоровье: календарь профилактики ----------
await page.locator('#chk-new').evaluate(d => { d.open = true; });
await page.fill('#chk-name', 'ab'); await page.fill('#chk-name', '');
await page.click('#chk-add'); assert.match(await text('#chk-err'), /Назови проверку/);
await page.locator('.chk-tpl').first().click();
assert.equal(await page.inputValue('#chk-name'), 'Стоматолог: осмотр и чистка');
assert.equal(await page.inputValue('#chk-months'), '6');
await page.click('#chk-add');
await until(page, () => document.querySelector('.chk-row'));
assert.equal(await page.getAttribute('.chk-row', 'data-state'), 'never');
assert.match(await text('.chk-row .badge'), /нет отметки/);
await tab(page, 'today');
assert.match(await text('#checkup-chip'), /Профилактика: 1/);
await page.click('#checkup-chip');
assert.equal(await text('#title'), 'Здоровье');
await page.click('.chk-today'); await toast(/Отмечено/);
await until(page, () => document.querySelector('.chk-row')?.dataset.state === 'ok');
assert.match(await text('.chk-row .badge'), /в порядке, до /);
await tab(page, 'today');
assert.equal(await page.locator('#checkup-chip').count(), 0);

// ---------- здоровье: данные на экстренный случай ----------
await tab(page, 'health');
assert.equal(await page.locator('#em-show').count(), 0);
await page.locator('#em-form-box').evaluate(d => { d.open = true; });
await page.click('#em-save'); assert.match(await text('#em-err'), /хотя бы одно/);
await page.selectOption('#em-blood', 'A (II) Rh+'); await page.fill('#em-allergies', 'пенициллин'); await page.fill('#em-contact', 'Анна'); await page.fill('#em-phone', 'abc');
await page.click('#em-save'); assert.match(await text('#em-err'), /Телефон/);
await page.fill('#em-phone', '+7 900 123-45-67'); await page.click('#em-save'); await toast(/Сохранено/);
await until(page, () => document.getElementById('em-show'));
assert.match(await text('#em-lines'), /Группа крови: A \(II\) Rh\+/);
assert.match(await text('#em-lines'), /Аллергии: пенициллин/);
await page.click('#em-show');
await until(page, () => !document.getElementById('em-overlay').hidden);
assert.match(await text('#em-overlay'), /пенициллин/);
assert.equal(await page.getAttribute('#em-call', 'href'), 'tel:+79001234567');
await page.click('#em-close');
assert.equal(await page.locator('#em-overlay').isHidden(), true);
assert.equal((await evs('emergency')).length, 1);

// ---------- учёба: «15 минут», конспект урока ----------
await tab(page, 'learn');
assert.match(await text('#fifteen'), /Режим «15 минут»/);
assert.match(await text('#fifteen-lesson-text'), /^1\. Урок: /);
assert.equal(await page.locator('#comeback').count(), 0, 'пока всё свежо — приветствия нет');
await page.click('#fifteen-lesson');
await until(page, () => document.querySelector('.lesson[open]'));
await page.fill('.lesson[open] .lesson-note', 'Главное: he works, she works');
await page.click('.lesson[open] .note-save'); await toast(/Конспект сохранён/);
await until(page, () => document.querySelector('.lesson[open] .lesson-note')?.value.includes('he works'));
assert.equal((await evs('lessonnote')).length, 1);
await page.fill('.lesson[open] .lesson-note', ''); await page.click('.lesson[open] .note-save'); await toast(/Конспект удалён/);
assert.equal((await evs('lessonnote')).length, 0);
await page.click('#toast button');
await until(page, () => document.querySelector('.lesson[open] .lesson-note')?.value.includes('he works'));
assert.equal((await evs('lessonnote')).length, 1, 'отмена возвращает конспект');
await page.click('#search-btn'); await page.fill('#search-input', 'he works');
await until(page, () => document.querySelector('.result:not(.course)'));
assert.match(await text('.result:not(.course)'), /Конспект/);
await page.click('#search-btn');

// ---------- учёба: сложные карточки и возвращение после пропуска ----------
await page.evaluate(async () => {
  const store = await import('./store.js'); const ac = await import('./academy.js'); const sr = await import('./srs.js'); const ev = await import('./events.js');
  const today = ev.todayStr(), back = n => ev.addDays(today, -n);
  const deck = ac.cardsOfTrack(ac.TRACKS[0]).filter(c => c.kind === 'deck').slice(0, 12);
  await store.saveMany([
    ...deck.slice(0, 2).map(c => ac.makeSrsEvent({ ...sr.newState(c.id, back(20)), box: 1, lapses: 4, due: ev.addDays(today, 2), last: back(6), hist: [[back(6), 0]] })),
    ...deck.slice(2, 12).map(c => ac.makeSrsEvent({ ...sr.newState(c.id, back(20)), box: 1, lapses: 0, due: today, last: back(6), hist: [[back(6), 2]] })),
  ]);
});
await tab(page, 'learn');
if (await page.locator('#learn-back').count()) await page.click('#learn-back');
await until(page, () => document.getElementById('comeback'));
assert.match(await text('#comeback'), /Ты не занимался 6 дн\., накопилось повторений: 10/);
assert.match(await text('#leeches'), /Сложные карточки \(2\)/);
assert.equal(await page.locator('.leech-row').count(), 2);
await page.click('#leech-start');
await until(page, () => !document.getElementById('sess').hidden);
assert.equal(await text('#sess-pos'), '1 / 2');
await page.click('#sess-close');
await page.click('#comeback-start');
await until(page, () => document.getElementById('sess-pos'));
assert.equal(await text('#sess-pos'), '1 / 10', 'после пропуска сессия короткая');
await page.click('#sess-close');
await page.locator('.leech-own').first().click();
assert.notEqual(await page.inputValue('#my-q'), '', 'заготовка своей карточки подставлена');
assert.notEqual(await page.inputValue('#my-a'), '');
await page.click('#learn-back');

// ---------- «О приложении» и простой режим ----------
await tab(page, 'more');
assert.match(await text('#diag'), /Запуск: интерфейс за \d+(,\d)? (мс|с)/);
assert.match(await text('#stats'), /всего записей: \d+/);
assert.equal(await page.locator('#tabs button').count(), 5);
await page.check('#simple-mode');
await until(page, () => document.querySelectorAll('#tabs button').length === 3);
assert.deepEqual(await page.locator('#tabs button span').allTextContents(), ['Сегодня', 'Дневник', 'Ещё']);
assert.equal(await text('#title'), 'Настройки', 'остаёмся на настройках');
await page.click('#tabs button[data-tab="today"]');
await until(page, () => !document.getElementById('view-today').hidden);
assert.deepEqual(await page.locator('#subnav button').allTextContents(), ['Задачи', 'Привычки']);
for (const id of ['focus-chip', 'learn-chip', 'test-chip', 'okr-chip']) assert.equal(await page.locator(`#${id}`).count(), 0, `${id} скрыт в простом режиме`);
assert.equal(await page.locator('#heavy-chip').count(), 1, '«Тяжёлый день» остаётся');
assert.equal(await page.locator('#review').isHidden(), true); assert.equal(await page.locator('#journal').isHidden(), true);
await page.click('#tabs button[data-tab="diary"]');
assert.deepEqual(await page.locator('#subnav button').allTextContents(), ['Дневник', 'Здоровье', 'Заметки']);
await page.click('#tabs button[data-tab="more"]');
await page.uncheck('#simple-mode');
await until(page, () => document.querySelectorAll('#tabs button').length === 5);
await page.click('#tabs button[data-tab="today"]');
assert.equal(await page.locator('#focus-chip').count(), 1, 'после выключения всё вернулось');
// выключаем простой режим, находясь на скрытом экране: приложение само уходит на «Сегодня»
await page.click('#tabs button[data-tab="more"]'); await page.check('#simple-mode');
await until(page, () => document.querySelectorAll('#tabs button').length === 3);
await page.evaluate(async () => { document.querySelector('#search-btn').click(); });
await page.fill('#search-input', 'сменный');
await until(page, () => document.querySelector('.result'));
await page.click('.result');
assert.equal(await text('#title'), 'Рефлексия', 'из поиска можно открыть и скрытый экран');
await page.click('#tabs button[data-tab="more"]'); await page.uncheck('#simple-mode');
await until(page, () => document.querySelectorAll('#tabs button').length === 5);

// ---------- поиск находит новые записи ----------
await page.click('#search-btn');
await page.fill('#search-input', 'сменный');
await until(page, () => document.querySelector('.result'));
assert.match(await text('.result'), /Решение/);
await page.click('.result');
assert.equal(await text('#title'), 'Рефлексия');

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E R3.6 OK');
