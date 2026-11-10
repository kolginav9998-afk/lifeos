// Поиск по всем данным. Без индексов и без ИИ: нормализация + «все слова должны встретиться».
import { MAX_TEXT } from './events.js';

export function normalize(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
}

function searchable(e) {
  const p = e.payload;
  switch (e.type) {
    case 'task': return { kind: 'Задача', title: p.text, text: p.text };
    case 'note': return { kind: 'Заметка', title: p.text.split('\n').find(l => l.trim()) || '', text: p.text };
    case 'habit': return { kind: 'Привычка', title: p.name, text: [p.name, p.anchor, p.minimum, p.full].join(' ') };
    case 'expense': return { kind: 'Расход', title: `${p.category}${p.note ? ' — ' + p.note : ''}`, text: [p.category, p.note, (p.amountMinor / 100).toFixed(2), p.date].join(' ') };
    case 'income': return { kind: 'Доход', title: `${p.category}${p.note ? ' — ' + p.note : ''}`, text: [p.category, p.note, (p.amountMinor / 100).toFixed(2), p.date].join(' ') };
    default: return null;
  }
}
export const TAB_OF = { task: 'today', note: 'notes', habit: 'habits', expense: 'money', income: 'money' };

export function searchEvents(events, query, limit = 50) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  for (const e of events) {
    const s = searchable(e);
    if (!s) continue;
    const hay = normalize(s.text);
    if (tokens.every(t => hay.includes(t))) out.push({ ev: e, kind: s.kind, title: s.title.slice(0, MAX_TEXT), tab: TAB_OF[e.type] });
  }
  out.sort((a, b) => b.ev.ts - a.ev.ts);
  return out.slice(0, limit);
}
