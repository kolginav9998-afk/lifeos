// Вкладка «Вещи»: поиск, фильтры по виду и месту, крупные карточки. На карточке две кнопки: «Надел» и «Постирал» (плюс один в сегодняшнюю историю, с отменой).
import { el, fill, icon, emptyState, announce, dateRu } from './ui.js';
import { daysBetween } from './events.js';
import { KINDS, STATUS_LABEL, searchItems, placesOf, quickLogs, logButton, statsLine, WARRANTY_DAYS } from './home.js';

const SHOW = [['live', 'Всё, что у меня есть'], ['active', 'Только в использовании'], ['stored', 'Убрано на хранение'], ['gone', 'Проданное и выброшенное'], ['all', 'Вообще всё']];
const SORT = [['name', 'По названию'], ['new', 'Сначала новые'], ['worn', 'Чаще надеваю'], ['idle', 'Давно не использовал']];
const passStatus = (show, status) => (show === 'all' ? true : show === 'live' ? status === 'active' || status === 'stored' : show === 'gone' ? status === 'sold' || status === 'gone' : status === show);

export function createItemsTab(H) {
  const state = { q: '', kind: '', place: '', show: 'live', sort: 'name' };
  let searchTimer = 0, last = null;

  const q = el('input', { id: 'hm-q', type: 'search', placeholder: 'Найти вещь: куртка, шкаф, синий…', autocomplete: 'off', maxLength: 60, 'aria-label': 'Найти вещь' });
  q.oninput = () => { state.q = q.value; list(); clearTimeout(searchTimer); searchTimer = setTimeout(() => announce(count.textContent), 600); };
  const add = el('button', { type: 'button', id: 'hm-add', class: 'primary hm-add', onclick: () => H.openEdit(null) }, icon('plus', 20), 'Добавить вещь');
  const kinds = el('div', { id: 'hm-kinds', class: 'chips hm-kinds', role: 'group', 'aria-label': 'Вид вещи' });
  const select = (id, label, onchange) => { const s = el('select', { id }); s.onchange = () => onchange(s.value); return [el('label', { class: 'field hm-sel' }, el('span', { textContent: label }), s), s]; };
  const [placeBox, place] = select('hm-place', 'Где лежит', v => { state.place = v; list(); });
  const [showBox, show] = select('hm-show', 'Показать', v => { state.show = v; render(H.model()); });
  const [sortBox, sort] = select('hm-sort', 'Сначала', v => { state.sort = v; list(); });
  for (const [v, t] of SHOW) show.append(el('option', { value: v, textContent: t }));
  for (const [v, t] of SORT) sort.append(el('option', { value: v, textContent: t }));
  const count = el('p', { id: 'hm-count', class: 'muted hm-count' });
  const box = el('ul', { id: 'hm-list', class: 'hm-list' });
  const root = el('div', { class: 'hm-items' }, add, el('div', { class: 'hm-find' }, q), kinds, el('div', { class: 'hm-filters' }, placeBox, showBox, sortBox), count, box);

  const badge = (ic, text, cls = '') => el('span', { class: `hm-badge ${cls}`.trim() }, icon(ic, 14), text);
  function card(item, s, today) {
    const p = item.payload, id = item.id, acts = ['active', 'stored'].includes(p.status) ? quickLogs(p.kind) : [];
    const where = [p.place, p.brand, [p.color, p.size].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    const stat = statsLine(s, p.kind), left = p.warranty ? daysBetween(today, p.warranty) : null;
    const badges = [s.needsWash && p.status === 'active' ? badge('alert', 'Пора стирать', 'warn') : null, p.status !== 'active' ? badge('info', STATUS_LABEL[p.status] ?? p.status) : null,
      left !== null && left >= 0 && left <= WARRANTY_DAYS ? badge('shield', `Гарантия до ${dateRu(p.warranty)}`, 'warn') : null].filter(Boolean);
    const open = el('button', { type: 'button', id: `hm-o-${id}`, class: 'hm-open', onclick: () => H.openDetail(id) },
      el('strong', { class: 'hm-name', textContent: p.qty > 1 ? `${p.name} × ${p.qty}` : p.name }), where ? el('span', { class: 'hm-where', textContent: where }) : null,
      stat ? el('span', { class: 'hm-stat', textContent: stat }) : null, badges.length ? el('span', { class: 'hm-badges' }, ...badges) : null);
    const quick = acts.length ? el('div', { class: 'hm-quick' }, ...acts.map((k, i) => el('button', { type: 'button', class: `hm-q${i === 0 ? ' primary' : ''}${k === 'wash' && s.needsWash ? ' hm-due' : ''}`, dataset: { fk: `${id}|${k}` }, 'aria-label': `${logButton(k, p.kind)}: ${p.name}`,
      onclick: () => H.mark([item], k) }, icon(k === 'wash' ? 'sync' : 'check', 18), logButton(k, p.kind)))) : null;
    const art = el('article', { class: 'card hm-card', dataset: { id } }, open, quick);
    art.onclick = e => { if (!e.target.closest('button, a, input, select, label')) H.openDetail(id); };           // нажатие по пустому месту карточки тоже открывает подробности
    return el('li', { class: 'hm-li' }, art);
  }

  function ordered(items, m) {
    const st = i => m.stats.get(i.id), a = [...items];
    if (state.q.trim()) return searchItems(a, state.q);
    if (state.sort === 'new') return a.sort((x, y) => y.ts - x.ts);
    if (state.sort === 'worn') return a.sort((x, y) => st(y).wears - st(x).wears);
    if (state.sort === 'idle') return a.sort((x, y) => (st(y).daysSinceUse ?? 99999 + st(y).ageDays) - (st(x).daysSinceUse ?? 99999 + st(x).ageDays));
    return a;
  }
  function list() {
    const m = last ?? H.model();
    const base = m.items.filter(i => passStatus(state.show, i.payload.status));
    const shown = ordered(base.filter(i => (!state.kind || i.payload.kind === state.kind) && (!state.place || i.payload.place === state.place)), m);
    count.textContent = !m.items.length ? '' : shown.length === m.items.length ? `Вещей: ${shown.length}` : `Показано: ${shown.length} из ${m.items.length}`;
    if (shown.length) { fill(box, ...shown.map(i => card(i, m.stats.get(i.id), m.today))); return; }
    const none = !m.items.length
      ? emptyState({ art: 'home', title: 'Здесь пока пусто', text: 'Добавь первую вещь: куртку, чайник, комплект белья. Нужны только название и вид.', action: { label: 'Добавить вещь', icon: 'plus', onClick: () => H.openEdit(null) } })
      : emptyState({ art: 'search', title: 'Ничего не нашлось', text: 'Попробуй другое слово или покажи все вещи.', action: { label: 'Сбросить поиск и фильтры', onClick: () => { Object.assign(state, { q: '', kind: '', place: '', show: 'live' }); q.value = ''; render(H.model()); q.focus(); } } });
    fill(box, el('li', { class: 'hm-li' }, none));
  }

  function render(m) {
    last = m;
    const base = m.items.filter(i => passStatus(state.show, i.payload.status));
    const places = placesOf(m.items);
    if (state.place && !places.includes(state.place)) state.place = '';
    if (state.kind && !base.some(i => i.payload.kind === state.kind)) state.kind = '';
    const sig = places.join('\n');
    if (place.dataset.sig !== sig) { place.dataset.sig = sig; fill(place, el('option', { value: '', textContent: 'Везде' }), ...places.map(p => el('option', { value: p, textContent: p }))); }
    place.value = state.place; show.value = state.show; sort.value = state.sort; sort.disabled = !!state.q.trim();
    placeBox.hidden = !places.length;
    const counts = new Map();
    for (const i of base) counts.set(i.payload.kind, (counts.get(i.payload.kind) || 0) + 1);
    const chip = (key, label, n) => el('button', { type: 'button', class: 'chip hm-kind', textContent: `${label} (${n})`, 'aria-pressed': String(state.kind === key), dataset: { fk: `kind|${key}` }, onclick: () => H.keep(() => { state.kind = state.kind === key ? '' : key; render(H.model()); }) });
    fill(kinds, base.length > 1 && counts.size > 1 ? [chip('', 'Все', base.length), ...KINDS.filter(([k]) => counts.has(k)).map(([k, t]) => chip(k, t, counts.get(k)))] : []);
    kinds.hidden = !kinds.childNodes.length;
    list();
  }
  return { root, render };
}
