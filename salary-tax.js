// Налог на зарплату: настраиваемые модели. Ничего не «зашито как закон»: готовые наборы — только примеры, их можно менять.
// Суммы — целые минимальные единицы (копейки, центы). Ставки — в сотых долях процента (1300 = 13,00 %), чтобы не считать на дробных числах.
export const MAX_RATE_BP = 10000;
export const MAX_BRACKETS = 12;
// Пример для России: прогрессивная шкала с порогами за год. Это пример на момент написания, не справка: ставки и пороги проверяй сам.
const RU_EXAMPLE = [{ upToMinor: 240_000_000, rateBp: 1300 }, { upToMinor: 500_000_000, rateBp: 1500 }, { upToMinor: 2_000_000_000, rateBp: 1800 }, { upToMinor: 5_000_000_000, rateBp: 2000 }, { upToMinor: null, rateBp: 2200 }];
export const TAX_PRESETS = [
  { pid: 'none', title: 'Без налога (сумма уже «на руки»)', tax: { kind: 'flat', rateBp: 0 } },
  { pid: 'flat', title: 'Плоская ставка (пример: 13 %)', tax: { kind: 'flat', rateBp: 1300 } },
  { pid: 'ru', title: 'Россия (пример, проверь актуальные ставки)', tax: { kind: 'brackets', basis: 'annual', brackets: RU_EXAMPLE } },
  { pid: 'own', title: 'Своя шкала (таблица ступеней)', tax: { kind: 'brackets', basis: 'monthly', brackets: [{ upToMinor: 10_000_000, rateBp: 1000 }, { upToMinor: null, rateBp: 2000 }] } },
];
export const presetOf = pid => TAX_PRESETS.find(p => p.pid === pid) ?? null;
const cloneTax = t => JSON.parse(JSON.stringify(t));
export const presetTax = pid => cloneTax((presetOf(pid) ?? TAX_PRESETS[0]).tax);

const rateOk = v => Number.isInteger(v) && v >= 0 && v <= MAX_RATE_BP;
// Ступени: у каждой, кроме последней, есть порог «до …», пороги растут; у последней порога нет («выше»).
export function bracketsError(brackets) {
  if (!Array.isArray(brackets) || !brackets.length) return 'Добавь хотя бы одну ступень';
  if (brackets.length > MAX_BRACKETS) return `Ступеней не больше ${MAX_BRACKETS}`;
  let prev = 0;
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    if (!rateOk(b?.rateBp)) return `Ступень ${i + 1}: ставка от 0 до 100 %`;
    if (i === brackets.length - 1) break;
    if (!Number.isSafeInteger(b.upToMinor) || b.upToMinor <= prev) return `Ступень ${i + 1}: порог должен быть больше предыдущего`;
    prev = b.upToMinor;
  }
  return '';
}
// Приведение к единому виду (в том числе чужих или старых данных): при ошибке — «без налога».
export function normalizeTax(raw) {
  if (raw?.kind === 'brackets' && !bracketsError(raw.brackets)) {
    const n = raw.brackets.length;
    return { kind: 'brackets', basis: raw.basis === 'monthly' ? 'monthly' : 'annual', brackets: raw.brackets.map((b, i) => ({ upToMinor: i === n - 1 ? null : b.upToMinor, rateBp: b.rateBp })) };
  }
  return { kind: 'flat', rateBp: raw?.kind === 'flat' && rateOk(raw.rateBp) ? raw.rateBp : 0 };
}
export function checkTax(raw) {
  if (raw?.kind === 'flat') { if (!rateOk(raw.rateBp)) throw new Error('Ставка налога: от 0 до 100 %'); return; }
  if (raw?.kind !== 'brackets') throw new Error('Выбери, как считать налог');
  const e = bracketsError(raw.brackets); if (e) throw new Error(e);
}
export const parsePercent = s => {
  const t = String(s ?? '').replace(/[\s%]/g, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) throw new Error('Процент: например 13 или 13,5');
  const bp = Math.round(Number(t) * 100);
  if (bp > MAX_RATE_BP) throw new Error('Процент не больше 100');
  return bp;
};
export const fmtPercent = bp => `${(bp / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} %`;

// Налог на сумму по ступеням (дробное число: округляет вызывающий). Последняя ступень «открыта» вверх.
export function taxOnAmount(brackets, amount) {
  let tax = 0, prev = 0;
  for (let i = 0; i < brackets.length && amount > prev; i++) {
    const top = i === brackets.length - 1 || brackets[i].upToMinor === null ? Infinity : brackets[i].upToMinor;
    tax += (Math.min(amount, top) - prev) * brackets[i].rateBp / 10000;
    prev = top;
  }
  return tax;
}
// Налог за месяц с налогооблагаемой суммы. Шкала «за год»: налог месяца = налог на всё с начала года минус налог на то, что было до месяца.
export function monthTax(tax, taxableMinor, ytdBeforeMinor = 0) {
  const t = Math.max(0, Math.round(Number(taxableMinor) || 0)), m = normalizeTax(tax);
  if (m.kind === 'flat') return Math.round(t * m.rateBp / 10000);
  if (m.basis === 'monthly') return Math.round(taxOnAmount(m.brackets, t));
  const y = Math.max(0, Math.round(Number(ytdBeforeMinor) || 0));
  return Math.round(taxOnAmount(m.brackets, y + t) - taxOnAmount(m.brackets, y));
}
export function describeTax(tax) {
  const m = normalizeTax(tax);
  if (m.kind === 'flat') return m.rateBp ? `Плоская ставка ${fmtPercent(m.rateBp)}` : 'Без налога';
  const n = m.brackets.length, k = n % 100, w = k > 10 && k < 20 ? 'ступеней' : n % 10 === 1 ? 'ступень' : n % 10 > 1 && n % 10 < 5 ? 'ступени' : 'ступеней';
  return `Шкала из ${n} ${w}, пороги ${m.basis === 'annual' ? 'за год' : 'за месяц'}`;
}
