// Статические проверки: безопасность кода и согласованность сборки.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const appJs = fs.readdirSync(root).filter(f => f.endsWith('.js'));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('в коде приложения нет опасных конструкций (innerHTML, eval, document.write, new Function)', () => {
  const bad = /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`]/;
  for (const f of appJs) {
    const code = read(f).replace(/\/\/.*$/gm, '');
    assert.ok(!bad.test(code), `${f}: опасная конструкция`);
  }
});

test('сетевых запросов нет нигде, кроме офлайн-кэша (sw.js) и клиента сервера синхронизации (api.js)', () => {
  for (const f of appJs) {
    const code = read(f).replace(/\/\/.*$/gm, '');
    if (f === 'sw.js' || f === 'api.js') continue;
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(code), `${f}: сетевой вызов`);
  }
  const sw = read('sw.js');
  assert.ok(/origin\s*!==\s*location\.origin/.test(sw), 'sw.js должен пропускать чужие адреса мимо кэша');
});

test('нет внешних адресов (http/https) в коде и разметке, кроме пространства имён SVG', () => {
  for (const f of [...appJs, 'index.html', 'style.css', 'manifest.webmanifest']) {
    const text = read(f).replace(/\/\/.*$/gm, '');
    const urls = (text.match(/https?:\/\/[^\s'")]+/g) || []).filter(u => !u.startsWith('http://www.w3.org/2000/svg'));
    assert.deepEqual(urls, [], `${f}: внешние адреса`);
  }
});

test('нет скриптов и обработчиков внутри index.html (иначе придётся ослаблять CSP)', () => {
  const html = read('index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'встроенный <script>');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'встроенные обработчики on*=');
  assert.ok(!/\sstyle\s*=/i.test(html), 'встроенные style=');
});

test('сборка: CSP только в веб-версии; dist совпадает с офлайн-кэшем sw.js', () => {
  execFileSync('bash', ['scripts/build-web.sh', 'web'], { cwd: root, stdio: 'pipe' });
  const web = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert.match(web, /Content-Security-Policy/);
  assert.match(web, /script-src 'self'/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(web));
  const sw = fs.readFileSync(path.join(root, 'dist/sw.js'), 'utf8');
  assert.ok(!sw.includes('/*SHELL_LIST*/') && !sw.includes('/*BUILD_HASH*/'), 'метки сборки заменены');
  const shell = JSON.parse(sw.match(/const SHELL = (\[.*?\]);/s)[1]).filter(x => x !== './');
  const all = fs.readdirSync(path.join(root, 'dist'), { recursive: true, withFileTypes: true }).filter(e => e.isFile())
    .map(e => path.relative(path.join(root, 'dist'), path.join(e.parentPath, e.name))).filter(f => f !== 'sw.js');
  assert.deepEqual([...shell].sort(), [...all].sort(), 'офлайн-кэш = все файлы сборки');
  const hash1 = sw.match(/const CACHE = 'lifeos-' \+ '([0-9a-f]{12})'/)?.[1];
  assert.ok(hash1, 'версия кэша из содержимого');
  execFileSync('bash', ['scripts/build-web.sh', 'web'], { cwd: root, stdio: 'pipe' });
  assert.equal(fs.readFileSync(path.join(root, 'dist/sw.js'), 'utf8').match(/'lifeos-' \+ '([0-9a-f]{12})'/)[1], hash1, 'без изменений версия та же');
  execFileSync('bash', ['scripts/build-web.sh', 'apk'], { cwd: root, stdio: 'pipe' });
  assert.ok(!/Content-Security-Policy/.test(fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')));
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
});

test('манифест: ярлыки и «Поделиться» без внешних адресов; иконки существуют', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.share_target.method, 'GET');
  assert.ok(m.shortcuts.length >= 3);
  for (const i of [...m.icons, ...m.shortcuts.flatMap(s => s.icons)]) assert.ok(fs.existsSync(path.join(root, i.src)), i.src);
});

test('исходник иконки на месте, все размеры Android сгенерированы', () => {
  assert.ok(fs.existsSync(path.join(root, 'assets/icon-source.webp')));
  for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'])
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'])
      assert.ok(fs.existsSync(path.join(root, `assets/android-res/mipmap-${d}/${f}`)), `${d}/${f}`);
});

test('replaceChildren не получает null: DOM рисует его как текст «null» (используй fill из ui.js)', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  for (const f of fs.readdirSync(root).filter(n => n.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of s.matchAll(/\.replaceChildren\(/g)) {
      let depth = 1, j = m.index + m[0].length, str = null;
      while (j < s.length && depth > 0) {
        const c = s[j];
        if (str) { if (c === '\\') j++; else if (c === str) str = null; }
        else if ('\'"`'.includes(c)) str = c;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
        j++;
      }
      const body = s.slice(m.index + m[0].length, j - 1);
      assert.ok(!/:\s*null\b|:\s*undefined\b|&&\s*el\(/.test(body), `${f}:${s.slice(0, m.index).split('\n').length}: в replaceChildren возможен null, используй fill()`);
    }
  }
});

// Два экрана с одним и тем же id в разметке: тесты и вспомогательные технологии берут первый попавшийся (так «Учёба» и «Планы» однажды разделили goal-err).
test('идентификаторы элементов не повторяются в разных файлах', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const seen = new Map(), DATA_KEYS = new Set(['empty', 'health']);               // не элементы: ключ данных и id курса
  for (const f of fs.readdirSync(root).filter(x => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/\bid: '([a-zA-Z][\w-]*)'/g)) { if (!DATA_KEYS.has(m[1])) (seen.get(m[1]) ?? seen.set(m[1], new Set()).get(m[1])).add(f); }
  }
  for (const m of fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/\bid="([a-zA-Z][\w-]*)"/g)) (seen.get(m[1]) ?? seen.set(m[1], new Set()).get(m[1])).add('index.html');
  const dups = [...seen].filter(([, files]) => files.size > 1).map(([id, files]) => `${id}: ${[...files].join(', ')}`);
  assert.deepEqual(dups, [], 'переименуй один из элементов');
});
