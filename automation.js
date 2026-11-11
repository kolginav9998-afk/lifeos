// Калькулятор автоматизации: сколько времени и денег сэкономит автоматизация повторяющейся операции и когда она окупится.
const num = (v, lo, hi, label) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[\s ]/g, '').replace(',', '.')); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${label}: от ${String(lo).replace('.', ',')} до ${hi}`); return n; };

export function autoSavings({ minutes, perWeek, people = 1, buildHours = 0, hourlyRate = 0 } = {}) {
  const m = num(minutes, 0.1, 600, 'Минут на операцию'), k = num(perWeek, 0.1, 1000, 'Раз в неделю'), p = num(people, 1, 1000, 'Сколько человек делают это');
  const b = num(buildHours || 0, 0, 5000, 'Часов на настройку'), r = num(hourlyRate || 0, 0, 1_000_000, 'Стоимость часа');
  const hoursWeek = (m * k * p) / 60, hoursYear = hoursWeek * 52;
  const paybackWeeks = b === 0 ? 0 : hoursWeek > 0 ? b / hoursWeek : null;
  const verdict = paybackWeeks === null ? 'нет' : paybackWeeks <= 12 ? 'стоит делать' : paybackWeeks <= 52 ? 'окупится в течение года' : 'за год не окупится';
  return { hoursWeek, hoursYear, moneyYear: hoursYear * r, buildHours: b, paybackWeeks, verdict };
}
const f = (x, d = 1) => String(Math.round(x * 10 ** d) / 10 ** d).replace('.', ',');
export function autoText(r) {
  const parts = [`Экономия: ${f(r.hoursWeek)} ч в неделю, ${f(r.hoursYear, 0)} ч в год.`];
  if (r.moneyYear > 0) parts.push(`В деньгах около ${Math.round(r.moneyYear).toLocaleString('ru').replace(/ /g, ' ')} ₽ в год.`);
  parts.push(r.buildHours === 0 ? 'Настройка бесплатна: окупается сразу.' : r.paybackWeeks === null ? 'Не окупается.' : `Настройка (${f(r.buildHours)} ч) окупится примерно за ${f(r.paybackWeeks, 0)} нед. Вывод: ${r.verdict}.`);
  return parts.join(' ');
}
