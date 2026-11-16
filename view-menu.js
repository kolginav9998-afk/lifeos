// Экран «Меню» («Меню» → «Все разделы»): куда зайти, чтобы сделать нужное. Поиск по словам («расход», «стирка», «английский»)
// и крупные плитки по смыслу. Каталог разделов лежит в menu.js; здесь только показ.
import { el, fill, icon } from './ui.js';
import { MENU_SECTIONS, searchMenu } from './menu.js';

export function createMenuView(ctx = {}) {
  const root = el('section', { id: 'view-menu', class: 'view' });
  const box = el('input', { id: 'menu-search', type: 'search', placeholder: 'Например: расход, стирка, английский', autocomplete: 'off', 'aria-label': 'Найти раздел' });
  const status = el('p', { id: 'menu-status', class: 'muted', role: 'status' });
  const head = el('section', { id: 'menu-head', class: 'card settings-card' },
    el('h3', { textContent: 'Куда зайти' }),
    el('p', { class: 'muted', textContent: 'Напиши, что хочешь сделать, или выбери раздел ниже.' }),
    box, status);
  const results = el('div', { id: 'menu-results', class: 'menu-grid', hidden: true });
  const sections = el('div', { id: 'menu-sections' });
  root.append(head, results, sections);

  const open = item => ctx.go?.(item.screen, { focus: true });
  const tile = item => el('button', { type: 'button', class: 'menu-tile', dataset: { screen: item.screen }, onclick: () => open(item) },
    el('strong', { textContent: item.title }), el('span', { class: 'muted', textContent: item.hint }));

  fill(sections, MENU_SECTIONS.map(s => el('section', { class: 'menu-sec', dataset: { sec: s.key } },
    el('h3', { class: 'menu-sec-h' }, icon(s.icon, 20), el('span', { textContent: s.title })),
    el('div', { class: 'menu-grid' }, ...s.items.map(tile)))));

  function renderSearch() {
    const q = box.value.trim();
    results.hidden = !q;
    sections.hidden = !!q;
    if (!q) { status.textContent = ''; fill(results); return; }
    const hits = searchMenu(q);
    status.textContent = hits.length ? `Найдено разделов: ${hits.length}` : 'Ничего не найдено. Попробуй другое слово, например «деньги» или «здоровье».';
    fill(results, hits.map(tile));
  }
  box.addEventListener('input', renderSearch);

  return { root, update() { renderSearch(); }, show() { box.value = ''; renderSearch(); } };
}
