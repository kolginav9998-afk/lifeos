// Запуск тестов на память и скорость: «Блоки Корси», «Струп: 40 проб», «Кодирование символов».
// Время берём в момент касания (pointerdown); те же кнопки работают с клавиатуры (Enter, пробел, цифры). Зрительные тесты можно пропустить.
import { el, announce, focusNode } from './ui.js';
import { STROOP_COLORS } from './bt-logic.js';
import { CORSI_BLOCKS, BLOCK_SIZE, SpanProcedure, makeCorsiSeq, checkCorsi, scoreCorsi, blockLabel, CORSI_START, CORSI_MAX } from './iq-span.js';
import { makeStroop40, scoreStroop40, SYMBOLS, makeCodingKey, makeCodingStream, scoreCoding, keyDescription, CODING_SECONDS, STROOP40_N } from './iq-fast.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); n.append(...kids.filter(Boolean)); return n; };
const glyph = (sym, cls = 'cd-g') => svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, svg('path', { d: SYMBOLS[sym].d, class: 'cd-p' }));

export function fastRunners(api) {
  const { rng, now, waitFor, sleep, set, intro, countdown, tap, host, stage } = api;

  // ---------- Блоки Корси ----------
  async function corsi({ max = CORSI_MAX }) {
    const voice = el('input', { type: 'checkbox', id: 'cs-voice' });
    const go = await intro('corsi', 'Блоки Корси', ['На экране девять блоков. Они подсветятся по очереди: запомни порядок, а потом нажми на блоки в том же порядке.',
      'Сначала порядок из двух блоков, потом всё длиннее. Тест заканчивается, когда два раза подряд не получилось.',
      'Тест зрительный. Блоки пронумерованы (Блок 1 … Блок 9): их можно выбирать клавишей Tab и нажимать Enter. Если включить озвучку, номера подсвеченных блоков прочитает экранный диктор.'],
    'Начать', { skip: 'Пропустить тест', extra: [el('label', { class: 'check-label' }, voice, ' Озвучивать номера подсвеченных блоков')] });
    if (go === 'skip') return { skipped: 'пропущено по желанию' };
    const speak = voice.checked, proc = new SpanProcedure({ start: CORSI_START, max }), trials = [];
    let prev = null;
    while (!proc.finished) {
      const len = proc.current(), seq = makeCorsiSeq(rng, len, prev), t0 = now();
      prev = seq;
      const status = el('p', { class: 'muted', id: 'cs-status', role: 'status', textContent: 'Смотри внимательно…' });
      const blocks = CORSI_BLOCKS.map(([x, y], i) => el('button', { type: 'button', class: 'cs-blk', dataset: { b: String(i) }, 'aria-label': blockLabel(i), disabled: true, style: `left:${x}%;top:${y}%;width:${BLOCK_SIZE}%;height:${BLOCK_SIZE}%` }));
      set('corsi', 'show', el('p', { class: 'muted', id: 'cs-pos', textContent: `Порядок из ${len} ${len < 5 ? 'блоков' : 'блоков'}` }), el('div', { class: 'cs-board', id: 'cs-board', role: 'group', 'aria-label': 'Поле с девятью блоками' }, ...blocks), status);
      await sleep(800);
      for (const b of seq) {
        blocks[b].classList.add('lit'); blocks[b].dataset.lit = '1';
        if (speak) announce(blockLabel(b));
        await sleep(speak ? 1100 : 700);
        blocks[b].classList.remove('lit'); delete blocks[b].dataset.lit;
        await sleep(speak ? 450 : 300);
      }
      stage.dataset.phase = 'input';
      status.textContent = `Повтори порядок: нажимай блоки (0 из ${len})`;
      for (const b of blocks) b.disabled = false;
      focusNode(blocks[0]);
      const taps = await waitFor((done, h) => {
        const got = [];
        blocks.forEach(b => tap(h, b, () => {
          if (got.length >= len) return;
          got.push(Number(b.dataset.b)); b.classList.add('tapped'); h.timer(() => b.classList.remove('tapped'), 250);
          status.textContent = `Повтори порядок: нажимай блоки (${got.length} из ${len})`;
          if (got.length === len) done(got);
        }));
      });
      for (const b of blocks) b.disabled = true;
      const passed = checkCorsi(seq, taps);
      proc.record(passed);
      trials.push({ len, passed, ms: now() - t0, seq: seq.join(''), taps: taps.join('') });
      status.textContent = passed ? 'Верно' : 'Не совпало';
      announce(passed ? 'Верно' : 'Не совпало');
      await sleep(800);
    }
    return { metrics: scoreCorsi(proc.history), trials, extra: { speak } };
  }

  // ---------- Струп: 40 проб ----------
  async function stroop40({ n = STROOP40_N }) {
    const go = await intro('stroop40', 'Струп: 40 проб', ['На экране появится слово, написанное цветом.', 'Нажми кнопку с названием ЦВЕТА, которым слово написано, а не того, что оно значит. Например, слово «СИНИЙ», написанное красным, — это красный. Можно нажимать и клавиши 1–4.',
      `Проб: ${n}. Отвечай быстро, но старайся не ошибаться. Тест на различение цветов: если цвета различать трудно, его можно пропустить.`], 'Начать', { skip: 'Пропустить тест' });
    if (go === 'skip') return { skipped: 'пропущено по желанию' };
    await countdown('stroop40');
    const seq = makeStroop40(rng, n), trials = [];
    for (let i = 0; i < seq.length; i++) {
      const s = seq[i], ink = STROOP_COLORS.find(c => c.id === s.ink), t0 = now();
      const r = await waitFor((done, h) => {
        const word = el('div', { class: 'stroop-word', id: 's4-word', textContent: s.text, style: `color:${ink.hex}`, dataset: { ink: s.ink, kind: s.kind, i: String(i) } });
        const btns = STROOP_COLORS.map((c, k) => el('button', { type: 'button', class: 'stroop-btn', dataset: { c: c.id }, textContent: c.name, 'aria-keyshortcuts': String(k + 1) }));
        btns.forEach(b => tap(h, b, () => done({ choice: b.dataset.c, rt: now() - t0 })));
        h.on(host, 'keydown', e => { const k = '1234'.indexOf(e.key); if (k >= 0 && !e.repeat) done({ choice: STROOP_COLORS[k].id, rt: now() - t0 }); });
        h.timer(() => done({ choice: null, rt: 6000 }), 6000);
        set('stroop40', 'run', el('p', { class: 'muted', id: 's4-pos', textContent: `Проба ${i + 1} из ${seq.length}` }), word, el('div', { class: 'stroop-btns' }, ...btns));
      });
      trials.push({ kind: s.kind, word: s.word, ink: s.ink, correct: r.choice === s.ink, rt: r.rt });
      set('stroop40', 'blank', el('div', { class: 'bt-box blank' })); await sleep(350);
    }
    return { metrics: scoreStroop40(trials), trials };
  }

  // ---------- Кодирование символов ----------
  async function coding({ seconds = CODING_SECONDS }) {
    const key = makeCodingKey(rng);
    const go = await intro('coding', 'Кодирование символов', [`Вверху показан ключ: у каждого знака своя цифра. Ниже появляется знак — нажми цифру, которая ему соответствует. Время: ${seconds} секунд.`,
      'Нажимай быстро, но старайся не ошибаться; на ключ смотреть можно. Можно вводить цифры с клавиатуры.', 'Знаки названы словами для экранного диктора: ключ читается как «плюс — 3, крестик — 7…». Если это неудобно, тест можно пропустить.'], 'Начать', { skip: 'Пропустить тест' });
    if (go === 'skip') return { skipped: 'пропущено по желанию' };
    await countdown('coding');
    const stream = makeCodingStream(rng, 220), trials = [], deadline = now() + seconds * 1000;
    for (const sym of stream) {
      if (now() >= deadline) break;
      const t0 = now();
      const r = await waitFor((done, h) => {
        const timer = el('div', { class: 'bt-timer', id: 'cd-timer' });
        const left = () => Math.max(0, Math.ceil((deadline - now()) / 1000));
        const tick = () => { timer.textContent = `${left()} с`; if (now() >= deadline) done({ timeout: true }); else h.timer(tick, 200); };
        const table = el('div', { class: 'cd-key', id: 'cd-key', role: 'img', 'aria-label': keyDescription(key) }, ...SYMBOLS.map((s, i) => el('div', { class: 'cd-cell', dataset: { sym: String(i), digit: String(key[i]) } }, glyph(i), el('span', { class: 'cd-d', textContent: String(key[i]) }))));
        const stim = el('div', { class: 'cd-stim', id: 'cd-stim', role: 'img', 'aria-label': `Знак: ${SYMBOLS[sym].name}`, dataset: { sym: String(sym) } }, glyph(sym, 'cd-big'));
        const pad = el('div', { class: 'kp-grid cd-pad' }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => { const b = el('button', { type: 'button', class: 'kp', dataset: { d: String(d) }, textContent: String(d), 'aria-label': `Цифра ${d}` }); tap(h, b, () => done({ digit: d, rt: now() - t0 })); return b; }));
        h.on(host, 'keydown', e => { if (/^[1-9]$/.test(e.key) && !e.repeat) done({ digit: Number(e.key), rt: now() - t0 }); });
        set('coding', 'run', timer, table, stim, pad);
        tick();
      });
      if (r.timeout) break;
      trials.push({ sym, digit: r.digit, correct: r.digit === key[sym], rt: r.rt });
    }
    return { metrics: scoreCoding(trials), trials, extra: { key: key.join('') } };
  }

  return { corsi, stroop40, coding };
}
