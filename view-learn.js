// Экран «Учёба»: курсы (уроки + наставник), повторение карточек, свои карточки.
import { el, fill, toast, icon } from './ui.js';
import { todayStr } from './events.js';
import { getPref, setPref } from './prefs.js';
import { MIN_QUEUE, minDayActive, trimQueue } from './adapt.js';
import * as store from './store.js';
import { TRACKS, trackById, trackProgress, doneLessons, makeLessonDone, lessonEventId, makeSrsEvent, makeUserCard, userCards, sessionQueue, todayLoad, studyDates, MY_TRACK,
  leeches, comebackInfo, fifteenPlan, lessonNoteOf, makeLessonNote, examQueue, cardsOfTrack, cardFace, lessonToRevisit, markRevisited, lessonTitle, retentionByInterval, lessonGoal, statesOf } from './academy.js';
import { mixedLessonQuiz, gradeItem, keywordsOfCards, checkExplain, dictationItems, dictationWordsOf, stageReviewItems, stageLetters, stageNames, contrastPairsFor, doneStages, microFromLessons, CONTRAST_LATIN, CONTRAST_HEBREW } from './quiz.js';
import { newState, grade, studyStreak, INTERVALS } from './srs.js';
import { canSpeak, foreignSide, speak } from './speech.js';
import { openSpeaking, hasRunningSpeak, speakWeek, SPEAK_LANGS } from './speaking.js';
import { plateauInfo } from './practice.js';
import { lessonSkillStatus, skillFromLesson, skillFromTask } from './skills.js';
import { practiceCard } from './view-learn-extra.js';
import { routeProgress } from './curriculum.js';
import { getPrefs } from './prefs.js';
import { isQuietWeek } from './quiet.js';

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

export function createLearnView(ctx = {}) {
  let events = [];
  let page = { name: 'home' };
  let session = null;
  let extraClose = null;                                  // диктант или минутка заняли окно повторения (закрытие по Escape и при блокировке)
  const openLessons = new Set();
  const quizzes = new Map();                          // ход мини-квиза по урокам (не сохраняется)
  const noteDrafts = new Map();                       // несохранённые конспекты переживают перерисовку экрана
  const explainDrafts = new Map();                    // черновики пересказа «объясни сам» тоже
  const root = el('section', { id: 'view-learn', class: 'view' });
  const overlay = el('div', { id: 'sess', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Повторение' });
  const speakHost = el('div', { id: 'speak-host', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Говорение вслух' });
  const startSpeaking = (lang, resume = false) => { openSpeaking(speakHost, { lang, resume }); speakHost.focus({ preventScroll: true }); };
  const mount = (...nodes) => root.replaceChildren(...nodes.filter(Boolean), overlay, speakHost);     // окно повторения живёт внутри экрана (шторка приватности его тоже скрывает)
  const today = () => todayStr();

  // ---------- общие куски ----------
  const bar = (value, total) => el('div', { class: 'bar', role: 'img', 'aria-label': `${value} из ${total}` }, el('span', { style: `width:${total ? Math.round((value / total) * 100) : 0}%` }));
  const go = p => { page = p; render(); window.scrollTo(0, 0); };

  // ---------- главная ----------
  function renderHome() {
    const t0 = today();
    const load = todayLoad(events, t0);
    const streak = studyStreak(studyDates(events), t0);
    const minOn = minDayActive(getPref('minDay'), t0);                    // «сегодня минимум»: бережный режим на один день
    const shown = minOn ? { due: Math.min(load.due, MIN_QUEUE), fresh: 0 } : load;
    const total = shown.due + shown.fresh;
    const head = el('div', { class: 'card', id: 'learn-today' },
      el('h3', { textContent: 'Повторение на сегодня' }),
      el('p', { class: 'big', id: 'learn-count', textContent: String(total) }),
      el('p', { class: 'muted', textContent: total ? `к повторению: ${shown.due} · новых: ${shown.fresh}` : 'На сегодня всё повторено ✓' }),
      el('p', { class: 'muted', id: 'learn-streak', textContent: streak ? `Занятий подряд: ${streak} дн.` : 'Занимайся каждый день по чуть-чуть: серия растёт.' }),
      total ? el('button', { type: 'button', id: 'learn-start', class: 'primary', textContent: 'Начать повторение', onclick: () => startSession(null) })
        : el('p', { class: 'hint', textContent: 'Выбери курс ниже и пройди первый урок — его карточки появятся здесь.' }),
      total && !minOn ? el('button', { type: 'button', id: 'learn-minday', class: 'chip', textContent: 'Сегодня минимум', onclick: () => { setPref('minDay', t0); render(); } }) : null,
      minOn && (load.due + load.fresh) ? el('p', { class: 'muted', id: 'learn-minday-note', textContent: `Бережный режим: сегодня только до ${MIN_QUEUE} карточек на повторение, новых нет. Завтра очередь снова полная.` }) : null,
      minOn ? el('button', { type: 'button', id: 'learn-minday-off', class: 'chip', textContent: 'Вернуть полную очередь', onclick: () => { setPref('minDay', ''); render(); } }) : null,
      examQueue({ events, n: 20, seed: 1 }).length >= 5 ? el('button', { type: 'button', id: 'exam-all', class: 'chip', textContent: 'Экзамен: 20 случайных карточек', onclick: () => startSession(null, { exam: true }) }) : null);
    const cb = comebackInfo(events, t0);
    const comeback = cb ? el('div', { class: 'card calm', id: 'comeback' }, el('strong', { textContent: 'С возвращением' }),
      el('p', { textContent: `Ты не занимался ${cb.days} дн., накопилось повторений: ${cb.due}. Это не страшно. Начни с десяти карточек, остальные подождут.` }),
      el('button', { type: 'button', id: 'comeback-start', class: 'primary', textContent: 'Начать с 10 карточек', onclick: () => startSession(null, { max: 10 }) })) : null;
    const plan = fifteenPlan(events, t0);
    const fifteen = plan.next || plan.cards ? el('div', { class: 'card', id: 'fifteen' }, el('strong', { textContent: 'Режим «15 минут»' }),
      el('p', { class: 'muted', textContent: `Коротко и без перегруза: один урок и немного карточек. Около ${Math.max(5, plan.minutes + 3)} мин.` }),
      plan.next ? el('div', { class: 'row' }, el('span', { class: 'grow', id: 'fifteen-lesson-text', textContent: `1. Урок: ${plan.next.lesson.title} (${plan.next.track.title}, ${plan.next.lesson.minutes} мин)` }),
        el('button', { type: 'button', id: 'fifteen-lesson', class: 'chip', textContent: 'Открыть', onclick: () => openLesson(plan.next.track.id, plan.next.lesson.id) })) : null,
      plan.cards ? el('div', { class: 'row' }, el('span', { class: 'grow', textContent: `2. Карточки: ${plan.cards}` }),
        el('button', { type: 'button', id: 'fifteen-cards', class: 'chip', textContent: 'Начать', onclick: () => startSession(null, { max: 10 }) })) : null,
      plan.next ? el('p', { class: 'muted', textContent: `3. Задание: ${plan.next.lesson.task}` }) : null) : null;
    const lcAll = leeches(events, 1000), lc = lcAll.slice(0, 5);
    const leech = lc.length ? el('div', { class: 'card', id: 'leeches' }, el('strong', { textContent: `Сложные карточки (${lcAll.length})` }),
      el('p', { class: 'muted', textContent: 'Эти карточки ты забываешь чаще других. Помогает своя формулировка, пример или ассоциация: сделай по ним свою карточку.' }),
      ...lc.map(({ card }) => el('div', { class: 'row leech-row', dataset: { card: card.id } }, el('span', { class: 'grow' }, el('strong', { textContent: card.q })),
        el('button', { type: 'button', class: 'chip leech-own', textContent: 'Своя карточка', onclick: () => go({ name: 'my', prefill: { q: card.q, a: card.a } }) }))),
      el('button', { type: 'button', id: 'leech-start', class: 'chip', textContent: 'Повторить только их', onclick: () => startSession(null, { queue: lcAll.map(x => ({ card: x.card, state: x.state })).slice(0, 20) }) })) : null;
    const rv = lessonToRevisit(events, t0), rvInfo = rv ? lessonTitle(rv.lesson) : null;
    const revisit = rv && rvInfo ? el('div', { class: 'card', id: 'revisit' }, el('strong', { textContent: 'Пора вернуться к уроку' }),
      el('p', { textContent: `«${rvInfo.title}» (${rvInfo.track}) пройден ${rv.days} дн. назад. Перечитай его и ещё раз скажи задание вслух: возвращение через месяц закрепляет надолго.${rv.count > 1 ? ` Всего уроков для возврата: ${rv.count}.` : ''}` }),
      el('div', { class: 'row wrap' }, el('button', { type: 'button', id: 'revisit-open', class: 'chip', textContent: 'Открыть урок', onclick: () => openLesson(rv.track, rv.lesson) }),
        el('button', { type: 'button', id: 'revisit-done', class: 'chip', textContent: 'Повторил', onclick: async () => { await store.save(markRevisited(rv.ev, t0)); toast('Следующее возвращение к этому уроку через месяц'); } }))) : null;
    const sw = speakWeek(events, t0);
    const speaking = el('div', { class: 'card', id: 'speak-card' }, el('strong', { textContent: 'Говорение вслух' }),
      el('p', { class: 'muted', id: 'speak-week', textContent: `За неделю: ${sw.minutes} из ${sw.goal} мин${sw.minutes ? ` (${Object.entries(sw.byLang).map(([k, v]) => `${SPEAK_LANGS[k].toLowerCase()} ${v}`).join(', ')})` : ''}. Говорить вслух полезнее, чем читать молча.` }),
      bar(Math.min(sw.minutes, sw.goal), sw.goal),
      el('div', { class: 'row wrap' }, ...Object.entries(SPEAK_LANGS).map(([k, name]) => el('button', { type: 'button', id: `speak-${k}`, class: 'chip', textContent: name, onclick: () => startSpeaking(k) }))));
    const mine = userCards(events);
    const quietWeek = isQuietWeek(getPrefs(), t0);                  // неделя без нового: предлагаем только начатые курсы, новые подождут
    const quietNote = quietWeek ? el('p', { class: 'muted', id: 'learn-quiet', textContent: 'Неделя без нового: новые курсы подождут. Начатые — на месте, повторение работает как обычно.' }) : null;
    const cards = TRACKS.filter(t => !t.zero).map(t => ({ t, p: trackProgress(t, events, t0) }))
      .filter(({ p }) => !quietWeek || p.lessons > 0 || p.mastered > 0)
      .map(({ t, p }) => {
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
    const zeroTracks = TRACKS.filter(t => t.zero);
    const zeroCard = zeroTracks.length && (!quietWeek || zeroTracks.some(z => routeProgress(z, events).done > 0)) ? el('div', { class: 'card zero-entry', id: 'learn-zero' }, el('h3', { textContent: 'Курсы с нуля' }),
      el('p', { class: 'muted', textContent: 'Английский, иврит и библейский иврит с самого начала: звуки, буквы, чтение. Уроки открываются по порядку, а «Освоено» ставится после проверки.' }),
      el('ul', { class: 'plain' }, ...zeroTracks.map(z => { const p = routeProgress(z, events); return el('li', { textContent: `${z.title}: освоено ${p.done} из ${p.total}` }); })),
      ...zeroTracks.flatMap(z => doneStages(routeProgress(z, events)).map(st => el('button', { type: 'button', class: 'chip stage-review', dataset: { stage: `${z.id}:${st}` }, textContent: `Итог этапа «${st}» (${z.title})`, onclick: () => go({ name: 'stage', trackId: z.id, stage: st }) }))),
      el('button', { type: 'button', id: 'learn-zero-open', class: 'primary', textContent: 'Открыть «С нуля»', onclick: () => ctx.openZero?.() })) : null;
    const done = doneLessons(events);
    const micro = TRACKS.flatMap(t => t.lessons).some(l => done.has(l.id) && (l.cards?.length ?? 0) >= 2) ? el('div', { class: 'card calm', id: 'micro' },
      el('strong', { textContent: 'Минутка (90 секунд)' }),
      el('p', { class: 'muted', textContent: 'Для дней, когда нет сил: один факт из пройденного и один вопрос. Этого достаточно.' }),
      el('button', { type: 'button', id: 'micro-open', class: 'chip', textContent: 'Открыть минутку', onclick: openMicro })) : null;
    mount(head, comeback, micro, fifteen, revisit, speaking, practiceCard(events, t0), leech, el('h2', { textContent: 'Курсы' }), quietNote, zeroCard, ...cards, my, note);
  }

  // ---------- конспект урока и открытие урока ----------
  const noteAreas = new Map();
  function noteBox(l) {
    const note = lessonNoteOf(events, l.id);
    const ta = el('textarea', { class: 'lesson-note', rows: 3, maxLength: 2000, placeholder: 'Своими словами, 2–3 строки: что главное в уроке', 'aria-label': 'Мой конспект' });
    ta.value = noteDrafts.has(l.id) ? noteDrafts.get(l.id) : (note?.payload.text ?? '');
    ta.addEventListener('input', () => noteDrafts.set(l.id, ta.value));
    noteAreas.set(l.id, ta);
    return ta;
  }
  async function saveNote(l) {
    const note = lessonNoteOf(events, l.id), text = (noteAreas.get(l.id)?.value ?? '').trim();
    try {
      if (!text) {
        if (note) { const old = await store.remove(note.id); toast('Конспект удалён', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); }
        noteDrafts.delete(l.id); return;
      }
      noteDrafts.delete(l.id);
      await store.save(makeLessonNote(l.id, text, today(), Date.now(), note));
      toast('Конспект сохранён');
    } catch (e) { toast(e.message); }
  }
  // конспект → карточка одним нажатием: вопрос «<урок>: что главное?», ответ — твои слова. Повторное нажатие обновляет ту же карточку.
  async function noteToCard(l) {
    const text = (noteAreas.get(l.id)?.value ?? '').trim();
    if (!text) { toast('Сначала запиши конспект своими словами'); return; }
    try {
      const id = `ucard:ln-${l.id}`, old = events.find(e => e.id === id);
      await store.save(makeUserCard(`${l.title}: что главное?`, text, Date.now(), id));
      toast(old ? 'Карточка обновлена' : 'Карточка добавлена в «Свои карточки»', { actionLabel: 'Отменить', onAction: () => (old ? store.save(old) : store.remove(id)) });
    } catch (e) { toast(e.message); }
  }
  // ---------- проигрыватель заданий новых форматов (quiz.js): варианты, вписанный ответ, «найди ошибку» ----------
  function quizItemNode(item, { last = false, speakLang = 'english', onDone = () => {}, onNext = () => {} } = {}) {
    const box = el('div', { class: 'quiz-item', dataset: { kind: item.t } });
    let answered = false;
    const fb = el('div', { class: 'quiz-fb-box' });
    const rightText = item.t === 'error' ? `«${item.right}»` : item.t === 'typed' ? item.ok[0] : item.options[item.answer];
    const done = ok => {
      answered = true;
      for (const b of box.querySelectorAll('.quiz-opt, .quiz-input, .quiz-check')) b.disabled = true;
      fill(fb,
        el('p', { class: `quiz-fb ${ok ? 'ok' : 'bad'}`, textContent: ok ? 'Верно' : `Неверно. Правильный ответ: ${rightText}` }),
        item.explain ? el('p', { class: 'muted', textContent: item.explain }) : null,
        el('button', { type: 'button', class: 'chip quiz-next', textContent: last ? 'Результат' : 'Дальше', onclick: onNext }));
      fb.querySelector('.quiz-next')?.focus();
      onDone(ok);
    };
    const head = [];
    if (item.big) head.push(el('p', { class: 'quiz-big', lang: item.lang === 'hebrew' ? 'he' : item.lang === 'english' ? 'en' : undefined, dir: item.lang === 'hebrew' ? 'rtl' : undefined, textContent: item.big }));
    head.push(el('p', { class: 'quiz-q', textContent: item.q }));
    if (item.say) head.push(el('button', { type: 'button', class: 'chip quiz-say', onclick: () => { if (!speak(item.say, item.lang ?? speakLang, () => toast('Озвучка недоступна на этом устройстве'))) toast('Озвучка недоступна на этом устройстве'); } }, icon('volume', 16), 'Послушать'));
    if (item.t === 'choice') {
      box.append(...head, ...item.options.map((o, idx) => el('button', { type: 'button', class: 'quiz-opt', textContent: o, onclick: () => {
        if (answered) return;
        [...box.querySelectorAll('.quiz-opt')].forEach((b, i) => { b.classList.toggle('right', i === item.answer); b.classList.toggle('wrong', i === idx && idx !== item.answer); });
        done(idx === item.answer);
      } })), fb);
    } else if (item.t === 'error') {
      box.append(...head, el('p', { class: 'quiz-phrase' }, ...item.words.map((w, idx) => el('button', { type: 'button', class: 'quiz-opt quiz-word', textContent: w, onclick: () => {
        if (answered) return;
        [...box.querySelectorAll('.quiz-word')].forEach((b, i) => { b.classList.toggle('right', i === item.wrong); b.classList.toggle('wrong', i === idx && idx !== item.wrong); });
        done(idx === item.wrong);
      } }))), fb);
    } else if (item.t === 'typed') {
      const input = el('input', { type: 'text', class: 'quiz-input', autocomplete: 'off', 'aria-label': 'Твой ответ', dir: 'auto' });
      input.setAttribute('autocapitalize', 'off'); input.setAttribute('spellcheck', 'false');
      box.append(...head, el('form', { class: 'quiz-typed', onsubmit: e => { e.preventDefault(); if (!answered && input.value.trim()) done(gradeItem(item, input.value)); } }, input, el('button', { type: 'submit', class: 'primary quiz-check', textContent: 'Проверить' })), fb);
    } else box.append(...head, fb);
    return box;
  }
  // Небольшая серия заданий с итогом. Состояние st ({items, i, ok}) живёт снаружи и переживает перерисовку экрана.
  function quizFlow(box, st, { speakLang, onFinish } = {}) {
    if (st.i >= st.items.length) return onFinish(st);
    fill(box, el('p', { class: 'muted', textContent: `Вопрос ${st.i + 1} из ${st.items.length}` }),
      quizItemNode(st.items[st.i], { last: st.i + 1 === st.items.length, speakLang, onDone: good => { if (good) st.ok++; }, onNext: () => { st.i++; quizFlow(box, st, { speakLang, onFinish }); } }));
  }
  // Мини-квиз после урока: смесь форматов (выбор, «закончи фразу», «найди ошибку») из карточек урока.
  function quizNode(t, l) {
    const box = el('div', { class: 'quiz', dataset: { lesson: l.id } });
    const others = () => cardsOfTrack(t).filter(c => c.lesson !== l.id).map(c => [c.q, c.a]);
    const draw = () => {
      const st = quizzes.get(l.id);
      if (!st) { fill(box, el('button', { type: 'button', class: 'chip quiz-start', textContent: 'Мини-квиз', onclick: () => { quizzes.set(l.id, { items: mixedLessonQuiz(l.cards, others(), { seed: Date.now(), n: 4 }), i: 0, ok: 0 }); draw(); } })); return; }
      quizFlow(box, st, {
        onFinish: s => fill(box,
          el('p', { class: 'quiz-result', textContent: `Верно: ${s.ok} из ${s.items.length}. ${s.ok === s.items.length ? 'Отлично!' : 'Что не получилось, вернётся в повторении карточек урока.'}` }),
          el('button', { type: 'button', class: 'chip quiz-again', textContent: 'Ещё раз', onclick: () => { quizzes.set(l.id, { items: mixedLessonQuiz(l.cards, others(), { seed: Date.now(), n: 4 }), i: 0, ok: 0 }); draw(); } })),
      });
    };
    draw();
    return box;
  }
  // «Объясни сам»: пересказ урока двумя предложениями, зачёт по опорным словам (правило, без ИИ, текст никуда не уходит).
  function explainNode(l) {
    const kws = keywordsOfCards(l.cards);
    if (kws.length < 3) return null;
    const ta = el('textarea', { class: 'lesson-note', rows: 2, maxLength: 1000, placeholder: 'Два предложения своими словами, не подглядывая', 'aria-label': 'Мой пересказ' });
    ta.value = explainDrafts.get(l.id) ?? '';
    ta.addEventListener('input', () => explainDrafts.set(l.id, ta.value));
    const out = el('p', { class: 'muted quiz-explain-out' });
    const check = () => {
      const r = checkExplain(ta.value, kws);
      out.className = `quiz-explain-out ${r.ok ? 'ok' : 'muted'}`;
      out.textContent = !ta.value.trim() ? 'Напиши пару предложений — проверим по опорным словам.'
        : r.ok ? `Зачёт: опорные слова на месте (${r.hits.length} из ${kws.length}). ${r.sentences < 2 ? 'Если получится, добавь второе предложение: так пересказ держится лучше.' : 'Хороший пересказ.'}`
        : `Пока нашлись: ${r.hits.length ? r.hits.join(', ') : 'ничего из опорных'}. Добавь, например: ${r.missing.slice(0, 3).join(', ')}.`;
    };
    return el('details', { class: 'quiz-explain-box' },
      el('summary', { textContent: 'Объясни сам' }),
      el('p', { class: 'muted', textContent: 'Перескажи урок двумя предложениями своими словами. Зачёт — по опорным словам, без ИИ.' }),
      ta, el('button', { type: 'button', class: 'chip quiz-explain-check', textContent: 'Проверить пересказ', onclick: check }), out);
  }
  function openLesson(trackId, lessonId) {
    if (trackById(trackId)?.zero) { ctx.openZero?.(trackId, lessonId); return; }                  // уроки «с нуля» открываются только на своём экране (допуск по ступеням)
    page = { name: 'track', id: trackId }; openLessons.add(lessonId);
    render();
    root.querySelector(`.lesson[data-lesson="${lessonId}"]`)?.scrollIntoView?.({ block: 'start' });
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
    const examBtn = cardsOfTrack(t).length >= 10 ? el('button', { type: 'button', id: 'track-exam', class: 'chip', textContent: 'Экзамен: 20 случайных карточек', onclick: () => startSession(t.id, { exam: true }) }) : null;
    const dictBtn = (t.id === 'english' || t.id === 'hebrew') && canSpeak() && dictationWords(t).length >= 5
      ? el('button', { type: 'button', id: 'track-dictation', class: 'chip', textContent: 'Диктант на слух', onclick: () => startDictation(t) }) : null;
    const prompts = t.mentor.prompts.map((pr, i) => el('div', { class: 'prompt' },
      el('p', { textContent: pr }),
      el('button', { type: 'button', class: 'chip', dataset: { prompt: String(i) }, textContent: 'Копировать', onclick: () => copyText(pr) })));
    const mentor = el('details', { class: 'card', id: 'mentor' }, el('summary', { textContent: `Наставник: ${t.mentor.name}` }),
      el('p', { class: 'muted', textContent: t.mentor.role }),
      el('ul', { class: 'plain' }, ...t.mentor.principles.map(x => el('li', { textContent: x }))),
      el('h2', { textContent: 'Запросы для ИИ-репетитора' }),
      el('p', { class: 'muted', textContent: 'Скопируй запрос, подставь свои данные вместо <…> и вставь в чат с ИИ-помощником. Не отправляй в него личные данные.' }),
      ...prompts);
    const curve = retentionByInterval(events, t.id), curveN = curve.reduce((n, b) => n + b.n, 0);
    const curveBox = curveN >= 20 ? el('details', { class: 'card', id: 'curve' }, el('summary', { textContent: 'Как ты помнишь со временем' }),
      el('p', { class: 'muted', textContent: 'Доля ответов «помню» через разные промежутки после прошлого повторения. Если после месяца помнишь хуже половины, повторяй чаще.' }),
      ...curve.map(b => el('div', { class: 'curve-row', dataset: { label: b.label } }, el('span', { class: 'curve-label', textContent: b.label }), bar(Math.round(b.rate * 100), 100), el('span', { class: 'muted', textContent: `${Math.round(b.rate * 100)}% (ответов: ${b.n})` })))) : null;
    const plan = el('details', { class: 'card' }, el('summary', { textContent: 'План по неделям' }),
      el('ul', { class: 'plain' }, ...t.plan.map(w => el('li', { textContent: `Неделя ${w.week}: ${w.focus}. Каждый день: ${w.daily}.` }))));
    const pl = plateauInfo(events, t.id, t0);
    const plateau = pl ? el('div', { class: 'card calm', id: 'plateau' }, el('strong', { textContent: 'Нового давно нет' }), el('p', { textContent: pl.text }),
      pl.nextLesson ? el('button', { type: 'button', id: 'plateau-open', class: 'chip', textContent: 'Открыть следующий урок', onclick: () => openLesson(t.id, pl.nextLesson.id) }) : null) : null;
    const lessons = t.lessons.map((l, idx) => {
      const isDone = done.has(l.id);
      const d = el('details', { class: 'card lesson', dataset: { lesson: l.id }, open: openLessons.has(l.id) },
        el('summary', {}, el('span', { class: 'lesson-n', textContent: isDone ? '✓' : String(idx + 1) }), el('span', { textContent: ` ${l.title} · ${l.minutes} мин` })),
        lessonGoal(l.id) ? el('p', { class: 'lesson-goal' }, el('strong', { textContent: 'После урока я смогу: ' }), lessonGoal(l.id)) : null,
        ...l.body.map(par => el('p', { textContent: par })),
        el('p', { class: 'task' }, el('strong', { textContent: 'Задание: ' }), l.task),
        el('label', { class: 'field' }, el('span', { class: 'rating-label', textContent: 'Мой конспект' }), noteBox(l)),
        el('div', { class: 'row wrap' }, el('button', { type: 'button', class: 'chip note-save', dataset: { note: l.id }, textContent: 'Сохранить конспект', onclick: () => saveNote(l) }),
          el('button', { type: 'button', class: 'chip note-card', dataset: { noteCard: l.id }, textContent: 'Конспект → карточка', onclick: () => noteToCard(l) })),
        explainNode(l),
        quizNode(t, l),
        el('p', { class: 'muted', textContent: `Карточек в уроке: ${l.cards.length}` }),
        el('button', { type: 'button', class: 'chip', dataset: { aiCheck: l.id }, textContent: 'Проверить мой ответ с ИИ', onclick: () => copyText(`Я прохожу урок «${l.title}» из курса «${t.title}».\nЗадание: ${l.task}\nМой ответ: <вставь свой ответ>\n\nПроверь ответ как доброжелательный наставник: что верно, что неверно или неполно, один совет и один следующий шаг. Объясняй простыми словами и не выдумывай факты.`) }),
        el('button', { type: 'button', class: isDone ? '' : 'primary', dataset: { done: l.id }, textContent: isDone ? 'Снять отметку «пройден»' : 'Отметить пройденным', onclick: () => toggleLesson(t, l, isDone) }),
        isDone ? el('button', { type: 'button', class: 'chip task-skill', dataset: { taskSkill: l.id }, textContent: 'Задание выполнено → навык «Умею»', onclick: () => taskSkill(t, l) }) : null);
      d.addEventListener('toggle', () => { if (d.open) openLessons.add(l.id); else openLessons.delete(l.id); });
      return d;
    });
    const sources = el('details', { class: 'card' }, el('summary', { textContent: 'Источники и опора' }), el('ul', { class: 'plain' }, ...t.sources.map(s => el('li', { textContent: s }))));
    const before = TRACKS.filter(z => z.zero && z.after === t.id && routeProgress(z, events).fraction < 1);
    const banner = before.length ? el('div', { class: 'card calm', id: 'learn-zero-banner' }, el('strong', { textContent: 'Начинаешь с нуля?' }),
      el('p', { textContent: `Этот курс — следующая ступень после «${before.map(z => z.title).join('» и «')}». Если буквы и звуки ещё незнакомы, начни там. Здесь ничего не закрыто, решай сам.` }),
      el('div', { class: 'row wrap' }, ...before.map(z => el('button', { type: 'button', class: 'chip', dataset: { zero: z.id }, textContent: `Открыть: ${z.title}`, onclick: () => ctx.openZero?.(z.id) })))) : null;
    mount(
      el('button', { type: 'button', id: 'learn-back', class: 'link back-link', onclick: () => go({ name: 'home' }) }, icon('chevL', 18), 'Все курсы'),
      banner,
      el('div', { class: 'card' },
        el('div', { class: 'row' }, el('span', { class: 'track-ic', style: `background:${t.color}`, textContent: t.icon, 'aria-hidden': 'true' }), el('h3', { textContent: t.title })),
        el('p', { textContent: t.intro }),
        el('p', { class: 'muted', textContent: `Уроки ${p.lessons}/${p.lessonsTotal} · выучено карточек ${p.mastered}/${p.total}` + (p.retention !== null ? ` · помню ${Math.round(p.retention * 100)}%` : '') }),
        bar(p.lessons, p.lessonsTotal), startBtn, examBtn, dictBtn),
      plateau, mentor, curveBox, plan, el('h2', { textContent: 'Уроки' }), ...lessons, sources);
  }

  // «Задание выполнено» → навык «Умею» (если навык из этого урока уже есть, поднимает его уровень)
  async function taskSkill(t, l) {
    try {
      const old = events.find(e => e.id === `skill:lesson:${l.id}`), ev = skillFromTask(t, l, events);
      await store.save(ev);
      toast(old ? 'Навык обновлён: теперь «Умею»' : 'Навык добавлен: «Умею»', { actionLabel: 'Отменить', onAction: () => (old ? store.save(old) : store.remove(ev.id)) });
    } catch (x) { toast(x.message); }
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
    const hint = el('input', { id: 'my-hint', type: 'text', maxLength: 200, placeholder: 'Моя ассоциация или пример (по желанию)', 'aria-label': 'Ассоциация' });
    if (page.prefill) { q.value = page.prefill.q; a.value = page.prefill.a; page = { name: 'my' }; }   // заготовка из «сложных карточек» подставляется один раз
    const err = el('p', { class: 'error', id: 'my-err' });
    const add = async () => {
      try { await store.save(makeUserCard(q.value, a.value, Date.now(), null, hint.value)); q.value = ''; a.value = ''; hint.value = ''; err.textContent = ''; q.focus(); toast('Карточка добавлена'); }
      catch (e) { err.textContent = e.message; }
    };
    const list = userCards(events);
    mount(
      el('button', { type: 'button', id: 'learn-back', class: 'link back-link', onclick: () => go({ name: 'home' }) }, icon('chevL', 18), 'Все курсы'),
      el('div', { class: 'card' }, el('h3', { textContent: 'Свои карточки' }),
        el('p', { class: 'muted', textContent: 'Всё, что хочешь запомнить: слова, формулы, определения, даты. Они попадут в общее повторение.' }),
        el('form', { class: 'form-stack', onsubmit: e => { e.preventDefault(); add(); } }, q, a, hint, el('button', { type: 'submit', id: 'my-add', class: 'primary', textContent: 'Добавить' }), err)),
      list.length ? el('ul', { class: 'list', id: 'my-list' }, ...list.map(c => el('li', { class: 'entry' },
        el('div', { class: 'grow' }, el('strong', { textContent: c.q }), el('div', { class: 'muted', textContent: c.a }), c.hint ? el('div', { class: 'muted', textContent: `Ассоциация: ${c.hint}` }) : null),
        el('button', { type: 'button', class: 'chip danger', 'aria-label': 'Удалить карточку', textContent: 'Удалить', onclick: async () => { await store.removeMany([c.evId, `srs:${c.id}`]); toast('Карточка удалена'); } })))) : el('p', { class: 'muted', textContent: 'Пока нет своих карточек.' }),
      list.length ? el('button', { type: 'button', class: 'primary', textContent: 'Повторять свои карточки', onclick: () => startSession('my') }) : null);
  }

  // ---------- диктант на слух: слова только из области допуска (уже начатые в повторении иностранные слова) ----------
  function dictationWords(t) {
    const started = new Set(statesOf(events).map(s => s.card));
    const foreign = t.id === 'hebrew' ? /[֐-׿]/ : /^[A-Za-z][A-Za-z'’-]*$/;
    return cardsOfTrack(t).filter(c => c.kind === 'deck' && started.has(c.id) && foreign.test(c.q) && !/\s/.test(c.q.trim())).map(c => c.q);
  }
  function startDictation(t) {
    const lang = t.id === 'hebrew' ? 'hebrew' : 'english';
    const items = dictationItems(dictationWords(t), { seed: Date.now(), n: 8, lang });
    if (!items.length) { toast('Пока нечего диктовать: сначала повтори слова в обычном повторении'); return; }
    const close = () => { extraClose = null; overlay.hidden = true; overlay.replaceChildren(); render(); };
    extraClose = close;
    overlay.hidden = false;
    const flowBox = el('div');
    overlay.replaceChildren(
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: 'Диктант на слух' }),
        el('button', { type: 'button', id: 'sess-close', class: 'link', textContent: 'Закончить', onclick: close })),
      el('p', { class: 'muted', textContent: 'Слушай слово и вписывай его. Слова — только из тех, что ты уже повторял.' }), flowBox);
    quizFlow(flowBox, { items, i: 0, ok: 0 }, { speakLang: lang, onFinish: s => fill(flowBox,
      el('p', { class: 'quiz-result', textContent: `Диктант закончен: верно ${s.ok} из ${s.items.length}. Ошибки не страшны: слова вернутся в повторении.` }),
      el('button', { type: 'button', class: 'primary big-btn', textContent: 'Готово', onclick: close })) });
    overlay.focus({ preventScroll: true });
  }
  // ---------- минутка: один факт из пройденного и один вопрос (для дней, когда нет сил) ----------
  function openMicro() {
    const m = microFromLessons(TRACKS.flatMap(t => t.lessons).filter(l => doneLessons(events).has(l.id)), { seed: Date.now() });
    if (!m) return;
    const close = () => { extraClose = null; overlay.hidden = true; overlay.replaceChildren(); render(); };
    extraClose = close;
    overlay.hidden = false;
    const flowBox = el('div');
    overlay.replaceChildren(
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: 'Минутка' }),
        el('button', { type: 'button', id: 'sess-close', class: 'link', textContent: 'Закончить', onclick: close })),
      el('div', { class: 'flash' },
        el('p', { class: 'muted', textContent: `Факт из урока «${m.fact.lesson}»` }),
        el('p', { class: 'flash-q', textContent: m.fact.q }),
        el('p', { class: 'flash-a', textContent: m.fact.a })),
      flowBox);
    quizFlow(flowBox, { items: [m.item], i: 0, ok: 0 }, { onFinish: () => fill(flowBox,
      el('p', { class: 'quiz-result', textContent: 'Минутка закончилась. Этого вполне достаточно на сегодня.' }),
      el('button', { type: 'button', class: 'primary big-btn', textContent: 'Готово', onclick: close })) });
    overlay.focus({ preventScroll: true });
  }
  // ---------- итог этапа «с нуля»: обзорный урок без нового материала ----------
  function renderStage(z, stage) {
    const lessons = z.lessons.filter(l => l.stage === stage);
    const lang = z.lang === 'hebrew' ? 'hebrew' : 'english';
    const pairs = contrastPairsFor(stageLetters(lessons), z.lang === 'hebrew' ? CONTRAST_HEBREW : CONTRAST_LATIN);
    const items = stageReviewItems(lessons, { seed: Date.now(), n: 8, pairs, dictation: canSpeak() ? dictationWordsOf(lessons) : [], lang });
    const flowBox = el('div', { class: 'card' });
    mount(
      el('button', { type: 'button', id: 'learn-back', class: 'link back-link', onclick: () => go({ name: 'home' }) }, icon('chevL', 18), 'Все курсы'),
      el('div', { class: 'card' }, el('h3', { textContent: `Итог этапа «${stage}»` }),
        el('p', { class: 'muted', textContent: 'Обзорный урок: только то, что уже проходили. Нового материала нет, результаты никуда не записываются.' })),
      flowBox);
    if (!items.length) { fill(flowBox, el('p', { class: 'muted', textContent: 'В этом этапе пока нет заданий для обзора.' })); return; }
    quizFlow(flowBox, { items, i: 0, ok: 0 }, { speakLang: lang, onFinish: s => fill(flowBox,
      el('p', { class: 'quiz-result', textContent: `Верно: ${s.ok} из ${s.items.length}. ${s.ok === s.items.length ? 'Этап держится отлично!' : 'Что подзабылось, вернётся в проверках уроков.'}` }),
      el('button', { type: 'button', class: 'chip', textContent: 'Ко всем курсам', onclick: () => go({ name: 'home' }) })) });
  }

  // ---------- сессия повторения ----------
  function startSession(trackId, opts = {}) {
    const t0 = today();
    let queue = opts.queue ?? (opts.exam ? examQueue({ events, trackId, n: 20 }) : sessionQueue({ events, today: t0, trackId, max: opts.max ?? 30 }));
    if (!opts.exam && !opts.queue && minDayActive(getPref('minDay'), t0)) queue = trimQueue(queue);   // «сегодня минимум»: до пяти повторений, без новых
    if (!queue.length) { toast('Сейчас повторять нечего'); return; }
    session = { queue, i: 0, shown: false, counts: { again: 0, hard: 0, good: 0 }, again: new Map(), today: t0, fresh: queue.filter(x => !x.state).length, startedAt: Date.now(), exam: !!opts.exam, missed: [], skillsBefore: new Set(lessonSkillStatus(events).ready.map(r => r.lesson.id)) };
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
    s.counts[q]++;
    if (s.exam) {                                       // экзамен: ничего не пишем в расписание повторений
      if (q === 'again') s.missed.push(item.card);
      s.i++; s.shown = false; s.translit = false; renderSession(); return;
    }
    const next = grade(item.state ?? newState(item.card.id, s.today), q, s.today);
    item.state = next;
    const tries = s.again.get(item.card.id) || 0;
    if (q === 'again' && tries < 2) { s.again.set(item.card.id, tries + 1); s.queue.splice(Math.min(s.queue.length, s.i + 4), 0, { card: item.card, state: next }); }
    s.i++; s.shown = false; s.translit = false;
    renderSession();
    await store.save(makeSrsEvent(next));
  }
  function renderSession() {
    const s = session; if (!s) return;
    if (s.i >= s.queue.length) return renderSummary();
    const item = s.queue[s.i], c = item.card;
    const tr = c.track === 'my' ? MY_TRACK : trackById(c.track);
    const interval = q => { const nb = q === 'again' ? 0 : q === 'hard' ? Math.max(1, item.state?.box ?? 0) : Math.min(INTERVALS.length - 1, (item.state?.box ?? 0) + 1); return q === 'again' ? 'сегодня' : q === 'hard' ? `через ${Math.max(1, Math.floor(INTERVALS[nb] / 2))} дн.` : `через ${INTERVALS[nb]} дн.`; };
    const face0 = cardFace(c, item.state, s.today);
    const fs = canSpeak() && (c.track === 'english' || c.track === 'hebrew') ? foreignSide(c, c.track) : null;
    const speakBtn = fs && (s.shown || (fs.side === 'q' && !face0.reversed)) ? el('button', { type: 'button', id: 'sess-speak', class: 'chip', 'aria-label': 'Произнести',
      onclick: () => { if (!speak(fs.text, c.track, () => toast('На телефоне нет голоса для этого языка. Установи голосовой движок в настройках телефона. Как поставить голос: «Ещё» → «Справка» → «Нет голоса для озвучки».'))) toast('Озвучка недоступна на этом устройстве'); } }, icon('volume', 20)) : null;
    const face = el('div', { class: 'flash', id: 'sess-card' },
      el('span', { class: 'muted', textContent: (s.exam ? `Экзамен · ${tr?.title ?? ''}` : `${tr?.title ?? ''}${item.state ? '' : ' · новая'}`) + (face0.reversed ? ' · обратное направление' : '') }),
      el('p', { class: 'flash-q', id: 'sess-q', textContent: face0.front }), speakBtn,
      s.shown ? el('p', { class: 'flash-a', id: 'sess-a', textContent: face0.back }) : null,
      s.shown && face0.translit ? (s.translit ? el('p', { class: 'muted', id: 'sess-translit', textContent: `Транскрипция: ${face0.translit}` })
        : el('button', { type: 'button', id: 'sess-translit-btn', class: 'chip', textContent: 'Показать транскрипцию', onclick: () => { s.translit = true; renderSession(); } })) : null,
      s.shown && c.hint ? el('p', { class: 'muted', id: 'sess-hint', textContent: `Моя ассоциация: ${c.hint}` }) : null);
    const controls = s.shown
      ? el('div', { class: 'grade-row' }, ...['again', 'hard', 'good'].map(q => el('button', { type: 'button', class: `grade ${q}`, dataset: { q }, onclick: () => answer(q) }, el('strong', { textContent: QUALITY_LABEL[q] }), s.exam ? null : el('span', { class: 'muted', textContent: interval(q) }))))
      : el('button', { type: 'button', id: 'sess-show', class: 'primary big-btn', textContent: 'Показать ответ', onclick: () => { s.shown = true; renderSession(); } });
    overlay.replaceChildren(
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', id: 'sess-pos', textContent: `${s.i + 1} / ${s.queue.length}` }),
        el('button', { type: 'button', id: 'sess-close', class: 'link', textContent: 'Закончить', onclick: closeSession })),
      bar(s.i, s.queue.length), face, controls);
    overlay.focus({ preventScroll: true });
  }
  function renderExamSummary() {
    const s = session, total = s.counts.again + s.counts.hard + s.counts.good, ok = s.counts.good + s.counts.hard;
    const pct = total ? Math.round((ok / total) * 100) : 0;
    overlay.replaceChildren(
      el('div', { class: 'flash' },
        el('h3', { textContent: 'Экзамен завершён' }),
        el('p', { class: 'big', id: 'sess-result', textContent: `${pct}%` }),
        el('p', { class: 'muted', id: 'exam-line', textContent: `Верно: ${ok} из ${total} (уверенно: ${s.counts.good}, с трудом: ${s.counts.hard}). Расписание повторений не менялось.` }),
        s.missed.length ? el('div', { id: 'exam-missed' }, el('p', { class: 'muted', textContent: 'Не вспомнил:' }), ...s.missed.map(c => el('p', { class: 'exam-miss' }, el('strong', { textContent: c.q }), el('span', { class: 'muted', textContent: ` — ${c.a}` })))) : el('p', { textContent: 'Ни одной ошибки!' })),
      el('button', { type: 'button', id: 'sess-done', class: 'primary big-btn', textContent: 'Готово', onclick: closeSession }));
    overlay.focus({ preventScroll: true });
  }
  function renderSummary() {
    if (session.exam) return renderExamSummary();
    const s = session, total = s.counts.again + s.counts.hard + s.counts.good;
    const pct = total ? Math.round(((s.counts.hard + s.counts.good) / total) * 100) : 0;
    const gained = lessonSkillStatus(events).ready.filter(r => !s.skillsBefore?.has(r.lesson.id));          // уроки, карточки которых выучены именно сейчас
    const skillsBox = gained.length ? el('div', { class: 'card calm', id: 'sess-skills' }, el('strong', { textContent: `Освоено: ${gained.length}` }),
      ...gained.slice(0, 3).map(r => el('p', { textContent: r.goal ? r.goal.charAt(0).toUpperCase() + r.goal.slice(1) : r.lesson.title })),
      el('button', { type: 'button', id: 'sess-skills-add', class: 'chip', textContent: 'Добавить в «Навыки»', onclick: async e => {
        const evs = gained.map(r => skillFromLesson(r.track, r.lesson, events)); e.target.disabled = true;
        await store.saveMany(evs); toast(`Добавлено навыков: ${evs.length}`, { actionLabel: 'Отменить', onAction: () => store.removeMany(evs.map(x => x.id)) });
      } })) : null;
    overlay.replaceChildren(
      el('div', { class: 'flash' },
        el('h3', { textContent: 'Сессия завершена' }),
        el('p', { class: 'big', id: 'sess-result', textContent: `${pct}%` }),
        el('p', { class: 'muted', textContent: `Ответов: ${total} · помню: ${s.counts.good} · трудно: ${s.counts.hard} · забыл: ${s.counts.again} · новых: ${s.fresh}` }),
        el('p', { class: 'muted', textContent: 'Забытые карточки вернутся сегодня, остальные — через нарастающие интервалы.' }), skillsBox),
      el('button', { type: 'button', id: 'sess-done', class: 'primary big-btn', textContent: 'Готово', onclick: closeSession }));
    overlay.focus({ preventScroll: true });
  }
  overlay.addEventListener('keydown', e => {
    if (!session) { if (e.key === 'Escape' && extraClose) { e.stopPropagation(); extraClose(); } return; }
    e.stopPropagation();                              // чтобы не срабатывали глобальные клавиши приложения
    if (e.key === 'Escape') { closeSession(); return; }
    if (session.i >= session.queue.length) return;
    if (!session.shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); session.shown = true; renderSession(); }
    else if (session.shown) { const q = { 1: 'again', 2: 'hard', 3: 'good' }[e.key]; if (q) { e.preventDefault(); answer(q); } }
  });

  // ---------- общий ----------
  function render() {
    if (page.name === 'track') { const t = trackById(page.id); if (t && !t.zero) return renderTrack(t); page = { name: 'home' }; }
    if (page.name === 'stage') { const z = trackById(page.trackId); if (z?.zero && stageNames(z).includes(page.stage)) return renderStage(z, page.stage); page = { name: 'home' }; }
    if (page.name === 'my') return renderMy();
    renderHome();
  }
  return {
    root,
    overlay,
    update(evs) {
      events = evs;
      if (!evs.length && extraClose) extraClose();                                      // приложение заблокировано: закрыть диктант/минутку
      if (!evs.length) { speakHost.hidden = true; speakHost.replaceChildren(); }
      if (session && !evs.length) { session = null; overlay.hidden = true; overlay.replaceChildren(); }   // приложение заблокировано
      if (!session && !extraClose) render();
    },
    show() { if (!session && !extraClose) render(); if (speakHost.hidden && hasRunningSpeak()) startSpeaking('english', true); },
    // открыть курс (и урок) из поиска
    open(trackId, lessonId = null) {
      if (session) return;
      if (trackById(trackId)?.zero) { ctx.openZero?.(trackId, lessonId); return; }
      page = trackById(trackId) ? { name: 'track', id: trackId } : { name: 'home' };
      if (lessonId) openLessons.add(lessonId);
      render();
      if (lessonId) root.querySelector(`.lesson[data-lesson="${lessonId}"]`)?.scrollIntoView?.({ block: 'start' });
      else window.scrollTo(0, 0);
    },
  };
}
