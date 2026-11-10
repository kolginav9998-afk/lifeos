// Журнал дня: что было сделано в выбранный день, по времени. Только факты из данных.
import { todayStr } from './events.js';
import { formatMoney, KINDS } from './money.js';

export function dayLog(events, date) {
  const out = [];
  for (const e of events) {
    const p = e.payload;
    if (e.type === 'task' && p.done && p.doneAt && todayStr(p.doneAt) === date) out.push({ ts: p.doneAt, kind: 'Задача', text: p.text, id: e.id });
    else if (e.type === 'habit_log' && p.date === date) out.push({ ts: e.ts, kind: 'Привычка', text: `${habitName(events, p.habitId)} — ${p.level === 'min' ? 'минимум' : 'полностью'}`, id: e.id });
    else if ((e.type === 'expense' || e.type === 'income') && p.date === date) out.push({ ts: e.ts, kind: KINDS[e.type].label, text: `${e.type === 'income' ? '+' : '−'}${formatMoney(p.amountMinor)} · ${p.category}${p.note ? ' — ' + p.note : ''}`, id: e.id });
    else if (e.type === 'note' && todayStr(e.ts) === date) out.push({ ts: e.ts, kind: 'Заметка', text: p.text.split('\n').find(l => l.trim()) || '', id: e.id });
  }
  return out.sort((a, b) => a.ts - b.ts);
}
const habitName = (events, id) => events.find(e => e.type === 'habit' && e.id === id)?.payload.name || 'Привычка';
