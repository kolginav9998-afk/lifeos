// Справка внутри приложения (help.js): статьи, поиск по словам с формами слов, карточки знакомства.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HELP_ARTICLES, HELP_GROUPS, TOUR, articleById, searchHelp, stem } from '../help.js';
import { APK_LINK } from '../updater.js';
import { DEFAULTS } from '../prefs.js';

const root = path.resolve(import.meta.dirname, '..');
const sources = fs.readdirSync(root).filter(f => f.endsWith('.js') && !f.startsWith('c-')).map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const screens = new Set([...fs.readFileSync(path.join(root, 'app.js'), 'utf8').matchAll(/\{ id: '(\w+)', group:/g)].map(m => m[1]));
const firstId = q => searchHelp(q)[0]?.id;
const idsOf = q => searchHelp(q).map(a => a.id);
const visible = a => [a.title, a.summary, a.intro, a.stepsTitle, ...a.steps, ...(a.parts ?? []).flatMap(p => [p.title, ...p.steps]), ...(a.limits ?? []), a.action?.label, a.link?.label].filter(Boolean);

test('справка: у каждой статьи есть id, заголовок, слова для поиска, шаги и тема', () => {
  const ids = HELP_ARTICLES.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, 'id статей не повторяются');
  const groups = new Set(HELP_GROUPS.map(g => g.key));
  assert.equal(groups.size, HELP_GROUPS.length, 'темы не повторяются');
  for (const a of HELP_ARTICLES) {
    assert.match(a.id, /^[a-z][a-z-]*$/, `id ${a.id}`);
    assert.ok(a.title?.trim().length >= 5, `${a.id}: заголовок`);
    assert.ok(a.summary?.trim().length >= 10 && a.summary.length <= 140, `${a.id}: одна строка для списка`);
    assert.ok(Array.isArray(a.keywords) && a.keywords.length >= 3 && a.keywords.every(k => typeof k === 'string' && k.trim()), `${a.id}: слова для поиска`);
    assert.ok(Array.isArray(a.steps) && a.steps.length >= 2 && a.steps.every(s => typeof s === 'string' && s.trim().length >= 10), `${a.id}: шаги`);
    assert.ok(Array.isArray(a.groups) && a.groups.length >= 1 && a.groups.every(g => groups.has(g)), `${a.id}: тема из списка`);
    for (const p of a.parts ?? []) assert.ok(p.title && p.steps?.length >= 2, `${a.id}: часть «${p.title}»`);
    for (const t of visible(a)) assert.ok(!/null|undefined|\[object/.test(t), `${a.id}: служебный мусор в тексте «${t}»`);
  }
  for (const g of HELP_GROUPS) assert.ok(HELP_ARTICLES.some(a => a.groups.includes(g.key)), `тема «${g.title}» не пуста`);
});

test('справка: есть все нужные вопросы', () => {
  const need = ['update', 'new-phone', 'forgot-password', 'recovery-code', 'lost-phone', 'backup', 'why-account', 'offline', 'reminders', 'charts', 'sick-heavy', 'look', 'server-sees', 'delete-data'];
  for (const id of need) assert.ok(articleById(id), `нет статьи ${id}`);
  assert.equal(articleById('нет такой'), null);
});

test('справка: простые слова, короткие фразы, никакой технической кухни', () => {
  const jargon = /IndexedDB|PBKDF|AES|JSON|localStorage|SQLite|Durable|HTTPS|\bCSP\b|\bCORS\b|innerHTML/i;
  for (const a of HELP_ARTICLES) {
    for (const t of visible(a)) {
      assert.ok(!jargon.test(t), `${a.id}: жаргон в «${t}»`);
      assert.ok(t.length <= 330, `${a.id}: слишком длинный абзац (${t.length}): «${t.slice(0, 50)}…»`);
      for (const s of t.split(/(?<=[.!?])\s+/)) assert.ok(s.length <= 200, `${a.id}: слишком длинная фраза (${s.length}): «${s.slice(0, 50)}…»`);
    }
  }
});

test('справка: честно о границах там, где человек может пострадать', () => {
  for (const id of ['update', 'new-phone', 'forgot-password', 'recovery-code', 'lost-phone', 'backup', 'why-account', 'offline', 'reminders', 'charts', 'sick-heavy', 'server-sees', 'delete-data']) {
    assert.ok(articleById(id).limits?.length >= 1, `${id}: нужен раздел «Честно о границах»`);
  }
  // Без кода и без пароля данные не вернуть: это сказано прямо, без обещаний.
  const forgot = articleById('forgot-password');
  const noCode = forgot.parts.find(p => /нет/.test(p.title)).steps.join(' ');
  assert.match(noCode, /не откроет никто/);
  assert.match(forgot.intro, /никто не может его показать/);
  // Выводы: связь не причина, мало дней — ненадёжно.
  const charts = visible(articleById('charts')).join(' ');
  assert.match(charts, /не значит, что A вызывает B/);
  assert.match(charts, /нужно около 40 дней/);
  assert.match(charts, /не ставит диагнозов/);
  // Что видит сервер: только зашифрованное, и оговорка про аудит.
  const server = visible(articleById('server-sees')).join(' ');
  assert.match(server, /зашифрованные записи/);
  assert.match(server, /не проверял независимый аудит/);
});

test('справка: обновление — разрешение Android, что спросит система и ссылка для ручной установки', () => {
  const a = articleById('update');
  const text = a.steps.join(' ');
  assert.match(text, /Установка неизвестных приложений/);
  assert.match(text, /Установить/);
  assert.match(text, /Всё равно установить/);
  assert.ok(a.parts.some(p => /Если не получилось/.test(p.title)), 'что делать, если не вышло');
  assert.equal(a.link.url, 'https://github.com/kolginav9998-afk/lifeos/releases/download/latest-apk/lifeos.apk');
  assert.equal(a.link.url, APK_LINK, 'ссылка совпадает с той, что использует кнопка обновления');
  assert.ok(articleById('new-phone').link?.url === APK_LINK, 'на новый телефон тоже даём ссылку');
});

test('справка: кнопки действий ведут на настоящие экраны и элементы; связанные статьи существуют', () => {
  assert.ok(screens.has('account') && screens.has('more') && screens.has('help'), 'экраны найдены в app.js');
  const check = (where, action) => {
    assert.ok(action.label?.trim(), `${where}: подпись кнопки`);
    if (action.tour) return;
    assert.ok(screens.has(action.go), `${where}: нет экрана ${action.go}`);
    if (action.scrollTo) assert.ok(new RegExp(`\\bid: '${action.scrollTo}'`).test(sources), `${where}: нет элемента ${action.scrollTo}`);
  };
  for (const a of HELP_ARTICLES) {
    if (a.action) check(a.id, a.action);
    for (const r of a.related ?? []) { assert.ok(articleById(r), `${a.id}: связанной статьи ${r} нет`); assert.notEqual(r, a.id); }
    if (a.link) assert.match(a.link.url, /^https:\/\/github\.com\//);
  }
  assert.ok(HELP_ARTICLES.filter(a => a.action).length >= 8, 'у большинства статей есть кнопка');
  assert.ok(HELP_ARTICLES.some(a => a.action?.go === 'account') && HELP_ARTICLES.some(a => a.action?.go === 'more' && a.action.scrollTo === 'archive-box'));
});

test('поиск: формы слов «пароль», «пароля», «забыл» находят «Я забыл пароль»', () => {
  for (const q of ['пароль', 'пароля', 'паролем', 'паролю', 'забыл', 'забыла', 'забыли', 'забыть', 'забыл пароль', 'забыла пароль', 'не помню пароль', 'потерял пароль', 'Забыл Пароль!', 'ЗАБЫЛ']) {
    assert.equal(firstId(q), 'forgot-password', `запрос «${q}»: ${idsOf(q).join(', ')}`);
  }
  assert.equal(stem('пароль'), stem('пароля'));
  assert.equal(stem('забыл'), stem('забыла'));
  assert.equal(stem('копия'), stem('копии'));
  assert.equal(stem('ёлка'), stem('елка'), 'ё и е не различаются');
});

test('поиск: самые частые вопросы человека приводят к нужной статье', () => {
  const cases = {
    'как обновить приложение': 'update', 'обновление': 'update', 'обновить': 'update', 'неизвестных приложений': 'update', 'не устанавливается': 'update', 'apk': 'update',
    'новый телефон': 'new-phone', 'перенести данные': 'new-phone', 'сменил телефон': 'new-phone',
    'код восстановления': 'recovery-code', 'где хранить код': 'recovery-code', 'потерял код': 'recovery-code',
    'потерял телефон': 'lost-phone', 'украли телефон': 'lost-phone',
    'архив': 'backup', 'резервная копия': 'backup', 'резервные копии': 'backup', 'сохранить копию': 'backup', 'пароль архива': 'backup',
    'зачем вход': 'why-account', 'зачем нужен аккаунт': 'why-account', 'аккаунт': 'why-account',
    'без интернета': 'offline', 'нет сети': 'offline', 'интернет': 'offline',
    'напоминания': 'reminders', 'уведомления не приходят': 'reminders', 'как включить напоминания': 'reminders',
    'график': 'charts', 'корреляция': 'charts', 'выводы': 'charts', 'мощность': 'charts', 'причина': 'charts',
    'болею': 'sick-heavy', 'заболел': 'sick-heavy', 'тяжёлый день': 'sick-heavy', 'тяжелый день': 'sick-heavy',
    'тёмная тема': 'look', 'размер текста': 'look', 'шрифт': 'look', 'крупный': 'look',
    'что видит сервер': 'server-sees', 'шифрование': 'server-sees',
    'удалить данные': 'delete-data', 'стереть всё': 'delete-data', 'удалить аккаунт': 'delete-data',
    'токен': 'setup-code', 'код установки': 'setup-code', 'api': 'setup-code',
    'начать': 'first-steps', 'подсказки': 'first-steps',
  };
  for (const [q, id] of Object.entries(cases)) assert.equal(firstId(q), id, `запрос «${q}»: ${idsOf(q).join(', ')}`);
});

test('поиск: каждая статья находится по своему заголовку и по любому своему слову поиска', () => {
  for (const a of HELP_ARTICLES) {
    assert.equal(firstId(a.title), a.id, `заголовок «${a.title}»`);
    for (const k of a.keywords) assert.ok(idsOf(k).includes(a.id), `слово «${k}» не находит ${a.id}`);
  }
});

test('поиск: пустое, из одних связок и бессмысленное ничего не находят; слова должны встретиться все', () => {
  assert.deepEqual(searchHelp(''), []);
  assert.deepEqual(searchHelp('   '), []);
  assert.deepEqual(searchHelp('как'), []);
  assert.deepEqual(searchHelp('что и как'), []);
  assert.deepEqual(searchHelp('zzzz'), []);
  assert.deepEqual(searchHelp('пароль zzzz'), [], 'лишнее слово не находится нигде — результата нет');
  assert.ok(searchHelp('пароль', 3).length <= 3, 'ограничение числа ответов');
  assert.ok(idsOf('телефон').includes('lost-phone') && idsOf('телефон').includes('new-phone'), 'одно слово находит все подходящие статьи');
});

test('знакомство: три карточки с действиями; открытие один раз на устройстве', () => {
  assert.equal(TOUR.length, 3);
  assert.deepEqual(TOUR.map(c => c.title), ['Это твой профиль: имя и значок', 'Сохрани архив и код восстановления', 'Обновления приходят кнопкой в Профиле']);
  assert.equal(new Set(TOUR.map(c => c.id)).size, 3);
  for (const c of TOUR) {
    assert.ok(c.text.length >= 30 && c.text.length <= 220, `${c.id}: короткий текст`);
    assert.ok(c.action.label && screens.has(c.action.go), `${c.id}: действие`);
    if (c.action.scrollTo) assert.ok(new RegExp(`\\bid: '${c.action.scrollTo}'`).test(sources), `${c.id}: есть элемент ${c.action.scrollTo}`);
  }
  assert.equal(TOUR[0].action.go, 'account');
  assert.deepEqual([TOUR[1].action.go, TOUR[1].action.scrollTo], ['more', 'archive-box'], 'архив');
  assert.equal(DEFAULTS.tourDone, false, 'по умолчанию знакомство ещё не показано');
});
