// Микро-отклики интерфейса: кромка тоста по типу, единый отклик нажатия,
// пульс значка синхронизации и спокойный вариант hero при закрытом дне.
// Все анимации — только при prefers-reduced-motion: no-preference.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const style = read('style.css');
const design = read('style-design.css');
const today = read('view-today.js');
const ui = read('ui.js');

test('тост получает цветную левую кромку по типу, тип ставит toast()', () => {
  assert.match(ui, /box\.dataset\.kind = k/);                                   // тип уже вычисляется в ui.js
  assert.match(design, /\.toast\[data-kind=ok\]\{border-left:3px solid var\(--ok\)\}/);
  assert.match(design, /\.toast\[data-kind=error\]\{border-left:3px solid var\(--danger\)\}/);
});

test('единый отклик нажатия scale(.96) с transform .15s var(--ease)', () => {
  assert.match(style, /button:active:not\(:disabled\)\{transform:scale\(\.96\)\}/);
  assert.match(style, /transition:transform \.15s var\(--ease\)/);
  for (const sel of ['\\.chip', '#tabs button', '\\.subnav button', '\\.track-card'])
    assert.match(style, new RegExp(`${sel}[^}]*:active[^{]*\\{transform:scale\\(\\.96\\)`), `отклик у ${sel}`);
});

test('значок синхронизации пульсирует только в состоянии syncing и без reduced-motion', () => {
  assert.match(style, /@media \(prefers-reduced-motion: no-preference\)\{\.sync-badge\[data-state=syncing\]\{animation:syncPulse/);
  assert.match(style, /@keyframes syncPulse\{0%,100%\{opacity:1\}50%\{opacity:/);
});

test('«день закрыт»: класс ставится по кольцу, стили в обеих темах, свечение один раз', () => {
  assert.match(today, /hero\.classList\.toggle\('done', hr\.total > 0 && hr\.left === 0\)/);
  assert.match(design, /\.hero\.done\{background-image:linear-gradient\(var\(--tint-ok\)/);
  assert.match(design, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme=light\]\) \.hero\.done\{/);
  assert.match(design, /:root\[data-theme=dark\] \.hero\.done\{/);
  assert.match(design, /\.hero\.done\{animation:heroDone [^}]* 1\}/);           // animation-iteration-count: 1
});

test('свечение «дня закрыт» живёт в блоке no-preference', () => {
  const block = design.match(/@media \(prefers-reduced-motion: no-preference\)\{[\s\S]*?@keyframes heroDone/);
  assert.ok(block, 'heroDone внутри @media prefers-reduced-motion: no-preference');
});
