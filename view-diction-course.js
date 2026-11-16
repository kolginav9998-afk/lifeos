// Вкладка «Курс»: 32 урока в 8 модулях, отметка «пройден» (как в «Учёбе»), мини-тест из заданий урока, наставник и запросы для ИИ-тренера.
import { el, fill, toast, announce, copyText, ring } from './ui.js';
import { TRACKS, doneLessons, makeLessonDone, lessonEventId, lessonGoal } from './academy.js';
import { gradeDrill, shuffled } from './zero-kit.js';
import { MODULES } from './c-diction.js';
import { parseMarkup, plainText } from './diction.js';

const answerText = d => (d.t === 'choose' || d.t === 'listen' ? d.right : d.t === 'typed' ? d.ok[0] : d.t === 'order' ? d.tiles.join(' → ') : d.t === 'match' ? d.pairs.map(p => p.join(' — ')).join('; ') : '');
const seedOf = (id, i) => [...`${id}:${i}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function createCourseTab(k) {
  const track = TRACKS.find(t => t.id === 'diction');
  const open = new Set(), runs = new Map();           // какие уроки раскрыты и как идёт мини-тест (живут, пока открыт экран)

  // Мини-тест: задания урока по очереди. Проверяемые считаются, «прочитай вслух» — самооценка и в счёт не идёт.
  function drillBox(l) {
    const box = el('div', { class: 'dic-quiz', dataset: { lesson: l.id } });
    const draw = () => {
      const st = runs.get(l.id);
      if (!st) { fill(box, el('button', { type: 'button', class: 'chip dic-quiz-start', dataset: { lesson: l.id }, textContent: `Мини-тест: ${l.drills.length} заданий`, onclick: () => { runs.set(l.id, { i: 0, ok: 0, graded: 0 }); draw(); } })); return; }
      if (st.i >= l.drills.length) {
        fill(box, el('p', { class: 'quiz-result', role: 'status', textContent: st.graded ? `Верно: ${st.ok} из ${st.graded}. ${st.ok === st.graded ? 'Отлично!' : 'Что не получилось, перечитай урок и попробуй ещё раз.'}` : 'Готово.' }),
          el('button', { type: 'button', class: 'chip dic-quiz-again', textContent: 'Ещё раз', onclick: () => { runs.delete(l.id); draw(); } }));
        return;
      }
      const d = l.drills[st.i], seed = seedOf(l.id, st.i);
      const fb = el('p', { class: 'dic-fb', role: 'status' });
      const next = el('button', { type: 'button', class: 'chip dic-quiz-next', hidden: true, textContent: st.i + 1 < l.drills.length ? 'Дальше' : 'Результат', onclick: () => { st.i++; draw(); } });
      const grade = (answer, lock) => {
        const ok = gradeDrill(d, answer);
        st.graded++; if (ok) st.ok++;
        fb.textContent = ok ? 'Верно.' : `Не совсем. Правильный ответ: ${answerText(d)}.${d.explain ? ` ${d.explain}` : ''}`;
        lock(ok); next.hidden = false; next.focus({ preventScroll: true }); announce(fb.textContent);
      };
      let body;
      if (d.t === 'choose' || d.t === 'listen') {
        const btns = shuffled([d.right, ...d.wrong], seed).map(o => el('button', { type: 'button', class: 'quiz-opt', textContent: o, onclick: e => {
          const me = e.currentTarget;
          grade(o, ok => { btns.forEach(b => { b.disabled = true; if (b.textContent === d.right) b.classList.add('right'); }); if (!ok) me.classList.add('wrong'); });
        } }));
        body = el('div', { class: 'dic-opts', role: 'group', 'aria-label': 'Варианты ответа' }, ...btns);
      } else if (d.t === 'typed') {
        const input = el('input', { type: 'text', class: 'dic-typed', autocomplete: 'off', 'aria-label': 'Ответ' });
        const ok = el('button', { type: 'button', class: 'chip', textContent: 'Проверить', onclick: () => grade(input.value, () => { input.disabled = true; ok.disabled = true; }) });
        body = el('div', { class: 'row wrap' }, input, ok);
      } else if (d.t === 'order') {
        const picked = [], line = el('p', { class: 'dic-order-line', 'aria-live': 'polite', textContent: 'Нажимай плитки по порядку' });
        const tiles = shuffled(d.tiles, seed).map(t => el('button', { type: 'button', class: 'chip dic-tile', textContent: t, onclick: e => { picked.push(t); e.currentTarget.disabled = true; line.textContent = picked.join(' → '); } }));
        const check = el('button', { type: 'button', class: 'chip', textContent: 'Проверить', onclick: () => grade(picked, () => { check.disabled = true; tiles.forEach(b => { b.disabled = true; }); }) });
        const reset = el('button', { type: 'button', class: 'chip', textContent: 'Сбросить', onclick: () => { picked.length = 0; line.textContent = 'Нажимай плитки по порядку'; tiles.forEach(b => { b.disabled = false; }); } });
        body = el('div', {}, el('div', { class: 'chips' }, ...tiles), line, el('div', { class: 'row wrap' }, check, reset));
      } else if (d.t === 'match') {
        const rights = shuffled(d.pairs.map(p => p[1]), seed);
        const sels = d.pairs.map(p => el('select', { class: 'dic-match', 'aria-label': p[0] }, el('option', { value: '', textContent: 'Выбери…' }), ...rights.map(r => el('option', { value: r, textContent: r }))));
        const check = el('button', { type: 'button', class: 'chip', textContent: 'Проверить', onclick: () => grade(d.pairs.map((p, j) => [p[0], sels[j].value]), () => { check.disabled = true; sels.forEach(s => { s.disabled = true; }); }) });
        body = el('div', { class: 'form-stack' }, ...d.pairs.map((p, j) => el('label', { class: 'field' }, el('span', { class: 'rating-label', textContent: p[0] }), sels[j])), check);
      } else {
        const more = el('button', { type: 'button', class: 'chip', textContent: 'Прочитал вслух', onclick: () => { st.i++; draw(); } });
        body = el('div', {}, el('div', { class: 'dic-read', lang: 'ru' }, ...parseMarkup(d.text).map(line => el('p', { class: 'dic-line', textContent: line.filter(t => t.w).map(t => t.w).join(' ') }))), k.voice(() => plainText(d.text), () => 0.9), more);
      }
      fill(box, el('p', { class: 'muted', textContent: `Задание ${st.i + 1} из ${l.drills.length}` }), el('p', { class: 'quiz-q', textContent: d.q ?? 'Прочитай вслух' }), body, fb, next);
    };
    draw();
    return box;
  }

  async function toggleDone(l, isDone) {
    if (isDone) { const old = await k.remove(lessonEventId(l.id)); toast('Отметка снята', old ? { actionLabel: 'Вернуть', onAction: () => k.save(old) } : {}); }
    else { await k.save(makeLessonDone(track, l, k.today())); toast(`Урок пройден. Карточек в повторении: +${l.cards.length}`); }
  }

  function lessonCard(panel, l, idx, done) {
    const isDone = done.has(l.id);
    const d = el('details', { class: 'card lesson dic-lesson', dataset: { lesson: l.id }, open: open.has(l.id) },
      el('summary', {}, el('span', { class: 'lesson-n', textContent: isDone ? '✓' : String(idx + 1) }), el('span', { textContent: ` ${l.title} · ${l.minutes} мин${isDone ? ' · пройден' : ''}` })),
      el('p', { class: 'lesson-goal' }, el('strong', { textContent: 'После урока я смогу: ' }), lessonGoal(l.id)),
      ...l.body.map(p => el('p', { textContent: p })),
      el('p', { class: 'task' }, el('strong', { textContent: 'Задание: ' }), l.task),
      drillBox(l),
      el('p', { class: 'muted', textContent: `Карточек в уроке: ${l.cards.length}. Повторять их можно в разделе «Учёба».` }),
      el('button', { type: 'button', class: isDone ? '' : 'primary', dataset: { done: l.id }, textContent: isDone ? 'Снять отметку «пройден»' : 'Отметить пройденным', onclick: () => toggleDone(l, isDone) }));
    d.addEventListener('toggle', () => { if (d.open) open.add(l.id); else open.delete(l.id); });
    return d;
  }

  function render(panel) {
    const done = doneLessons(k.events), total = track.lessons.length, n = track.lessons.filter(l => done.has(l.id)).length;
    const nextLesson = track.lessons.find(l => !done.has(l.id));
    const mentor = el('details', { class: 'card', id: 'dic-mentor' }, el('summary', { textContent: `Наставник: ${track.mentor.name}` }),
      el('p', { class: 'muted', textContent: track.mentor.role }), el('ul', { class: 'plain' }, ...track.mentor.principles.map(x => el('li', { textContent: x }))),
      el('h2', { textContent: 'Запросы для ИИ-тренера' }),
      el('p', { class: 'muted', textContent: 'Скопируй запрос, подставь свои данные вместо <…> и вставь в чат с ИИ-помощником. Личные данные и записи голоса туда не отправляй.' }),
      ...track.mentor.prompts.map((pr, i) => el('div', { class: 'prompt' }, el('p', { textContent: pr }), el('button', { type: 'button', class: 'chip', dataset: { prompt: String(i) }, 'aria-label': `Копировать запрос ${i + 1}`, textContent: 'Копировать', onclick: () => copyText(pr) }))));
    fill(panel,
      el('div', { class: 'card', id: 'dic-course-head' },
        el('div', { class: 'row' }, ring(n / total, { size: 72, stroke: 8, label: `${n}`, name: 'Пройдено уроков' }), el('div', { class: 'grow' }, el('h3', { textContent: track.title }), el('p', { class: 'muted', id: 'dic-course-count', textContent: `Пройдено уроков: ${n} из ${total}` }))),
        el('p', { textContent: track.intro }),
        nextLesson ? el('button', { type: 'button', id: 'dic-course-next', class: 'chip', textContent: `Следующий урок: ${nextLesson.title}`, onclick: () => { open.add(nextLesson.id); render(panel); panel.querySelector(`[data-lesson="${nextLesson.id}"]`)?.scrollIntoView?.({ block: 'start' }); } }) : el('p', { class: 'ok', textContent: 'Все уроки пройдены. Сделай итоговую самооценку.' }),
        el('button', { type: 'button', id: 'dic-course-learn', class: 'chip', textContent: 'Карточки курса: раздел «Учёба»', onclick: () => k.goLearn() })),
      mentor,
      ...MODULES.flatMap(m => [el('h2', { textContent: `Модуль ${m.n}. ${m.title}` }), ...track.lessons.map((l, idx) => [l, idx]).filter(([l]) => l.module === m.n).map(([l, idx]) => lessonCard(panel, l, idx, done))]),
      el('details', { class: 'card' }, el('summary', { textContent: 'План по неделям' }), el('ul', { class: 'plain' }, ...track.plan.map(w => el('li', { textContent: `Неделя ${w.week}: ${w.focus}. Каждый день: ${w.daily}.` })))),
      el('details', { class: 'card' }, el('summary', { textContent: 'Источники и опора' }), el('ul', { class: 'plain' }, ...track.sources.map(s => el('li', { textContent: s })))),
      el('p', { class: 'muted', textContent: 'Курс написан с помощью ИИ и не проверен логопедом. Это учебный материал, а не медицинская консультация.' }));
  }
  return { render };
}
