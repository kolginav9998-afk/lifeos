// Говорение вслух: таймер и тема, недельный счётчик минут. Голос не записывается: приложение только считает время.
// Практика речи (шэдоуинг, рассказ о своём дне) даёт больше, чем чтение: поэтому минуты говорения считаются отдельно.
import { el, toast } from './ui.js';
import { isYmd, addDays, todayStr, newId } from './events.js';
import * as store from './store.js';

export const SPEAK_LANGS = { english: 'Английский', hebrew: 'Иврит' };
export const SPEAK_WEEK_GOAL = 60;               // минут в неделю
export const MIN_SPEAK_SECONDS = 60;             // короче минуты не записываем
export const PRESETS = [5, 10, 15];
const RUN_KEY = 'lifeos.speak.run';

export const TOPICS = {
  english: [
    'Расскажи, что ты делал сегодня утром, по шагам.', 'Опиши свою работу: чем занимаешься и что нравится или не нравится.', 'Расскажи о своей семье или друзьях.',
    'Опиши свой дом или комнату, как будто показываешь её по видео.', 'Расскажи, что ты любишь есть и как это готовить.', 'Опиши, как ты добираешься до работы.',
    'Расскажи о планах на выходные.', 'Расскажи о последней поездке или о месте, куда хочешь поехать.', 'Опиши человека, которого уважаешь, и объясни почему.',
    'Расскажи о фильме, сериале или книге, которые недавно понравились.', 'Объясни, как пользоваться чем-то простым: чайником, телефоном, сканером на складе.', 'Расскажи, чему ты учишься сейчас и зачем это тебе.',
  ],
  hebrew: [
    'Представься: имя, возраст, откуда ты, чем занимаешься.', 'Назови пять предметов вокруг и скажи, какого они цвета.', 'Опиши свою семью простыми предложениями.',
    'Скажи, что ты ешь на завтрак, обед и ужин.', 'Назови дни недели и скажи, что делаешь в каждый из них.', 'Скажи, который час и что ты делаешь в это время.',
    'Закажи кофе в кафе: что хочешь и сколько это стоит.', 'Спроси дорогу до вокзала и поблагодари.', 'Опиши погоду сегодня и какая она была вчера.',
    'Скажи, что у тебя болит, как будто ты у врача.', 'Назови свои любимые занятия: что любишь и что не любишь.', 'Расскажи, что ты купил в магазине.',
  ],
};
// Тема дня: по дате, чтобы повторялась не сразу. Тот же день и язык дают ту же тему.
export function topicOfDay(lang, date, shift = 0) {
  const list = TOPICS[lang];
  if (!list) return '';
  const [y, m, d] = date.split('-').map(Number), n = Math.floor(Date.UTC(y, m - 1, d) / 86400000) + shift;
  return list[((n % list.length) + list.length) % list.length];
}

export function makeSpeak({ lang, seconds, topic = '', date } = {}, now = Date.now()) {
  if (!Object.hasOwn(SPEAK_LANGS, lang)) throw new Error('Выбери язык');
  const s = Math.round(Number(seconds));
  if (!Number.isFinite(s) || s < MIN_SPEAK_SECONDS) throw new Error('Меньше минуты не записывается');
  if (s > 4 * 3600) throw new Error('Слишком долго: до четырёх часов');
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('bad date');
  return { id: `speak:${newId()}`, type: 'speak', ts: now, payload: { date: d, lang, seconds: s, minutes: Math.max(1, Math.round(s / 60)), topic: String(topic ?? '').trim().slice(0, 200) }, source: 'manual', confidence: 1, evidence: [] };
}
export const speaksOf = events => events.filter(e => e.type === 'speak').sort((a, b) => b.payload.date.localeCompare(a.payload.date) || b.ts - a.ts);

// Последние 7 дней включая сегодня.
export function speakWeek(events, today) {
  const from = addDays(today, -6);
  const list = events.filter(e => e.type === 'speak' && e.payload.date >= from && e.payload.date <= today);
  const byLang = {};
  for (const e of list) byLang[e.payload.lang] = (byLang[e.payload.lang] || 0) + e.payload.minutes;
  const minutes = list.reduce((s, e) => s + e.payload.minutes, 0);
  return { minutes, sessions: list.length, days: new Set(list.map(e => e.payload.date)).size, byLang, goal: SPEAK_WEEK_GOAL, ratio: Math.min(1, minutes / SPEAK_WEEK_GOAL) };
}

// Сколько прошло и осталось (по часам, а не по тикам: в фоне тики замедляются).
export const speakLeft = (run, now = Date.now()) => {
  const left = run.startedAt + run.minutes * 60000 - now;
  return { leftMs: Math.max(0, left), done: left <= 0, elapsedSec: Math.max(0, Math.min(run.minutes * 60, Math.floor((now - run.startedAt) / 1000))) };
};
const fmtClock = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const readRun = () => { try { const r = JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); return r && Number.isFinite(r.startedAt) && r.minutes > 0 && Object.hasOwn(SPEAK_LANGS, r.lang) ? r : null; } catch { return null; } };
const writeRun = r => { try { if (r) localStorage.setItem(RUN_KEY, JSON.stringify(r)); else localStorage.removeItem(RUN_KEY); } catch { /* не критично */ } };
export const hasRunningSpeak = () => !!readRun();

// Окно упражнения. host — полноэкранный контейнер (.overlay). Тему и язык в хранилище не кладём, кроме языка и длины.
export function openSpeaking(host, { lang = 'english', resume = false } = {}) {
  host.hidden = false; host.tabIndex = -1;
  let timer = null, run = null, shift = 0, minutes = 10, language = lang;
  const topic = () => topicOfDay(language, todayStr(), shift);
  const close = () => { clearTimeout(timer); host.hidden = true; host.replaceChildren(); };

  function intro() {
    const topicEl = el('p', { id: 'speak-topic', class: 'speak-topic', textContent: topic() });
    const langBtns = Object.entries(SPEAK_LANGS).map(([k, name]) => el('button', { type: 'button', class: 'chip speak-lang', dataset: { lang: k }, 'aria-pressed': String(k === language), textContent: name, onclick: () => { language = k; shift = 0; paint(); } }));
    const minBtns = PRESETS.map(m => el('button', { type: 'button', class: 'chip speak-min', dataset: { min: String(m) }, 'aria-pressed': String(m === minutes), textContent: `${m} мин`, onclick: () => { minutes = m; paint(); } }));
    function paint() {
      topicEl.textContent = topic();
      for (const b of langBtns) b.setAttribute('aria-pressed', String(b.dataset.lang === language));
      for (const b of minBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.min) === minutes));
    }
    host.replaceChildren(
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: 'Говорение вслух' }), el('button', { type: 'button', id: 'speak-close', class: 'link', textContent: 'Закрыть', onclick: close })),
      el('div', { class: 'card bt-intro' },
        el('p', { textContent: 'Говори вслух, даже если ошибаешься: так язык «включается» быстрее, чем от чтения. Голос не записывается, приложение только считает время.' }),
        el('div', { class: 'row wrap' }, ...langBtns), el('div', { class: 'row wrap' }, ...minBtns),
        el('p', { class: 'muted', textContent: 'Тема:' }), topicEl,
        el('button', { type: 'button', id: 'speak-other', class: 'chip', textContent: 'Другая тема', onclick: () => { shift += 1; paint(); } }),
        el('button', { type: 'button', id: 'speak-go', class: 'primary big-btn', textContent: 'Начать', onclick: () => start() })));
  }
  function start() { run = { startedAt: Date.now(), minutes, lang: language, topic: topic() }; writeRun(run); show(); }
  function show() {
    const clock = el('div', { class: 'bt-problem focus-clock', id: 'speak-clock' });
    host.replaceChildren(
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: `${SPEAK_LANGS[run.lang]} · ${run.minutes} мин` }), el('button', { type: 'button', id: 'speak-stop', class: 'link', textContent: 'Закончить', onclick: () => finish() })),
      el('div', { class: 'bt-stage' }, clock, el('p', { class: 'speak-topic', textContent: run.topic }), el('p', { class: 'muted', textContent: 'Говори без остановки. Не знаешь слово: объясни другими словами.' })));
    tick();
  }
  function tick() {
    const f = speakLeft(run);
    const c = host.querySelector('#speak-clock'); if (!c) return;
    c.textContent = fmtClock(f.leftMs);
    if (f.done) return finish();
    timer = setTimeout(tick, 500);
  }
  async function finish() {
    clearTimeout(timer);
    const f = speakLeft(run);
    if (f.elapsedSec < MIN_SPEAK_SECONDS) { writeRun(null); toast('Меньше минуты не записываю'); close(); return; }
    try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(f.done ? [200, 100, 200] : 0); } catch { /* не везде есть; без касания браузер вибрацию блокирует */ }
    const ok = await store.save(makeSpeak({ lang: run.lang, seconds: f.elapsedSec, topic: run.topic, date: todayStr(run.startedAt) }));
    if (!ok) { close(); return; }
    writeRun(null);
    host.replaceChildren(el('div', { class: 'card bt-intro' }, el('h3', { id: 'speak-result', textContent: 'Записано' }),
      el('p', { textContent: `Говорил ${Math.max(1, Math.round(f.elapsedSec / 60))} мин. Каждая такая минута приближает тебя к свободной речи.` }),
      el('button', { type: 'button', id: 'speak-done', class: 'primary big-btn', textContent: 'Ок', onclick: close })));
  }

  const saved = resume ? readRun() : null;
  if (saved) { run = saved; language = saved.lang; show(); } else intro();
  return { close };
}
