import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, tab, until } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const count = sel => page.locator(sel).count();
const waitCount = (sel, n) => until(page, ([s, k]) => document.querySelectorAll(s).length === k, [sel, n]);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);
const rate = (box, field, v) => page.click(`${box} .rate[data-field="${field}"][data-v="${v}"]`);
const plus = (box, field, label, n = 1) => { const sel = `${box} .stepper[data-field="${field}"] button[aria-label="${label}: больше"]`; return (async () => { for (let i = 0; i < n; i++) await page.click(sel); })(); };
const dateStr = off => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- навигация: новая группа вкладок ----------
await tab(page, 'diary');
assert.equal(await text('#title'), 'Дневник');
assert.deepEqual(await page.locator('#subnav button').allTextContents(), ['Дневник', 'Здоровье', 'Заметки']);
assert.equal(await page.locator('#tabs button').count(), 4);

// ---------- утро ----------
await page.locator('#ci-m').evaluate(d => { d.open = true; });
await page.fill('#ci-bed', '23:30'); await page.fill('#ci-wake', '07:00');
assert.equal(await text('#ci-m .stepper[data-field="sleepHours"] .step-val'), '7,5 ч', 'сон посчитан по времени');
await rate('#ci-m', 'sleepQuality', 4); await rate('#ci-m', 'energy', 3); await rate('#ci-m', 'mood', 4); await rate('#ci-m', 'stress', 2);
assert.equal(await page.getAttribute('#ci-m .rate[data-field="mood"][data-v="4"]', 'aria-pressed'), 'true');
await rate('#ci-m', 'mood', 4);                                        // повторный тап снимает оценку
assert.equal(await page.getAttribute('#ci-m .rate[data-field="mood"][data-v="4"]', 'aria-pressed'), 'false');
await rate('#ci-m', 'mood', 4);
await page.fill('#ci-weight', '72,4');
await page.click('#ci-m-save'); await toast(/Утро сохранено/);
assert.match(await text('#ci-m-sum'), /Утро ✓ · сон 7,5 ч/);

// ---------- вечер ----------
await page.locator('#ci-e').evaluate(d => { d.open = true; });
await rate('#ci-e', 'mood', 3); await rate('#ci-e', 'focus', 5); await rate('#ci-e', 'stress', 4);
await plus('#ci-e', 'caffeine', 'Кофе / чай', 2); await plus('#ci-e', 'exercise', 'Тренировка', 1);
assert.equal(await text('#ci-e .stepper[data-field="caffeine"] .step-val'), '2 чаш.');
assert.equal(await text('#ci-e .stepper[data-field="exercise"] .step-val'), '30 мин');
await page.click('#ci-e .stepper[data-field="caffeine"] button[aria-label="Кофе / чай: меньше"]');
assert.equal(await text('#ci-e .stepper[data-field="caffeine"] .step-val'), '1 чаш.');
await page.fill('#ci-e-note', 'помогла прогулка');
await page.click('#ci-e-save'); await toast(/Вечер сохранён/);

// ---------- запись дня ----------
await page.fill('#diary-text', 'Хороший день, сделал много. #работа #спорт');
assert.equal(await page.locator('#diary-tags .tag').count(), 2);
await page.fill('#diary-highlight', 'Запустил проект'); await page.fill('#diary-g1', 'здоровье'); await page.fill('#diary-g2', 'семья');
await page.click('#diary-save'); await toast(/Запись сохранена/);
assert.match(await text('#diary-box summary'), /Дневник ✓/);
assert.equal(await page.locator('#diary-delete').isVisible(), true);

// ---------- история и переход по дням ----------
await until(page, () => document.querySelector('#diary-history .hist-row .hist-snip')?.textContent.includes('Хороший день'));
assert.match(await text('#diary-history .hist-row:first-child'), /☺ 3[,.]5/, 'настроение дня — среднее по утру и вечеру (4 и 3)');
assert.equal(await count('#mood-strip .mood-dot'), 14);
await page.click('#diary-prev');
assert.equal(await page.inputValue('#diary-date'), dateStr(-1));
assert.equal(await page.inputValue('#diary-text'), '', 'на вчера записи нет');
await page.fill('#diary-text', 'вчерашняя запись'); await page.click('#diary-save'); await toast(/Запись сохранена/);
await page.click('#diary-today');
assert.match(await page.inputValue('#diary-text'), /Хороший день/);

// сохранённое переживает перезапуск
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
await tab(page, 'diary');
assert.match(await page.inputValue('#diary-text'), /Хороший день/);
assert.equal(await page.inputValue('#ci-weight'), '72,4');
assert.equal(await page.inputValue('#ci-bed'), '23:30');
assert.equal(await page.getAttribute('#ci-e .rate[data-field="focus"][data-v="5"]', 'aria-pressed'), 'true');

// невалидные значения не сохраняются
await page.locator('#ci-m').evaluate(d => { d.open = true; });
await page.fill('#ci-weight', 'много'); await page.click('#ci-m-save'); await toast(/число/);
await page.fill('#ci-weight', '72,4');

// ---------- здоровье ----------
await tab(page, 'health');
assert.equal(await text('#title'), 'Здоровье');
await until(page, () => document.querySelector('.mcard[data-key="weight"]'));
assert.match(await text('.mcard[data-key="weight"] .big2'), /72,4\s?кг/, 'вес из утренней отметки появился в замерах');
const addMeasure = async (kind, v, v2, date) => {
  await page.selectOption('#ms-kind', kind); await page.fill('#ms-value', v); if (v2) await page.fill('#ms-value2', v2); if (date) await page.fill('#ms-date', date);
  await page.click('#ms-add');
  await until(page, () => document.getElementById('ms-value').value === '' && document.getElementById('toast').textContent !== 'x');   // форма очистилась — замер сохранён
};
await addMeasure('weight', '73,0', null, dateStr(-9)); await addMeasure('weight', '72,6', null, dateStr(-5)); await addMeasure('weight', '72,0', null, dateStr(-1));
await until(page, () => /Записи \(4\)/.test(document.querySelector('.mcard[data-key="weight"]')?.textContent ?? ''));
assert.ok(await count('.mcard[data-key="weight"] svg.spark polyline') >= 1, 'график построен');
assert.match(await text('.mcard[data-key="weight"]'), /7 дн\.: −/, 'динамика за неделю');
assert.match(await text('.mcard[data-key="weight"]'), /тренд: −/, 'тренд в неделю');
await addMeasure('bp', '120', '80'); await addMeasure('pulse', '58');
await until(page, () => document.querySelector('.mcard[data-key="bp"]'));
assert.match(await text('.mcard[data-key="bp"] .big2'), /120\/80/);
assert.match(await text('#health-summary'), /Давление за 7 дней: в среднем 120\/80/);
await page.fill('#ms-value', '60'); await page.selectOption('#ms-kind', 'bp'); await page.fill('#ms-value2', '90'); await page.click('#ms-add');
await toast(/Верхнее давление должно быть больше нижнего/);
await page.click('#ms-form .cancel').catch(() => {}); await page.fill('#ms-value', ''); await page.fill('#ms-value2', '');
await page.selectOption('#ms-kind', 'custom'); await page.fill('#ms-name', 'Страниц'); await page.fill('#ms-unit', 'стр'); await page.fill('#ms-value', '25'); await page.click('#ms-add');
await until(page, () => document.querySelector('.mcard[data-key="custom:страниц"]'));

// правка и удаление с отменой
await page.locator('.mcard[data-key="pulse"] details summary').click();
await page.locator('.mcard[data-key="pulse"] .hist-row').first().click();
assert.equal(await text('#ms-form strong'), 'Изменить замер');
await page.fill('#ms-value', '55'); await page.click('#ms-add');
await until(page, () => /55/.test(document.querySelector('.mcard[data-key="pulse"] .big2')?.textContent ?? ''));
await page.locator('.mcard[data-key="pulse"] .del').first().click();
await until(page, () => !document.querySelector('.mcard[data-key="pulse"]'));
await toast(/Замер удалён/); await page.click('#toast button');
await until(page, () => document.querySelector('.mcard[data-key="pulse"]'));

// профиль здоровья и ориентиры
await page.click('#hp-box summary');
await page.fill('#hp-height', '180'); await page.fill('#hp-birth', '1990'); await page.fill('#hp-goal', '70'); await page.click('#hp-save'); await toast(/Сохранено/);
await until(page, () => /ИМТ 22,3/.test(document.getElementById('health-summary').textContent));
assert.match(await text('#health-summary'), /в пределах ориентира/);
assert.match(await text('#health-summary'), /До цели 2 кг вниз|До цели 2[,.]\d+ кг вниз/);
assert.match(await text('#health-summary'), /Сон за 7 дней: в среднем 7,5 ч/);
assert.match(await text('#health-summary'), /Возраст: 36/);

const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#health-csv')]);
const csvText = fs.readFileSync(await csv.path(), 'utf8');
assert.ok(csvText.startsWith('﻿Дата;Время;Показатель;Значение;Значение 2;Единицы;Комментарий'));
assert.ok(csvText.includes(';Вес;72,4;;кг;') && csvText.includes(';Давление;120;80;') && csvText.includes(';Страниц;25;;стр;'));

// профиль не затёр имя (переименование в «Настройках» сохраняет поля здоровья)
await tab(page, 'more'); await page.fill('#profile-name', 'Алекс'); await page.press('#profile-name', 'Enter');
await tab(page, 'health'); await page.click('#hp-box summary').catch(() => {});
assert.equal(await page.inputValue('#hp-height'), '180', 'поля здоровья сохранились при смене имени');

// ---------- поиск и журнал дня ----------
await page.click('#search-btn'); await page.fill('#search-input', 'работа');
await until(page, () => document.querySelectorAll('#search-results .result').length >= 1);
assert.match(await text('#search-results'), /Дневник/);
await page.fill('#search-input', 'страниц');
await until(page, () => /Замер/.test(document.getElementById('search-results').textContent));
await page.click('#search-results .result');
assert.equal(await text('#title'), 'Здоровье');
await tab(page, 'today'); await page.click('#journal summary');
const kinds = await page.locator('#journal-list .j-kind').allTextContents();
for (const k of ['Утро', 'Вечер', 'Дневник', 'Замер']) assert.ok(kinds.includes(k), `в журнале дня есть «${k}»`);

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E HEALTH OK');
