// Вкладка «Ударения»: раунд из десяти слов, в которых часто ошибаются. Ошибки возвращаются в следующих раундах, пока не ответишь верно.
import { el, fill, toast, announce } from './ui.js';
import { stressQuiz, missedStress, makeDiction, stressById, fmtClock, plural, STRESS_WORDS } from './diction.js';

const VOWEL = /[АЕЁИОУЫЭЮЯ]/;
// Слово с подсвеченной ударной гласной: заглавная буква в записи превращается в жирную подчёркнутую строчную.
export const stressNode = v => el('span', { class: 'dic-word', lang: 'ru' }, ...[...v].map(ch => (VOWEL.test(ch) ? el('span', { class: 'dic-st', textContent: ch.toLowerCase() }) : ch)));
const letterOf = v => [...v].find(ch => VOWEL.test(ch))?.toLowerCase() ?? '';

export function createStressTab(k) {
  function render(panel) {
    const arg = k.take();
    const miss = missedStress(k.events, k.today());
    fill(panel,
      el('div', { class: 'card' },
        el('h3', { textContent: 'Ударения' }),
        el('p', { textContent: `В словаре тренажёра ${STRESS_WORDS.length} ${plural(STRESS_WORDS.length, ['слово', 'слова', 'слов'])}, в которых часто ошибаются. Раунд — десять вопросов. Ударная буква показана жирной и подчёркнутой.` }),
        el('p', { id: 'dic-st-miss', class: 'muted', textContent: miss.length ? `Ждут повторения слов с прошлых ошибок: ${miss.length}. Часть из них попадёт в раунд.` : 'Слов с прошлыми ошибками пока нет.' }),
        el('button', { type: 'button', id: 'dic-st-go', class: 'primary big-btn', textContent: 'Начать раунд', onclick: () => quiz() }),
        el('p', { class: 'muted', textContent: 'В тренажёре только слова, где современная норма однозначна. Сомневаешься в другом слове? Проверь по орфоэпическому словарю.' })));
    if (arg?.start) quiz();
  }

  function quiz() {
    const prior = missedStress(k.events, k.today());
    const qs = stressQuiz({ seed: Math.floor(Date.now() / 1000), n: 10, miss: prior });
    let i = 0, ok = 0, answered = 0;
    const missed = [], fixed = [], t0 = performance.now();
    k.open(api => {
      function ask() {
        const q = qs[i], w = stressById(q.id);
        const title = el('p', { id: 'dic-st-q', class: 'dic-big', tabIndex: -1, textContent: `Где ударение в слове «${q.word}»?` });
        const fb = el('p', { id: 'dic-st-fb', class: 'dic-fb', role: 'status' });
        const next = el('button', { type: 'button', id: 'dic-st-next', class: 'primary big-btn', hidden: true, textContent: i + 1 < qs.length ? 'Дальше' : 'Результат', onclick: () => { i++; if (i < qs.length) ask(); else result(); } });
        const opts = q.options.map((o, idx) => el('button', { type: 'button', class: 'dic-opt', dataset: { idx: String(idx) }, 'aria-label': `${q.word}, ударение на «${letterOf(o)}»`, onclick: () => pick(idx) }, stressNode(o)));
        function pick(idx) {
          const right = idx === q.answer;
          answered++;
          if (right) ok++; else missed.push(q.id);
          if (right && prior.includes(q.id)) fixed.push(q.id);
          opts.forEach((b, j) => {
            b.disabled = true;
            if (j === q.answer) { b.classList.add('right'); b.append(el('span', { class: 'dic-mark', 'aria-hidden': 'true', textContent: ' ✓' })); b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, верный ответ`); }
            else if (j === idx) { b.classList.add('wrong'); b.append(el('span', { class: 'dic-mark', 'aria-hidden': 'true', textContent: ' ✕' })); b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, твой ответ, неверно`); }
          });
          fb.textContent = right ? `Верно: ${w.right}. ${w.hint}` : `Не совсем. Правильно: ${w.right}. ${w.hint}`;
          next.hidden = false; next.focus({ preventScroll: true });
          announce(fb.textContent);
        }
        api.set(k.top(`Ударения · вопрос ${i + 1} из ${qs.length}`, 'dic-stop', 'Закончить', () => result()),
          el('div', { class: 'card bt-intro' }, title, el('div', { class: 'dic-opts', role: 'group', 'aria-label': 'Варианты ударения' }, ...opts), fb, next));
        title.focus({ preventScroll: true });
      }
      async function result() {
        const n = answered;
        const sec = Math.round((performance.now() - t0) / 1000);
        let note = '';
        if (n >= 1) {
          try { await k.save(makeDiction({ kind: 'stress', seconds: sec, items: n, ok, miss: missed, fixed })); note = 'Раунд записан.'; } catch (e) { note = `Раунд не записан: ${e.message.toLowerCase()}`; toast(e.message); }
        } else note = 'Ни одного ответа: раунд не записан.';
        api.set(el('div', { class: 'card bt-intro' },
          el('h3', { id: 'dic-s-fin-title', tabIndex: -1, textContent: `Верно ${ok} из ${n}` }),
          el('p', { id: 'dic-s-fin-note', textContent: `${note} Время: ${fmtClock(sec)}.` }),
          missed.length ? el('div', { id: 'dic-st-wrong' }, el('strong', { textContent: 'Запомни:' }), el('ul', { class: 'plain' }, ...missed.map(id => el('li', {}, stressNode(stressById(id).right), ` (не ${stressById(id).wrong})`)))) : el('p', { class: 'ok', textContent: 'Без ошибок. Отлично!' }),
          el('button', { type: 'button', id: 'dic-st-again', class: 'primary', textContent: 'Ещё раунд', onclick: () => quiz() }),
          el('button', { type: 'button', id: 'dic-s-close', class: 'chip', textContent: 'Закрыть', onclick: () => api.close() })));
        document.getElementById('dic-s-fin-title')?.focus({ preventScroll: true });
        announce(`Верно ${ok} из ${n}.`);
      }
      ask();
    });
  }
  return { render };
}
