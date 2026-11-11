import { newId } from './events.js';
import { hashtags } from './diary.js';
export const MAX_NOTE = 20000;

export function makeNote(text, now = Date.now()) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('empty note');
  if (t.length > MAX_NOTE) throw new Error('Заметка слишком длинная');
  return { id: newId(), type: 'note', ts: now, payload: { text: t }, source: 'manual', confidence: 1, evidence: [] };
}
export function updateNote(ev, text, now = Date.now()) {
  const n = makeNote(text, now);
  return { ...ev, payload: { ...ev.payload, text: n.payload.text, editedAt: now } };
}
export function noteTitle(text, max = 60) {
  const first = String(text).split('\n').find(l => l.trim()) || '';
  return first.length > max ? first.slice(0, max - 1) + '…' : first;
}
export const sortedNotes = events => events.filter(e => e.type === 'note').sort((a, b) => (b.payload.editedAt || b.ts) - (a.payload.editedAt || a.ts));

// ---------- теги, ссылки и шаблоны ----------
export const noteTags = text => hashtags(text);
export function tagCloud(events, limit = 12) {
  const map = new Map();
  for (const e of events) if (e.type === 'note') for (const t of noteTags(e.payload.text)) map.set(t, (map.get(t) || 0) + 1);
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}
const normTitle = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/^[\s#>*_-]+/, '').replace(/\s+/g, ' ').trim();
export const noteLinks = text => [...new Set([...String(text ?? '').matchAll(/\[\[([^\[\]\n]{1,80})\]\]/g)].map(m => m[1].trim()).filter(Boolean))].slice(0, 20);
export function findNoteByTitle(events, title, excludeId = null) {
  const t = normTitle(title);
  if (!t) return null;
  const notes = sortedNotes(events).filter(n => n.id !== excludeId);
  return notes.find(n => normTitle(noteTitle(n.payload.text, 200)) === t) ?? notes.find(n => normTitle(noteTitle(n.payload.text, 200)).startsWith(t)) ?? null;
}
// Ссылки заметки: к каждой найденная заметка или null.
export const resolveLinks = (events, note) => noteLinks(note.payload.text).map(title => ({ title, target: findNoteByTitle(events, title, note.id) }));
// Заметки, которые ссылаются на эту.
export function backlinks(events, note) {
  const mine = normTitle(noteTitle(note.payload.text, 200));
  if (!mine) return [];
  return sortedNotes(events).filter(n => n.id !== note.id && noteLinks(n.payload.text).some(l => { const t = normTitle(l); return t === mine || mine.startsWith(t); }));
}

const dayText = d => d;
export const NOTE_TEMPLATES = [
  { id: 'meeting', title: 'Встреча', text: d => `Встреча: \nДата: ${dayText(d)}\nУчастники: \n\nОбсудили:\n- \n\nРешения:\n- \n\nЗадачи (кто, что, к какому сроку):\n- \n\n#встреча` },
  { id: 'idea', title: 'Идея', text: () => 'Идея: \n\nЧто это и зачем:\n\nКому полезно:\n\nПервый маленький шаг:\n\nРиски и вопросы:\n\n#идея' },
  { id: 'book', title: 'Книга', text: d => `Книга: \nАвтор: \nДата: ${dayText(d)}\n\nГлавная идея:\n\nЦитаты:\n- \n\nЧто применю на практике:\n- \n\n#книга` },
  { id: 'lesson', title: 'Конспект урока', text: d => `Конспект: \nКурс: \nДата: ${dayText(d)}\n\nКлючевые мысли:\n- \n\nВопросы:\n- \n\nЗадание и результат:\n\n#учёба` },
  { id: 'decision', title: 'Решение', text: d => `Решение: \nДата: ${dayText(d)}\n\nВарианты:\n1. \n2. \n\nЗа и против:\n\nЧто выбираю и почему:\n\nКак проверю через месяц:\n\n#решение` },
  { id: 'weekly', title: 'План недели', text: d => `План недели: ${dayText(d)}\n\nГлавные 3 результата:\n1. \n2. \n3. \n\nВстречи и сроки:\n- \n\nЧто не делаю на этой неделе:\n- \n\nЗдоровье и отдых:\n- \n\n#план` },
  { id: 'hardtalk', title: 'Трудный разговор', text: () => 'Подготовка к трудному разговору: \nС кем: \nЦель разговора: \n\nФакты (без оценок):\n- \n\nКак это на меня влияет:\n\nО чём прошу:\n\nЧто готов предложить:\n\n#разговор' },
  { id: 'incident', title: 'Инцидент (работа)', text: d => `Инцидент: \nДата и время: ${dayText(d)}\nГде произошло: \n\nЧто случилось (факты):\n\nПричина:\n\nЧто сделано сразу:\n\nКак предотвратить:\n\n#работа #инцидент` },
  { id: 'receiving', title: 'Приёмка (склад)', text: d => `Приёмка: \nДата: ${dayText(d)}\nПоставщик, накладная: \n\nПринято (позиции и количество):\n- \n\nРасхождения:\n- \n\nГде хранятся фото и документы:\n\nКто принял:\n\n#работа #приёмка` },
  { id: 'shift', title: 'Передача смены (склад)', text: d => `Смена: ${dayText(d)}\n\nСделано:\n- \n\nНе закончено (что и почему):\n- \n\nПроблемы и расхождения:\n- \n\nПередаю следующей смене:\n- \n\n#работа #смена` },
  { id: 'groceries', title: 'Покупки на неделю', text: d => `Покупки на неделю: ${dayText(d)}\n\nОвощи и фрукты:\n- \n\nБелок (мясо, рыба, яйца, творог):\n- \n\nКрупы и хлеб:\n- \n\nМолочное:\n- \n\nДом и хозяйство:\n- \n\n#покупки` },
  { id: 'checklist', title: 'Чек-лист', text: () => 'Чек-лист: \n\n- [ ] \n- [ ] \n- [ ] \n' },
];
export const templateText = (id, date) => NOTE_TEMPLATES.find(t => t.id === id)?.text(date) ?? '';
