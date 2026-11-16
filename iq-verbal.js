// «Слова и логика»: подбор 15 заданий из набора (аналогии, лишнее слово, рассуждения, порядок) и проверка ответов по формальной записи.
// Чистая логика. Рассуждения проверяются перебором всех возможных «миров» (какие группы людей и предметов существуют), порядок — перебором перестановок.
import { makeRng } from './stats.js';
import { ANALOGIES, ODDS, SYLLOGISMS, ORDERS } from './iq-verbal-bank.js';

export const VERBAL_COUNT = 15;
export const KIND_LABEL = { analogy: 'Аналогия', odd: 'Лишнее слово', syl: 'Рассуждение', order: 'Порядок и сравнение' };
export const SYL_OPTIONS = ['Да, это верно', 'Нет, это неверно', 'Нельзя сказать наверняка'];
const SYL_KEY = ['yes', 'no', 'maybe'];
export const CANNOT = 'нельзя определить';
export const WEEK = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const BANK = { analogy: ANALOGIES, odd: ODDS, syl: SYLLOGISMS, order: ORDERS };
export const bankSize = () => Object.values(BANK).reduce((s, a) => s + a.length, 0);

// ---------- проверка рассуждений ----------
// Группы: каждому человеку или предмету соответствует область — набор терминов, к которым он относится. Мир — набор «населённых» областей.
// Ответ: 'yes' (следует всегда), 'no' (противоречит), 'maybe' (бывает и так, и так). allNonEmpty — считать, что каждый термин непуст.
export function evalSets(m, { allNonEmpty = false } = {}) {
  const terms = m.terms, R = 1 << terms.length, has = (r, t) => !!(r & (1 << terms.indexOf(t)));
  const truth = ([q, x, y], inh) => {
    const rs = inh.flatMap((v, r) => (v ? [r] : []));
    if (q === 'all') return rs.every(r => !has(r, x) || has(r, y));
    if (q === 'none') return rs.every(r => !(has(r, x) && has(r, y)));
    if (q === 'some') return rs.some(r => has(r, x) && has(r, y));
    return rs.some(r => has(r, x) && !has(r, y));                       // somenot
  };
  let yes = 0, no = 0;
  for (let mask = 0; mask < 1 << R; mask++) {
    const inh = Array.from({ length: R }, (_, r) => !!(mask & (1 << r)));
    if (!(allNonEmpty ? terms : m.ne ?? []).every(t => inh.some((v, r) => v && has(r, t)))) continue;
    if (!m.prem.every(p => truth(p, inh))) continue;
    if (truth(m.con, inh)) yes++; else no++;
  }
  return yes + no === 0 ? null : no === 0 ? 'yes' : yes === 0 ? 'no' : 'maybe';
}
const ev = (f, env) => (typeof f === 'string' ? env[f] : f[0] === 'not' ? !ev(f[1], env) : f[0] === 'and' ? ev(f[1], env) && ev(f[2], env) : f[0] === 'or' ? ev(f[1], env) || ev(f[2], env) : !ev(f[1], env) || ev(f[2], env));
export function evalProp(m) {
  let yes = 0, no = 0;
  for (let mask = 0; mask < 1 << m.atoms.length; mask++) {
    const env = Object.fromEntries(m.atoms.map((a, i) => [a, !!(mask & (1 << i))]));
    if (!m.prem.every(p => ev(p, env))) continue;
    if (ev(m.con, env)) yes++; else no++;
  }
  return yes + no === 0 ? null : no === 0 ? 'yes' : yes === 0 ? 'no' : 'maybe';
}
export const evalSyl = (m, opts) => (m.atoms ? evalProp(m) : evalSets(m, opts));

// ---------- проверка порядка ----------
const perms = a => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])));
// Возвращает верный ответ словом или CANNOT, если по условию он не определён. Число подходящих расстановок — в count.
export function evalOrder(item) {
  const ok = perms(item.names).filter(p => item.rel.every(([k, x, y]) => (k === 'gt' ? p.indexOf(x) < p.indexOf(y) : k === 'notTop' ? p.indexOf(x) !== 0 : p.indexOf(x) !== p.length - 1)));
  const [kind, a, b] = item.ask;
  const answers = new Set(ok.map(p => (kind === 'pos' ? p.at(a) : p.indexOf(a) < p.indexOf(b) ? a : b)));
  return { answer: ok.length && answers.size === 1 ? [...answers][0] : CANNOT, count: ok.length };
}
export function evalCalendar(item) {
  const [shift, day] = item.cal.known, today = (((WEEK.indexOf(day) - shift) % 7) + 7) % 7;
  return WEEK[(((today + item.cal.ask) % 7) + 7) % 7];
}
// Верный ответ любого задания по формальной записи (для автотестов): текст варианта.
export function expectedAnswer(kind, it) {
  if (kind === 'analogy' || kind === 'odd') return it.o[it.a];
  if (kind === 'syl') return SYL_OPTIONS[SYL_KEY.indexOf(evalSyl(it.m))];
  return it.cal ? evalCalendar(it) : evalOrder(it).answer;
}

// ---------- набор для одного прохождения ----------
// Уровни растут: по пять заданий на каждый из трёх уровней, четыре вида вперемешку.
const PLAN = [['odd', 1], ['analogy', 1], ['syl', 1], ['order', 1], ['odd', 1], ['analogy', 2], ['odd', 2], ['syl', 2], ['order', 2], ['analogy', 2], ['syl', 3], ['analogy', 3], ['odd', 3], ['order', 3], ['syl', 3]];
export const VERBAL_PLAN = PLAN;

function build(rng, kind, it, seed) {
  const base = { v: 1, seed, id: it.id, kind, level: it.lv };
  if (kind === 'analogy') { const options = rng.shuffle(it.o); return { ...base, text: '', q: it.q, options, correct: options.indexOf(it.o[it.a]) }; }
  if (kind === 'odd') { const options = rng.shuffle(it.o); return { ...base, text: '', q: 'Какое слово или число лишнее?', options, correct: options.indexOf(it.o[it.a]) }; }
  if (kind === 'syl') return { ...base, text: it.t, q: it.q, hint: 'Опирайся только на то, что сказано в условии.', options: SYL_OPTIONS, correct: SYL_KEY.indexOf(it.a) };
  let options;
  if (it.cal) { const right = evalCalendar(it), at = WEEK.indexOf(right); options = rng.shuffle([right, ...rng.shuffle([1, -1, 2, -2, 3, -3]).slice(0, 3).map(d => WEEK[(at + d + 7) % 7])]); }
  else if (it.ask[0] === 'cmp') options = [...rng.shuffle([it.ask[1], it.ask[2], 'они равны']), CANNOT];
  else options = rng.shuffle(it.names);
  return { ...base, text: it.t, q: it.q, options, correct: options.indexOf(it.a) };
}
export function makeVerbalSet(seed, n = VERBAL_COUNT) {
  const rng = makeRng(seed), used = new Set(), out = [];
  for (const [kind, lv] of PLAN.slice(0, n)) {
    const pool = BANK[kind].filter(x => x.lv === lv && !used.has(x.id));
    const it = rng.pick(pool);
    used.add(it.id);
    out.push(build(rng, kind, it, seed));
  }
  return out;
}
