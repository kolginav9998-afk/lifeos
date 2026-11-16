// График работы: смены, рабочие дни, норма часов, предупреждения об отдыхе. Чистая логика: без интерфейса и хранилища.
// Даты — локальные строки 'YYYY-MM-DD', время — 'HH:MM'. Смена через полночь относится ко дню начала.
// Запись workcfg (одна, id 'workcfg') — рисунок графика, типы смен, норма и доп. выходные; запись workday (id 'wd:<дата>') — правка одного дня:
// тип дня, смена, плановое и фактическое время. Поле payload.kind (а не type): ключ type в этом коде занят типом записи.
import { isYmd, addDays, daysBetween } from './events.js';

export const WORKCFG_ID = 'workcfg';
export const wdId = date => `wd:${date}`;
export const DAY_KINDS = { work: 'Рабочий день', off: 'Выходной', vacation: 'Отпуск', sick: 'Больничный', unpaid: 'За свой счёт' };
const SHORT = { work: 'раб', off: 'вых', vacation: 'отп', sick: 'бол', unpaid: 'б/с' };
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WEEKDAYS_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const COLORS = 6;
const pad = n => String(n).padStart(2, '0');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const intIn = (v, lo, hi, dflt) => (Number.isInteger(Number(v)) && v !== '' && v !== null && Number(v) >= lo && Number(v) <= hi ? Number(v) : dflt);
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);

// ---------- время и даты ----------
export const toMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()); if (!m) return null; const h = +m[1], mi = +m[2]; return h < 24 && mi < 60 ? h * 60 + mi : null; };
export const fmtTime = min => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
export const normTime = s => { const m = toMin(s); return m === null ? null : fmtTime(m); };
// Длина от начала до конца с переходом через полночь; одинаковое время — целые сутки (смена «сутки»).
export function spanMin(from, to) { const a = toMin(from), b = toMin(to); if (a === null || b === null) return 0; const d = b - a; return d > 0 ? d : d + 1440; }
export const netMin = (from, to, breakMin = 0) => Math.max(0, spanMin(from, to) - (breakMin || 0));
export function fmtDur(min) { const m = Math.max(0, Math.round(Number(min) || 0)), h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h} ч ${r} мин` : `${h} ч`) : `${r} мин`; }
export const hhmm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
// Минуты внутри «ночного» окна (по умолчанию 22:00–06:00) для интервала from–to.
export function nightMinutes(from, to, win = ['22:00', '06:00']) {
  const a = toMin(from), n = spanMin(from, to), w0 = toMin(win[0]), w1 = toMin(win[1]);
  if (a === null || !n || w0 === null || w1 === null) return 0;
  let c = 0;
  for (let i = 0; i < n; i++) { const t = (a + i) % 1440; if (w0 > w1 ? (t >= w0 || t < w1) : (t >= w0 && t < w1)) c++; }
  return c;
}
export const isYm = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));
export const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const dowMon = date => { const [y, m, d] = date.split('-').map(Number); return (new Date(y, m - 1, d, 12).getDay() + 6) % 7; };   // 0 = понедельник
export const dayMonthText = date => { const [, m, d] = date.split('-').map(Number); return `${d} ${MONTHS_GEN[m - 1]}`; };
export const dateLong = date => `${WEEKDAYS_LONG[dowMon(date)]}, ${dayMonthText(date)} ${date.slice(0, 4)}`;
export function shiftYm(ym, delta) { const [y, m] = ym.split('-').map(Number), t = y * 12 + (m - 1) + delta; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; }

// ---------- настройки графика ----------
function cleanShift(s) {
  if (!s || typeof s !== 'object') return null;
  const key = String(s.key ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 8), name = String(s.name ?? '').trim().slice(0, 30);
  if (!key || !name) return null;
  const off = !!s.off, from = normTime(s.from), to = normTime(s.to);
  if (!off && (!from || !to)) return null;
  const span = off ? 0 : spanMin(from, to), bm = Number(s.breakMin);
  return { key, name, letter: (String(s.letter ?? '').trim() || name.slice(0, 1)).slice(0, 2).toUpperCase(), from: off ? '' : from, to: off ? '' : to,
    breakMin: off || !Number.isFinite(bm) ? 0 : clamp(Math.round(bm), 0, Math.min(600, span)), color: intIn(s.color, 1, COLORS, 1), night: !off && !!s.night, off };
}
function cleanPattern(p, keys) {
  if (p?.kind === 'cycle') {
    const cycle = (Array.isArray(p.cycle) ? p.cycle : []).slice(0, 60).map(k => (keys.has(k) ? k : ''));
    return { kind: 'cycle', cycle: cycle.length ? cycle : [''], start: isYmd(p.start) ? p.start : '2024-01-01' };
  }
  return { kind: 'week', week: Array.from({ length: 7 }, (_, i) => { const k = Array.isArray(p?.week) ? p.week[i] : ''; return keys.has(k) ? k : ''; }) };
}
// Читает и приводит в порядок настройки (в том числе чужие или повреждённые): лишнее отбрасывается, числа ограничиваются.
export function normalizeCfg(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const shifts = (Array.isArray(r.shifts) ? r.shifts : []).map(cleanShift).filter(Boolean).filter((s, i, a) => a.findIndex(x => x.key === s.key) === i).slice(0, 12);
  const keys = new Set(shifts.map(s => s.key)), nh = Number(r.normHours), okNh = r.normHours !== '' && r.normHours !== null && Number.isFinite(nh) && nh >= 0 && nh <= 744;
  const normByMonth = {};
  if (r.normByMonth && typeof r.normByMonth === 'object') for (const [k, v] of Object.entries(r.normByMonth)) if (isYm(k) && v !== '' && v !== null && Number.isFinite(Number(v)) && v >= 0 && v <= 744) normByMonth[k] = Math.round(v * 4) / 4;
  return { pattern: cleanPattern(r.pattern, keys), shifts, normMode: r.normMode === 'manual' && okNh ? 'manual' : 'auto', normHours: okNh ? Math.round(nh * 4) / 4 : 0, normByMonth,
    extraOff: [...new Set((Array.isArray(r.extraOff) ? r.extraOff : []).filter(isYmd))].sort().slice(0, 400), maxStreak: intIn(r.maxStreak, 2, 14, 6), minRestH: intIn(r.minRestH, 0, 24, 11), tplId: String(r.tplId ?? '').slice(0, 12) };
}
// Проверка того, что ввёл человек (понятные сообщения); normalizeCfg потом приводит всё к единому виду.
export function checkCfg(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Нет настроек графика');
  const shifts = Array.isArray(raw.shifts) ? raw.shifts : [];
  if (!shifts.length || shifts.length > 12) throw new Error('Нужна хотя бы одна смена (не больше 12)');
  const seen = new Set();
  for (const s of shifts) {
    if (!String(s?.name ?? '').trim()) throw new Error('Назови каждую смену');
    if (!cleanShift({ ...s, key: s.key || 'x' })) throw new Error(`Смена «${s.name}»: время указано неверно, пример 09:00`);
    const k = String(s.key ?? ''); if (seen.has(k)) throw new Error('Названия типов смен не должны повторяться'); seen.add(k);
    if (!s.off && Number(s.breakMin) > spanMin(s.from, s.to)) throw new Error(`Смена «${s.name}»: перерыв длиннее смены`);
  }
  const p = raw.pattern;
  if (p?.kind === 'cycle') {
    if (!Array.isArray(p.cycle) || !p.cycle.length || p.cycle.length > 60) throw new Error('В цикле должен быть хотя бы один день');
    if (!isYmd(p.start)) throw new Error('Дата первого дня цикла указана неверно');
  } else if (p?.kind !== 'week' || !Array.isArray(p.week) || p.week.length !== 7) throw new Error('Не выбран рисунок графика');
  return true;
}
export function makeWorkcfg(raw, prev = null, now = Date.now()) {
  checkCfg(raw);
  return { id: WORKCFG_ID, type: 'workcfg', ts: prev?.ts ?? now, payload: { ...normalizeCfg(raw), ...(prev ? { editedAt: now } : {}) }, source: 'manual', confidence: 1, evidence: [] };
}
export const cfgOf = events => { const e = events.find(x => x.type === 'workcfg' && x.id === WORKCFG_ID); return e ? normalizeCfg(e.payload) : null; };
export const cfgEvent = events => events.find(x => x.type === 'workcfg' && x.id === WORKCFG_ID) ?? null;

// ---------- готовые графики ----------
const D = (o = {}) => ({ key: 'd', name: 'День', letter: 'Д', from: '09:00', to: '18:00', breakMin: 60, color: 1, night: false, off: false, ...o });
const D12 = D({ from: '08:00', to: '20:00' });
const NIGHT = { key: 'n', name: 'Ночь', letter: 'Н', from: '20:00', to: '08:00', breakMin: 60, color: 2, night: true, off: false };
const SUTKI = { key: 's', name: 'Сутки', letter: 'С', from: '08:00', to: '08:00', breakMin: 0, color: 3, night: true, off: false };
const REST = { key: 'r', name: 'Отсыпной', letter: 'О', from: '', to: '', breakMin: 0, color: 4, night: false, off: true };
const wk = (...days) => ({ kind: 'week', week: Array.from({ length: 7 }, (_, i) => (days.includes(i) ? 'd' : '')) });
const cy = (...steps) => ({ kind: 'cycle', cycle: steps.map(s => (s === '-' ? '' : s)), start: '' });
export const TEMPLATES = [
  { tid: 'w52', title: '5 через 2 (Пн–Пт)', about: 'Пять рабочих дней в неделю, выходные суббота и воскресенье', pattern: wk(0, 1, 2, 3, 4), shifts: [D()] },
  { tid: 'w61', title: '6 через 1 (Пн–Сб)', about: 'Шесть рабочих дней, выходной воскресенье', pattern: wk(0, 1, 2, 3, 4, 5), shifts: [D()] },
  { tid: 'c22', title: '2 через 2', about: 'Два дня работа, два дня выходных, смена 12 часов', pattern: cy('d', 'd', '-', '-'), shifts: [D12] },
  { tid: 'c33', title: '3 через 3', about: 'Три дня работа, три дня выходных, смена 12 часов', pattern: cy('d', 'd', 'd', '-', '-', '-'), shifts: [D12] },
  { tid: 'c13', title: 'Сутки через трое', about: 'Смена 24 часа, потом три дня отдыха', pattern: cy('s', '-', '-', '-'), shifts: [SUTKI] },
  { tid: 'c12', title: 'Сутки через двое', about: 'Смена 24 часа, потом два дня отдыха', pattern: cy('s', '-', '-'), shifts: [SUTKI] },
  { tid: 'cdn', title: 'День, ночь, отсыпной, выходной', about: 'Цикл из четырёх дней: дневная смена, ночная, день после ночи, свободный день', pattern: cy('d', 'n', 'r', '-'), shifts: [D12, NIGHT, REST] },
  { tid: 'wcu', title: 'По дням недели', about: 'Сам отметишь рабочие дни недели, например понедельник, среда и пятница', pattern: wk(0, 2, 4), shifts: [D()] },
  { tid: 'cus', title: 'Свой цикл', about: 'Сам выберешь, в каком порядке идут смены и выходные', pattern: cy('d', 'd', '-'), shifts: [D()] },
];
export const templateById = tid => TEMPLATES.find(t => t.tid === tid) ?? null;
// Настройки из шаблона: у цикла дата начала — переданная (по умолчанию сегодня); прежние норма, выходные и пределы сохраняются.
export function cfgFromTemplate(tid, start, prev = null) {
  const t = templateById(tid) ?? TEMPLATES[0], base = prev ? normalizeCfg(prev) : normalizeCfg({});
  const pattern = t.pattern.kind === 'cycle' ? { ...t.pattern, cycle: [...t.pattern.cycle], start } : { ...t.pattern, week: [...t.pattern.week] };
  return { ...base, pattern, shifts: t.shifts.map(s => ({ ...s })), tplId: t.tid };
}
export const shiftOf = (cfg, key) => cfg.shifts.find(s => s.key === key) ?? null;
export function patternText(cfg) {
  const p = cfg.pattern, t = templateById(cfg.tplId);
  if (t && t.tid !== 'cus') return t.title;
  if (p.kind === 'week') return `По дням недели: рабочих ${p.week.filter(Boolean).length} из 7`;
  return `Свой цикл из ${p.cycle.length} дн.`;
}
export const cycleLetters = cfg => (cfg.pattern.kind === 'cycle' ? cfg.pattern.cycle.map(k => shiftOf(cfg, k)?.letter ?? 'В') : cfg.pattern.week.map(k => shiftOf(cfg, k)?.letter ?? 'В'));

// ---------- план дня ----------
function baseKey(date, cfg) {
  if (cfg.extraOff.includes(date)) return '';
  const p = cfg.pattern;
  if (p.kind === 'week') return p.week[dowMon(date)] || '';
  const n = p.cycle.length;
  return p.cycle[(((daysBetween(p.start, date) % n) + n) % n)] || '';
}
const hasTimes = o => o && toMin(o.from) !== null && toMin(o.to) !== null;
// Что на этот день: по рисунку графика, с учётом правки (workday: payload). Всё выводится из настроек, ничего не хранится заранее.
export function dayPlan(date, cfg, ov = null) {
  const holiday = cfg.extraOff.includes(date), sh0 = shiftOf(cfg, baseKey(date, cfg)), works0 = !!sh0 && !sh0.off;
  const patternMin = works0 ? netMin(sh0.from, sh0.to, sh0.breakMin) : 0;
  let kind = works0 ? 'work' : 'off', sh = sh0, from = works0 ? sh0.from : null, to = works0 ? sh0.to : null, brk = sh0?.breakMin ?? 0;
  const over = !!ov && !!DAY_KINDS[ov.kind];
  if (over) {
    kind = ov.kind;
    if (kind === 'work') {
      const s = shiftOf(cfg, ov.shift);
      sh = s && !s.off ? s : (works0 ? sh0 : null); from = sh?.from ?? null; to = sh?.to ?? null; brk = sh?.breakMin ?? 0;
      if (hasTimes(ov.planned)) { from = normTime(ov.planned.from); to = normTime(ov.planned.to); }
    } else { sh = kind === 'off' && sh0?.off ? sh0 : null; from = to = null; brk = 0; }
    if (ov.breakMin !== undefined && ov.breakMin !== null && Number.isFinite(Number(ov.breakMin))) brk = clamp(Math.round(Number(ov.breakMin)), 0, 600);
  }
  const plannedMin = kind === 'work' && from && to ? netMin(from, to, brk) : 0;
  const af = normTime(ov?.actual?.from), at = normTime(ov?.actual?.to);
  const actual = (kind === 'work' || kind === 'off') && af ? { from: af, to: at } : null;
  return { date, kind, key: sh?.key ?? '', label: sh?.name ?? DAY_KINDS[kind], letter: sh?.letter ?? SHORT[kind] ?? '', color: sh?.color ?? 0, night: !!sh?.night, from, to, breakMin: brk,
    plannedMin, patternMin, actual, actualMin: actual?.to ? netMin(af, at, brk) : null, running: !!actual && !actual.to, overridden: over || !!actual, holiday, note: String(ov?.note ?? '') };
}
export const workdaysOf = events => { const m = new Map(); for (const e of events) if (e.type === 'workday' && isYmd(e.payload?.date)) m.set(e.payload.date, e.payload); return m; };
export function monthDays(ym, cfg, ov = new Map()) { const out = []; for (let d = 1, n = daysIn(ym); d <= n; d++) { const date = `${ym}-${pad(d)}`; out.push(dayPlan(date, cfg, ov.get(date))); } return out; }
// Сетка месяца по неделям (с понедельника): пустые клетки — null.
export function monthGrid(ym, cfg, ov = new Map()) {
  const days = monthDays(ym, cfg, ov), lead = dowMon(`${ym}-01`), cells = [...Array(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
// Норма месяца в минутах: правка для месяца → общее число вручную → по рисунку графика (без правок отдельных дней, с учётом праздников).
export function normMinutes(ym, cfg) {
  if (cfg.normByMonth[ym] !== undefined) return Math.round(cfg.normByMonth[ym] * 60);
  if (cfg.normMode === 'manual') return Math.round(cfg.normHours * 60);
  return sum(monthDays(ym, cfg), d => d.patternMin);
}
export function monthSummary(ym, cfg, ov, today) {
  const days = monthDays(ym, cfg, ov), work = days.filter(d => d.kind === 'work' && d.plannedMin > 0), cnt = k => days.filter(d => d.kind === k).length;
  const rec = days.filter(d => d.actualMin !== null);
  return { ym, days, workdays: work.length, plannedMin: sum(days, d => d.plannedMin), patternMin: sum(days, d => d.patternMin), normMin: normMinutes(ym, cfg), actualMin: sum(rec, d => d.actualMin), recorded: rec.length,
    off: cnt('off'), vacation: cnt('vacation'), sick: cnt('sick'), unpaid: cnt('unpaid'), left: work.filter(d => d.date > today || (d.date === today && d.actualMin === null)).length };
}

// ---------- предупреждения об отдыхе ----------
// Дни подряд сверх предела и короткий отдых между сменами (по фактическому времени, а где его нет — по плановому). Возвращает только предупреждения за период from..to.
export function restWarnings(from, to, cfg, ov = new Map()) {
  const lo = addDays(from, -30), days = [];
  for (let d = lo; d <= to; d = addDays(d, 1)) days.push(dayPlan(d, cfg, ov.get(d)));
  const out = []; let run = [];
  const flush = () => { if (run.length > cfg.maxStreak && run.at(-1).date >= from) out.push({ kind: 'streak', date: run[0].date, last: run.at(-1).date, n: run.length, text: `Подряд рабочих дней: ${run.length} (с ${dayMonthText(run[0].date)} по ${dayMonthText(run.at(-1).date)}). Это больше твоего предела: ${cfg.maxStreak}.` }); run = []; };
  for (const d of days) { if (d.kind === 'work' && (d.plannedMin > 0 || d.actualMin > 0)) run.push(d); else flush(); }
  flush();
  if (cfg.minRestH > 0) {
    const iv = [];
    for (const d of days) {
      const f = d.actual?.from ?? d.from, t = d.actual?.to ?? d.to;
      if ((d.kind === 'work' || d.actual) && toMin(f) !== null && toMin(t) !== null) { const s = daysBetween(lo, d.date) * 1440 + toMin(f); iv.push({ date: d.date, s, e: s + spanMin(f, t) }); }
    }
    for (let i = 1; i < iv.length; i++) {
      const gap = iv[i].s - iv[i - 1].e;
      if (gap < cfg.minRestH * 60 && iv[i].date >= from) out.push({ kind: 'rest', date: iv[i].date, minutes: gap, text: gap < 0 ? `Смены ${dayMonthText(iv[i - 1].date)} и ${dayMonthText(iv[i].date)} пересекаются по времени.` : `Между сменами ${dayMonthText(iv[i - 1].date)} и ${dayMonthText(iv[i].date)} отдых всего ${fmtDur(gap)}: меньше ${cfg.minRestH} ч.` });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
// Ближайшие выходные (включая сегодня): выходной и отпуск.
export function nextOffDays(today, cfg, ov = new Map(), n = 3) {
  const out = [];
  for (let i = 0, d = today; i < 120 && out.length < n; i++, d = addDays(d, 1)) { const p = dayPlan(d, cfg, ov.get(d)); if (p.kind === 'off' || p.kind === 'vacation') out.push(p); }
  return out;
}

// ---------- запись дня и таймер ----------
export function makeWorkday(f, prev = null, now = Date.now()) {
  if (!f || !isYmd(f.date)) throw new Error('Дата указана неверно');
  if (!DAY_KINDS[f.kind]) throw new Error('Выбери тип дня');
  const pair = (o, what) => {
    if (!o || (!o.from && !o.to)) return null;
    const a = normTime(o.from), b = o.to ? normTime(o.to) : null;
    if (!a || (o.to && !b)) throw new Error(`${what}: время указано неверно, пример 09:00`);
    if (b && a === b) throw new Error(`${what}: начало и конец совпадают`);
    return { from: a, to: b, ...(Number.isFinite(o.startedAt) && !b ? { startedAt: o.startedAt } : {}) };
  };
  const brk = f.breakMin === '' || f.breakMin === null || f.breakMin === undefined ? null : Math.round(Number(f.breakMin));
  if (brk !== null && !(brk >= 0 && brk <= 600)) throw new Error('Перерыв: от 0 до 600 минут');
  const planned = pair(f.planned, 'План'); if (planned && !planned.to) throw new Error('План: укажи и начало, и конец');
  const payload = { date: f.date, kind: f.kind, shift: String(f.shift ?? '').slice(0, 8), planned, actual: f.kind === 'work' || f.kind === 'off' ? pair(f.actual, 'Фактически') : null, breakMin: brk, note: String(f.note ?? '').trim().slice(0, 200) };
  return { id: wdId(f.date), type: 'workday', ts: prev?.ts ?? now, payload: { ...payload, ...(prev ? { editedAt: now } : {}) }, source: 'manual', confidence: 1, evidence: [] };
}
// Запись дня, которая ничего не меняет по сравнению с графиком (её можно удалить).
export function isNoop(p, cfg) {
  const base = dayPlan(p.date, cfg, null);
  return p.kind === base.kind && !p.planned && !p.actual && !p.note && (p.breakMin === null || p.breakMin === undefined) && (!p.shift || p.shift === base.key);
}
export const workdayEvent = (events, date) => events.find(e => e.type === 'workday' && e.id === wdId(date)) ?? null;
// Идущий таймер: день, где есть начало, но нет конца.
export const runningTimer = events => events.filter(e => e.type === 'workday' && e.payload.actual?.from && !e.payload.actual.to).sort((a, b) => b.payload.date.localeCompare(a.payload.date))[0] ?? null;
export function timerStart(events, date, cfg, now = Date.now()) {
  if (runningTimer(events)) throw new Error('Таймер уже идёт');
  const prev = workdayEvent(events, date), p = prev?.payload;
  if (p?.actual?.to) throw new Error('За этот день время уже записано: измени его в дне');
  const plan = dayPlan(date, cfg, p);
  return makeWorkday({ date, kind: plan.kind === 'work' || plan.kind === 'off' ? plan.kind : 'work', shift: p?.shift ?? plan.key, planned: p?.planned, breakMin: p?.breakMin ?? null, note: p?.note, actual: { from: hhmm(now), to: null, startedAt: now } }, prev, now);
}
// Остановка: меньше минуты — случайное нажатие, ничего не записываем (actual = null). Дольше суток — просим указать конец вручную.
export function timerStop(ev, now = Date.now()) {
  const a = ev?.payload?.actual;
  if (!a?.from || a.to) throw new Error('Таймер не идёт');
  const start = Number.isFinite(a.startedAt) ? a.startedAt : null, ms = start === null ? null : now - start;
  if (ms !== null && ms > 24 * 3600000) throw new Error('Таймер шёл больше суток: укажи время окончания вручную');
  const p = ev.payload, short = ms !== null && ms < 60000;
  return { event: makeWorkday({ ...p, actual: short ? null : { from: a.from, to: hhmm(now) } }, ev, now), minutes: short ? 0 : Math.max(1, Math.round((ms ?? 60000) / 60000)), discarded: short };
}

// ---------- подписи дня (для экрана и для диктора) ----------
export function dayText(d) {
  if (d.kind === 'work') return `рабочий день${d.key ? `, смена «${d.label}»` : ''}${d.from ? ` ${d.from}–${d.to}` : ''}${d.plannedMin ? `, ${fmtDur(d.plannedMin)}` : ''}`;
  return d.kind === 'off' ? (d.key ? d.label.toLowerCase() : 'выходной') + (d.holiday ? ' (праздник или доп. выходной)' : '') : DAY_KINDS[d.kind].toLowerCase();
}
export const dayActualText = d => (d.running ? `таймер идёт с ${d.actual.from}` : d.actual ? `отмечено ${d.actual.from}–${d.actual.to}, ${fmtDur(d.actualMin)}` : '');

// ---------- для экрана «Сегодня» ----------
export function workLine(events, today) {
  const cfg = cfgOf(events);
  if (!cfg) return null;
  const d = dayPlan(today, cfg, workdaysOf(events).get(today));
  if (d.kind === 'work') return `Сегодня ${d.key ? `смена «${d.label}»` : 'рабочий день'}${d.from ? ` ${d.from}–${d.to}` : ''}${d.running ? `. Таймер идёт с ${d.actual.from}` : ''}`;
  return `Сегодня ${d.kind === 'off' ? (d.key ? d.label.toLowerCase() : 'выходной') : d.kind === 'vacation' ? 'отпуск' : d.kind === 'sick' ? 'больничный' : 'день за свой счёт'}`;
}
