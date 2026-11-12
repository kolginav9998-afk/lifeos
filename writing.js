// Письмо: счёт слов, серия записей дневника, «свободное письмо» (текст без остановки) и книга года.
import { APP_NAME } from './config.js';
import { addDays } from './events.js';
import { makeDiary, diaryOf, hashtags } from './diary.js';

export const wordCount = text => (String(text ?? '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

// Запись считается, если в ней есть текст, главное или благодарности.
const hasContent = p => !!(String(p.text ?? '').trim() || String(p.highlight ?? '').trim() || (p.gratitude || []).length);
export const diaryEntries = events => events.filter(e => e.type === 'diary' && hasContent(e.payload)).sort((a, b) => a.payload.date.localeCompare(b.payload.date));

// Серия записей подряд: сегодня можно ещё не писать, серия не сгорает до конца дня.
export function diaryStreak(events, today) {
  const dates = new Set(diaryEntries(events).map(e => e.payload.date));
  let d = dates.has(today) ? today : addDays(today, -1), n = 0;
  while (dates.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
export function diaryStats(events, today, days = 30) {
  const from = addDays(today, -(days - 1));
  const list = diaryEntries(events), recent = list.filter(e => e.payload.date >= from && e.payload.date <= today);
  const t = events.find(e => e.type === 'diary' && e.id === `diary:${today}`)?.payload;
  return { wordsToday: t ? wordCount(t.text) : 0, streak: diaryStreak(events, today), entries: recent.length, words: recent.reduce((s, e) => s + wordCount(e.payload.text), 0), total: list.length };
}

// Дописать «свободное письмо» в запись дня. Старый текст не теряется, новый идёт отдельным абзацем с пометкой.
export const FREE_HEADER = 'Свободное письмо';
export function appendFreeWrite(events, date, text, now = Date.now()) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('Пусто: нечего сохранять');
  const prev = diaryOf(events, date);
  const base = prev?.payload.text?.trim() ?? '';
  const merged = `${base ? base + '\n\n' : ''}${FREE_HEADER} (${wordCount(t)} слов):\n${t}`;
  return makeDiary(date, { text: merged, highlight: prev?.payload.highlight ?? '', gratitude: prev?.payload.gratitude ?? [] }, now, prev);
}

// ---------- книга года: читаемый Markdown из записей дневника ----------
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const diaryYears = events => [...new Set(diaryEntries(events).map(e => e.payload.date.slice(0, 4)))].sort().reverse();
export function yearBook(events, year, now = Date.now()) {
  const y = String(year);
  const list = diaryEntries(events).filter(e => e.payload.date.startsWith(y + '-'));
  const words = list.reduce((s, e) => s + wordCount(e.payload.text), 0);
  const L = [`# Книга года ${y}`, '', `_Собрано из дневника «${APP_NAME}». Записей: ${list.length}, слов: ${words}._`, ''];
  if (!list.length) { L.push('_В этом году записей нет._', ''); return L.join('\n'); }
  const tagCount = new Map();
  for (const e of list) for (const t of e.payload.tags ?? hashtags(e.payload.text)) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const top = [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  if (top.length) L.push(`Частые темы: ${top.map(([t, n]) => `#${t} (${n})`).join(', ')}`, '');
  let month = '';
  for (const e of list) {
    const [yy, mm, dd] = e.payload.date.split('-').map(Number);
    if (e.payload.date.slice(0, 7) !== month) { month = e.payload.date.slice(0, 7); L.push(`## ${MONTHS[mm - 1][0].toUpperCase()}${MONTHS[mm - 1].slice(1)} ${yy}`, ''); }
    L.push(`### ${dd} ${MONTHS_GEN[mm - 1]}, ${WD[new Date(yy, mm - 1, dd).getDay()]}`, '');
    if (e.payload.highlight) L.push(`**Главное:** ${e.payload.highlight.replace(/\r?\n/g, ' ')}`, '');
    if (e.payload.text) L.push(e.payload.text.trim(), '');
    if (e.payload.gratitude?.length) L.push('Благодарность: ' + e.payload.gratitude.map(g => g.replace(/\r?\n/g, ' ')).join('; '), '');
  }
  return L.join('\n');
}
