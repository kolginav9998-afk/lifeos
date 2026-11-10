// Интерфейс прохождения проверок: инструкции, стимулы, замер времени, сбор проб. Расчёт результатов — в bt-logic.js.
// Принципы: время берём из performance.now() в момент касания (pointerdown); любой шаг можно прервать; ничего не отправляется по сети.
import { el, ratingRow } from './ui.js';
import { makeRng } from './stats.js';
import * as L from './bt-logic.js';
import { TEST_BY_ID, STATE_FIELDS, cleanState } from './bt-core.js';

export class Aborted extends Error {}
const now = () => performance.now();

// host — контейнер окна. history: { recentWords: [...] } (чтобы слова не повторялись), cards: { started: [...], pool: [...] } для проверки знаний.
export function createRunner(host, { history = {}, cards = { started: [], pool: [] }, seed = Date.now() } = {}) {
  const rng = makeRng(seed);
  const pending = new Set();
  let aborted = false;
  const shared = {};
  const top = el('div', { class: 'sess-top' });
  const label = el('span', { class: 'muted', id: 'bt-pos' });
  const abortBtn = el('button', { type: 'button', id: 'bt-abort', class: 'link', textContent: 'Прервать', onclick: () => abort() });
  top.append(label, abortBtn);
  const stage = el('div', { id: 'bt-stage', class: 'bt-stage' });
  host.replaceChildren(top, stage);
  host.hidden = false;

  const abort = () => { aborted = true; for (const w of [...pending]) w.cancel(); };

  // Универсальное ожидание: setup получает done() и помощники timer/on, всё очищается само.
  function waitFor(setup) {
    return new Promise((resolve, reject) => {
      if (aborted) return reject(new Aborted());
      const cleanups = [];
      const w = { cancel: () => { pending.delete(w); cleanups.forEach(f => f()); reject(new Aborted()); } };
      pending.add(w);
      const done = v => { if (!pending.has(w)) return; pending.delete(w); cleanups.forEach(f => f()); resolve(v); };
      setup(done, {
        timer: (fn, ms) => { const id = setTimeout(fn, ms); cleanups.push(() => clearTimeout(id)); return id; },
        on: (node, type, fn, opts) => { node.addEventListener(type, fn, opts); cleanups.push(() => node.removeEventListener(type, fn, opts)); },
      });
    });
  }
  const sleep = ms => waitFor((done, h) => h.timer(done, ms));
  const set = (test, phase, ...nodes) => { stage.dataset.test = test; stage.dataset.phase = phase; stage.replaceChildren(...nodes.flat().filter(Boolean)); };

  // ---------- общие экраны ----------
  const button = (text, id, onclick) => el('button', { type: 'button', id, class: 'primary big-btn', textContent: text, onclick });
  function intro(test, title, lines, btn = 'Начать') {
    return waitFor((done, h) => {
      const go = button(btn, 'bt-go', () => done());
      set(test, 'intro', el('div', { class: 'card bt-intro' }, el('h3', { textContent: title }), ...lines.map(l => el('p', { textContent: l })), go));
      h.on(host, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
    });
  }
  async function countdown(test) {
    for (const n of [3, 2, 1]) { set(test, 'count', el('div', { class: 'bt-count', id: 'bt-count', textContent: String(n) })); await sleep(900); }
  }
  // Цифровая клавиатура: ввод без системной клавиатуры телефона.
  function keypad(onSubmit, h, { maxLen = 9, display } = {}) {
    let value = '';
    const out = display || el('div', { class: 'kp-out', id: 'kp-out', 'aria-live': 'polite' });
    const sync = () => { out.textContent = value || '…'; };
    const press = d => { if (value.length < maxLen) { value += d; sync(); } };
    const back = () => { value = value.slice(0, -1); sync(); };
    const ok = () => { if (value) { const v = value; value = ''; sync(); onSubmit(v); } };
    const key = (t, id, fn, cls = '') => el('button', { type: 'button', id, class: 'kp ' + cls, textContent: t, onpointerdown: e => { e.preventDefault(); fn(); } });
    const grid = el('div', { class: 'kp-grid' },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => key(String(n), `kp-${n}`, () => press(String(n)))),
      key('⌫', 'kp-back', back), key('0', 'kp-0', () => press('0')), key('✓', 'kp-ok', ok, 'ok'));
    sync();
    h.on(host, 'keydown', e => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') back(); else if (e.key === 'Enter') ok(); });
    return { out, grid, press, back, ok, value: () => value, reset: () => { value = ''; sync(); } };
  }

  // ---------- состояние перед проверкой ----------
  function askState() {
    return waitFor((done) => {
      const st = { caffeine3h: false, noise: false };
      const rows = Object.entries(STATE_FIELDS).map(([k, lab]) => ratingRow(lab, k, null, v => { st[k] = v; }));
      const cb = (k, text) => { const i = el('input', { type: 'checkbox', id: `bt-st-${k}`, onchange: () => { st[k] = i.checked; } }); return el('label', { class: 'check-label' }, i, ` ${text}`); };
      set('state', 'intro', el('div', { class: 'card bt-intro' }, el('h3', { textContent: 'Как ты сейчас?' }),
        el('p', { class: 'muted', textContent: 'Это поможет отличить «плохой день» от «плохой формы». Можно пропустить.' }),
        ...rows, cb('caffeine3h', 'Пил кофе или чай за последние 3 часа'), cb('noise', 'Вокруг шумно или отвлекают'),
        el('div', { class: 'row' }, button('Дальше', 'bt-state-ok', () => done(cleanState(st))), el('button', { type: 'button', id: 'bt-state-skip', textContent: 'Пропустить', onclick: () => done(null) }))));
    });
  }

  // ---------- 1. Реакция ----------
  async function reaction({ n = 5 }) {
    await intro('reaction', 'Реакция', ['Экран будет красным. Как только он станет зелёным — сразу нажми на него.', 'Нажмёшь раньше — попытка не засчитается.']);
    await countdown('reaction');
    const trials = []; let fs = 0, ok = 0;
    while (ok < n && fs < 6) {
      const box = el('div', { class: 'bt-box wait', id: 'bt-box', textContent: 'Жди…', dataset: { state: 'wait' } });
      set('reaction', 'run', box);
      const delay = 1500 + rng() * 3000;
      const r = await waitFor((done, h) => {
        let shownAt = null;
        h.on(box, 'pointerdown', e => { e.preventDefault(); done(shownAt === null ? { fs: true } : { rt: now() - shownAt }); });
        h.timer(() => { shownAt = now(); box.className = 'bt-box go'; box.dataset.state = 'go'; box.textContent = 'ЖМИ!'; h.timer(() => done({ rt: 2000, lapse: true }), 2000); }, delay);
      });
      if (r.fs) { fs++; trials.push({ falseStart: true }); box.className = 'bt-box early'; box.dataset.state = 'early'; box.textContent = 'Слишком рано!'; await sleep(900); continue; }
      ok++; trials.push({ rt: r.rt });
      box.className = 'bt-box done'; box.dataset.state = 'done'; box.textContent = `${Math.round(r.rt)} мс`; await sleep(600);
    }
    return { metrics: L.scoreReaction(trials), trials };
  }

  // ---------- 2. Жми / не жми ----------
  async function gonogo({ n = 16 }) {
    await intro('gonogo', 'Жми / не жми', ['Зелёный круг — нажми по экрану как можно быстрее.', 'Красный квадрат — не нажимай.', 'Точность важнее скорости.']);
    await countdown('gonogo');
    const seq = L.makeGoNoGo(rng, n, 0.25), trials = [];
    for (const go of seq) {
      set('gonogo', 'run', el('div', { class: 'bt-box blank', id: 'bt-blank' }));
      await sleep(500 + rng() * 500);
      const stim = el('div', { class: `bt-stim ${go ? 'go' : 'nogo'}`, id: 'bt-stim', dataset: { go: go ? '1' : '0' } });
      const wrap = el('div', { class: 'bt-box blank', id: 'bt-box' }, stim);
      set('gonogo', 'run', wrap);
      const t0 = now();
      const r = await waitFor((done, h) => { h.on(wrap, 'pointerdown', e => { e.preventDefault(); done({ responded: true, rt: now() - t0 }); }); h.timer(() => done({ responded: false }), 800); });
      trials.push({ go, responded: r.responded, rt: r.responded ? r.rt : null });
    }
    return { metrics: L.scoreGoNoGo(trials), trials };
  }

  // ---------- 3. Струп ----------
  async function stroop({ n = 12 }) {
    await intro('stroop', 'Цвет слова', ['На экране появится слово, написанное цветом.', 'Нажми кнопку с названием ЦВЕТА, которым слово написано, а не того, что оно значит.', 'Например, слово «СИНИЙ», написанное красным, — это красный.']);
    await countdown('stroop');
    const seq = L.makeStroop(rng, n), trials = [];
    for (const s of seq) {
      const w = L.STROOP_COLORS.find(c => c.id === s.word), ink = L.STROOP_COLORS.find(c => c.id === s.ink);
      const word = el('div', { class: 'stroop-word', id: 'bt-word', textContent: w.word, style: `color:${ink.hex}`, dataset: { ink: s.ink, word: s.word } });
      const t0 = now();
      let btns;
      const r = await waitFor((done, h) => {
        btns = L.STROOP_COLORS.map(c => el('button', { type: 'button', class: 'stroop-btn', dataset: { c: c.id }, textContent: c.name }));
        for (const b of btns) h.on(b, 'pointerdown', e => { e.preventDefault(); done({ choice: b.dataset.c, rt: now() - t0 }); });
        set('stroop', 'run', word, el('div', { class: 'stroop-btns' }, ...btns));
      });
      trials.push({ word: s.word, ink: s.ink, congruent: s.congruent, correct: r.choice === s.ink, rt: r.rt });
      set('stroop', 'run', el('div', { class: 'bt-box blank' })); await sleep(350);
    }
    return { metrics: L.scoreStroop(trials), trials };
  }

  // ---------- 4. Цифры по памяти ----------
  async function digits({ max = 7 }) {
    await intro('digits', 'Цифры по памяти', ['Цифры будут появляться по одной. Запомни порядок и введи их.', 'Сначала — в том же порядке, потом — задом наперёд.']);
    const trials = [];
    const procs = {};
    for (const dir of ['f', 'b']) {
      if (dir === 'b') await intro('digits', 'Теперь наоборот', ['Вводи цифры в обратном порядке: с последней к первой.', 'Например, 3-8-1 нужно ввести как 1-8-3.']);
      const proc = new L.SpanProcedure({ start: 3, max });
      procs[dir] = proc;
      while (!proc.finished) {
        const len = proc.current(), seq = L.makeDigits(rng, len);
        set('digits', 'ready', el('div', { class: 'bt-digit', textContent: '•' })); await sleep(800);
        for (const d of seq) { set('digits', 'show', el('div', { class: 'bt-digit', id: 'bt-digit', textContent: String(d) })); await sleep(700); set('digits', 'gap', el('div', { class: 'bt-digit', id: 'bt-digit' })); await sleep(250); }
        const answer = await waitFor((done, h) => {
          const kp = keypad(v => done(v.split('').map(Number)), h, { maxLen: len });
          set('digits', 'input', el('p', { class: 'muted', textContent: dir === 'f' ? 'Введи цифры в том же порядке' : 'Введи цифры задом наперёд' }), kp.out, kp.grid);
        });
        const passed = L.checkSpan(seq, answer, dir === 'b');
        proc.record(passed);
        trials.push({ dir, len, passed });
      }
    }
    return { metrics: L.scoreSpan(procs.f, procs.b), trials };
  }

  // ---------- 5. Слова ----------
  async function wordsLearn({ n = 8 }) {
    await intro('words', 'Запомни слова', [`Сейчас будет показано ${n} слов, по одному. Постарайся их запомнить.`, 'Позже ты увидишь список и скажешь, какие из них были.']);
    const words = L.pickWords(rng, n, history.recentWords || []);
    await countdown('words');
    for (const w of words) { set('words', 'learn', el('div', { class: 'bt-word', id: 'bt-learn-word', textContent: w })); await sleep(1500); set('words', 'learn', el('div', { class: 'bt-word' })); await sleep(250); }
    shared.words = words; shared.learnedAt = now();
    return null;
  }
  async function wordsRecall() {
    if (!shared.words) return { skipped: 'слова не запоминались' };
    const delayMs = Math.round(now() - shared.learnedAt);
    await intro('words', 'Какие слова были?', ['Теперь будут показаны слова: и из списка, и новые.', 'Нажимай «Было», если слово было в списке, и «Не было», если нет.']);
    const items = L.makeRecognition(rng, shared.words, history.recentWords || []), trials = [];
    for (const it of items) {
      const t0 = now();
      const r = await waitFor((done, h) => {
        const yes = el('button', { type: 'button', id: 'bt-yes', class: 'grade good', textContent: 'Было' });
        const no = el('button', { type: 'button', id: 'bt-no', class: 'grade again', textContent: 'Не было' });
        h.on(yes, 'pointerdown', e => { e.preventDefault(); done({ said: true, rt: now() - t0 }); });
        h.on(no, 'pointerdown', e => { e.preventDefault(); done({ said: false, rt: now() - t0 }); });
        set('words', 'recall', el('div', { class: 'bt-word', id: 'bt-recall-word', textContent: it.word }), el('div', { class: 'grade-row two-col' }, yes, no));
      });
      trials.push({ word: it.word, old: it.old, said: r.said, rt: r.rt });
    }
    return { metrics: L.scoreRecognition(trials), trials, extra: { words: shared.words, delayMs } };
  }

  // ---------- 6. Счёт ----------
  async function math({ seconds = 45 }) {
    await intro('math', 'Счёт в уме', [`Решай примеры и вводи ответы. Время: ${seconds} секунд.`, 'Сложность подстраивается под тебя. Ошибки не страшны.']);
    await countdown('math');
    const level = new L.AdaptiveLevel(2), trials = [];
    const deadline = now() + seconds * 1000;
    for (;;) {
      if (now() >= deadline) break;
      const p = L.makeProblem(rng, level.level);
      const t0 = now();
      const r = await waitFor((done, h) => {
        const timer = el('div', { class: 'bt-timer', id: 'bt-timer' });
        const left = () => Math.max(0, Math.ceil((deadline - now()) / 1000));
        const tick = () => { timer.textContent = `${left()} с`; if (now() >= deadline) done({ timeout: true }); else h.timer(tick, 200); };
        const kp = keypad(v => done({ value: Number(v), rt: now() - t0 }), h, { maxLen: 6 });
        set('math', 'run', timer, el('div', { class: 'bt-problem', id: 'bt-problem', textContent: `${p.text} = ?` }), kp.out, kp.grid);
        tick();
      });
      if (r.timeout) break;
      const correct = r.value === p.answer;
      trials.push({ level: p.level, correct, rt: r.rt });
      level.update(correct, r.rt);
    }
    return { metrics: L.scoreMath(trials), trials };
  }

  // ---------- 7. Ряды ----------
  async function series({ n = 8 }) {
    await intro('series', 'Числовые ряды', ['Найди закономерность и выбери число, которое должно стоять следующим.', 'На каждый ряд — до 40 секунд.']);
    let lvl = 2; const trials = [];
    for (let i = 0; i < n; i++) {
      const p = L.makeSeries(rng, lvl);
      const t0 = now();
      const r = await waitFor((done, h) => {
        const opts = p.options.map(o => el('button', { type: 'button', class: 'series-opt', dataset: { v: String(o) }, textContent: String(o) }));
        for (const b of opts) h.on(b, 'pointerdown', e => { e.preventDefault(); done({ choice: Number(b.dataset.v), rt: now() - t0 }); });
        h.timer(() => done({ choice: null, rt: 40000 }), 40000);
        set('series', 'run', el('p', { class: 'muted', id: 'bt-series-pos', textContent: `Ряд ${i + 1} из ${n}` }), el('div', { class: 'bt-problem', id: 'bt-series', textContent: `${p.terms.join(',  ')},  ?` }), el('div', { class: 'series-opts' }, ...opts));
      });
      const correct = r.choice === p.answer;
      trials.push({ level: p.level, correct, rt: r.rt });
      lvl = correct ? Math.min(5, lvl + 1) : Math.max(1, lvl - 1);
    }
    return { metrics: L.scoreSeries(trials), trials };
  }

  // ---------- 8. Шульте ----------
  async function schulte({ size = 25 }) {
    await intro('schulte', 'Таблица Шульте', ['Нажимай числа по порядку: 1, 2, 3 … как можно быстрее.', 'Ошибочные нажатия считаются.']);
    await countdown('schulte');
    const cols = Math.round(Math.sqrt(size)), cells = L.makeSchulte(rng, size), times = []; let errors = 0, next = 1;
    const t0 = await waitFor((done, h) => {
      const grid = el('div', { class: 'schulte', id: 'bt-schulte', style: `grid-template-columns:repeat(${cols},1fr)` });
      const hint = el('p', { class: 'muted', id: 'bt-schulte-next', textContent: 'Ищи: 1' });
      const t = now();
      for (const n of cells) {
        const c = el('button', { type: 'button', class: 'sh-cell', dataset: { n: String(n) }, textContent: String(n) });
        h.on(c, 'pointerdown', e => {
          e.preventDefault();
          if (n === next) { times.push(now() - t); c.classList.add('found'); next++; hint.textContent = `Ищи: ${Math.min(next, size)}`; if (next > size) done(t); }
          else { errors++; c.classList.add('wrong'); setTimeout(() => c.classList.remove('wrong'), 200); }
        });
        grid.append(c);
      }
      set('schulte', 'run', hint, grid);
    });
    return { metrics: L.scoreSchulte({ times, errors }), trials: times.map(t => ({ t })), extra: { errors } };
  }

  // ---------- 9. Чувство времени ----------
  async function time({ targets = [5000, 10000, 15000] }) {
    await intro('time', 'Чувство времени', ['Нажми и удерживай кнопку, пока, как тебе кажется, не пройдёт названное время. Потом отпусти.', 'Считать вслух и смотреть на часы нельзя.']);
    const trials = [];
    for (const target of targets) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const actual = await waitFor((done, h) => {
          const btn = el('button', { type: 'button', class: 'bt-hold', id: 'bt-hold', dataset: { target: String(target) }, textContent: 'Держи' });
          let t0 = null;
          h.on(btn, 'contextmenu', e => e.preventDefault());
          h.on(btn, 'pointerdown', e => { e.preventDefault(); t0 = now(); btn.classList.add('held'); });
          const up = () => { if (t0 !== null) { const d = now() - t0; t0 = null; btn.classList.remove('held'); done(d); } };
          h.on(btn, 'pointerup', up); h.on(btn, 'pointercancel', up); h.on(btn, 'pointerleave', up);
          set('time', 'run', el('p', { class: 'bt-problem', id: 'bt-target', textContent: `${target / 1000} секунд` }), btn);
        });
        if (actual < 400) { set('time', 'run', el('p', { class: 'muted', textContent: 'Слишком коротко — попробуй ещё раз.' })); await sleep(800); continue; }
        trials.push({ targetMs: target, actualMs: actual });
        set('time', 'run', el('p', { class: 'bt-problem', id: 'bt-time-res', textContent: `Ты показал ${(actual / 1000).toFixed(1).replace('.', ',')} с` }), el('p', { class: 'muted', textContent: `цель: ${target / 1000} с` }));
        await sleep(1200);
        break;
      }
    }
    return { metrics: L.scoreTime(trials), trials };
  }

  // ---------- 10. Проверка знаний ----------
  async function recall({ n = 6 }) {
    const started = cards.started || [];
    if (started.length < 4) return { skipped: 'нет изученных карточек' };
    await intro('recall', 'Проверка знаний', ['Вопросы из твоих курсов: выбери верный ответ из четырёх.', 'Это не экзамен — результат показывает, что действительно закрепилось.']);
    const picked = rng.shuffle(started).slice(0, n), trials = [];
    for (const c of picked) {
      const same = (cards.pool || []).filter(x => x.track === c.track && x.a !== c.a);
      const others = rng.shuffle((same.length >= 3 ? same : (cards.pool || []).filter(x => x.a !== c.a))).filter((x, i, arr) => arr.findIndex(y => y.a === x.a) === i).slice(0, 3);
      if (others.length < 3) continue;
      const options = rng.shuffle([c.a, ...others.map(x => x.a)]);
      const t0 = now();
      const r = await waitFor((done, h) => {
        const opts = options.map(o => el('button', { type: 'button', class: 'series-opt wide', dataset: { v: o }, textContent: o }));
        for (const b of opts) h.on(b, 'pointerdown', e => { e.preventDefault(); done({ choice: b.dataset.v, rt: now() - t0 }); });
        set('recall', 'run', el('div', { class: 'bt-problem', id: 'bt-recall-q', textContent: c.q }), el('div', { class: 'series-opts one-col' }, ...opts));
      });
      trials.push({ card: c.id, category: c.track, correct: r.choice === c.a, rt: r.rt });
    }
    if (!trials.length) return { skipped: 'не хватило вариантов ответов' };
    return { metrics: L.scoreRecall(trials), trials };
  }

  const RUNNERS = { reaction, gonogo, stroop, digits, wordsLearn, wordsRecall, math, series, schulte, time, recall };

  // ---------- сценарий ----------
  // plan.steps выполняются по очереди. Возвращает { results, state, aborted, durationMs }.
  async function runPlan(plan, { askStateFirst = true } = {}) {
    const startedAt = Date.now(), t0 = now();
    const results = {}; let state = null, aborted = false;
    const real = plan.steps.filter(s => s.id !== 'wordsLearn');
    let k = 0;
    try {
      if (askStateFirst) state = await askState();
      for (const step of plan.steps) {
        const meta = TEST_BY_ID[step.id === 'wordsRecall' ? 'words' : step.id];
        if (step.id !== 'wordsLearn') { k++; label.textContent = `${meta ? meta.title : ''} · ${k} из ${real.length}`; } else label.textContent = 'Запомни слова';
        const s0 = now();
        const out = await RUNNERS[step.id](step);
        if (out) results[step.id === 'wordsRecall' ? 'words' : step.id] = { ...out, ms: now() - s0 };
      }
    } catch (e) {
      if (!(e instanceof Aborted)) throw e;
      aborted = true;
    }
    set('save', 'saving', el('p', { class: 'muted', id: 'bt-saving', textContent: 'Сохраняю результаты…' }));
    return { results, state, aborted, durationMs: now() - t0, startedAt };
  }

  return {
    runPlan, abort, stage,
    show(...nodes) { abortBtn.hidden = true; label.textContent = ''; set('result', 'result', ...nodes); },
    close() { host.hidden = true; host.replaceChildren(); },
  };
}
