// Экран «Учёба»: курсы (уроки + наставник), повторение карточек, свои карточки.
import { el, toast } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { TRACKS, trackById, trackProgress, doneLessons, makeLessonDone, lessonEventId, makeSrsEvent, makeUserCard, userCards, sessionQueue, todayLoad, studyDates, MY_TRACK } from './academy.js';
import { newState, grade, studyStreak, INTERVALS } from './srs.js';

const QUALITY_LABEL = { again: 'Забыл', hard: 'Трудно', good: 'Помню' };

function copyText(text) {
  const done = () => toast('Скопировано. Вставь в чат с ИИ-помощником.');
  const fallback = () => {
    const ta = el('textarea', { value: text, readOnly: true }); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('Не удалось скопировать — выдели текст вручную.'); }
    ta.remove();
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}

export function createLearnView() {
  let events = [];
  let page = { name: 'home' };
  let session = null;
  const openLessons = new Set();
  const root = el('section', { id: 'view-learn', class: 'view' });
  const overlay = el('div', { id: 'sess', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Повторение' });
  const mount = (...nodes) => root.replaceChildren(...nodes.filter(Boolean), overlay);     // окно повторения живёт внутри экрана (шторка приватности его тоже скрывает)
  const today = () => todayStr();

  // ---------- общие куски ----------
  const bar = (value, total) => el('div', { class: 'bar', role: 'img', 'aria-label': `${value} из ${total}` }, el('span', { style: `width:${total ? Math.round((value / total) * 100) : 0}%` }));
  const go = p => { page = p; render(); window.scrollTo(0, 0); };

  // ---------- главная ----------
  function renderHome() {
    const t0 = today();
    const load = todayLoad(events, t0);
    const streak = studyStreak(studyDates(events), t0);
    const total = load.due + load.fresh;
    const head = el('div', { class: 'card', id: 'learn-today' },
      el('h3', { textContent: 'Повторение на сегодня' }),
      el('p', { class: 'big', id: 'learn-count', textContent: String(total) }),
      el('p', { class: 'muted', textContent: total ? `к повторению: ${load.due} · новых: ${load.fresh}` : 'На сегодня всё повторено ✓' }),
      el('p', { class: 'muted', id: 'learn-streak', textContent: streak ? `Занятий подряд: ${streak} дн.` : 'Занимайся каждый день по чуть-чуть: серия растёт.' }),
      total ? el('button', { type: 'button', id: 'learn-start', class: 'primary', textContent: 'Начать повторение', onclick: () => startSession(null) })
        : el('p', { class: 'hint', textContent: 'Выбери курс ниже и пройди первый урок — его карточки появятся здесь.' }));
    const mine = userCards(events);
    const cards = TRACKS.map(t => {
      const p = trackProgress(t, events, t0);
      return el('button', { type: 'button', class: 'track-card', dataset: { track: t.id }, onclick: () => go({ name: 'track', id: t.id }) },
        el('span', { class: 'track-ic', style: `background:${t.color}`, textContent: t.icon, 'aria-hidden': 'true' }),
        el('span', { class: 'track-body' },
          el('strong', { textContent: t.title }),
          el('span', { class: 'muted', textContent: `Уроки ${p.lessons}/${p.lessonsTotal} · выучено ${p.mastered}/${p.total}` }),
          bar(p.lessons, p.lessonsTotal)));
    });
    const my = el('button', { type: 'button', class: 'track-card', dataset: { track: 'my' }, onclick: () => go({ name: 'my' }) },
      el('span', { class: 'track-ic', style: `background:${MY_TRACK.color}`, textContent: MY_TRACK.icon, 'aria-hidden': 'true' }),
      el('span', { class: 'track-body' }, el('strong', { textContent: MY_TRACK.title }), el('span', { class: 'muted', textContent: mine.length ? `Карточек: ${mine.length}` : 'Добавляй свои вопросы и ответы' })));
    const note = el('p', { class: 'muted', textContent: 'Курсы — учебный материал, а не медицинская, юридическая или финансовая консультация.' });
    mount(head, el('h2', { textContent: 'Курсы' }), ...cards, my, note);
  }

  // ---------- страница курса ----------
  function renderTrack(t) {
    const t0 = today();
    const done = doneLessons(events);
    const p = trackProgress(t, events, t0);
    const load = todayLoad(events, t0, t.id);
    const startBtn = (load.due + load.fresh)
      ? el('button', { type: 'button', class: 'primary', id: 'track-start', textContent: `Повторять карточки курса (${load.due + load.fresh})`, onclick: () => startSession(t.id) })
      : el('p', { class: 'muted', textContent: 'Карточки курса на сегодня закончились. Пройди следующий урок — появятся новые.' });
    const prompts = t.mentor.prompts.map((pr, i) => el('div', { class: 'prompt' },
      el('p', { textContent: pr }),
      el('button', { type: 'button', class: 'chip', dataset: { prompt: String(i) }, textContent: 'Копировать', onclick: () => copyText(pr) })));
    const mentor = el('details', { class: 'card', id: 'mentor' }, el('summary', { textContent: `Наставник: ${t.mentor.name}` }),
      el('p', { class: 'muted', textContent: t.mentor.role }),
      el('ul', { class: 'plain' }, ...t.mentor.principles.map(x => el('li', { textContent: x }))),
      el('h2', { textContent: 'Запросы для ИИ-репетитора' }),
      el('p', { class: 'muted', textContent: 'Скопируй запрос, подставь свои данные вместо <…> и вставь в чат с ИИ-помощником. Не отправляй в него личные данные.' }),
      ...prompts);
    const plan = el('details', { class: 'card' }, el('summary', { textContent: 'План по неделям' }),
      el('ul', { class: 'plain' }, ...t.plan.map(w => el('li', { textContent: `Неделя ${w.week}: ${w.focus}. Каждый день: ${w.daily}.` }))));
    const lessons = t.lessons.map((l, idx) => {
      const isDone = done.has(l.id);
      const d = el('details', { class: 'card lesson', dataset: { lesson: l.id }, open: openLessons.has(l.id) },
        el('summary', {}, el('span', { class: 'lesson-n', textContent: isDone ? '✓' : String(idx + 1) }), el('span', { textContent: ` ${l.title} · ${l.minutes} мин` })),
        ...l.body.map(par => el('p', { textContent: par })),
        el('p', { class: 'task' }, el('strong', { textContent: 'Задание: ' }), l.task),
        el('p', { class: 'muted', textContent: `Карточек в уроке: ${l.cards.length}` }),
        el('button', { type: 'button', class: isDone ? '' : 'primary', dataset: { done: l.id }, textContent: isDone ? 'Снять отметку «пройден»' : 'Отметить пройденным', onclick: () => toggleLesson(t, l, isDone) }));
      d.addEventListener('toggle', () => { if (d.open) openLessons.add(l.id); else openLessons.delete(l.id); });
      return d;
    });
    const sources = el('details', { class: 'card' }, el('summary', { textContent: 'Источники и опора' }), el('ul', { class: 'plain' }, ...t.sources.map(s => el('li', { textContent: s }))));
    mount(
      el('button', { type: 'button', id: 'learn-back', class: 'link', textContent: '‹ Все курсы', onclick: () => go({ name: 'home' }) }),
      el('div', { class: 'card' },
        el('div', { class: 'row' }, el('span', { class: 'track-ic', style: `background:${t.color}`, textContent: t.icon, 'aria-hidden': 'true' }), el('h3', { textContent: t.title })),
        el('p', { textContent: t.intro }),
        el('p', { class: 'muted', textContent: `Уроки ${p.lessons}/${p.lessonsTotal} · выучено карточек ${p.mastered}/${p.total}` + (p.retention !== null ? ` · помню ${Math.round(p.retention * 100)}%` : '') }),
        bar(p.lessons, p.lessonsTotal), startBtn),
      mentor, plan, el('h2', { textContent: 'Уроки' }), ...lessons, sources);
  }

  async function toggleLesson(t, l, wasDone) {
    if (wasDone) {
      const old = await store.remove(lessonEventId(l.id));
      toast('Отметка снята', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {});
    } else {
      await store.save(makeLessonDone(t, l, today()));
      toast(`Урок пройден. Карточек в повторении: +${l.cards.length}`);
    }
  }

  // ---------- свои карточки ----------
  function renderMy() {
    const q = el('input', { id: 'my-q', type: 'text', maxLength: 300, placeholder: 'Вопрос или слово', 'aria-label': 'Вопрос' });
    const a = el('input', { id: 'my-a', type: 'text', maxLength: 500, placeholder: 'Ответ', 'aria-label': 'Ответ' });
    const err = el('p', { class: 'error', id: 'my-err' });
    const add = async () => {
      try { await store.save(makeUserCard(q.value, a.value)); q.value = ''; a.value = ''; err.textContent = ''; q.focus(); toast('Карточка добавлена'); }
      catch (e) { err.textContent = e.message; }
    };
    const list = userCards(events);
    mount(
      el('button', { type: 'button', id: 'learn-back', class: 'link', textContent: '‹ Все курсы', onclick: () => go({ name: 'home' }) }),
      el('div', { class: 'card' }, el('h3', { textContent: 'Свои карточки' }),
        el('p', { class: 'muted', textContent: 'Всё, что хочешь запомнить: слова, формулы, определения, даты. Они попадут в общее повторение.' }),
        el('form', { class: 'form-stack', onsubmit: e => { e.preventDefault(); add(); } }, q, a, el('button', { type: 'submit', id: 'my-add', class: 'primary', textContent: 'Добавить' }), err)),
      list.length ? el('ul', { class: 'list', id: 'my-list' }, ...list.map(c => el('li', { class: 'entry' },
        el('div', { class: 'grow' }, el('strong', { textContent: c.q }), el('div', { class: 'muted', textContent: c.a })),
        el('button', { type: 'button', class: 'chip danger', 'aria-label': 'Удалить карточку', textContent: 'Удалить', onclick: async () => { await store.removeMany([c.evId, `srs:${c.id}`]); toast('Карточка удалена'); } })))) : el('p', { class: 'muted', textContent: 'Пока нет своих карточек.' }),
      list.length ? el('button', { type: 'button', class: 'primary', textContent: 'Повторять свои карточки', onclick: () => startSession('my') }) : null);
  }

  // ---------- сессия повторения ----------
  function startSession(trackId) {
    const t0 = today();
    const queue = sessionQueue({ events, today: t0, trackId, max: 30 });
    if (!queue.length) { toast('Сейчас повторять нечего'); return; }
    session = { queue, i: 0, shown: false, counts: { again: 0, hard: 0, good: 0 }, again: new Map(), today: t0, fresh: queue.filter(x => !x.state).length, startedAt: Date.now() };
    overlay.hidden = false;
    renderSession();
  }
  function closeSession() {
    session = null; overlay.hidden = true; overlay.replaceChildren();
    render();
  }
  async function answer(q) {
    const s = session; if (!s || !s.shown) return;
    const item = s.queue[s.i];
    const next = grade(item.state ?? newState(item.card.id, s.today), q, s.today);
    s.counts[q]++;
    item.state = next;
    const tries = s.again.get(item.card.id) || 0;
    if (q === 'again' && tries < 2) { s.again.set(item.card.id, tries + 1); s.queue.splice(Math.min(s.queue.length, s.i + 4), 0, { card: item.card, state: next }); }
    s.i++; s.shown = false;
    renderSession();
    await store.save(makeSrsEvent(next));
  }
  function renderSession() {
    const s = session; if (!s) return;
    if (s.i >= s.queue.length) return renderSummary();
    const item = s.queue[s.i], c = item.card;
    const tr = c.track === 'my' ? MY_TRACK : trackById(c.track);
    const interval = q => { const nb = q === 'again' ? 0 : q === 'hard' ? Math.max(1, item.state?.box ?? 0) : Math.min(INTERVALS.length - 1, (item.state?.box ?? 0) + 1); return q === 'again' ? 'сегодня' : q === 'hard' ? `через ${Math.max(1, Math.floor(INTERVALS[nb] / 2))} дн.` : `через ${INTERVALS[nb]} дн.`; };
    const face = el('div', { class: 'flash', id: 'sess-card' },
      el('span', { class: 'muted', textContent: `${tr?.title ?? ''}${item.state ? '' : ' · новая'}` }),
      el('p', { class: 'flash-q', id: 'sess-q', textContent: c.q }),
      s.shown ? el('p', { class: 'flash-a', id: 'sess-a', textContent: c.a }) : null);
    const controls = s.shown
      ? el('div', { class: 'grade-row' }, ...['again', 'hard', 'good'].map(q => el('button', { type: 'button', class: `grade ${q}`, dataset: { q }, onclick: () => answer(q) }, el('strong', { textContent: QUALITY_LABEL[q] }), el('span', { class: 'muted', textContent: interval(q) }))))
      : el('button', { type: 'button', id: 'sess-show', class: 'primary big-btn', textContent: 'Показать ответ', onclick: () => { s.shown = true; renderSession(); } });
    overlay.replaceChildren(
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', id: 'sess-pos', textContent: `${s.i + 1} / ${s.queue.length}` }),
        el('button', { type: 'button', id: 'sess-close', class: 'link', textContent: 'Закончить', onclick: closeSession })),
      bar(s.i, s.queue.length), face, controls);
    overlay.focus({ preventScroll: true });
  }
  function renderSummary() {
    const s = session, total = s.counts.again + s.counts.hard + s.counts.good;
    const pct = total ? Math.round(((s.counts.hard + s.counts.good) / total) * 100) : 0;
    overlay.replaceChildren(
      el('div', { class: 'flash' },
        el('h3', { textContent: 'Сессия завершена' }),
        el('p', { class: 'big', id: 'sess-result', textContent: `${pct}%` }),
        el('p', { class: 'muted', textContent: `Ответов: ${total} · помню: ${s.counts.good} · трудно: ${s.counts.hard} · забыл: ${s.counts.again} · новых: ${s.fresh}` }),
        el('p', { class: 'muted', textContent: 'Забытые карточки вернутся сегодня, остальные — через нарастающие интервалы.' })),
      el('button', { type: 'button', id: 'sess-done', class: 'primary big-btn', textContent: 'Готово', onclick: closeSession }));
    overlay.focus({ preventScroll: true });
  }
  overlay.addEventListener('keydown', e => {
    if (!session) return;
    e.stopPropagation();                              // чтобы не срабатывали глобальные клавиши приложения
    if (e.key === 'Escape') { closeSession(); return; }
    if (session.i >= session.queue.length) return;
    if (!session.shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); session.shown = true; renderSession(); }
    else if (session.shown) { const q = { 1: 'again', 2: 'hard', 3: 'good' }[e.key]; if (q) { e.preventDefault(); answer(q); } }
  });

  // ---------- общий ----------
  function render() {
    if (page.name === 'track') { const t = trackById(page.id); if (t) return renderTrack(t); page = { name: 'home' }; }
    if (page.name === 'my') return renderMy();
    renderHome();
  }
  return {
    root,
    overlay,
    update(evs) {
      events = evs;
      if (session && !evs.length) { session = null; overlay.hidden = true; overlay.replaceChildren(); }   // приложение заблокировано
      if (!session) render();
    },
    show() { if (!session) render(); },
  };
}
