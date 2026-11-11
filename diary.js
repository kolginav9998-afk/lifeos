// Дневник и ежедневные отметки самочувствия: утро (сон, состояние) и вечер (день, привычки тела).
// Всё это — данные для поиска закономерностей (аналитика строится на них вместе с тестами и привычками).
import { isYmd, todayStr, addDays } from './events.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);

// Описание полей отметок: оценки 1–5 и числа с пределами.
export const RATINGS = {
  mood: 'Настроение', energy: 'Энергия', stress: 'Стресс', focus: 'Фокус', productivity: 'Продуктивность', social: 'Общение', sleepQuality: 'Качество сна',
};
export const NUMBERS = {
  sleepHours: { label: 'Сон, часов', min: 0, max: 24, step: 0.25, unit: 'ч', start: 7 },
  caffeine: { label: 'Кофе / чай', min: 0, max: 20, step: 1, unit: 'чаш.', start: 1 },
  alcohol: { label: 'Алкоголь', min: 0, max: 30, step: 1, unit: 'порц.', start: 1 },
  water: { label: 'Вода', min: 0, max: 40, step: 1, unit: 'стак.', start: 1 },
  exercise: { label: 'Тренировка', min: 0, max: 600, step: 5, unit: 'мин', start: 30 },
  screen: { label: 'Экран', min: 0, max: 24, step: 0.5, unit: 'ч', start: 3 },
  outdoors: { label: 'На улице', min: 0, max: 600, step: 5, unit: 'мин', start: 30 },
};
export const FLAGS = { veg: 'Овощи или фрукты были', protein: 'Белок был', sweets: 'Сладкое было', noise: 'Мешал шум', worry: 'Тревожные мысли', lateMeal: 'Поздний ужин', hot: 'Было душно или жарко' };      // быстрая отметка питания: только «да» (без счёта калорий)
export const SLOTS = {
  m: { label: 'Утро', ratings: ['sleepQuality', 'energy', 'mood', 'stress'], numbers: ['sleepHours'], flags: ['noise', 'worry', 'lateMeal', 'hot'] },
  e: { label: 'Вечер', ratings: ['mood', 'energy', 'stress', 'focus', 'productivity', 'social'], numbers: ['caffeine', 'alcohol', 'water', 'exercise', 'screen', 'outdoors'], flags: ['veg', 'protein', 'sweets'] },
};

// Что мешало спать: по утренним отметкам за последние дни (только счёт, без выводов о причинах).
export const SLEEP_REASONS = ['noise', 'worry', 'lateMeal', 'hot'];
export function sleepReasons(events, today, days = 30) {
  const from = addDays(today, -(days - 1));
  const mornings = events.filter(e => e.type === 'checkin' && e.payload.slot === 'm' && e.payload.date >= from && e.payload.date <= today);
  const reasons = SLEEP_REASONS.map(key => ({ key, label: FLAGS[key], n: mornings.filter(e => e.payload[key]).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  return { nights: mornings.length, reasons };
}

export const checkinId = (date, slot) => `ci:${date}:${slot}`;
export const diaryId = date => `diary:${date}`;

// Часы сна по времени «лёг» и «встал» (переход через полночь учитывается).
export function sleepFromTimes(bed, wake) {
  const m = s => { const x = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()); if (!x || +x[1] > 23 || +x[2] > 59) return null; return +x[1] * 60 + +x[2]; };
  const b = m(bed), w = m(wake);
  if (b === null || w === null) return null;
  let d = w - b;
  if (d <= 0) d += 24 * 60;
  return Math.round((d / 60) * 100) / 100;
}

// Собрать отметку: пустые поля пропускаются, значения проверяются на допустимые пределы.
export function makeCheckin(slot, date, fields = {}, note = '', now = Date.now(), prev = null) {
  const def = SLOTS[slot];
  if (!def) throw new Error('bad slot');
  if (!isYmd(date)) throw new Error('bad date');
  const payload = { date, slot };
  for (const k of def.ratings) {
    const v = fields[k];
    if (v === undefined || v === null || v === '') continue;
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`${RATINGS[k]}: оценка от 1 до 5`);
    payload[k] = v;
  }
  for (const k of def.flags || []) if (fields[k] === true) payload[k] = true;
  for (const k of def.numbers) {
    const v = fields[k];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    const spec = NUMBERS[k];
    if (!Number.isFinite(n) || n < spec.min || n > spec.max) throw new Error(`${spec.label}: от ${spec.min} до ${spec.max}`);
    payload[k] = Math.round(n * 100) / 100;
  }
  if (slot === 'm') {
    for (const k of ['bed', 'wake']) {
      const v = fields[k];
      if (v === undefined || v === null || v === '') continue;
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v).trim())) throw new Error('Время: ЧЧ:ММ');
      payload[k] = String(v).trim().padStart(5, '0');
    }
    if (payload.sleepHours === undefined && payload.bed && payload.wake) payload.sleepHours = sleepFromTimes(payload.bed, payload.wake);
  }
  const nt = clean(note, 1000);
  if (nt) payload.note = nt;
  if (Object.keys(payload).length <= 2 && !nt) throw new Error('Заполни хотя бы одно поле');
  return { id: checkinId(date, slot), type: 'checkin', ts: prev?.ts ?? now, payload: { ...payload, ...(prev ? { editedAt: now } : {}) }, source: 'manual', confidence: 1, evidence: [] };
}

export const hashtags = text => [...new Set((String(text ?? '').match(/(?<![\p{L}\d])#([\p{L}\d_]{2,30})/gu) || []).map(t => t.slice(1).toLowerCase()))].slice(0, 20);

export function makeDiary(date, { text = '', highlight = '', gratitude = [] } = {}, now = Date.now(), prev = null) {
  if (!isYmd(date)) throw new Error('bad date');
  const t = String(text ?? '').trim();
  if (t.length > 20000) throw new Error('Запись слишком длинная');
  const g = (Array.isArray(gratitude) ? gratitude : []).map(x => clean(x, 200)).filter(Boolean).slice(0, 3);
  const h = clean(highlight, 300);
  if (!t && !h && !g.length) throw new Error('Дневник пуст');
  return { id: diaryId(date), type: 'diary', ts: prev?.ts ?? now, payload: { date, text: t, highlight: h, gratitude: g, tags: hashtags(t), ...(prev ? { editedAt: now } : {}) }, source: 'manual', confidence: 1, evidence: [] };
}

export const checkinOf = (events, date, slot) => events.find(e => e.type === 'checkin' && e.id === checkinId(date, slot)) ?? null;
export const diaryOf = (events, date) => events.find(e => e.type === 'diary' && e.id === diaryId(date)) ?? null;

// Среднее настроение дня: по всем доступным отметкам и оценкам.
export function dayMood(events, date) {
  const vals = ['m', 'e'].map(s => checkinOf(events, date, s)?.payload.mood).filter(Number.isFinite);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
export function dayDigest(events, date) {
  const m = checkinOf(events, date, 'm')?.payload, e = checkinOf(events, date, 'e')?.payload, d = diaryOf(events, date)?.payload;
  return { date, mood: dayMood(events, date), sleep: m?.sleepHours ?? null, energy: e?.energy ?? m?.energy ?? null, stress: e?.stress ?? m?.stress ?? null, text: d?.text || d?.highlight || '', hasAny: !!(m || e || d) };
}

// Последние n дней (новые сверху) — для списка истории.
export function recentDays(events, today, n = 14) {
  const out = [];
  const [y, mo, d] = today.split('-').map(Number);
  for (let i = 0; i < n; i++) {
    const t = new Date(y, mo - 1, d - i, 12);
    out.push(dayDigest(events, todayStr(t.getTime())));
  }
  return out;
}

// Для CSV/аналитики: одна строка на день со всеми показателями.
export function dailyTable(events) {
  const dates = new Set();
  for (const e of events) if (e.type === 'checkin' || e.type === 'diary') dates.add(e.payload.date);
  return [...dates].sort().map(date => {
    const m = checkinOf(events, date, 'm')?.payload ?? {}, ev = checkinOf(events, date, 'e')?.payload ?? {};
    return { date, sleepHours: m.sleepHours, sleepQuality: m.sleepQuality, moodMorning: m.mood, energyMorning: m.energy, stressMorning: m.stress,
      moodEvening: ev.mood, energyEvening: ev.energy, stressEvening: ev.stress, focus: ev.focus, productivity: ev.productivity, social: ev.social,
      caffeine: ev.caffeine, alcohol: ev.alcohol, water: ev.water, exercise: ev.exercise, screen: ev.screen, outdoors: ev.outdoors,
      foodScore: Object.keys(ev).length ? (ev.veg ? 1 : 0) + (ev.protein ? 1 : 0) - (ev.sweets ? 1 : 0) : undefined };
  });
}

// Вопросы для дневника: по одному на день, по кругу.
export const QUESTIONS = [
  'Что сегодня получилось лучше, чем ожидал?', 'Что отняло больше всего энергии и можно ли это изменить?', 'За что ты благодарен сегодняшнему дню?', 'Чему ты научился за последние дни?',
  'Какое решение сегодня было самым важным и почему?', 'Что бы ты сделал иначе, если бы день повторился?', 'Что тебя сегодня порадовало, пусть даже мелочь?', 'Кому ты мог бы сказать «спасибо» или «прости»?',
  'Какую одну вещь ты откладываешь и какой самый маленький первый шаг?', 'Что сегодня дало тебе энергию?', 'Что ты хочешь запомнить об этом периоде жизни?', 'Какая привычка помогает тебе больше всего?',
  'Что ты сегодня сделал для здоровья?', 'Чего ты избегаешь и что за этим стоит?', 'Какой был лучший момент дня?', 'Что в твоей работе можно упростить?',
  'Какой навык ты хочешь развить в ближайший месяц?', 'Что ты сегодня узнал нового?', 'Как ты сегодня позаботился о других?', 'Что тебя беспокоит и что от тебя зависит в этой ситуации?',
  'Если бы завтра было идеальным, с чего бы оно началось?', 'Какую границу тебе нужно обозначить?', 'Что ты сделал сегодня, чем гордишься?', 'Чего тебе не хватало сегодня?',
  'С кем тебе стоит пообщаться на этой неделе?', 'Что в твоём окружении поддерживает тебя, а что мешает?', 'Какие три дела сделают завтрашний день успешным?', 'Что ты принял сегодня как есть, не споря?',
  'Что ты хочешь делать больше, а что меньше?', 'Как изменилось твоё настроение за день и почему?', 'Какой совет ты дал бы себе год назад?', 'Какая мысль сегодня возвращалась чаще всего?',
  'Что ты сделал сегодня ради будущего?', 'Что помогло тебе справиться со стрессом?', 'Какое слово лучше всего описывает этот день?', 'Что ты хочешь отпустить?',
  'Какая маленькая победа осталась незамеченной?', 'Как прошёл твой сон и что на него повлияло?', 'Что ты сегодня почувствовал телом?', 'Что ты скажешь себе завтрашнему?',
];
export function questionOfDay(date) {
  if (!isYmd(date)) throw new Error('bad date');
  const [y, m, d] = date.split('-').map(Number);
  const n = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return QUESTIONS[((n % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length];
}

// Записи из прошлого: 30 и 90 дней, полгода и 1–5 лет назад (только те, где есть текст или «главное»).
export function onThisDay(events, date, max = 3) {
  if (!isYmd(date)) throw new Error('bad date');
  const shift = n => { const [y, m, d] = date.split('-').map(Number); const t = new Date(y, m - 1, d + n, 12); return todayStr(t.getTime()); };
  const yearsAgo = k => { const [y, m, d] = date.split('-'); const s = `${Number(y) - k}-${m}-${d}`; return isYmd(s) ? s : null; };
  const spots = [[shift(-30), '30 дней назад'], [shift(-90), '3 месяца назад'], [shift(-180), 'Полгода назад']];
  for (let k = 1; k <= 5; k++) { const s = yearsAgo(k); if (s) spots.push([s, k === 1 ? 'Год назад' : k < 5 ? `${k} года назад` : '5 лет назад']); }
  const out = [];
  for (const [d, label] of spots) {
    const p = diaryOf(events, d)?.payload;
    const text = (p?.highlight || p?.text || '').split('\n').find(l => l.trim()) || '';
    if (text) out.push({ date: d, label, text: text.length > 160 ? text.slice(0, 157) + '…' : text });
  }
  return out.slice(0, max);
}
