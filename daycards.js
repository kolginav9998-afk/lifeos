// «Сегодня»: бриф на день (утром: что главное) и итог дня (вечером: что сделано). Только сводка того, что уже есть в данных:
// ничего не оценивает, не ставит баллов и не сохраняется. Чистая логика.
import { addDays, todayStr } from './events.js';
import { rankTasks } from './planday.js';
import { activeHabits } from './habits.js';
import { todayLoad } from './academy.js';
import { upcomingBirthdays, dueContacts } from './people.js';
import { checkupsDue } from './prevent.js';
import { decisionsDue, intentionOf } from './reflect.js';
import { parkedDue } from './parked.js';
import { medsOf, WHEN } from './meds.js';
import { isSick } from './sick.js';
import { practiceBy } from './practice.js';
import { focusMinutes } from './focus.js';
import { doneWorkouts } from './workouts.js';
import { dayMood } from './diary.js';

const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
const f1 = v => String(Math.round(v * 10) / 10).replace('.', ',');

// ---------- бриф на день ----------
export function dayBrief(events, today, { tasks = 3 } = {}) {
  const sick = isSick(events, today);
  const ranked = rankTasks(events, today);
  const habits = activeHabits(events, today).filter(({ st }) => st.scheduledToday && !st.doneToday).map(({ h }) => ({ name: h.payload.name, minimum: h.payload.minimum }));
  const load = todayLoad(events, today);
  const meds = medsOf(events).filter(m => m.payload.when !== 'asneeded').map(m => ({ name: m.payload.name, when: m.payload.when }));
  return {
    date: today, sick,
    intention: intentionOf(events, today)?.payload.text ?? '',
    tasks: ranked.slice(0, tasks).map(e => ({ text: e.payload.text, due: e.payload.due || null, overdue: !!e.payload.due && e.payload.due < today, high: e.payload.priority === 'high' })),
    tasksTotal: ranked.length,
    habits: sick ? [] : habits,
    cards: { due: load.due, fresh: load.fresh },
    meds,
    birthdays: upcomingBirthdays(events, today, 1).map(b => ({ name: b.person.payload.name, inDays: b.inDays })),
    contacts: dueContacts(events, today).slice(0, 3).map(c => c.person.payload.name),
    checkups: checkupsDue(events, today).length,
    decisions: decisionsDue(events, today).length,
    parked: parkedDue(events, today).length,
  };
}
export function briefText(b) {
  const L = [`Бриф на ${b.date}`];
  if (b.sick) L.push('Режим болезни: отдыхай, привычки и проверки на паузе.');
  if (b.intention) L.push(`Намерение дня: ${b.intention}`);
  if (b.tasks.length) L.push('Главное:', ...b.tasks.map((t, i) => `${i + 1}. ${t.high ? '★ ' : ''}${t.text}${t.overdue ? ' (просрочено)' : t.due === b.date ? ' (сегодня)' : ''}`), ...(b.tasksTotal > b.tasks.length ? [`И ещё дел в списке: ${b.tasksTotal - b.tasks.length}`] : []));
  else L.push('Открытых задач нет.');
  if (b.habits.length) L.push(`Привычки на сегодня: ${b.habits.map(h => (h.minimum ? `${h.name} (минимум: ${h.minimum})` : h.name)).join(', ')}`);
  if (b.cards.due + b.cards.fresh) L.push(`Карточки: к повторению ${b.cards.due}, новых ${b.cards.fresh}`);
  if (b.meds.length) L.push(`Лекарства и добавки: ${b.meds.map(m => `${m.name} (${WHEN[m.when] ?? m.when})`).join(', ')}`);
  if (b.birthdays.length) L.push(`День рождения: ${b.birthdays.map(x => `${x.name} (${x.inDays === 0 ? 'сегодня' : 'завтра'})`).join(', ')}`);
  if (b.contacts.length) L.push(`Давно не общались: ${b.contacts.join(', ')}`);
  const more = [b.checkups && `проверки здоровья: ${b.checkups}`, b.decisions && `решения, которые пора оценить: ${b.decisions}`, b.parked && `отложенные мысли: ${b.parked}`].filter(Boolean);
  if (more.length) L.push(`Не забыть: ${more.join('; ')}`);
  return L.join('\n');
}

// ---------- итог дня ----------
export function daySummary(events, today) {
  const done = events.filter(e => e.type === 'task' && e.payload.done && e.payload.doneAt && todayStr(e.payload.doneAt) === today);
  const dueToday = events.filter(e => e.type === 'task' && e.payload.due === today);
  const open = rankTasks(events, today);
  const hs = activeHabits(events, today).filter(({ st }) => st.scheduledToday || st.doneToday);
  const study = Object.values(practiceBy(events, today, today)).reduce((s, r) => s + r.total, 0);
  const workout = doneWorkouts(events).filter(e => e.payload.date === today).reduce((s, e) => s + (e.payload.minutes || 0), 0);
  const skills = events.filter(e => e.type === 'skill' && e.payload.date === today).length;
  const mood = dayMood(events, today);
  return {
    date: today,
    tasksDone: done.length, dueTotal: dueToday.length, dueDone: dueToday.filter(e => e.payload.done).length,
    overdue: open.filter(e => e.payload.due && e.payload.due < today).length, left: open.filter(e => e.payload.due && e.payload.due <= today).length,
    tomorrow: open.filter(e => e.payload.due === addDays(today, 1)).length,
    habitsPlanned: hs.length, habitsDone: hs.filter(({ st }) => st.doneToday).length,
    study, focus: focusMinutes(events, today), workout, skills, mood: Number.isFinite(mood) ? mood : null,
  };
}
export function summaryText(s) {
  const L = [`Итог дня ${s.date}`];
  L.push(`Задач сделано: ${s.tasksDone}${s.dueTotal ? ` (из назначенных на сегодня: ${s.dueDone} из ${s.dueTotal})` : ''}`);
  if (s.habitsPlanned) L.push(`Привычки: ${s.habitsDone} из ${s.habitsPlanned}`);
  const parts = [s.study && `учёба ${s.study} мин`, s.focus && `фокус ${s.focus} мин`, s.workout && `тренировка ${s.workout} мин`, s.skills && `новых навыков: ${s.skills}`].filter(Boolean);
  if (parts.length) L.push(`Ещё: ${parts.join(', ')}`);
  if (s.mood !== null) L.push(`Настроение: ${f1(s.mood)} из 5`);
  if (s.left) L.push(`Осталось на сегодня и просрочено: ${s.left} ${plural(s.left, 'задача', 'задачи', 'задач')}`);
  if (s.tomorrow) L.push(`На завтра назначено: ${s.tomorrow} ${plural(s.tomorrow, 'задача', 'задачи', 'задач')}`);
  if (s.tasksDone + s.habitsDone + s.study + s.focus + s.workout === 0) L.push('Сегодня ничего не отмечено. Это нормально: завтра новый день.');
  return L.join('\n');
}

// ---------- когда есть 10 минут ----------
// Быстрые дела: задачи с меткой #быстро, #10мин или #5мин, минимум привычек на сегодня и карточки. Подсказка, что сделать в «окошко» времени.
export const QUICK_RE = /(^|\s)#(быстро|10мин|10м|5мин|5м)(?=\s|$)/i;
export function tenMinutes(events, today, { tasks = 5, habits = 3 } = {}) {
  const sick = isSick(events, today);
  const quick = rankTasks(events, today).filter(e => QUICK_RE.test(e.payload.text));
  const hs = sick ? [] : activeHabits(events, today).filter(({ st }) => st.scheduledToday && !st.doneToday).slice(0, habits).map(({ h }) => ({ name: h.payload.name, minimum: h.payload.minimum }));
  const load = sick ? { due: 0, fresh: 0 } : todayLoad(events, today);
  return { tasks: quick.slice(0, tasks).map(e => e.payload.text.replace(QUICK_RE, ' ').replace(/\s+/g, ' ').trim()), tasksTotal: quick.length, habits: hs, cards: Math.min(10, load.due + load.fresh) };
}
export function tenText(t) {
  const L = [];
  for (const x of t.tasks) L.push(`Дело: ${x}`);
  for (const h of t.habits) L.push(`Привычка, минимум: ${h.name}${h.minimum ? ` (${h.minimum})` : ''}`);
  if (t.cards) L.push(`Карточки: ${t.cards} (около ${Math.max(2, Math.round(t.cards / 3))} мин)`);
  return L;
}
