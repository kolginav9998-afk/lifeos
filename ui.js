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
};
export function icon(name, size = 22) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] || []) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

// Всплывающее сообщение; необязательная кнопка действия (например «Отменить»).
let toastTimer = null;
export function toast(message, { actionLabel, onAction, ms = 5000 } = {}) {
  const box = $('toast');
  if (!box) return;
  box.replaceChildren(el('span', { textContent: message }));
  if (actionLabel && onAction) {
    box.append(el('button', { type: 'button', textContent: actionLabel, onclick: () => { clearTimeout(toastTimer); box.hidden = true; onAction(); } }));
  }
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, ms);
}

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
export function sparkline(values, { width = 140, height = 36 } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('class', 'spark'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'График');
  const nums = values.filter(v => Number.isFinite(v));
  if (nums.length < 2) return svg;
  const lo = Math.min(...nums), hi = Math.max(...nums), span = hi - lo || 1, pad = 3;
  const x = i => pad + (i * (width - 2 * pad)) / Math.max(1, values.length - 1);
  const y = v => height - pad - ((v - lo) / span) * (height - 2 * pad);
  let seg = [];
  const flush = () => {
    if (seg.length > 1) { const p = document.createElementNS(SVG_NS, 'polyline'); p.setAttribute('points', seg.join(' ')); p.setAttribute('class', 'spark-line'); svg.append(p); }
    seg = [];
  };
  values.forEach((v, i) => { if (Number.isFinite(v)) seg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); else flush(); });
  flush();
  const lastI = values.map(Number.isFinite).lastIndexOf(true);
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', x(lastI).toFixed(1)); dot.setAttribute('cy', y(values[lastI]).toFixed(1)); dot.setAttribute('r', '2.5'); dot.setAttribute('class', 'spark-dot');
  svg.append(dot);
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
