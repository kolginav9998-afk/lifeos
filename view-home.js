// Экран «Дом»: вещи и одежда. Что у меня есть, где лежит, сколько раз надевал и стирал. Четыре вкладки: «Вещи», «Стирка», «Быт», «Итоги».
// Окна (добавить или изменить вещь, подробности) лежат поверх экрана и общие для всех вкладок. Блоки вкладок получают набор действий H и не знают друг о друге.
import { el, fill, toast } from './ui.js';
import * as store from './store.js';
import { todayStr } from './events.js';
import { homeModel, laundryOf, makeLog, newLogId, timesText, plural, householdAlerts } from './home.js';
import { createItemsTab } from './view-home-items.js';
import { createLaundryTab } from './view-home-laundry.js';
import { createTotalsTab } from './view-home-totals.js';
import { createCareTab } from './view-home-care.js';
import { createEditWindow } from './view-home-edit.js';
import { createDetailWindow } from './view-home-detail.js';

const TABS = [['items', 'Вещи'], ['laundry', 'Стирка'], ['care', 'Быт'], ['totals', 'Итоги']];

export function createHomeView() {
  let events = [], model = homeModel([], todayStr()), tab = 'items';
  const root = el('section', { id: 'view-home', class: 'view' });

  // Отметка одним нажатием («надел», «постирал», «полил»…) сразу для нескольких вещей. В сообщении есть кнопка «Отменить».
  async function mark(list, kind) {
    if (!list.length) return;
    const now = Date.now(), logs = list.map(item => { let t = now; while (store.get(newLogId(item.id, t))) t++; return makeLog(item, kind, {}, t); });
    const one = list.length === 1 ? list[0] : null, name = one?.payload.name, total = (model.stats.get(one?.id)?.wears ?? 0) + 1;      // счёт до записи: после неё экран уже обновится
    await store.saveMany(logs);
    const WHAT = { water: 'полив отмечен', repair: 'обслуживание отмечено' };
    const msg = !one ? (kind === 'wash' ? `Стирка отмечена: ${list.length} ${plural(list.length, 'вещь', 'вещи', 'вещей')}` : `Отметка записана: ${list.length} ${plural(list.length, 'вещь', 'вещи', 'вещей')}`)
      : kind === 'wash' ? `«${name}»: ${one.payload.kind === 'shoes' ? 'чистка' : 'стирка'} отмечена`
        : WHAT[kind] ? `«${name}»: ${WHAT[kind]}`
          : `«${name}»: ${kind === 'wear' ? 'надето' : 'использовано'} ${timesText(total)}`;
    toast(msg, { actionLabel: 'Отменить', onAction: async () => { await store.removeMany(logs.map(l => l.id)); toast('Отметка отменена'); } });
  }
  const H = {
    model: () => model, events: () => events, mark, keep, setTab: key => { tab = key; render(); },
    openDetail: id => detail.open(id), openEdit: (item, preset) => { detail.close(); edit.open(item, preset); },     // два окна подряд: подробности закрываются, правка открывается (менеджер окон не любит два открытых сразу)
  };
  const tabs = { items: createItemsTab(H), laundry: createLaundryTab(H), care: createCareTab(H), totals: createTotalsTab(H) };
  const edit = createEditWindow(H), detail = createDetailWindow(H);
  const buttons = TABS.map(([key, label]) => el('button', { type: 'button', id: `hm-tab-${key}`, class: 'seg', textContent: label, onclick: () => { tab = key; render(); } }));
  const body = el('div', { id: 'hm-body', class: 'hm-body' });
  root.append(el('div', { class: 'seg-group hm-tabs', role: 'group', 'aria-label': 'Разделы экрана «Дом»' }, ...buttons), body, detail.root, edit.root);   // окно правки позже окна подробностей: оно поверх

  // Нажатая кнопка при перерисовке заменяется новой: фокус возвращаем на такую же (у кнопок есть метка data-fk).
  function keep(redraw) {
    const a = document.activeElement, fk = a && root.contains(a) ? a.dataset.fk ?? null : null;
    redraw();
    if (fk) { const n = [...root.querySelectorAll('[data-fk]')].find(x => x.dataset.fk === fk); if (n && document.activeElement !== n) n.focus({ preventScroll: true }); }
  }
  function render() {
    keep(() => {
      model = homeModel(events, todayStr());
      const due = laundryOf(model).due.length, care = householdAlerts(events, model.today).count;
      TABS.forEach(([key, label], i) => { buttons[i].textContent = key === 'laundry' && due ? `${label} (${due})` : key === 'care' && care ? `${label} (${care})` : label; buttons[i].setAttribute('aria-pressed', String(key === tab)); });
      fill(body, tabs[tab].root);
      tabs[tab].render(model);
      detail.render(model);
    });
  }
  return { root, update(evs) { events = evs; if (!root.hidden) render(); }, show() { render(); } };
}
