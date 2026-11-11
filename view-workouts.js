// Экран «Тренировки»: идущая тренировка (подходы пишутся сразу), история, личные рекорды, недельная цель по силовым.
import { el, toast, dateRu } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { TEMPLATES, WEEKLY_STRENGTH_GOAL, startWorkout, addExercise, addSet, removeSet, finishWorkout, activeWorkout, doneWorkouts, strengthDays, setsOf, volumeOf, suggestion, lastSets, personalRecords, newRecords } from './workouts.js';

const KIND_LABEL = { reps: 'повторения', time: 'секунды', cardio: 'минуты' };
const f1 = v => String(Math.round(v * 10) / 10).replace('.', ',');

export function createWorkoutsView() {
  let events = [];
  let rest = null;                 // { until, id } — таймер отдыха
  let pendingFocus = null;
  let finishing = false;
  const root = el('section', { id: 'view-workouts', class: 'view' });
  const bar = (v, total) => el('div', { class: 'bar', role: 'img', 'aria-label': `${v} из ${total}` }, el('span', { style: `width:${Math.min(100, Math.round((v / total) * 100))}%` }));

  // ---------- таймер отдыха ----------
  const restBox = el('div', { id: 'wk-rest', class: 'card tight row', hidden: true });
  function paintRest() {
    if (rest) clearTimeout(rest.id);
    if (!rest) { restBox.hidden = true; return; }
    const left = Math.max(0, Math.ceil((rest.until - Date.now()) / 1000));
    restBox.hidden = false;
    restBox.replaceChildren(el('span', { class: 'grow', id: 'wk-rest-left', textContent: left ? `Отдых: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Отдых закончился — следующий подход' }),
      el('button', { type: 'button', class: 'chip', id: 'wk-rest-skip', textContent: left ? 'Пропустить' : 'Ок', onclick: () => { clearTimeout(rest?.id); rest = null; paintRest(); } }));
    if (left) rest.id = setTimeout(paintRest, 500);
    else { try { navigator.vibrate?.(300); } catch { /* не везде есть */ } }
  }
  function startRest(sec = 90) { clearTimeout(rest?.id); if (sec <= 0) { rest = null; paintRest(); return; } rest = { until: Date.now() + sec * 1000, id: null }; paintRest(); }

  // ---------- идущая тренировка ----------
  const save = async ev => { await store.save(ev); };
  function exerciseCard(w, ex, i) {
    const last = lastSets(events, ex.name, w.id);
    const prefill = ex.sets.at(-1) ?? last?.sets.at(-1) ?? {};
    const mk = (id, ph, val, step = '1') => el('input', { id, type: 'number', inputMode: 'decimal', min: '0', step, placeholder: ph, value: val ?? '', 'aria-label': ph });
    const reps = mk(`wk-reps-${i}`, ex.kind === 'cardio' ? 'минуты' : ex.kind === 'time' ? 'секунды' : 'повт.', ex.kind === 'cardio' ? (prefill.sec ? Math.round(prefill.sec / 60) : '') : ex.kind === 'time' ? prefill.sec : prefill.reps);
    const kg = ex.kind === 'reps' ? mk(`wk-kg-${i}`, 'кг', prefill.kg, '0.5') : null;
    const add = async () => {
      try {
        const set = ex.kind === 'cardio' ? { sec: Number(reps.value) * 60 } : ex.kind === 'time' ? { sec: reps.value } : { reps: reps.value, kg: kg.value };
        pendingFocus = `wk-reps-${i}`;
        await save(addSet(w, i, set));
        startRest(ex.kind === 'cardio' ? 0 : 90);
      } catch (e) { pendingFocus = null; toast(e.message); }
    };
    const rows = ex.sets.map((s, j) => el('li', { class: 'wk-set' },
      el('span', { class: 'grow', textContent: `${j + 1}. ${ex.kind === 'time' ? `${s.sec} с` : ex.kind === 'cardio' ? `${f1((s.sec || 0) / 60)} мин` : `${s.reps} повт.${s.kg ? ` × ${f1(s.kg)} кг` : ''}`}` }),
      el('button', { type: 'button', class: 'chip', 'aria-label': `Удалить подход ${j + 1}`, textContent: '✕', onclick: () => save(removeSet(w, i, j)) })));
    const target = ex.target ? `Цель: ${ex.target[0]}–${ex.target[1]} ${ex.kind === 'time' ? 'с' : 'повт.'}${ex.plan ? `, подходов: ${ex.plan}` : ''}` : '';
    return el('div', { class: 'card wk-ex', dataset: { ex: String(i) } },
      el('strong', { textContent: ex.name }), target ? el('div', { class: 'muted', textContent: target }) : null,
      el('div', { class: 'hint wk-hint', textContent: suggestion(events, ex, w.id) }),
      rows.length ? el('ul', { class: 'plain wk-sets' }, ...rows) : null,
      el('div', { class: 'row wk-input' }, reps, kg, el('button', { type: 'button', class: 'primary', id: `wk-add-${i}`, textContent: 'Подход ✓', onclick: add })));
  }
  function renderActive(w) {
    const exName = el('input', { id: 'wk-newex', type: 'text', maxLength: 80, placeholder: 'Добавить упражнение', autocomplete: 'off' });
    const kindSel = el('select', { id: 'wk-newkind', 'aria-label': 'Тип' }, ...Object.entries(KIND_LABEL).map(([v, t]) => el('option', { value: v, textContent: t })));
    const addEx = async () => { try { await save(addExercise(w, exName.value, kindSel.value)); } catch (e) { toast(e.message); } };
    const head = el('div', { class: 'card', id: 'wk-active' },
      el('h3', { textContent: w.payload.name }),
      el('p', { class: 'muted', textContent: `Идёт с ${new Date(w.payload.startedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })} · подходов: ${setsOf(w)}` }),
      el('div', { class: 'row wrap' },
        el('button', { type: 'button', class: 'primary', id: 'wk-finish', textContent: 'Завершить', onclick: () => { finishing = true; render(); } }),
        el('button', { type: 'button', class: 'chip danger', id: 'wk-cancel', textContent: 'Отменить тренировку', onclick: async () => { const old = await store.remove(w.id); toast('Тренировка отменена', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } })));
    const finishForm = el('div', { class: 'card', id: 'wk-finish-form' }, el('strong', { textContent: 'Как прошла тренировка?' }),
      el('p', { class: 'muted', textContent: 'Усилие по шкале от 1 (легко) до 10 (на пределе) — по желанию.' }),
      el('div', { class: 'rate-btns wk-rpe', role: 'group', 'aria-label': 'Усилие' }, ...Array.from({ length: 10 }, (_, k) => el('button', { type: 'button', class: 'rate', dataset: { v: String(k + 1) }, textContent: String(k + 1), 'aria-pressed': 'false' }))),
      el('input', { id: 'wk-note', type: 'text', maxLength: 300, placeholder: 'Заметка (по желанию)', autocomplete: 'off' }),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', id: 'wk-finish-ok', textContent: 'Сохранить тренировку' }), el('button', { type: 'button', id: 'wk-finish-back', textContent: 'Назад', onclick: () => { finishing = false; render(); } })));
    let rpe = null;
    for (const b of finishForm.querySelectorAll('.rate')) b.onclick = () => { rpe = rpe === Number(b.dataset.v) ? null : Number(b.dataset.v); for (const x of finishForm.querySelectorAll('.rate')) x.setAttribute('aria-pressed', String(Number(x.dataset.v) === rpe)); };
    finishForm.querySelector('#wk-finish-ok').onclick = async () => {
      try {
        const done = finishWorkout(w, { rpe, note: finishForm.querySelector('#wk-note').value });
        const records = newRecords(events, done);
        finishing = false; clearTimeout(rest?.id); rest = null;
        await save(done);
        toast(records.length ? `Сохранено. Новые рекорды: ${records.join('; ')}` : 'Тренировка сохранена', { ms: records.length ? 9000 : 5000 });
      } catch (e) { toast(e.message); }
    };
    const addRow = el('div', { class: 'card row', id: 'wk-addrow' }, exName, kindSel, el('button', { type: 'button', id: 'wk-newex-add', class: 'chip', textContent: '+', 'aria-label': 'Добавить упражнение', onclick: addEx }));
    return [head, finishing ? finishForm : null, restBox, ...w.payload.exercises.map((ex, i) => exerciseCard(w, ex, i)), addRow];
  }

  // ---------- главная ----------
  function renderHome() {
    const today = todayStr();
    const days = strengthDays(events, today);
    const done = doneWorkouts(events);
    const sel = el('select', { id: 'wk-template', 'aria-label': 'Шаблон' }, ...TEMPLATES.map(t => el('option', { value: t.id, textContent: t.title })), el('option', { value: '', textContent: 'Пустая тренировка' }));
    const about = el('p', { class: 'muted', id: 'wk-about' });
    const paintAbout = () => { about.textContent = TEMPLATES.find(t => t.id === sel.value)?.about ?? 'Добавляй упражнения сам.'; };
    sel.onchange = paintAbout; paintAbout();
    const head = el('div', { class: 'card', id: 'wk-week' }, el('h3', { textContent: 'Силовые за неделю' }),
      el('p', { class: 'big', id: 'wk-days', textContent: `${days} из ${WEEKLY_STRENGTH_GOAL}` }),
      bar(days, WEEKLY_STRENGTH_GOAL),
      el('p', { class: 'muted', textContent: days >= WEEKLY_STRENGTH_GOAL ? 'Цель недели выполнена — это уровень рекомендаций ВОЗ.' : 'ВОЗ советует силовые упражнения на основные группы мышц минимум 2 дня в неделю.' }));
    const startCard = el('div', { class: 'card form-stack' }, el('strong', { textContent: 'Начать тренировку' }), sel, about,
      el('button', { type: 'button', class: 'primary big-btn', id: 'wk-start', textContent: 'Начать', onclick: async () => { try { await save(startWorkout({ templateId: sel.value || null })); } catch (e) { toast(e.message); } } }),
      el('p', { class: 'muted', textContent: 'Не работай через острую боль. При травмах, болезнях и беременности согласуй нагрузку с врачом.' }));
    const history = done.slice(0, 10).map(w => el('details', { class: 'card run', dataset: { wk: w.id } },
      el('summary', {}, el('span', { textContent: `${dateRu(w.payload.date)} · ${w.payload.name}` }), el('span', { class: 'muted', textContent: `${setsOf(w)} подх. · ${w.payload.minutes ?? '—'} мин` })),
      ...w.payload.exercises.map(ex => el('p', {}, el('strong', { textContent: ex.name + ': ' }), el('span', { class: 'muted', textContent: ex.sets.map(s => (ex.kind === 'time' ? `${s.sec} с` : ex.kind === 'cardio' ? `${f1((s.sec || 0) / 60)} мин` : `${s.reps}${s.kg ? '×' + f1(s.kg) : ''}`)).join(', ') }))),
      el('p', { class: 'muted', textContent: [volumeOf(w) ? `Объём: ${Math.round(volumeOf(w))} кг` : '', w.payload.rpe ? `усилие ${w.payload.rpe}/10` : '', w.payload.note ?? ''].filter(Boolean).join(' · ') }),
      el('button', { type: 'button', class: 'chip danger', textContent: 'Удалить', onclick: async () => { const old = await store.remove(w.id); toast('Тренировка удалена', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } })));
    const recs = personalRecords(events).filter(r => r.maxKg || r.maxReps || r.maxSec);
    const recBox = recs.length ? el('details', { class: 'card', id: 'wk-records' }, el('summary', { textContent: `Личные рекорды (${recs.length})` }),
      el('ul', { class: 'plain' }, ...recs.map(r => el('li', { textContent: `${r.name}: ${[r.maxKg ? `${f1(r.maxKg)} кг` : '', r.maxReps ? `${r.maxReps} повт. без веса` : '', r.maxSec ? `${r.maxSec} с` : ''].filter(Boolean).join(' · ')}` })))) : null;
    return [head, startCard, history.length ? el('h2', { textContent: 'История' }) : null, ...history, recBox];
  }

  function render() {
    const w = activeWorkout(events);
    const nodes = w ? renderActive(w) : renderHome();
    root.replaceChildren(...nodes.filter(Boolean));
    if (w) paintRest();
    if (pendingFocus) { const n = root.querySelector('#' + pendingFocus); pendingFocus = null; n?.focus(); n?.select?.(); }
  }
  return {
    root,
    update(evs) { events = evs; if (!root.hidden) render(); },
    show() { finishing = false; render(); },
  };
}
