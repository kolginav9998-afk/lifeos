// Мелкие помощники интерфейса. Никакого innerHTML: только textContent и DOM-узлы.
import { getPref } from './prefs.js';
import { formatMoney } from './money.js';
export const $ = id => document.getElementById(id);

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('aria-') || k === 'role') n.setAttribute(k, v);
    else n[k] = v;
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid);
  return n;
}

// Как replaceChildren, но пропускает null/undefined/false. Сам DOM превращает null в текст «null».
export function fill(node, ...kids) { node.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false)); }

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  tasks: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  habits: ['M17 1l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 23l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
  money: ['M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M1 10h22'],
  notes: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
  more: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M21 21l-4.35-4.35'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  diary: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
  tests: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  growth: ['M23 6l-9.5 9.5-5-5L1 18', 'M17 6h6v6'],
  // Единый набор линейных значков (24 × 24, обводка 2): действия, статусы, предметы.
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  check: ['M20 6L9 17l-5-5'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  chevR: ['M9 18l6-6-6-6'],
  chevL: ['M15 18l-6-6 6-6'],
  chevD: ['M6 9l6 6 6-6'],
  edit: ['M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'],
  trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  calendar: ['M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
  bell: ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
  heart: ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
  target: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  flame: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  share: ['M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M8.59 13.51l6.83 3.98', 'M15.41 6.51l-6.82 3.98'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
  alert: ['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
  checkCircle: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
  volume: ['M11 5L6 9H2v6h4l5 4V5z', 'M19.07 4.93a10 10 0 0 1 0 14.14', 'M15.54 8.46a5 5 0 0 1 0 7.07'],
  cloud: ['M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z'],
  sync: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15'],
  gift: ['M20 12v10H4V12', 'M2 7h20v5H2z', 'M12 22V7', 'M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z', 'M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z'],
  zap: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
  play: ['M5 3l14 9-14 9V3z'],
  undo: ['M1 4v6h6', 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10'],
  eyeOff: ['M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24', 'M1 1l22 22'],
  copy: ['M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  moon: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  dumbbell: ['M6.5 6.5l11 11', 'M21 21l-1-1', 'M3 3l1 1', 'M18 22l4-4', 'M2 6l4-4', 'M3 10l7-7', 'M14 21l7-7'],
};
ICONS.settings = ICONS.more; ICONS.repeat = ICONS.habits; ICONS.pulse = ICONS.tests; ICONS.card = ICONS.money;

// Кольцо прогресса: доля 0..1, текст по центру. Градиент (#ring-grad) объявлен в index.html.
export function ring(fraction, { size = 88, stroke = 10, label = '', name = 'Выполнено' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, Number(fraction) || 0));
  const s = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring', role: 'img', 'aria-label': `${name}: ${Math.round(f * 100)}%` })) s.setAttribute(k, v);
  const circle = (cls, extra = {}) => {
    const n = document.createElementNS(SVG_NS, 'circle');
    for (const [k, v] of Object.entries({ cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, class: cls, ...extra })) n.setAttribute(k, v);
    return n;
  };
  s.append(circle('ring-track'), circle('ring-bar', { 'stroke-dasharray': c.toFixed(2), 'stroke-dashoffset': (c * (1 - f)).toFixed(2), transform: `rotate(-90 ${size / 2} ${size / 2})` }));
  if (label) { const t = document.createElementNS(SVG_NS, 'text'); t.setAttribute('x', size / 2); t.setAttribute('y', size / 2); t.setAttribute('class', 'ring-txt'); t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central'); t.textContent = label; s.append(t); }
  return s;
}

export function icon(name, size = 22, cls = '') {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false'); s.setAttribute('class', `ic ic-${name}${cls ? ' ' + cls : ''}`);
  for (const d of ICONS[name] || []) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

// Иллюстрация для пустых экранов: две карточки, свечение и значок из набора. Цвета — через CSS-классы (.ill-*), поэтому работает в обеих темах.
export function illustration(name = 'tasks') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const node = (tag, attrs, parent = svg) => { const n = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.append(n); return n; };
  for (const [k, v] of Object.entries({ viewBox: '0 0 160 112', width: 160, height: 112, class: 'ill', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v);
  node('ellipse', { cx: 80, cy: 102, rx: 50, ry: 6, class: 'ill-shadow' });
  node('circle', { cx: 80, cy: 54, r: 46, class: 'ill-glow' });
  node('rect', { x: 36, y: 24, width: 66, height: 72, rx: 18, transform: 'rotate(-10 69 60)', class: 'ill-c2' });
  node('rect', { x: 56, y: 16, width: 68, height: 76, rx: 18, transform: 'rotate(6 90 54)', class: 'ill-c1' });
  const g = node('g', { transform: 'rotate(6 90 54) translate(67.2 31.2) scale(1.9)', class: 'ill-g' });
  for (const d of ICONS[name] || ICONS.tasks) node('path', { d }, g);
  node('circle', { cx: 30, cy: 30, r: 3.5, class: 'ill-dot' }); node('circle', { cx: 136, cy: 22, r: 2.5, class: 'ill-dot b' }); node('circle', { cx: 140, cy: 82, r: 3, class: 'ill-dot' });
  node('path', { d: 'M22 80h8M26 76v8', class: 'ill-plus' });
  return svg;
}
// Пустое состояние: иллюстрация, одна дружелюбная фраза и главное действие. box.msg — заголовок (его можно менять, например «Ничего не найдено»).
export function emptyState({ art = 'tasks', title, text = '', action = null, id } = {}) {
  const msg = el('strong', { class: 'empty-t', textContent: title });
  const btn = action ? el('button', { type: 'button', class: 'primary empty-a', onclick: action.onClick }, action.icon ? icon(action.icon, 18) : null, action.label) : null;
  const box = el('div', { class: 'empty', id }, illustration(art), msg, text ? el('p', { class: 'empty-p', textContent: text }) : null, btn);
  box.msg = msg;
  return box;
}

// Всплывающее сообщение; необязательная кнопка действия (например «Отменить»). Слева значок: ошибка или готово; снизу полоска оставшегося времени.
let toastTimer = null;
const ERR_START = /^(Не удалось|Не получилось|Не могу|Ошибка|Нельзя|Слишком|Неверн|Не найден|Проверка прервана)/i;
export function toast(message, { actionLabel, onAction, ms = 5000, kind } = {}) {
  const box = $('toast');
  if (!box) return;
  const k = kind || (ERR_START.test(String(message)) ? 'error' : 'ok');
  box.dataset.kind = k;
  box.replaceChildren(el('span', { class: 'toast-ic' }, icon(k === 'error' ? 'alert' : 'checkCircle', 18)), el('span', { class: 'toast-msg', textContent: message }));
  if (actionLabel && onAction) {
    box.append(el('button', { type: 'button', textContent: actionLabel, onclick: () => { clearTimeout(toastTimer); box.hidden = true; onAction(); } }));
  }
  const bar = el('i', { class: 'toast-bar' });
  bar.style.animationDuration = `${ms}ms`;
  box.append(bar);
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, ms);
}

// Убрать сообщение (например, при блокировке: в тексте сообщения могут быть названия дел и суммы).
// Копирование текста в буфер обмена (с запасным способом для окружений без Clipboard API).
export function copyText(text, okMessage = 'Скопировано') {
  const done = () => toast(okMessage);
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = text; ta.readOnly = true; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('Не удалось скопировать: выдели текст вручную.'); }
    ta.remove();
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}
export function clearToast() { clearTimeout(toastTimer); const box = $('toast'); if (box) { box.hidden = true; box.replaceChildren(); } }

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export function dateRu(ymd) { const [, m, d] = ymd.split('-').map(Number); return `${d} ${MONTHS_SHORT[m - 1]}`; }

export function setBusy(button, busy, label) {
  if (busy) { button.dataset.label = button.textContent; button.textContent = label || 'Подождите…'; button.disabled = true; }
  else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
}

// Суммы можно скрыть на экране (настройка «Скрывать суммы»).
export const moneyText = minor => (getPref('hideAmounts') ? '•••• ₽' : formatMoney(minor));
export const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export function weekdayOf(ymd) { const [y, m, d] = ymd.split('-').map(Number); return WEEKDAYS[new Date(y, m - 1, d, 12).getDay()]; }

export function agoText(ts, now = Date.now()) {
  if (!ts) return 'ещё не делал';
  const d = Math.floor((now - ts) / 86400000);
  return d <= 0 ? 'сегодня' : d === 1 ? 'вчера' : `${d} дн. назад`;
}

// Поле пароля с кнопкой «показать/скрыть» (меньше опечаток на телефоне).
export function revealable(input) {
  const btn = el('button', { type: 'button', class: 'reveal', textContent: 'показать', 'aria-label': 'Показать или скрыть пароль' });
  btn.onclick = () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; btn.textContent = show ? 'скрыть' : 'показать'; };
  return el('div', { class: 'pw-wrap' }, input, btn);
}

// Мини-график по ряду чисел (null — разрыв). Рисуется из DOM-узлов, без innerHTML.
// band — серая полоса нормы {lo, hi} (в тех же единицах, что и values); marks — вертикальные отметки событий
// [{ i, kind, label }], где i — номер точки; подпись видна при касании (title) и читается экранным диктором.
// Под линией — мягкая область с градиентом, на конце — точка с ореолом (цвета из токенов через CSS-классы).
let sparkN = 0;
export function sparkline(values, { width = 140, height = 36, band = null, marks = [] } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const node = (tag, attrs = {}, parent = svg) => { const n = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.append(n); return n; };
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('class', 'spark'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'График');
  const nums = values.filter(v => Number.isFinite(v));
  if (nums.length < 2) return svg;
  const lo = Math.min(...nums), hi = Math.max(...nums), span = hi - lo || 1, pad = 4;
  const x = i => pad + (i * (width - 2 * pad)) / Math.max(1, values.length - 1);
  const y = v => height - pad - ((v - lo) / span) * (height - 2 * pad);
  const gid = `spk${++sparkN}`;
  const grad = node('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, node('defs'));
  node('stop', { offset: 0, class: 'spark-g0' }, grad); node('stop', { offset: 1, class: 'spark-g1' }, grad);
  if (band && Number.isFinite(band.lo) && Number.isFinite(band.hi) && band.hi >= lo && band.lo <= hi) {      // полоса нормы рисуется под линией
    const top = y(Math.min(hi, band.hi)), bottom = y(Math.max(lo, band.lo));
    const r = node('rect', { x: pad, width: width - 2 * pad, y: top.toFixed(1), height: Math.max(1, bottom - top).toFixed(1), class: 'spark-band', rx: 3 });
    node('title', {}, r).textContent = 'Серая полоса — твой обычный диапазон';
  }
  for (const m of marks) {
    if (!(m.i >= 0 && m.i < values.length)) continue;
    const l = node('line', { x1: x(m.i).toFixed(1), x2: x(m.i).toFixed(1), y1: pad, y2: height - pad, class: `spark-mark ${m.kind || ''}`.trim() });
    node('title', {}, l).textContent = m.label || 'Событие';
  }
  let seg = [];
  const flush = () => {
    if (seg.length > 1) {
      const pts = seg.map(([px, py]) => `${px},${py}`);
      node('path', { d: `M${seg[0][0]},${height - pad / 2} L${pts.join(' L')} L${seg.at(-1)[0]},${height - pad / 2} Z`, fill: `url(#${gid})`, class: 'spark-area' });
      node('polyline', { points: pts.join(' '), class: 'spark-line' });
    }
    seg = [];
  };
  values.forEach((v, i) => { if (Number.isFinite(v)) seg.push([x(i).toFixed(1), y(v).toFixed(1)]); else flush(); });
  flush();
  const lastI = values.map(Number.isFinite).lastIndexOf(true), cx = x(lastI).toFixed(1), cy = y(values[lastI]).toFixed(1);
  node('circle', { cx, cy, r: 6, class: 'spark-halo' }); node('circle', { cx, cy, r: 3, class: 'spark-dot' });
  return svg;
}

// Оценка 1–5 пятью кнопками.
export function ratingRow(label, field, value, onChange) {
  const wrap = el('div', { class: 'rating', dataset: { field } }, el('span', { class: 'rating-label', textContent: label }));
  const btns = [1, 2, 3, 4, 5].map(v => el('button', { type: 'button', class: 'rate', dataset: { field, v: String(v) }, textContent: String(v), 'aria-pressed': String(value === v),
    onclick: () => { const next = wrap.value === v ? null : v; wrap.setValue(next); onChange(next); } }));
  wrap.value = value ?? null;
  wrap.setValue = v => { wrap.value = v; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(v === i + 1))); };
  wrap.append(el('div', { class: 'rate-btns' }, ...btns));
  return wrap;
}

// Число кнопками «−» и «+» с единицами измерения.
export function stepper({ label, field, value = null, min, max, step, unit, start = step }, onChange) {
  const out = el('span', { class: 'step-val', dataset: { field }, textContent: '—' });
  const wrap = el('div', { class: 'stepper', dataset: { field } }, el('span', { class: 'rating-label', textContent: label }));
  const fmt = v => (v === null ? '—' : `${String(v).replace('.', ',')}${unit ? ' ' + unit : ''}`);
  const set = v => { wrap.value = v === null ? null : Math.min(max, Math.max(min, Math.round(v * 100) / 100)); out.textContent = fmt(wrap.value); };
  const bump = d => { if (wrap.value === null) set(start); else set(wrap.value + d); onChange(wrap.value); };
  wrap.setValue = set;
  wrap.append(el('div', { class: 'step-ctl' },
    el('button', { type: 'button', class: 'step-btn', 'aria-label': `${label}: меньше`, textContent: '−', onclick: () => { if (wrap.value === null) return; if (wrap.value <= min) { set(null); onChange(null); } else bump(-step); } }),
    out,
    el('button', { type: 'button', class: 'step-btn', 'aria-label': `${label}: больше`, textContent: '+', onclick: () => bump(step) })));
  set(value);
  return wrap;
}
