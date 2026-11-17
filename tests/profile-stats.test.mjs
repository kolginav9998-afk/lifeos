// Профиль и статистика (profile-stats.js): разделы, период, календарь активности, итог «Поделиться».
// Границы: пустой журнал, один день, смена месяца, часовой пояс и переход на летнее время, серии, порядок записей, неизменность входа, период, ломаные записи.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../events.js';
import * as H from '../habits.js';
import * as M from '../money.js';
import * as P from '../planning.js';
import * as Hl from '../health.js';
import * as D from '../diary.js';
import * as W from '../workouts.js';
import * as Hm from '../home.js';
import * as S from '../schedule.js';
import * as Pay from '../salary.js';
import { presetTax } from '../salary-tax.js';
import { TRACKS, makeLessonDone } from '../academy.js';
import { newState, grade } from '../srs.js';
import { makeSpeak } from '../speaking.js';
import { makeDiction } from '../diction.js';
import { practiceBy } from '../practice.js';
import { makeRun, makeRunEvent } from '../bt-core.js';
import { logicIndexNow } from '../iq-index.js';
import { runsOf } from '../bt-core.js';
import { habitStats } from '../habits.js';
import { makeRng } from '../stats.js';
import { APP_NAME } from '../config.js';
import { statsOverview, periodRange, activityByDay, activityText, activityWeeks, appFacts, shareText, SECTIONS, sec, PERIODS, ACTIVITY_LEVELS } from '../profile-stats.js';

// ---------- помощники ----------
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();      // местное время: тест не зависит от часового пояса машины
const NOW = at(2026, 11, 17);                                                        // вторник, 17 ноября 2026
const TODAY = '2026-11-17';
const day = n => E.addDays(TODAY, n);
const when = (n, h = 12) => at(2026, 11, 17 + n, h);
let seq = 0;
const ev = (type, payload, ts = NOW, id = `${type}:${++seq}`) => ({ id, type, ts, payload, source: 'manual', confidence: 1, evidence: [] });
const sectionOf = (list, id) => list.find(s => s.id === id);
const tilesOf = (list, id) => Object.fromEntries(sectionOf(list, id).tiles.map(t => [t.key, t]));
const overview = (events, period = 'month', now = NOW) => statsOverview(events, now, period);
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const withTz = (zone, fn) => { const was = process.env.TZ; process.env.TZ = zone; try { return fn(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; } };

// Богатый журнал: есть почти всё, что считают разделы. Значения подобраны так, чтобы ответ можно было проверить руками.
function rich() {
  const out = [];
  out.push(E.makeProfile('Анна', when(-60), null, { avatar: '🦊', color: 'violet', motto: 'Шаг за шагом' }));
  // дела: сделаны сегодня, 3 дня назад, 15 дней назад (тот же месяц), 28 дней назад (прошлый месяц) и 77 дней назад; открыты: просроченное, на завтра, без срока
  [0, -3, -15, -28, -77].forEach((n, i) => out.push(E.completeTask(E.makeTask(`Дело ${i}`, when(n - 1), { due: day(n) }), when(n)).updated));
  out.push(E.makeTask('Просроченное', when(-5), { due: day(-2) }), E.makeTask('На завтра', when(-1), { due: day(1) }), E.makeTask('Без срока', when(-1)));
  // привычки: «Зарядка» (4 дня + один давний), «Чтение» (4 дня подряд до вчера), «Старая» в архиве с серией в 11 дней
  const h1 = H.makeHabit({ name: 'Зарядка' }, when(-20)), h2 = H.makeHabit({ name: 'Чтение' }, when(-40)), h3 = H.archiveHabit(H.makeHabit({ name: 'Старая' }, when(-100)));
  out.push(h1, h2, h3);
  for (const n of [0, -1, -2, -5, -12]) out.push(H.makeHabitLog(h1, day(n), 'full', when(n)));
  for (const n of [-1, -2, -3, -4]) out.push(H.makeHabitLog(h2, day(n), 'min', when(n)));
  for (let n = -80; n >= -90; n--) out.push(H.makeHabitLog(h3, day(n), 'full', when(n)));
  // здоровье: вес вносили не по порядку; сон и настроение за 14 дней и одна давняя отметка
  out.push(Hl.makeMeasure({ kind: 'weight', value: 78.5, date: day(-2) }, when(-2)), Hl.makeMeasure({ kind: 'weight', value: 80, date: day(-47) }, when(-47)), Hl.makeMeasure({ kind: 'weight', value: 79.2, date: day(-28) }, when(-28)));
  out.push(D.makeCheckin('m', day(-1), { sleepHours: 7, mood: 4 }, '', when(-1)), D.makeCheckin('e', day(-1), { mood: 2 }, '', when(-1)), D.makeCheckin('m', day(-2), { sleepHours: 8, mood: 5 }, '', when(-2)), D.makeCheckin('m', day(-20), { sleepHours: 4, mood: 1 }, '', when(-20)));
  // деньги: ноябрь, пограничные 31 октября и 1 ноября, копилки
  for (const [amount, n] of [[15000, 0], [25000, -14], [40000, -17], [100000, -68]]) out.push(M.makeExpense({ amount, category: 'Еда', date: day(n) }, when(n)));
  out.push(M.makeIncome({ amount: 500000, category: 'Зарплата', date: day(-12) }, when(-12)), M.makeIncome({ amount: 300000, category: 'Зарплата', date: day(-43) }, when(-43)));
  const g1 = P.makeGoal({ title: 'Отпуск', targetMinor: 100000 }, when(-30)), g2 = P.makeGoal({ title: 'Ноутбук', targetMinor: 5000000 }, when(-30));
  out.push(g1, g2, P.makeGoalMove(g1.id, 40000, { date: day(-20) }, when(-20)), P.makeGoalMove(g1.id, 70000, { date: day(-10) }, when(-10)));
  // тренировки: две в ноябре, одна в октябре
  const workout = (name, n, exercise, set, minutes) => { let w = W.startWorkout({ name, date: day(n), now: when(n) }); w = W.addExercise(w, exercise, 'reps'); w = W.addSet(w, 0, set); return W.finishWorkout(w, { now: when(n) + minutes * 60000 }); };
  out.push(workout('Силовая', -2, 'Жим лёжа', { reps: 8, kg: 60 }, 45), workout('Силовая', -1, 'Жим лёжа', { reps: 10, kg: 62.5 }, 30), workout('Ноги', -30, 'Присед', { reps: 5, kg: 80 }, 40));
  // учёба: разговор, урок, карточки (одна выучена), занятия по дикции
  const en = TRACKS.find(t => t.id === 'english');
  out.push(makeSpeak({ lang: 'english', seconds: 600, date: day(-1) }, when(-1)), makeLessonDone(en, en.lessons[0], day(-2), when(-2)));
  let a = newState('card:a', day(-12)); for (const [i, n] of [-12, -9, -6, -3].entries()) a = grade(a, 'good', day(n)); out.push(ev('srs', a, when(-3), 'srs:card:a'));
  out.push(ev('srs', grade(newState('card:b', day(-5)), 'good', day(-4)), when(-4), 'srs:card:b'));
  out.push(makeDiction({ kind: 'warmup', seconds: 120, date: day(0) }, when(0) + 1), makeDiction({ kind: 'twister', seconds: 90, date: day(-1) }, when(-1) + 2), makeDiction({ kind: 'warmup', seconds: 120, date: day(-20) }, when(-20) + 3));
  // проверки: реакция, матрицы (логика), прерванная и октябрьская
  const run = (startedAt, results, aborted = false) => makeRunEvent(makeRun({ mode: 'single', startedAt, durationMs: 60000, results, aborted }), startedAt);
  out.push(run(when(-3), { reaction: { metrics: { n: 8, median: 312, mean: 320, sd: 30, best: 250, lapses: 0, falseStarts: 0 }, ms: 8000, trials: [] } }));
  out.push(run(when(0, 9), { matrices: { metrics: { n: 12, correct: 9, accuracy: 0.75, meanMs: 9000, score: 12, maxScore: 18 }, ms: 90000, trials: [] } }));
  out.push(run(when(-1), { reaction: { metrics: { n: 8, median: 280, mean: 290, sd: 20, best: 240, lapses: 0, falseStarts: 0 }, ms: 8000, trials: [] } }, true));
  out.push(run(when(-40), { digits: { metrics: { forward: 5, backward: 4, total: 9, attempts: 6 }, ms: 60000, trials: [] } }));
  // дом: вещи (одна продана) и отметки
  const it = (name, kind, extra = {}, n = -50) => Hm.makeItem({ name, kind, ...extra }, when(n) + (++seq));
  const coat = it('Куртка', 'clothes', { care: { how: 'machine', washEveryWears: 2 } }), pot = it('Чайник', 'kitchen'), lamp = it('Старая лампа', 'other', { status: 'sold' });
  out.push(coat, pot, lamp);
  [['wear', coat, 0], ['wear', coat, -1], ['wear', coat, -2], ['wash', coat, -1], ['use', pot, -3], ['wear', coat, -20]].forEach(([kind, item, n], i) => out.push(Hm.makeLog(item, kind, { date: day(n) }, when(n) + 10 + i)));
  // работа: график «5 через 2» и оклад
  out.push(S.makeWorkcfg(S.cfgFromTemplate('w52', day(-30)), null, when(-30)), Pay.makePaycfg({ mode: 'salary', baseMinor: 16000000, currency: 'RUB', tax: presetTax('flat') }, null, when(-30)));
  return out;
}

// ============================================================ период ============================================================

test('период: неделя — 7 дней с сегодняшним, месяц — с 1-го числа, всё время — без начала; неизвестное значение — месяц', () => {
  assert.deepEqual(PERIODS.map(p => p[0]), ['week', 'month', 'all']);
  const w = periodRange('week', NOW), m = periodRange('month', NOW), a = periodRange('all', NOW);
  assert.deepEqual([w.from, w.to, w.days, w.phrase, w.text, w.label], ['2026-11-11', TODAY, 7, 'за 7 дней', '11–17 ноября', 'Неделя']);
  assert.deepEqual([m.from, m.to, m.days, m.phrase, m.text, m.label], ['2026-11-01', TODAY, 17, 'за ноябрь', '1–17 ноября', 'Месяц']);
  assert.deepEqual([a.kind, a.days, a.phrase, a.text, a.to], ['all', null, 'за всё время', 'за всё время', TODAY]);
  assert.ok(a.from < '1970-01-01', 'начало «всего времени» раньше любой записи');
  assert.deepEqual(periodRange('что-то', NOW), m); assert.deepEqual(periodRange(undefined, NOW), m);
});

test('период: смена месяца и года — границы и подписи', () => {
  const first = periodRange('month', at(2026, 12, 1));                                                  // первое число: месяц — один день
  assert.deepEqual([first.from, first.to, first.days, first.phrase, first.text], ['2026-12-01', '2026-12-01', 1, 'за декабрь', '1 декабря']);
  const w = periodRange('week', at(2026, 3, 3));                                                        // неделя через границу месяцев
  assert.deepEqual([w.from, w.to, w.text], ['2026-02-25', '2026-03-03', '25 февраля – 3 марта']);
  const ny = periodRange('week', at(2027, 1, 3));                                                       // и через границу года
  assert.deepEqual([ny.from, ny.to, ny.text], ['2026-12-28', '2027-01-03', '28 декабря 2026 – 3 января 2027']);
  const leap = periodRange('month', at(2028, 2, 29));
  assert.deepEqual([leap.from, leap.days, leap.phrase], ['2028-02-01', 29, 'за февраль']);
});

test('период меняет подписи и числа там, где это имеет смысл, и не трогает остальное', () => {
  const evs = rich();
  const by = k => overview(evs, k);
  // дела: сегодня, 3 дня назад, 15 дней назад, 28 и 77 дней назад
  const t = k => tilesOf(by(k), 'tasks');
  assert.deepEqual([t('week')['tasks.done'].label, t('week')['tasks.done'].value], ['Сделано за 7 дней', '2']);
  assert.deepEqual([t('month')['tasks.done'].label, t('month')['tasks.done'].value], ['Сделано за ноябрь', '3']);
  assert.deepEqual([t('all')['tasks.done'].label, t('all')['tasks.done'].value], ['Сделано за всё время', '5']);
  assert.equal(t('week')['tasks.done.all'].value, '5'); assert.equal(t('month')['tasks.done.all'].value, '5');
  assert.equal(t('all')['tasks.done.all'], undefined, 'за всё время второй плитки «всего» нет: она повторила бы первую');
  // отметки привычек: за неделю — только свежие, за месяц — все ноябрьские, всего — ещё октябрьские и давние
  const logs = k => Number(tilesOf(by(k), 'habits')['habits.logs'].value);
  assert.deepEqual([logs('week'), logs('month'), logs('all')], [8, 9, 20]);
  // то, что от периода не зависит, одинаково
  for (const id of ['app', 'health', 'groups']) assert.deepEqual(sectionOf(by('week'), id).tiles, sectionOf(by('all'), id).tiles, id);
  assert.equal(tilesOf(by('week'), 'habits')['habits.rate'].value, tilesOf(by('all'), 'habits')['habits.rate'].value);
  // период можно передать и готовым объектом
  assert.deepEqual(overview(evs, periodRange('week', NOW)), by('week'));
});

// ============================================================ пустой журнал и один день ============================================================

test('пустой журнал: все разделы на месте и честно пусты, цифр-пустышек нет', () => {
  const list = overview([]);
  assert.deepEqual(list.map(s => s.id), SECTIONS.map(s => s.id));
  assert.deepEqual(list.map(s => s.id), ['app', 'groups', 'tasks', 'habits', 'health', 'money', 'work', 'workouts', 'learning', 'tests', 'logic', 'home']);
  const screens = new Set(['reflect', 'menu', 'today', 'habits', 'health', 'money', 'schedule', 'workouts', 'learn', 'tests', 'home']);
  for (const s of list) {
    assert.equal(s.empty, true, s.id); assert.deepEqual(s.tiles, [], s.id);
    assert.ok(s.title && s.icon && screens.has(s.screen), `${s.id}: заголовок, значок, экран ${s.screen}`);
    assert.ok(s.emptyText.length > 20 && s.emptyAction.length > 3 && !s.failed, `${s.id}: что делать и куда нажать`);
  }
  for (const bad of [undefined, null, 'x', 5, {}]) assert.equal(overview(bad).every(s => s.empty), true, `вход ${bad}`);
  assert.deepEqual(appFacts([], NOW), { today: TODAY, first: null, daysWith: 0, activeDays: 0, streak: 0, best: 0, last7: 0, last30: 0, total: 0 });
  const cal = activityByDay([], NOW);
  assert.equal(cal.weeks.length, 26); assert.ok(cal.weeks.every(w => w.length === 7));
  assert.deepEqual([cal.total, cal.activeDays, cal.busiest], [0, 0, null]);
  assert.match(activityText(cal), /записей не было/);
  assert.equal(shareText(list, periodRange('month', NOW)), '', 'нечем делиться — пустой текст');
});

test('один день: одна запись сегодня — первый день, серия 1; запись вчера серию не рвёт; давняя — рвёт', () => {
  const one = [E.makeTask('Дело', NOW)];
  assert.deepEqual(appFacts(one, NOW), { today: TODAY, first: TODAY, daysWith: 1, activeDays: 1, streak: 1, best: 1, last7: 1, last30: 1, total: 1 });
  const y = appFacts([E.makeTask('Дело', when(-1))], NOW);
  assert.deepEqual([y.daysWith, y.streak, y.best], [2, 1, 1], 'сегодня ещё можно записать: серия не сгорает до конца дня');
  const old = appFacts([E.makeTask('Дело', when(-5))], NOW);
  assert.deepEqual([old.daysWith, old.streak, old.best, old.last7, old.last30], [6, 0, 1, 1, 1]);
  const list = overview(one), app = tilesOf(list, 'app');
  assert.deepEqual([app['app.days'].value, app['app.active'].value, app['app.streak'].value, app['app.best'].value, app['app.last7'].value, app['app.total'].value], ['1', '1', '1', '1', '1', '1']);
  assert.equal(app['app.days'].hint, 'считая с 17 ноября 2026');
  assert.equal(sectionOf(list, 'tasks').empty, false); assert.equal(sectionOf(list, 'habits').empty, true);
  const cal = activityByDay(one, NOW);
  assert.deepEqual([cal.total, cal.activeDays, cal.busiest], [1, 1, { date: TODAY, count: 1 }]);
});

test('серии активных дней: текущая, лучшая, записи «из будущего» не считаются', () => {
  const evs = offsets => offsets.map((n, i) => ev('note', { text: 'x' }, when(n), `n${i}`));
  const f = appFacts(evs([0, -1, -2, -4, -5, -6, -7]), NOW);
  assert.deepEqual([f.streak, f.best, f.activeDays, f.daysWith], [3, 4, 7, 8]);
  const g = appFacts(evs([-1, -2, -3, -10]), NOW);
  assert.deepEqual([g.streak, g.best], [3, 3], 'сегодня записей нет, но серия идёт со вчера');
  const h = appFacts(evs([-2, -3]), NOW);
  assert.deepEqual([h.streak, h.best], [0, 2], 'пропущены вчера и сегодня: текущей серии нет');
  const future = appFacts(evs([0, 2, 3]), NOW);
  assert.deepEqual([future.activeDays, future.streak, future.total, future.daysWith], [1, 1, 3, 1], 'дни из будущего в серии и днях не участвуют, а в числе записей остаются');
  assert.deepEqual([appFacts(evs([-29, -30]), NOW).last30, appFacts(evs([-6, -7]), NOW).last7], [1, 1], 'окно ровно 30 и 7 дней');
});

// ============================================================ смена месяца: деньги ============================================================

test('смена месяца: «Деньги» берут только текущий месяц (как экран «Деньги»), прошлый месяц не просачивается', () => {
  const evs = [M.makeExpense({ amount: 10000, category: 'Еда', date: '2026-10-31' }, at(2026, 10, 31)), M.makeExpense({ amount: 20000, category: 'Еда', date: '2026-11-01' }, at(2026, 11, 1)),
    M.makeIncome({ amount: 100000, category: 'Зарплата', date: '2026-11-01' }, at(2026, 11, 1))];
  const nov = tilesOf(overview(evs, 'month', at(2026, 11, 1)), 'money');
  assert.deepEqual([nov['money.expense'].minor, nov['money.income'].minor, nov['money.balance'].minor, nov['money.expense'].label], [20000, 100000, 80000, 'Расход за ноябрь']);
  const oct = tilesOf(overview(evs, 'month', at(2026, 10, 31)), 'money');
  assert.deepEqual([oct['money.expense'].minor, oct['money.income'].minor, oct['money.expense'].label], [10000, 0, 'Расход за октябрь']);
  assert.equal(M.balanceOfMonth(evs, '2026-11').expense, nov['money.expense'].minor, 'то же число, что на экране «Деньги»');
  const week = tilesOf(overview(evs, 'week', at(2026, 11, 1)), 'money');
  assert.equal(week['money.expense'].minor, 30000, 'неделя перешагивает границу месяца');
  assert.equal(tilesOf(overview(evs, 'all', at(2026, 11, 1)), 'money')['money.expense'].minor, 30000);
});

test('деньги: баланс со знаком, суммы помечены private и не попадают в итог для «Поделиться»', () => {
  const list = overview(rich(), 'week'), money = tilesOf(list, 'money');
  assert.equal(money['money.balance'].value, M.formatMoney(-15000)); assert.match(money['money.balance'].value, /^-150/); assert.equal(money['money.balance'].minor, -15000);
  assert.deepEqual([money['money.goals'].value, money['money.goals'].hint, money['money.saved'].value], ['2', 'достигнуто целей: 1', M.formatMoney(110000)]);
  for (const id of ['money.income', 'money.expense', 'money.balance', 'money.saved']) assert.equal(money[id].private, true, id);
  assert.equal(money['money.goals'].private, undefined);
  const text = shareText(list, periodRange('week', NOW));
  assert.ok(!/₽/.test(text) && !text.includes(money['money.saved'].value) && !/доход|расход|баланс|копилк/i.test(text), 'в итоге нет денег');
});

// ============================================================ разделы ============================================================

test('«Приложение»: дни, серии, записи за 7 и 30 дней, всего; «Записи по группам» по реестру', () => {
  const evs = rich(), list = overview(evs), app = tilesOf(list, 'app'), f = appFacts(evs, NOW);
  assert.equal(f.first, day(-100), 'первая запись — самая давняя по времени записи');
  assert.equal(app['app.days'].value, String(E.daysBetween(day(-100), TODAY) + 1));
  assert.equal(app['app.total'].value.replace(/\s/g, ''), String(evs.length));
  assert.equal(app['app.last7'].value, String(evs.filter(e => e.ts >= when(-6, 0) && e.ts <= NOW + 864e5).length));
  const groups = sectionOf(list, 'groups').tiles;
  assert.ok(groups.length >= 8 && groups.every(t => t.label !== 'Профиль'), 'служебная группа «Профиль» не показывается');
  const counts = groups.map(t => Number(t.value.replace(/\s/g, '')));
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'группы по убыванию числа записей');
  const expectGroup = name => evs.filter(e => ({ task: 'Дела', habit: 'Привычки', habit_log: 'Привычки' })[e.type] === name).length;
  assert.equal(groups.find(t => t.label === 'Привычки').value.replace(/\s/g, ''), String(expectGroup('Привычки')));
  assert.equal(groups.find(t => t.label === 'Дела').value.replace(/\s/g, ''), String(expectGroup('Дела')));
});

test('записи неизвестных типов (от новой версии) попадают в группу «Другое», порядок групп стабилен', () => {
  const evs = [ev('hologram', { a: 1 }), ev('hologram', { a: 2 }), ev('zzz', {}), E.makeTask('Дело', NOW), ev('note', { text: 'а' }), ev('note', { text: 'б' })];
  const tiles = sectionOf(overview(evs), 'groups').tiles.map(t => [t.label, t.value]);
  assert.deepEqual(tiles, [['Другое', '3'], ['Заметки и дневник', '2'], ['Дела', '1']]);
});

test('«Дела»: сделано за период и всего, открытые, просроченные', () => {
  const t = tilesOf(overview(rich()), 'tasks');
  assert.deepEqual([t['tasks.done'].value, t['tasks.done.all'].value, t['tasks.open'].value, t['tasks.overdue'].value], ['3', '5', '3', '1']);
  assert.equal(t['tasks.done'].hint, '1–17 ноября');
});

test('«Привычки»: активные, серии с названиями, доля за 30 дней по плановым дням, отметки за период', () => {
  const evs = rich(), t = tilesOf(overview(evs), 'habits');
  assert.deepEqual([t['habits.active'].value, t['habits.active'].hint], ['2', 'ещё в архиве: 1']);
  assert.deepEqual([t['habits.streak'].value, t['habits.streak'].hint], ['4', '«Чтение»'], 'текущая серия — у «Чтения» (до вчера), у «Зарядки» только 3');
  assert.deepEqual([t['habits.best'].value, t['habits.best'].hint], ['11', '«Старая»'], 'лучшая серия учитывает и привычки из архива');
  const act = evs.filter(e => e.type === 'habit' && !e.payload.archived).map(h => habitStats(h, evs, TODAY));
  const hits = act.reduce((s, x) => s + x.hits, 0), span = act.reduce((s, x) => s + x.span, 0);
  assert.equal(t['habits.rate'].value, `${Math.round((100 * hits) / span)}%`); assert.equal(t['habits.rate'].hint, `отметок: ${hits} из ${span} плановых дней`);
  assert.equal(t['habits.logs'].value, '9');
  const noPlan = tilesOf(overview([H.makeHabit({ name: 'Новая' }, NOW)]), 'habits');
  assert.equal(noPlan['habits.rate'].value, '0%', 'привычка есть, отметок нет');
});

test('«Здоровье»: вес — первое и последнее по датам, сон и настроение за 14 дней — только числа', () => {
  const t = tilesOf(overview(rich()), 'health');
  assert.deepEqual([t['health.weight.first'].value, t['health.weight.first'].hint], ['80 кг', '1 октября 2026']);
  assert.deepEqual([t['health.weight.last'].value, t['health.weight.last'].hint], ['78,5 кг', '15 ноября 2026']);
  assert.deepEqual([t['health.sleep'].value, t['health.sleep'].hint], ['7,5 ч', 'по 2 утренним отметкам'], 'отметка 20-дневной давности в 14 дней не входит');
  assert.deepEqual([t['health.mood'].value, t['health.mood'].hint], ['4', 'шкала 1–5, дней с отметкой: 2']);
  const none = tilesOf(overview([Hl.makeMeasure({ kind: 'bp', value: 120, value2: 80, date: TODAY }, NOW), D.makeCheckin('e', day(-30), { mood: 3 }, '', when(-30))]), 'health');
  assert.deepEqual([none['health.weight.last'].value, none['health.sleep'].value, none['health.mood'].value], ['—', '—', '—'], 'нет данных — прочерк, а не ноль');
});

test('«Тренировки»: за период и всего, минуты, личные рекорды', () => {
  const t = tilesOf(overview(rich()), 'workouts');
  assert.deepEqual([t['workouts.period'].value, t['workouts.period'].hint, t['workouts.all'].value], ['2', 'всего минут: 75', '3']);
  assert.deepEqual([t['workouts.records'].value, t['workouts.records'].hint], ['2', 'самый тяжёлый подход: Присед, 80 кг']);
  assert.equal(sectionOf(overview([W.startWorkout({ now: NOW })]), 'workouts').empty, true, 'начатая и не законченная тренировка не считается');
});

test('«Учёба»: минуты практики за период, дикция и её серия, выученные карточки', () => {
  const evs = rich(), t = tilesOf(overview(evs), 'learning');
  const ref = Object.values(practiceBy(evs, '2026-11-01', TODAY)), total = k => ref.reduce((s, r) => s + (r[k] || 0), 0);
  assert.equal(t['learning.minutes'].value, String(total('total')));
  assert.ok(total('speak') === 10 && total('lessons') === 3 && total('total') >= 13, 'разговор 10 минут и урок 3 минуты учтены');
  assert.equal(t['learning.minutes'].hint, `уроки ${total('lessons')}, карточки ${total('cards')}, вслух ${total('speak')}`);
  assert.deepEqual([t['learning.diction'].value, t['learning.diction.streak'].value, t['learning.diction.streak'].hint], ['2', '2', 'лучшая серия: 2']);
  assert.equal(overview(evs, 'all').find(s => s.id === 'learning').tiles.find(x => x.key === 'learning.diction').value, '3');
  assert.deepEqual([t['learning.cards'].value, t['learning.cards'].hint], ['1', 'в изучении: 2']);
  assert.match(t['learning.zero'].hint, /^из \d+ уроков$/); assert.equal(t['learning.zero'].value, '0');
});

test('«Тесты»: сколько пройдено (прерванные не в счёт), последние результаты — по одному на тест, новые первыми', () => {
  const evs = rich(), week = tilesOf(overview(evs, 'week'), 'tests'), all = tilesOf(overview(evs, 'all'), 'tests');
  assert.deepEqual([week['tests.runs'].value, week['tests.runs'].label, week['tests.all'].value], ['2', 'Проверок за 7 дней', '3']);
  assert.deepEqual([all['tests.runs'].value, all['tests.all']], ['3', undefined]);
  const last = sectionOf(overview(evs), 'tests').tiles.filter(t => t.key.startsWith('tests.last.'));
  assert.deepEqual(last.map(t => [t.label, t.value]), [['Матрицы', '9'], ['Реакция', '280 мс'], ['Цифры по памяти', '9']], 'пройденный до обрыва тест в прерванной проверке остаётся результатом, но сама проверка в счёт не идёт');
  assert.deepEqual(last.map(t => t.hint), ['Верных ответов из 12, 17 ноября', 'Время реакции, 16 ноября', 'Объём памяти, 8 октября']);
  const bad = makeRunEvent(makeRun({ mode: 'single', startedAt: when(-2), durationMs: 1000, results: { reaction: { metrics: { n: 2, median: 90, mean: 90, sd: 1, best: 90, lapses: 0, falseStarts: 9 }, ms: 1, trials: [] } } }), when(-2));
  const t = sectionOf(overview([bad]), 'tests').tiles.filter(x => x.key.startsWith('tests.last.'));
  assert.deepEqual(t, [], 'недостоверный результат («лишь бы пройти») в последних результатах не показывается');
});

test('«Условный индекс логики»: честная подпись, разброс, только при достаточном числе заданий', () => {
  const evs = rich(), sec1 = sectionOf(overview(evs), 'logic'), idx = logicIndexNow(runsOf(evs), NOW), t = tilesOf(overview(evs), 'logic');
  assert.ok(idx && !sec1.empty);
  assert.deepEqual([t['logic.index'].value, t['logic.range'].value, t['logic.items'].value], [String(idx.index), `${idx.lo}–${idx.hi}`, String(idx.items)]);
  assert.match(t['logic.index'].hint, /не IQ и не диагноз/); assert.match(t['logic.index'].label, /^Условный индекс/);
  const runOf = n => makeRunEvent(makeRun({ mode: 'single', startedAt: NOW, durationMs: 1000, results: { matrices: { metrics: { n, correct: 4, accuracy: 0.66, meanMs: 5000, score: 5, maxScore: 8 }, ms: 1, trials: [] } } }), NOW);
  assert.equal(sectionOf(overview([runOf(5)]), 'logic').empty, true, 'пять заданий — мало (проверка недостоверна), индекса нет, раздел говорит об этом');
  assert.equal(sectionOf(overview([runOf(6)]), 'logic').empty, false, 'шесть заданий — минимум');
  assert.equal(sectionOf(overview([ev('testrun', { tests: { reaction: { metrics: { n: 8, median: 300, mean: 300, sd: 1, best: 290, lapses: 0, falseStarts: 0 }, ok: true } }, startedAt: NOW, date: TODAY })]), 'logic').empty, true, 'без тестов на логику индекса нет');
});

test('«Дом»: вещи (проданные не считаются), надевания и стирки за период, ждут стирки', () => {
  const evs = rich(), m = tilesOf(overview(evs, 'month'), 'home'), a = tilesOf(overview(evs, 'all'), 'home');
  assert.deepEqual([m['home.items'].value, m['home.wears'].value, m['home.washes'].value], ['2', '4', '1']);
  assert.equal(a['home.wears'].value, '5', 'за всё время и октябрьское надевание');
  assert.equal(m['home.laundry'].value, String(Hm.laundryOf(Hm.homeModel(evs, TODAY)).due.length));
  assert.equal(m['home.wears'].label, 'Надеваний за ноябрь');
  assert.equal(sectionOf(overview([Hm.makeLog('item:нет', 'wear', {}, NOW)]), 'home').empty, true, 'отметки без вещей — раздел пуст');
});

test('«Работа и зарплата»: смены месяца и отмеченные часы; начислено — тем же расчётом, что на экране «Зарплата», и скрываемо', () => {
  const evs = rich(), t = tilesOf(overview(evs), 'work');
  assert.deepEqual([t['work.days'].value, t['work.days'].hint, t['work.hours'].value, t['work.plan'].value, t['work.plan'].hint], ['21', 'осталось: 10', '0 мин', '168 ч', 'норма месяца: 168 ч']);
  const cfg = S.cfgOf(evs), pay = Pay.payOf(evs), d = new Date(NOW);
  const res = Pay.computeMonth({ ym: '2026-11', cfg, pay, days: S.workdaysOf(evs), today: TODAY, nowMin: d.getHours() * 60 + d.getMinutes(), extras: [], prior: new Map() });
  assert.deepEqual([t['work.pay.accrued'].value, t['work.pay.net'].value, t['work.pay.month'].value], [Pay.fmtMoney(res.accrued.gross), Pay.fmtMoney(res.accrued.net), Pay.fmtMoney(res.month.net)].map(s => s.replace('₽', '₽')));
  for (const k of ['work.pay.accrued', 'work.pay.net', 'work.pay.month']) assert.equal(t[k].private, true, k);
  const noPay = sectionOf(overview(evs.filter(e => e.type !== 'paycfg')), 'work');
  assert.deepEqual(noPay.tiles.map(x => x.key), ['work.days', 'work.hours', 'work.plan'], 'без настроек зарплаты — только график');
  assert.equal(sectionOf(overview(evs.filter(e => e.type !== 'workcfg')), 'work').empty, true, 'без графика — раздел пуст');
  const worked = [...evs, ev('workday', { date: day(-1), kind: 'work', actual: { from: '09:00', to: '17:30' }, breakMin: 30 }, when(-1), 'wd:' + day(-1))];
  assert.deepEqual([tilesOf(overview(worked), 'work')['work.hours'].value, tilesOf(overview(worked), 'work')['work.hours'].hint], ['8 ч', 'дней с отметкой: 1']);
});

test('календарные подписи не зависят от режима «Скрывать суммы»: числа без денег открыты, суммы помечены private', () => {
  const list = overview(rich());
  for (const s of list) for (const t of s.tiles) if (/₽|\$|€/.test(t.value)) assert.equal(t.private, true, `${s.id}/${t.key}: сумма без пометки private`);
});

// ============================================================ часовой пояс, порядок, неизменность ============================================================

test('часовой пояс не ломает дни: запись в 00:30 и в 23:30 местного времени лежит в своём дне во всех поясах', () => {
  for (const zone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Berlin', 'Asia/Kolkata']) {
    withTz(zone, () => {
      const now = at(2026, 11, 17), evs = [ev('note', {}, at(2026, 11, 10, 0, 30), 'a'), ev('note', {}, at(2026, 11, 10, 23, 30), 'b'), ev('note', {}, at(2026, 11, 11, 0, 5), 'c')];
      const cal = activityByDay(evs, now), cells = new Map(cal.weeks.flat().map(c => [c.date, c.count]));
      assert.deepEqual([cells.get('2026-11-09'), cells.get('2026-11-10'), cells.get('2026-11-11')], [0, 2, 1], zone);
      const f = appFacts(evs, now);
      assert.deepEqual([f.first, f.activeDays, f.best], ['2026-11-10', 2, 2], zone);
      assert.equal(periodRange('week', now).from, '2026-11-11', zone);
    });
  }
});

test('переход на летнее время: дни подряд остаются подряд, в календаре нет пропусков и повторов', () => {
  for (const [zone, from, y, m, d0] of [['Europe/Berlin', '2026-03-29', 2026, 3, 27], ['Europe/Berlin', '2026-10-25', 2026, 10, 23], ['America/Los_Angeles', '2026-03-08', 2026, 3, 6], ['America/Los_Angeles', '2026-11-01', 2026, 10, 30]]) {
    withTz(zone, () => {
      const evs = Array.from({ length: 5 }, (_, i) => ev('note', {}, at(y, m, d0 + i), `d${i}`)), now = at(y, m, d0 + 5);
      assert.equal(appFacts(evs, now).best, 5, `${zone} ${from}: пять дней подряд`);
      const cal = activityByDay(evs, now, 4), dates = cal.weeks.flat().map(c => c.date);
      assert.equal(new Set(dates).size, dates.length, `${zone}: даты не повторяются`);
      for (let i = 1; i < dates.length; i++) assert.equal(E.daysBetween(dates[i - 1], dates[i]), 1, `${zone}: ${dates[i - 1]} → ${dates[i]}`);
      assert.equal(cal.activeDays, 5, zone);
      assert.equal(periodRange('week', now).days, 7, zone);
    });
  }
});

test('детерминизм: порядок записей на входе не влияет ни на один результат', () => {
  const evs = rich(), base = { s: ['week', 'month', 'all'].map(k => overview(evs, k)), a: activityByDay(evs, NOW), f: appFacts(evs, NOW) };
  for (const seed of [1, 7, 42, 2026, 99991]) {
    const mixed = makeRng(seed).shuffle(evs);
    assert.notDeepEqual(mixed.map(e => e.id), evs.map(e => e.id), 'порядок действительно изменился');
    assert.deepEqual(['week', 'month', 'all'].map(k => overview(mixed, k)), base.s, `seed ${seed}`);
    assert.deepEqual(activityByDay(mixed, NOW), base.a); assert.deepEqual(appFacts(mixed, NOW), base.f);
    assert.equal(shareText(overview(mixed), periodRange('month', NOW)), shareText(base.s[1], periodRange('month', NOW)));
  }
  assert.deepEqual(overview(evs, 'month'), overview(evs, 'month'), 'повторный вызов даёт то же');
});

test('вход не меняется: замороженные записи и массив проходят без ошибок, порядок и содержимое прежние', () => {
  const evs = rich(), ids = evs.map(e => e.id), json = JSON.stringify(evs);
  deepFreeze(evs);
  for (const k of ['week', 'month', 'all']) overview(evs, k);
  activityByDay(evs, NOW); appFacts(evs, NOW);
  shareText(overview(evs), periodRange('month', NOW));
  assert.deepEqual(evs.map(e => e.id), ids); assert.equal(JSON.stringify(evs), json);
});

// ============================================================ ломаные записи, расширение ============================================================

test('ломаные записи (нет полезной нагрузки, пустые поля) не роняют экран; записи с невозможным временем не попадают в дни', () => {
  const broken = [null, undefined, 5, 'x', {}, { type: 'task' }, { type: 'task', payload: null }, ev('task', {}), ev('habit', {}), ev('habit_log', {}), ev('workout', {}), ev('item', { name: 5 }), ev('itemlog', {}), ev('testrun', { tests: 5 }), ev('measure', {}),
    ev('checkin', {}), ev('srs', {}), ev('diction', {}), ev('lesson', {}), ev('goal', {}), ev('expense', {}), ev('workday', {}), ev('workcfg', {}), ev('paycfg', {}), ev('paymonth', {})];
  const badTime = ['вчера', -5, 0, 1e18, NaN, Infinity, 1].map((ts, i) => ev('note', {}, ts, `bad${i}`));
  let list;
  assert.doesNotThrow(() => { for (const k of ['all', 'week', 'month']) list = overview([...broken, ...badTime], k); activityByDay(broken, NOW); appFacts(broken, NOW); shareText(list, periodRange('all', NOW)); });
  assert.equal(list.length, SECTIONS.length);
  const f = appFacts(badTime, NOW);
  assert.deepEqual([f.first, f.activeDays, f.streak, f.daysWith, f.total], [null, 0, 0, 0, 7], 'время вне разумного не даёт ни дней, ни серий; сами записи в общем числе остаются');
  assert.equal(activityByDay(badTime, NOW).total, 0);
  assert.equal(appFacts([...badTime, E.makeTask('Нормальное', NOW)], NOW).daysWith, 1);
  assert.equal(sectionOf(overview([...broken, ...badTime, E.makeTask('Нормальное', NOW)]), 'tasks').empty, false, 'одна нормальная запись среди мусора считается');
});

test('новый раздел добавляется одной записью в SECTIONS; сбой в одном разделе не ломает остальные', () => {
  const before = SECTIONS.length;
  SECTIONS.push(sec('probe', { title: 'Проба', icon: 'star', screen: 'today', has: c => c.of('note').length > 0, tiles: c => [{ key: 'probe.n', label: 'Заметок', value: String(c.of('note').length), share: true }], emptyText: 'Пока нет заметок для пробы.', emptyAction: 'Открыть' }),
    sec('boom', { title: 'Сбой', icon: 'star', screen: 'today', tiles: () => { throw new Error('странная запись'); } }));
  try {
    const list = overview([ev('note', { text: 'а' })]);
    assert.deepEqual(list.slice(-2).map(s => s.id), ['probe', 'boom']);
    assert.deepEqual(list.at(-2).tiles, [{ key: 'probe.n', label: 'Заметок', value: '1', share: true }]);
    assert.deepEqual([list.at(-1).empty, list.at(-1).failed, list.at(-1).tiles], [true, true, []]);
    assert.match(shareText(list, periodRange('month', NOW)), /Проба: заметок 1/, 'итог подхватывает плитки нового раздела с пометкой share');
    assert.equal(overview([]).at(-2).empty, true);
  } finally { SECTIONS.length = before; }
  assert.equal(SECTIONS.length, before);
});

// ============================================================ тон: только числа ============================================================

test('тон: ни оценок «хорошо/плохо», ни советов, ни диагнозов, ни сравнения с другими людьми', () => {
  const texts = [];
  for (const list of [overview(rich(), 'month'), overview(rich(), 'week'), overview(rich(), 'all'), overview([])]) for (const s of list) texts.push(s.title, s.emptyText, s.emptyAction, ...s.tiles.flatMap(t => [t.label, t.value, t.hint ?? '']));
  texts.push(activityText(activityByDay(rich(), NOW)), shareText(overview(rich()), periodRange('month', NOW)));
  const judging = /хорош|плох|отличн|ужасн|молодец|слаб|опасн|(?<!не )диагноз|лечени|рекоменду|советуем|стоит|должен|нужно срочно|тревог/i;           // «не диагноз» — честная оговорка, её можно
  const others = /других людей|других пользовател|большинств|средн(ий|яя|его) человек|по сравнению с другими|лучше, чем у/i;
  for (const t of texts) { assert.ok(!judging.test(t), `оценка в тексте: «${t}»`); assert.ok(!others.test(t), `сравнение с другими: «${t}»`); }
  assert.ok(texts.every(t => !/undefined|null|NaN|\[object/.test(t)), 'служебного мусора в тексте нет');
});

// ============================================================ календарь активности ============================================================

test('календарь: 26 недель с понедельника, последняя неделя — текущая, дни после сегодня помечены future', () => {
  const evs = [ev('note', {}, when(0), 'a'), ev('note', {}, when(-1), 'b')];
  const cal = activityByDay(evs, NOW);
  assert.equal(cal.weeks.length, 26); assert.ok(cal.weeks.every(w => w.length === 7));
  assert.equal(cal.to, TODAY);
  assert.equal(new Date(...cal.from.split('-').map((x, i) => (i === 1 ? x - 1 : x)), 12).getDay(), 1, 'первая клетка — понедельник');
  const last = cal.weeks.at(-1);                                                                         // 17 ноября 2026 — вторник
  assert.deepEqual(last.map(c => c.future), [false, false, true, true, true, true, true]);
  assert.deepEqual(last.map(c => c.date), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  assert.equal(E.daysBetween(cal.from, '2026-11-16'), 25 * 7, 'ровно 26 недель');
  assert.equal(cal.days, 25 * 7 + 2);
  assert.deepEqual([cal.total, cal.activeDays], [2, 2]);
  assert.ok(cal.weeks.flat().filter(c => c.future).every(c => c.count === 0 && c.level === 0));
  const four = activityByDay(evs, NOW, 4);
  assert.equal(four.weeks.length, 4);
  for (const bad of [0, -3, 105, 2.5, 'x', null, undefined]) assert.equal(activityByDay(evs, NOW, bad).weeks.length, 26, `weeks=${bad}`);
});

test('календарь: уровни по числу записей (1, 2–3, 4–7, 8 и больше) и подписи уровней', () => {
  assert.deepEqual(ACTIVITY_LEVELS.map(l => l[0]), [0, 1, 2, 3, 4]);
  const evs = [];
  [[-1, 1], [-2, 2], [-3, 3], [-4, 4], [-5, 7], [-6, 8], [-7, 30]].forEach(([n, c]) => { for (let i = 0; i < c; i++) evs.push(ev('note', {}, when(n) + i, `x${n}-${i}`)); });
  const cells = new Map(activityByDay(evs, NOW).weeks.flat().map(c => [c.date, c]));
  assert.deepEqual([-1, -2, -3, -4, -5, -6, -7].map(n => cells.get(day(n)).level), [1, 2, 2, 3, 3, 4, 4]);
  assert.equal(cells.get(day(-8)).level, 0);
});

test('календарь словами: сводка, самый насыщенный день (при равенстве — более ранний), строки по неделям', () => {
  const evs = [];
  [[-20, 5], [-9, 5], [-2, 2], [0, 1]].forEach(([n, c]) => { for (let i = 0; i < c; i++) evs.push(ev('note', {}, when(n) + i, `y${n}-${i}`)); });
  const cal = activityByDay(evs, NOW);
  assert.deepEqual(cal.busiest, { date: day(-20), count: 5 }, 'при равенстве выбирается более ранний день');
  assert.equal(cal.from, '2026-05-25');
  assert.equal(activityText(cal), `За 26 недель (25 мая – 17 ноября) активных дней: 4 из ${cal.days}, всего 13 записей. Больше всего записей было 28 октября: 5.`);
  const weeks = activityWeeks(cal);
  assert.equal(weeks.length, 26); assert.equal(weeks[0].text, '16–17 ноября', 'новые недели первыми, неполная текущая — только до сегодня');
  assert.deepEqual([weeks[0].count, weeks[0].active], [1, 1]);
  assert.deepEqual([weeks[1].text, weeks[1].count, weeks[1].active], ['9–15 ноября', 2, 1], 'воскресенье 15 ноября — ещё прошлая неделя');
  assert.equal(weeks.reduce((s, w) => s + w.count, 0), cal.total); assert.equal(weeks.reduce((s, w) => s + w.active, 0), cal.activeDays);
  assert.match(activityText(activityByDay([ev('note', {}, NOW)], NOW, 1)), /^За 1 неделю \(16–17 ноября\) активных дней: 1 из 2, всего 1 запись\./);
});

// ============================================================ итог «Поделиться» ============================================================

test('итог «Поделиться»: по строке на раздел, только числа с пометкой share, без денег, здоровья и названий', () => {
  const evs = rich(), txt = shareText(overview(evs, 'month'), periodRange('month', NOW));
  const lines = txt.split('\n');
  assert.equal(lines[0], `Мои итоги в приложении «${APP_NAME}» (1–17 ноября)`);
  assert.ok(lines.length >= 6 && lines.length <= 12, `коротко: ${lines.length} строк`);
  assert.match(txt, /Приложение: дней с первой записи \d+, активных дней \d+, дней подряд сейчас \d+/);
  assert.match(txt, /Дела: сделано за ноябрь 3/);
  assert.match(txt, /Тренировки: тренировок за ноябрь 2/);
  assert.ok(!/кг|₽|сон|настроен|вес|Зарядка|Чтение|Куртка|Анна|зарплат/i.test(txt), `в итоге нет личного: ${txt}`);
  assert.equal(shareText(overview(evs, 'all'), periodRange('all', NOW)).split('\n')[0], `Мои итоги в приложении «${APP_NAME}»`, 'за всё время период в скобках не пишется');
  assert.equal(shareText([], periodRange('month', NOW)), '');
});

test('числа читаются удобно: тысячи с неразрывным пробелом; плитки одинаково устроены', () => {
  const evs = Array.from({ length: 1234 }, (_, i) => E.completeTask(E.makeTask(`д${i}`, when(-1) + i), when(0) + i).updated);
  const t = tilesOf(overview(evs), 'tasks');
  assert.equal(t['tasks.done'].value, '1 234');
  for (const s of overview(rich())) for (const x of s.tiles) {
    assert.deepEqual(Object.keys(x).filter(k => !['key', 'label', 'value', 'hint', 'share', 'private', 'minor'].includes(k)), [], `${x.key}: лишние поля`);
    assert.ok(x.key && x.label && typeof x.value === 'string' && x.value.length > 0, x.key);
  }
  const keys = overview(rich()).flatMap(s => s.tiles.map(t => t.key));
  assert.equal(new Set(keys).size, keys.length, 'ключи плиток не повторяются');
});

// ============================================================ скорость ============================================================

test('скорость: 50 000 записей считаются за разумное время', () => {
  const evs = [];
  for (let i = 0; i < 50000; i++) {
    const n = -(i % 400), t = when(n) + (i % 1000);
    evs.push(i % 5 === 0 ? ev('expense', { amountMinor: 100 + (i % 900), currency: 'RUB', category: 'Еда', note: '', date: day(n) }, t, `e${i}`)
      : i % 5 === 1 ? ev('habit_log', { habitId: `h${i % 7}`, date: day(n), level: 'full' }, t, `hl${i}`)
        : i % 5 === 2 ? ev('task', { text: 'д', done: i % 2 === 0, doneAt: i % 2 === 0 ? t : null, due: day(n), repeat: null, priority: 'normal' }, t, `t${i}`)
          : ev('note', { text: 'н' }, t, `n${i}`));
  }
  const t0 = performance.now();
  const list = overview(evs, 'all'), cal = activityByDay(evs, NOW);
  const ms = performance.now() - t0;
  assert.ok(ms < 5000, `слишком долго: ${Math.round(ms)} мс`);
  assert.equal(list.length, SECTIONS.length); assert.equal(cal.total > 0, true);
});
