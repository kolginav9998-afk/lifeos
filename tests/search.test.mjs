// Поиск по всем данным: каждый вид записи находится по своему тексту и ведёт на свой экран.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { searchEvents, describeEvent, TAB_OF, normalize } from '../search.js';

let n = 0;
const ev = (type, payload, ts = 1000) => ({ id: `${type}-${++n}`, type, ts, payload, source: 'manual', confidence: 1, evidence: [] });
const D = '2026-11-01';

// [тип, содержимое, запрос, вид в списке, начало подписи]
const CASES = [
  ['diary', { date: D, text: 'Первая строка\nвторая', highlight: '', gratitude: ['кофе'], tags: ['работа'] }, 'работа', 'Дневник', 'Первая строка'],
  ['diary', { date: D, text: 'текст', highlight: 'Главное событие', gratitude: [] }, 'главное', 'Дневник', 'Главное событие'],
  ['measure', { kind: 'custom', name: 'Страниц', value: 25, unit: 'стр', date: D }, 'страниц', 'Замер', 'Страниц 25'],
  ['measure', { kind: 'bp', value: 120, value2: 80, date: D, note: 'после кофе' }, 'после кофе', 'Замер', 'bp 120/80'],
  ['workout', { name: 'Дом A', date: D, exercises: [{ name: 'Приседания', sets: [] }] }, 'приседания', 'Тренировка', 'Дом A · 2026-11-01'],
  ['goal', { title: 'Отпуск', targetMinor: 1 }, 'отпуск', 'Цель', 'Отпуск'],
  ['sub', { name: 'Музыка' }, 'музыка', 'Подписка', 'Музыка'],
  ['experiment', { title: 'Без кофе', change: 'не пить кофе после обеда' }, 'после обеда', 'Эксперимент', 'Без кофе'],
  ['focus', { label: 'Отчёт', minutes: 25, date: D }, 'отчёт', 'Фокус', 'Отчёт · 25 мин'],
  ['ucard', { q: 'take off', a: 'взлетать', hint: 'самолёт' }, 'самолет', 'Карточка', 'take off'],
  ['person', { name: 'Мама', note: 'позвонить' }, 'позвонить', 'Человек', 'Мама'],
  ['okr', { title: 'Здоровье', why: 'энергия', krs: [{ text: 'бегать три раза' }] }, 'бегать', 'Цель квартала', 'Здоровье'],
  ['thought', { situation: 'совещание', thought: 'я не справлюсь', emotion: 'тревога', alt: 'я готов' }, 'совещание', 'Мысль', 'я не справлюсь'],
  ['intention', { text: 'Выйти на прогулку' }, 'прогулку', 'Намерение', 'Выйти на прогулку'],
  ['dayreview', { win: 'закончил отчёт', miss: '', learn: '', date: D }, 'закончил', 'Обзор дня', 'закончил отчёт'],
  ['dayreview', { win: '', miss: '', learn: 'планировать', date: D }, 'планировать', 'Обзор дня', 'планировать'],
  ['weekreflect', { went: 'зарядка', blocked: '', change: '', week: '2026-10-26' }, 'зарядка', 'Итоги недели', 'зарядка'],
  ['decision', { title: 'Сменить работу', why: 'рост', expect: '', closed: { outcome: 'остался' } }, 'остался', 'Решение', 'Сменить работу'],
  ['lessonnote', { lesson: 'en-01', text: 'повторить слова', date: D }, 'повторить слова', 'Конспект', null],
  ['skill', { title: 'SQL', area: 'Работа', note: '', evidence: 'проект с отчётами' }, 'отчётами', 'Навык', 'SQL'],
  ['parked', { text: 'Купить лампу' }, 'лампу', 'Отложено', 'Купить лампу'],
  ['wish', { text: 'Новые наушники' }, 'наушники', 'Хочу купить', 'Новые наушники'],
  ['debt', { who: 'Иван', note: 'за билеты' }, 'билеты', 'Долг', 'Иван — за билеты'],
  ['debt', { who: 'Пётр', note: '' }, 'петр', 'Долг', 'Пётр'],
  ['joy', { text: 'Тёплый чай' }, 'теплый чай', 'Радость', 'Тёплый чай'],
  ['checkin', { slot: 'm', date: D, note: 'выспался' }, 'выспался', 'Утро', 'выспался'],
  ['checkin', { slot: 'e', date: D, note: 'устал' }, 'устал', 'Вечер', 'устал'],
];

test('поиск: каждый вид записи находится по своему тексту, подпись и экран верные, ё и е не различаются', () => {
  for (const [type, payload, query, kind, title] of CASES) {
    const e = ev(type, payload);
    const found = searchEvents([e], query);
    assert.equal(found.length, 1, `${type}: «${query}»`);
    assert.equal(found[0].kind, kind, type);
    assert.equal(found[0].tab, TAB_OF[type], `${type}: экран`);
    if (title !== null) assert.equal(found[0].title, title, type); else assert.match(found[0].title, /: повторить слова$/, 'у конспекта в подписи название урока');
    assert.deepEqual(describeEvent(e), { kind, title: found[0].title.slice(0, 60) }, `${type}: описание для списка отличий`);
  }
});

test('поиск: записи без текста для поиска и незнакомые типы не находятся, но описываются', () => {
  const none = [ev('focus', { minutes: 25, date: D }), ev('checkin', { slot: 'm', date: D, note: '' }), ev('profile', { name: 'ёлка' }), ev('weird', { text: 'ёлка' })];
  assert.deepEqual(searchEvents(none, 'ёлка 25 выспался'), []);
  assert.deepEqual(searchEvents(none, '25'), [], 'фокус без названия не ищется даже по минутам');
  assert.deepEqual(describeEvent(none[3]), { kind: 'weird', title: '' }, 'незнакомый тип старой или новой версии');
  assert.deepEqual(describeEvent(none[0]), { kind: 'focus', title: '' });
  assert.equal(describeEvent(ev('task', { text: 'я'.repeat(100) })).title.length, 60, 'подпись в списке отличий обрезается');
});

test('поиск: все слова должны встретиться, новые записи выше, лимит, пустой и странный запрос', () => {
  const a = ev('task', { text: 'купить хлеб и молоко' }, 100), b = ev('note', { text: 'хлеб у дома\nмолоко тоже' }, 300), c = ev('task', { text: 'хлеб' }, 200);
  assert.deepEqual(searchEvents([a, b, c], 'хлеб').map(r => r.ev), [b, c, a], 'сначала самые новые');
  assert.deepEqual(searchEvents([a, b, c], 'ХЛЕБ  Молоко').map(r => r.ev), [b, a], 'оба слова, регистр и лишние пробелы не важны');
  assert.equal(searchEvents([a, b, c], 'хлеб', 2).length, 2);
  assert.equal(searchEvents([a, b, c], 'хлеб', 0).length, 0);
  for (const q of ['', '   ', null, undefined]) assert.deepEqual(searchEvents([a], q), [], String(q));
  assert.equal(searchEvents([a], 'хле').length, 1, 'ищется по части слова');
  assert.equal(searchEvents([a], 'сыр хлеб').length, 0);
  assert.equal(normalize('ЁжИк'), 'ежик'); assert.equal(normalize(null), '');
  const long = ev('note', { text: 'ж'.repeat(900) });
  assert.equal(searchEvents([long], 'ж')[0].title.length, 500, 'подпись результата не длиннее предела текста');
});

test('поиск: каждый вид записи ведёт на существующий экран приложения', () => {
  const views = new Set([...fs.readFileSync(path.join(import.meta.dirname, '..', 'app.js'), 'utf8').matchAll(/\{ id: '(\w+)', group:/g)].map(m => m[1]));
  assert.ok(views.size >= 15, `экранов в app.js: ${views.size}`);
  for (const [type, tab] of Object.entries(TAB_OF)) assert.ok(views.has(tab), `${type} → «${tab}»: такого экрана нет`);
  for (const [type] of CASES) assert.ok(TAB_OF[type], `у типа ${type} есть экран`);
});
