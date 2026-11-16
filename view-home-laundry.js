// Вкладка «Стирка»: что пора стирать (по правилам вещей), по способам ухода; галочки и одна кнопка «Загрузил(а) — отметить стирку».
import { el, fill, emptyState } from './ui.js';
import { laundryOf, laundryGroups, careOf, careText, washProgress, plural } from './home.js';

export function createLaundryTab(H) {
  const off = new Set(), on = new Set();                 // снятые человеком из «пора стирать» и добавленные из «носили, но ещё не пора»
  let rows = [], soonOpen = null;
  const picked = r => (r.due ? !off.has(r.item.id) : on.has(r.item.id));
  const intro = el('p', { class: 'muted hm-help', textContent: 'Здесь вещи, которые пора стирать по твоим правилам. Загрузил(а) в машину — нажми кнопку внизу, и счётчики начнутся заново.' });
  const box = el('div', { id: 'hm-wash-list', class: 'hm-wash' });
  const go = el('button', { type: 'button', id: 'hm-wash-go', class: 'primary big-btn hm-go' });
  const bar = el('div', { class: 'hm-washbar' }, go);
  const root = el('div', { class: 'hm-laundry' }, intro, box, bar);

  function paint() {
    const n = rows.filter(picked).length;
    go.textContent = n ? `Загрузил(а) — отметить стирку (${n})` : 'Загрузил(а) — отметить стирку';
    go.disabled = !n;
  }
  go.onclick = async () => {
    const list = rows.filter(picked).map(r => r.item);
    off.clear(); on.clear();
    await H.mark(list, 'wash');
    document.getElementById('hm-tab-laundry')?.focus({ preventScroll: true });          // нажатая кнопка стала неактивной: фокус на вкладку
  };

  function row(r) {
    const { item, stats } = r, p = item.payload, w = washProgress(item, stats), c = careOf(p);
    const cb = el('input', { type: 'checkbox', checked: picked(r) });
    cb.onchange = () => { if (r.due) { if (cb.checked) off.delete(item.id); else off.add(item.id); } else if (cb.checked) on.add(item.id); else on.delete(item.id); paint(); };
    const meter = w ? el('div', { class: `progress thin${stats.needsWash ? ' warn' : ''}`, 'aria-hidden': 'true' }, el('span')) : null;
    meter?.firstChild.style.setProperty('--w', `${Math.round(Math.min(1, w.fraction) * 100)}%`);
    return el('li', { class: 'hm-row', dataset: { id: item.id } },
      el('label', { class: 'hm-pick' }, cb, el('span', { class: 'hm-rname', textContent: p.name })),
      el('span', { class: 'muted hm-rcare', textContent: careText({ ...c, washEveryWears: null, washEveryDays: null }) }),
      meter, el('span', { class: 'hm-mtext', textContent: w ? `${w.text}${stats.needsWash ? ' · пора стирать' : ''}` : `Надето после стирки: ${stats.wearsSinceWash}` }));
  }
  const groups = list => laundryGroups(list).flatMap(g => [el('h3', { class: 'hm-gh', textContent: `${g.label} (${g.rows.length})` }), el('ul', { class: 'hm-rows' }, ...g.rows.map(row))]);

  function render(m) {
    const { due, soon } = laundryOf(m);
    rows = [...due.map(r => ({ ...r, due: true })), ...soon.map(r => ({ ...r, due: false }))];
    const all = el('button', { type: 'button', id: 'hm-wash-all', class: 'chip', textContent: rows.every(picked) ? 'Снять все галочки' : 'Выбрать все', dataset: { fk: 'wash-all' }, onclick: () => H.keep(() => {
      if (rows.every(picked)) { off.clear(); for (const r of rows) if (r.due) off.add(r.item.id); on.clear(); } else { off.clear(); for (const r of rows) if (!r.due) on.add(r.item.id); }
      render(H.model());
    }) });
    const parts = [];
    if (due.length) parts.push(el('div', { class: 'hm-sec' }, el('h2', { class: 'hm-h', textContent: `Пора стирать: ${due.length} ${plural(due.length, 'вещь', 'вещи', 'вещей')}` }), rows.length > 1 ? all : null, ...groups(due)));
    else if (!soon.length) parts.push(emptyState({ art: 'home', title: 'Стирать пока нечего', text: 'Когда вещь надета столько раз, сколько указано в её правилах, она появится здесь. Правила стирки задаются в параметрах вещи.' }));
    else parts.push(el('p', { class: 'hm-ok', textContent: 'Пока ничего не просится в стирку.' }));
    if (soon.length) {
      const d = el('details', { class: 'card hm-soon', open: soonOpen ?? !due.length }, el('summary', { textContent: `Носили, но ещё не пора (${soon.length})` }),
        el('p', { class: 'muted', textContent: 'Можно постирать раньше срока: поставь галочку.' }), ...groups(soon));
      d.addEventListener('toggle', () => { soonOpen = d.open; });
      parts.push(d);
    }
    fill(box, ...parts);
    bar.hidden = !rows.length;
    paint();
  }
  return { root, render };
}
