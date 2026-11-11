// Экран «Тесты»: запуск ежедневной проверки (быстрой, полной, отдельных тестов), результаты и история.
import { el, toast, sparkline, dateRu } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { isNative } from './platform.js';
import { VERSION } from './version.js';
import { PLANS, singlePlan, TESTS, TEST_BY_ID, makeRun, makeRunEvent, runsOf, runId, fmtPrimary, fmtMetric, setEffort, EFFORT_LABEL } from './bt-core.js';
import { analyzeRuns, zText, zWord, selfCompare, bestResult } from './bt-analytics.js';
import { createRunner } from './bt-ui.js';
import { cardPool, statesOf } from './academy.js';
import { studyStreak } from './srs.js';

const MODE = { quick: 'Быстрая', full: 'Полная' };
const hhmm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function createTestsView() {
  let events = [];
  let running = false;
  let runner = null;
  const openRuns = new Set();
  const root = el('section', { id: 'view-tests', class: 'view' });
  const host = el('div', { id: 'bt-run', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Проверка' });
  const mount = (...nodes) => root.replaceChildren(...nodes.filter(Boolean), host);

  // «Против себя вчерашнего»: последний день с проверкой против предыдущего и против лучшего.
  function vsLine(today) {
    const c = selfCompare(events);
    if (!c) return null;
    const when = d => (d === today ? 'сегодня' : dateRu(d));
    const sign = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1).replace('.', ',')}σ`;
    const trend = Math.abs(c.diff) < 0.15 ? 'примерно как' : c.diff > 0 ? 'лучше, чем' : 'ниже, чем';
    return el('p', { class: 'muted', id: 'bt-vs', textContent: `С собой: ${when(c.last.date)} ${sign(c.last.value)} — ${trend} в прошлый раз (${when(c.prev.date)}, ${sign(c.prev.value)}).${c.isBest ? ' Это твой лучший день на сегодня!' : ` Лучший день: ${when(c.best.date)}, ${sign(c.best.value)}.`}` });
  }

  function render() {
    const runs = runsOf(events);
    const an = analyzeRuns(runs);
    const today = todayStr();
    const doneToday = runs.filter(r => r.date === today).length;
    const streak = studyStreak([...new Set(runs.map(r => r.date))], today);
    const head = el('div', { class: 'card', id: 'bt-head' },
      el('h3', { textContent: 'Ежедневная проверка' }),
      el('p', { id: 'bt-status', textContent: doneToday ? `Сегодня пройдено: ${doneToday}` : 'Сегодня ещё не проходил' }),
      el('p', { class: 'muted', id: 'bt-streak', textContent: streak ? `Дней подряд: ${streak}` : `Всего прохождений: ${runs.length}` }),
      el('button', { type: 'button', id: 'bt-quick', class: 'primary big-btn', textContent: `Быстрая проверка · ${PLANS.quick.about}`, onclick: () => start(PLANS.quick) }),
      el('button', { type: 'button', id: 'bt-full', textContent: `Полная проверка · ${PLANS.full.about}`, onclick: () => start(PLANS.full) }),
      el('p', { class: 'hint', textContent: 'Лучше проходить в тишине, примерно в одно и то же время и не торопиться: цель — сравнивать себя с собой.' }),
      vsLine(today));

    const list = TESTS.map(t => {
      const s = an.perTest[t.id];
      return el('div', { class: 'entry test-row', dataset: { test: t.id } },
        el('div', { class: 'grow' }, el('strong', { textContent: t.title }), el('div', { class: 'muted', textContent: t.desc }),
          s.latest ? el('div', { class: 'muted', textContent: `последний: ${fmtPrimary(t.id, { [t.primary.key]: s.latest.value / (t.primary.scale ?? 1) })}` }) : null,
          (() => { const b = bestResult(runs, t.id); return b && b.n >= 3 ? el('div', { class: 'muted test-record', textContent: `рекорд: ${fmtPrimary(t.id, { [t.primary.key]: b.value / (t.primary.scale ?? 1) })} (${dateRu(b.date)})` }) : null; })()),
        s.series.length > 1 ? sparkline(s.series.map(p => (t.primary.better === 'lower' ? -p.value : p.value)), { width: 70, height: 28 }) : null,
        el('button', { type: 'button', class: 'chip', id: `bt-single-${t.id}`, textContent: 'Пройти', onclick: () => start(singlePlan(t.id)) }));
    });

    const history = runs.slice(-10).reverse().map(r => {
      const a = an.perRun.find(x => x.startedAt === r.startedAt);
      const tests = Object.entries(r.tests);
      const d = el('details', { class: 'card run', dataset: { run: String(r.startedAt) }, open: openRuns.has(r.startedAt) },
        el('summary', {}, el('span', { textContent: `${dateRu(r.date)} ${hhmm(r.startedAt)} · ${MODE[r.mode] ?? 'Отдельный тест'}${r.aborted ? ' · прервано' : ''}` }),
          a?.composite != null ? el('span', { class: `badge ${a.composite >= 1 ? 'good' : a.composite <= -1 ? 'bad' : ''}`, textContent: zText(a.composite) }) : null),
        ...tests.map(([id, x]) => {
          const t = TEST_BY_ID[id];
          if (x.skipped) return el('p', { class: 'muted', textContent: `${t.title}: пропущено (${x.skipped})` });
          const all = Object.entries(t.metrics).filter(([k]) => x.metrics[k] !== undefined && x.metrics[k] !== null).map(([k, lab]) => `${lab}: ${fmtMetric(id, k, x.metrics[k])}`).join(' · ');
          return el('p', {}, el('strong', { textContent: `${t.title}: ${fmtPrimary(id, x.metrics)}` }), x.ok ? null : el('span', { class: 'warn', textContent: ` — не засчитано (${x.why})` }), el('br'), el('span', { class: 'muted', textContent: all }));
        }),
        r.effort ? el('p', { class: 'muted', textContent: `Было трудно: ${r.effort} из 5 (${EFFORT_LABEL[r.effort - 1]})` }) : null,
        r.state ? el('p', { class: 'muted', textContent: 'Самочувствие перед проверкой: ' + Object.entries(r.state).map(([k, v]) => `${k}=${v}`).join(', ') }) : null,
        el('button', { type: 'button', class: 'chip danger', textContent: 'Удалить прохождение', onclick: async () => { const old = await store.remove(runId(r.startedAt)); toast('Прохождение удалено', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }));
      d.addEventListener('toggle', () => { if (d.open) openRuns.add(r.startedAt); else openRuns.delete(r.startedAt); });
      return d;
    });
    mount(head, el('h2', { textContent: 'Отдельные тесты' }), el('div', { class: 'list' }, ...list),
      history.length ? el('h2', { textContent: 'История' }) : null, ...history,
      el('p', { class: 'muted', textContent: 'Это не медицинская диагностика и не IQ-тест. Результаты нужны, чтобы видеть свою динамику и находить связи со сном, нагрузкой и привычками.' }));
  }

  async function start(plan) {
    if (running) return;
    running = true;
    let keep = false;                                   // true, пока на экране итог: закрывает его кнопка «Готово»
    try {
      const pool = cardPool(events), byId = new Map(pool.map(c => [c.id, c]));
      const started = statesOf(events).filter(s => s.box >= 1).map(s => byId.get(s.card)).filter(Boolean);
      const recentWords = runsOf(events).slice(-5).flatMap(r => r.tests.words?.extra?.words ?? []);
      runner = createRunner(host, { history: { recentWords }, cards: { started, pool } });
      host.focus({ preventScroll: true });
      const out = await runner.runPlan(plan);
      if (!Object.keys(out.results).length) { runner.close(); toast(out.aborted ? 'Проверка прервана, результатов нет' : 'Результатов нет'); return; }
      const payload = makeRun({ mode: plan.id, startedAt: out.startedAt, durationMs: out.durationMs, state: out.state, results: out.results, aborted: out.aborted,
        env: { app: isNative ? 'app' : 'web', ver: VERSION, touch: (navigator.maxTouchPoints || 0) > 0, w: innerWidth, h: innerHeight, dpr: Math.round((devicePixelRatio || 1) * 100) / 100 } });
      await store.save(makeRunEvent(payload));
      keep = true;
      showResult(payload);
    } catch (e) {
      console.error(e);
      toast('Ошибка проверки: ' + (e.message || e));
      runner?.close();
    } finally {
      if (!keep) { running = false; runner = null; render(); }
    }
  }

  function showResult(payload) {
    const an = analyzeRuns(runsOf(store.state.events));
    const a = an.perRun.find(r => r.startedAt === payload.startedAt);
    const rows = TESTS.filter(t => payload.tests[t.id]).map(t => {
      const x = payload.tests[t.id];
      if (x.skipped) return el('div', { class: 'res-row' }, el('span', { textContent: t.title }), el('span', { class: 'muted', textContent: `пропущено: ${x.skipped}` }));
      const z = a?.z[t.id];
      const note = !x.ok ? `не засчитано: ${x.why}` : z == null ? 'норма копится' : `${zText(z)} · ${zWord(z)}`;
      return el('div', { class: 'res-row', dataset: { test: t.id } }, el('span', { textContent: t.title }), el('strong', { textContent: fmtPrimary(t.id, x.metrics) }),
        el('span', { class: `badge ${x.ok && z != null ? (z >= 1 ? 'good' : z <= -1 ? 'bad' : '') : ''}`, textContent: note }));
    });
    const comp = a?.composite;
    runner.show(
      el('div', { class: 'card', id: 'bt-result' },
        el('h3', { textContent: payload.aborted ? 'Проверка прервана — сохранено то, что прошёл' : 'Готово' }),
        comp != null ? el('p', { class: 'big', id: 'bt-composite', textContent: zWord(comp) }) : el('p', { class: 'muted', id: 'bt-composite', textContent: 'Личная норма накапливается: после 5–6 прохождений появится сравнение с самим собой.' }),
        comp != null ? el('p', { class: 'muted', textContent: `Общий результат ${zText(comp)} относительно твоей нормы` }) : null,
        ...rows,
        el('div', { id: 'bt-effort', class: 'effort' }, el('span', { class: 'muted', textContent: 'Насколько трудно было? (по желанию, попадёт в выгрузку)' }),
          el('div', { class: 'row wrap', role: 'group', 'aria-label': 'Усилие от 1 до 5' }, ...[1, 2, 3, 4, 5].map(v => el('button', { type: 'button', class: 'chip effort-btn', dataset: { v: String(v) }, 'aria-pressed': 'false', textContent: String(v), title: EFFORT_LABEL[v - 1],
            onclick: async e => {
              const ev = store.state.events.find(x => x.id === runId(payload.startedAt));
              if (!ev) return;
              try { await store.save(setEffort(ev, v)); for (const b of e.target.parentElement.children) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); } catch (x) { toast(x.message); }
            } }))))),
      el('button', { type: 'button', id: 'bt-done', class: 'primary big-btn', textContent: 'Готово', onclick: () => { runner.close(); runner = null; running = false; render(); } }));
  }

  return {
    root,
    update(evs) {
      events = evs;
      if (running && !evs.length && runner) { runner.abort(); return; }       // приложение заблокировано
      if (!running && !root.hidden) render();
    },
    show() { if (!running) render(); },
  };
}
