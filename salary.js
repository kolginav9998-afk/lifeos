// Зарплата: оклад или ставка за час, налог, переработки по минутам, надбавки и удержания, прогноз. Чистая логика, всё считается по настройкам человека.
// Это оценка, а не бухгалтерия и не налоговая консультация. Суммы — целые минимальные единицы (копейки); ставки — в сотых долях процента (salary-tax.js).
// Запись paycfg (одна, id 'paycfg') — настройки; запись paymonth (id 'pm:<год-месяц>') — итог месяца: расчёт и то, что пришло на самом деле.
import { MAX_MINOR, monthLabel } from './money.js';
import { monthDays, normMinutes, nightMinutes, toMin, daysIn, isYm, shiftYm } from './schedule.js';
import { normalizeTax, checkTax, monthTax, presetTax } from './salary-tax.js';

export const PAYCFG_ID = 'paycfg';
export const pmId = ym => `pm:${ym}`;
export const CURRENCIES = { RUB: '₽', USD: '$', EUR: '€', ILS: '₪', UAH: '₴', KZT: '₸', BYN: 'Br', GEL: '₾' };
export const DISCLAIMER = 'Расчёт приблизительный, по твоим настройкам; это не бухгалтерия и не налоговая консультация.';
export const ROUNDING = [
  { rid: 'min', label: 'До минуты (точно)', roundMin: 1, roundDir: 'down' }, { rid: 'd5', label: 'Вниз до 5 минут', roundMin: 5, roundDir: 'down' }, { rid: 'd15', label: 'Вниз до 15 минут', roundMin: 15, roundDir: 'down' },
  { rid: 'n5', label: 'К ближайшим 5 минутам', roundMin: 5, roundDir: 'near' }, { rid: 'n15', label: 'К ближайшим 15 минутам', roundMin: 15, roundDir: 'near' },
];
export const roundingId = ot => ROUNDING.find(r => r.roundMin === ot.roundMin && r.roundDir === ot.roundDir)?.rid ?? 'min';
const LEAVE = ['vacation', 'sick', 'unpaid'];
const pad = n => String(n).padStart(2, '0');
// Сколько рабочего времени «стоит» покупка: цена делится на ставку «на руки» за час (чистый доход месяца, делённый на часы нормы месяца).
// Возвращает null, если считать нечем (нет дохода или нормы). Дни считаются по средней длине рабочего дня месяца (норма / число рабочих дней), без неё по 8 часов.
export function workCost(priceMinor, netMinor, normMin, workdays = 0) {
  const price = Number(priceMinor), net = Number(netMinor), norm = Number(normMin), wd = Number(workdays);
  if (!(price > 0) || !(net > 0) || !(norm > 0)) return null;
  const perHour = net / (norm / 60), minutes = Math.round((price / perHour) * 60), dayMin = wd > 0 ? norm / wd : 480;
  return { perHourMinor: Math.round(perHour), minutes, hours: minutes / 60, days: minutes / dayMin };
}
export const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
const num = (v, lo, hi, dflt) => (v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : dflt);
const int = (v, lo, hi, dflt) => { const n = num(v, lo, hi, null); return n !== null && Number.isInteger(n) ? n : dflt; };
const minor = v => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, MAX_MINOR) : 0);
const cap = x => Math.min(MAX_MINOR, Math.max(0, Math.round(Number.isFinite(x) ? x : 0)));

// ---------- ввод и вывод сумм ----------
export function parseMinor(input, allowZero = false) {
  const s = String(input ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Сумма: например 1250 или 1250,50');
  const [r, k = ''] = s.split('.'), m = Number(r) * 100 + Number((k + '00').slice(0, 2));
  if (!Number.isSafeInteger(m) || m > MAX_MINOR) throw new Error('Слишком большая сумма');
  if (m <= 0 && !allowZero) throw new Error('Сумма должна быть больше нуля');
  return m;
}
export function parseMult(input) {
  const t = String(input ?? '').replace(/[\s×xх]/gi, '').replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(t)) throw new Error('Коэффициент: например 2 или 1,5');
  const m = Math.round(Number(t) * 1000);
  if (m < 1000 || m > 10000) throw new Error('Коэффициент: от 1 до 10');
  return m;
}
export const fmtMult = mille => `×${String(mille / 1000).replace('.', ',')}`;
export function fmtMoney(m, cur = 'RUB') {
  const n = Math.round(Number(m) || 0), a = Math.abs(n), r = Math.trunc(a / 100), k = a % 100;
  return `${n < 0 ? '−' : ''}${String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${k ? ',' + pad(k) : ''} ${CURRENCIES[cur] ?? cur}`;
}
export const minorToInput = m => (m % 100 ? (m / 100).toFixed(2) : String(m / 100)).replace('.', ',');

// ---------- настройки зарплаты ----------
const cleanLines = (list, withWhen) => (Array.isArray(list) ? list : []).slice(0, 12).map(a => {
  const name = String(a?.name ?? '').trim().slice(0, 40), amountMinor = minor(a?.amountMinor), pctBp = int(a?.pctBp, 0, 10000, 0);
  if (!name || (!amountMinor && !pctBp)) return null;
  return { name, amountMinor: amountMinor && !pctBp ? amountMinor : 0, pctBp, ...(withWhen ? { when: a?.when === 'before' ? 'before' : 'after' } : { taxable: a?.taxable !== false }) };
}).filter(Boolean);
export function normalizePay(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}, o = r.ot && typeof r.ot === 'object' ? r.ot : {}, lp = r.leavePct && typeof r.leavePct === 'object' ? r.leavePct : {}, ad = r.advance && typeof r.advance === 'object' ? r.advance : {};
  const rnd = ROUNDING.find(x => x.roundMin === o.roundMin && x.roundDir === o.roundDir) ?? ROUNDING[0];
  return {
    mode: r.mode === 'hourly' ? 'hourly' : 'salary', baseMinor: minor(r.baseMinor), currency: Object.hasOwn(CURRENCIES, r.currency) ? r.currency : 'RUB', hourlyMinor: minor(r.hourlyMinor),
    ot: { basis: o.basis === 'month' ? 'month' : 'day', multMille: int(o.multMille, 1000, 10000, 2000), tier1Min: int(o.tier1Min, 0, 1440, 0), tier1MultMille: int(o.tier1MultMille, 1000, 10000, 1500), roundMin: rnd.roundMin, roundDir: rnd.roundDir },
    tax: normalizeTax(r.tax ?? presetTax('flat')), taxFreeMinor: minor(r.taxFreeMinor), allowances: cleanLines(r.allowances, false), deductions: cleanLines(r.deductions, true),
    leavePct: { vacation: int(lp.vacation, 0, 100, 100), sick: int(lp.sick, 0, 100, 0), unpaid: int(lp.unpaid, 0, 100, 0) }, nightPct: int(r.nightPct, 0, 100, 0),
    advance: { day: int(ad.day, 0, 31, 0), pct: int(ad.pct, 0, 100, 40) }, salaryDay: int(r.salaryDay, 0, 31, 0),
  };
}
export function checkPay(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Нет настроек зарплаты');
  if (!(Number.isSafeInteger(raw.baseMinor) && raw.baseMinor > 0 && raw.baseMinor <= MAX_MINOR)) throw new Error('Укажи оклад или ставку за час: больше нуля');
  if (!Object.hasOwn(CURRENCIES, raw.currency)) throw new Error('Выбери валюту');
  const o = raw.ot ?? {}, ad = raw.advance ?? {};
  for (const v of [o.multMille, o.tier1MultMille]) if (v !== undefined && int(v, 1000, 10000, 0) === 0) throw new Error('Коэффициент переработки: от 1 до 10');
  if (int(ad.day ?? 0, 0, 31, -1) < 0 || int(ad.pct ?? 0, 0, 100, -1) < 0) throw new Error('Аванс: день от 0 до 31, процент от 0 до 100');
  checkTax(raw.tax);
  for (const [k, lim] of [['salaryDay', 31], ['nightPct', 100]]) if (raw[k] !== undefined && int(raw[k], 0, lim, -1) < 0) throw new Error('Проверь числа: дни от 0 до 31, проценты от 0 до 100');
  for (const v of Object.values(raw.leavePct ?? {})) if (int(v, 0, 100, -1) < 0) throw new Error('Оплата отпуска и больничного: от 0 до 100 %');
  return true;
}
export function makePaycfg(raw, prev = null, now = Date.now()) {
  checkPay(raw);
  return { id: PAYCFG_ID, type: 'paycfg', ts: prev?.ts ?? now, payload: { ...normalizePay(raw), ...(prev ? { editedAt: now } : {}) }, source: 'manual', confidence: 1, evidence: [] };
}
export const payOf = events => { const e = events.find(x => x.type === 'paycfg' && x.id === PAYCFG_ID); return e ? normalizePay(e.payload) : null; };
export const payEvent = events => events.find(x => x.type === 'paycfg' && x.id === PAYCFG_ID) ?? null;

// ---------- итог месяца (что пришло на самом деле) ----------
export function makePaymonth(f, prev = null, now = Date.now()) {
  if (!isYm(f?.ym)) throw new Error('Месяц указан неверно');
  const c = f.computed ?? {}, actual = f.actualNetMinor === null || f.actualNetMinor === undefined || f.actualNetMinor === '' ? null : Number(f.actualNetMinor);
  if (actual !== null && !(Number.isSafeInteger(actual) && actual >= 0 && actual <= MAX_MINOR)) throw new Error('Сумма «пришло» указана неверно');
  const extras = (Array.isArray(f.extras) ? f.extras : []).slice(0, 12).map(x => ({ name: String(x?.name ?? '').trim().slice(0, 40), amountMinor: minor(x?.amountMinor), taxable: x?.taxable !== false })).filter(x => x.name && x.amountMinor > 0);
  const computed = { grossMinor: minor(c.grossMinor), taxMinor: minor(c.taxMinor), netMinor: minor(c.netMinor), taxableMinor: minor(c.taxableMinor), overtimeMin: int(c.overtimeMin, 0, 100000, 0), overtimeMinor: minor(c.overtimeMinor), workedMin: int(c.workedMin, 0, 100000, 0) };
  return { id: pmId(f.ym), type: 'paymonth', ts: prev?.ts ?? now, payload: { ym: f.ym, computed, actualNetMinor: actual, extras, note: String(f.note ?? '').trim().slice(0, 200), ...(prev ? { editedAt: now } : {}) }, source: 'manual', confidence: 1, evidence: [] };
}
export const paymonthsOf = events => { const m = new Map(); for (const e of events) if (e.type === 'paymonth' && isYm(e.payload?.ym)) m.set(e.payload.ym, e.payload); return m; };

// ---------- переработки ----------
const roundTo = (m, step, dir) => (step <= 1 ? m : dir === 'near' ? Math.round(m / step) * step : Math.floor(m / step) * step);
// blocks — минуты сверх плана по дням (или одно число за месяц). Возвращает минуты после округления: всего, по первой ступени и по остальным.
export function splitOvertime(blocks, ot) {
  let min = 0, t1 = 0, raw = 0;
  for (const b of blocks) {
    const m = Math.max(0, Math.round(b)), r = roundTo(m, ot.roundMin, ot.roundDir), a = ot.tier1Min > 0 ? Math.min(r, ot.tier1Min) : 0;
    raw += m; min += r; t1 += a;
  }
  return { min, t1, t2: min - t1, raw };
}
// Оплата минут: коэффициент в тысячных (2000 = ×2), ставка — дробь «сумма за период / минут в периоде».
const payFor = (m, mille, rate) => (rate.den > 0 ? Math.round(m * mille * rate.num / (1000 * rate.den)) : 0);

// ---------- расчёт месяца ----------
// pay — настройки зарплаты, cfg — график, days — правки дней (Map дата → payload), today — сегодня, nowMin — минуты от полуночи (чтобы понять, закончилась ли сегодняшняя смена),
// extras — разовые премии месяца, prior — Map «год-месяц → налогооблагаемая сумма» закрытых прошлых месяцев (для шкалы «за год»), adjust — «а что если»: { extraOvertimeMin, raisePct }.
export function computeMonth({ ym, cfg, pay, days = new Map(), today, nowMin = null, extras = [], prior = new Map(), adjust = null }) {
  const list = monthDays(ym, cfg, days), norm = normMinutes(ym, cfg), extra = Math.max(0, Math.round(adjust?.extraOvertimeMin ?? 0)), k = 1 + Math.max(0, adjust?.raisePct ?? 0) / 100;
  for (const d of list) {
    const endsToday = d.date === today && d.kind === 'work' && d.to && toMin(d.to) > toMin(d.from) && nowMin !== null && nowMin >= toMin(d.to);
    d.recorded = d.actualMin !== null;
    d.done = d.recorded || d.date < today || (d.date === today && (d.kind !== 'work' || endsToday));
    d.worked = d.recorded ? d.actualMin : (d.done && d.kind === 'work' ? d.plannedMin : 0);
    d.proj = d.done ? d.worked : (d.kind === 'work' ? d.plannedMin : 0);
  }
  const baseMinor = cap(pay.baseMinor * k), hourOver = cap(pay.hourlyMinor * k);
  const rate = pay.mode === 'hourly' ? { num: baseMinor, den: 60 } : hourOver > 0 ? { num: hourOver, den: 60 } : norm > 0 ? { num: baseMinor, den: norm } : { num: 0, den: 0 };
  const perHourMinor = rate.den ? Math.round(rate.num * 60 / rate.den) : 0, zeroNorm = norm <= 0 && pay.mode !== 'hourly';
  const patternAll = list.reduce((s, d) => s + d.patternMin, 0), patternDone = list.filter(d => d.done).reduce((s, d) => s + d.patternMin, 0);
  const share = patternAll > 0 ? patternDone / patternAll : list.filter(d => d.done).length / list.length;
  const leaveMin = list.filter(d => LEAVE.includes(d.kind)).reduce((s, d) => s + d.patternMin * (100 - pay.leavePct[d.kind]) / 100, 0);

  function calc(scope, ytd) {
    const acc = scope === 'accrued', used = list.filter(d => !acc || d.done), mins = d => (acc ? (d.done ? d.worked : 0) : d.proj), scale = acc ? share : 1;
    const workedMin = used.reduce((s, d) => s + mins(d), 0) + (acc ? 0 : extra), o = pay.ot;
    const blocks = o.basis === 'month' ? (norm > 0 ? [Math.max(0, workedMin - norm)] : []) : [...used.filter(d => d.recorded).map(d => Math.max(0, mins(d) - d.plannedMin)), ...(acc ? [] : [extra])];
    const ov = splitOvertime(blocks, o), otPay = cap(payFor(ov.t1, o.tier1MultMille, rate) + payFor(ov.t2, o.multMille, rate));
    let base;
    if (pay.mode === 'hourly') base = payFor(Math.max(0, workedMin - ov.raw), 1000, rate) + used.filter(d => LEAVE.includes(d.kind)).reduce((s, d) => s + payFor(d.patternMin * pay.leavePct[d.kind] / 100, 1000, rate), 0);
    else base = (norm > 0 ? Math.round(baseMinor * Math.max(0, norm - leaveMin) / norm) : baseMinor) * scale;
    base = cap(base);
    const nightMin = pay.nightPct > 0 ? used.filter(d => mins(d) > 0).reduce((s, d) => s + (d.actualMin !== null ? nightMinutes(d.actual.from, d.actual.to) : d.from ? nightMinutes(d.from, d.to) : 0), 0) : 0;
    const night = cap(payFor(nightMin, pay.nightPct * 10, rate));
    const line = (a, of) => (a.amountMinor ? Math.round(a.amountMinor * scale) : Math.round(of * a.pctBp / 10000));
    let taxableAdd = 0, freeAdd = 0;
    for (const a of pay.allowances) { const v = cap(line(a, base)); if (a.taxable) taxableAdd += v; else freeAdd += v; }
    for (const x of extras) { if (x.taxable) taxableAdd += x.amountMinor; else freeAdd += x.amountMinor; }
    const gross = cap(base + otPay + night + taxableAdd + freeAdd);
    const preDed = pay.deductions.filter(a => a.when === 'before').reduce((s, a) => s + cap(line(a, gross)), 0), postDed = pay.deductions.filter(a => a.when !== 'before').reduce((s, a) => s + cap(line(a, gross)), 0);
    const taxable = Math.max(0, base + otPay + night + taxableAdd - preDed - Math.round(pay.taxFreeMinor * scale)), tax = monthTax(pay.tax, taxable, ytd);
    const net = Math.max(0, gross - preDed - tax - postDed);
    return { workedMin, base, overtime: { min: ov.min, t1: ov.t1, t2: ov.t2, raw: ov.raw, pay: otPay }, nightMin, night, allowances: cap(taxableAdd + freeAdd), gross, preDed, postDed, taxFree: Math.round(pay.taxFreeMinor * scale), taxable, tax, net, taxBp: gross > 0 ? Math.round(tax * 10000 / gross) : 0, netPerHour: workedMin > 0 ? Math.round(net * 60 / workedMin) : null };
  }
  const t0 = calc('month', 0).taxable, annual = pay.tax.kind === 'brackets' && pay.tax.basis === 'annual';
  let ytdMinor = 0, assumed = 0;
  if (annual) for (let i = 1; i < Number(ym.slice(5)); i++) { const v = prior.get(`${ym.slice(0, 4)}-${pad(i)}`); if (v === undefined) { ytdMinor += t0; assumed++; } else ytdMinor += v; }
  return {
    ym, currency: pay.currency, normMin: norm, zeroNorm, perHourMinor, ytd: { minor: ytdMinor, assumed }, workdays: list.filter(d => d.kind === 'work' && d.plannedMin > 0).length,
    left: list.filter(d => d.kind === 'work' && d.plannedMin > 0 && !d.done).length, recordedDays: list.filter(d => d.recorded).length, assumedDays: list.filter(d => d.kind === 'work' && d.done && !d.recorded && d.plannedMin > 0).length,
    share, accrued: calc('accrued', ytdMinor), month: calc('month', ytdMinor), days: list,
  };
}

// ---------- выплаты ----------
export function payoutPlan(ym, netMinor, pay) {
  const out = [], adv = pay.advance.day > 0 ? Math.round(netMinor * pay.advance.pct / 100) : 0;
  if (pay.advance.day > 0) out.push({ kind: 'advance', ym, date: `${ym}-${pad(Math.min(pay.advance.day, daysIn(ym)))}`, amountMinor: adv });
  if (pay.salaryDay > 0) { const nx = shiftYm(ym, 1); out.push({ kind: 'final', ym, date: `${nx}-${pad(Math.min(pay.salaryDay, daysIn(nx)))}`, amountMinor: Math.max(0, netMinor - adv) }); }
  return out;
}
// Ближайшие выплаты начиная с сегодня: аванс этого месяца и окончательная часть прошлого и этого. netOf(ym) — сумма «на руки» месяца.
export const upcomingPayouts = (today, pay, netOf, n = 2) => [-1, 0].flatMap(d => { const ym = shiftYm(today.slice(0, 7), d); return payoutPlan(ym, netOf(ym), pay); }).filter(p => p.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, n);

// Данные для записи дохода через money.js (makeIncome): на руки за месяц, дата — день выплаты или сегодня.
export function incomeDraft(res, pay, date) {
  if (!(res.month.net > 0)) throw new Error('Сумма на руки нулевая: записывать нечего');
  return { amount: res.month.net, category: 'Зарплата', note: `Зарплата за ${monthLabel(res.ym).toLowerCase()} (расчёт${pay.currency !== 'RUB' ? ', ' + pay.currency : ''})`, date };
}
