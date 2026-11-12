// Экран «С нуля» («Развитие» → «С нуля»): карта маршрутов английского, иврита и библейского иврита с нуля. Этапы и уроки со статусом (слово и значок),
// кольцо прогресса, блок «Пора повторить», «Быстрая проверка», плеер урока, проверки, входная проверка для закрытых уроков и каталог внешних курсов.
// Статусы и правила допуска считает curriculum.js (журнал записей → числа), задания и разбор — zero-kit.js; здесь только интерфейс.
import { el, fill, icon, ring, announce, focusNode, toast, dateRu } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { TRACKS, trackById, doneLessons, makeLessonDone, lessonGoal } from './academy.js';
import { STATUS_LABEL, SATISFIED, lessonStatus, routeProgress, nextLessons, reviewDue, pickSurprise, surpriseDoneToday, makeCheck, gradeCheck, makeZcheckEvent,
  placementTarget, openLessonIds, zeroLesson, lastRouteId, dueDate } from './curriculum.js';
import { lessonPage, lockedPage, runSequence } from './view-zero-lesson.js';
import { checkIntro, resultPage } from './view-zero-check.js';
import { createCatalog } from './view-zero-catalog.js';

const ROUTES = TRACKS.filter(t => t.zero);
const ST_ICON = { new: 'play', seen: 'eye', mastered: 'checkCircle', confirmed: 'shield', review: 'undo', locked: 'lock' };
const ST_HELP = {
  new: 'Урок открыт, ты его ещё не начинал.', seen: 'Ты прочитал урок, но проверку ещё не прошёл.', mastered: 'Ты прошёл проверку: урок освоен.',
  confirmed: 'Урок устоял при быстрой проверке.', review: 'Пора повторить: пройди проверку урока ещё раз.', locked: 'Сначала освой предыдущие уроки.',
};
// Статус всегда словом и значком, а не только цветом.
const badge = s => el('span', { class: `zero-st zero-st-${s}`, dataset: { status: s } }, icon(ST_ICON[s], 16), el('span', { textContent: STATUS_LABEL[s] }));
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };

export function createZeroView() {
  let events = [], routeId = null, page = 'map', dirty = false;
  const stageChoice = new Map();                                              // этап раскрыт или свёрнут по выбору человека
  const root = el('section', { id: 'view-zero', class: 'view' });
  const mapBox = el('div', { class: 'zero-stack' });
  const catalog = createCatalog({ getEvents: () => events, getTrack: () => routeTrack(), save: ev => store.save(ev), onBack: () => setPage('map') });
  const overlay = el('div', { id: 'zero-play', class: 'overlay zero-overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Урок с нуля' });
  catalog.root.hidden = true;
  root.append(mapBox, catalog.root, overlay);
  const routeTrack = () => trackById(routeId) ?? ROUTES[0];
  const now = () => Date.now();

  // ---------- окно урока и проверок ----------
  function setOverlay(label, content) {
    overlay.setAttribute('aria-label', label);
    fill(overlay, el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: label }),
      el('button', { type: 'button', id: 'zero-close', class: 'link', textContent: 'Закрыть', onclick: closeOverlay })), content);
    overlay.hidden = false;
    overlay.scrollTop = 0;
    focusNode(overlay.querySelector('.zero-title, .zero-qh') ?? overlay);
  }
  function closeOverlay() {
    overlay.hidden = true; fill(overlay);
    if (dirty) { dirty = false; render(); }
  }
  const content = (...kids) => el('div', { class: 'zero-content' }, ...kids);
  const actionRow = (...btns) => el('div', { class: 'row wrap zero-actions' }, ...btns.filter(Boolean));
  const btn = (label, onClick, { id, primary = false } = {}) => el('button', { type: 'button', id, class: primary ? 'primary' : '', textContent: label, onclick: onClick });

  // ---------- урок ----------
  function openLesson(lessonId) {
    const ref = zeroLesson(lessonId);
    if (!ref) return;
    if (ref.track.id !== routeId) { routeId = ref.track.id; if (overlay.hidden) render(); }
    const st = lessonStatus(lessonId, events, now());
    if (st.status === 'locked') showLocked(ref, st); else showLesson(ref, st);
  }
  function showLesson(ref, st) {
    const { track, lesson } = ref, s = st.status, due = dueDate(st);
    const statusLine = el('p', { class: 'zero-statusline' }, 'Статус: ', badge(s), el('span', { class: 'muted', textContent: ` ${ST_HELP[s]}` }),
      due && SATISFIED.has(s) ? el('span', { class: 'muted', textContent: s === 'review' ? ` Срок был ${dateRu(due)}.` : ` Повторить после ${dateRu(due)}.` }) : null);
    const study = s === 'new' || s === 'seen';
    setOverlay(track.title, content(lessonPage({ track, lesson, goal: lessonGoal(lesson.id) }), statusLine, actionRow(
      btn(study ? 'Начать задания' : 'Повторить задания', () => startPractice(ref), { id: 'zero-practice', primary: study }),
      btn(s === 'review' ? 'Пройти проверку: пора повторить' : 'Пройти проверку', () => startQuiz(ref), { id: 'zero-check', primary: !study }),
      s === 'new' ? btn('Отметить прочитанным', () => markSeen(ref), { id: 'zero-mark-seen' }) : null)));
  }
  async function markSeen({ track, lesson }) {
    try { if (!doneLessons(events).has(lesson.id)) await store.save(makeLessonDone(track, lesson, todayStr())); toast('Урок отмечен прочитанным. Освоенным он станет после проверки.'); openLesson(lesson.id); }
    catch (e) { toast(e.message); }
  }
  function startPractice(ref) {
    const { track, lesson } = ref, box = content();
    setOverlay(track.title, box);
    runSequence(box, lesson.drills, { seed: now(), lang: track.lang, label: 'Задание', onFinish: results => finishPractice(ref, box, results) });
  }
  async function finishPractice(ref, box, results) {
    const { track, lesson } = ref, graded = results.filter(r => r.correct !== null), good = graded.filter(r => r.correct && !r.hinted).length;
    try { if (!doneLessons(events).has(lesson.id)) await store.save(makeLessonDone(track, lesson, todayStr())); } catch (e) { toast(e.message); }
    const chk = makeCheck(lesson, 'quiz', 1), needN = Math.ceil(chk.n * chk.pass - 1e-9);
    fill(box, el('div', { class: 'zero-lesson zero-practice-done' },
      el('h3', { class: 'zero-title', tabIndex: -1, textContent: 'Задания пройдены' }),
      el('p', { class: 'zero-score', textContent: `Верно без подсказок: ${good} из ${graded.length}` }),
      el('p', { textContent: `Урок отмечен как «${STATUS_LABEL.seen.toLowerCase()}». Чтобы он стал освоенным, пройди проверку: ${chk.n} заданий, нужно ${needN} верных без подсказок.` }),
      actionRow(btn('Пройти проверку', () => startQuiz(ref), { id: 'zero-to-check', primary: true }), btn('К карте', closeOverlay))));
    announce(`Задания пройдены. Верно без подсказок: ${good} из ${graded.length}`);
    focusNode(box.querySelector('.zero-title'));
  }

  // ---------- закрытый урок и входная проверка ----------
  function showLocked(ref, st) {
    const missing = st.missing.map(id => { const r = zeroLesson(id); return r ? { lesson: r.lesson, status: lessonStatus(id, events, now()).status } : null; }).filter(Boolean);
    setOverlay(ref.track.title, content(lockedPage({ lesson: ref.lesson, missing, labelOf: s => STATUS_LABEL[s], onPlacement: () => startPlacement(ref), onOpenMissing: id => openLesson(id) })));
  }
  function startPlacement(origin) {
    const tid = placementTarget(origin.lesson.id, events, now());
    if (!tid) { toast('Этот урок уже открыт'); openLesson(origin.lesson.id); return; }
    startQuiz(zeroLesson(tid), 'placement', origin);
  }

  // ---------- проверки: после урока, входная, быстрая ----------
  function startQuiz(ref, kind = 'quiz', origin = null) {
    const chk = makeCheck(ref.lesson, kind, now());
    if (chk.n < chk.minN) { toast('В этом уроке пока мало заданий для проверки'); return; }
    if (kind === 'surprise') return runCheck(ref, chk, origin);
    setOverlay(kind === 'placement' ? 'Входная проверка' : 'Проверка', content(checkIntro({ kind, lesson: ref.lesson, chk, onStart: () => runCheck(ref, chk, origin) })));
  }
  function runCheck(ref, chk, origin) {
    const box = content();
    setOverlay(chk.kind === 'surprise' ? 'Быстрая проверка' : chk.kind === 'placement' ? 'Входная проверка' : 'Проверка', box);
    runSequence(box, chk.items, { seed: chk.seed, lang: ref.track.lang, label: 'Вопрос', onFinish: results => finishCheck(ref, chk, box, results, origin) });
  }
  async function finishCheck(ref, chk, box, results, origin) {
    const { track, lesson } = ref, t = now();
    const grade = gradeCheck(chk.items, results.map(r => r.answer), results.map(r => r.hinted), { pass: chk.pass, minN: chk.minN });
    const ev = makeZcheckEvent(track, lesson, chk.kind, { n: grade.n, ok: grade.ok, hints: grade.hints }, t);
    const openBefore = openLessonIds(events, t);
    try { await store.save(ev); } catch (e) { toast(`Не удалось сохранить результат: ${e.message}`); return; }
    const evs = events.some(e => e.id === ev.id) ? events : [...events, ev];
    const after = lessonStatus(lesson.id, evs, t);
    const opened = [...openLessonIds(evs, t)].filter(id => !openBefore.has(id)).map(id => zeroLesson(id).lesson);
    const next = nextLessons(track, evs, t)[0];
    const actions = [];
    if (chk.kind === 'placement') {
      const more = grade.passed && origin ? placementTarget(origin.lesson.id, evs, t) : null;
      if (grade.passed && more) actions.push({ id: 'zero-next-placement', label: `Проверить следующий: ${zeroLesson(more).lesson.title}`, primary: true, onClick: () => startPlacement(origin) });
      else if (grade.passed && origin) actions.push({ id: 'zero-open-origin', label: `Открыть урок «${origin.lesson.title}»`, primary: true, onClick: () => openLesson(origin.lesson.id) });
      else if (!grade.passed) actions.push({ id: 'zero-open-target', label: `Открыть урок «${lesson.title}»`, primary: true, onClick: () => openLesson(lesson.id) });
    } else if (chk.kind === 'surprise') {
      if (!grade.passed) actions.push({ id: 'zero-open-lesson', label: 'Открыть урок', primary: true, onClick: () => openLesson(lesson.id) });
    } else if (grade.passed) {
      if (next) actions.push({ id: 'zero-open-next', label: `Следующий урок: ${next.title}`, primary: true, onClick: () => openLesson(next.id) });
    } else {
      actions.push({ id: 'zero-reread', label: 'Перечитать урок', primary: true, onClick: () => openLesson(lesson.id) }, { id: 'zero-retry', label: 'Проверка ещё раз', onClick: () => startQuiz(ref) });
    }
    actions.push({ id: 'zero-to-map', label: 'К карте', primary: !actions.length, onClick: closeOverlay });
    const lessonShown = chk.kind === 'surprise' || chk.kind === 'placement' ? lesson : lesson;
    fill(box, resultPage({ kind: chk.kind, lesson: lessonShown, grade, pass: chk.pass, after, opened, actions, badge }));
    announce(`${grade.passed ? 'Проверка пройдена' : 'Проверка не пройдена'}. Верно без подсказок: ${grade.ok} из ${grade.n}. Статус урока: ${STATUS_LABEL[after.status]}`);
    focusNode(box.querySelector('.zero-title'));
  }
  function quickCheck() {
    const sp = pickSurprise(events, now(), now());
    if (!sp) { toast(surpriseDoneToday(events, now()) ? 'Сегодня быстрая проверка уже была' : 'Пока проверять нечего: освой урок и вернись через сутки'); return; }
    runCheck({ track: sp.track, lesson: sp.lessonRef }, sp, null);
  }

  // ---------- карта маршрута ----------
  function introCard() {
    return el('div', { class: 'card zero-intro-card' },
      el('p', { textContent: 'Английский и иврит с самого начала: звуки, буквы, чтение. Уроки открываются по порядку. «Освоено» ставится только после проверки, а не за прочитанный текст.' }),
      el('details', { class: 'zero-how' }, el('summary', { textContent: 'Как это работает и чего мы не обещаем' }),
        el('ul', { class: 'plain zero-status-help' }, ...Object.keys(ST_ICON).map(s => el('li', {}, badge(s), el('span', { textContent: ` ${ST_HELP[s]}` })))),
        el('ul', { class: 'plain' },
          el('li', { textContent: 'Если ты уже умеешь тему, открой закрытый урок и нажми «Я уже умею это: проверить».' }),
          el('li', { textContent: 'Быстрая проверка: несколько случайных вопросов из освоенного. Она может подтвердить урок или вернуть его на повторение.' }),
          el('li', { textContent: 'Подсказка помогает учиться, но ответ с подсказкой в проверке не засчитывается.' }),
          el('li', { textContent: 'Курсы написаны с помощью ИИ, их не проверял преподаватель-носитель языка. Покажи курс учителю, если можешь.' }),
          el('li', { textContent: 'Озвучка использует голос телефона. Если голоса нет, уроки проходятся по тексту. Приложение не слушает микрофон и не оценивает произношение.' }),
          el('li', { textContent: '«Освоено» значит, что ты прошёл проверку. Это не уровень владения языком.' }))));
  }
  function routeSwitch() {
    return el('div', { class: 'chips zero-routes', role: 'group', 'aria-label': 'Маршрут' }, ...ROUTES.map(t => el('button', { type: 'button', class: 'chip', dataset: { route: t.id }, 'aria-pressed': String(t.id === routeTrack().id), textContent: t.title,
      onclick: () => { routeId = t.id; render(); mapBox.querySelector(`[data-route="${t.id}"]`)?.focus({ preventScroll: true }); announce(`Маршрут: ${t.title}`); } })));
  }
  function progressCard(track, p) {
    const pct = Math.round(p.fraction * 100), c = p.counts;
    return el('div', { class: 'card zero-progress-card' },
      el('div', { class: 'row zero-ringrow' }, ring(p.fraction, { size: 84, stroke: 9, label: `${pct}%`, name: 'Освоено в маршруте' }),
        el('div', { class: 'grow' }, el('h3', { textContent: track.title }),
          el('p', { id: 'zero-summary', textContent: `Освоено уроков: ${p.done} из ${p.total}` }),
          el('p', { class: 'muted', textContent: `Просмотрено: ${c.seen} · Новых: ${c.new} · Закрыто: ${c.locked}${p.due ? ` · Пора повторить: ${p.due}` : ''}` }))),
      el('p', { class: 'muted', textContent: track.intro }),
      p.next ? btn(`Продолжить: ${p.next.title}`, () => openLesson(p.next.id), { id: 'zero-continue', primary: true })
        : el('p', { class: 'ok', textContent: p.total && p.done === p.total ? 'Весь маршрут освоен.' : 'Следующий урок откроется после проверки.' }));
  }
  function dueCard(due) {
    return el('div', { class: 'card calm zero-due', id: 'zero-due' }, el('h3', { textContent: `Пора повторить: ${due.length}` }),
      el('p', { class: 'muted', textContent: 'Срок повторения вышел. Пройди проверку урока ещё раз, и он останется освоенным.' }),
      el('ul', { class: 'plain zero-due-list' }, ...due.slice(0, 5).map(d => el('li', { class: 'row' }, el('span', { class: 'grow' }, el('strong', { textContent: d.lesson.title }), el('span', { class: 'muted', textContent: ` · ${d.track.title}` })),
        el('button', { type: 'button', class: 'chip', dataset: { due: d.lesson.id }, 'aria-label': `Повторить: ${d.lesson.title}`, textContent: 'Повторить', onclick: () => openLesson(d.lesson.id) })))),
      due.length > 5 ? el('p', { class: 'muted', textContent: `И ещё ${due.length - 5} ${plural(due.length - 5, 'урок', 'урока', 'уроков')} в маршрутах ниже.` }) : null);
  }
  function quickCard() {
    const t = now(), done = surpriseDoneToday(events, t), ready = !done && !!pickSurprise(events, t, t);
    return el('div', { class: 'card zero-quick' }, el('h3', { textContent: 'Быстрая проверка' }),
      el('p', { class: 'muted', textContent: done ? 'Сегодня быстрая проверка уже была. Следующая будет завтра.' : ready ? 'Несколько случайных вопросов из того, что ты уже освоил. Не чаще одного раза в день.' : 'Пока проверять нечего: освой урок и вернись через сутки.' }),
      el('button', { type: 'button', id: 'zero-quick', class: ready ? 'primary' : '', disabled: !ready, textContent: 'Быстрая проверка', onclick: quickCheck }));
  }
  function lessonRow(l, st, n) {
    return el('li', {}, el('button', { type: 'button', id: `zero-row-${l.id}`, class: `zero-row zero-row-${st.status}`, dataset: { lesson: l.id, status: st.status }, onclick: () => openLesson(l.id) },
      el('span', { class: 'zero-n', textContent: String(n) }),
      el('span', { class: 'zero-rt' }, el('strong', { textContent: l.title }), el('span', { class: 'muted', textContent: `${l.minutes} мин` })),
      badge(st.status)));
  }
  function stageCard(track, g, p, startIdx) {
    const key = `${track.id}:${g.name}`, current = p.next && g.lessons.some(x => x.lesson.id === p.next.id), anyDue = g.lessons.some(x => x.st.status === 'review');
    const open = stageChoice.has(key) ? stageChoice.get(key) : current || anyDue || (!p.next && g === p.stages[0]);
    const d = el('details', { class: 'card zero-stage', dataset: { stage: g.name }, open }, el('summary', {}, el('strong', { textContent: g.name }), el('span', { class: 'muted', textContent: ` — освоено ${g.done} из ${g.lessons.length}` })),
      el('ul', { class: 'zero-list plain' }, ...g.lessons.map((x, i) => lessonRow(x.lesson, x.st, startIdx + i + 1))));
    d.addEventListener('toggle', () => stageChoice.set(key, d.open));
    return d;
  }
  function render() {
    const track = routeTrack(), t = now(), p = routeProgress(track, events, t);
    let idx = 0;
    fill(mapBox, introCard(), routeSwitch(), progressCard(track, p), (() => { const due = reviewDue(events, t); return due.length ? dueCard(due) : null; })(), quickCard(),
      btn('Внешние курсы и материалы', () => setPage('catalog'), { id: 'zero-catalog-open' }),
      ...p.stages.map(g => { const c = stageCard(track, g, p, idx); idx += g.lessons.length; return c; }));
    if (page === 'catalog') catalog.draw();
  }
  function setPage(p) {
    page = p; mapBox.hidden = p !== 'map'; catalog.root.hidden = p !== 'catalog';
    if (p === 'catalog') { catalog.draw(); catalog.focusTitle(); } else { render(); mapBox.querySelector('#zero-catalog-open')?.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }

  return {
    root,
    update(evs) {
      events = evs;
      if (!evs.length && !overlay.hidden) { overlay.hidden = true; fill(overlay); }                      // приложение заблокировано: окно закрываем
      if (!overlay.hidden) { dirty = true; return; }                                                      // карту обновим, когда закроют окно (фокус внутри окна не трогаем)
      if (!root.hidden) render();
    },
    show() {
      if (!routeId) routeId = lastRouteId(events) ?? ROUTES[0].id;
      page = 'map'; mapBox.hidden = false; catalog.root.hidden = true;
      render();
    },
    // открыть маршрут и урок (из поиска)
    open(trackId, lessonId = null) {
      if (trackById(trackId)?.zero) routeId = trackId;
      page = 'map'; mapBox.hidden = false; catalog.root.hidden = true;
      render();
      if (lessonId) openLesson(lessonId);
    },
  };
}
