// Полировка интерфейса (волна 5): числа-герои с градиентом, срочность формой,
// два тона пустоты, дышащее «сегодня», свечение дня рождения, живая работа со строками.
// Все анимации — только при prefers-reduced-motion: no-preference.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const design = read('style-design.css');
const today = read('view-today.js');
const money = read('view-money.js');
const ui = read('ui.js');

// блок polish живёт строго в конце style-design.css
const polish = design.slice(design.indexOf('/* ===== polish (w5) ===== */'));

test('блок polish дописан в конец файла после линии дня', () => {
  assert.ok(design.indexOf('/* ===== polish (w5) ===== */') > design.indexOf('#day-line'), 'маркер после блоков палитр и #day-line');
  assert.ok(!/#[0-9a-f]{6}/i.test(polish), 'без захардкоженных цветов — только токены и rgba-тени');
});

test('число-герой: остаток бюджета и итог месяца крупные (var(--t40)) и с градиентом', () => {
  assert.match(polish, /#month-total\{font-size:var\(--t40\);background:var\(--grad\);-webkit-background-clip:text;background-clip:text;color:transparent\}/);
  assert.match(polish, /#learn-count,\.budget-left\{background:var\(--grad\);-webkit-background-clip:text;background-clip:text;color:transparent\}/);
  assert.match(polish, /\.budget-left\{display:block;font-size:var\(--t40\)/);
  assert.match(money, /el\('strong', \{ class: 'budget-left', textContent: moneyText\(Math\.abs\(left\)\) \}\)/);
  assert.match(money, /осталось /, 'подпись «осталось» сохранена');
});

test('просроченное: вертикальная полоса слева 3px var(--danger), а не только цвет', () => {
  assert.match(polish, /\.item\.is-overdue\{box-shadow:inset 3px 0 0 var\(--danger\),var\(--shadow-sm\)\}/);
  assert.match(today, /lab\.cls === 'overdue' && !p\.done \? ' is-overdue'/, 'класс ставится по условию просрочки');
  assert.match(read('events.js'), /просрочено на \$\{n\} дн\./, 'метка «на N дн» уже есть в подписи срока');
});

test('мета-строки капителью, без uppercase', () => {
  assert.match(polish, /\.meta\{font-variant-caps:small-caps/);
  assert.doesNotMatch(polish, /\.meta\{[^}]*text-transform:uppercase/);
});

test('тексты дел балансируются переносами', () => {
  assert.match(polish, /\.item \.text[^}]*\{text-wrap:balance\}/);
});

test('два тона пустоты: «всё сделано» тёплое, «ещё не начато» нейтральное', () => {
  assert.match(polish, /\.empty\.done\{background:var\(--tint-ok\)\}/);
  assert.match(polish, /\.empty\.todo\{background:var\(--soft\)\}/);
  assert.match(ui, /tone \? ' ' \+ tone : ''/, 'emptyState принимает тон');
  assert.match(today, /empty\.classList\.toggle\('done', allDoneNow\)/, 'тон переключается по состоянию дня');
});

test('«сегодня» дышит в календарях: точки привычек и дни графика', () => {
  assert.match(polish, /\.dot\.today,\.cal-day\.today\{animation:todayBreathe/);
  assert.match(polish, /@keyframes todayBreathe\{50%\{outline-color:color-mix\(in srgb,var\(--accent\)/);
});

test('чип дня рождения мягко светится', () => {
  assert.match(polish, /#bday-chip\{box-shadow:0 0 0 1px color-mix\(in srgb,var\(--warn\) 45%,transparent\)/);
  assert.match(polish, /@keyframes bdayGlow/);
  assert.match(today, /id: 'bday-chip'/, 'чип существует на экране «Сегодня»');
});

test('кольцевая вспышка вокруг галочки — одна итерация', () => {
  assert.match(polish, /\.item\.done \.check\{animation:tick \.28s,checkRing [^}]* 1\}/);
  assert.match(polish, /@keyframes checkRing\{0%\{box-shadow:0 0 0 0 color-mix\(in srgb,var\(--ok\)/);
});

test('выполненное через 400 мс приглушается и опускается на 1px', () => {
  assert.match(polish, /\.item\.done\{animation:doneSettle \.3s var\(--ease\) \.4s 1 both\}/);
  assert.match(polish, /@keyframes doneSettle\{from\{opacity:1;transform:none\}to\{opacity:\.62;transform:translateY\(1px\)\}\}/);
  assert.match(polish, /\.item\.done\{opacity:\.62;transform:translateY\(1px\)\}/, 'конечное состояние без анимации тоже задано');
});

test('новая строка появляется с fade+slide, удаляемая растворяется', () => {
  assert.match(polish, /\.item\.appear\{animation:rowIn/);
  assert.match(polish, /\.item\.leaving\{animation:rowOut [^}]*forwards\}/);
  assert.match(today, /justAddedId = t\.id/, 'id новой задачи запоминается до сохранения');
  assert.match(today, /ev\.id === justAddedId \? ' appear'/, 'класс появления ставится строке');
  assert.match(today, /li\.classList\.add\('leaving'\)/, 'удаляемая строка получает класс растворения');
  assert.match(today, /prefers-reduced-motion: reduce/, 'при reduced-motion удаление мгновенное');
});

test('тень = интерактивность: статичные карточки плоские, сворачиваемые — с тенью', () => {
  assert.match(polish, /\.card\{box-shadow:none\}/);
  assert.match(polish, /details\.card\{box-shadow:var\(--shadow\)\}/);
});

test('hover-подъём только точным указателем и только у интерактивных карточек', () => {
  const m = polish.match(/@media \(hover:hover\) and \(pointer:fine\)\{([\s\S]*?)\n\}/);
  assert.ok(m, 'блок hover:hover и pointer:fine есть');
  assert.match(m[1], /translateY\(-1px\)/);
  assert.match(m[1], /details\.card:hover/);
});

test('все анимации polish — внутри prefers-reduced-motion: no-preference', () => {
  const block = polish.match(/@media \(prefers-reduced-motion: no-preference\)\{([\s\S]*?)\n\}/);
  assert.ok(block, 'медиа-блок no-preference есть');
  for (const k of ['todayBreathe', 'bdayGlow', 'checkRing', 'doneSettle', 'rowIn', 'rowOut'])
    assert.ok(block[1].includes(`@keyframes ${k}`), `${k} внутри no-preference`);
  assert.doesNotMatch(polish.replace(block[0], ''), /@keyframes/, 'вне блока анимаций нет');
});
