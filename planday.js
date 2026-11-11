// План дня: предложение, что и в каком порядке сделать сегодня. Ничего не планирует за человека и не сохраняется.
import { todayLoad } from './academy.js';
import { activeHabits } from './habits.js';
import { isSick } from './sick.js';

// Ранг задачи: сначала «важное», потом по срокам (просроченное и сегодняшнее раньше, без срока в конце).
export const taskRank = (e, today) => (e.payload.priority === 'high' ? 0 : 4) + (!e.payload.due ? 3 : e.payload.due < today ? 0 : e.payload.due === today ? 1 : 2);
export function rankTasks(events, today) {
  return events.filter(e => e.type === 'task' && !e.payload.done)
    .sort((a, b) => taskRank(a, today) - taskRank(b, today) || (a.payload.due || '9').localeCompare(b.payload.due || '9') || a.ts - b.ts);
}

const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// nowMinutes — сколько минут прошло с полуночи (местное время). Блоки идут подряд с перерывами; всё, что не влезло до конца дня, попадает в dropped.
export function planDay(events, today, { nowMinutes = 9 * 60, start = 9 * 60, end = 18 * 60, block = 50, pause = 10, tasks = 3 } = {}) {
  let t = Math.max(start, Math.ceil(nowMinutes / 10) * 10);
  const items = [], dropped = [];
  const put = (text, minutes, kind) => {
    if (t + minutes <= end) { items.push({ from: hm(t), to: hm(t + minutes), text, kind }); t += minutes + pause; } else dropped.push(text);
  };
  for (const e of rankTasks(events, today).slice(0, tasks)) put(e.payload.text, block, 'task');
  if (!isSick(events, today)) {
    const load = todayLoad(events, today), n = load.due + load.fresh;
    if (n > 0) put(`Повторение карточек (${Math.min(n, 15)})`, 10, 'learn');
    const pending = activeHabits(events, today).filter(x => !x.st.doneToday);
    if (pending.length) put(`Привычки, минимум: ${pending.slice(0, 3).map(x => x.h.payload.name).join(', ')}`, 10, 'habit');
  }
  return { items, dropped };
}
export const planText = (plan, date) => [`План дня ${date}`, ...plan.items.map(i => `${i.from}–${i.to}  ${i.text}`), ...(plan.dropped.length ? ['Не уместилось: ' + plan.dropped.join('; ')] : [])].join('\n');
