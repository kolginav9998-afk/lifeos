// Реестр типов записей: что хранится, где лежит логика и насколько это личное.
// Все данные приложения — журнал событий {id, type, ts, payload, source, confidence, evidence}. Новые типы только добавляются:
// старые записи читаются всегда, а незнакомые типы (например, от более новой версии) сохраняются и не ломают приложение.
//
// privacy: text — свободный личный текст; health — здоровье; money — деньги; people — люди; numbers — числа и отметки; learning — учёба; system — служебное.
// analytics: true — данные этой записи (числа, отметки, названия привычек и упражнений) попадают в выгрузку для аналитики.
// Тексты дневника, заметок, мыслей, решений и подобное в выгрузку не входят, деньги тоже.
export const REGISTRY = {
  task: { label: 'Задача', group: 'Дела', module: 'events.js', privacy: 'text', analytics: true, fields: 'text, due, repeat, priority, done, doneAt' },
  habit: { label: 'Привычка', group: 'Привычки', module: 'habits.js', privacy: 'text', analytics: true, fields: 'name, anchor, minimum, full, identity, plan, startDate, archived' },
  habit_log: { label: 'Отметка привычки', group: 'Привычки', module: 'habits.js', privacy: 'numbers', analytics: true, fields: 'habitId, date, level (full|min)' },
  expense: { label: 'Расход', group: 'Деньги', module: 'money.js', privacy: 'money', analytics: false, fields: 'amountMinor, currency, category, note, date' },
  income: { label: 'Доход', group: 'Деньги', module: 'money.js', privacy: 'money', analytics: false, fields: 'amountMinor, currency, category, note, date' },
  budget: { label: 'Бюджет месяца', group: 'Деньги', module: 'money.js', privacy: 'money', analytics: false, fields: 'amountMinor' },
  limit: { label: 'Лимит по категории', group: 'Деньги', module: 'planning.js', privacy: 'money', analytics: false, fields: 'category, amountMinor' },
  goal: { label: 'Копилка', group: 'Деньги', module: 'planning.js', privacy: 'money', analytics: false, fields: 'title, targetMinor, dueDate' },
  goalmove: { label: 'Взнос в копилку', group: 'Деньги', module: 'planning.js', privacy: 'money', analytics: false, fields: 'goalId, amountMinor, date, note' },
  sub: { label: 'Подписка', group: 'Деньги', module: 'planning.js', privacy: 'money', analytics: false, fields: 'name, amountMinor, period, day, month, active' },
  wish: { label: 'Хочу купить (отсрочка на сутки)', group: 'Деньги', module: 'wishes.js', privacy: 'money', analytics: false, fields: 'text, amountMinor, date, until, status, resolvedDate' },
  debt: { label: 'Долг или заём', group: 'Деньги', module: 'debts.js', privacy: 'money', analytics: false, fields: 'who, amountMinor, direction, due, note, date, paidMinor, settled, settledDate' },
  note: { label: 'Заметка', group: 'Заметки и дневник', module: 'notes.js', privacy: 'text', analytics: false, fields: 'text' },
  diary: { label: 'Запись дневника', group: 'Заметки и дневник', module: 'diary.js', privacy: 'text', analytics: false, fields: 'date, text, highlight, gratitude, tags' },
  checkin: { label: 'Отметка дня (утро/вечер)', group: 'Здоровье', module: 'diary.js', privacy: 'health', analytics: true, fields: 'date, slot (m|e), оценки 1–5, сон, кофе, нагрузка, питание (veg, protein, sweets), note' },
  measure: { label: 'Замер здоровья', group: 'Здоровье', module: 'health.js', privacy: 'health', analytics: true, fields: 'kind, value, value2, date, time, unit, note' },
  profile: { label: 'Профиль', group: 'Профиль', module: 'events.js', privacy: 'health', analytics: false, fields: 'name, рост, год рождения, пол, цель сна, целевой вес' },
  med: { label: 'Лекарство или добавка', group: 'Здоровье', module: 'meds.js', privacy: 'health', analytics: false, fields: 'name, dose, when, note, active' },
  medlog: { label: 'Отметка «принял»', group: 'Здоровье', module: 'meds.js', privacy: 'health', analytics: false, fields: 'medId, date, takenAt' },
  workout: { label: 'Тренировка', group: 'Здоровье', module: 'workouts.js', privacy: 'health', analytics: true, fields: 'date, name, exercises[sets], done, minutes, rpe, note' },
  breath: { label: 'Дыхание', group: 'Здоровье', module: 'breathing.js', privacy: 'health', analytics: false, fields: 'date, seconds, before, after' },
  thought: { label: 'Запись дневника мыслей', group: 'Здоровье', module: 'thoughts.js', privacy: 'text', analytics: false, fields: 'date, situation, thought, emotion, before, alt, after' },
  sick: { label: 'Период болезни', group: 'Здоровье', module: 'sick.js', privacy: 'health', analytics: true, fields: 'from, to' },
  checkup: { label: 'Плановая проверка', group: 'Здоровье', module: 'prevent.js', privacy: 'health', analytics: false, fields: 'name, months, last, createdDate' },
  emergency: { label: 'Данные на экстренный случай', group: 'Здоровье', module: 'emergency.js', privacy: 'health', analytics: false, fields: 'группа крови, аллергии, состояния, лекарства, контакт, телефон, заметка' },
  focus: { label: 'Сессия фокуса', group: 'Дела', module: 'focus.js', privacy: 'numbers', analytics: true, fields: 'date, minutes, planned, completed, label' },
  lesson: { label: 'Пройденный урок', group: 'Учёба', module: 'academy.js', privacy: 'learning', analytics: true, fields: 'lesson, track, date, minutes, revisited' },
  lessonnote: { label: 'Конспект урока', group: 'Учёба', module: 'academy.js', privacy: 'text', analytics: false, fields: 'lesson, text, date' },
  srs: { label: 'Состояние карточки', group: 'Учёба', module: 'srs.js', privacy: 'learning', analytics: true, fields: 'card, box, due, first, last, reps, lapses, hist' },
  speak: { label: 'Говорение вслух', group: 'Учёба', module: 'speaking.js', privacy: 'learning', analytics: false, fields: 'date, lang, seconds, minutes, topic' },
  learngoal: { label: 'Недельная цель по курсу (минуты)', group: 'Учёба', module: 'practice.js', privacy: 'learning', analytics: false, fields: 'track, minutes' },
  ucard: { label: 'Своя карточка', group: 'Учёба', module: 'academy.js', privacy: 'text', analytics: false, fields: 'q, a, hint' },
  testrun: { label: 'Прохождение проверки', group: 'Проверки', module: 'bt-core.js', privacy: 'numbers', analytics: true, fields: 'date, mode, tests{metrics, trials}, state, startedAt, durationMs' },
  experiment: { label: 'Личный эксперимент', group: 'Проверки', module: 'experiments.js', privacy: 'text', analytics: false, fields: 'title, change, metric, days, blockDays, startDate, order, cancelled' },
  person: { label: 'Человек', group: 'Люди и цели', module: 'people.js', privacy: 'people', analytics: false, fields: 'name, birthday, birthYear, cadenceDays, lastContact, note' },
  okr: { label: 'Цель квартала', group: 'Люди и цели', module: 'okr.js', privacy: 'text', analytics: false, fields: 'title, why, due, krs[text, target, current, unit], status' },
  intention: { label: 'Намерение дня', group: 'Рефлексия', module: 'reflect.js', privacy: 'text', analytics: false, fields: 'date, text' },
  dayreview: { label: 'Вечерний обзор', group: 'Рефлексия', module: 'reflect.js', privacy: 'text', analytics: false, fields: 'date, win, miss, learn' },
  weekreflect: { label: 'Итоги недели', group: 'Рефлексия', module: 'reflect.js', privacy: 'text', analytics: false, fields: 'week, went, blocked, change' },
  decision: { label: 'Решение', group: 'Рефлексия', module: 'reflect.js', privacy: 'text', analytics: false, fields: 'date, title, why, expect, revisit, closed{date, verdict, outcome}' },
  parked: { label: 'Отложенная мысль', group: 'Рефлексия', module: 'parked.js', privacy: 'text', analytics: false, fields: 'date, forDate, text, done, doneDate' },
  ritual: { label: 'Вечерний ритуал', group: 'Рефлексия', module: 'reflect.js', privacy: 'numbers', analytics: false, fields: 'date, steps' },
  joy: { label: 'Радость', group: 'Рефлексия', module: 'reflect.js', privacy: 'text', analytics: false, fields: 'date, text' },
  charger: { label: 'Что заряжает', group: 'Рефлексия', module: 'reflect.js', privacy: 'text', analytics: false, fields: 'text' },
};

export const PRIVACY_LABEL = { text: 'личный текст', health: 'здоровье', money: 'деньги', people: 'люди', numbers: 'числа и отметки', learning: 'учёба', system: 'служебное' };

export const knownType = type => Object.hasOwn(REGISTRY, type);

// Записи незнакомых типов: от более новой версии или повреждённые. Приложение их сохраняет, но не показывает.
export function unknownTypes(events) {
  const m = new Map();
  for (const e of events) if (!knownType(e.type)) m.set(e.type, (m.get(e.type) || 0) + 1);
  return [...m].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

// Описание всех типов в Markdown (docs/EVENTS.md): файл сверяется с реестром тестом, чтобы не устаревать.
export function registryMarkdown() {
  const groups = new Map();
  for (const [type, r] of Object.entries(REGISTRY)) { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push([type, r]); }
  const L = ['# Типы записей', '', '_Файл создан из `registry.js` и сверяется с ним тестом: правь реестр, а не этот файл._', '',
    'Все данные Life OS — журнал событий `{id, type, ts, payload, source, confidence, evidence}`. Новые типы только добавляются; записи прошлых версий читаются всегда, а незнакомые типы сохраняются и не мешают.', '',
    `Всего типов: ${Object.keys(REGISTRY).length}. «В выгрузке» — попадают ли данные этой записи в ZIP для аналитики (числа и отметки, названия привычек и упражнений). Тексты дневника, заметок, мыслей и решений, а также деньги в выгрузку не входят.`, ''];
  for (const [group, items] of groups) {
    L.push(`## ${group}`, '', '| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |', '|---|---|---|---|---|---|');
    for (const [type, r] of items) L.push(`| \`${type}\` | ${r.label} | ${r.fields} | ${PRIVACY_LABEL[r.privacy]} | ${r.analytics ? 'да' : 'нет'} | \`${r.module}\` |`);
    L.push('');
  }
  return L.join('\n');
}

// Связи между типами записей: [родитель, потомок, поле-ссылка, что означает]. Из них строится ER-диаграмма (docs/ER.md).
export const RELATIONS = [
  ['habit', 'habit_log', 'habitId', 'отметки привычки по дням'],
  ['med', 'medlog', 'medId', 'приёмы лекарства'],
  ['goal', 'goalmove', 'goalId', 'взносы в копилку'],
  ['lesson', 'lessonnote', 'lesson', 'конспект к пройденному уроку'],
];
// Типы, привязанные к календарному дню полем date (в диаграмме идут от узла «день»).
export const BY_DAY = ['checkin', 'diary', 'measure', 'workout', 'focus', 'thought', 'intention', 'dayreview', 'joy', 'ritual', 'parked', 'speak', 'breath', 'testrun', 'expense', 'income', 'medlog', 'habit_log', 'lesson'];

export function erMarkdown() {
  const L = ['# Связи между данными (ER-диаграмма)', '', '_Файл создан из `registry.js` (`RELATIONS` и `BY_DAY`) и сверяется с ним тестом: правь реестр, а не этот файл._', '',
    'Записи не хранят вложенных копий друг друга: связь идёт по идентификатору или по дате. Диаграмма в формате Mermaid (отображается на GitHub).', '', '```mermaid', 'erDiagram'];
  for (const [parent, child, field] of RELATIONS) L.push(`  ${parent} ||--o{ ${child} : "${field}"`);
  for (const t of BY_DAY) L.push(`  day ||--o{ ${t} : "date"`);
  L.push('```', '', '## Связи по идентификатору', '', '| Родитель | Потомок | Поле | Смысл |', '|---|---|---|---|');
  for (const [parent, child, field, what] of RELATIONS) L.push(`| \`${parent}\` | \`${child}\` | \`${field}\` | ${what} |`);
  L.push('', '## Записи по дням', '', 'Эти типы привязаны к дню полем `date`: ' + BY_DAY.map(t => `\`${t}\``).join(', ') + '. Узел «day» условный: отдельной записи «день» нет, день — это просто дата.', '',
    '## Внутри записи (не отдельные типы)', '', '- `okr` содержит список результатов `krs[]` (текст, цель, текущее значение, единица).', '- `workout` содержит упражнения и подходы `exercises[].sets[]`.', '- `testrun` содержит результаты тестов и отдельные пробы `tests{}.trials[]`.', '- `decision` содержит итог `closed{}` после оценки решения.', '');
  return L.join('\n');
}
