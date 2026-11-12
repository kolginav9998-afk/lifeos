// Документы: ссылки между файлами не ведут в пустоту, а разделы списка проверок на телефоне пронумерованы без повторов и по порядку.
// Эти документы читает человек, который не будет искать опечатку в пути: сломанная ссылка или два одинаковых номера раздела — ошибка выпуска.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const rel = p => path.relative(root, p).split(path.sep).join('/');

// ---------- разбор Markdown (ровно столько, сколько нужно для ссылок и заголовков) ----------

// Убрать блоки кода (``` и ~~~): внутри них ни ссылок, ни заголовков нет. Номера строк сохраняются. С inline = true убирается и короткий код в обратных кавычках.
function stripCode(md, inline = true) {
  let fence = null;
  return md.split('\n').map(line => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; return ''; }
    if (m) { fence = m[1]; return ''; }
    return inline ? line.replace(/(`+)[^`]*?\1/g, s => ' '.repeat(s.length)) : line;
  }).join('\n');
}

// Ссылки [текст](адрес "подсказка"), картинки ![текст](адрес) и определения [метка]: адрес. Возвращает { target, line }.
function extractLinks(md) {
  const out = [];
  stripCode(md).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) out.push({ target: m[1].replace(/^<|>$/g, ''), line: i + 1 });
    const d = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(line);
    if (d) out.push({ target: d[1].replace(/^<|>$/g, ''), line: i + 1 });
  });
  return out;
}

// Якорь заголовка по правилам GitHub: строчные буквы, без знаков препинания, пробелы — дефисы; повтор получает -1, -2.
function headingAnchors(md) {
  const seen = new Map(), out = new Set();
  for (const line of stripCode(md, false).split('\n')) {
    const m = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = m[1].replace(/<[^>]+>/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*~]/g, '').trim().toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

const isExternal = t => /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//');

// Проверить все ссылки одного файла: куда ведут и есть ли якорь. Возвращает список понятных сообщений об ошибках.
function checkLinks(file, md, exists = p => fs.existsSync(p), readMd = p => fs.readFileSync(p, 'utf8')) {
  const problems = [];
  const dir = path.dirname(file);
  const anchorCache = new Map();
  const anchorsOf = p => { if (!anchorCache.has(p)) anchorCache.set(p, headingAnchors(p === file ? md : readMd(p))); return anchorCache.get(p); };
  for (const { target, line } of extractLinks(md)) {
    if (!target || isExternal(target)) continue;
    const hash = target.indexOf('#');
    const pathPart = hash < 0 ? target : target.slice(0, hash);
    const anchor = hash < 0 ? '' : target.slice(hash + 1);
    let dest, wanted;
    try {
      dest = pathPart ? path.resolve(pathPart.startsWith('/') ? path.join(root, pathPart) : path.join(dir, decodeURIComponent(pathPart))) : file;
      wanted = decodeURIComponent(anchor).toLowerCase();
    } catch { problems.push(`${rel(file)}:${line}: адрес «${target}» записан с ошибкой`); continue; }
    if (pathPart && !exists(dest)) { problems.push(`${rel(file)}:${line}: «${target}» ведёт в ${rel(dest)}, а такого файла нет`); continue; }
    if (anchor && dest.endsWith('.md') && !anchorsOf(dest).has(wanted)) problems.push(`${rel(file)}:${line}: в ${rel(dest)} нет заголовка с якорем «#${anchor}»`);
  }
  return problems;
}

// ---------- разделы CHECKLIST.md ----------
// Заголовок раздела: «## 4к. Новое в R3.13». Номер — целое число, после него при необходимости русская буква (как в обычных списках: без ё, й, ъ, ы, ь).
// Порядок: 0, 1, 4, 4а, 4б, …, 4к, 5, 6. Целые номера идут подряд, буквы — по алфавиту (пропуск буквы допустим).
const LETTERS = 'абвгдежзиклмнопрстуфхцчшщэюя';
function checklistProblems(md) {
  const problems = [];
  const seen = new Map();
  let prev = null;
  stripCode(md, false).split('\n').forEach((line, i) => {
    if (!/^## /.test(line)) return;
    const at = `docs/CHECKLIST.md:${i + 1}`;
    const m = /^## (\d+)([а-яё]?)\.\s+\S/.exec(line);
    if (!m) { problems.push(`${at}: у раздела «${line.slice(3)}» нет номера вида «4к.»`); return; }
    const num = Number(m[1]), letter = m[2], key = m[1] + letter;
    const rank = letter ? LETTERS.indexOf(letter) : -1;
    if (letter && rank < 0) { problems.push(`${at}: буква «${letter}» в номере ${key} не используется (нужна из «${LETTERS}»)`); return; }
    if (seen.has(key)) problems.push(`${at}: номер раздела ${key} уже занят строкой ${seen.get(key)}`);
    else seen.set(key, i + 1);
    if (!prev) { if (num !== 0 || letter) problems.push(`${at}: нумерация начинается с ${key}, а должна с 0`); }
    else if (num === prev.num && rank === prev.rank) { /* повтор уже назван выше */ }
    else if (num < prev.num || (num === prev.num && rank < prev.rank)) problems.push(`${at}: раздел ${key} стоит после ${prev.key}, а должен быть раньше (номера идут по возрастанию)`);
    else if (num > prev.num + 1) problems.push(`${at}: между разделами ${prev.key} и ${key} пропущены номера`);
    prev = { num, rank, key };
  });
  if (!seen.size) problems.push('docs/CHECKLIST.md: не найдено ни одного раздела «## N. …»');
  return problems;
}

// ---------- файлы, которые проверяем ----------
function markdownFiles() {
  const out = [path.join(root, 'README.md')];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) out.push(p); } };
  walk(path.join(root, 'docs'));
  return out;
}

test('документы: каждая относительная ссылка в README.md и docs/ ведёт в существующий файл, якоря заголовков на месте', () => {
  const files = markdownFiles();
  assert.ok(files.length >= 10, `найдено документов: ${files.length}`);
  const problems = files.flatMap(f => checkLinks(f, fs.readFileSync(f, 'utf8')));
  assert.deepEqual(problems, [], 'сломанные ссылки:\n' + problems.join('\n'));
});

test('CHECKLIST.md: номера разделов не повторяются и идут по порядку без пропусков', () => {
  const problems = checklistProblems(fs.readFileSync(path.join(root, 'docs/CHECKLIST.md'), 'utf8'));
  assert.deepEqual(problems, [], 'нумерация разделов:\n' + problems.join('\n'));
});

// ---------- сами проверки не должны быть пустыми: на заведомо плохих примерах они обязаны находить ошибки ----------
test('проверка ссылок: находит сломанный путь и якорь, не трогает код, внешние адреса и якоря в том же файле', () => {
  const md = [
    '# Заголовок: «Тест»', '', '## Раздел один', '## Раздел один',
    'Хорошая [ссылка](GUIDE.md), ещё [с якорем](GUIDE.md#новое-в-r39) и [на себя](#раздел-один-1).',
    'Плохая [ссылка](NOPE.md), плохой [якорь](GUIDE.md#нет-такого), [свой якорь](#нет-у-меня), картинка ![р](img/нет.png "подсказка").',
    'Внешняя [ссылка](https://example.com/a.md), [почта](mailto:a@b.c), [протокол](//cdn.example/x).',
    'В коде `[не ссылка](NOPE2.md)` и ниже тоже:', '```', '[блок](NOPE3.md)', '```',
    '[ref]: ../README.md', '[ref2]: <missing file.md>',
  ].join('\n');
  const existing = new Set([path.join(root, 'docs/GUIDE.md'), path.join(root, 'README.md')]);
  const problems = checkLinks(path.join(root, 'docs/X.md'), md, p => existing.has(p), () => '# Новое в R3.9\n## Что-то\n');
  assert.deepEqual(problems.map(p => p.replace(/^docs\/X\.md:/, '')), [
    '6: «NOPE.md» ведёт в docs/NOPE.md, а такого файла нет',
    '6: в docs/GUIDE.md нет заголовка с якорем «#нет-такого»',
    '6: в docs/X.md нет заголовка с якорем «#нет-у-меня»',
    '6: «img/нет.png» ведёт в docs/img/нет.png, а такого файла нет',
    '13: «missing file.md» ведёт в docs/missing file.md, а такого файла нет',
  ]);
});

test('якоря заголовков: как у GitHub (регистр, знаки препинания, повторы, форматирование)', () => {
  const a = headingAnchors('# Что проверить на телефоне\n## 4к. Новое в R3.13\n## Раздел\n## Раздел\n### `Код` и **жирный** [ссылка](x.md)!\n```\n# не заголовок\n```\n');
  assert.deepEqual([...a], ['что-проверить-на-телефоне', '4к-новое-в-r313', 'раздел', 'раздел-1', 'код-и-жирный-ссылка']);
});

test('нумерация CHECKLIST: повтор, нарушенный порядок, пропуск, раздел без номера и неверная буква находятся', () => {
  const doc = list => list.map(h => `## ${h}\n1. шаг\n`).join('\n');
  const bad = list => checklistProblems(doc(list)).join('\n');
  assert.deepEqual(checklistProblems(doc(['0. Старт', '1. А', '2. Б', '2а. В', '2б. Г', '2к. Д', '3. Е'])), [], 'хороший пример: пропуск буквы (и → к) разрешён, как в настоящем списке');
  assert.match(bad(['0. А', '1. Б', '1. В']), /номер раздела 1 уже занят строкой 4/);
  assert.match(bad(['0. А', '1. Б', '1а. В', '1а. Г']), /1а уже занят/);
  assert.match(bad(['0. А', '1. Б', '2. В', '1а. Г']), /1а стоит после 2/);
  assert.match(bad(['0. А', '1. Б', '1в. В', '1б. Г']), /1б стоит после 1в/);
  assert.match(bad(['0. А', '1. Б', '3. В']), /между разделами 1 и 3 пропущены номера/);
  assert.match(bad(['1. А', '2. Б']), /начинается с 1, а должна с 0/);
  assert.match(bad(['0. А', 'Просто заголовок']), /нет номера/);
  assert.match(bad(['0. А', '1. Б', '1ь. В']), /буква «ь»/);
  assert.match(checklistProblems('# нет разделов\n').join('\n'), /не найдено ни одного раздела/);
  assert.deepEqual(checklistProblems('# Список\n```\n## 9. внутри кода\n```\n## 0. Раздел\n'), [], 'заголовки внутри блока кода не считаются');
});
