// «Сегодня»: напоминания про деньги. Желания, которые отлежали сутки, и просроченные долги. Только предложения.
import { el, fill, toast, moneyText } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { wishesReady, resolveWish } from './wishes.js';
import { debtTotals, debtLeft, DIRECTIONS } from './debts.js';

export function createMoneyNudge({ go }) {
  let events = [];
  const root = el('div', { id: 'money-nudge', class: 'card calm', hidden: true });
  async function decide(w, status) {
    try { await store.save(resolveWish(w, status)); toast(status === 'dropped' ? 'Хорошее решение: деньги остались при тебе' : 'Отмечено', { actionLabel: 'Отменить', onAction: () => store.save(w) }); } catch (x) { toast(x.message); }
  }
  function render() {
    const ready = wishesReady(events), late = debtTotals(events, todayStr()).overdue;
    root.hidden = !ready.length && !late.length;
    if (root.hidden) { root.replaceChildren(); return; }             // текст желаний и имена должников не остаются в скрытой разметке
    fill(root,
      ready.length ? el('strong', { textContent: 'Сутки прошли: всё ещё нужно?' }) : null,
      ...ready.slice(0, 3).map(w => el('div', { class: 'row nudge-wish', dataset: { id: w.id } },
        el('span', { class: 'grow', textContent: w.payload.amountMinor ? `${w.payload.text} · ${moneyText(w.payload.amountMinor)}` : w.payload.text }),
        el('button', { type: 'button', class: 'chip nudge-keep', textContent: 'Да, нужно', onclick: () => decide(w, 'bought') }),
        el('button', { type: 'button', class: 'chip nudge-drop', textContent: 'Уже не нужно', onclick: () => decide(w, 'dropped') }))),
      ready.length > 3 ? el('p', { class: 'muted', textContent: `И ещё ${ready.length - 3}: они на экране «Планы».` }) : null,
      late.length ? el('strong', { textContent: 'Просрочен возврат' }) : null,
      ...late.slice(0, 3).map(d => el('div', { class: 'row nudge-debt', dataset: { id: d.id } },
        el('span', { class: 'grow', textContent: `${d.payload.who}: ${moneyText(debtLeft(d))} (${DIRECTIONS[d.payload.direction]})` }),
        el('button', { type: 'button', class: 'chip nudge-debt-open', textContent: 'Открыть', onclick: () => go('plans') }))));
  }
  return { root, update(evs) { events = evs; render(); } };
}
