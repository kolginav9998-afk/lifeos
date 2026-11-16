// Запуск тестов на логику: матрицы, числовые ряды (12), слова и логика, вращение фигур.
// Все рисунки — SVG, и у каждого есть описание словами для экранного диктора (aria-label). Время в этих тестах не ограничено.
import { el, focusNode } from './ui.js';
import { makeMatrixSet, layoutCell, describeMatrix, describeOption } from './iq-matrices.js';
import { makeSeriesSet } from './iq-series.js';
import { scoreItems } from './iq-core.js';

const NS = 'http://www.w3.org/2000/svg';
export const svg = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); n.append(...kids.filter(Boolean)); return n; };

// ---------- рисование фигур матриц ----------
function shapeNode(p) {
  const { shape, cx, cy, r, fill, rot } = p;
  const pts = a => a.map(([x, y]) => `${(cx + x * r).toFixed(1)},${(cy + y * r).toFixed(1)}`).join(' ');
  let n;
  switch (shape) {
    case 'circle': n = svg('circle', { cx, cy, r }); break;
    case 'square': n = svg('rect', { x: cx - r * 0.9, y: cy - r * 0.9, width: r * 1.8, height: r * 1.8 }); break;
    case 'triangle': n = svg('polygon', { points: pts([[0, -1], [0.87, 0.5], [-0.87, 0.5]]) }); break;
    case 'diamond': n = svg('polygon', { points: pts([[0, -1], [0.72, 0], [0, 1], [-0.72, 0]]) }); break;
    case 'cross': n = svg('polygon', { points: pts([[-0.3, -1], [0.3, -1], [0.3, -0.3], [1, -0.3], [1, 0.3], [0.3, 0.3], [0.3, 1], [-0.3, 1], [-0.3, 0.3], [-1, 0.3], [-1, -0.3], [-0.3, -0.3]]) }); break;
    case 'hexagon': n = svg('polygon', { points: pts([0, 1, 2, 3, 4, 5].map(k => [Math.cos(k * Math.PI / 3), Math.sin(k * Math.PI / 3)])) }); break;
    case 'arrow': n = svg('polygon', { points: pts([[0, -1], [0.75, -0.1], [0.32, -0.1], [0.32, 1], [-0.32, 1], [-0.32, -0.1], [-0.75, -0.1]]) }); break;
    default: n = svg('path', { d: `M${cx - r},${cy + r / 2} A${r},${r} 0 0 1 ${cx + r},${cy + r / 2} Z` });
  }
  n.setAttribute('class', `mx-s mx-f${fill}`);
  if (rot) n.setAttribute('transform', `rotate(${rot} ${cx} ${cy})`);
  return n;
}
function cellNode(cell, kind, x = 0, y = 0, frame = true) {
  const { prims, dots } = layoutCell(cell, kind);
  return svg('g', { transform: `translate(${x} ${y})` }, frame ? svg('rect', { class: 'mx-cell', x: 1, y: 1, width: 98, height: 98, rx: 8 }) : null,
    ...dots.map(([cx, cy]) => svg('circle', { class: 'mx-dot', cx, cy, r: 2.5 })), ...prims.map(shapeNode));
}
export function matrixSvg(item) {
  const s = svg('svg', { class: 'mx-board', viewBox: '0 0 310 310', role: 'img', 'aria-label': describeMatrix(item), focusable: 'false' });
  for (let i = 0; i < 9; i++) {
    const x = (i % 3) * 105, y = Math.floor(i / 3) * 105;
    if (i < 8) s.append(cellNode(item.grid[i], item.kind, x, y));
    else s.append(svg('g', { transform: `translate(${x} ${y})` }, svg('rect', { class: 'mx-cell mx-miss', x: 1, y: 1, width: 98, height: 98, rx: 8 }), svg('text', { class: 'mx-q', x: 50, y: 70, 'text-anchor': 'middle' }, document.createTextNode('?'))));
  }
  return s;
}
const optionSvg = (cell, kind) => svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' }, cellNode(cell, kind, 0, 0, false));

// Выбор варианта с подтверждением: нажатие отмечает вариант (рамка и галочка), «Ответить» принимает ответ, «Не знаю» — пропуск задания.
function chooseConfirm(h, buttons) {
  let picked = null;
  const ok = el('button', { type: 'button', id: 'mx-ok', class: 'primary big-btn', textContent: 'Ответить', disabled: true });
  const skip = el('button', { type: 'button', id: 'mx-idk', class: 'link', textContent: 'Не знаю' });
  buttons.forEach((b, i) => h.on(b, 'click', () => { picked = i; buttons.forEach((x, j) => x.setAttribute('aria-pressed', String(i === j))); ok.disabled = false; }));
  return { ok, skip, picked: () => picked };
}

export function iqRunners(api) {
  const { rng, now, waitFor, set, intro, keypad } = api;

  async function matrices({ n = 12 }) {
    const go = await intro('matrices', 'Матрицы', ['В таблице 3×3 одна клетка пропущена (на её месте знак вопроса). Найди правило и выбери фигуру, которая подходит.',
      `Заданий: ${n}, от лёгких к трудным. Время не ограничено: на одно задание обычно хватает около минуты.`, 'Каждый рисунок описан словами для экранного диктора. Если задание не получается, нажми «Не знаю» — это не страшно.'], 'Начать', { skip: 'Пропустить тест' });
    if (go === 'skip') return { skipped: 'пропущено по желанию' };
    const seed = rng.int(1, 2 ** 30), items = makeMatrixSet(seed, n), trials = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i], t0 = now();
      const r = await waitFor((done, h) => {
        const heading = el('h3', { id: 'mx-pos', tabIndex: -1, textContent: `Задание ${i + 1} из ${items.length}` });
        const buttons = item.options.map((o, k) => el('button', { type: 'button', class: 'mx-opt', dataset: { i: String(k) }, 'aria-pressed': 'false', 'aria-label': describeOption(item, k) }, optionSvg(o, item.kind), el('span', { class: 'mx-n', 'aria-hidden': 'true', textContent: String(k + 1) })));
        const c = chooseConfirm(h, buttons);
        h.on(c.ok, 'click', () => done({ choice: c.picked(), rt: now() - t0 }));
        h.on(c.skip, 'click', () => done({ choice: null, rt: now() - t0 }));
        set('matrices', 'run', el('div', { id: 'mx-item', class: 'mx-item', dataset: { seed: String(item.seed), i: String(i), level: String(item.level), kind: item.kind } },
          heading, el('p', { class: 'muted', id: 'mx-note', textContent: 'Время не ограничено. Выбери фигуру, которая подходит на место знака вопроса.' }),
          matrixSvg(item), el('div', { class: 'mx-opts', role: 'group', 'aria-label': 'Варианты ответа' }, ...buttons), el('div', { class: 'row mx-actions' }, c.ok, c.skip)));
        focusNode(heading);
      });
      trials.push({ i, level: item.level, correct: r.choice === item.correct, rt: r.rt, choice: r.choice });
    }
    return { metrics: scoreItems(trials), trials, extra: { seed } };
  }

  async function seq12({ n = 12 }) {
    const go = await intro('seq12', 'Числовые ряды: 12 заданий', ['Найди закономерность и продолжи ряд: выбери число из вариантов или введи своё.', `Заданий: ${n}, от лёгких к трудным. Время не ограничено.`, 'Если ряд не получается, выбери любой вариант или нажми «Не знаю».'], 'Начать');
    if (go === 'skip') return { skipped: 'пропущено по желанию' };
    const seed = rng.int(1, 2 ** 30), items = makeSeriesSet(seed, n), trials = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i], t0 = now();
      const r = await waitFor((done, h) => {
        const heading = el('h3', { id: 'sq-pos', tabIndex: -1, textContent: `Ряд ${i + 1} из ${items.length}` });
        const area = el('div', { class: 'sq-area' });
        const modeBtn = el('button', { type: 'button', id: 'sq-mode', class: 'chip', textContent: 'Ввести число самому', 'aria-expanded': 'false' });
        const idk = el('button', { type: 'button', id: 'sq-idk', class: 'link', textContent: 'Не знаю' });
        const answer = (val, typed) => done({ val, typed, rt: now() - t0 });
        const showOptions = () => {
          const opts = item.options.map((o, k) => el('button', { type: 'button', class: 'series-opt', dataset: { v: String(o), i: String(k) }, textContent: String(o), 'aria-label': `Ответ ${o}` }));
          opts.forEach(b => h.on(b, 'click', () => answer(Number(b.dataset.v), false)));
          area.replaceChildren(el('div', { class: 'series-opts' }, ...opts));
          modeBtn.textContent = 'Ввести число самому'; modeBtn.setAttribute('aria-expanded', 'false');
        };
        const showTyping = () => {
          const kp = keypad(v => answer(Number(v), true), h, { maxLen: 6, display: el('div', { class: 'kp-out', id: 'kp-out', role: 'status', 'aria-label': 'Введённое число' }) });
          area.replaceChildren(kp.out, kp.grid);
          modeBtn.textContent = 'Выбрать из вариантов'; modeBtn.setAttribute('aria-expanded', 'true');
        };
        let typing = false;
        h.on(modeBtn, 'click', () => { typing = !typing; if (typing) showTyping(); else showOptions(); });
        h.on(idk, 'click', () => done({ val: null, typed: false, rt: now() - t0 }));
        showOptions();
        set('seq12', 'run', el('div', { id: 'sq-item', class: 'iq-item', dataset: { seed: String(item.seed), i: String(i), level: String(item.level) } }, heading,
          el('p', { class: 'muted', textContent: 'Время не ограничено. Какое число стоит на месте знака вопроса?' }),
          el('div', { class: 'bt-problem', id: 'bt-series', textContent: `${item.terms.join(',  ')},  ?` }), area, el('div', { class: 'row mx-actions' }, modeBtn, idk)));
        focusNode(heading);
      });
      trials.push({ i, level: item.level, correct: r.val === item.answer, rt: r.rt, val: r.val, typed: r.typed });
    }
    return { metrics: { ...scoreItems(trials), typed: trials.filter(t => t.typed).length }, trials, extra: { seed } };
  }

  return { matrices, seq12 };
}
