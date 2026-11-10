// Человеческий экспорт: Markdown с задачами, привычками, заметками и расходами.
import { todayStr } from './events.js';
import { formatMoney } from './money.js';
import { activeHabits } from './habits.js';
import { formatMeasure } from './health.js';

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
  return L.join('\n') + '\n';
}
