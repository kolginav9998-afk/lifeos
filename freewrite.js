// Свободное письмо: таймер и поле, в котором нужно писать без остановки и без исправлений.
// Текст дописывается в запись дня в дневнике. Ничего не отправляется наружу.
import { el, toast } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { appendFreeWrite, wordCount } from './writing.js';

export const PRESETS = [3, 5, 10];
const fmtClock = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function openFreeWrite(host) {
  host.hidden = false; host.tabIndex = -1;
  let timer = null, startedAt = 0, minutes = 5, area = null;
  const close = () => { clearTimeout(timer); host.hidden = true; host.replaceChildren(); };

  function intro() {
    const btns = PRESETS.map(m => el('button', { type: 'button', class: 'chip fw-min', dataset: { min: String(m) }, 'aria-pressed': String(m === minutes), textContent: `${m} мин`,
      onclick: () => { minutes = m; for (const b of btns) b.setAttribute('aria-pressed', String(Number(b.dataset.min) === m)); } }));
    host.replaceChildren(
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: 'Свободное письмо' }), el('button', { type: 'button', id: 'fw-close', class: 'link', textContent: 'Закрыть', onclick: close })),
      el('div', { class: 'card bt-intro' },
        el('p', { textContent: 'Пиши всё, что приходит в голову, и не останавливайся: не перечитывай, не исправляй, не оценивай. Если нечего сказать, пиши «не знаю, что писать», пока мысль не придёт.' }),
        el('p', { class: 'muted', textContent: 'Текст сохранится в записи дня в дневнике.' }),
        el('div', { class: 'row wrap' }, ...btns),
        el('button', { type: 'button', id: 'fw-go', class: 'primary big-btn', textContent: 'Начать', onclick: start })));
  }
  function start() {
    startedAt = Date.now();
    area = el('textarea', { id: 'fw-text', rows: 12, maxLength: 15000, placeholder: 'Пиши…', 'aria-label': 'Свободное письмо' });
    const clock = el('div', { id: 'fw-clock', class: 'fw-clock' }), words = el('span', { id: 'fw-words', class: 'muted', textContent: '0 слов' });
    area.addEventListener('input', () => { words.textContent = `${wordCount(area.value)} слов`; });
    host.replaceChildren(
      el('div', { class: 'sess-top' }, clock, el('button', { type: 'button', id: 'fw-finish', class: 'link', textContent: 'Закончить', onclick: () => finish() })), area, words);
    area.focus();
    const tick = () => {
      const left = startedAt + minutes * 60000 - Date.now();
      clock.textContent = fmtClock(Math.max(0, left));
      if (left <= 0) return finish();
      timer = setTimeout(tick, 500);
    };
    tick();
  }
  async function finish() {
    clearTimeout(timer);
    const text = (area?.value ?? '').trim();
    if (!text) { toast('Ничего не написано'); close(); return; }
    try {
      const ok = await store.save(appendFreeWrite(store.state.events, todayStr(), text));
      if (!ok) { toast('Не удалось сохранить: приложение заблокировано. Скопируй текст.'); return; }
    } catch (e) { toast('Не удалось сохранить: ' + e.message); return; }
    host.replaceChildren(el('div', { class: 'card bt-intro' }, el('h3', { id: 'fw-result', textContent: 'Сохранено в дневник' }),
      el('p', { textContent: `Написано слов: ${wordCount(text)}. Если мысли стало меньше или стало яснее, свободное письмо сработало.` }),
      el('button', { type: 'button', id: 'fw-done', class: 'primary big-btn', textContent: 'Ок', onclick: close })));
  }
  intro();
  return { close };
}
