// Дыхание 4–6: вдох 4 секунды, выдох 6. Удлинённый выдох помогает успокоиться. Чистая логика + небольшое окно.
import { el, toast } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';

export const INHALE_MS = 4000, EXHALE_MS = 6000;

// Фаза дыхания через elapsedMs после старта.
export function breathPhase(elapsedMs, inhale = INHALE_MS, exhale = EXHALE_MS) {
  const cycle = inhale + exhale, t = ((elapsedMs % cycle) + cycle) % cycle;
  const n = Math.floor(elapsedMs / cycle) + 1;
  return t < inhale ? { phase: 'in', leftMs: inhale - t, cycle: n } : { phase: 'out', leftMs: cycle - t, cycle: n };
}

export function makeBreath(date, seconds, before = null, after = null, now = Date.now()) {
  const ok = v => Number.isInteger(v) && v >= 1 && v <= 5;
  return { id: `breath:${Math.floor(now).toString(36)}`, type: 'breath', ts: now,
    payload: { date, seconds: Math.max(0, Math.round(seconds)), ...(ok(before) ? { before } : {}), ...(ok(after) ? { after } : {}) }, source: 'manual', confidence: 1, evidence: [] };
}

// Окно упражнения. host — полноэкранный контейнер (.overlay).
export function openBreathing(host) {
  host.hidden = false; host.tabIndex = -1;
  let timer = null, startedAt = 0, before = null, total = 300;
  const close = () => { clearTimeout(timer); host.hidden = true; host.replaceChildren(); };
  const rating = (cb, label) => el('div', { class: 'rate-btns', role: 'group', 'aria-label': label }, ...[1, 2, 3, 4, 5].map(v => el('button', { type: 'button', class: 'rate', dataset: { v: String(v) }, textContent: String(v), onclick: () => cb(v) })));

  function intro() {
    const sel = el('select', { id: 'breath-min', 'aria-label': 'Длительность' }, ...[[180, '3 минуты'], [300, '5 минут'], [600, '10 минут']].map(([v, t]) => el('option', { value: String(v), textContent: t })));
    sel.value = '300';
    host.replaceChildren(
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: 'Дыхание 4–6' }), el('button', { type: 'button', id: 'breath-close', class: 'link', textContent: 'Закрыть', onclick: close })),
      el('div', { class: 'card bt-intro' },
        el('p', { textContent: 'Вдох через нос на 4 счёта, выдох на 6. Плечи расслаблены, спина прямая. Если закружилась голова — дыши как обычно.' }),
        el('p', { class: 'muted', textContent: 'Как твой стресс сейчас? (по желанию)' }), rating(v => { before = v; for (const b of host.querySelectorAll('.rate')) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === v)); }, 'Стресс до'),
        sel, el('button', { type: 'button', id: 'breath-go', class: 'primary big-btn', textContent: 'Начать', onclick: () => { total = Number(sel.value); run(); } })));
  }
  function run() {
    const circle = el('div', { class: 'breath-circle', id: 'breath-circle' });
    const word = el('div', { class: 'bt-problem', id: 'breath-word', textContent: 'Вдох' });
    const left = el('div', { class: 'muted', id: 'breath-left' });
    host.replaceChildren(el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: 'Дыхание 4–6' }), el('button', { type: 'button', id: 'breath-stop', class: 'link', textContent: 'Закончить', onclick: () => finish(false) })),
      el('div', { class: 'bt-stage' }, circle, word, left));
    startedAt = performance.now();
    let last = null;
    const tick = () => {
      const el_ = performance.now() - startedAt;
      if (el_ >= total * 1000) return finish(true);
      const p = breathPhase(el_);
      if (p.phase !== last) { last = p.phase; word.textContent = p.phase === 'in' ? 'Вдох' : 'Выдох'; circle.style.transitionDuration = `${(p.phase === 'in' ? INHALE_MS : EXHALE_MS) / 1000}s`; circle.dataset.phase = p.phase; }
      left.textContent = `Осталось ${Math.ceil((total * 1000 - el_) / 1000)} с`;
      timer = setTimeout(tick, 200);
    };
    tick();
  }
  async function finish(completed) {
    clearTimeout(timer);
    const seconds = Math.min(total, Math.round((performance.now() - startedAt) / 1000));
    host.replaceChildren(el('div', { class: 'card bt-intro' }, el('h3', { id: 'breath-result', textContent: completed ? 'Готово' : 'Остановлено' }),
      el('p', { class: 'muted', textContent: 'Как стресс сейчас? (по желанию)' }),
      rating(async v => { await save(seconds, v); }, 'Стресс после'),
      el('button', { type: 'button', id: 'breath-skip', textContent: 'Без оценки', onclick: async () => { await save(seconds, null); } })));
  }
  async function save(seconds, after) {
    if (seconds >= 20) { await store.save(makeBreath(todayStr(), seconds, before, after)); toast('Записано'); }
    close();
  }
  intro();
  return { close };
}
