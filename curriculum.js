// Движок курсов «с нуля»: статусы уроков, допуск (gating), прогресс маршрута, проверки и неожиданные проверки.
// Чистая логика: журнал записей → числа и списки; ни интерфейса, ни хранилища. Отдельно ничего не хранится:
// статус урока считается из записей `lesson` (прочитано) и `zcheck` (попытки проверки). Правила: docs/CURRICULUM_ENGINE.md, разделы 5 и 6.
import { TRACKS } from './academy.js';
import { checkOf, pickCheckItems, gradeDrill, lessonIndex, CHECK_DEFAULT, GRADED, shuffled, SPIRAL_MAX } from './zero-kit.js';
import { todayStr } from './events.js';
import { makeRng } from './stats.js';

export const STATUS_LABEL = { seen: 'Просмотрено', mastered: 'Освоено', confirmed: 'Подтверждено', review: 'Пора повторить', locked: 'Закрыто', new: 'Новый' };
export const STATUS_ORDER = ['locked', 'new', 'seen', 'mastered', 'confirmed', 'review'];
export const SATISFIED = new Set(['mastered', 'confirmed', 'review']);      // эти статусы открывают следующие уроки
export const CHECK_KINDS = ['quiz', 'surprise', 'placement'];
export const INTERVAL_DAYS = [3, 7, 16, 35, 77];                             // через сколько дней повторять после 1-й, 2-й… успешной проверки подряд (делится на decay урока)
export const DAY_MS = 86400000;
export const MIN_N = 5;                                                      // освоение доказывают проверкой хотя бы из пяти заданий
export const SURPRISE_MIN_N = 3;                                             // неожиданная проверка короче: три или четыре вопроса
export const MASTERY_EVIDENCE = { quiz: 'проверка', surprise: 'проверка', placement: 'входная проверка' };
export const KIND_LABEL = { choose: 'выбор варианта', listen: 'на слух', typed: 'вписать слово', order: 'собрать из плиток', match: 'соединить пары' };
// Слабый вид задания: по нему есть хотя бы столько ответов и доля ошибок выше этой границы (см. weakKinds).
export const WEAK_MIN_N = 3, WEAK_ERR = 0.3;

let cachedIndex = null;
const defaultIndex = () => (cachedIndex ??= lessonIndex(TRACKS));
export const zeroTracks = (tracks = TRACKS) => tracks.filter(t => t.zero === true);

// «Хватает ли верных»: ok из n при пороге pass. Сравнение целыми числами, без ошибок округления дробей.
const enough = (ok, n, pass) => n > 0 && ok >= Math.ceil(n * pass - 1e-9);

// ---------- записи журнала ----------
function ledgerOf(events) {
  const seen = new Set(), checks = new Map();
  for (const e of events ?? []) {
    const p = e?.payload;
    if (!p) continue;
    if (e.type === 'lesson') seen.add(p.lesson);
    else if (e.type === 'zcheck' && typeof p.lesson === 'string' && CHECK_KINDS.includes(p.kind) && Number.isInteger(p.n) && p.n > 0 && Number.isInteger(p.ok) && p.ok >= 0 && p.ok <= p.n) {
      if (!checks.has(p.lesson)) checks.set(p.lesson, []);
      checks.get(p.lesson).push({ id: e.id, ts: Number(e.ts) || 0, kind: p.kind, n: p.n, ok: p.ok, hints: Number.isInteger(p.hints) ? p.hints : 0, date: p.date });
    }
  }
  for (const list of checks.values()) list.sort((a, b) => a.ts - b.ts || String(a.id).localeCompare(String(b.id)));
  return { seen, checks };
}

// Статус урока только по его собственным записям (без допуска). Последняя проверка решает: провал возвращает урок в «Просмотрено».
function evaluate(lesson, led, now) {
  const ck = checkOf(lesson), mine = led.checks.get(lesson.id) ?? [], hasLesson = led.seen.has(lesson.id);
  const decay = Math.min(3, Math.max(0.5, Number(lesson.decay) || 1));
  let passes = 0, masteredAt = null, countedAt = null, lastPassAt = null, confirmedAt = null, proof = null, best = null;
  for (const c of mine) {
    best = Math.max(best ?? 0, c.ok / c.n);
    const pass = c.n >= (c.kind === 'surprise' ? SURPRISE_MIN_N : MIN_N) && enough(c.ok, c.n, ck.pass);
    if (!pass) { passes = 0; masteredAt = countedAt = lastPassAt = confirmedAt = proof = null; continue; }
    if (passes === 0) {
      if (c.kind === 'surprise') continue;                                     // неожиданная проверка (3–4 вопроса) освоить урок не может: она подтверждает уже освоенное
      passes = 1; masteredAt = countedAt = c.ts;
    } else if (c.ts - countedAt >= DAY_MS) { passes++; countedAt = c.ts; }     // повтор в тот же день не считается следующей ступенью (иначе интервал можно «накрутить»)
    lastPassAt = c.ts; proof = c;
    if (c.kind === 'surprise' && c.ts - masteredAt >= DAY_MS) confirmedAt = c.ts;   // неожиданная проверка не раньше чем через сутки после освоения
  }
  const dueAt = passes ? lastPassAt + (INTERVAL_DAYS[Math.min(passes, INTERVAL_DAYS.length) - 1] / decay) * DAY_MS : null;
  let status;
  if (passes) status = now > dueAt ? 'review' : confirmedAt !== null ? 'confirmed' : 'mastered';
  else status = hasLesson || mine.some(c => c.kind !== 'placement') ? 'seen' : 'new';       // неудачная входная проверка урок «просмотренным» не делает
  return { status, best, attempts: mine.length, lastAt: mine.length ? mine.at(-1).ts : null, dueAt, passes, masteredAt, lastPassAt, confirmedAt, seen: hasLesson, proof: proof && { kind: proof.kind, ok: proof.ok, n: proof.n, ts: proof.ts, date: proof.date ?? todayStr(proof.ts) } };
}

function resolver(events, now, index) {
  const led = ledgerOf(events), base = new Map();
  const baseOf = id => { if (!base.has(id)) { const e = index.get(id); base.set(id, e ? evaluate(e.lesson, led, now) : null); } return base.get(id); };
  // Закрытым считается только не начатый урок: если предпосылки не освоены, а записей по уроку нет. Начатый урок заново не закрывается.
  const full = id => {
    const b = baseOf(id);
    if (!b) return { status: 'locked', best: null, attempts: 0, lastAt: null, dueAt: null, passes: 0, missing: [] };
    const missing = (index.get(id).lesson.needs ?? []).filter(n => !SATISFIED.has(baseOf(n)?.status));
    return { ...b, status: b.status === 'new' && missing.length ? 'locked' : b.status, missing };
  };
  return { full, baseOf };
}

// ---------- статус урока и допуск ----------
// → { status, best (лучшая доля верных 0..1 или null), attempts, lastAt (время последней проверки), dueAt (когда пора повторять, мс или null),
//     passes (успешных проверок подряд), missing[] (не освоенные предпосылки), seen, masteredAt, confirmedAt, proof }
export function lessonStatus(lessonId, events, now = Date.now(), index = defaultIndex()) { return resolver(events, now, index).full(lessonId); }
export const isUnlocked = (lessonId, events, now = Date.now(), index = defaultIndex()) => lessonStatus(lessonId, events, now, index).status !== 'locked';
export const dueDate = st => (st?.dueAt ? todayStr(st.dueAt) : null);

// Статусы всех уроков маршрутов «с нуля» за один проход по журналу (экран карты).
export function statusMap(events, now = Date.now(), index = defaultIndex()) {
  const r = resolver(events, now, index), out = new Map();
  for (const [id, e] of index) if (e.track.zero) out.set(id, r.full(id));
  return out;
}
// Уроки «с нуля», содержимое которых можно показывать (поиск по урокам использует это, чтобы не раскрывать закрытое).
export function openLessonIds(events, now = Date.now(), index = defaultIndex()) {
  const out = new Set();
  for (const [id, st] of statusMap(events, now, index)) if (st.status !== 'locked') out.add(id);
  return out;
}

// Прогресс маршрута: счётчики по статусам, доля освоенного для кольца, этапы с уроками и их статусами.
export function routeProgress(track, events, now = Date.now(), index = defaultIndex()) {
  const r = resolver(events, now, index);
  const counts = { locked: 0, new: 0, seen: 0, mastered: 0, confirmed: 0, review: 0 };
  const stages = [];
  let next = null;
  for (const lesson of track.lessons) {
    const st = r.full(lesson.id);
    counts[st.status]++;
    let g = stages.at(-1);
    if (!g || g.name !== lesson.stage) { g = { name: lesson.stage || 'Уроки', lessons: [], done: 0 }; stages.push(g); }
    g.lessons.push({ lesson, st });
    if (SATISFIED.has(st.status)) g.done++;
    if (!next && (st.status === 'new' || st.status === 'seen')) next = lesson;
  }
  const total = track.lessons.length, done = counts.mastered + counts.confirmed + counts.review;
  return { track, total, counts, done, fraction: total ? done / total : 0, due: counts.review, stages, next };
}

// Ближайшие открытые уроки маршрута (новые или просмотренные), в порядке списка.
export function nextLessons(track, events, now = Date.now(), index = defaultIndex(), limit = 3) {
  const r = resolver(events, now, index), out = [];
  for (const lesson of track.lessons) {
    const s = r.full(lesson.id).status;
    if (s === 'new' || s === 'seen') out.push(lesson);
    if (out.length >= limit) break;
  }
  return out;
}

// Уроки, которым пора повторение: самые просроченные первыми.
export function reviewDue(events, now = Date.now(), index = defaultIndex()) {
  const out = [];
  for (const [id, st] of statusMap(events, now, index)) if (st.status === 'review') { const e = index.get(id); out.push({ track: e.track, lesson: e.lesson, dueAt: st.dueAt, status: st }); }
  return out.sort((a, b) => a.dueAt - b.dueAt || a.lesson.id.localeCompare(b.lesson.id));
}

// Первая недостающая предпосылка закрытого урока: её и проверяет «Я уже умею это». Обход вглубь: берём самую раннюю, у которой все свои предпосылки уже освоены,
// поэтому её содержимое открыто и допуск не нарушается. null — урок открыт или предпосылок нет.
export function placementTarget(lessonId, events, now = Date.now(), index = defaultIndex()) {
  const r = resolver(events, now, index), visited = new Set();
  const walk = id => {
    if (visited.has(id)) return null;
    visited.add(id);
    for (const n of index.get(id)?.lesson.needs ?? []) { const hit = walk(n); if (hit) return hit; }
    return id !== lessonId && index.has(id) && !SATISFIED.has(r.baseOf(id).status) ? id : null;
  };
  return r.full(lessonId).status === 'locked' ? walk(lessonId) : null;
}

// ---------- проверки ----------
// Проверка урока: набор заданий зависит от зерна (одно зерно — один набор). quiz и placement — не меньше пяти заданий, surprise — три или четыре.
// opts.spiral — задания из ранее освоенных уроков того же этапа (см. spiralPool): подмешивается немного, «спиральная проверка».
// opts.weak — слабые виды заданий (см. weakKinds): их виды получают небольшой приоритет (вес 1 + доля ошибок). Выбор детерминирован зерном.
export function makeCheck(lesson, kind = 'quiz', seed = 0, opts = {}) {
  if (!CHECK_KINDS.includes(kind)) throw new Error('Неизвестный вид проверки');
  const ck = checkOf(lesson), s = Math.abs(Math.floor(Number(seed) || 0));
  const want = kind === 'surprise' ? SURPRISE_MIN_N + (s % 2) : Math.max(MIN_N, ck.n);
  const weak = (Array.isArray(opts.weak) ? opts.weak : []).filter(x => GRADED.has(x?.kind) && Number.isFinite(x?.err));
  const items = weak.length ? pickWeighted(lesson, s, want, weak, opts.spiral) : pickCheckItems(lesson, s, want, { spiral: opts.spiral });
  return { kind, lesson: lesson.id, seed: s, n: items.length, pass: ck.pass, minN: kind === 'surprise' ? SURPRISE_MIN_N : MIN_N, items };
}

// Взвешенный отбор: вид задания с большей долей ошибок чаще попадает в проверку. То же зерно и те же веса — тот же набор.
function pickWeighted(lesson, seed, n, weak, spiral) {
  const w = new Map(weak.map(x => [x.kind, 1 + x.err]));
  const r = makeRng(seed);
  const clean = (Array.isArray(spiral) ? spiral : []).filter(d => d && GRADED.has(d.t));
  const take = Math.min(SPIRAL_MAX, Math.floor(n / 3), clean.length);
  const pool = shuffled((lesson.drills ?? []).filter(d => GRADED.has(d.t)), seed);
  const byKind = new Map();
  for (const d of pool) { if (!byKind.has(d.t)) byKind.set(d.t, []); byKind.get(d.t).push(d); }
  const mine = [], need = n - take;
  while (mine.length < need && [...byKind.values()].some(v => v.length)) {
    const open = [...byKind.entries()].filter(([, v]) => v.length);
    const total = open.reduce((sum, [k]) => sum + (w.get(k) ?? 1), 0);
    let x = r() * total, chosen = open.at(-1);
    for (const kv of open) { x -= (w.get(kv[0]) ?? 1); if (x <= 0) { chosen = kv; break; } }
    mine.push(chosen[1].shift());
  }
  if (!take) return mine;
  return shuffled([...mine, ...shuffled(clean, seed).slice(0, take)], seed);
}

// Задания для «спиральной» подмеши: проверяемые задания из ранее освоенных уроков того же этапа того же маршрута.
// Их содержимое уже выучено, поэтому оно внутри области допуска. Сам урок, не освоенные и другие этапы не входят.
export function spiralPool(lesson, events, now = Date.now(), index = defaultIndex()) {
  const me = index.get(lesson?.id);
  if (!me) return [];
  const r = resolver(events, now, index), out = [];
  for (const l of me.track.lessons) {
    if (l.id === lesson.id || l.stage !== lesson.stage) continue;
    if (!SATISFIED.has(r.full(l.id).status)) continue;
    out.push(...(l.drills ?? []).filter(d => GRADED.has(d.t)));
  }
  return out;
}

// Слабые виды заданий по записям zcheck (чистая функция): вид слабый, если по нему есть хотя бы WEAK_MIN_N ответов
// и доля ошибок больше WEAK_ERR. → [{ kind, ok, n, err }] по убыванию доли ошибок. Записи без byKind пропускаются.
export function weakKinds(zchecks) {
  const agg = new Map();
  for (const e of zchecks ?? []) {
    const bk = e?.payload?.byKind;
    if (!bk || typeof bk !== 'object') continue;
    for (const [k, v] of Object.entries(bk)) {
      if (!GRADED.has(k) || !v || !Number.isInteger(v.n) || !Number.isInteger(v.ok) || v.n <= 0 || v.ok < 0 || v.ok > v.n) continue;
      const a = agg.get(k) ?? { ok: 0, n: 0 };
      a.ok += v.ok; a.n += v.n; agg.set(k, a);
    }
  }
  return [...agg.entries()]
    .map(([kind, a]) => ({ kind, ok: a.ok, n: a.n, err: 1 - a.ok / a.n }))
    .filter(x => x.n >= WEAK_MIN_N && x.err > WEAK_ERR + 1e-9)      // 1e-9: «ровно 30 %» (0,30000000000000004 из-за дробей) слабым не считается
    .sort((x, y) => y.err - x.err || x.kind.localeCompare(y.kind));
}

const hintAt = (hints, i) => (hints instanceof Set ? hints.has(i) : !!hints?.[i]);
// answers[i] — ответ на items[i] (как в gradeDrill); hints — массив отметок «подсказкой пользовались» или Set номеров.
// Ответ с подсказкой не засчитывается. → { n, ok (верных без подсказок), hints (сколько раз брали подсказку), passed, detail[],
// byKind: разбивка по видам заданий { choose: { ok, n }, … } — только встретившиеся проверяемые виды (идёт в запись zcheck).
export function gradeCheck(items, answers = [], hints = [], { pass = CHECK_DEFAULT.pass, minN = MIN_N } = {}) {
  let ok = 0, used = 0;
  const byKind = {};
  const detail = items.map((d, i) => {
    const right = gradeDrill(d, answers?.[i]) === true, hinted = hintAt(hints, i);
    if (hinted) used++;
    const counts = right && !hinted;
    if (counts) ok++;
    if (GRADED.has(d.t)) { const b = byKind[d.t] ??= { ok: 0, n: 0 }; b.n++; if (counts) b.ok++; }
    return { right, hinted, counts };
  });
  return { n: items.length, ok, hints: used, passed: items.length >= minN && enough(ok, items.length, pass), detail, byKind };
}

// Неожиданная проверка (раздел 5): не чаще одной в сутки, 3–4 вопроса из уже освоенного урока (освоен не меньше суток назад), сначала те, что «пора повторить».
// Какой урок и что это зачётная проверка, интерфейс заранее не показывает. null — сегодня уже была или проверять пока нечего.
export const surpriseDoneToday = (events, now = Date.now()) => {
  const day = todayStr(now);
  return (events ?? []).some(e => e?.type === 'zcheck' && e.payload?.kind === 'surprise' && (e.payload.date === day || todayStr(Number(e.ts) || 0) === day));
};
export function pickSurprise(events, now = Date.now(), seed = 0, index = defaultIndex()) {
  if (surpriseDoneToday(events, now)) return null;
  const r = resolver(events, now, index), cands = [];
  for (const [id, e] of index) {
    if (!e.track.zero) continue;
    const st = r.full(id);
    if (SATISFIED.has(st.status) && now - st.lastPassAt >= DAY_MS && (e.lesson.drills ?? []).length) cands.push({ ...e, st });
  }
  const due = cands.filter(c => c.st.status === 'review').sort((a, b) => a.st.dueAt - b.st.dueAt || a.lesson.id.localeCompare(b.lesson.id));
  const pool = due.length ? due : cands.sort((a, b) => a.lesson.id.localeCompare(b.lesson.id));
  const s = Math.abs(Math.floor(Number(seed) || 0));
  // Слабые виды заданий маршрута получают небольшой приоритет (считается один раз на маршрут, выбор детерминирован зерном).
  const zc = (events ?? []).filter(e => e?.type === 'zcheck'), weakOf = new Map();
  const weakFor = tid => { if (!weakOf.has(tid)) weakOf.set(tid, weakKinds(zc.filter(e => e.payload?.track === tid))); return weakOf.get(tid); };
  for (let k = 0; k < pool.length; k++) {
    const pick = due.length ? pool[k] : pool[(s + k) % pool.length];
    const chk = makeCheck(pick.lesson, 'surprise', s, { weak: weakFor(pick.track.id) });
    if (chk.n >= SURPRISE_MIN_N) return { ...chk, track: pick.track, lessonRef: pick.lesson, reason: due.length ? 'review' : 'random' };
  }
  return null;
}

// Запись о попытке (раздел 6): source = вид, confidence = доля верных без подсказок, evidence — результат теста. track/lesson — объекты или id.
// byKind (необязательно, ADR-10: поле только добавлено) — разбивка результата по видам заданий { choose: { ok, n }, … };
// принимаются только проверяемые виды с целыми 0 ≤ ok ≤ n, остальное отбрасывается.
export function makeZcheckEvent(track, lesson, kind, { n, ok, hints = 0, byKind = null }, now = Date.now()) {
  const trackId = typeof track === 'string' ? track : track.id, lessonId = typeof lesson === 'string' ? lesson : lesson.id;
  if (!CHECK_KINDS.includes(kind)) throw new Error('Неизвестный вид проверки');
  if (!(Number.isInteger(n) && n >= 1 && Number.isInteger(ok) && ok >= 0 && ok <= n && Number.isInteger(hints) && hints >= 0 && hints <= n)) throw new Error('Результат проверки указан неверно');
  const payload = { track: trackId, lesson: lessonId, kind, n, ok, hints, date: todayStr(now) };
  const clean = {};
  if (byKind && typeof byKind === 'object') for (const [k, v] of Object.entries(byKind)) {
    if (GRADED.has(k) && v && Number.isInteger(v.n) && v.n > 0 && Number.isInteger(v.ok) && v.ok >= 0 && v.ok <= v.n) clean[k] = { ok: v.ok, n: v.n };
  }
  if (Object.keys(clean).length) payload.byKind = clean;
  return { id: `zc:${lessonId}:${now.toString(36)}`, type: 'zcheck', ts: now, payload,
    source: kind, confidence: ok / n, evidence: [{ kind: 'test_result', ref: `${lessonId}:${ok}/${n}` }] };
}

// ---------- навыки и отметки ----------
// Подтверждение для «Навыков»: «проверка 6/6, ГГГГ-ММ-ДД» (у входной проверки — «входная проверка …»).
export function proofText(st) { const p = st?.proof; return p ? `${MASTERY_EVIDENCE[p.kind]} ${p.ok}/${p.n}, ${p.date}` : ''; }
// Освоенные уроки маршрутов «с нуля» (в том числе те, которым пора повторение): их можно предложить как навыки.
export function masteredZero(events, now = Date.now(), index = defaultIndex()) {
  const out = [];
  for (const [id, st] of statusMap(events, now, index)) if (SATISFIED.has(st.status) && st.proof) { const e = index.get(id); out.push({ track: e.track, lesson: e.lesson, st }); }
  return out;
}
// Маршрут, которым занимались последним (по последней записи урока или проверки); null — ещё не начинали.
export function lastRouteId(events, index = defaultIndex()) {
  let best = null;
  for (const e of events ?? []) {
    if ((e?.type !== 'lesson' && e?.type !== 'zcheck') || !e.payload) continue;
    const t = index.get(e.payload.lesson)?.track;
    if (t?.zero && (!best || e.ts >= best.ts)) best = { id: t.id, ts: e.ts };
  }
  return best?.id ?? null;
}
// Урок «с нуля» по id вместе с курсом.
export const zeroLesson = (lessonId, index = defaultIndex()) => { const e = index.get(lessonId); return e?.track.zero ? e : null; };
