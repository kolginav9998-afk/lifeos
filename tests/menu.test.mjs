// Меню «Куда зайти»: каталог разделов согласован с экранами приложения, поиск находит раздел по обычным словам.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MENU_SECTIONS, menuItems, searchMenu } from '../menu.js';

const root = path.resolve(import.meta.dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const defIds = [...app.matchAll(/^\s*\{ id: '([a-z]+)', group: '([a-z]+)'/gm)].map(m => ({ id: m[1], group: m[2] }));
const groupIds = [...app.slice(app.indexOf('const GROUPS')).matchAll(/\{ id: '([a-z]+)', label:/g)].map(m => m[1]);

test('меню: каждый пункт ведёт на существующий экран, и ни один экран не потерян', () => {
  const ids = new Set(defIds.map(d => d.id));
  assert.ok(ids.size >= 20, 'экраны найдены в app.js');
  const items = menuItems();
  for (const i of items) assert.ok(ids.has(i.screen), `экрана «${i.screen}» нет в app.js`);
  assert.deepEqual([...ids].filter(id => id !== 'menu' && !items.some(i => i.screen === id)), [], 'экран без плитки в меню: добавь его в menu.js (сам «menu» — это и есть список)');
  assert.equal(new Set(items.map(i => i.screen)).size, items.length, 'один экран — одна плитка');
});

test('меню: у каждого пункта простое название, подсказка и слова для поиска; разделы не пустые', () => {
  for (const s of MENU_SECTIONS) {
    assert.ok(s.title && s.icon && s.items.length >= 1, s.key);
    for (const i of s.items) {
      assert.ok(i.title.length >= 4 && i.title.length <= 40, i.title);
      assert.ok(i.hint.length >= 10 && i.hint.length <= 110 && !/[a-z]{4,}/i.test(i.hint.replace(/OKR|iq/gi, '')), `подсказка «${i.hint}»`);
      assert.ok(i.words.length >= 3, `${i.screen}: мало слов для поиска`);
    }
  }
  assert.equal(new Set(MENU_SECTIONS.map(s => s.key)).size, MENU_SECTIONS.length);
});

test('нижняя панель: пять вкладок, первый экран «Меню» — сам список разделов', () => {
  assert.deepEqual(groupIds, ['today', 'home', 'money', 'grow', 'more']);
  for (const g of groupIds) assert.ok(defIds.some(d => d.group === g), `в группе ${g} нет экранов`);
  assert.equal(defIds.find(d => d.group === 'more').id, 'menu');
});

test('поиск по меню: слова из жизни находят нужный раздел', () => {
  const first = q => searchMenu(q)[0]?.screen;
  assert.equal(first('зарплата'), 'salary');
  assert.equal(first('зарплату'), 'salary');
  assert.equal(first('налог'), 'salary');
  assert.equal(first('переработки'), 'salary');
  assert.equal(first('стирка'), 'home');
  assert.equal(first('одежда'), 'home');
  assert.equal(first('расходы'), 'money');
  assert.equal(first('смена'), 'schedule');
  assert.equal(first('график работы'), 'schedule');
  assert.equal(first('английский'), 'zero');
  assert.equal(first('скороговорки'), 'diction');
  assert.equal(first('iq'), 'tests');
  assert.equal(first('пароль'), 'account');
  assert.equal(first('архив'), 'more');
  assert.ok(searchMenu('привычки').some(i => i.screen === 'habits'));
  assert.deepEqual(searchMenu('qwertyuiop'), []);
  assert.deepEqual(searchMenu('   '), []);
  assert.deepEqual(searchMenu('я'), [], 'одна буква не ищет');
  assert.ok(searchMenu('день рождения').some(i => i.screen === 'people'));
});

test('поиск по меню: порядок по весу, название важнее подсказки, не больше лимита', () => {
  const res = searchMenu('деньги');
  assert.equal(res[0].screen, 'money');
  assert.ok(searchMenu('а', undefined, 3).length <= 3);
  assert.ok(searchMenu('список', undefined, 1).length <= 1);
});
