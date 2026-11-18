// Бережная адаптация повторений: чистая логика без интерфейса и хранилища.
// 1) decay урока подстраивается под реальное забывание (применяется в curriculum.js).
// 2) «сегодня минимум»: короткая очередь на один день без новых карточек (применяется в view-learn.js).

export const STREAK_N = 2;        // столько подряд провалов или успехов переключает режим
export const ADAPT_MIN = 1.5;     // после провалов повторяем чаще: decay не ниже этого
export const ADAPT_MAX = 2;       // …и не выше этого
export const MIN_QUEUE = 5;       // «сегодня минимум»: столько карточек остаётся на день

// Новый decay по истории результатов проверок урока (outcomes — true/false по порядку времени).
// Два подряд провала → decay поднимается (в полтора раза, но в пределах ADAPT_MIN..ADAPT_MAX): повторения чаще.
// Два подряд успеха → возврат к исходному. Одиночный успех режим не снимает: память об уроке ещё неустойчивая.
// → { decay (текущий), fails, passes (серии подряд на конец истории), elevated }
export function decayState(base, outcomes) {
  const b = Number(base) > 0 ? Number(base) : 1;
  let fails = 0, passes = 0, elevated = false;
  for (const ok of outcomes ?? []) {
    if (ok) { passes += 1; fails = 0; if (passes >= STREAK_N) elevated = false; }
    else { fails += 1; passes = 0; if (fails >= STREAK_N) elevated = true; }
  }
  return { decay: elevated ? Math.min(ADAPT_MAX, Math.max(ADAPT_MIN, b * 1.5)) : b, fails, passes, elevated };
}

// «сегодня минимум»: оставить не больше min карточек на повторение, новых — ни одной.
// Прогресс не накручивается: отложенные карточки просто подождут до завтра.
export function trimQueue(queue, min = MIN_QUEUE) {
  return (queue ?? []).filter(x => x?.state).slice(0, Math.max(0, Math.floor(min)));
}

// Режим действует только в день отметки: даты совпали — активен, завтра всё как обычно.
export const minDayActive = (mark, today) => typeof mark === 'string' && mark !== '' && mark === today;
