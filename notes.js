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
  { id: 'couch', title: 'План «от дивана» (8 недель)', text: d => `План «от дивана»: старт ${dayText(d)}\n\nТри занятия в неделю через день. Каждое: 5 минут быстрой ходьбы, потом блок «бег + ходьба», потом 5 минут спокойной ходьбы.\nТемп бега такой, чтобы можно было говорить короткими фразами. Если неделя не получилась, повтори её.\n\nНеделя 1: 8 раз по (1 мин бега + 2 мин ходьбы)\nНеделя 2: 7 раз по (2 мин бега + 2 мин ходьбы)\nНеделя 3: 6 раз по (3 мин бега + 2 мин ходьбы)\nНеделя 4: 5 раз по (4 мин бега + 2 мин ходьбы)\nНеделя 5: 4 раза по (5 мин бега + 2 мин ходьбы)\nНеделя 6: 3 раза по (7 мин бега + 2 мин ходьбы)\nНеделя 7: 2 раза по (10 мин бега + 2 мин ходьбы)\nНеделя 8: 20 минут бега без остановки\n\nОтмечай занятия в «Тренировках» и в заметке ниже.\nПри боли в груди, головокружении, сильной одышке или боли в суставах остановись и обратись к врачу. Если давно не занимался или есть хронические болезни, сначала согласуй нагрузку с врачом.\n\nОтметки:\n- [ ] \n\n#здоровье #бег` },
  { id: 'english12', title: 'Английский: план на 12 недель', text: d => `Английский на 12 недель: старт ${dayText(d)}\n\nКаждый день 30 минут: 10 минут карточек, 10 минут урока или диалога, 10 минут «Говорения вслух». Лучше каждый день понемногу, чем раз в неделю помногу.\n\nНедели 1–2: уроки 1–4 (как учить, фразы блоками, шэдоуинг, понятный вход). Слова: первая сотня из колоды.\nНедели 3–4: уроки 5–6 (to be, Present Simple). Цель: рассказать о своём дне 5–7 предложениями.\nКонтрольная точка (конец недели 4): «Экзамен» на 20 карточек, результат записать ниже. Цель от 70%.\n\nНедели 5–6: уроки 7–8 (Past Simple, будущее). Цель: рассказать, что было вчера и что будет завтра.\nНедели 7–8: уроки 9–10 (вопросы, can/must/should). Цель: задать 10 разных вопросов.\nКонтрольная точка (конец недели 8): «Экзамен», цель от 75%. Говорение вслух: 60 минут в неделю.\n\nНедели 9–10: уроки 11–12 и диалоги в кафе и такси.\nНедели 11–12: диалоги в магазине и у врача, свободный рассказ 10 минут.\nКонтрольная точка (конец недели 12): «Экзамен» и 10 минут рассказа вслух. Цель от 80%.\n\nРезультаты:\n- неделя 4: \n- неделя 8: \n- неделя 12: \n\n#английский #план` },
  { id: 'weeklyletter', title: 'Письмо себе на неделю', text: d => `Письмо себе: неделя с ${dayText(d)}\n\nЧто было главным на этой неделе:\n\nЧем я горжусь:\n\nЧто было трудным и чему это научило:\n\nЧто хочу сделать иначе на следующей неделе:\n\nОдно доброе слово себе:\n` },
  { id: 'plate', title: 'Правило тарелки', text: d => `Тарелка на обед: ${dayText(d)}\n\nПримерно половина тарелки: овощи и зелень (разные цвета).\nЧетверть: белок (рыба, птица, яйца, бобовые, творог).\nЧетверть: крупы или цельнозерновой хлеб, картофель.\nВода или чай без сахара вместо сладких напитков. Масло и соусы немного.\n\nЧек-лист обеда:\n- [ ] Овощи занимают половину\n- [ ] Есть белок\n- [ ] Есть сложные углеводы\n- [ ] Напиток без сахара\n- [ ] Ел не спеша, без экрана\n\nЭто общий ориентир, а не диета. При болезнях и особом питании ориентируйся на рекомендации врача.\n\n#питание` },
  { id: 'process', title: 'Чек-лист процесса (открытие смены, инвентаризация)', text: d => `Процесс: \nДата: ${dayText(d)}\nОтветственный: \n\nПеред началом:\n- [ ] \n- [ ] \n\nШаги:\n1. \n2. \n3. \n\nПроверка результата:\n- [ ] Количество совпало с документами\n- [ ] Расхождения записаны\n- [ ] Передано следующей смене\n\nЧто пошло не так и как исправить:\n\n#работа #процесс` },
  { id: 'risks', title: 'Оценка рисков процесса', text: d => `Процесс: \nДата: ${dayText(d)}\n\nЧто может пойти не так (риск → вероятность 1–5 × последствия 1–5 = балл):\n1. \n2. \n3. \n\nГлавный риск (где балл выше всего):\nЧто сделаем заранее:\nПо какому признаку поймём, что риск наступает:\nКто отвечает и срок:\n\n#работа #риски` },
  { id: 'portfolio', title: 'Портфолио достижений', text: d => `Достижение: \nДата: ${dayText(d)}\n\nСитуация (что было не так):\nЧто сделал именно я:\nРезультат в цифрах (время, деньги, ошибки, люди):\nЧему научился:\nДокументы или ссылки, которые это подтверждают:\n\n#работа #резюме` },
  { id: 'checklist', title: 'Чек-лист', text: () => 'Чек-лист: \n\n- [ ] \n- [ ] \n- [ ] \n' },
];
export const templateText = (id, date) => NOTE_TEMPLATES.find(t => t.id === id)?.text(date) ?? '';

// Случайная заметка из прошлого: не новее 30 дней. Выбор зависит от числа seed (одно число — одна заметка).
export function pastNote(events, now = Date.now(), seed = 0, minDays = 30) {
  const old = events.filter(e => e.type === 'note' && now - e.ts >= minDays * 86400000).sort((a, b) => a.ts - b.ts);
  return old.length ? old[Math.abs(Math.trunc(seed)) % old.length] : null;
}
