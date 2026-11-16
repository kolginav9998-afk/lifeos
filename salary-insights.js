// Умная аналитика по зарплате: сравнение месяцев, «а что если», выводы простыми словами. Чистая логика. Всё — оценки по настройкам человека.
import { monthLabel } from './money.js';
import { shiftYm, fmtDur, dayMonthText } from './schedule.js';
import { computeMonth, fmtMoney, plural } from './salary.js';
import { fmtPercent } from './salary-tax.js';

// Ряд из n месяцев (старые → новые): mk(ym) возвращает результат computeMonth.
export function monthSeries(endYm, n, mk) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ym = shiftYm(endYm, -i), m = mk(ym).month;
    out.push({ ym, gross: m.gross, net: m.net, tax: m.tax, base: m.base, otPay: m.overtime.pay, otMin: m.overtime.min, workedMin: m.workedMin });
  }
  return out;
}

// «А что если»: те же данные, но с добавкой переработок (минуты) и/или прибавкой к окладу (проценты).
export function whatIf(args, adjust) {
  const a = computeMonth(args).month, b = computeMonth({ ...args, adjust }).month;
  return { before: a, after: b, dNet: b.net - a.net, dGross: b.gross - a.gross, dTax: b.tax - a.tax };
}

// Выводы простыми словами. cur — расчёт выбранного месяца, prev — прошлого, series — monthSeries, closed — Map итогов месяцев (paymonth),
// upcoming — ближайшие выплаты (upcomingPayouts). tone: good — приятное, warn — стоит проверить, info — просто факт.
export function insights({ cur, prev = null, series = [], pay, today, closed = new Map(), upcoming = [] }) {
  const out = [], add = (id, tone, text) => out.push({ id, tone, text });
  if (!cur || !(pay.baseMinor > 0)) return out;
  const c = cur.month, a = cur.accrued, M = v => fmtMoney(v, pay.currency), pct = (x, y) => Math.round(x * 100 / y);
  const now = cur.ym === today.slice(0, 7);
  if (c.overtime.pay > 0 && c.gross > 0) add('ot-share', 'info', `Переработки дали ${pct(c.overtime.pay, c.gross)} % дохода: ${M(c.overtime.pay)} из ${M(c.gross)} до налога (${fmtDur(c.overtime.min)}).`);
  if (c.overtime.min > 0 && cur.normMin > 0 && c.overtime.min * 20 >= cur.normMin) add('ot-norm', 'warn', `Переработки — ${pct(c.overtime.min, cur.normMin)} % от нормы часов. Если так бывает часто, посмотри в графике, хватает ли отдыха.`);
  if (now && cur.left > 0) add('forecast', 'good', `До конца месяца ${cur.left} ${plural(cur.left, 'рабочий день', 'рабочих дня', 'рабочих дней')}: прогноз на руки около ${M(c.net)} (без новых переработок).`);
  if (now && a.gross > 0) add('accrued', 'info', `На сегодня начислено около ${M(a.gross)} до налога, на руки около ${M(a.net)}.`);
  if (c.tax > 0 && c.gross > 0) add('tax', 'info', `Налог по твоим настройкам — около ${fmtPercent(c.taxBp)} от начисленного: ${M(c.tax)}.`);
  if (cur.perHourMinor > 0) add('hour', 'info', `Час по ставке стоит около ${M(cur.perHourMinor)}, час переработки — около ${M(Math.round(cur.perHourMinor * pay.ot.multMille / 1000))} до налога.`);
  if (c.netPerHour) add('net-hour', 'info', `Если поделить сумму на руки на все отработанные часы, выходит около ${M(c.netPerHour)} в час.`);
  if (cur.assumedDays > 0) add('assumed', 'warn', `Для ${cur.assumedDays} ${plural(cur.assumedDays, 'прошедшего рабочего дня', 'прошедших рабочих дней', 'прошедших рабочих дней')} нет отметки часов: считаю по графику. Отметь фактические часы, и расчёт станет точнее.`);
  if (prev && prev.month.net > 0 && c.net > 0 && prev.month.net !== c.net) {
    const d = c.net - prev.month.net;
    add('mom', d > 0 ? 'good' : 'info', `По сравнению с месяцем «${monthLabel(prev.ym).toLowerCase()}» на руки ${d > 0 ? 'больше' : 'меньше'} на ${M(Math.abs(d))} (${pct(Math.abs(d), prev.month.net)} %).`);
  }
  const live = series.filter(r => r.net > 0);
  if (live.length >= 3) {
    const best = live.reduce((x, y) => (y.net > x.net ? y : x));
    if (live.some(r => r.net !== best.net)) add('best', 'info', best.ym === cur.ym ? `Этот месяц — лучший из последних ${series.length}: на руки около ${M(best.net)}.` : `Лучший месяц из последних ${series.length}: ${monthLabel(best.ym).toLowerCase()}, на руки около ${M(best.net)}.`);
  }
  const lastClosed = [...closed.values()].filter(p => p.actualNetMinor !== null && p.computed.netMinor > 0).sort((x, y) => y.ym.localeCompare(x.ym))[0];
  if (lastClosed) {
    const d = lastClosed.actualNetMinor - lastClosed.computed.netMinor, p = pct(Math.abs(d), lastClosed.computed.netMinor);
    add('real', p >= 3 ? 'warn' : 'good', `За ${monthLabel(lastClosed.ym).toLowerCase()} расчёт был ${M(lastClosed.computed.netMinor)}, пришло ${M(lastClosed.actualNetMinor)}${d ? `: ${d > 0 ? 'больше' : 'меньше'} на ${M(Math.abs(d))} (${p} %)` : ': сошлось'}.${p >= 3 ? ' Проверь надбавки, удержания и налог в настройках.' : ''}`);
  }
  if (upcoming[0]) add('payout', 'info', `Ближайшая выплата: ${upcoming[0].kind === 'advance' ? 'аванс' : 'остаток зарплаты'} ${dayMonthText(upcoming[0].date)}, около ${M(upcoming[0].amountMinor)}.`);
  return out;
}
