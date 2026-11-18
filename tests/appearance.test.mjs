// Внешний вид по выбору: акцентные палитры и плотность.
// Палитры проверяются на контраст WCAG AA программно: акцент на фоне и текст на акценте — не ниже 4.5:1 в обеих темах.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULTS } from '../prefs.js';

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const design = read('style-design.css');
const style = read('style.css');
const settings = read('view-settings.js');
const app = read('app.js');
const html = read('index.html');

// --- контраст по WCAG ---
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function contrast(a, b) {
  let [l1, l2] = [lum(a), lum(b)];
  if (l1 < l2) [l1, l2] = [l2, l1];
  return (l1 + 0.05) / (l2 + 0.05);
}

const BG_LIGHT = '#f5f6fa', BG_DARK = '#171923';
const PALETTES = ['sage', 'sea', 'terra', 'plum', 'corn'];

// Достаёт --accent и --accent2 из блока палитры: light — из :root[data-accent=X], dark — из :root[data-theme=dark][data-accent=X].
function colors(name) {
  const light = design.match(new RegExp(`:root\\[data-accent=${name}\\]\\{([^}]*)\\}`))[1];
  const dark = design.match(new RegExp(`:root\\[data-theme=dark\\]\\[data-accent=${name}\\]\\{([^}]*)\\}`))[1];
  const pick = (body, k) => body.match(new RegExp(`--${k}:(#[0-9a-f]{6})`))[1];
  return { la: pick(light, 'accent'), la2: pick(light, 'accent2'), da: pick(dark, 'accent'), da2: pick(dark, 'accent2') };
}

test('каждая палитра задана в светлой и тёмной теме и проходит AA', () => {
  for (const p of PALETTES) {
    const c = colors(p);
    assert.ok(contrast(c.la, BG_LIGHT) >= 4.5, `${p}: светлый акцент на фоне`);
    assert.ok(contrast(c.da, BG_DARK) >= 4.5, `${p}: тёмный акцент на фоне`);
    assert.ok(contrast('#ffffff', c.la) >= 4.5, `${p}: белый текст на светлом акценте`);
    assert.ok(contrast(BG_DARK, c.da) >= 4.5, `${p}: тёмный текст на тёмном акценте`);
    assert.match(design, new RegExp(`:root:not\\(\\[data-theme=light\\]\\)\\[data-accent=${p}\\]`), `${p}: ветка prefers-color-scheme`);
  }
});

test('по умолчанию — ирис и обычная плотность, без лишних атрибутов', () => {
  assert.equal(DEFAULTS.accent, 'iris');
  assert.equal(DEFAULTS.density, 'normal');
  assert.match(app, /accent !== 'iris'/);      // дефолт не ставит data-accent
  assert.match(app, /density !== 'normal'/);   // дефолт не ставит data-density
});

test('в настройках есть выбор цвета и плотности', () => {
  assert.match(settings, /id: 'accent-select'/);
  assert.match(settings, /id: 'density-select'/);
  for (const p of ['iris', ...PALETTES]) assert.match(settings, new RegExp(`'${p}'`), `палитра ${p} в селекте`);
});

test('плотность масштабирует шаги отступов', () => {
  assert.match(design, /\[data-density=compact\]\{[^}]*--s4:12px/);
  assert.match(design, /\[data-density=spacious\]\{[^}]*--s4:20px/);
});

test('текст на акценте идёт через --on-accent в обеих темах', () => {
  assert.match(style, /--on-accent:#fff\}/);
  assert.match(style, /--on-accent:#171923\}\}/);  // prefers-color-scheme: dark
  assert.match(style, /button\.primary\{[^}]*color:var\(--on-accent\)/);
});

test('линия прогресса дня: элемент, стиль и обновление из heroOf', () => {
  assert.match(html, /id="day-line" role="progressbar"/);
  assert.match(design, /#day-line>span\{[^}]*background:var\(--grad\)/);
  assert.match(app, /import \{ heroOf \} from '\.\/daycards\.js'/);
  assert.match(app, /updateDayLine/);
  assert.match(app, /aria-label.*Дела на сегодня/);
});
