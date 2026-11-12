// Человеческий экспорт: Markdown с задачами, привычками, заметками и расходами.
import { APP_NAME } from './config.js';
import { todayStr } from './events.js';
import { formatMoney } from './money.js';
import { activeHabits } from './habits.js';
import { formatMeasure } from './health.js';
import { doneWorkouts, setsOf } from './workouts.js';
import { goalProgress, subsOf } from './planning.js';
import { peopleOf } from './people.js';
import { okrsOf, okrProgress } from './okr.js';
import { thoughtsOf } from './thoughts.js';
import { decisionsOf, joysOf, weekReflections, VERDICTS } from './reflect.js';
import { checkupsOf } from './prevent.js';
import { parkedOf } from './parked.js';
import { wishesOf } from './wishes.js';
import { debtsOf, debtLeft, DIRECTIONS } from './debts.js';
import { skillGroups, LEVELS } from './skills.js';
import { lessonTitle } from './academy.js';
import { sickRanges } from './sick.js';
import { medsOf } from './meds.js';
import { emergencyOf, emergencyLines } from './emergency.js';

const esc = s => String(s).replace(/\r?\n/g, ' ');

export function toMarkdown(events, now = Date.now()) {
  const today = todayStr(now);
  const L = [`# ${APP_NAME} — экспорт от ${today}`, ''];
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
  // Разделы, которые появляются только когда в них есть данные.
  const part = (title, lines) => { if (lines.length) L.push('', `## ${title}`, '', ...lines); };
  part('Люди', peopleOf(events).map(p => `- ${esc(p.payload.name)}${p.payload.birthday ? ` — день рождения ${p.payload.birthday.split('-').reverse().join('.')}${p.payload.birthYear ? `.${p.payload.birthYear}` : ''}` : ''}${p.payload.cadenceDays ? `; связываться раз в ${p.payload.cadenceDays} дн.` : ''}${p.payload.note ? `; ${esc(p.payload.note)}` : ''}`));
  part('Цели квартала', okrsOf(events).flatMap(o => [`- **${esc(o.payload.title)}** (${{ active: 'в работе', done: 'достигнута', dropped: 'снята' }[o.payload.status]}, ${Math.round(okrProgress(o) * 100)}%, срок ${o.payload.due})${o.payload.why ? ` — зачем: ${esc(o.payload.why)}` : ''}`,
    ...o.payload.krs.map(k => `  - ${esc(k.text)}: ${k.current} из ${k.target} ${esc(k.unit)}`.trimEnd())]));
  part('Мысли и эмоции', thoughtsOf(events).slice().reverse().map(t => `- ${t.payload.date} — ${t.payload.emotion}${Number.isFinite(t.payload.before) ? ` ${t.payload.before}${Number.isFinite(t.payload.after) ? ` → ${t.payload.after}` : ''}` : ''}: ${esc(t.payload.thought)}${t.payload.situation ? ` (ситуация: ${esc(t.payload.situation)})` : ''}${t.payload.alt ? `; иначе: ${esc(t.payload.alt)}` : ''}`));
  const ref = [];
  for (const e of events.filter(x => x.type === 'intention').sort((a, b) => a.payload.date.localeCompare(b.payload.date))) ref.push(`- ${e.payload.date} — намерение: ${esc(e.payload.text)}`);
  for (const e of events.filter(x => x.type === 'dayreview').sort((a, b) => a.payload.date.localeCompare(b.payload.date))) ref.push(`- ${e.payload.date} — обзор дня: ${[['получилось', e.payload.win], ['мешало', e.payload.miss], ['изменю', e.payload.learn]].filter(([, v]) => v).map(([k, v]) => `${k}: ${esc(v)}`).join('; ')}`);
  for (const e of weekReflections(events).slice().reverse()) ref.push(`- неделя с ${e.payload.week} — ${[['получилось', e.payload.went], ['мешало', e.payload.blocked], ['изменю', e.payload.change]].filter(([, v]) => v).map(([k, v]) => `${k}: ${esc(v)}`).join('; ')}`);
  const dec = decisionsOf(events);
  for (const e of [...dec.open, ...dec.closed]) ref.push(`- ${e.payload.date} — решение: ${esc(e.payload.title)}${e.payload.expect ? `; ожидал: ${esc(e.payload.expect)}` : ''}; вернуться ${e.payload.revisit}${e.payload.closed ? `; итог (${e.payload.closed.date}): ${VERDICTS[e.payload.closed.verdict]}${e.payload.closed.outcome ? `, ${esc(e.payload.closed.outcome)}` : ''}` : ''}`);
  for (const e of joysOf(events).slice().reverse()) ref.push(`- ${e.payload.date} — радость: ${esc(e.payload.text)}`);
  for (const e of parkedOf(events)) ref.push(`- ${e.payload.date} — отложено на ${e.payload.forDate}: ${esc(e.payload.text)}${e.payload.done ? ' (разобрано)' : ''}`);
  part('Рефлексия', ref);
  part('Хочу купить (отсрочка)', wishesOf(events).slice().reverse().map(w => `- ${w.payload.date} — ${esc(w.payload.text)}${w.payload.amountMinor ? `, ${formatMoney(w.payload.amountMinor)}` : ''}: ${{ wait: 'ждёт решения', bought: 'куплено', dropped: 'передумал' }[w.payload.status]}`));
  part('Навыки', skillGroups(events).flatMap(g => [`**${esc(g.area)}**`, ...g.items.map(e => `- ${esc(e.payload.title)} — ${LEVELS[e.payload.level].toLowerCase()}, с ${e.payload.date}${e.payload.evidence ? ` (${esc(e.payload.evidence)})` : ''}${e.payload.note ? `. ${esc(e.payload.note)}` : ''}`)]));
  part('Долги и займы', debtsOf(events).map(d => `- ${DIRECTIONS[d.payload.direction]}: ${esc(d.payload.who)}, ${formatMoney(d.payload.amountMinor)}${d.payload.due ? `, срок ${d.payload.due}` : ''}${d.payload.settled ? ' (закрыт)' : d.payload.paidMinor ? `, осталось ${formatMoney(debtLeft(d))}` : ''}${d.payload.note ? `; ${esc(d.payload.note)}` : ''}`));
  part('Конспекты уроков', events.filter(e => e.type === 'lessonnote').sort((a, b) => a.payload.date.localeCompare(b.payload.date)).map(e => `- ${lessonTitle(e.payload.lesson)?.title ?? e.payload.lesson} (${e.payload.date}): ${esc(e.payload.text)}`));
  part('Профилактика', checkupsOf(events).map(c => `- ${esc(c.payload.name)}: раз в ${c.payload.months} мес.; последний раз ${c.payload.last ?? 'не отмечен'}`));
  part('Лекарства и добавки', medsOf(events).map(m => `- ${esc(m.payload.name)}${m.payload.dose ? ` — ${esc(m.payload.dose)}` : ''}${m.payload.active ? '' : ' (пауза)'}`));
  part('Режим болезни', sickRanges(events).sort((a, b) => a.from.localeCompare(b.from)).map(r => `- с ${r.from}${r.to ? ` по ${r.to}` : ' (идёт)'}`));
  const em = emergencyOf(events);
  if (em) part('Данные на экстренный случай', emergencyLines(em.payload).map(([k, v]) => `- ${k}: ${esc(v)}`));
  return L.join('\n') + '\n';
}
