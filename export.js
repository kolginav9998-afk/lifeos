// Человеческий экспорт: Markdown с задачами, привычками, заметками и расходами.
import { todayStr } from './events.js';
import { formatMoney } from './money.js';
import { activeHabits } from './habits.js';
import { formatMeasure } from './health.js';
import { doneWorkouts, setsOf } from './workouts.js';
import { goalProgress, subsOf } from './planning.js';

const esc = s => String(s).replace(/\r?\n/g, ' ');

export function toMarkdown(events, now = Date.now()) {
  const today = todayStr(now);
  const L = [`# Life OS — экспорт от ${today}`, ''];
  const tasks = events.filter(e => e.type === 'task');
  const open = tasks.filter(t => !t.payload.done).sort((a, b) => (a.payload.due || '9999').localeCompare(b.payload.due || '9999'));
  const done = tasks.filter(t => t.payload.done);
  L.push('## Задачи', '');
  for (const t of open) L.push(`- [ ] ${esc(t.payload.text)}${t.payload.priority === 'high' ? ' ★' : ''}${t.payload.due ? ` (до ${t.payload.due})` : ''}${t.payload.repeat ? ` ↻ ${t.payload.repeat.type}` : ''}`);
  for (const t of done) L.push(`- [x] ${esc(t.payload.text)}`);
  if (!tasks.length) L.push('_нет_');
  L.push('', '## Привычки', '');
  const hs = activeHabits(events, today);
  for (const { h, st } of hs) L.push(`- **${esc(h.payload.name)}**${h.payload.anchor ? ` — после: ${esc(h.payload.anchor)}` : ''}${h.payload.minimum ? `; минимум: ${esc(h.payload.minimum)}` : ''} (серия ${st.streak}, регулярность ${Math.round(st.consistency * 100)}%)`);
  if (!hs.length) L.push('_нет_');
  L.push('', '## Заметки', '');
  const notes = events.filter(e => e.type === 'note').sort((a, b) => a.ts - b.ts);
  for (const n of notes) L.push(`### ${todayStr(n.ts)}`, '', n.payload.text, '');
  if (!notes.length) L.push('_нет_', '');
  L.push('## Расходы', '');
  const ex = events.filter(e => e.type === 'expense').sort((a, b) => a.payload.date.localeCompare(b.payload.date));
  for (const e of ex) L.push(`- ${e.payload.date} — ${formatMoney(e.payload.amountMinor)} — ${esc(e.payload.category)}${e.payload.note ? ` (${esc(e.payload.note)})` : ''}`);
  if (!ex.length) L.push('_нет_');
  L.push('', '## Доходы', '');
  const inc = events.filter(e => e.type === 'income').sort((a, b) => a.payload.date.localeCompare(b.payload.date));
  for (const e of inc) L.push(`- ${e.payload.date} — ${formatMoney(e.payload.amountMinor)} — ${esc(e.payload.category)}${e.payload.note ? ` (${esc(e.payload.note)})` : ''}`);
  if (!inc.length) L.push('_нет_');
  L.push('', '## Дневник', '');
  const dia = events.filter(e => e.type === 'diary').sort((a, b) => a.payload.date.localeCompare(b.payload.date));
  for (const d of dia) { L.push(`### ${d.payload.date}`, ''); if (d.payload.highlight) L.push(`**Главное:** ${esc(d.payload.highlight)}`, ''); if (d.payload.text) L.push(d.payload.text, ''); if (d.payload.gratitude?.length) L.push('Благодарность: ' + d.payload.gratitude.map(esc).join('; '), ''); }
  if (!dia.length) L.push('_нет_', '');
  L.push('## Замеры', '');
  const ms = events.filter(e => e.type === 'measure').sort((a, b) => a.payload.date.localeCompare(b.payload.date));
  for (const m of ms) L.push(`- ${m.payload.date} — ${m.payload.kind === 'custom' ? esc(m.payload.name) : m.payload.kind}: ${formatMeasure(m.payload)}${m.payload.note ? ` (${esc(m.payload.note)})` : ''}`);
  if (!ms.length) L.push('_нет_');
  L.push('', '## Тренировки', '');
  for (const w of doneWorkouts(events).slice().reverse()) {
    L.push(`### ${w.payload.date} — ${esc(w.payload.name)} (подходов: ${setsOf(w)}${w.payload.minutes ? `, ${w.payload.minutes} мин` : ''})`);
    for (const ex of w.payload.exercises) L.push(`- ${esc(ex.name)}: ${ex.sets.map(s => ex.kind === 'time' ? `${s.sec} с` : ex.kind === 'cardio' ? `${Math.round((s.sec || 0) / 60)} мин` : `${s.reps}${s.kg ? '×' + s.kg : ''}`).join(', ')}`);
    L.push('');
  }
  if (!doneWorkouts(events).length) L.push('_нет_');
  const focus = events.filter(e => e.type === 'focus').sort((a, b) => a.payload.date.localeCompare(b.payload.date));
  L.push('', '## Фокус', '');
  for (const f of focus) L.push(`- ${f.payload.date} — ${f.payload.minutes} мин${f.payload.label ? ` — ${esc(f.payload.label)}` : ''}`);
  if (!focus.length) L.push('_нет_');
  const goals = goalProgress(events, today);
  L.push('', '## Цели накоплений', '');
  for (const g of goals) L.push(`- ${esc(g.goal.payload.title)}: ${formatMoney(g.saved)} из ${formatMoney(g.target)}${g.goal.payload.dueDate ? `, срок ${g.goal.payload.dueDate}` : ''}`);
  if (!goals.length) L.push('_нет_');
  const subs = subsOf(events);
  L.push('', '## Подписки', '');
  for (const s of subs) L.push(`- ${esc(s.payload.name)}: ${formatMoney(s.payload.amountMinor)} ${s.payload.period === 'year' ? 'в год' : 'в месяц'}${s.payload.active ? '' : ' (пауза)'}`);
  if (!subs.length) L.push('_нет_');
  const exps = events.filter(e => e.type === 'experiment').sort((a, b) => a.payload.startDate.localeCompare(b.payload.startDate));
  L.push('', '## Эксперименты', '');
  for (const x of exps) L.push(`- ${x.payload.startDate} — ${esc(x.payload.title)}: ${esc(x.payload.change)}${x.payload.cancelled ? ' (остановлен)' : ''}`);
  if (!exps.length) L.push('_нет_');
  return L.join('\n') + '\n';
}
