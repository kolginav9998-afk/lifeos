// «Вечный» HTML-архив: экранирование, детерминизм, выгрузка JSON обратно, суммы денег.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtmlArchive, moneyMonths, moneyTotalText } from '../export-html.js';
import { REGISTRY } from '../registry.js';

const ev = (id, type = 'note', payload = { text: id }, ts = 1000) => ({ id, type, ts, payload, source: 'manual', confidence: 1, evidence: [] });
const META = { exportedAt: 1_763_000_000_000, version: 'R4.1' };

// Достаём встроенные в файл данные так, как их прочитает браузер.
const extract = (html, name) => {
  const line = html.split('\n').find(l => l.startsWith(`const ${name} = `));
  assert.ok(line, `в файле есть ${name}`);
  return JSON.parse(line.slice(`const ${name} = `.length, -1));
};

test('запись с «</script>» и картинкой с onerror не ломает и не заражает файл', () => {
  const evil = ev('evil', 'note', { text: 'текст </script><img src=x onerror="alert(1)"> и <b>теги</b>' });
  const html = buildHtmlArchive([evil], META);
  assert.equal(html.split('</script').length - 1, 1, 'единственный закрывающий <script> — наш собственный');
  assert.ok(!html.includes('onerror="alert(1)"'), 'обработчик из записи не попал в файл как разметка');
  assert.ok(html.includes('\\u003c/script>'), 'опасная последовательность экранирована');
  // Данные читаются обратно без потерь — в точности как записал пользователь.
  const data = extract(html, 'DATA');
  assert.equal(data.events[0].payload.text, evil.payload.text);
});

test('детерминизм: один вход — одинаковый выход; порядок записей не влияет', () => {
  const a = ev('a', 'task', { text: 'задача', done: false }, 100);
  const b = ev('b', 'diary', { date: '2026-11-01', text: 'день' }, 50);
  const c = ev('c', 'expense', { amountMinor: 990, category: 'Еда', note: '', date: '2026-11-02' }, 200);
  const h1 = buildHtmlArchive([a, b, c], META);
  const h2 = buildHtmlArchive([a, b, c], META);
  assert.equal(h1, h2, 'повторная сборка даёт тот же файл');
  assert.equal(buildHtmlArchive([c, a, b], META), h1, 'тот же набор в другом порядке — тот же файл');
  // А другая дата генерации — другой файл: дата берётся из meta, а не из часов.
  assert.notEqual(buildHtmlArchive([a, b, c], { ...META, exportedAt: META.exportedAt + 1000 }), h1);
});

test('кнопка «Скачать исходный JSON» на месте, данные в файле — готовый архив приложения', () => {
  const html = buildHtmlArchive([ev('n1')], META);
  assert.ok(html.includes('Скачать исходный JSON'));
  assert.ok(html.includes('new Blob([JSON.stringify(DATA'), 'выгрузка собирает исходный JSON из встроенных данных');
  assert.ok(html.includes("a.download='lifeos-archive-'"), 'файлу выгрузки даётся имя архива');
  const data = extract(html, 'DATA');
  assert.deepEqual(Object.keys(data), ['app', 'schema', 'exportedAt', 'version', 'prefs', 'events']);
  assert.equal(data.app, 'lifeos');
  assert.equal(data.exportedAt, META.exportedAt);
  assert.equal(data.version, META.version);
});

test('суммы денег: расход/доход по месяцам считаются верно, мусор пропускается', () => {
  const events = [
    ev('x1', 'expense', { amountMinor: 10050, category: 'Еда', note: '', date: '2026-11-03' }, 1),
    ev('x2', 'expense', { amountMinor: 20000, category: 'Жильё', note: '', date: '2026-11-20' }, 2),
    ev('i1', 'income', { amountMinor: 300000, category: 'Зарплата', note: '', date: '2026-10-25' }, 3),
    ev('i2', 'income', { amountMinor: 100000, category: 'Подарок', note: '', date: '2026-11-01' }, 4),
    ev('bad1', 'expense', { amountMinor: 5.5, category: 'Еда', note: '', date: '2026-11-03' }, 5),   // дробные копейки — повреждена
    ev('bad2', 'expense', { amountMinor: 100, category: 'Еда', note: '' }, 6),                       // без даты
    ev('n', 'note', { text: 'не деньги' }, 7),
  ];
  assert.deepEqual(moneyMonths(events), [
    { month: '2026-10', expense: 0, income: 300000 },
    { month: '2026-11', expense: 30050, income: 100000 },
  ]);
  const total = moneyTotalText(events);
  assert.equal(total.expense, 30050);
  assert.equal(total.income, 400000);
  assert.equal(total.expenseText, '300,50 ₽');
  assert.equal(total.incomeText, '4 000 ₽');
  // Суммы видны и внутри файла — таблицу рисует встроенный движок.
  const view = extract(buildHtmlArchive(events, META), 'VIEW');
  assert.deepEqual(view.money, moneyMonths(events));
});

test('все типы реестра известны движку и проходят через файл без потерь', () => {
  const events = Object.keys(REGISTRY).map((type, i) => ev(`id-${type}`, type, { text: `запись ${type}` }, 1000 + i));
  const html = buildHtmlArchive(events, META);
  const data = extract(html, 'DATA');
  const view = extract(html, 'VIEW');
  assert.deepEqual(data.events, events.slice().sort((x, y) => x.ts - y.ts || x.id.localeCompare(y.id)));
  for (const [type, r] of Object.entries(REGISTRY)) assert.deepEqual(view.types[type], { label: r.label, group: r.group });
  assert.ok(view.groups.length > 5, 'разделы из реестра перечислены');
  assert.ok(html.includes('по типу записи') === false, 'лишнего нет'); // разумность: фильтр — через select
  assert.ok(html.includes('aria-label="Тип записи"'), 'фильтр по типу присутствует');
  assert.ok(html.includes('id="f-from"') && html.includes('id="f-to"'), 'фильтр по датам присутствует');
  assert.ok(html.includes('type="search"'), 'поиск по тексту присутствует');
});

test('сгенерированный файл безопасен: ни внешних адресов, ни опасных конструкций в движке', () => {
  const html = buildHtmlArchive([ev('n1', 'note', { text: 'сайт https://example.com и картинка <img src=x>' })], META);
  // Адреса могут встречаться только внутри экранированных данных (как текст записи), но не как разметка движка.
  const data = extract(html, 'DATA');
  assert.equal(data.events[0].payload.text, 'сайт https://example.com и картинка <img src=x>');
  const withoutData = html.replace(/const DATA = .+;\n/, '').replace(/const VIEW = .+;\n/, '');
  assert.ok(!/https?:\/\//.test(withoutData), 'в разметке и движке нет внешних адресов');
  assert.ok(!/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(/.test(html), 'движок строит DOM только через textContent');
});

test('пустой набор и крупный набор: файл собирается и не падает', () => {
  const empty = buildHtmlArchive([], META);
  assert.ok(empty.includes('Записей: 0.'));
  const big = Array.from({ length: 50000 }, (_, i) => ev(`b${i}`, i % 2 ? 'expense' : 'income', { amountMinor: i % 1000, category: 'Еда', note: '', date: `2026-${String(i % 12 + 1).padStart(2, '0')}-15` }, i));
  const t0 = performance.now();
  const html = buildHtmlArchive(big, META);
  const ms = performance.now() - t0;
  assert.ok(html.length > 2_000_000, `файл собрался (${html.length} байт)`);
  assert.ok(ms < 10000, `50 000 записей собраны за ${Math.round(ms)} мс`);
  assert.equal(extract(html, 'DATA').events.length, 50000);
});
