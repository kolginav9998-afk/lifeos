// Профиль: статистика простыми словами. Чистая логика: журнал записей и «сейчас» → разделы с плитками «подпись + число».
// Только числа и даты из твоих данных: никаких оценок «хорошо/плохо», медицинских выводов и сравнения с другими людьми.
// Ничего не читает из хранилища и часов: порядок записей не влияет на результат, входные данные не меняются.
// День записи — день по часам устройства (местное время), поэтому часовой пояс и переход на летнее время дни не сдвигают.
// Новый раздел добавляется ОДНОЙ записью sec('id', {…}) в список SECTIONS: экран профиля и итог «Поделиться» подхватят её сами.
import { APP_NAME } from './config.js';
import { todayStr, addDays, daysBetween, isYmd, groupTasks } from './events.js';
import { REGISTRY, knownType } from './registry.js';
import { plural, homeModel, summaryOf, laundryOf } from './home.js';
import { habitStats } from './habits.js';
import { formatMoney, balanceOfMonth, sumBetween } from './money.js';
import { goalProgress } from './planning.js';
import { doneWorkouts, personalRecords } from './workouts.js';
import { sleepStats, measureKey } from './health.js';
import { dayMood } from './diary.js';
import { practiceBy } from './practice.js';
import { statusMap, SATISFIED } from './curriculum.js';
import { dictionOf, dictionStreak, bestStreak } from './diction.js';
import { statesOf } from './academy.js';
import { isMastered } from './srs.js';
import { TEST_BY_ID, fmtPrimary, primaryOf, runsOf } from './bt-core.js';
import { LOGIC_IDS, WINDOW_DAYS, logicIndexNow } from './iq-index.js';
import { cfgOf, workdaysOf, monthSummary, fmtDur } from './schedule.js';
import { payOf, paymonthsOf, computeMonth, fmtMoney } from './salary.js';

// ---------- слова и числа ----------
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const parts = ymd => ymd.split('-').map(Number);
const dateText = ymd => { const [, m, d] = parts(ymd); return `${d} ${MONTH_GEN[m - 1]}`; };                       // «16 ноября»
const dateYear = ymd => `${dateText(ymd)} ${ymd.slice(0, 4)}`;                                                      // «16 ноября 2026»
const num = x => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');                                    // 12345 → «12 345» (неразрывный пробел)
const dec = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace('.', ',').replace(/,0+$/, '');         // 7.25 → «7,3», 7 → «7»
const lowFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);                                                               // сравнение без локали: порядок одинаков везде
const pl = (n, one, few, many) => `${num(n)} ${plural(n, one, few, many)}`;

// ---------- период ----------
export const PERIODS = [['week', 'Неделя'], ['month', 'Месяц'], ['all', 'Всё время']];

// «Неделя» — последние 7 дней с сегодняшним; «Месяц» — с 1-го числа текущего месяца по сегодня (как в «Деньгах»); «Всё время» — без начала.
// from/to — включительно, строки 'ГГГГ-ММ-ДД'; phrase — как писать в подписях плиток («за 7 дней», «за ноябрь», «за всё время»).
export function periodRange(kind = 'month', now = Date.now()) {
  const today = todayStr(now), k = PERIODS.some(p => p[0] === kind) ? kind : 'month';
  if (k === 'all') return { kind: k, label: 'Всё время', from: '0000-01-01', to: today, days: null, phrase: 'за всё время', text: 'за всё время' };
  const from = k === 'week' ? addDays(today, -6) : `${today.slice(0, 7)}-01`;
  return { kind: k, label: k === 'week' ? 'Неделя' : 'Месяц', from, to: today, days: daysBetween(from, today) + 1, phrase: k === 'week' ? 'за 7 дней' : `за ${MONTH_NOM[parts(today)[1] - 1]}`, text: rangeText(from, today) };
}
function rangeText(from, to) {                                                                                      // «10–16 ноября», «30 октября – 5 ноября»
  if (from === to) return dateText(to);
  const [fy, fm, fd] = parts(from), [ty, tm, td] = parts(to);
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTH_GEN[tm - 1]}`;
  return fy === ty ? `${dateText(from)} – ${dateText(to)}` : `${dateYear(from)} – ${dateYear(to)}`;
}

// ---------- общая подготовка ----------
const MIN_TS = Date.UTC(2000, 0, 1), MAX_TS = Date.UTC(9999, 0, 1);                                                  // время записи вне этих пределов — повреждённые данные, в дни не попадает
const okTs = ts => Number.isFinite(ts) && ts >= MIN_TS && ts < MAX_TS;
const canonical = (a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0) || byText(String(a.id), String(b.id));       // один и тот же порядок при любом порядке на входе

// Дни по времени записи: «число записей по дням». Записи «из будущего» (часы телефона ушли вперёд) в дни не входят.
function dayCounts(list, today) {
  const days = new Map();
  for (const e of list) {
    if (!okTs(e.ts)) continue;
    const d = todayStr(e.ts);
    if (isYmd(d) && d <= today) days.set(d, (days.get(d) ?? 0) + 1);
  }
  return days;
}
function factsOf(list, days, today) {
  const keys = [...days.keys()].sort(), first = keys[0] ?? null;
  let best = 0, run = 0, prev = null;
  for (const d of keys) { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; if (run > best) best = run; prev = d; }
  let streak = 0, d = days.has(today) ? today : addDays(today, -1);                                              // сегодня можно ещё не записывать: серия не сгорает до конца дня
  while (days.has(d)) { streak++; d = addDays(d, -1); }
  const since = n => { const from = addDays(today, -(n - 1)); let c = 0; for (const [k, v] of days) if (k >= from) c += v; return c; };
  return { today, first, daysWith: first ? daysBetween(first, today) + 1 : 0, activeDays: keys.length, streak, best, last7: since(7), last30: since(30), total: list.length };
}
const countGroups = list => {
  const m = new Map();
  for (const e of list) { const g = knownType(e.type) ? REGISTRY[e.type].group : 'Другое'; m.set(g, (m.get(g) ?? 0) + 1); }
  return [...m].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count || byText(a.group, b.group));
};

const isText = x => typeof x === 'string';                                                                            // (не «e.type === …»: тест реестра принял бы это за тип записи)
const validList = events => (Array.isArray(events) ? events : []).filter(e => e && isText(e.type) && e.payload && typeof e.payload === 'object');   // новый массив: вход не меняется

function makeCtx(events, now, range) {
  const today = todayStr(now), list = validList(events).sort(canonical);
  const byType = new Map();
  for (const e of list) (byType.get(e.type) ?? byType.set(e.type, []).get(e.type)).push(e);
  const days = dayCounts(list, today);
  return {
    events: list, now, today, range, days, facts: factsOf(list, days, today), groups: countGroups(list),
    of: type => byType.get(type) ?? [],
    inRange: d => isYmd(d) && d >= range.from && d <= range.to,
    inRangeTs: ts => { if (!okTs(ts)) return false; const d = todayStr(ts); return isYmd(d) && d >= range.from && d <= range.to; },
  };
}

// «Дней с первой записи», серии, записи за 7 и 30 дней: то, что показывает шапка профиля.
export function appFacts(events, now = Date.now()) { const list = validList(events), today = todayStr(now); return factsOf(list, dayCounts(list, today), today); }

// ---------- плитки ----------
const tile = (key, label, value, hint, extra) => ({ key, label, value: String(value), ...(hint ? { hint } : {}), ...extra });
// Суммы помечены private: экран прячет их, если включено «Скрывать суммы»; в итог «Поделиться» они не попадают.
const money = (key, label, minor, hint, cur = 'RUB') => tile(key, label, cur === 'RUB' ? formatMoney(minor) : fmtMoney(minor, cur), hint, { private: true, minor });
const SHARE = { share: true };                                                                                       // плитки с пометкой попадают в итог «Поделиться»: только числа без денег и здоровья
const NONE = '—';

const appTiles = c => {
  const f = c.facts;
  return [
    tile('app.days', 'Дней с первой записи', num(f.daysWith), f.first ? `считая с ${dateYear(f.first)}` : '', SHARE),
    tile('app.active', 'Активных дней', num(f.activeDays), 'дни, когда была хотя бы одна запись', SHARE),
    tile('app.streak', 'Дней подряд сейчас', num(f.streak), 'серия: запись в каждый из этих дней', SHARE),
    tile('app.best', 'Лучшая серия, дней', num(f.best), 'самая длинная серия за всё время'),
    tile('app.last7', 'Записей за 7 дней', num(f.last7), 'считая сегодняшний день'),
    tile('app.last30', 'Записей за 30 дней', num(f.last30), 'считая сегодняшний день'),
    tile('app.total', 'Всего записей', num(f.total), 'всё, что ты записал(а) в приложении'),
  ];
};

const groupTiles = c => c.groups.filter(g => g.group !== 'Профиль').map((g, i) => tile(`groups.${i}`, g.group, num(g.count)));

function taskTiles(c) {
  const tasks = c.of('task'), g = groupTasks(tasks, c.today), done = tasks.filter(t => t.payload.done === true), phrase = c.range.phrase;
  const inPeriod = c.range.kind === 'all' ? done.length : done.filter(t => c.inRangeTs(t.payload.doneAt)).length;
  return [
    tile('tasks.done', `Сделано ${phrase}`, num(inPeriod), c.range.kind === 'all' ? '' : c.range.text, SHARE),
    ...(c.range.kind === 'all' ? [] : [tile('tasks.done.all', 'Сделано всего', num(done.length))]),
    tile('tasks.open', 'Открытых дел', num(g.openCount), 'ещё не сделаны'),
    tile('tasks.overdue', 'Просрочено', num(g.overdue.length), 'срок прошёл, а дело ещё не сделано'),
  ];
}

function habitTiles(c) {
  const rows = c.of('habit').map(h => ({ h, st: habitStats(h, c.events, c.today), name: String(h.payload.name ?? '') })), active = rows.filter(r => !r.h.payload.archived);
  const top = (list, key) => list.reduce((b, r) => (!b || r.st[key] > b.st[key] || (r.st[key] === b.st[key] && byText(r.name, b.name) < 0) ? r : b), null);
  const cur = top(active, 'streak'), best = top(rows, 'longest');
  const hits = active.reduce((s, r) => s + r.st.hits, 0), span = active.reduce((s, r) => s + r.st.span, 0);
  const logs = c.of('habit_log').filter(l => c.range.kind === 'all' || c.inRange(l.payload.date)).length, archived = rows.length - active.length;
  return [
    tile('habits.active', 'Активных привычек', num(active.length), archived ? `ещё в архиве: ${num(archived)}` : 'которые ты ведёшь сейчас'),
    tile('habits.streak', 'Серия сейчас, дней', num(cur?.st.streak ?? 0), cur?.st.streak ? `«${cur.name}»` : 'серия начинается с первой отметки'),
    tile('habits.best', 'Лучшая серия, дней', num(best?.st.longest ?? 0), best?.st.longest ? `«${best.name}»` : '', SHARE),
    tile('habits.rate', 'Выполнение за 30 дней', span ? `${Math.round((100 * hits) / span)}%` : NONE, span ? `отметок: ${num(hits)} из ${num(span)} плановых дней` : 'у активных привычек ещё нет плановых дней'),
    tile('habits.logs', `Отметок ${c.range.phrase}`, num(logs), c.range.kind === 'all' ? '' : c.range.text, SHARE),
  ];
}

function healthTiles(c) {
  const w = c.of('measure').filter(e => measureKey(e.payload) === 'weight' && Number.isFinite(e.payload.value))
    .sort((a, b) => byText(String(a.payload.date), String(b.payload.date)) || byText(String(a.payload.time ?? ''), String(b.payload.time ?? '')) || (a.ts - b.ts) || byText(String(a.id), String(b.id)));
  const kg = e => `${dec(e.payload.value, 1)} кг`, when = e => (isYmd(e.payload.date) ? dateYear(e.payload.date) : '');
  const sleep = sleepStats(c.of('checkin'), c.today, 14);
  const checkins = c.of('checkin'), moods = [];
  for (let i = 0; i < 14; i++) { const m = dayMood(checkins, addDays(c.today, -i)); if (m !== null) moods.push(m); }
  const mood = moods.length ? moods.reduce((s, x) => s + x, 0) / moods.length : null;
  return [
    tile('health.weight.first', 'Вес: первое значение', w.length ? kg(w[0]) : NONE, w.length ? when(w[0]) : 'замеров веса ещё нет'),
    tile('health.weight.last', 'Вес: последнее значение', w.length ? kg(w.at(-1)) : NONE, w.length ? when(w.at(-1)) : 'замеров веса ещё нет'),
    tile('health.sleep', 'Сон за 14 дней, в среднем', sleep ? `${dec(sleep.avg, 1)} ч` : NONE, sleep ? `по ${pl(sleep.nights, 'утренней отметке', 'утренним отметкам', 'утренним отметкам')}` : 'утренних отметок за 14 дней нет'),
    tile('health.mood', 'Настроение за 14 дней, в среднем', mood === null ? NONE : dec(mood, 1), mood === null ? 'отметок настроения за 14 дней нет' : `шкала 1–5, дней с отметкой: ${num(moods.length)}`),
  ];
}

function moneyTiles(c) {
  const { kind, from, to, phrase } = c.range;
  let income, expense;
  if (kind === 'month') ({ income, expense } = balanceOfMonth(c.events, c.today.slice(0, 7)));                      // как на экране «Деньги»: весь текущий месяц
  else { const [a, b] = kind === 'all' ? ['0000-01-01', '9999-12-31'] : [from, to]; income = sumBetween(c.events, 'income', a, b); expense = sumBetween(c.events, 'expense', a, b); }
  const goals = goalProgress(c.events, c.today);
  return [
    money('money.income', `Доход ${phrase}`, income),
    money('money.expense', `Расход ${phrase}`, expense),
    money('money.balance', `Баланс ${phrase}`, income - expense, 'доход минус расход'),
    tile('money.goals', 'Копилок', num(goals.length), `достигнуто целей: ${num(goals.filter(g => g.done).length)}`),
    money('money.saved', 'Накоплено в копилках', goals.reduce((s, g) => s + g.saved, 0)),
  ];
}

function workoutTiles(c) {
  const done = doneWorkouts(c.events), mine = c.range.kind === 'all' ? done : done.filter(w => c.inRange(w.payload.date));
  const minutes = mine.reduce((s, w) => s + (Number.isFinite(w.payload.minutes) ? w.payload.minutes : 0), 0);
  const recs = personalRecords(c.events), heavy = recs.filter(r => r.maxKg > 0).sort((a, b) => b.maxKg - a.maxKg || byText(a.name, b.name))[0];
  return [
    tile('workouts.period', `Тренировок ${c.range.phrase}`, num(mine.length), minutes ? `всего минут: ${num(minutes)}` : (c.range.kind === 'all' ? '' : c.range.text), SHARE),
    ...(c.range.kind === 'all' ? [] : [tile('workouts.all', 'Тренировок всего', num(done.length))]),
    tile('workouts.records', 'Личные рекорды', num(recs.length), heavy ? `самый тяжёлый подход: ${heavy.name}, ${dec(heavy.maxKg, 1)} кг` : 'упражнения с лучшим результатом'),
  ];
}

function learningTiles(c) {
  const rows = Object.values(practiceBy(c.events, c.range.from, c.range.to)), sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const zero = [...statusMap(c.events, c.now).values()], zeroDone = zero.filter(s => SATISFIED.has(s.status)).length;
  const dict = dictionOf(c.events).filter(e => c.range.kind === 'all' || c.inRange(e.payload.date)), states = statesOf(c.events);
  return [
    tile('learning.minutes', `Минут практики ${c.range.phrase}`, num(sum('total')), `уроки ${num(sum('lessons'))}, карточки ${num(sum('cards'))}, вслух ${num(sum('speak'))}`, SHARE),
    tile('learning.zero', 'Уроков «с нуля» освоено', num(zeroDone), `из ${num(zero.length)} уроков`),
    tile('learning.diction', `Занятий по дикции ${c.range.phrase}`, num(dict.length), c.range.kind === 'all' ? '' : c.range.text),
    tile('learning.diction.streak', 'Серия дикции, дней', num(dictionStreak(c.events, c.today)), `лучшая серия: ${num(bestStreak(c.events))}`),
    tile('learning.cards', 'Карточек выучено', num(states.filter(isMastered).length), `в изучении: ${num(states.length)}`),
  ];
}

function testTiles(c) {
  const runs = c.of('testrun').filter(e => e.payload.tests && typeof e.payload.tests === 'object')
    .sort((a, b) => (Number(b.payload.startedAt) || 0) - (Number(a.payload.startedAt) || 0) || byText(String(b.id), String(a.id)));       // новые первыми
  const finished = runs.filter(e => !e.payload.aborted), mine = c.range.kind === 'all' ? finished : finished.filter(e => c.inRange(e.payload.date));
  const last = new Map();                                                                                          // для каждого теста его последний результат
  for (const e of runs) for (const [id, r] of Object.entries(e.payload.tests)) {
    if (last.has(id) || !TEST_BY_ID[id] || !r || r.ok === false || !r.metrics || primaryOf(id, r.metrics) === null) continue;
    last.set(id, { id, value: fmtPrimary(id, r.metrics), date: e.payload.date, at: Number(e.payload.startedAt) || 0 });
  }
  const recent = [...last.values()].sort((a, b) => b.at - a.at || byText(a.id, b.id)).slice(0, 3);
  return [
    tile('tests.runs', `Проверок ${c.range.phrase}`, num(mine.length), c.range.kind === 'all' ? '' : c.range.text, SHARE),
    ...(c.range.kind === 'all' ? [] : [tile('tests.all', 'Проверок всего', num(finished.length))]),
    ...recent.map(r => tile(`tests.last.${r.id}`, TEST_BY_ID[r.id].title, r.value, `${TEST_BY_ID[r.id].primary.label}, ${isYmd(r.date) ? dateText(r.date) : 'дата не указана'}`)),
  ];
}

function workTiles(c) {
  const cfg = cfgOf(c.events);
  if (!cfg) return [];
  const ym = c.today.slice(0, 7), days = workdaysOf(c.events), m = monthSummary(ym, cfg, days, c.today), out = [
    tile('work.days', 'Рабочих дней в этом месяце', num(m.workdays), m.left ? `осталось: ${num(m.left)}` : 'все рабочие дни месяца позади'),
    tile('work.hours', 'Отмечено часов в этом месяце', fmtDur(m.actualMin), m.recorded ? `дней с отметкой: ${num(m.recorded)}` : 'пока не отмечено ни одного дня'),
    tile('work.plan', 'По графику в этом месяце', fmtDur(m.plannedMin), m.normMin ? `норма месяца: ${fmtDur(m.normMin)}` : ''),
  ];
  const pay = payOf(c.events);
  if (pay) {                                                                                                         // так же, как на экране «Зарплата»: тот же расчёт, поэтому цифры совпадают
    const closed = paymonthsOf(c.events), prior = new Map([...closed].map(([k, v]) => [k, v.computed.taxableMinor])), t = new Date(c.now);
    const r = computeMonth({ ym, cfg, pay, days, today: c.today, nowMin: t.getHours() * 60 + t.getMinutes(), extras: closed.get(ym)?.extras ?? [], prior });
    out.push(money('work.pay.accrued', 'Начислено к сегодняшнему дню', r.accrued.gross, 'до налога', pay.currency),
      money('work.pay.net', 'На руки к сегодняшнему дню', r.accrued.net, 'оценка по твоим настройкам', pay.currency),
      money('work.pay.month', 'На руки за месяц (оценка)', r.month.net, 'расчёт приблизительный', pay.currency));
  }
  return out;
}

// «Условный индекс логики» из iq-index.js: только по твоим результатам, не IQ и не диагноз; число показывается вместе с разбросом.
function logicTiles(c) {
  const r = logicIndexNow(runsOf(c.events), c.now);
  if (!r) return [];
  return [
    tile('logic.index', 'Условный индекс логики', num(r.index), 'из 100; не IQ и не диагноз, только для сравнения с собой'),
    tile('logic.range', 'Примерный разброс', `${num(r.lo)}–${num(r.hi)}`, 'при малом числе заданий границы шире'),
    tile('logic.items', 'Заданий в расчёте', num(r.items), `за последние ${WINDOW_DAYS} дней`),
  ];
}

function homeTiles(c) {
  const m = homeModel(c.events, c.today), s = summaryOf(m);
  let wears = 0, washes = 0;
  for (const l of c.of('itemlog')) {
    if (!m.byId.has(l.payload.item) || !(c.range.kind === 'all' || c.inRange(l.payload.date))) continue;
    if (l.payload.kind === 'wash') washes++; else if (l.payload.kind === 'wear' || l.payload.kind === 'use') wears++;
  }
  return [
    tile('home.items', 'Вещей', num(s.count), s.qty > s.count ? `штук всего: ${num(s.qty)}` : 'которые есть сейчас'),
    tile('home.wears', `Надеваний ${c.range.phrase}`, num(wears), 'вместе с использованием техники и посуды', SHARE),
    tile('home.washes', `Стирок ${c.range.phrase}`, num(washes), c.range.kind === 'all' ? '' : c.range.text),
    tile('home.laundry', 'Ждут стирки', num(laundryOf(m).due.length), 'по правилам ухода из карточек вещей'),
  ];
}

// ---------- список разделов ----------
// sec(id, {title, icon, screen, has, tiles, emptyText, emptyAction}): has(ctx) — есть ли данные, tiles(ctx) — плитки, screen — куда ведёт «Открыть раздел».
// ctx: events (копия, в одном порядке), now, today, range (periodRange), of(type), inRange(дата), inRangeTs(время), facts (appFacts), groups.
// Чтобы добавить раздел из другого модуля, достаточно SECTIONS.push(sec('my', {…})). id раздела — не id элемента страницы (поэтому через sec).
export const sec = (id, o) => ({ id, ...o });
const hasGroup = (c, group) => c.events.some(e => knownType(e.type) && REGISTRY[e.type].group === group);
export const SECTIONS = [
  sec('app', { title: 'Приложение', icon: 'pulse', screen: 'reflect', has: c => c.facts.total > 0, tiles: appTiles,
    emptyText: 'Сделай первую запись: задачу, отметку или заметку. Здесь появятся дни и серии.', emptyAction: 'Открыть итоги недели' }),
  sec('groups', { title: 'Записи по группам', icon: 'list', screen: 'menu', has: c => c.facts.total > 0, tiles: groupTiles,
    emptyText: 'Когда появятся записи, здесь будет видно, сколько их в каждом разделе.', emptyAction: 'Открыть меню' }),
  sec('tasks', { title: 'Дела', icon: 'tasks', screen: 'today', has: c => c.of('task').length > 0, tiles: taskTiles,
    emptyText: 'Добавь первое дело, и здесь будет видно, сколько сделано.', emptyAction: 'Добавить дело' }),
  sec('habits', { title: 'Привычки', icon: 'habits', screen: 'habits', has: c => c.of('habit').length > 0, tiles: habitTiles,
    emptyText: 'Заведи первую привычку: появятся серии и доля выполнения.', emptyAction: 'Завести привычку' }),
  sec('health', { title: 'Здоровье и самочувствие', icon: 'heart', screen: 'health', has: c => c.of('measure').length > 0 || c.of('checkin').length > 0, tiles: healthTiles,
    emptyText: 'Запиши вес или отметь самочувствие: появятся цифры. Это только числа, не советы.', emptyAction: 'Открыть здоровье' }),
  sec('money', { title: 'Деньги', icon: 'money', screen: 'money', has: c => ['income', 'expense', 'goal', 'goalmove'].some(t => c.of(t).length > 0), tiles: moneyTiles,
    emptyText: 'Запиши первый расход или доход: появятся итоги месяца и копилки.', emptyAction: 'Записать расход' }),
  sec('work', { title: 'Работа и зарплата', icon: 'calendar', screen: 'schedule', has: c => cfgOf(c.events) !== null, tiles: workTiles,
    emptyText: 'Выбери график работы: появятся смены месяца и отмеченные часы. Зарплату можно настроить там же.', emptyAction: 'Настроить график' }),
  sec('workouts', { title: 'Тренировки', icon: 'dumbbell', screen: 'workouts', has: c => doneWorkouts(c.events).length > 0, tiles: workoutTiles,
    emptyText: 'Заверши первую тренировку: появятся количество и личные рекорды.', emptyAction: 'Начать тренировку' }),
  sec('learning', { title: 'Учёба', icon: 'growth', screen: 'learn', has: c => hasGroup(c, 'Учёба'), tiles: learningTiles,
    emptyText: 'Пройди первый урок или повтори карточки: появятся минуты практики и успехи.', emptyAction: 'Открыть учёбу' }),
  sec('tests', { title: 'Тесты и проверки', icon: 'tests', screen: 'tests', has: c => c.of('testrun').length > 0, tiles: testTiles,
    emptyText: 'Пройди первую проверку: здесь появятся последние результаты. Это не оценка ума, а сравнение с самим собой.', emptyAction: 'Пройти проверку' }),
  sec('logic', { title: 'Условный индекс логики', icon: 'target', screen: 'tests', has: c => runsOf(c.events).some(r => LOGIC_IDS.some(id => r.tests[id] && !r.tests[id].skipped)), tiles: logicTiles,
    emptyText: 'Пройди проверку логики: индекс появится, когда за последние три месяца решено не меньше шести заданий. Это не IQ.', emptyAction: 'Открыть проверки' }),
  sec('home', { title: 'Дом', icon: 'home', screen: 'home', has: c => c.of('item').length > 0, tiles: homeTiles,
    emptyText: 'Добавь первую вещь и отмечай «Надел» и «Постирал»: появятся числа.', emptyAction: 'Добавить вещь' }),
];

// ---------- итог ----------
// Разделы для экрана: [{ id, title, icon, screen, tiles, empty, emptyText, emptyAction, failed? }]. period — 'week' | 'month' | 'all' или результат periodRange.
// Раздел без данных остаётся в списке (empty: true, плиток нет). Ошибка в одном разделе (странная запись) не ломает остальные: failed: true.
export function statsOverview(events, now = Date.now(), period = 'month') {
  const range = period && typeof period === 'object' && period.from && period.to ? period : periodRange(period, now);
  const c = makeCtx(events, now, range);
  return SECTIONS.map(def => {
    const base = { id: def.id, title: def.title, icon: def.icon, screen: def.screen, emptyText: def.emptyText ?? 'Пока нет данных.', emptyAction: def.emptyAction ?? 'Открыть раздел' };
    try {
      const has = def.has ? def.has(c) : true, tiles = has ? def.tiles(c) : [];
      return { ...base, tiles, empty: !tiles.length };
    } catch { return { ...base, tiles: [], empty: true, failed: true }; }
  });
}

// Короткий текст для «Поделиться»: по строке на раздел, только плитки с пометкой share (числа без денег, здоровья и названий). Пусто — нечем делиться.
export function shareText(sections, range) {
  const lines = [];
  for (const s of sections) {
    if (s.empty) continue;
    const picked = s.tiles.filter(t => t.share).map(t => `${lowFirst(t.label)} ${t.value}`);
    if (picked.length) lines.push(`${s.title}: ${picked.join(', ')}`);
  }
  if (!lines.length) return '';
  return [`Мои итоги в приложении «${APP_NAME}»${range && range.kind !== 'all' ? ` (${range.text})` : ''}`, ...lines].join('\n');
}

// ---------- календарь активности ----------
export const ACTIVITY_LEVELS = [[0, 'нет записей'], [1, '1 запись'], [2, '2–3 записи'], [3, '4–7 записей'], [4, '8 и больше']];
const levelOf = n => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 7 ? 3 : 4);

// Недели по столбцам (с понедельника), в каждой 7 дней; последняя неделя — текущая, дни после сегодняшнего помечены future.
// Число записей по дням считается по времени записи (местное время).
export function activityByDay(events, now = Date.now(), weeks = 26) {
  const w = Number.isInteger(weeks) && weeks >= 1 && weeks <= 104 ? weeks : 26, today = todayStr(now);
  const [y, m, d] = parts(today), dow = (new Date(y, m - 1, d, 12).getDay() + 6) % 7;                              // понедельник — 0
  const from = addDays(today, -dow - 7 * (w - 1));
  const counts = dayCounts(validList(events), today);
  const grid = Array.from({ length: w }, (_, i) => Array.from({ length: 7 }, (_, j) => {
    const date = addDays(from, i * 7 + j);
    if (date > today) return { date, future: true, count: 0, level: 0 };
    const count = counts.get(date) ?? 0;
    return { date, future: false, count, level: levelOf(count) };
  }));
  const cells = grid.flat().filter(x => !x.future);
  let busiest = null;
  for (const x of cells) if (x.count > 0 && (!busiest || x.count > busiest.count)) busiest = { date: x.date, count: x.count };           // при равенстве — более ранний день
  return { from, to: today, weeks: grid, days: cells.length, total: cells.reduce((s, x) => s + x.count, 0), activeDays: cells.filter(x => x.count > 0).length, busiest };
}
// То же словами (текстовая альтернатива календарю): сводка и строки «неделя — записей — активных дней», новые недели первыми.
export function activityText(a) {
  const span = `${pl(a.weeks.length, 'неделю', 'недели', 'недель')} (${rangeText(a.from, a.to)})`;
  if (!a.total) return `За ${span} записей не было.`;
  const lead = `За ${span} активных дней: ${num(a.activeDays)} из ${num(a.days)}, всего ${pl(a.total, 'запись', 'записи', 'записей')}.`;
  return a.busiest ? `${lead} Больше всего записей было ${dateText(a.busiest.date)}: ${num(a.busiest.count)}.` : lead;
}
export function activityWeeks(a) {
  return a.weeks.map(week => {
    const shown = week.filter(x => !x.future);
    return { from: week[0].date, to: shown.at(-1)?.date ?? week[0].date, text: rangeText(week[0].date, shown.at(-1)?.date ?? week[0].date), count: shown.reduce((s, x) => s + x.count, 0), active: shown.filter(x => x.count > 0).length };
  }).reverse();
}
