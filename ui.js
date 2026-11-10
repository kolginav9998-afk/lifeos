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
