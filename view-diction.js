// Экран «Дикция»: вкладки «Сегодня», «Разминка», «Дыхание», «Скороговорки», «Ударения», «Чтение вслух», «Оценка», «Курс».
// Здесь оболочка и общие помощники (k) для вкладок: записи, окно тренажёра, образец голоса, настройки устройства. Каждая вкладка — в своём файле view-diction-*.js.
// Голос не записывается и не распознаётся: приложение считает время, повторы и самооценку. Логика и данные: diction.js, diction-*.js.
import { el, fill, toast } from './ui.js';
import * as store from './store.js';
import { todayStr } from './events.js';
import { canSpeak, speak } from './speech.js';
import { createTodayTab } from './view-diction-today.js';
import { createWarmupTab } from './view-diction-warmup.js';
import { createBreathTab } from './view-diction-breath.js';
import { createTwistersTab } from './view-diction-twisters.js';
import { createStressTab } from './view-diction-stress.js';
import { createReadingTab } from './view-diction-reading.js';
import { createRubricTab } from './view-diction-rubric.js';
import { createCourseTab } from './view-diction-course.js';

export const SAFETY = 'Если больно, остановись. Если голос хрипит дольше двух недель или речь стойко не получается, обратись к логопеду или ЛОРу. Приложение не записывает голос и не ставит диагнозов.';
const PREF = 'lifeos.diction.';
const readPref = (name, def) => { try { const v = JSON.parse(localStorage.getItem(PREF + name)); return v ?? def; } catch { return def; } };
const writePref = (name, v) => { try { localStorage.setItem(PREF + name, JSON.stringify(v)); } catch { /* не критично */ } };

// Есть ли на устройстве русский голос: 'yes' | 'no' | 'unknown' (список голосов бывает пуст, пока не загрузится).
export function ruVoice() {
  if (!canSpeak()) return 'no';
  const list = globalThis.speechSynthesis.getVoices?.() ?? [];
  return !list.length ? 'unknown' : list.some(v => /^ru/i.test(v.lang)) ? 'yes' : 'no';
}

export function createDictionView(ctx = {}) {
  const root = el('section', { id: 'view-diction', class: 'view' });
  const host = el('div', { id: 'dic-host', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Тренажёр дикции' });
  const tablist = el('div', { id: 'dic-tabs', class: 'dic-tabs', role: 'tablist', 'aria-label': 'Разделы дикции' });
  const panel = el('div', { id: 'dic-panel', class: 'dic-panel', role: 'tabpanel' });
  let events = [], current = 'today', pending = null, dirty = false;
  const closers = [];

  // ---------- общие помощники для вкладок ----------
  function closeHost() {
    while (closers.length) closers.pop()();
    host.hidden = true; fill(host);
    if (dirty) { dirty = false; render(); }
  }
  const k = {
    get events() { return events; },
    today: () => todayStr(),
    save: async ev => { const ok = await store.save(ev); return ok; },
    saveAll: evs => store.saveMany(evs),
    remove: id => store.remove(id),
    go: (id, arg = null) => select(id, arg),
    take: () => { const a = pending; pending = null; return a; },
    pref: readPref, setPref: writePref,
    goLearn: () => ctx.go?.('learn'),
    // Окно тренажёра на весь экран. build получает { set(...узлы), close(), onClose(fn) }.
    open(build) {
      closeHost();
      fill(host);
      host.hidden = false;
      build({ set: (...kids) => fill(host, ...kids), close: closeHost, onClose: fn => closers.push(fn) });
      if (!host.contains(document.activeElement)) host.focus({ preventScroll: true });
    },
    close: closeHost,
    // Верхняя строка окна: название и кнопка (id «dic-close» закрывает по Escape, «dic-stop» во время занятия Escape не прерывает).
    top: (title, btnId, btnText, onClick) => el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: title }), el('button', { type: 'button', id: btnId, class: 'link', textContent: btnText, onclick: onClick })),
    safety: () => el('p', { class: 'dic-safety muted', textContent: 'Больно или закружилась голова? Остановись и отдохни.' }),
    // Кнопка «Послушать образец» и честное сообщение, если голоса нет.
    voice(getText, getRate) {
      const note = el('p', { class: 'muted dic-voice-note', role: 'status' });
      const btn = el('button', { type: 'button', class: 'chip dic-voice', textContent: 'Послушать образец', onclick: () => {
        if (ruVoice() === 'no') { note.textContent = canSpeak() ? 'На этом устройстве нет русского голоса. Включи синтез речи в настройках телефона или прочитай образец вслух сам.' : 'Озвучка здесь недоступна. Прочитай образец вслух сам.'; return; }
        note.textContent = '';
        speak(getText(), 'russian', e => { note.textContent = `Голос не запустился (${e}). Прочитай образец вслух сам.`; }, getRate?.() ?? 0.95);
      } });
      return el('div', { class: 'dic-voice-box' }, btn, note);
    },
    done: msg => toast(msg),
  };

  // ---------- вкладки ----------
  const TABS = [['today', 'Сегодня', createTodayTab], ['warmup', 'Разминка', createWarmupTab], ['breath', 'Дыхание', createBreathTab], ['twisters', 'Скороговорки', createTwistersTab],
    ['stress', 'Ударения', createStressTab], ['reading', 'Чтение вслух', createReadingTab], ['rubric', 'Оценка', createRubricTab], ['course', 'Курс', createCourseTab]];
  const tabs = Object.fromEntries(TABS.map(([id, , make]) => [id, make(k)]));

  function render() { fill(panel); tabs[current].render(panel); }
  function select(id, arg = null, focus = false) {
    if (!tabs[id]) id = 'today';
    current = id; pending = arg;
    for (const b of tablist.children) { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    panel.setAttribute('aria-labelledby', `dic-tab-${id}`);
    render();
    if (focus) tablist.querySelector(`[data-tab="${id}"]`).focus({ preventScroll: true });
  }
  fill(tablist, ...TABS.map(([id, title]) => el('button', { type: 'button', id: `dic-tab-${id}`, class: 'dic-tab', role: 'tab', dataset: { tab: id }, 'aria-controls': 'dic-panel', 'aria-selected': String(id === current), tabIndex: id === current ? 0 : -1,
    textContent: title, onclick: () => select(id) })));
  tablist.addEventListener('keydown', e => {
    const ids = TABS.map(t => t[0]), i = ids.indexOf(current);
    const next = e.key === 'ArrowRight' ? ids[(i + 1) % ids.length] : e.key === 'ArrowLeft' ? ids[(i + ids.length - 1) % ids.length] : e.key === 'Home' ? ids[0] : e.key === 'End' ? ids.at(-1) : null;
    if (next) { e.preventDefault(); select(next, null, true); }
  });

  const head = el('section', { id: 'dic-head', class: 'card settings-card' },
    el('h3', { textContent: 'Ясная речь каждый день' }),
    el('p', { class: 'muted', textContent: 'Десять минут в день: дыхание, разминка, скороговорки, ударения и чтение вслух.' }),
    el('p', { id: 'dic-safety', class: 'dic-safety', textContent: SAFETY }));
  root.append(head, tablist, panel, host);
  select('today');

  return {
    root,
    // События пришли или поменялись. Пока открыто окно тренажёра, вкладку не перерисовываем, чтобы не сбить занятие.
    update(evs) { events = evs; if (!host.hidden) { dirty = true; return; } render(); },
    show() { events = store.state.events; if (host.hidden) render(); },
  };
}
