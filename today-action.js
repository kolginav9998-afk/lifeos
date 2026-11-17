// «Самое полезное прямо сейчас»: выбор одной главной кнопки для экрана «Сегодня» и тёплая карточка «Всё сделано».
// Чистая логика: ничего не сохраняет и не показывает, только решает на основе уже существующих данных.
// Правило выбора открытое: просрочка → отметка утра → главное дело → минимум привычек → итог дня → «всё сделано».
import { rankTasks } from './planday.js';
import { activeHabits } from './habits.js';
import { isSick } from './sick.js';
import { checkinOf } from './diary.js';
import { joysOf } from './reflect.js';
import { daySummary } from './daycards.js';
import { makeRng } from './stats.js';

const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };

// Главное дело дня: первая важная (отмеченная «★») невыполненная задача в обычном порядке дел.
const mainTask = (events, today) => rankTasks(events, today).find(e => e.payload.priority === 'high') ?? null;

// Привычки, запланированные на сегодня (в режиме болезни они на паузе и не считаются).
const habitsToday = (events, today) => isSick(events, today) ? [] : activeHabits(events, today).filter(({ st }) => st.scheduledToday || st.doneToday);

// Кольцо дня закрыто: не осталось дел на сегодня и просроченных, все запланированные привычки отмечены —
// и при этом сегодня было что закрывать (хотя бы одно дело или привычка).
export function allDone(events, today) {
  const s = daySummary(events, today);
  if (s.left > 0) return false;
  const hs = habitsToday(events, today);
  if (hs.some(({ st }) => st.scheduledToday && !st.doneToday)) return false;
  return s.tasksDone > 0 || hs.some(({ st }) => st.doneToday);
}

// Одна самая полезная кнопка на сейчас. Возвращает null, если ничего явно полезного нет (не навязываем).
// hour — час дня (0–23), подставляется в тестах; «вечер» — с 18:00.
export function bestAction(events, today, { hour = new Date().getHours() } = {}) {
  const overdue = rankTasks(events, today).filter(e => e.payload.due && e.payload.due < today);
  if (overdue.length) return { kind: 'overdue', count: overdue.length, label: `Перенести ${overdue.length} ${plural(overdue.length, 'просроченную задачу', 'просроченные задачи', 'просроченных задач')}`, why: 'Эти дела ждут дольше всего — начни с них, и день станет легче.' };
  if (!checkinOf(events, today, 'm')) return { kind: 'morning', label: 'Отметить утро', why: 'Одна минута: отметь сон и самочувствие — так день начинается.' };
  const main = mainTask(events, today);
  if (main) { const t = main.payload.text; return { kind: 'main', taskId: main.id, label: `Главное дело: ${t.length > 60 ? t.slice(0, 57) + '…' : t}`, why: 'Ты сам отметил его важным. Одно такое дело — и день удался.' }; }
  const hs = habitsToday(events, today);
  if (hs.length && hs.every(({ st }) => !st.doneToday)) return { kind: 'habits', count: hs.length, label: 'Минимум привычек', why: 'Минимум тоже считается. Маленький шаг — уже шаг.' };
  if (hour >= 18 && !checkinOf(events, today, 'e')) return { kind: 'evening', label: 'Подвести итог дня', why: 'Пара отметок — и день спокойно закрыт.' };
  if (allDone(events, today)) return { kind: 'alldone' };
  return null;
}

// Тёплая карточка «Всё сделано»: запись из копилки радостей (одна и та же весь день — выбор по дате),
// а если радостей пока нет — простая тёплая строка о сделанном.
export function warmCard(events, today) {
  const joys = joysOf(events);
  if (joys.length) {
    const joy = makeRng(Number(today.replaceAll('-', ''))).pick(joys);
    return { kind: 'joy', text: joy.payload.text, date: joy.payload.date };
  }
  const s = daySummary(events, today);
  const parts = [];
  if (s.tasksDone) parts.push(`${s.tasksDone} ${plural(s.tasksDone, 'дело', 'дела', 'дел')}`);
  if (s.habitsDone) parts.push(`${s.habitsDone} ${plural(s.habitsDone, 'привычка', 'привычки', 'привычек')}`);
  return { kind: 'fact', text: `Сегодня: ${parts.join(', ')} — можно отдыхать` };
}
