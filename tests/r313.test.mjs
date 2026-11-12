// R3.13: оформление (токены, контраст), название приложения, заставка, кольцо дел.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { heroOf } from '../daycards.js';
import { makeTask, completeTask } from '../events.js';
import { APP_NAME } from '../config.js';

const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const css = read('style.css');

// ---------- токены оформления ----------
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):([^;}]+)/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = tokens(css.match(/^:root\{([^\n]*)\}$/m)[1]);
const dark = tokens(css.match(/^:root\[data-theme=dark\]\{([^\n]*)\}$/m)[1]);
const darkAuto = tokens(css.match(/prefers-color-scheme: dark\)\{:root:not\(\[data-theme=light\]\)\{([^\n]*)\}\}/)[1]);

test('тёмная тема задана одинаково вручную и по системной настройке', () => {
  assert.deepEqual(darkAuto, dark);
});
test('в тёмной теме переопределены все цветовые токены светлой (кроме общих размеров и градиента)', () => {
  const shared = new Set(['--grad', '--r']);
  const missing = Object.keys(light).filter(k => !shared.has(k) && !(k in dark));
  assert.deepEqual(missing, [], 'в тёмной теме не хватает токенов: ' + missing.join(', '));
});

const hex = h => { const f = h.length === 4 ? '#' + [...h.slice(1)].map(ch => ch + ch).join('') : h; const n = parseInt(f.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function color(v, under) {
  if (v.startsWith('#')) return hex(v);
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(v);
  assert.ok(m, 'не разобрать цвет ' + v);
  const a = Number(m[4]);
  return [0, 1, 2].map(i => Math.round(Number(m[i + 1]) * a + under[i] * (1 - a)));
}
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const [name, t] of [['светлая', light], ['тёмная', dark]]) {
  test(`контраст (${name} тема): основной и второстепенный текст, акцент и статусы читаются (WCAG AA, 4.5:1)`, () => {
    const bg = color(t['--bg']), card = color(t['--card'], bg), soft = color(t['--soft'], bg);
    const need = [['текст на фоне', t['--text'], bg], ['текст на карточке', t['--text'], card], ['второстепенный на фоне', t['--muted'], bg], ['второстепенный на карточке', t['--muted'], card],
      ['второстепенный на «мягком»', t['--muted'], soft], ['акцент на фоне', t['--accent'], bg], ['акцент на карточке', t['--accent'], card],
      ['«готово» на карточке', t['--ok'], card], ['«просрочено» на карточке', t['--danger'], card], ['«внимание» на карточке', t['--warn'], card]];
    for (const [what, fg, under] of need) assert.ok(ratio(color(fg, under), under) >= 4.5, `${what}: ${ratio(color(fg, under), under).toFixed(2)}`);
  });
}
test('контраст: белый текст на кнопках с градиентом читается в обеих темах', () => {
  const stops = css.match(/--grad:linear-gradient\(135deg,(#[0-9a-f]{6}),(#[0-9a-f]{6})\)/);
  assert.ok(stops, 'градиент кнопок задан двумя цветами');
  for (const s of stops.slice(1)) assert.ok(ratio([255, 255, 255], hex(s)) >= 4.5, `белый на ${s}: ${ratio([255, 255, 255], hex(s)).toFixed(2)}`);
});
test('уменьшение движения: анимации появления экранов включаются только без этой настройки', () => {
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\{\s*\.view:not\(\[hidden\]\)\{animation:viewIn/);
});

// ---------- название приложения ----------
test('название: один файл config/brand.json, метки в index.html и манифесте, имя под иконкой и заголовок выпуска из него', () => {
  const brand = JSON.parse(read('config/brand.json'));
  assert.ok(typeof brand.name === 'string' && brand.name.trim().length >= 1 && brand.name.length <= 30 && !/[<>&"%]/.test(brand.name));
  const html = read('index.html'), man = read('manifest.webmanifest');
  assert.equal((html.match(/%APP_NAME%/g) || []).length, 3, 'заголовок страницы, экран блокировки и экран входа');
  assert.match(man, /"name": "%APP_NAME%"/); assert.match(man, /"short_name": "%APP_NAME%"/);
  assert.match(read('config.js'), /APP_NAME = \/\*APP_NAME\*\/ 'Компас'/, 'значение по умолчанию для исходников');
  assert.equal(APP_NAME, 'Компас');
  const y = read('.github/workflows/apk.yml'), p = read('scripts/patch-android.py');
  assert.match(y, /ANDROID_APP_NAME="\$\(node -e "console\.log\(JSON\.parse\(require\('fs'\)\.readFileSync\('config\/brand\.json'/);
  assert.match(y, /--title "\$APP_NAME \$VERSION/);
  assert.match(p, /ANDROID_APP_NAME/); assert.match(p, /title_activity_main/);
  // технические имена остаются прежними: иначе обновление поверх старого приложения и данные сломаются
  assert.equal(JSON.parse(read('capacitor.config.json')).appId, 'app.lifeos.mobile');
  assert.match(read('updater.js'), /REPO = 'kolginav9998-afk\/lifeos'/);
  assert.match(read('updater.js'), /APK_ASSET = 'lifeos\.apk'/);
});

// ---------- заставка Android ----------
test('заставка: рисунки для всех плотностей на месте и нужного размера, тема задаёт тёмный фон', () => {
  const sizes = { 'drawable': [480, 320], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720], 'drawable-land-xxhdpi': [1600, 960],
    'drawable-land-xxxhdpi': [1920, 1280], 'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920] };
  for (const [dir, [w, h]] of Object.entries(sizes)) {
    const buf = fs.readFileSync(path.join(root, 'assets/android-res', dir, 'splash.png'));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG', dir);
    assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [w, h], `${dir}: размер рисунка совпадает с шаблоном Capacitor`);
  }
  assert.match(read('scripts/patch-android.py'), /windowSplashScreenBackground/);
});

// ---------- кольцо дел на «Сегодня» ----------
test('кольцо дел: сделано, осталось и подпись', () => {
  const now = new Date(2026, 10, 11, 12).getTime(), today = '2026-11-11';
  assert.deepEqual(heroOf([], today), { done: 0, left: 0, total: 0, fraction: 0, caption: 'На сегодня дел нет' });
  const a = makeTask('а', now, { due: today }), b = makeTask('б', now + 1, { due: today }), c = makeTask('в', now + 2, { due: '2026-11-09' });
  const open = heroOf([a, b, c], today);
  assert.deepEqual([open.done, open.left, open.total, open.caption], [0, 3, 3, 'Осталось дел: 3'], 'просроченное тоже считается');
  const mid = heroOf([completeTask(a, now + 5).updated, b, c], today);
  assert.deepEqual([mid.done, mid.left, mid.total], [1, 2, 3]);
  assert.ok(Math.abs(mid.fraction - 1 / 3) < 1e-9);
});
