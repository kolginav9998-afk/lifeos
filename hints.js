// Мягкие подсказки на «Сегодня»: мало сил, слишком много дел. Только предложения: сами они ничего не меняют.
import { checkinOf } from './diary.js';

const f1 = v => String(Math.round(v * 10) / 10).replace('.', ',');

// Низкая энергия утром или короткая ночь → предложить «тяжёлый день».
export function lightDayHint(events, today) {
  const m = checkinOf(events, today, 'm')?.payload;
  if (!m) return null;
  if (Number.isFinite(m.energy) && m.energy <= 2) return { reason: 'energy', text: 'Утром ты отметил мало сил. Это нормально. «Тяжёлый день» оставит три главных дела и минимум по привычкам.' };
  if (Number.isFinite(m.sleepHours) && m.sleepHours > 0 && m.sleepHours < 5) return { reason: 'sleep', text: `Ночь была короткой (около ${f1(m.sleepHours)} ч). Лучше снизить планку: «Тяжёлый день» оставит три главных дела.` };
  return null;
}

// Слишком много дел на сегодня (с учётом просроченных): столько обычно не успеть.
export function overloadHint(events, today, limit = 7) {
  const n = events.filter(e => e.type === 'task' && !e.payload.done && e.payload.due && e.payload.due <= today).length;
  return n > limit ? { count: n, limit, text: `На сегодня и в просрочке ${n} дел. Столько обычно не успеть. Выбери три главных или перенеси остальное.` } : null;
}
