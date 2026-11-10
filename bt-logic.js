// Логика тестов: генераторы заданий и подсчёт результатов. Без интерфейса и без таймеров — всё проверяемо автотестами.
// Тесты нужны для сравнения тебя с самим собой во времени. Это не медицинская диагностика и не IQ-тест.
import { median, mean, sd, dPrime, round, clamp } from './stats.js';

const finite = a => a.filter(Number.isFinite);

// =============== 1. Простая реакция ===============
export function scoreReaction(trials) {
  const rts = finite(trials.filter(t => !t.falseStart).map(t => t.rt));
  return {
    n: rts.length,
    median: rts.length ? Math.round(median(rts)) : null,
    mean: rts.length ? Math.round(mean(rts)) : null,
    sd: rts.length > 1 ? Math.round(sd(rts)) : null,
    best: rts.length ? Math.round(Math.min(...rts)) : null,
    lapses: rts.filter(r => r > 500).length,
    falseStarts: trials.filter(t => t.falseStart).length,
  };
}

// =============== 2. Go / No-Go ===============
// Последовательность: доля «не жми» ≈ pNoGo, не больше 3 «не жми» подряд.
export function makeGoNoGo(rng, n = 30, pNoGo = 0.25) {
  const noGo = Math.round(n * pNoGo);
  for (let attempt = 0; attempt < 200; attempt++) {
    const seq = rng.shuffle([...Array(noGo).fill(false), ...Array(n - noGo).fill(true)]);
    let run = 0, ok = true;
    for (const g of seq) { run = g ? 0 : run + 1; if (run > 3) { ok = false; break; } }
    if (ok && seq[0]) return seq;                                  // начинаем с «жми»
  }
  return Array.from({ length: n }, (_, i) => i % 4 !== 3);          // запасной вариант: детерминированная схема
}
export function scoreGoNoGo(trials) {
  const go = trials.filter(t => t.go), nogo = trials.filter(t => !t.go);
  const hits = go.filter(t => t.responded).length, omissions = go.length - hits;
  const commissions = nogo.filter(t => t.responded).length, cr = nogo.length - commissions;
  const rts = finite(go.filter(t => t.responded).map(t => t.rt));
  return {
    n: trials.length, hits, omissions, commissions, correctRejections: cr,
    accuracy: trials.length ? round((hits + cr) / trials.length, 3) : null,
    inhibition: nogo.length ? round(cr / nogo.length, 3) : null,
    medianRT: rts.length ? Math.round(median(rts)) : null,
    dPrime: go.length && nogo.length ? round(dPrime(hits, omissions, commissions, cr), 2) : null,
  };
}

// =============== 3. Струп (цвет чернил против названия цвета) ===============
export const STROOP_COLORS = [
  { id: 'red', word: 'КРАСНЫЙ', name: 'красный', hex: '#e53935' },
  { id: 'blue', word: 'СИНИЙ', name: 'синий', hex: '#1e88e5' },
  { id: 'green', word: 'ЗЕЛЁНЫЙ', name: 'зелёный', hex: '#2e9e44' },
  { id: 'yellow', word: 'ЖЁЛТЫЙ', name: 'жёлтый', hex: '#fbc02d' },
];
export function makeStroop(rng, n = 24) {
  const out = [];
  const half = Math.floor(n / 2);
  const kinds = rng.shuffle([...Array(half).fill(true), ...Array(n - half).fill(false)]);
  let prev = null;
  for (const congruent of kinds) {
    let word, ink, tries = 0;
    do {
      word = rng.pick(STROOP_COLORS);
      ink = congruent ? word : rng.pick(STROOP_COLORS.filter(c => c.id !== word.id));
    } while (prev && prev.word === word.id && prev.ink === ink.id && ++tries < 20);
    prev = { word: word.id, ink: ink.id };
    out.push({ word: word.id, ink: ink.id, congruent });
  }
  return out;
}
export function scoreStroop(trials) {
  const ok = t => t.correct && Number.isFinite(t.rt);
  const cong = trials.filter(t => t.congruent && ok(t)).map(t => t.rt), inc = trials.filter(t => !t.congruent && ok(t)).map(t => t.rt);
  const mc = cong.length ? mean(cong) : null, mi = inc.length ? mean(inc) : null;
  return {
    n: trials.length, correct: trials.filter(t => t.correct).length,
    accuracy: trials.length ? round(trials.filter(t => t.correct).length / trials.length, 3) : null,
    meanCongruent: mc === null ? null : Math.round(mc), meanIncongruent: mi === null ? null : Math.round(mi),
    interference: mc !== null && mi !== null ? Math.round(mi - mc) : null,
    errorsIncongruent: trials.filter(t => !t.congruent && !t.correct).length,
  };
}

// =============== 4. Объём цифровой памяти ===============
export function makeDigits(rng, len) {
  const d = [];
  while (d.length < len) { const x = rng.int(0, 9); if (d[d.length - 1] !== x) d.push(x); }
  return d;
}
// Процедура: стартовая длина, две попытки на длину, остановка после двух неудач подряд на одной длине.
export class SpanProcedure {
  constructor({ start = 3, max = 12 } = {}) { this.len = start; this.max = max; this.tries = 0; this.fails = 0; this.best = 0; this.finished = false; this.history = []; }
  current() { return this.finished ? null : this.len; }
  record(passed) {
    this.history.push({ len: this.len, passed });
    if (passed) { this.best = Math.max(this.best, this.len); this.fails = 0; this.tries = 0; if (this.len >= this.max) this.finished = true; else this.len += 1; }
    else { this.fails += 1; this.tries += 1; if (this.fails >= 2) this.finished = true; }
    return this;
  }
}
export const checkSpan = (seq, answer, backward) => {
  const want = backward ? [...seq].reverse() : seq;
  return want.length === answer.length && want.every((d, i) => d === answer[i]);
};
export const scoreSpan = (fwd, bwd) => ({ forward: fwd.best, backward: bwd.best, total: fwd.best + bwd.best, attempts: fwd.history.length + bwd.history.length });

// =============== 5. Запоминание слов (распознавание) ===============
export const WORD_POOL = ['арбуз', 'бабочка', 'барабан', 'белка', 'берег', 'ботинок', 'бумага', 'бутылка', 'ведро', 'верблюд', 'вилка', 'виноград', 'ворона', 'гвоздь', 'гитара', 'глобус', 'гора', 'гриб', 'груша', 'дверь',
  'дерево', 'диван', 'дождь', 'дорога', 'жираф', 'забор', 'замок', 'зеркало', 'зонт', 'игла', 'ёлка', 'капуста', 'карандаш', 'картина', 'кастрюля', 'квартира', 'кирпич', 'кисть', 'книга', 'колесо',
  'кольцо', 'корабль', 'корзина', 'коробка', 'кошка', 'краска', 'крыша', 'кувшин', 'лампа', 'лестница', 'лимон', 'лодка', 'ложка', 'лопата', 'лошадь', 'лук', 'маска', 'машина', 'медведь', 'мел',
  'мельница', 'метро', 'молоток', 'море', 'мост', 'муравей', 'мыло', 'мяч', 'навес', 'нож', 'носок', 'облако', 'огурец', 'окно', 'орех', 'осень', 'открытка', 'очки', 'паук', 'перчатка',
  'печка', 'пианино', 'пирог', 'платье', 'подушка', 'полка', 'помидор', 'пуговица', 'пчела', 'радуга', 'ракета', 'ромашка', 'рубашка', 'ручей', 'рыба', 'сад', 'самолёт', 'сапог', 'свеча', 'стол',
  'сумка', 'табурет', 'тарелка', 'телефон', 'тетрадь', 'тополь', 'торт', 'тротуар', 'трубка', 'тучка', 'улитка', 'утюг', 'ухо', 'флаг', 'фонарь', 'футбол', 'холодильник', 'хлеб', 'цветок', 'часы',
  'чайник', 'чемодан', 'черепаха', 'чернила', 'шапка', 'шарф', 'шкаф', 'шоколад', 'щётка', 'яблоко', 'ягода', 'якорь', 'ящик', 'бочка', 'веник', 'ветка', 'гамак', 'гусь', 'дыня', 'жук',
  'ключ', 'клубника', 'курица', 'лента', 'морковь', 'ножницы', 'овца', 'палатка', 'рюкзак', 'сыр', 'трактор', 'туфля', 'ураган', 'хомяк', 'цапля', 'чайка', 'шахматы', 'экран', 'юла', 'ящерица'];

export function pickWords(rng, n = 10, exclude = []) {
  const ex = new Set(exclude);
  return rng.shuffle(WORD_POOL.filter(w => !ex.has(w))).slice(0, n);
}
// Список для распознавания: целевые слова + столько же новых (не из заученных и не из «прежних» наборов).
export function makeRecognition(rng, targets, avoid = []) {
  const distractors = pickWords(rng, targets.length, [...targets, ...avoid]);
  return rng.shuffle([...targets.map(w => ({ word: w, old: true })), ...distractors.map(w => ({ word: w, old: false }))]);
}
export function scoreRecognition(trials) {
  const old = trials.filter(t => t.old), nw = trials.filter(t => !t.old);
  const hits = old.filter(t => t.said).length, fa = nw.filter(t => t.said).length;
  return {
    n: trials.length, hits, misses: old.length - hits, falseAlarms: fa, correctRejections: nw.length - fa,
    accuracy: trials.length ? round((hits + nw.length - fa) / trials.length, 3) : null,
    dPrime: old.length && nw.length ? round(dPrime(hits, old.length - hits, fa, nw.length - fa), 2) : null,
  };
}

// =============== 6. Умственный счёт ===============
export function makeProblem(rng, level) {
  const L = clamp(Math.round(level), 1, 5);
  let a, b, c, text, answer;
  switch (L) {
    case 1: a = rng.int(2, 9); b = rng.int(1, 9); if (rng() < 0.5) { text = `${a} + ${b}`; answer = a + b; } else { const [x, y] = a >= b ? [a, b] : [b, a]; text = `${x} − ${y}`; answer = x - y; } break;
    case 2: a = rng.int(11, 99); b = rng.int(3, 49); if (rng() < 0.5) { text = `${a} + ${b}`; answer = a + b; } else { const [x, y] = a >= b ? [a, b] : [b, a]; text = `${x} − ${y}`; answer = x - y; } break;
    case 3: a = rng.int(3, 12); b = rng.int(3, 12); text = `${a} × ${b}`; answer = a * b; break;
    case 4: if (rng() < 0.6) { a = rng.int(12, 99); b = rng.int(3, 9); text = `${a} × ${b}`; answer = a * b; } else { b = rng.int(3, 12); c = rng.int(3, 20); text = `${b * c} ÷ ${b}`; answer = c; } break;
    default: if (rng() < 0.5) { a = rng.int(10, 60); b = rng.int(3, 9); c = rng.int(3, 9); text = `${a} + ${b} × ${c}`; answer = a + b * c; } else { a = rng.int(120, 899); b = rng.int(25, 99); if (rng() < 0.5) { text = `${a} + ${b}`; answer = a + b; } else { text = `${a} − ${b}`; answer = a - b; } }
  }
  return { text, answer, level: L };
}
// Адаптация: быстрый верный ответ — уровень вверх, ошибка — вниз.
export class AdaptiveLevel {
  constructor(start = 2, fastMs = { 1: 3000, 2: 6000, 3: 7000, 4: 10000, 5: 14000 }) { this.level = start; this.fastMs = fastMs; this.max = start; }
  update(correct, rt) {
    if (correct && rt <= (this.fastMs[this.level] ?? 8000)) this.level = Math.min(5, this.level + 1);
    else if (!correct) this.level = Math.max(1, this.level - 1);
    this.max = Math.max(this.max, this.level);
    return this.level;
  }
}
export function scoreMath(trials) {
  const ok = trials.filter(t => t.correct), times = finite(ok.map(t => t.rt));
  const totalMs = trials.reduce((s, t) => s + (Number.isFinite(t.rt) ? t.rt : 0), 0);
  return {
    n: trials.length, correct: ok.length, accuracy: trials.length ? round(ok.length / trials.length, 3) : null,
    meanMs: times.length ? Math.round(mean(times)) : null,
    perMinute: totalMs > 0 ? round((ok.length / totalMs) * 60000, 1) : null,
    maxLevel: trials.length ? Math.max(...trials.map(t => t.level)) : null,
  };
}

// =============== 7. Числовые ряды ===============
function options(rng, answer, near) {
  const set = new Set([answer]);
  const cands = [...near, answer + 1, answer - 1, answer + 2, answer - 2, answer + 10, answer - 10, answer * 2];
  for (const c of rng.shuffle(cands)) { if (Number.isInteger(c) && c !== answer && c > -1000 && set.size < 4) set.add(c); }
  let k = 3;
  while (set.size < 4) set.add(answer + k++);
  return rng.shuffle([...set]);
}
export function makeSeries(rng, level) {
  const L = clamp(Math.round(level), 1, 5);
  let terms, rule, near = [];
  const fam = (...gens) => rng.pick(gens)();
  const arithmetic = (lo, hi) => () => { const d = rng.int(lo, hi) || 2, a = rng.int(1, 20); const t = Array.from({ length: 6 }, (_, i) => a + d * i); rule = `прибавляем ${d}`; near = [t[4] + t[4] - t[3] + 1]; return t; };
  const geometric = () => { const r = rng.pick([2, 3]), a = rng.int(1, 4); const t = Array.from({ length: 6 }, (_, i) => a * r ** i); rule = `умножаем на ${r}`; near = [t[4] + t[3]]; return t; };
  const squares = () => { const c = rng.int(0, 5), s = rng.int(1, 4); const t = Array.from({ length: 6 }, (_, i) => (i + s) ** 2 + c); rule = 'квадраты чисел'; near = [t[4] + (t[4] - t[3])]; return t; };
  const growingDiff = () => { const a = rng.int(1, 9), d0 = rng.int(1, 3); let v = a; const t = [v]; for (let i = 0; i < 5; i++) { v += d0 + i; t.push(v); } rule = 'разность растёт на 1'; near = [t[4] + (t[4] - t[3])]; return t; };
  const alternating = () => { const a = rng.int(1, 9), b = rng.int(20, 40), da = rng.int(2, 5), db = rng.int(1, 4); const t = Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? a + da * (i / 2) : b - db * ((i - 1) / 2))); rule = 'два чередующихся ряда'; near = [t[4] + da * 2 - 1]; return t; };
  const fibonacci = () => { const a = rng.int(1, 4), b = rng.int(1, 5); const t = [a, b]; while (t.length < 6) t.push(t[t.length - 1] + t[t.length - 2]); rule = 'каждое число — сумма двух предыдущих'; near = [t[4] * 2]; return t; };
  const doubling = () => { const a = rng.int(1, 6); let v = a, step = 1; const t = [v]; for (let i = 0; i < 5; i++) { v += step; step *= 2; t.push(v); } rule = 'прибавляемое удваивается'; near = [t[4] + (t[4] - t[3])]; return t; };
  const cubes = () => { const t = Array.from({ length: 6 }, (_, i) => (i + 1) ** 3); rule = 'кубы чисел'; near = [t[4] + (t[4] - t[3])]; return t; };
  const pronic = () => { const s = rng.int(1, 4); const t = Array.from({ length: 6 }, (_, i) => (i + s) * (i + s + 1)); rule = 'n·(n+1)'; near = [t[4] + (t[4] - t[3])]; return t; };
  switch (L) {
    case 1: terms = fam(arithmetic(2, 9)); break;
    case 2: terms = fam(arithmetic(-6, -2), geometric); break;
    case 3: terms = fam(squares, growingDiff); break;
    case 4: terms = fam(alternating, fibonacci); break;
    default: terms = fam(doubling, cubes, pronic);
  }
  const shown = terms.slice(0, 5), answer = terms[5];
  return { terms: shown, answer, options: options(rng, answer, near), level: L, rule };
}
export function scoreSeries(trials) {
  const ok = trials.filter(t => t.correct), times = finite(ok.map(t => t.rt));
  return {
    n: trials.length, correct: ok.length, accuracy: trials.length ? round(ok.length / trials.length, 3) : null,
    meanMs: times.length ? Math.round(mean(times)) : null,
    score: ok.reduce((s, t) => s + t.level, 0),                       // верные ответы с весом сложности
  };
}

// =============== 8. Таблица Шульте ===============
export function makeSchulte(rng, size = 25) { return rng.shuffle(Array.from({ length: size }, (_, i) => i + 1)); }
export function scoreSchulte({ times, errors }) {
  // times — отметки времени (мс от старта) для каждого найденного числа по порядку
  const n = times.length;
  const per = times.map((t, i) => t - (i ? times[i - 1] : 0));
  const half = Math.floor(n / 2);
  const first = per.slice(0, half), second = per.slice(half);
  return {
    n, errors, totalMs: n ? Math.round(times[n - 1]) : null,
    meanPerNumber: n ? Math.round(times[n - 1] / n) : null,
    fatigue: first.length && second.length ? round(mean(second) / mean(first), 2) : null,     // >1 — к концу медленнее
  };
}

// =============== 9. Чувство времени ===============
export function scoreTime(trials) {
  const errs = trials.map(t => t.actualMs - t.targetMs);
  const rel = trials.map(t => (t.actualMs - t.targetMs) / t.targetMs);
  return {
    n: trials.length,
    meanAbsErrorMs: trials.length ? Math.round(mean(errs.map(Math.abs))) : null,
    meanAbsErrorRel: trials.length ? round(mean(rel.map(Math.abs)), 3) : null,
    biasMs: trials.length ? Math.round(mean(errs)) : null,                    // <0 — торопишься, >0 — тянешь
  };
}

// =============== 10. Повторение изученного ===============
export function scoreRecall(trials) {
  const ok = trials.filter(t => t.correct), times = finite(trials.map(t => t.rt));
  const cats = {};
  for (const t of trials) { const c = (cats[t.category || '—'] ||= { n: 0, ok: 0 }); c.n++; if (t.correct) c.ok++; }
  return { n: trials.length, correct: ok.length, accuracy: trials.length ? round(ok.length / trials.length, 3) : null, meanMs: times.length ? Math.round(mean(times)) : null, byCategory: cats };
}
