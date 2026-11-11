// Поиск по всем данным. Без индексов и без ИИ: нормализация + «все слова должны встретиться».
import { MAX_TEXT } from './events.js';
import { lessonTitle } from './academy.js';

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
    case 'diary': return { kind: 'Дневник', title: p.highlight || p.text.split('\n')[0] || p.date, text: [p.text, p.highlight, ...(p.gratitude || []), p.date, ...(p.tags || [])].join(' ') };
    case 'measure': return { kind: 'Замер', title: `${p.kind === 'custom' ? p.name : p.kind} ${p.value}${p.value2 !== undefined ? '/' + p.value2 : ''}`, text: [p.kind, p.name, p.value, p.value2, p.note, p.date].filter(x => x !== undefined).join(' ') };
    case 'workout': return { kind: 'Тренировка', title: `${p.name} · ${p.date}`, text: [p.name, p.note, p.date, ...p.exercises.map(x => x.name)].join(' ') };
    case 'goal': return { kind: 'Цель', title: p.title, text: p.title };
    case 'sub': return { kind: 'Подписка', title: p.name, text: p.name };
    case 'experiment': return { kind: 'Эксперимент', title: p.title, text: [p.title, p.change].join(' ') };
    case 'focus': return p.label ? { kind: 'Фокус', title: `${p.label} · ${p.minutes} мин`, text: p.label } : null;
    case 'ucard': return { kind: 'Карточка', title: p.q, text: [p.q, p.a, p.hint].join(' ') };
    case 'person': return { kind: 'Человек', title: p.name, text: [p.name, p.note].join(' ') };
    case 'okr': return { kind: 'Цель квартала', title: p.title, text: [p.title, p.why, ...p.krs.map(k => k.text)].join(' ') };
    case 'thought': return { kind: 'Мысль', title: p.thought, text: [p.situation, p.thought, p.emotion, p.alt].join(' ') };
    case 'intention': return { kind: 'Намерение', title: p.text, text: p.text };
    case 'dayreview': return { kind: 'Обзор дня', title: p.win || p.miss || p.learn || p.date, text: [p.win, p.miss, p.learn, p.date].join(' ') };
    case 'weekreflect': return { kind: 'Итоги недели', title: p.went || p.blocked || p.change || p.week, text: [p.went, p.blocked, p.change].join(' ') };
    case 'decision': return { kind: 'Решение', title: p.title, text: [p.title, p.why, p.expect, p.closed?.outcome].join(' ') };
    case 'lessonnote': return { kind: 'Конспект', title: `${lessonTitle(p.lesson)?.title ?? 'Урок'}: ${p.text}`, text: [lessonTitle(p.lesson)?.title, p.text].join(' ') };
    case 'skill': return { kind: 'Навык', title: p.title, text: [p.title, p.area, p.note, p.evidence].join(' ') };
    case 'parked': return { kind: 'Отложено', title: p.text, text: p.text };
    case 'wish': return { kind: 'Хочу купить', title: p.text, text: p.text };
    case 'debt': return { kind: 'Долг', title: `${p.who}${p.note ? ' — ' + p.note : ''}`, text: [p.who, p.note].join(' ') };
    case 'joy': return { kind: 'Радость', title: p.text, text: p.text };
    case 'checkin': return p.note ? { kind: p.slot === 'm' ? 'Утро' : 'Вечер', title: p.note, text: [p.note, p.date].join(' ') } : null;
    default: return null;
  }
}
// Коротко: что это за запись (для списка «чем отличается» при загрузке архива).
export function describeEvent(e) { const s = searchable(e); return s ? { kind: s.kind, title: String(s.title ?? '').slice(0, 60) } : { kind: e.type, title: '' }; }

export const TAB_OF = { task: 'today', note: 'notes', habit: 'habits', expense: 'money', income: 'money', diary: 'diary', measure: 'health', checkin: 'diary', ucard: 'learn', skill: 'skills', workout: 'workouts', goal: 'plans', sub: 'plans', experiment: 'insights', focus: 'today', person: 'people', okr: 'okr', thought: 'health', intention: 'today', dayreview: 'reflect', weekreflect: 'reflect', decision: 'reflect', joy: 'reflect', parked: 'reflect', wish: 'plans', debt: 'plans', lessonnote: 'learn' };

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
