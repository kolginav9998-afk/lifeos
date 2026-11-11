// Журнал дня: что было сделано в выбранный день, по времени. Только факты из данных.
import { todayStr } from './events.js';
import { formatMoney, KINDS } from './money.js';
import { MEASURES, formatMeasure } from './health.js';
import { lessonTitle } from './academy.js';

export function dayLog(events, date) {
  const out = [];
  for (const e of events) {
    const p = e.payload;
    if (e.type === 'task' && p.done && p.doneAt && todayStr(p.doneAt) === date) out.push({ ts: p.doneAt, kind: 'Задача', text: p.text, id: e.id });
    else if (e.type === 'habit_log' && p.date === date) out.push({ ts: e.ts, kind: 'Привычка', text: `${habitName(events, p.habitId)} — ${p.level === 'min' ? 'минимум' : 'полностью'}`, id: e.id });
    else if ((e.type === 'expense' || e.type === 'income') && p.date === date) out.push({ ts: e.ts, kind: KINDS[e.type].label, text: `${e.type === 'income' ? '+' : '−'}${formatMoney(p.amountMinor)} · ${p.category}${p.note ? ' — ' + p.note : ''}`, id: e.id });
    else if (e.type === 'measure' && p.date === date) out.push({ ts: e.ts, kind: 'Замер', text: `${p.kind === 'custom' ? p.name : MEASURES[p.kind]?.label ?? p.kind}: ${formatMeasure(p)}`, id: e.id });
    else if (e.type === 'checkin' && p.date === date) out.push({ ts: e.ts, kind: p.slot === 'm' ? 'Утро' : 'Вечер', text: ['mood', 'energy', 'stress'].filter(k => p[k]).map(k => `${{ mood: 'настроение', energy: 'энергия', stress: 'стресс' }[k]} ${p[k]}`).join(', ') || (p.sleepHours ? `сон ${p.sleepHours} ч` : 'отметка'), id: e.id });
    else if (e.type === 'diary' && p.date === date) out.push({ ts: e.ts, kind: 'Дневник', text: p.highlight || p.text.split('\n')[0] || '', id: e.id });
    else if (e.type === 'lesson' && p.date === date) { const l = lessonTitle(p.lesson); out.push({ ts: e.ts, kind: 'Урок', text: l ? `${l.title} (${l.track})` : p.lesson, id: e.id }); }
    else if (e.type === 'testrun' && p.date === date) out.push({ ts: p.startedAt, kind: 'Проверка', text: `${p.mode === 'quick' ? 'Быстрая' : p.mode === 'full' ? 'Полная' : 'Отдельный тест'} — тестов: ${Object.values(p.tests).filter(t => !t.skipped).length}${p.aborted ? ', прервана' : ''}`, id: e.id });
    else if (e.type === 'workout' && p.done && p.date === date) out.push({ ts: p.finishedAt || e.ts, kind: 'Тренировка', text: `${p.name} — подходов: ${p.exercises.reduce((n, x) => n + x.sets.length, 0)}${p.minutes ? `, ${p.minutes} мин` : ''}`, id: e.id });
    else if (e.type === 'focus' && p.date === date) out.push({ ts: e.ts, kind: 'Фокус', text: `${p.minutes} мин${p.label ? ' — ' + p.label : ''}${p.completed ? '' : ' (остановлено)'}`, id: e.id });
    else if (e.type === 'breath' && p.date === date) out.push({ ts: e.ts, kind: 'Дыхание', text: `${Math.round(p.seconds / 60 * 10) / 10} мин${p.before && p.after ? `, стресс ${p.before} → ${p.after}` : ''}`, id: e.id });
    else if (e.type === 'note' && todayStr(e.ts) === date) out.push({ ts: e.ts, kind: 'Заметка', text: p.text.split('\n').find(l => l.trim()) || '', id: e.id });
  }
  let reviews = 0, lastTs = 0;
  for (const e of events) if (e.type === 'srs') { const n = (e.payload.hist || []).filter(h => h[0] === date).length; if (n) { reviews += n; lastTs = Math.max(lastTs, e.ts); } }
  if (reviews) out.push({ ts: lastTs, kind: 'Повторение', text: `ответов на карточки: ${reviews}`, id: 'srs-day' });
  return out.sort((a, b) => a.ts - b.ts);
}
const habitName = (events, id) => events.find(e => e.type === 'habit' && e.id === id)?.payload.name || 'Привычка';
