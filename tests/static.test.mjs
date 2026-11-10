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

test('сетевых запросов нет нигде, кроме офлайн-кэша (sw.js, только свой адрес)', () => {
  for (const f of appJs) {
    const code = read(f).replace(/\/\/.*$/gm, '');
    if (f === 'sw.js') continue;
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
  const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];')).matchAll(/'([^']+)'/g)].map(m => m[1]).filter(x => x !== './');
  const dist = fs.readdirSync(path.join(root, 'dist')).filter(f => f.endsWith('.js') && f !== 'sw.js');
  for (const f of dist) assert.ok(shell.includes(f), `${f} не в офлайн-кэше`);
  for (const f of shell) assert.ok(fs.existsSync(path.join(root, 'dist', f)), `${f} есть в кэше, но нет в сборке`);
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
