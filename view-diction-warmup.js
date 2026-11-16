// Вкладка «Разминка»: список упражнений (шаги, повторы, типичные ошибки) и плеер с таймером удержания и счётчиком повторов.
import { el, fill, announce } from './ui.js';
import { WARMUP, WARMUP_GROUPS, WARMUP_SETS, warmupSet, fmtClock, makeDiction, plural, weakGroups, dayNumber } from './diction.js';

const exById = id => WARMUP.find(e => e.id === id) ?? null;
const repsText = ex => `${ex.reps} ${plural(ex.reps, ['повтор', 'повтора', 'повторов'])}${ex.hold ? `, удержание ${ex.hold} с` : ''}`;

export function createWarmupTab(k) {
  function exerciseCard(ex) {
    return el('details', { class: 'card dic-ex', dataset: { ex: ex.id } },
      el('summary', {}, el('strong', { textContent: ex.title }), el('span', { class: 'muted', textContent: ` · ${repsText(ex)}` })),
      el('ol', { class: 'plain' }, ...ex.steps.map(s => el('li', { textContent: s }))),
      el('p', { class: 'muted' }, el('strong', { textContent: 'Типичные ошибки: ' }), ex.mistakes.join(' ')),
      el('button', { type: 'button', class: 'chip dic-ex-one', dataset: { ex: ex.id }, 'aria-label': `Сделать упражнение «${ex.title}»`, textContent: 'Сделать это упражнение', onclick: () => play([ex.id], ex.id) }));
  }

  function render(panel) {
    const arg = k.take();
    const sets = el('div', { id: 'dic-sets', class: 'chips', role: 'group', 'aria-label': 'Наборы разминки' }, ...WARMUP_SETS.map(s => el('button', { type: 'button', class: 'chip dic-set', dataset: { set: s.id }, textContent: s.title,
      onclick: () => { const w = warmupSet(s.id, { weak: weakGroups(k.events, k.today(), k.pref('weak', [])), seed: dayNumber(k.today()) }); play(w.ids, s.id); } })));
    fill(panel,
      el('div', { class: 'card' },
        el('h3', { textContent: 'Разминка для губ, языка и челюсти' }),
        el('p', { class: 'muted', textContent: 'Делай медленно и перед зеркалом. Нижняя челюсть спокойна, плечи опущены. Дыши носом и не задерживай дыхание.' }),
        el('p', { class: 'dic-safety muted', textContent: 'Если упражнение причиняет боль, пропусти его. Если челюсть часто щёлкает или болит, расскажи об этом врачу.' }),
        sets),
      ...Object.entries(WARMUP_GROUPS).flatMap(([g, title]) => [el('h2', { textContent: title }), ...WARMUP.filter(e => e.group === g).map(exerciseCard)]));
    if (arg?.ids) play(arg.ids, arg.set ?? 'routine');
  }

  // Плеер: по очереди все упражнения набора. Повторы считает кнопка «Сделал» или таймер удержания.
  function play(ids, setId) {
    const list = ids.map(exById).filter(Boolean);
    if (!list.length) return;
    let i = 0, rep = 0, done = 0, tick = null, holding = false, left = 0;
    const t0 = performance.now();
    k.open(api => {
      api.onClose(() => { clearInterval(tick); });
      const elapsed = () => Math.round((performance.now() - t0) / 1000);

      function step() {
        clearInterval(tick); holding = false;
        const ex = list[i], total = list.length;
        const title = el('h3', { id: 'dic-ex-title', tabIndex: -1, textContent: ex.title });
        const count = el('p', { id: 'dic-ex-count', class: 'dic-count', role: 'status' });
        const clock = el('div', { id: 'dic-ex-clock', class: 'dic-clock', 'aria-hidden': 'true' });
        const main = el('button', { type: 'button', id: 'dic-ex-main', class: 'primary big-btn' });
        const paint = () => {
          count.textContent = rep >= ex.reps ? `Готово: ${ex.reps} из ${ex.reps}` : `Повтор ${rep + 1} из ${ex.reps}`;
          clock.textContent = holding ? String(left) : ex.hold ? `${ex.hold} с` : '';
          main.textContent = rep >= ex.reps ? (i + 1 < total ? 'Дальше' : 'Завершить') : ex.hold ? (holding ? 'Держу…' : 'Начать повтор') : 'Сделал';
          main.disabled = holding;
        };
        const addRep = () => { rep++; holding = false; clearInterval(tick); paint(); if (rep >= ex.reps) announce(`Упражнение «${ex.title}» выполнено`); };
        main.onclick = () => {
          if (rep >= ex.reps) { done++; next(); return; }
          if (!ex.hold) { addRep(); return; }
          holding = true; left = ex.hold; paint();
          tick = setInterval(() => { left--; if (left <= 0) addRep(); else paint(); }, 1000);
        };
        api.set(
          k.top(`Разминка · упражнение ${i + 1} из ${total}`, 'dic-stop', 'Закончить', () => finish()),
          el('div', { class: 'card bt-intro' }, title,
            el('p', { class: 'muted', textContent: `${WARMUP_GROUPS[ex.group]} · ${repsText(ex)}` }),
            el('ol', { class: 'plain' }, ...ex.steps.map(s => el('li', { textContent: s }))),
            el('details', {}, el('summary', { textContent: 'Типичные ошибки' }), el('ul', { class: 'plain' }, ...ex.mistakes.map(m => el('li', { textContent: m })))),
            el('div', { class: 'bar', role: 'img', 'aria-label': `Выполнено упражнений: ${done} из ${total}` }, el('span', { style: `width:${Math.round((done / total) * 100)}%` })),
            clock, count, main,
            el('button', { type: 'button', id: 'dic-ex-skip', class: 'chip', textContent: 'Пропустить', onclick: () => next() }),
            k.safety()));
        paint();
        announce(`Упражнение ${i + 1} из ${total}: ${ex.title}. ${repsText(ex)}`);
        title.focus({ preventScroll: true });
      }
      function next() { i++; rep = 0; if (i >= list.length) finish(); else step(); }
      async function finish() {
        clearInterval(tick);
        const sec = elapsed();
        let note = 'Слишком коротко: меньше двадцати секунд не записываю.', saved = false;
        if (done >= 1 && sec >= 20) { await k.save(makeDiction({ kind: 'warmup', seconds: sec, items: done, ref: setId })); note = `Записано: упражнений ${done}, время ${fmtClock(sec)}.`; saved = true; }
        else if (done === 0) note = 'Ни одно упражнение не завершено, поэтому не записываю.';
        api.set(el('div', { class: 'card bt-intro' }, el('h3', { id: 'dic-w-fin-title', tabIndex: -1, textContent: saved ? 'Разминка готова' : 'Остановлено' }), el('p', { id: 'dic-w-fin-note', textContent: note }),
          el('button', { type: 'button', id: 'dic-w-close', class: 'primary big-btn', textContent: 'Закрыть', onclick: () => api.close() })));
        document.getElementById('dic-w-fin-title')?.focus({ preventScroll: true });
        announce(note);
      }
      step();
    });
  }
  return { render };
}
