// «Сегодня»: подсказки про само устройство. Неверные часы и нехватка места. Только предложения, ничего не меняют.
import { el, fill } from './ui.js';
import { todayStr } from './events.js';
import { getPref, setPref } from './prefs.js';
import { onOpen, clockHint } from './devicetime.js';
import { storageStatus, integrityHint } from './storageinfo.js';
import * as db from './db.js';
import { tabState } from './tabguard.js';

let tabsAbort = null;

export function createDeviceHints({ go }) {
  let tabsDismissed = false;
  let events = [];
  let storage = null;
  const root = el('div', { id: 'device-hints' });

  // при каждом запуске запоминаем время; если часы ушли назад, помним откуда, пока они не догонят
  const opened = onOpen({ lastOpenTs: getPref('lastOpenTs'), backFrom: getPref('clockBackFrom') });
  setPref('lastOpenTs', opened.lastOpenTs); setPref('clockBackFrom', opened.backFrom);

  // число других открытых окон приходит событием от app.js; при пересборке экранов старый слушатель снимаем
  tabsAbort?.abort(); tabsAbort = new AbortController();
  window.addEventListener('lifeos:tabs', () => render(), { signal: tabsAbort.signal });

  const card = (id, text, ...buttons) => el('div', { id, class: 'card calm hint-card' }, el('p', { textContent: text }), el('div', { class: 'row wrap' }, ...buttons));
  function render() {
    const today = todayStr(), out = [];
    const clock = getPref('clockAsked') !== today && clockHint({ events, backFrom: getPref('clockBackFrom') });
    if (clock) out.push(card('hint-clock', clock.text,
      el('button', { type: 'button', id: 'hint-clock-ok', class: 'chip', textContent: 'Понятно', onclick: () => { setPref('clockAsked', today); render(); } }),
      clock.kind === 'back' ? el('button', { type: 'button', id: 'hint-clock-fine', class: 'chip', textContent: 'Время верное', onclick: () => { setPref('clockBackFrom', 0); setPref('clockAsked', today); render(); } }) : null));
    const integ = getPref('integrityAsked') !== today && integrityHint({ idbOk: db.state.idbOk, idbError: db.state.idbError, corrupt: db.state.corrupt });
    if (integ) out.push(card('hint-integrity', integ.text,
      el('button', { type: 'button', id: 'hint-integrity-backup', class: 'chip', textContent: 'Сохранить архив', onclick: () => go('more') }),
      el('button', { type: 'button', class: 'chip', textContent: 'Понятно', onclick: () => { setPref('integrityAsked', today); render(); } })));
    if (tabState.others > 0 && !tabsDismissed) out.push(card('hint-tabs', `Приложение открыто ещё в окнах: ${tabState.others}. Записи из других окон подтягиваются сами, но лучше оставить одно окно: так данные не разойдутся.`,
      el('button', { type: 'button', class: 'chip', textContent: 'Понятно', onclick: () => { tabsDismissed = true; render(); } })));
    if (storage && storage.level === 'low' && getPref('storageAsked') !== today) out.push(card('hint-storage', storage.text,
      el('button', { type: 'button', id: 'hint-storage-backup', class: 'chip', textContent: 'Сделать копию', onclick: () => go('more') }),
      el('button', { type: 'button', class: 'chip', textContent: 'Понятно', onclick: () => { setPref('storageAsked', today); render(); } })));
    fill(root, ...out);
  }
  async function probe() {
    try { const est = await navigator.storage?.estimate?.(); storage = est ? storageStatus(est) : null; } catch { storage = null; }
    render();
  }
  probe();
  return { root, update(evs) { events = evs; render(); } };
}
