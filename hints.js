// Мягкие подсказки на «Сегодня»: мало сил, слишком много дел. Только предложения: сами они ничего не меняют.
import { checkinOf } from './diary.js';
import { addDays } from './events.js';

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

// Тяжёлая ночь после вечера с большим количеством кофе или чая: мягкая подсказка «кофе до 14:00» (совет на пробу, не вывод).
const cups = n => { const a = n % 100, b = a % 10; return a > 10 && a < 20 ? 'чашек' : b === 1 ? 'чашка' : b >= 2 && b <= 4 ? 'чашки' : 'чашек'; };
export function caffeineHint(events, today, minCups = 3) {
  const m = checkinOf(events, today, 'm')?.payload;
  if (!m) return null;
  const bad = (Number.isFinite(m.sleepQuality) && m.sleepQuality <= 2) || (Number.isFinite(m.sleepHours) && m.sleepHours > 0 && m.sleepHours < 6);
  if (!bad) return null;
  const c = checkinOf(events, addDays(today, -1), 'e')?.payload.caffeine;
  if (!Number.isFinite(c) || c < minCups) return null;
  return { cups: c, text: `Ночь была тяжёлой, а вчера было ${c} ${cups(c)} кофе или чая. Попробуй сегодня закончить с кофе и чаем до 14:00: так обычно легче засыпать. Это совет на пробу, а не вывод: проверь его экспериментом.` };
}
