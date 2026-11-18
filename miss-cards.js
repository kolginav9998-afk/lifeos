// Слова, где в дикции сбилось ударение, — в свои карточки (ucard) для интервального повторения.
// Одна функция: из свежих промахов раунда «Ударения» собирает готовые записи ucard, которых ещё нет.
// Чистая логика: только читает журнал, ничего не сохраняет.
import { missedStress, stressById } from './diction.js';
import { userCards, makeUserCard } from './academy.js';
import { todayStr } from './events.js';

// → массив событий ucard по словам из промахов за последние days дней (по умолчанию 45, как в missedStress).
// Исправленные слова (fixed) missedStress уже убирает. Слова, для которых карточка с таким вопросом уже есть, пропускаются.
export function missWordCards(events, { today = todayStr(), days = 45, now = Date.now() } = {}) {
  const have = new Set(userCards(events ?? []).map(c => c.q));
  const out = [];
  for (const id of missedStress(events ?? [], today, days)) {
    const w = stressById(id);
    if (!w) continue;
    const q = `Ударение в слове «${w.id}»`;
    if (have.has(q)) continue;
    have.add(q);
    out.push(makeUserCard(q, `${w.right} (не ${w.wrong})`, now + out.length, null, w.hint));
  }
  return out;
}
