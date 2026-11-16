// Вкладка «Чтение вслух»: тексты с разметкой пауз и ударений, свой текст и измеритель темпа речи (слов в минуту): старт и стоп.
import { el, fill, toast, announce, ratingRow } from './ui.js';
import { TEXTS, textById, parseMarkup, plainText, countWords, wpm, wpmBand, WPM_NOTE, makeDiction, fmtClock, fmtNum, plural } from './diction.js';

const MAX_OWN = 3000;
const OWN = 'own';

// Текст с разметкой для показа: паузы — значки «/» и «//», слова с логическим ударением — жирные и подчёркнутые.
export function markupNode(markup, marks = true) {
  return el('div', { class: 'dic-read', lang: 'ru' }, ...parseMarkup(markup).map(line => el('p', { class: 'dic-line' }, ...line.flatMap((t, i) => [
    t.pause ? (marks ? el('span', { class: `dic-pause${t.pause > 1 ? ' long' : ''}`, 'aria-hidden': 'true', textContent: t.pause > 1 ? '//' : '/' }) : null) : el('span', { class: t.stress && marks ? 'dic-emph' : 'dic-w', textContent: t.w }),
    i < line.length - 1 ? ' ' : null]).filter(Boolean))));
}

export function createReadingTab(k) {
  let pick = 'rt08', own = '', marks = true;
  const current = () => (pick === OWN ? { id: '', title: 'Свой текст', text: own } : textById(pick) ?? TEXTS[0]);

  function render(panel) {
    const arg = k.take();
    if (arg?.text && textById(arg.text)) pick = arg.text;
    const draw = () => render(panel);
    const t = current();
    const sel = el('select', { id: 'dic-read-pick', 'aria-label': 'Текст для чтения' }, ...TEXTS.map(x => el('option', { value: x.id, textContent: `${x.title} (${x.author})` })), el('option', { value: OWN, textContent: 'Свой текст…' }));
    sel.value = pick;
    sel.onchange = () => { pick = sel.value; draw(); };
    const ta = pick === OWN ? el('textarea', { id: 'dic-read-own', rows: 5, maxLength: MAX_OWN, placeholder: 'Вставь или напиши текст. Можно с разметкой: / короткая пауза, // длинная, *слово* с логическим ударением', 'aria-label': 'Свой текст' }) : null;
    if (ta) { ta.value = own; ta.oninput = () => { own = ta.value; const w = countWords(own); info.textContent = `Слов: ${w}`; open.disabled = w < 5; }; }
    const words = countWords(t.text);
    const info = el('p', { id: 'dic-read-info', class: 'muted', textContent: `Слов: ${words}${t.kind ? ` · ${t.kind}` : ''}` });
    const open = el('button', { type: 'button', id: 'dic-read-open', class: 'primary big-btn', textContent: 'Читать вслух и замерить темп', disabled: words < 5, onclick: () => read(current()) });
    const toggle = el('button', { type: 'button', id: 'dic-read-marks', class: 'chip', 'aria-pressed': String(marks), textContent: 'Показывать разметку', onclick: () => { marks = !marks; draw(); } });
    fill(panel,
      el('div', { class: 'card' },
        el('h3', { textContent: 'Чтение вслух' }),
        el('p', { class: 'muted', textContent: 'Прочитай про себя, пойми смысл, потом вслух. Косые черты — паузы, жирные слова — логическое ударение. Приложение считает время и слова в минуту, но голос не записывает.' }),
        sel, ta, info),
      el('div', { class: 'card', id: 'dic-read-card' }, toggle, markupNode(t.text, marks)),
      open,
      el('p', { class: 'muted', textContent: 'Хочешь услышать себя? Запиши голос другой программой на телефоне и послушай запись.' }));
    if (arg?.text) read(current());
  }

  // Окно чтения: крупный текст, секундомер, темп и оценка.
  function read(t) {
    const text = t.text, words = countWords(text);
    let t0 = 0, timer = null, sec = 0, rating = null, shown = marks;
    k.open(api => {
      api.onClose(() => clearInterval(timer));
      const body = el('div', { id: 'dic-rd-body' });
      const clock = el('div', { id: 'dic-rd-clock', class: 'dic-clock', 'aria-hidden': 'true', textContent: '0:00' });
      const go = el('button', { type: 'button', id: 'dic-rd-go', class: 'primary big-btn', textContent: 'Старт' });
      const result = el('div', { id: 'dic-rd-result', class: 'dic-result' });
      const paintText = () => fill(body, markupNode(text, shown));
      const toggle = el('button', { type: 'button', id: 'dic-rd-marks', class: 'chip', 'aria-pressed': String(shown), textContent: 'Показывать разметку', onclick: () => { shown = !shown; toggle.setAttribute('aria-pressed', String(shown)); paintText(); } });
      go.onclick = () => {
        if (!timer) {
          fill(result); rating = null; t0 = performance.now(); go.textContent = 'Стоп';
          timer = setInterval(() => { clock.textContent = fmtClock((performance.now() - t0) / 1000); }, 250);
          announce('Секундомер запущен. Читай вслух.');
        } else {
          clearInterval(timer); timer = null; sec = Math.round((performance.now() - t0) / 1000); clock.textContent = fmtClock(sec); go.textContent = 'Ещё раз';
          const pace = wpm(words, sec), band = wpmBand(pace);
          const save = el('button', { type: 'button', id: 'dic-rd-save', class: 'primary', textContent: 'Сохранить', disabled: true, onclick: () => commit(save, pace) });
          const rate = ratingRow('Как получилось в целом?', 'reading', null, v => { rating = v; save.disabled = !v; });
          fill(result,
            el('p', { id: 'dic-rd-wpm', class: 'dic-wpm', textContent: pace ? `${pace} ${plural(pace, ['слово', 'слова', 'слов'])} в минуту` : 'Темп не посчитать: слишком мало времени' }),
            band ? el('p', { id: 'dic-rd-band', textContent: `${band.title}. ${band.note}` }) : null,
            el('p', { class: 'muted', textContent: `Слов в тексте: ${words}, время: ${fmtClock(sec)}. Комфортный темп чаще всего 110–150 слов в минуту. ${WPM_NOTE}` }),
            rate, save);
          announce(pace ? `Темп: ${pace} слов в минуту. ${band?.title ?? ''}` : 'Слишком мало времени для расчёта');
        }
      };
      async function commit(save, pace) {
        let ev;
        try { ev = makeDiction({ kind: 'reading', seconds: sec, items: words, rating, wpm: pace, ref: t.id }); } catch (e) { toast(e.message); return; }
        save.disabled = true;
        await k.save(ev);
        fill(result, el('p', { id: 'dic-rd-saved', class: 'ok', textContent: `Записано: ${fmtNum(pace)} слов в минуту, оценка ${rating} из 5.` }));
        announce('Записано');
      }
      paintText();
      api.set(k.top(t.title, 'dic-r-close', 'Закрыть', () => api.close()),
        el('div', { class: 'card bt-intro' }, toggle, body, k.voice(() => plainText(text), () => 0.9), clock, go, result, k.safety()));
    });
  }
  return { render };
}
