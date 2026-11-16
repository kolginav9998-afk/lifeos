// Вкладка «Итоги»: сколько вещей и на какую сумму, что надеваешь чаще всего, что лежит без дела, что пора стирать, у чего кончается гарантия.
import { el, fill, emptyState, moneyText, dateRu } from './ui.js';
import { monthLabel } from './money.js';
import { summaryOf, timesText, ageText, plural } from './home.js';

export function createTotalsTab(H) {
  let by = 'month';                                       // график: по месяцам или по видам вещей
  const root = el('div', { class: 'hm-totals' });
  const link = (item, text) => el('button', { type: 'button', class: 'link hm-link', textContent: text ?? item.payload.name, onclick: () => H.openDetail(item.id) });
  const card = (title, ...kids) => el('section', { class: 'card hm-card-t' }, el('h2', { class: 'hm-h', textContent: title }), ...kids);
  const top = (title, rows, empty, note) => card(title, rows.length
    ? el('ol', { class: 'hm-top' }, ...rows.map(([item, value]) => el('li', {}, link(item), el('span', { class: 'hm-val', textContent: value }))))
    : el('p', { class: 'muted', textContent: empty }), note && rows.length ? el('p', { class: 'muted', textContent: note }) : null);
  const share = (label, n, max) => { const row = el('div', { class: 'cat' }, el('div', { class: 'cat-row' }, el('span', { textContent: label }), el('span', { class: 'muted', textContent: String(n) })), el('div', { class: 'progress thin', 'aria-hidden': 'true' }, el('span'))); row.querySelector('.progress span').style.setProperty('--w', `${Math.round((n / max) * 100)}%`); return row; };

  function chart(s) {
    const toggle = el('div', { class: 'seg-group hm-seg', role: 'group', 'aria-label': 'Как показать надевания' },
      ...[['month', 'По месяцам'], ['kind', 'По видам']].map(([k, t]) => el('button', { type: 'button', class: 'seg', id: `hm-by-${k}`, textContent: t, 'aria-pressed': String(by === k), dataset: { fk: `by|${k}` }, onclick: () => H.keep(() => { by = k; render(H.model()); }) })));
    if (!s.totalWears) return card('Надевания', el('p', { class: 'muted', textContent: 'Пока нет отметок. Нажимай «Надел» на карточках вещей — здесь появится график.' }));
    if (by === 'kind') { const max = Math.max(1, ...s.wearsByKind.map(k => k.wears)); return card('Надевания', toggle, ...s.wearsByKind.map(k => share(k.label, k.wears, max))); }
    const max = Math.max(1, ...s.wearsByMonth.map(x => x.wears));
    const bars = el('div', { class: 'bars hm-bars', role: 'img', 'aria-label': `Надевания по месяцам: ${s.wearsByMonth.map(x => `${monthLabel(x.ym).slice(0, 3).toLowerCase()} ${x.wears}`).join(', ')}` },
      ...s.wearsByMonth.map((x, i) => {
        const col = el('div', { class: `bar-col${i === s.wearsByMonth.length - 1 ? ' current' : ''}`, title: `${monthLabel(x.ym)}: ${timesText(x.wears)}` }, el('span', { class: 'bar-fill' }), el('span', { class: 'bar-n', textContent: String(x.wears) }), el('span', { class: 'bar-d', textContent: monthLabel(x.ym).slice(0, 3).toLowerCase() }));
        col.firstChild.style.setProperty('--h', `${Math.round((x.wears / max) * 100)}%`);
        return col;
      }));
    return card('Надевания', toggle, bars);
  }

  function render(m) {
    if (!m.items.length) { fill(root, emptyState({ art: 'home', title: 'Итогов пока нет', text: 'Добавь вещи и отмечай «Надел» и «Постирал»: здесь появятся рейтинги и графики.', action: { label: 'Добавить вещь', icon: 'plus', onClick: () => H.openEdit(null) } })); return; }
    const s = summaryOf(m), maxKind = s.byKind.reduce((x, k) => Math.max(x, k.count), 1), chartCard = chart(s);
    chartCard.id = 'hm-chart';
    const cell = (value, label) => el('p', { class: 'hm-cell' }, el('strong', { class: 'big', textContent: value }), el('span', { class: 'muted', textContent: label }));
    const hero = card('Всего', el('div', { class: 'hm-big3' }, cell(String(s.count), plural(s.count, 'вещь', 'вещи', 'вещей')), s.qty !== s.count ? cell(String(s.qty), 'штук всего') : null, s.priced ? cell(moneyText(s.valueMinor), `стоимость, цена указана у ${s.priced}`) : null),
      el('p', { class: 'muted', textContent: `Надето всего: ${timesText(s.totalWears)} · Стирок: ${s.totalWashes}${s.stored ? ` · На хранении: ${s.stored}` : ''}` }));
    const kinds = card('По видам', ...s.byKind.map(k => share(`${k.label}${k.qty !== k.count ? ` (${k.qty} шт.)` : ''}`, k.count, maxKind)));
    const laundry = card('Стирка', s.laundry.length
      ? el('p', {}, `Пора стирать: ${s.laundry.length} ${plural(s.laundry.length, 'вещь', 'вещи', 'вещей')}. `, el('button', { type: 'button', class: 'link hm-link', id: 'hm-to-wash', textContent: 'Открыть стирку', onclick: () => H.setTab('laundry') }))
      : el('p', { class: 'muted', textContent: 'Сейчас ничего не нужно стирать.' }));
    fill(root, hero, kinds, chartCard,
      top('Чаще всего надеваешь', s.mostWorn.map(r => [r.item, timesText(r.stats.wears)]), 'Пока нет отметок «Надел» или «Использовал».'),
      top('Дешевле всего за одно надевание', s.cheapest.map(r => [r.item, `${moneyText(r.stats.costPerWear)} · ${timesText(r.stats.wears)}`]), 'Нужна цена вещи и хотя бы 3 надевания.'),
      top('Давно лежат без дела', s.neverUsed.slice(0, 8).map(r => [r.item, ageText(r.stats.ageDays)]), 'Всё, что старше двух месяцев, хотя бы раз использовали.', 'Ни разу не использованы больше двух месяцев. Может, пора продать или отдать?'),
      laundry,
      top('Гарантия скоро кончится', s.warranties.map(r => [r.item, r.daysLeft === 0 ? 'сегодня' : `до ${dateRu(r.item.payload.warranty)} (${r.daysLeft} дн.)`]), 'В ближайшие 30 дней гарантии не кончаются.'));
  }
  return { root, render };
}
