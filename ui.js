// Мелкие помощники интерфейса. Никакого innerHTML: только textContent и DOM-узлы.
import { getPref } from './prefs.js';
import { formatMoney } from './money.js';
export const $ = id => document.getElementById(id);
let idCounter = 0;
export const nextId = prefix => `${prefix}-${++idCounter}`;                 // уникальный id для связей aria-labelledby (не путать с постоянными id в разметке)

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

export function icon(name, size = 22) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] || []) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

// Озвучивание для экранного диктора. Текст кладём в постоянную область #sr-live (она есть в index.html с самого начала и скрыта только визуально):
// так его читают надёжнее, чем появившийся из скрытого блок. Пауза перед записью нужна, чтобы повтор того же текста тоже озвучился.
let liveTimer = null, liveClearTimer = null;
export function announce(message, { assertive = false } = {}) {
  const live = $('sr-live');
  if (!live || !message) return;
  live.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  clearTimeout(liveTimer); clearTimeout(liveClearTimer);
  live.textContent = '';
  liveTimer = setTimeout(() => { live.textContent = message; liveClearTimer = setTimeout(() => { live.textContent = ''; }, 10000); }, 60);
}
export function clearAnnouncements() { clearTimeout(liveTimer); clearTimeout(liveClearTimer); const live = $('sr-live'); if (live) live.textContent = ''; }

// Всплывающее сообщение; необязательная кнопка действия (например «Отменить»). Сообщение озвучивается мягко (polite), пока оно на экране — таймер стоит, если на кнопке фокус или курсор.
let toastTimer = null, toastMs = 5000, toastWired = false;
const hideToast = () => { const box = $('toast'); if (box) box.hidden = true; };
export function toast(message, { actionLabel, onAction, ms = 5000 } = {}) {
  const box = $('toast');
  if (!box) return;
  if (!toastWired) {                                                // таймер не должен убирать кнопку «Отменить», пока человек до неё добирается
    const pause = () => clearTimeout(toastTimer), resume = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, toastMs); };
    box.addEventListener('focusin', pause); box.addEventListener('focusout', resume); box.addEventListener('pointerenter', pause); box.addEventListener('pointerleave', resume);
    toastWired = true;
  }
  box.replaceChildren(el('span', { textContent: message }));
  if (actionLabel && onAction) {
    box.append(el('button', { type: 'button', textContent: actionLabel, onclick: () => { clearTimeout(toastTimer); box.hidden = true; onAction(); } }));
  }
  box.hidden = false;
  announce(actionLabel && onAction ? `${message}. ${actionLabel}: кнопка в уведомлении.` : message);
  clearTimeout(toastTimer);
  toastMs = ms;
  toastTimer = setTimeout(hideToast, ms);
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
export function clearToast() { clearTimeout(toastTimer); const box = $('toast'); if (box) { box.hidden = true; box.replaceChildren(); } clearAnnouncements(); }

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
// Мини-график. band — серая полоса нормы {lo, hi} (в тех же единицах, что и values); marks — вертикальные отметки событий
// [{ i, kind, label }], где i — номер точки; подпись видна при касании (title) и читается экранным диктором.
export function sparkline(values, { width = 140, height = 36, band = null, marks = [] } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('class', 'spark'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'График');
  const nums = values.filter(v => Number.isFinite(v));
  if (nums.length < 2) return svg;
  const lo = Math.min(...nums), hi = Math.max(...nums), span = hi - lo || 1, pad = 3;
  const x = i => pad + (i * (width - 2 * pad)) / Math.max(1, values.length - 1);
  const y = v => height - pad - ((v - lo) / span) * (height - 2 * pad);
  if (band && Number.isFinite(band.lo) && Number.isFinite(band.hi) && band.hi >= lo && band.lo <= hi) {      // полоса нормы рисуется под линией
    const top = y(Math.min(hi, band.hi)), bottom = y(Math.max(lo, band.lo));
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', pad); r.setAttribute('width', width - 2 * pad); r.setAttribute('y', top.toFixed(1)); r.setAttribute('height', Math.max(1, bottom - top).toFixed(1)); r.setAttribute('class', 'spark-band');
    const t = document.createElementNS(SVG_NS, 'title'); t.textContent = 'Серая полоса — твой обычный диапазон'; r.append(t);
    svg.append(r);
  }
  for (const m of marks) {
    if (!(m.i >= 0 && m.i < values.length)) continue;
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', x(m.i).toFixed(1)); l.setAttribute('x2', x(m.i).toFixed(1)); l.setAttribute('y1', pad); l.setAttribute('y2', height - pad); l.setAttribute('class', `spark-mark ${m.kind || ''}`.trim());
    const t = document.createElementNS(SVG_NS, 'title'); t.textContent = m.label || 'Событие'; l.append(t);
    svg.append(l);
  }
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
  const lid = nextId('rl');
  const wrap = el('div', { class: 'rating', role: 'group', 'aria-labelledby': lid, dataset: { field } }, el('span', { class: 'rating-label', id: lid, textContent: label }));
  const btns = [1, 2, 3, 4, 5].map(v => el('button', { type: 'button', class: 'rate', dataset: { field, v: String(v) }, textContent: String(v), 'aria-label': `${v} из 5`, 'aria-pressed': String(value === v),
    onclick: () => { const next = wrap.value === v ? null : v; wrap.setValue(next); onChange(next); } }));
  wrap.value = value ?? null;
  wrap.setValue = v => { wrap.value = v; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(v === i + 1))); };
  wrap.append(el('div', { class: 'rate-btns' }, ...btns));
  return wrap;
}

// Число кнопками «−» и «+» с единицами измерения.
export function stepper({ label, field, value = null, min, max, step, unit, start = step }, onChange) {
  const out = el('span', { class: 'step-val', dataset: { field }, textContent: '—' });
  const lid = nextId('sl');
  const wrap = el('div', { class: 'stepper', role: 'group', 'aria-labelledby': lid, dataset: { field } }, el('span', { class: 'rating-label', id: lid, textContent: label }));
  const fmt = v => (v === null ? '—' : `${String(v).replace('.', ',')}${unit ? ' ' + unit : ''}`);
  const set = v => { wrap.value = v === null ? null : Math.min(max, Math.max(min, Math.round(v * 100) / 100)); out.textContent = fmt(wrap.value); };
  const bump = d => { if (wrap.value === null) set(start); else set(wrap.value + d); onChange(wrap.value); announce(`${label}: ${fmt(wrap.value)}`); };
  wrap.setValue = set;
  wrap.append(el('div', { class: 'step-ctl' },
    el('button', { type: 'button', class: 'step-btn', 'aria-label': `${label}: меньше`, textContent: '−', onclick: () => { if (wrap.value === null) return; if (wrap.value <= min) { set(null); onChange(null); announce(`${label}: не указано`); } else bump(-step); } }),
    out,
    el('button', { type: 'button', class: 'step-btn', 'aria-label': `${label}: больше`, textContent: '+', onclick: () => bump(step) })));
  set(value);
  return wrap;
}

// ---------- доступность: нажимаемые блоки, заголовки, фокус, окна ----------
// Блок с несколькими строками внутри (его нельзя сделать <button>): роль «кнопка», фокус с клавиатуры, нажатие по Enter и пробелу.
export function pressable(node, onActivate) {
  node.tabIndex = 0; node.setAttribute('role', 'button');
  node.onclick = onActivate;
  node.onkeydown = e => { if (e.target === node && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onActivate(e); } };
  return node;
}

// Заголовок экрана — <h1> в шапке, а заголовки карточек внутри экрана — <h3> (так они выглядят). Без промежуточного <h2> диктор считает, что уровень пропущен.
// Вид не трогаем: выставляем aria-level так, чтобы уровни шли без пропусков; пересчёт — при каждой перерисовке.
export function fixHeadingLevels(root, startLevel = 1) {
  let prev = startLevel;
  for (const h of root.querySelectorAll('h2,h3,h4,h5,h6')) {
    if (h.closest('[hidden]')) continue;
    const native = Number(h.tagName[1]), want = Math.min(native, prev + 1);
    if (want !== native) h.setAttribute('aria-level', String(want)); else if (h.hasAttribute('aria-level')) h.removeAttribute('aria-level');
    prev = want;
  }
}
export function watchHeadings(root, startLevel = 1) {
  let queued = false;
  const run = () => { queued = false; fixHeadingLevels(root, startLevel); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  fixHeadingLevels(root, startLevel);
}

// Перенести фокус на узел, даже если он сам не фокусируется (заголовок, главная область).
export function focusNode(node, opts = { preventScroll: true }) {
  if (!node) return false;
  if (node.tabIndex < 0 && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
  node.focus(opts);
  return document.activeElement === node;
}

// Если содержимое блока перерисовали и фокус потерялся (нажатая кнопка исчезла), ставим его на заголовок или первое поле нового содержимого.
export function keepFocusIn(container, pick) {
  new MutationObserver(() => {
    if (container.closest('[hidden]')) return;
    const a = document.activeElement;
    if (a && a !== document.body) return;                                    // фокус на месте (или сознательно ушёл в другое место)
    focusNode(pick(container));
  }).observe(container, { childList: true, subtree: true });
}

// Полноэкранные окна (.overlay[role=dialog][aria-modal=true]) открывают и закрывают экраны, выставляя атрибут hidden. Здесь одно общее поведение для всех:
// при открытии запоминаем, откуда пришёл фокус, и закрываем остальную страницу от клавиатуры и диктора (inert); Tab ходит по кругу внутри окна;
// Escape нажимает кнопку «Закрыть» там, где она есть (идущий таймер или прохождение так не прервать); при закрытии фокус возвращается назад.
const TABBABLE = 'a[href],button,input,select,textarea,summary,[tabindex]';
const tabbables = box => [...box.querySelectorAll(TABBABLE)].filter(n => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length && !n.closest('[inert]') && getComputedStyle(n).visibility !== 'hidden');
const openDialogs = [];
let lastOutside = null;
const isDialog = n => n instanceof Element && n.matches('[role=dialog][aria-modal=true]');

function dimAround(node) {
  const out = [];
  for (let n = node; n.parentElement && n !== document.body; n = n.parentElement) {
    for (const sib of n.parentElement.children) if (sib !== n && !sib.inert && sib.id !== 'toast' && sib.id !== 'sr-live') { sib.inert = true; out.push(sib); }
  }
  return out;
}
function dialogOpened(node) {
  if (openDialogs.some(d => d.node === node)) return;
  const opener = lastOutside && lastOutside.isConnected ? lastOutside : null;
  openDialogs.push({ node, opener, openerId: opener?.id || '', dimmed: dimAround(node) });
  if (!node.contains(document.activeElement)) node.focus({ preventScroll: true });
}
function dialogClosed(entry, restore = true) {
  const i = openDialogs.indexOf(entry);
  if (i >= 0) openDialogs.splice(i, 1);
  for (const n of entry.dimmed) n.inert = false;
  if (!restore || $('app')?.hidden) return;                                  // приложение закрыто (блокировка): возвращать фокус некуда
  if (openDialogs.length) { openDialogs.at(-1).node.focus({ preventScroll: true }); return; }
  const back = (entry.opener?.isConnected && entry.opener) || (entry.openerId && document.getElementById(entry.openerId)) || $('title');
  const ok = back && !back.disabled && !back.closest('[hidden],[inert]') && focusNode(back);
  if (!ok) focusNode($('title'));
}
// Приложение заперли или вышли из аккаунта: все окна считаем закрытыми и возвращаем доступность странице.
export function releaseDialogs() { for (const d of [...openDialogs]) dialogClosed(d, false); }

function onDialogKey(e) {
  const top = openDialogs.at(-1);
  if (!top) return;
  const box = top.node;
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return;
    const closer = box.querySelector('button[id$="-close"]');
    if (closer && !closer.disabled) { e.preventDefault(); closer.click(); }
    return;
  }
  if (e.key !== 'Tab') return;
  const items = tabbables(box);
  if (!items.length) { e.preventDefault(); box.focus(); return; }
  const first = items[0], last = items.at(-1), a = document.activeElement;
  if (e.shiftKey ? (a === first || a === box || !box.contains(a)) : (a === last || !box.contains(a))) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
}
export function watchDialogs(root) {
  document.addEventListener('focusin', e => { if (e.target instanceof Element && !e.target.closest('[role=dialog]')) lastOutside = e.target; });
  document.addEventListener('keydown', e => { if (e.key === 'Tab') onDialogKey(e); }, true);       // в фазе перехвата: окно повторения гасит остальные клавиши само
  document.addEventListener('keydown', e => { if (e.key === 'Escape') onDialogKey(e); });
  new MutationObserver(records => {
    for (const d of [...openDialogs]) if (!d.node.isConnected) dialogClosed(d, false);               // экраны пересобраны (блокировка): окна исчезли вместе с ними
    for (const r of records) {
      if (r.type === 'attributes') {
        const n = r.target;
        if (isDialog(n)) { if (n.hidden) { const d = openDialogs.find(o => o.node === n); if (d) dialogClosed(d); } else dialogOpened(n); }
      } else {
        const d = r.target.closest?.('[role=dialog]');                                                // содержимое окна заменили, а фокус был на исчезнувшей кнопке
        if (d && openDialogs.some(o => o.node === d) && !d.contains(document.activeElement)) d.focus({ preventScroll: true });
      }
    }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
}
