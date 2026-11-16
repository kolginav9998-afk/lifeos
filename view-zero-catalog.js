// Каталог внешних курсов к маршрутам «с нуля»: фильтры (предмет, язык, цена), ссылка на сайт и отметка «Мой статус» (запись `resource`).
// Дочерний блок экрана «С нуля» (view-zero.js). Ссылки открываются во внешнем окне без доступа к приложению: target="_blank" rel="noopener noreferrer".
import { el, fill, icon, announce, toast } from './ui.js';
import { RESOURCES, SUBJECTS, SUBJECT_LABEL, LANGS, LANG_LABEL, COSTS, COST_LABEL, LEVEL_LABEL, FORMAT_LABEL, AVAILABILITY_LABEL, RESOURCE_STATUSES, RESOURCE_STATUS_LABEL,
  filterResources, resourcesOfTrack, resourceStatus, resourceOf, makeResourceEvent } from './zero-resources.js';

const option = (value, label) => el('option', { value, textContent: label });
const filterSelect = (key, label, items, labels, onChange) => {
  const sel = el('select', { class: 'zero-filter', dataset: { filter: key } }, option('', 'Все'), ...items.map(v => option(v, labels[v])));
  sel.addEventListener('change', () => onChange(sel.value));
  return el('label', { class: 'field' }, el('span', { class: 'rating-label', textContent: label }), sel);
};

// ctx: { getEvents(), getTrack(), save(ev), onBack() }
export function createCatalog(ctx) {
  const filters = { subject: '', lang: '', cost: '' };
  const root = el('section', { class: 'zero-catalog', 'aria-labelledby': 'zero-cat-title' });
  const list = el('ul', { class: 'zero-res-list plain' });
  const status = el('p', { class: 'muted', role: 'status', id: 'zero-cat-status' });
  const present = key => [...new Set(RESOURCES.map(x => x[key]))];
  const redraw = () => draw();
  const title = el('h3', { id: 'zero-cat-title', tabIndex: -1, textContent: 'Внешние курсы' });
  root.append(
    el('button', { type: 'button', id: 'zero-catalog-back', class: 'link', textContent: '‹ К карте маршрута', onclick: () => ctx.onBack() }),
    el('div', { class: 'card' },
      title,
      el('p', { class: 'muted', textContent: 'Это ссылки на чужие сайты. Мы ничего оттуда не копируем и не отвечаем за содержание. Цена и условия могут измениться, проверь их на сайте.' }),
      el('div', { class: 'zero-filters' },
        filterSelect('subject', 'Предмет', SUBJECTS.filter(s => present('subject').includes(s)), SUBJECT_LABEL, v => { filters.subject = v; redraw(); }),
        filterSelect('lang', 'Язык материалов', LANGS.filter(s => present('lang').includes(s)), LANG_LABEL, v => { filters.lang = v; redraw(); }),
        filterSelect('cost', 'Цена', COSTS.filter(s => present('cost').includes(s)), COST_LABEL, v => { filters.cost = v; redraw(); })),
      status),
    list);

  function row(x, recommended, events) {
    const cur = resourceStatus(events, x.id);
    const sel = el('select', { class: 'zero-res-status', dataset: { res: x.id } }, ...RESOURCE_STATUSES.map(s => option(s, RESOURCE_STATUS_LABEL[s])));
    sel.value = cur;
    sel.addEventListener('change', async () => {
      try { await ctx.save(makeResourceEvent(x.id, sel.value, resourceOf(ctx.getEvents(), x.id)?.payload.note ?? '')); toast(`Отметка сохранена: ${RESOURCE_STATUS_LABEL[sel.value].toLowerCase()}`); }
      catch (e) { toast(e.message); sel.value = resourceStatus(ctx.getEvents(), x.id); }
    });
    return el('li', { class: 'card zero-res', dataset: { res: x.id, cost: x.cost, subject: x.subject } },
      recommended ? el('p', { class: 'zero-rec' }, icon('star', 14), ' Рекомендуем к этому маршруту') : null,
      el('h4', { class: 'zero-res-t', textContent: x.title }),
      el('p', { class: 'muted', textContent: x.provider }),
      el('div', { class: 'row wrap zero-chips' },
        ...[COST_LABEL[x.cost], LEVEL_LABEL[x.level], FORMAT_LABEL[x.format], LANG_LABEL[x.lang]].map(t => el('span', { class: 'chip static', textContent: t }))),
      el('p', { class: 'muted', textContent: x.costNote }),
      el('p', { textContent: x.note }),
      el('p', { class: 'muted zero-avail', textContent: x.lastChecked ? `${AVAILABILITY_LABEL[x.availability]}: ${x.lastChecked}` : AVAILABILITY_LABEL[x.availability] }),
      el('div', { class: 'row wrap' },
        el('a', { class: 'link-out zero-open', href: x.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Открыть сайт: ${x.title} (откроется в новом окне)` }, 'Открыть сайт ', icon('share', 14)),
        el('label', { class: 'zero-res-sel' }, el('span', { class: 'rating-label', textContent: 'Мой статус ' }), sel)));
  }

  function draw() {
    const events = ctx.getEvents(), focused = document.activeElement?.dataset?.res, hadFocus = root.contains(document.activeElement);
    const track = ctx.getTrack(), rec = resourcesOfTrack(track), recIds = new Set(rec.map(x => x.id));
    const all = [...rec, ...RESOURCES.filter(x => !recIds.has(x.id))];
    const shown = filterResources(all, filters);
    status.textContent = shown.length ? `Найдено: ${shown.length} из ${RESOURCES.length}` : 'По этим условиям ничего нет. Выбери «Все» в фильтрах.';
    fill(list, shown.map(x => row(x, recIds.has(x.id), events)));
    if (hadFocus && focused) list.querySelector(`.zero-res-status[data-res="${focused}"]`)?.focus({ preventScroll: true });
  }
  for (const f of ['subject', 'lang', 'cost']) root.querySelector(`[data-filter="${f}"]`).addEventListener('change', () => announce(status.textContent));
  return { root, draw, focusTitle: () => title.focus({ preventScroll: true }) };
}
