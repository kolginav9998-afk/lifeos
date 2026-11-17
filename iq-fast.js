// «Струп: 40 проб» и «Кодирование символов». Чистая логика: задания и подсчёт результата.
import { STROOP_COLORS } from './bt-logic.js';
import { mean, median, round } from './stats.js';

const finite = a => a.filter(Number.isFinite);
const avg = a => (a.length ? Math.round(mean(a)) : null);

// ---------- Струп: 40 проб ----------
// Три вида проб: совпадение (слово «СИНИЙ» синим), несовпадение (слово «СИНИЙ» красным), нейтральная (слово не про цвет, например «СТОЛ», цветом чернил).
export const NEUTRAL_WORDS = ['ДОМ', 'СТОЛ', 'ЛЕС', 'КОТ', 'ЧАЙ', 'МЕЛ', 'МОРЕ', 'ЛУК'];
export const STROOP40_N = 40;
// Проба: { kind: 'con' | 'inc' | 'neu', word (id цвета или null), text, ink (id цвета) }.
export function makeStroop40(rng, n = STROOP40_N) {
  const colors = STROOP_COLORS.map(c => c.id), nCon = Math.round(n / 4), nNeu = Math.round(n / 4), nInc = n - nCon - nNeu;
  const cycle = (k, shift = 0) => Array.from({ length: k }, (_, i) => colors[(i + shift) % 4]);          // «лишние» цвета у разных видов проб разные: в сумме поровну
  const pool = [];
  for (const ink of rng.shuffle(cycle(nCon))) pool.push({ kind: 'con', word: ink, text: STROOP_COLORS.find(c => c.id === ink).word, ink });
  const incInks = rng.shuffle(cycle(nInc));
  incInks.forEach((ink, i) => { const others = colors.filter(c => c !== ink), word = others[(i + rng.int(0, 2)) % 3]; pool.push({ kind: 'inc', word, text: STROOP_COLORS.find(c => c.id === word).word, ink }); });
  for (const ink of rng.shuffle(cycle(nNeu, 2))) pool.push({ kind: 'neu', word: null, text: rng.pick(NEUTRAL_WORDS), ink });
  let best = null, bestBad = Infinity;
  for (let attempt = 0; attempt < 300; attempt++) {
    const seq = rng.shuffle(pool);
    let bad = 0, run = 1, inkRun = 1;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].text === seq[i - 1].text && seq[i].ink === seq[i - 1].ink) bad += 5;
      run = seq[i].kind === seq[i - 1].kind ? run + 1 : 1; if (run > 3) bad++;
      inkRun = seq[i].ink === seq[i - 1].ink ? inkRun + 1 : 1; if (inkRun > 2) bad++;
    }
    if (bad < bestBad) { best = seq; bestBad = bad; }
    if (!bad) break;
  }
  return best;
}
// Проба в записи: { kind, word, ink, correct, rt }. Время считаем только по верным ответам.
export function scoreStroop40(trials) {
  const okRt = k => finite(trials.filter(t => t.kind === k && t.correct).map(t => t.rt));
  const con = avg(okRt('con')), inc = avg(okRt('inc')), neu = avg(okRt('neu')), all = finite(trials.filter(t => t.correct).map(t => t.rt));
  return {
    n: trials.length, correct: trials.filter(t => t.correct).length, accuracy: trials.length ? round(trials.filter(t => t.correct).length / trials.length, 3) : null,
    meanCongruent: con, meanNeutral: neu, meanIncongruent: inc,
    interference: inc !== null && neu !== null ? inc - neu : null,                 // помеха: насколько несовпадение медленнее нейтральной пробы
    facilitation: con !== null && neu !== null ? neu - con : null,                 // выигрыш: насколько совпадение быстрее нейтральной
    errorsIncongruent: trials.filter(t => t.kind === 'inc' && !t.correct).length,
    medianRT: all.length ? Math.round(median(all)) : null,
  };
}

// ---------- Кодирование символов ----------
// Девять простых знаков (контуры в квадрате 24×24) и их названия для экранного диктора.
export const SYMBOLS = [
  { id: 'plus', name: 'плюс', d: 'M12 4v16M4 12h16' },
  { id: 'cross', name: 'крестик', d: 'M5 5l14 14M19 5L5 19' },
  { id: 'circle', name: 'кружок', d: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16' },
  { id: 'triangle', name: 'треугольник', d: 'M12 4L20 19H4Z' },
  { id: 'square', name: 'квадрат', d: 'M5 5h14v14H5Z' },
  { id: 'diamond', name: 'ромб', d: 'M12 3l9 9-9 9-9-9Z' },
  { id: 'corner', name: 'уголок', d: 'M6 4v16h12' },
  { id: 'tee', name: 'буква Т', d: 'M4 5h16M12 5v15' },
  { id: 'bars', name: 'две черты', d: 'M5 9h14M5 15h14' },
];
export const CODING_SECONDS = 90;
// Ключ: key[i] — цифра для знака i; цифры 1…9 по одной.
export const makeCodingKey = rng => rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
// Поток знаков (номера): без повторов подряд, все знаки встречаются примерно поровну.
export function makeCodingStream(rng, length = 160) {
  const out = [];
  while (out.length < length) {
    const block = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    if (out.length && block[0] === out.at(-1)) { const j = rng.int(1, 8); [block[0], block[j]] = [block[j], block[0]]; }
    out.push(...block);
  }
  return out.slice(0, length);
}
// Проба: { sym, digit, correct, rt }.
export function scoreCoding(trials) {
  const ok = trials.filter(t => t.correct), totalMs = trials.reduce((s, t) => s + (Number.isFinite(t.rt) ? t.rt : 0), 0);
  return {
    n: trials.length, correct: ok.length, accuracy: trials.length ? round(ok.length / trials.length, 3) : null,
    meanMs: ok.length ? avg(finite(ok.map(t => t.rt))) : null, perMinute: totalMs > 0 ? round((ok.length / totalMs) * 60000, 1) : null,
  };
}
export const keyDescription = key => `Ключ: ${SYMBOLS.map((s, i) => `${s.name} — ${key[i]}`).join('; ')}`;
