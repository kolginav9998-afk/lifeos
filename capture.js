// Умный ввод: из обычной фразы предлагает расход, доход, замер здоровья, заметку или отметку привычки.
// Обычные правила, без ИИ и без сети. Ничего не сохраняется само: приложение показывает предложение, человек подтверждает.
import { formatMoney, makeExpense, makeIncome, DEFAULT_CATEGORIES } from './money.js';
import { makeMeasure, MEASURES, formatMeasure } from './health.js';
import { makeNote } from './notes.js';
import { makeHabitLog } from './habits.js';
import { makeUserCard } from './academy.js';
import { todayStr, addDays } from './events.js';

const norm = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
const SP = '[\\s\\u00a0\\u202f]';
const NUM = `(?:\\d{1,3}(?:${SP}\\d{3})+|\\d+)(?:[.,]\\d{1,2})?`;
const UNIT_AFTER = /^(?:кг|г|гр|л|мл|шт|штук|км|м|см|мин|минут|ч|час|часов|часа|дн|дней|дня|раз|раза|страниц|страницы|страница|глав|упражнен|подход|%|°|числа|число|го|-го|янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек|январ|феврал|март|апрел|июня|июля|август|сентябр|октябр|ноябр|декабр)/;

function toMinor(numText, suffix) {
  const n = Number(numText.replace(new RegExp(SP, 'g'), '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = /^(?:к|тыс)/.test(suffix || '') ? 1000 : 1;
  const minor = Math.round(n * mult * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

// Ищет сумму в тексте. Возвращает { minor, start, end, strong } или null.
export function findAmount(text) {
  const t = norm(text);
  const re = new RegExp(`(?<![\\p{L}\\d:.,/-])(${NUM})(${SP}*)(к(?![\\p{L}])|тыс(?:\\.|яч[а-я]*)?(?![\\p{L}])|руб(?:лей|ля|\\.)?(?![\\p{L}])|р(?:\\.|(?![\\p{L}]))|₽)?`, 'gu');
  const found = [];
  let m;
  while ((m = re.exec(t))) {
    const after = t.slice(m.index + m[0].length).trimStart();
    const suffix = m[3] || '';
    if (!suffix && UNIT_AFTER.test(after)) continue;                  // «2 кг», «10 числа», «15 минут» — это не сумма
    if (!suffix && /^[:/.-]\d/.test(t.slice(m.index + m[1].length))) continue;   // время и даты: 12:30, 10.11
    const minor = toMinor(m[1], suffix);
    if (minor === null) continue;
    const before = t.slice(0, m.index).trimEnd();
    const strong = !!suffix || /(?:потратил[аи]?|заплатил[аи]?|оплатил[аи]?|стоит|стоил[аи]?|за|на|получил[аи]?|пришло|поступило|зарплата|аванс|премия)$/.test(before);
    found.push({ minor, start: m.index, end: m.index + m[0].length, strong, suffix: !!suffix });
  }
  if (!found.length) return null;
  return found.find(f => f.suffix) || found.find(f => f.strong) || found[found.length - 1];
}

// ---------- категории ----------
const CATS = [
  ['Еда', /(кофе|чай|обед|ужин|завтрак|продукт|еда|еду|магазин|пятерочк|магнит|перекресток|лента|ашан|молок|хлеб|кафе|ресторан|пицц|бургер|фрукт|овощ|шаурм|суши|доставк|булочк|сладк|снек)/],
  ['Транспорт', /(такси|метро|автобус|трамвай|проезд|бензин|заправк|парковк|каршеринг|самокат|электричк|маршрутк|убер|яндекс го)/],
  ['Жильё', /(аренд|жиль|квартир|коммунал|жкх|электричеств|ремонт|мебел|свет за|ипотек)/],
  ['Здоровье', /(аптек|лекарств|врач|анализ|стоматолог|зуб|витамин|массаж|поликлиник|спортзал|абонемент|тренировк|бассейн)/],
  ['Связь', /(телефон|мобильн|связь|симк|интернет|тариф)/],
  ['Подписки', /(подписк|netflix|нетфликс|spotify|спотифай|youtube|ютуб|яндекс плюс|icloud|apple|chatgpt|gpt|claude|кинопоиск)/],
  ['Одежда', /(одежд|куртк|кроссовк|обув|футболк|джинс|рубашк|платье|ботинк)/],
  ['Развлечения', /(кино|театр|концерт|игр|бар\b|клуб|подарок|подарк|отпуск|отель|путешеств|билет|выставк)/],
  ['Образование', /(курс|книг|учеб|репетитор|урок|школ|универ|обучен)/],
];
export function guessCategory(text) {
  const t = norm(text);
  for (const [cat, re] of CATS) if (re.test(t)) return cat;
  return 'Другое';
}
const INCOME_RULES = [
  ['Зарплата', /(зарплат|аванс|премия|оклад)/], ['Подработка', /(подработк|фриланс|заказ)/], ['Подарок', /(подарил|подарок|подарк)/], ['Возврат', /(возврат|вернул)/],
];

// ---------- замеры ----------
const MEASURE_WORDS = [
  ['weight', /^(?:вес|взвесил(?:ся|ась)|вешу)(?![\p{L}])/u], ['bp', /^(?:давление|ад)(?![\p{L}])/u], ['pulse', /^пульс(?![\p{L}])/u], ['temp', /^(?:температура|темп)(?![\p{L}])/u],
  ['glucose', /^(?:сахар|глюкоза)(?![\p{L}])/u], ['waist', /^талия(?![\p{L}])/u], ['steps', /^(?:шаги|шагов|прошел)(?![\p{L}])/u],
];
function parseMeasure(t, original) {
  for (const [kind, re] of MEASURE_WORDS) {
    if (!re.test(t)) continue;
    if (kind === 'bp') {
      const m = t.match(/(\d{2,3})\s*(?:\/|\\|на|-)\s*(\d{2,3})/);
      return m ? { kind, value: Number(m[1]), value2: Number(m[2]) } : null;
    }
    const m = t.match(/(\d{1,6}(?:[.,]\d{1,2})?)/);
    if (!m) return null;
    return { kind, value: Number(m[1].replace(',', '.')) };
  }
  return null;
}

// ---------- привычки ----------
const stems = s => norm(s).split(/[^\p{L}\d]+/u).filter(w => w.length >= 4).map(w => w.slice(0, Math.max(4, w.length - 2)));
function parseHabit(t, habits) {
  const done = t.match(/^(?:сделал[аи]?|выполнил[аи]?|готово|✓)\s+(.+)$/u) || t.match(/^(.+?)\s+(?:сделал[аи]?|выполнил[аи]?|готово|✓)$/u);
  if (!done || !habits?.length) return null;
  const phrase = done[1].replace(/по минимуму|минимум/g, '').trim();
  const ph = stems(phrase);
  if (!ph.length) return null;
  let best = null;
  for (const h of habits) {
    const hs = stems(h.name);
    const hit = hs.filter(s => ph.some(p => s.startsWith(p) || p.startsWith(s))).length;
    if (hit && (!best || hit > best.hit)) best = { habit: h, hit };
  }
  if (!best) return null;
  return { habitId: best.habit.id, name: best.habit.name, level: /по минимуму|минимум/.test(t) ? 'min' : 'full' };
}

// Главная функция. ctx: { habits: [{id, name}], now }. Возвращает предложение или null.
export function parseCapture(input, ctx = {}) {
  const original = String(input ?? '').trim();
  if (original.length < 2 || original.length > 300) return null;
  const t = norm(original);
  const now = ctx.now ?? Date.now();

  // заметка
  const n = original.match(/^(?:заметка|идея|мысль|запомни|note)\s*[:\-—]\s*(.+)$/iu) || original.match(/^(?:заметка|идея|мысль|запомни)\s+(.{3,})$/iu);
  if (n) return { kind: 'note', data: { text: n[1].trim() }, confidence: 'high' };

  // слово или факт для повторения: «слово: take off — взлетать»
  const w = original.match(/^(?:слово|word|карточка|card)\s*[:\-—]\s*(.+?)\s+(?:[—–=]|-)\s+(.+)$/iu);
  if (w) return { kind: 'card', data: { q: w[1].trim(), a: w[2].trim() }, confidence: 'high' };

  // замеры здоровья
  const ms = parseMeasure(t, original);
  if (ms) return { kind: 'measure', data: ms, confidence: 'high' };

  // привычка
  const hb = parseHabit(t, ctx.habits);
  if (hb) return { kind: 'habit', data: hb, confidence: 'high' };

  // деньги
  const a = findAmount(original);
  if (!a) return null;
  const words = t.replace(/[^\p{L}\d\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const verbIncome = /(?:^|\s)(?:получил[аи]?|пришло|поступило|зарплата|аванс|премия|доход|подработк[аи]|вернули|возврат|подарили)(?:\s|$)/.test(t);
  const verbExpense = /(?:^|\s)(?:потратил[аи]?|купил[аи]?|заплатил[аи]?|оплатил[аи]?|расход|трата|минус)(?:\s|$)/.test(t);
  let date = todayStr(now);
  if (/(?:^|\s)позавчера(?:\s|$)/.test(t)) date = addDays(date, -2);
  else if (/(?:^|\s)вчера(?:\s|$)/.test(t)) date = addDays(date, -1);
  // заметка к записи: исходный текст без суммы и служебных слов
  const rest = (original.slice(0, a.start) + ' ' + original.slice(a.end))
    .replace(/(?:^|\s)(?:потратил[аи]?|купил[аи]?|заплатил[аи]?|оплатил[аи]?|получил[аи]?|расход|трата|минус|доход|пришло|поступило|вчера|позавчера|сегодня)(?=\s|$)/giu, ' ')
    .replace(/(?:^|\s)(?:на|за|в|во|от|по)(?=\s|$)/giu, ' ').replace(/[₽]|\bруб(?:лей|ля|\.)?\b|\bр\.?(?=\s|$)/giu, ' ').replace(/\s+/g, ' ').trim();
  if (verbIncome && a) {
    const cat = (INCOME_RULES.find(([, re]) => re.test(t)) || ['Другое'])[0];
    return { kind: 'income', data: { amountMinor: a.minor, category: cat, note: cat === 'Другое' ? rest : '', date }, confidence: 'high' };
  }
  // «кофе 250»: короткая фраза, где число стоит в самом конце и первое слово — не глагол в начальной форме («купить хлеб 60» — это задача)
  const trailing = norm(original.slice(a.end)).replace(/[\s₽.]|руб(?:лей|ля)?|р$/g, '') === '';
  const weak = !verbExpense && !a.suffix && trailing && words.length >= 2 && words.length <= 4 && /^\D+\d/.test(t) && !/(?:ть|ться|ти|чь)$/.test(words[0]);
  if (verbExpense || a.suffix || weak) {
    if (!verbExpense && !a.suffix && !weak) return null;
    return { kind: 'expense', data: { amountMinor: a.minor, category: guessCategory(rest || original), note: rest, date }, confidence: verbExpense || a.suffix ? 'high' : 'mid' };
  }
  return null;
}

// Человеческая подпись предложения: что будет добавлено.
export function captureLabel(c) {
  const d = c.data;
  switch (c.kind) {
    case 'expense': return `расход ${formatMoney(d.amountMinor)} · ${d.category}${d.note ? ` (${d.note})` : ''}`;
    case 'income': return `доход ${formatMoney(d.amountMinor)} · ${d.category}${d.note ? ` (${d.note})` : ''}`;
    case 'measure': return `замер: ${MEASURES[d.kind].label} ${formatMeasure({ ...d, unit: MEASURES[d.kind].unit })}`;
    case 'note': return `заметка «${d.text.length > 40 ? d.text.slice(0, 37) + '…' : d.text}»`;
    case 'habit': return `привычка «${d.name}» — ${d.level === 'min' ? 'минимум' : 'сделано'}`;
    case 'card': return `карточку «${d.q.length > 30 ? d.q.slice(0, 27) + '…' : d.q}» → «${d.a.length > 30 ? d.a.slice(0, 27) + '…' : d.a}»`;
    default: return c.kind;
  }
}

// Создаёт настоящие события (с проверкой данных). Бросает понятную ошибку, если что-то не так.
export function buildCapture(c, { habits = [], now = Date.now() } = {}) {
  const d = c.data;
  switch (c.kind) {
    case 'expense': return makeExpense({ amount: d.amountMinor, category: DEFAULT_CATEGORIES.includes(d.category) ? d.category : 'Другое', note: d.note, date: d.date }, now);
    case 'income': return makeIncome({ amount: d.amountMinor, category: d.category, note: d.note, date: d.date }, now);
    case 'measure': return makeMeasure({ kind: d.kind, value: d.value, value2: d.value2, date: todayStr(now) }, now);
    case 'note': return makeNote(d.text, now);
    case 'card': return makeUserCard(d.q, d.a, now);
    case 'habit': { const h = habits.find(x => x.id === d.habitId); if (!h) throw new Error('Привычка не найдена'); return makeHabitLog({ id: h.id }, todayStr(now), d.level, now); }
    default: throw new Error('Неизвестный тип записи');
  }
}
