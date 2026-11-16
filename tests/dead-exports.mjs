// Поиск «мёртвых» экспортов: функций и констант, которые модуль экспортирует, а приложение нигде не использует.
// Запуск: node tests/dead-exports.mjs        (только отчёт, ничего не меняет и в `npm test` не входит)
// Использование только в тестах за использование приложением НЕ считается: такие экспорты выводятся отдельным списком.
// Разбор грубый (регулярные выражения), поэтому каждое найденное перед удалением проверяй глазами: поиск по имени во всём проекте.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const appFiles = fs.readdirSync(root).filter(f => f.endsWith('.js') && f !== 'sw.js').sort();
const testFiles = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.mjs')).map(f => 'tests/' + f);
const serverFiles = ['server/core.js', 'server/sqlstore.js', 'server/node/server.js', 'server/cloudflare/worker.js'].filter(f => fs.existsSync(path.join(root, f)));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const useRe = (name, flags = '') => new RegExp(`(?<![\\w$])(?:(?<!\\.)|(?<=\\.\\.\\.))${esc(name)}(?![\\w$])`, flags);      // имя как переменная: не часть длинного слова и не obj.name (но ...name — это использование)
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// ----- экспорты модуля: имя → признак «объявлен здесь» -----
function exportsOf(src) {
  const out = new Map();
  for (const re of [/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm, /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm, /^export\s+class\s+([A-Za-z_$][\w$]*)/gm]) for (const m of src.matchAll(re)) out.set(m[1], m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}(?!\s*from)/gm)) for (const part of m[1].split(',')) { const [local, as] = part.trim().split(/\s+as\s+/); if (local) out.set(as || local, local); }
  if (/^export\s+default\b/m.test(src)) out.set('default', 'default');
  return out;
}

// ----- импорты файла: откуда, какие имена, какой пространство имён, есть ли динамический import() -----
function importsOf(src, file) {
  const res = [];
  const dir = path.posix.dirname(file);
  const resolve = spec => path.posix.normalize(path.posix.join(dir, spec));
  for (const m of src.matchAll(/^(?:import|export)\s+([^;]*?)\s+from\s+'(\.[^']+)'/gm)) {
    const clause = m[1], isExport = src.slice(m.index, m.index + 6) === 'export';
    const imp = { from: resolve(m[2]), names: [], ns: null, dynamic: false, reexport: isExport, text: m[0] };
    const nsm = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (nsm) imp.ns = nsm[1];
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) for (const part of named[1].split(',')) { const [a, b] = part.trim().split(/\s+as\s+/); if (a) imp.names.push({ name: a, local: b || a }); }
    const def = /^([\w$]+)\s*(?:,|$)/.exec(clause.replace(/\{[^}]*\}/, '').trim());
    if (def && !nsm && !isExport) imp.names.push({ name: 'default', local: def[1] });
    if (isExport && /^\*/.test(clause.trim())) imp.star = true;
    res.push(imp);
  }
  for (const m of src.matchAll(/import\(\s*'(\.[^']+)'\s*\)/g)) res.push({ from: resolve(m[1]), names: [], ns: null, dynamic: true });
  return res;
}

const modules = new Map();           // файл → { exports, src }
for (const f of appFiles) { const src = stripComments(read(f)); modules.set(f, { src, exports: exportsOf(src) }); }
const consumers = [...appFiles, ...serverFiles].map(f => ({ file: f, src: stripComments(read(f)) }));
const testSrc = testFiles.map(f => ({ file: f, src: stripComments(read(f)) }));

// Кто и как использует имя name из модуля mod. Возвращает список файлов.
function usersOf(mod, name, list) {
  const users = [];
  for (const { file, src } of list) {
    if (file === mod) continue;
    for (const imp of importsOf(src, file)) {
      if (imp.from !== mod) continue;
      const body = imp.text ? src.replace(imp.text, '') : src;
      if (imp.dynamic) { if (useRe(name).test(body)) users.push(file); }
      else if (imp.reexport) { if (imp.star || imp.names.some(n => n.name === name)) users.push(file + ' (реэкспорт)'); }
      else if (imp.ns && new RegExp(`\\b${esc(imp.ns)}\\.${esc(name)}\\b`).test(body)) users.push(file);
      else for (const n of imp.names) if (n.name === name && useRe(n.local).test(body)) users.push(file);
    }
  }
  return [...new Set(users)];
}

const dead = [], testOnly = [], internalOnly = [];
for (const [mod, { src, exports }] of modules) {
  for (const [name, local] of exports) {
    if (name === 'default') continue;
    const app = usersOf(mod, name, consumers);
    if (app.length) continue;
    const own = (src.match(useRe(local, 'g')) || []).length - 1;       // минус само объявление
    const tests = usersOf(mod, name, testSrc);
    const row = { mod, name, internal: own > 0, tests };
    if (tests.length) testOnly.push(row);
    else if (own > 0) internalOnly.push(row);
    else dead.push(row);
  }
}

const fmt = rows => rows.length ? rows.map(r => `  ${r.mod}: ${r.name}${r.tests.length ? `   ← тесты: ${r.tests.map(t => t.replace('tests/', '')).join(', ')}` : ''}${r.internal && r.tests.length ? ' (+ внутри модуля)' : ''}`).join('\n') : '  нет';
console.log(`Модулей: ${modules.size}, экспортов: ${[...modules.values()].reduce((n, m) => n + m.exports.size, 0)}\n`);
console.log(`Нигде не используются (ни приложением, ни тестами, ни внутри модуля): ${dead.length}\n${fmt(dead)}\n`);
console.log(`Используются только в тестах: ${testOnly.length}\n${fmt(testOnly)}\n`);
console.log(`Используются только внутри своего модуля (слово export можно убрать): ${internalOnly.length}\n${fmt(internalOnly)}`);
