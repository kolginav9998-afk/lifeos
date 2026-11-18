// Темы по времени и сезону: true dark для OLED, авто-вечер, сезонные палитры, время суток и ритм недели.
// Новые режимы проверяются на контраст WCAG AA программно: акцент на фоне и текст на акценте — не ниже 4.5:1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULTS } from '../prefs.js';

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const design = read('style-design.css');
const style = read('style.css');
const settings = read('view-settings.js');
const app = read('app.js');

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

const BG_LIGHT = '#f5f6fa', BG_DARK = '#171923', BG_OLED = '#000000';
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];

// Достаёт --accent и --accent2 сезонной палитры: light — из :root[data-accent=seasonal][data-season=X], dark — из :root[data-theme=dark]…
function seasonColors(name) {
  const light = design.match(new RegExp(`:root\\[data-accent=seasonal\\]\\[data-season=${name}\\]\\{([^}]*)\\}`))[1];
  const dark = design.match(new RegExp(`:root\\[data-theme=dark\\]\\[data-accent=seasonal\\]\\[data-season=${name}\\]\\{([^}]*)\\}`))[1];
  const pick = (body, k) => body.match(new RegExp(`--${k}:(#[0-9a-f]{6})`))[1];
  return { la: pick(light, 'accent'), la2: pick(light, 'accent2'), da: pick(dark, 'accent'), da2: pick(dark, 'accent2') };
}

test('каждый сезон задан в светлой и тёмной теме и проходит AA', () => {
  for (const s of SEASONS) {
    const c = seasonColors(s);
    assert.ok(contrast(c.la, BG_LIGHT) >= 4.5, `${s}: светлый акцент на фоне`);
    assert.ok(contrast(c.da, BG_DARK) >= 4.5, `${s}: тёмный акцент на фоне`);
    assert.ok(contrast(c.da, BG_OLED) >= 4.5, `${s}: тёмный акцент на OLED-чёрном`);
    assert.ok(contrast('#ffffff', c.la) >= 4.5, `${s}: белый текст на светлом акценте`);
    assert.ok(contrast(BG_DARK, c.da) >= 4.5, `${s}: тёмный текст на тёмном акценте`);
    assert.match(design, new RegExp(`:root:not\\(\\[data-theme=light\\]\\)\\[data-accent=seasonal\\]\\[data-season=${s}\\]`), `${s}: ветка prefers-color-scheme`);
  }
});

test('сезоны различаются: акцент не повторяется между временами года', () => {
  const light = SEASONS.map(s => seasonColors(s).la);
  const dark = SEASONS.map(s => seasonColors(s).da);
  assert.equal(new Set(light).size, SEASONS.length, 'светлые акценты разные');
  assert.equal(new Set(dark).size, SEASONS.length, 'тёмные акценты разные');
});

test('true dark для OLED: чёрный фон без свечения и теней, в обеих ветках тёмной темы', () => {
  const manual = style.match(/:root\[data-theme=dark\]\[data-oled\]\{([^}]*)\}/)[1];
  const media = style.match(/prefers-color-scheme: dark\)\{:root:not\(\[data-theme=light\]\)\[data-oled\]\{([^}]*)\}/)[1];
  for (const [name, body] of [['data-theme=dark', manual], ['prefers-color-scheme', media]]) {
    assert.match(body, /--bg:#000/, `${name}: фон #000`);
    assert.match(body, /--shadow:none/, `${name}: без теней`);
    assert.match(body, /--shadow-lg:none/, `${name}: без больших теней`);
    assert.match(body, /--glow1:transparent/, `${name}: без свечения`);
    assert.match(body, /--glow2:transparent/, `${name}: без второго свечения`);
  }
  // Контрасты на чёрном: основной и приглушённый текст, тёмный акцент — всё с запасом выше AA
  assert.ok(contrast('#e8eaf3', BG_OLED) >= 4.5, 'текст на #000');
  assert.ok(contrast('#a4a9be', BG_OLED) >= 4.5, 'приглушённый текст на #000');
});

test('авто-вечер и OLED — настройки, по умолчанию выключены', () => {
  assert.equal(DEFAULTS.autoEvening, false);
  assert.equal(DEFAULTS.oledDark, false);
  assert.match(settings, /id: 'pref-oled'/);
  assert.match(settings, /id: 'pref-auto-evening'/);
  assert.match(app, /getPref\('autoEvening'\)/);
  assert.match(app, /setAttribute\('data-oled'/);
});

test('авто-вечер: принудительная тёмная тема после 22:00, но явный выбор светлой уважается', () => {
  assert.match(app, /hour >= 22 \|\| hour < 6/);
  assert.match(app, /t !== 'light' && night && getPref\('autoEvening'\)/);
});

test('в селекте цвета есть вариант «по сезону», дата переводится в data-season', () => {
  assert.match(settings, /'seasonal'/);
  assert.match(app, /dataset\.season/);
  assert.match(app, /'winter'.*'spring'.*'summer'.*'autumn'/s);
});

test('время суток и ритм недели: классы на body и тонкие токены свечения', () => {
  for (const cls of ['tod-morning', 'tod-night', 'week-sun-eve', 'week-mon-morning']) {
    assert.match(app, new RegExp(`'${cls}'`), `applyTheme ставит ${cls}`);
    assert.match(design, new RegExp(`body\\.${cls}\\{[^}]*--glow1`), `${cls}: токен свечения в CSS`);
  }
  // без анимаций: новые классы только перекрашивают токены
  const blocks = ['tod-morning', 'tod-night', 'week-sun-eve', 'week-mon-morning']
    .map(c => design.match(new RegExp(`body\\.${c}\\{([^}]*)\\}`))[1]).join('');
  assert.ok(!/animation|transition/.test(blocks), 'классы времени без анимаций');
});
