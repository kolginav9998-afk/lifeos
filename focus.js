// Фокус-таймер: 25/50/90 минут без отвлечений. Сессия записывается событием `focus`; незавершённая короче 5 минут не сохраняется.
import { el, toast } from './ui.js';
import { todayStr, addDays, isYmd } from './events.js';
import * as store from './store.js';

export const MIN_SAVE_MIN = 5;
export const PRESETS = [25, 50, 90];
const RUN_KEY = 'lifeos.focus.run';

export function makeFocus({ date, minutes, planned, label = '', completed = true }, now = Date.now()) {
  if (!isYmd(date)) throw new Error('bad date');
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 1 || m > 600) throw new Error('Минуты: от 1 до 600');
  const l = String(label ?? '').trim().slice(0, 120);
  return { id: `fs:${Math.floor(now).toString(36)}`, type: 'focus', ts: now, source: 'manual', confidence: 1, evidence: [],
    payload: { date, minutes: m, planned: Math.round(Number(planned) || m), completed: !!completed, ...(l ? { label: l } : {}) } };
}
export const focusMinutes = (events, date) => events.filter(e => e.type === 'focus' && e.payload.date === date).reduce((s, e) => s + e.payload.minutes, 0);
export function focusWeek(events, today) {
  const from = addDays(today, -6);
  const list = events.filter(e => e.type === 'focus' && e.payload.date >= from && e.payload.date <= today);
  return { minutes: list.reduce((s, e) => s + e.payload.minutes, 0), sessions: list.length, days: new Set(list.map(e => e.payload.date)).size };
}
// Сколько осталось (мс) и закончено ли время. Считаем по часам, а не по тикам таймера: в фоне тики замедляются.
export function focusLeft(run, now = Date.now()) {
  const left = run.startedAt + run.minutes * 60000 - now;
  return { leftMs: Math.max(0, left), done: left <= 0, elapsedMin: Math.max(0, Math.min(run.minutes, Math.floor((now - run.startedAt) / 60000))) };
}
export const fmtClock = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- запущенная сессия переживает перезапуск (в хранилище только время старта и длина, без названия дела) ----------
const readRun = () => { try { const r = JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); return r && Number.isFinite(r.startedAt) && r.minutes > 0 ? r : null; } catch { return null; } };
const writeRun = r => { try { if (r) localStorage.setItem(RUN_KEY, JSON.stringify(r)); else localStorage.removeItem(RUN_KEY); } catch { /* не критично */ } };

export function openFocus(host, { tasks = [], resume = false } = {}) {
  host.hidden = false; host.tabIndex = -1;
  let timer = null, run = null, label = '';
  const close = () => { clearTimeout(timer); host.hidden = true; host.replaceChildren(); };

  function intro() {
    const pick = el('select', { id: 'focus-task', 'aria-label': 'Над чем работаешь' }, el('option', { value: '', textContent: 'Без привязки к задаче' }), ...tasks.slice(0, 30).map(t => el('option', { value: t, textContent: t.length > 50 ? t.slice(0, 47) + '…' : t })));
    const own = el('input', { id: 'focus-label', type: 'text', maxLength: 120, placeholder: 'или напиши, над чем работаешь', autocomplete: 'off' });
    let minutes = 25;
    const btns = PRESETS.map(m => el('button', { type: 'button', class: 'chip focus-min', dataset: { min: String(m) }, 'aria-pressed': String(m === minutes), textContent: `${m} мин`, onclick: () => { minutes = m; for (const b of btns) b.setAttribute('aria-pressed', String(Number(b.dataset.min) === m)); } }));
    host.replaceChildren(
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: 'Фокус' }), el('button', { type: 'button', id: 'focus-close', class: 'link', textContent: 'Закрыть', onclick: close })),
      el('div', { class: 'card bt-intro' },
        el('p', { textContent: 'Одно дело, без уведомлений. Убери телефон из поля зрения (этот экран можно оставить открытым) и держи воду рядом.' }),
        el('div', { class: 'row wrap' }, ...btns), pick, own,
        el('button', { type: 'button', id: 'focus-go', class: 'primary big-btn', textContent: 'Начать', onclick: () => { label = own.value.trim() || pick.value; start(minutes); } })));
  }
  function start(minutes) { run = { startedAt: Date.now(), minutes }; writeRun(run); show(); }
  function show() {
    const clock = el('div', { class: 'bt-problem focus-clock', id: 'focus-clock' });
    const sub = el('div', { class: 'muted', id: 'focus-sub', textContent: label || 'Сосредоточься на одном деле' });
    host.replaceChildren(
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: `Фокус · ${run.minutes} мин` }), el('button', { type: 'button', id: 'focus-stop', class: 'link', textContent: 'Остановить', onclick: () => finish(false) })),
      el('div', { class: 'bt-stage' }, clock, sub, bar()));
    tick();
  }
  const barEl = el('div', { class: 'bar' }, el('span', { id: 'focus-bar', style: 'width:0%' }));
  const bar = () => barEl;
  function tick() {
    const f = focusLeft(run);
    const c = host.querySelector('#focus-clock'); if (!c) return;
    c.textContent = fmtClock(f.leftMs);
    const b = host.querySelector('#focus-bar'); if (b) b.style.width = `${Math.round(((run.minutes * 60000 - f.leftMs) / (run.minutes * 60000)) * 100)}%`;
    if (f.done) return finish(true);
    timer = setTimeout(tick, 500);
  }
  async function finish(completed) {
    clearTimeout(timer);
    const f = focusLeft(run);
    const minutes = completed ? run.minutes : f.elapsedMin;
    if (minutes < MIN_SAVE_MIN) { writeRun(null); toast(`Меньше ${MIN_SAVE_MIN} минут — не записываю`); close(); return; }
    try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(completed ? [200, 100, 200] : 0); } catch { /* не везде есть; без касания браузер вибрацию блокирует */ }
    const ok = await store.save(makeFocus({ date: todayStr(run.startedAt), minutes, planned: run.minutes, label, completed }));
    if (!ok) { close(); return; }                       // приложение заблокировано: сессию допишем при следующем запуске
    writeRun(null);
    host.replaceChildren(el('div', { class: 'card bt-intro' }, el('h3', { id: 'focus-result', textContent: completed ? 'Готово!' : 'Записано' }),
      el('p', { textContent: `Сосредоточенных минут: ${minutes}.` }), el('p', { class: 'muted', textContent: 'Сделай перерыв на 5 минут: встань, пройдись, выпей воды. Экран не считается отдыхом.' }),
      el('button', { type: 'button', id: 'focus-done', class: 'primary big-btn', textContent: 'Ок', onclick: close })));
  }

  const saved = resume ? readRun() : null;
  if (saved) { run = saved; show(); } else intro();
  return { close };
}

// Если приложение закрыли во время фокуса: при запуске возвращаем окно или дописываем завершённую сессию.
export const hasRunningFocus = () => !!readRun();
