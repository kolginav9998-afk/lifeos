// Плеер урока «с нуля»: текст, таблица, озвучка, задания по очереди с мгновенным разбором и подсказкой, страница закрытого урока.
// Дочерний блок экрана «С нуля» (view-zero.js): сам ничего не хранит, результаты отдаёт обратным вызовом. Иврит показывается справа налево (dir="rtl", lang="he").
import { el, fill, icon, announce, focusNode, toast } from './ui.js';
import { shuffled, gradeDrill } from './zero-kit.js';
import { canSpeak, speak, speakable } from './speech.js';

const HE = /[֐-׿]/, CYR = /[А-Яа-яЁё]/, LAT = /[A-Za-z]/;
// Свойства lang/dir для узла, где текст целиком на иврите или английском.
export const textProps = t => (HE.test(t) && !CYR.test(t) ? { lang: 'he', dir: 'rtl' } : LAT.test(t) && !CYR.test(t) ? { lang: 'en' } : {});
// Текст со вставками: ивритские куски получают dir="rtl" lang="he", английские слова lang="en" (диктор читает на нужном языке, буквы не перемешиваются).
export function rich(text) {
  const s = String(text ?? ''), out = [];
  let last = 0;
  for (const m of s.matchAll(/([֐-׿]+(?:[  ][֐-׿]+)*)|([A-Za-z][A-Za-z'’-]*)/g)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] ? el('span', { class: 'zero-he', lang: 'he', dir: 'rtl', textContent: m[1] }) : el('span', { class: 'zero-en', lang: 'en', textContent: m[2] }));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
const scramble = (list, seed, same) => { const a = shuffled(list, seed); return a.length > 1 && same(a) ? [...a.slice(1), a[0]] : a; };       // не отдаём уже готовый порядок

// ---------- озвучка: голос телефона; если голоса нет, один раз честно говорим об этом ----------
const warned = new Set();
const NO_VOICE = { hebrew: 'На телефоне нет голоса для иврита. Установи голосовой движок в настройках телефона. Урок можно пройти по тексту и подсказкам.', english: 'На телефоне нет голоса для английского. Установи голосовой движок в настройках телефона. Урок можно пройти по тексту.' };
export function sayText(text, lang) {
  if (!text) return;
  const l = lang === 'hebrew' ? 'hebrew' : 'english';
  const bad = () => { if (!warned.has(l)) { warned.add(l); toast(NO_VOICE[l], { ms: 9000 }); } };
  if (!speak(text, l, bad)) bad();
}
export const speakBtn = (text, lang, label = 'Послушать') => el('button', { type: 'button', class: 'chip zero-say', 'aria-label': `${label}: ${text}`, onclick: () => sayText(text, lang) }, icon('volume', 16), label);
const langOf = (d, lang) => (d.lang === 'hebrew' || d.lang === 'english' ? d.lang : lang);

// ---------- одно задание ----------
function answerNode(d) {
  if (d.t === 'order') return el('span', { class: 'zero-tiles zero-right', dir: d.dir === 'rtl' ? 'rtl' : 'ltr' }, ...d.tiles.map(t => el('span', { class: 'zero-tile static', ...textProps(t) }, ...rich(t))));
  const text = d.t === 'choose' || d.t === 'listen' ? d.right : d.t === 'typed' ? d.ok[0] : d.t === 'match' ? d.pairs.map(p => `${p[0]} — ${p[1]}`).join('; ') : '';
  return el('strong', {}, ...rich(text));
}
function feedback(d, res) {
  const ok = res.correct === true;
  return el('div', { class: `zero-fb ${ok ? 'ok' : 'bad'}`, dataset: { result: ok ? 'right' : 'wrong' } },
    el('p', { class: 'zero-verdict' }, icon(ok ? 'checkCircle' : 'x', 20), el('strong', { textContent: ok ? 'Верно' : 'Неверно' })),
    res.hinted ? el('p', { class: 'muted', textContent: 'Подсказка была открыта, поэтому в проверке такой ответ не засчитывается.' }) : null,
    ok ? null : el('p', {}, 'Правильный ответ: ', answerNode(d)),
    d.explain ? el('p', { class: 'zero-explain' }, ...rich(d.explain)) : null);
}

// d — задание из zero-kit.js. onAnswer({answer, correct, hinted}) вызывается один раз, onNext — по кнопке «Дальше». Подсказка: ответ после неё не засчитывается.
export function drillView(d, { seed = 0, lang = 'english', last = false, onAnswer = () => {}, onNext = () => {} } = {}) {
  const root = el('div', { class: 'zero-drill', dataset: { kind: d.t } });
  let hinted = false, done = false, nextBtn = null;
  const dl = langOf(d, lang);
  const parts = [];
  if (d.big) parts.push(el('p', { class: 'zero-big', ...textProps(d.big) }, ...rich(d.big)));
  parts.push(el('p', { class: 'zero-q' }, ...rich(d.q)));
  if (d.t === 'read') parts.push(el('p', { class: 'zero-read', ...textProps(d.text) }, ...rich(d.text)));
  if (d.say) {
    parts.push(el('div', { class: 'row' }, speakBtn(d.say, dl)));
    if (!canSpeak()) parts.push(el('p', { class: 'zero-say-text' }, 'Голоса нет. Слово для чтения: ', ...rich(d.say)));
  }
  const body = el('div', { class: 'zero-body' });
  const hintBox = d.hint && d.t !== 'read' ? el('p', { class: 'zero-hint', hidden: true }, el('strong', { textContent: 'Подсказка: ' }), ...rich(d.hint)) : null;
  const hintBtn = hintBox ? el('button', { type: 'button', class: 'chip zero-hint-btn', onclick: () => { hinted = true; hintBox.hidden = false; hintBtn.disabled = true; announce(`Подсказка: ${d.hint}. Ответ с подсказкой не засчитается.`); } }, icon('info', 16), 'Подсказка (ответ не засчитается)') : null;
  const fbBox = el('div', { class: 'zero-fb-box' });
  const lockAll = () => { for (const b of root.querySelectorAll('button,input')) if (!b.classList.contains('zero-next')) b.disabled = true; };

  function finish(answer, mark = () => {}) {
    if (done) return;
    done = true;
    const res = { answer, correct: gradeDrill(d, answer), hinted };
    lockAll(); mark(res);
    onAnswer(res);
    if (d.t === 'read') { onNext(); return; }
    fill(fbBox, feedback(d, res));
    nextBtn = el('button', { type: 'button', class: 'primary zero-next', textContent: last ? 'Закончить' : 'Дальше', onclick: onNext });
    fbBox.append(nextBtn);
    announce(res.correct ? 'Верно' : `Неверно. Правильный ответ: ${d.t === 'order' ? d.tiles.join(' ') : d.t === 'typed' ? d.ok[0] : d.t === 'match' ? d.pairs.map(p => p.join(' — ')).join('; ') : d.right}`);
    nextBtn.focus();
  }

  if (d.t === 'choose' || d.t === 'listen') {
    const opts = scramble([d.right, ...d.wrong], seed, a => a[0] === d.right);
    const btns = opts.map(o => el('button', { type: 'button', class: 'zero-opt', onclick: () => finish(o, () => mark(o)) }, ...rich(o)));
    const mark = picked => btns.forEach((b, i) => {
      const isRight = opts[i] === d.right, isPicked = opts[i] === picked;
      b.classList.toggle('right', isRight); b.classList.toggle('wrong', isPicked && !isRight);
      if (isRight || isPicked) b.append(icon(isRight ? 'check' : 'x', 16), el('span', { class: 'sr-only', textContent: isRight ? ' (верный ответ)' : ' (твой ответ, неверно)' }));
    });
    body.append(el('div', { class: 'zero-opts', role: 'group', 'aria-label': 'Варианты ответа' }, ...btns));
  } else if (d.t === 'typed') {
    const input = el('input', { type: 'text', class: 'zero-input', autocomplete: 'off', 'aria-label': 'Твой ответ', dir: 'auto' });
    input.setAttribute('autocapitalize', 'off'); input.setAttribute('spellcheck', 'false');
    body.append(el('form', { class: 'zero-typed', onsubmit: e => { e.preventDefault(); if (input.value.trim()) finish(input.value); } }, input, el('button', { type: 'submit', class: 'primary', textContent: 'Проверить' })));
  } else if (d.t === 'order') {
    const rtl = d.dir === 'rtl', tiles = scramble(d.tiles.map((t, i) => ({ t, i })), seed, a => a.every((x, k) => x.i === k));
    const pool = el('div', { class: 'zero-tiles', role: 'group', 'aria-label': 'Плитки для сборки', dir: rtl ? 'rtl' : 'ltr' });
    const out = el('div', { class: 'zero-tiles zero-out', role: 'group', 'aria-label': 'Твой ответ', dir: rtl ? 'rtl' : 'ltr' });
    const check = el('button', { type: 'button', class: 'primary', disabled: true, textContent: 'Проверить', onclick: () => finish([...out.children].map(b => b.dataset.t)) });
    const refresh = () => { check.disabled = pool.children.length > 0; out.dataset.empty = out.children.length ? '' : 'да'; };
    const btns = tiles.map(x => {
      const b = el('button', { type: 'button', class: 'zero-tile', dataset: { t: x.t }, ...textProps(x.t) }, ...rich(x.t));
      b.onclick = () => {
        const inPool = b.parentElement === pool;
        (inPool ? out : pool).append(b); b.setAttribute('aria-label', inPool ? `Убрать: ${x.t}` : x.t);
        if (!inPool) b.removeAttribute('aria-label');
        refresh(); b.focus();
      };
      return b;
    });
    pool.append(...btns); refresh();
    body.append(el('p', { class: 'muted', textContent: rtl ? 'Нажимай плитки по порядку чтения: первая встанет справа.' : 'Нажимай плитки по порядку: первая встанет слева.' }), out, pool,
      el('div', { class: 'row' }, check, el('button', { type: 'button', class: 'chip', textContent: 'Начать заново', onclick: () => { pool.append(...btns); for (const b of btns) b.removeAttribute('aria-label'); refresh(); } })));
  } else if (d.t === 'match') {
    const lefts = d.pairs.map(p => p[0]), rights = scramble(d.pairs.map(p => p[1]), seed, a => a.every((x, k) => x === d.pairs[k][1]));
    const pairOf = new Map();                                      // номер слева → номер справа
    let sel = null;
    const leftBtns = lefts.map((l, i) => el('button', { type: 'button', class: 'zero-opt zero-l', onclick: () => {
      if (pairOf.has(i)) { pairOf.delete(i); sel = i; } else sel = sel === i ? null : i;
      refresh(); leftBtns[i].focus();
    } }));
    const rightBtns = rights.map((r, j) => el('button', { type: 'button', class: 'zero-opt zero-r', onclick: () => {
      const owner = [...pairOf].find(([, v]) => v === j)?.[0];
      if (sel === null) { if (owner !== undefined) { pairOf.delete(owner); sel = owner; announce(`Пара ${owner + 1} разорвана`); } else announce('Сначала выбери слева'); refresh(); rightBtns[j].focus(); return; }
      if (owner !== undefined) pairOf.delete(owner);
      pairOf.set(sel, j); announce(`Пара ${sel + 1}: ${lefts[sel]} — ${rights[j]}`);
      sel = null; refresh(); rightBtns[j].focus();
    } }));
    const check = el('button', { type: 'button', class: 'primary', disabled: true, textContent: 'Проверить', onclick: () => finish(lefts.map((l, i) => [l, rights[pairOf.get(i)]])) });
    function refresh() {
      leftBtns.forEach((b, i) => { fill(b, `${i + 1}. `, ...rich(lefts[i]), pairOf.has(i) ? el('span', { class: 'zero-pn', textContent: ` ↔ ${rights[pairOf.get(i)]}` }) : null); b.setAttribute('aria-pressed', String(sel === i)); b.classList.toggle('paired', pairOf.has(i)); });
      rightBtns.forEach((b, j) => { const owner = [...pairOf].find(([, v]) => v === j)?.[0]; fill(b, ...rich(rights[j]), owner !== undefined ? el('span', { class: 'zero-pn', textContent: ` ← пара ${owner + 1}` }) : null); b.classList.toggle('paired', owner !== undefined); });
      check.disabled = pairOf.size < lefts.length;
    }
    refresh();
    body.append(el('p', { class: 'muted', textContent: 'Выбери слева, потом справа. Нажми на готовую пару, чтобы разорвать её.' }),
      el('div', { class: 'zero-match' }, el('div', { class: 'zero-col', role: 'group', 'aria-label': 'Слева' }, ...leftBtns), el('div', { class: 'zero-col', role: 'group', 'aria-label': 'Справа' }, ...rightBtns)), check);
  } else if (d.t === 'read') {
    body.append(el('div', { class: 'row wrap' },
      el('button', { type: 'button', class: 'primary', textContent: 'Прочитал(а): получилось', onclick: () => finish('ok') }),
      el('button', { type: 'button', textContent: 'Ещё потренируюсь', onclick: () => finish('again') })));
  }
  root.append(...[...parts, hintBtn, hintBox, body, fbBox].filter(Boolean));
  return { root, focus: () => (root.querySelector('button,input') ?? root).focus() };
}

// ---------- ряд заданий: «Задание 2 из 8», мгновенный разбор, по кнопке «Дальше» следующее ----------
const progress = (v, t) => el('div', { class: 'bar zero-progress', 'aria-hidden': 'true' }, el('span', { style: `width:${t ? Math.round((v / t) * 100) : 0}%` }));
export function runSequence(box, items, { seed = 0, lang = 'english', label = 'Задание', onAnswer = () => {}, onFinish = () => {} } = {}) {
  const results = [];
  let i = 0;
  const show = () => {
    const title = el('h3', { class: 'zero-qh', tabIndex: -1, textContent: `${label} ${i + 1} из ${items.length}` });
    const view = drillView(items[i], { seed: seed + i * 7919, lang, last: i === items.length - 1, onAnswer: res => { results[i] = res; onAnswer(i, res); }, onNext: () => { i++; if (i < items.length) show(); else onFinish(results); } });
    fill(box, el('div', { class: 'zero-seq-head' }, title, progress(i, items.length)), view.root);
    box.closest('.overlay')?.scrollTo?.(0, 0);
    focusNode(title);
  };
  show();
}

// ---------- страница урока: цель, текст, таблица, слова. Кнопки действий добавляет экран ----------
// Что озвучить в строке таблицы: последняя ячейка на изучаемом языке (пример слова), перевод после тире отбрасывается.
const foreignPart = cells => { for (const c of [...cells].reverse()) { const t = speakable(c); if ((HE.test(t) || LAT.test(t)) && !CYR.test(t)) return t; } return ''; };
function tableNode(rows) {
  const [head, ...rest] = rows;
  const cell = (tag, c) => el(tag, tag === 'th' ? { scope: 'col' } : {}, ...rich(c));
  const says = rest.map(foreignPart), withSay = says.some(Boolean);
  const sayCell = t => el('td', {}, t ? el('button', { type: 'button', class: 'chip zero-say', 'aria-label': `Послушать: ${t}`, onclick: () => sayText(t, HE.test(t) ? 'hebrew' : 'english') }, icon('volume', 16)) : null);
  return el('div', { class: 'zero-table-wrap', tabIndex: 0, role: 'region', 'aria-label': 'Таблица-шпаргалка' },
    el('table', { class: 'zero-table' }, el('thead', {}, el('tr', {}, ...head.map(c => cell('th', c)), withSay ? el('th', { scope: 'col', textContent: 'Звук' }) : null)),
      el('tbody', {}, ...rest.map((r, i) => el('tr', {}, ...r.map(c => cell('td', c)), withSay ? sayCell(says[i]) : null)))));
}
const chipList = (title, words, lang) => el('div', { class: 'zero-words' }, el('strong', { textContent: title }),
  el('div', { class: 'row wrap' }, ...words.map(w => { const [word, mean] = [].concat(w); return el('span', { class: 'zero-word' }, el('span', { ...textProps(word) }, ...rich(word)), mean ? el('span', { class: 'muted', textContent: ` — ${mean}` }) : null, speakBtn(word, lang)); })));

export function lessonPage({ track, lesson, goal }) {
  return el('div', { class: 'zero-lesson' },
    el('h3', { class: 'zero-title', tabIndex: -1, textContent: lesson.title }),
    el('p', { class: 'muted', textContent: `${track.title} · ${lesson.stage} · ${lesson.minutes} мин` }),
    goal ? el('p', { class: 'lesson-goal' }, el('strong', { textContent: 'После урока я смогу: ' }), goal) : null,
    ...lesson.body.map(p => el('p', { class: 'zero-p' }, ...rich(p))),
    lesson.table?.length ? tableNode(lesson.table) : null,
    lesson.words?.length ? chipList('Слова для чтения', lesson.words, track.lang) : null,
    lesson.showcase?.length ? chipList('Примеры на слух', lesson.showcase, track.lang) : null,
    lesson.task ? el('p', { class: 'task' }, el('strong', { textContent: 'Задание: ' }), ...rich(lesson.task)) : null);
}

// ---------- закрытый урок: чего не хватает и «Я уже умею это: проверить» (содержимое урока не показываем) ----------
export function lockedPage({ lesson, missing, labelOf, onPlacement, onOpenMissing }) {
  return el('div', { class: 'zero-lesson zero-locked' },
    el('h3', { class: 'zero-title', tabIndex: -1, textContent: lesson.title }),
    el('p', { class: 'zero-lockmsg' }, icon('lock', 18), el('strong', { textContent: 'Урок пока закрыт' })),
    el('p', { textContent: 'Чтобы он открылся, нужно освоить эти уроки:' }),
    el('ul', { class: 'plain zero-missing' }, ...missing.map(m => el('li', { dataset: { lesson: m.lesson.id } },
      el('span', { textContent: `${m.lesson.title} — ` }), el('span', { class: 'muted', textContent: labelOf(m.status) }), ' ',
      m.status === 'locked' ? null : el('button', { type: 'button', class: 'link', textContent: 'открыть', 'aria-label': `Открыть урок: ${m.lesson.title}`, onclick: () => onOpenMissing(m.lesson.id) })))),
    el('p', { class: 'muted', textContent: 'Если ты уже умеешь это, пройди короткую проверку. Подсказки в ней не засчитываются.' }),
    el('button', { type: 'button', id: 'zero-placement', class: 'primary', textContent: 'Я уже умею это: проверить', onclick: onPlacement }));
}
