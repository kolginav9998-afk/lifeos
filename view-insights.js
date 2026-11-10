// Экран «Аналитика»: отклонения от личной нормы, подсказки, динамика, выгрузка данных.
import { el, toast, sparkline, dateRu } from './ui.js';
import { todayStr, daysBetween } from './events.js';
import * as store from './store.js';
import { METRICS, PRESETS, SAFETY, DAYS_OPTIONS, makeExperiment, experimentsOf, phaseOf, stateOf, endDate, evaluate } from './experiments.js';
import { saveBinaryFile, saveTextFile } from './platform.js';
import { TESTS, DOMAINS, runsOf, fmtPrimary, fmtNum } from './bt-core.js';
import { analyzeRuns, insights, dailyRows, zText, zWord } from './bt-analytics.js';
import { buildExport, toCsvExcel, buildTables } from './bt-export.js';

const CONF = { low: 'предварительно', mid: 'вероятно', high: 'устойчиво' };

// Сводка для вставки в чат с ИИ: только числа и выводы, без текстов дневника.
export function aiSummary(events, now = Date.now()) {
  const runs = runsOf(events), an = analyzeRuns(runs);
  const rows = dailyRows(events, runs, an).slice(-30);
  const f = v => (v === null || v === undefined ? '' : String(Math.round(v * 100) / 100));
  const lines = [
    'Ниже — мои личные данные из приложения Life OS за последние дни (без текстов дневника). Цель: найти закономерности и предложить 3 эксперимента на 2 недели.',
    'z — отклонение от моей же нормы в σ (плюс — лучше обычного). composite — общий результат ежедневных проверок. Не ставь диагнозов, отмечай, где данных мало.',
    '', `Прохождений проверок: ${runs.length}. Сегодня: ${todayStr(now)}.`, '',
    ['date', 'sleepHours', 'sleepQuality', 'moodMorning', 'moodEvening', 'energyEvening', 'stressEvening', 'caffeine', 'exercise', 'screen', 'composite_z'].join(','),
    ...rows.map(r => [r.date, r.sleepHours, r.sleepQuality, r.moodMorning, r.moodEvening, r.energyEvening, r.stressEvening, r.caffeine, r.exercise, r.screen, r.composite].map(f).join(',')),
    '', 'Уже найденные подсказки приложения:', ...insights(events, now).map(i => `- ${i.title}: ${i.text}`),
  ];
  return lines.join('\n');
}

export function createInsightsView() {
  let events = [];
  const root = el('section', { id: 'view-insights', class: 'view' });

  // ----- форма нового эксперимента (создаётся один раз, чтобы введённое не терялось при обновлении данных) -----
  const preset = el('select', { id: 'exp-preset', 'aria-label': 'Готовый эксперимент' }, el('option', { value: '', textContent: 'Свой эксперимент' }), ...PRESETS.map(p => el('option', { value: p.id, textContent: p.title })));
  const eTitle = el('input', { id: 'exp-title', type: 'text', maxLength: 100, placeholder: 'Название', autocomplete: 'off' });
  const eChange = el('textarea', { id: 'exp-change', rows: 2, maxLength: 300, placeholder: 'Что именно меняется в фазе B?' });
  const eMetric = el('select', { id: 'exp-metric', 'aria-label': 'Показатель' }, ...Object.entries(METRICS).map(([k, m]) => el('option', { value: k, textContent: m.label })));
  const eDays = el('select', { id: 'exp-days', 'aria-label': 'Длительность' }, ...DAYS_OPTIONS.map(d => el('option', { value: String(d), textContent: `${d} дней (по неделе A и B)` })));
  const eStart = el('input', { id: 'exp-date', type: 'date', value: todayStr() });
  const eErr = el('p', { class: 'error', id: 'exp-err' });
  preset.onchange = () => { const p = PRESETS.find(x => x.id === preset.value); if (p) { eTitle.value = p.title; eChange.value = p.change; eMetric.value = p.metric; eDays.value = String(p.days); } };
  const startExp = async () => {
    try {
      const ev = makeExperiment({ title: eTitle.value, change: eChange.value, metric: eMetric.value, days: Number(eDays.value), startDate: eStart.value });
      await store.save(ev);
      eErr.textContent = ''; eTitle.value = ''; eChange.value = ''; preset.value = '';
      const ph = phaseOf(ev.payload, todayStr());
      toast(ph ? `Эксперимент начат. Сегодня фаза ${ph}.` : 'Эксперимент запланирован');
    } catch (e) { eErr.textContent = e.message; }
  };
  const expForm = el('details', { class: 'card', id: 'exp-new' }, el('summary', { textContent: 'Новый эксперимент' }),
    el('div', { class: 'form-stack' }, preset, eTitle, eChange, el('label', {}, 'Что сравниваем: ', eMetric), el('label', {}, 'Срок: ', eDays), el('label', {}, 'Начало: ', eStart),
      el('p', { class: 'warn', textContent: SAFETY }),
      el('p', { class: 'muted', textContent: 'Две фазы по неделе в случайном порядке: A — живёшь как обычно, B — вносишь изменение. Показатель берётся из отметок дня или проверок: чем регулярнее данные, тем точнее вывод.' }),
      el('button', { type: 'button', id: 'exp-start', class: 'primary', textContent: 'Начать эксперимент', onclick: startExp }), eErr));

  function experimentNodes(rows) {
    const today = todayStr();
    return experimentsOf(events).map(e => {
      const p = e.payload, st = stateOf(p, today), m = METRICS[p.metric];
      const head = el('strong', { textContent: p.title });
      const lines = [];
      if (st === 'active') {
        const ph = phaseOf(p, today), day = daysBetween(p.startDate, today) + 1;
        lines.push(el('p', { class: 'big', id: `exp-phase-${e.id}`, textContent: ph === 'B' ? `Сегодня фаза B: ${p.change}` : 'Сегодня фаза A: живи как обычно' }));
        lines.push(el('p', { class: 'muted', textContent: `День ${day} из ${p.days} · показатель: ${m.label} (${m.source})` }));
        const r = evaluate(p, rows, today);
        if (r.verdict === 'insufficient') lines.push(el('p', { class: 'muted', textContent: r.text }));
      } else if (st === 'planned') lines.push(el('p', { class: 'muted', textContent: `Начнётся ${dateRu(p.startDate)}` }));
      else {
        lines.push(el('p', { class: 'muted', textContent: `${st === 'cancelled' ? 'Остановлен' : 'Завершён'} · ${dateRu(p.startDate)} — ${dateRu(endDate(p))} · показатель: ${m.label}` }));
        lines.push(el('p', { class: 'exp-result', textContent: evaluate(p, rows, st === 'ended' ? endDate(p) : today).text }));
      }
      const btns = [];
      if (st === 'active' || st === 'planned') btns.push(el('button', { type: 'button', class: 'chip', dataset: { stop: e.id }, textContent: 'Остановить', onclick: () => store.save({ ...e, payload: { ...p, cancelled: true } }) }));
      btns.push(el('button', { type: 'button', class: 'chip danger', textContent: 'Удалить', onclick: async () => { const old = await store.remove(e.id); toast('Эксперимент удалён', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }));
      return el('div', { class: `card exp ${st}`, dataset: { id: e.id, state: st } }, head, ...lines, el('div', { class: 'row' }, ...btns));
    });
  }

  const zRow = (label, z) => {
    const pct = Math.max(-100, Math.min(100, (z / 3) * 100));
    return el('div', { class: 'zrow' }, el('span', { class: 'zl', textContent: label }),
      el('span', { class: 'zbar', role: 'img', 'aria-label': `${label}: ${zText(z)}` }, el('span', { class: `zfill ${z >= 0 ? 'pos' : 'neg'}`, style: `${z >= 0 ? 'left:50%' : `right:50%`};width:${Math.abs(pct) / 2}%` })),
      el('span', { class: 'zv', textContent: zText(z) }));
  };

  function render() {
    const runs = runsOf(events);
    const an = analyzeRuns(runs);
    const last = [...an.perRun].reverse().find(r => Object.keys(r.domains).length) ?? null;      // последняя проверка, по которой уже есть сравнение с нормой
    const days = new Set(runs.map(r => r.date)).size;
    const parts = [];
    parts.push(el('div', { class: 'card', id: 'ins-head' }, el('h3', { textContent: 'Аналитика' }),
      el('p', { id: 'ins-count', textContent: `Прохождений: ${runs.length} за ${days} дн.` }),
      el('p', { class: 'muted', textContent: 'Всё сравнивается только с твоей собственной нормой. Выводы — наблюдения, а не диагнозы и не доказанные причины.' })));

    if (last && Object.keys(last.domains).length) {
      parts.push(el('div', { class: 'card', id: 'ins-domains' }, el('h3', { textContent: `Проверка ${dateRu(last.date)} против нормы` }),
        ...Object.entries(last.domains).sort((a, b) => a[1] - b[1]).map(([d, z]) => zRow(DOMAINS[d], z)),
        last.composite != null ? el('p', { class: 'muted', textContent: `Итого: ${zWord(last.composite)} (${zText(last.composite)})` }) : null));
    }

    const list = insights(events);
    parts.push(el('h2', { textContent: 'Подсказки' }), ...list.map(i => el('div', { class: `card insight ${i.kind}`, dataset: { id: i.id } },
      el('strong', { textContent: i.title }), el('p', { textContent: i.text }), el('span', { class: 'chip static', textContent: CONF[i.conf] ?? '' }))));

    const withData = TESTS.filter(t => an.perTest[t.id].series.length);
    if (withData.length) {
      parts.push(el('h2', { textContent: 'Динамика по тестам' }), el('div', { class: 'list' }, ...withData.map(t => {
        const s = an.perTest[t.id];
        return el('div', { class: 'entry', dataset: { test: t.id } },
          el('div', { class: 'grow' }, el('strong', { textContent: t.title }), el('div', { class: 'muted', textContent: `${t.primary.label}: ${fmtPrimary(t.id, { [t.primary.key]: s.latest.value / (t.primary.scale ?? 1) })}` + (s.baseline ? ` · норма ${fmtNum(s.baseline.median, t.primary.digits)}` : '') + ` · замеров ${s.n}` })),
          s.series.length > 1 ? sparkline(s.series.map(p => (t.primary.better === 'lower' ? -p.value : p.value)), { width: 96, height: 32 }) : null);
      })));
    }

    parts.push(el('h2', { textContent: 'Эксперименты' }), expForm, ...experimentNodes(dailyRows(events, runs, an)));

    parts.push(el('h2', { textContent: 'Выгрузка для анализа' }), el('div', { class: 'card' },
      el('p', { class: 'muted', textContent: 'ZIP с таблицами CSV: дни, все проходы, все метрики и пробы, отметки, замеры, привычки, обучение. Тексты дневника, заметки и деньги не входят.' }),
      el('div', { class: 'form-stack' },
        el('button', { type: 'button', id: 'ins-zip', class: 'primary', textContent: 'Скачать ZIP для аналитики', onclick: exportZip }),
        el('button', { type: 'button', id: 'ins-excel', textContent: 'Таблица по дням для Excel (CSV)', onclick: exportExcel }),
        el('button', { type: 'button', id: 'ins-copy', textContent: 'Скопировать сводку для ИИ-ассистента', onclick: copySummary }),
        el('p', { class: 'muted', textContent: 'Сводка содержит оценки самочувствия и результаты проверок. Отправляй её в чат с ИИ только если готов поделиться этими данными.' }))));
    root.replaceChildren(...parts);
  }

  async function exportZip() {
    try {
      const { zip } = buildExport(events);
      const r = await saveBinaryFile(`lifeos-analytics-${todayStr()}.zip`, zip, 'application/zip');
      toast(r === 'share' ? 'Выбери, куда сохранить файл' : 'Файл скачан');
    } catch (e) { toast('Не удалось выгрузить: ' + (e.message || e)); }
  }
  async function exportExcel() {
    try {
      const { T } = buildTables(events);
      await saveTextFile(`lifeos-daily-${todayStr()}.csv`, toCsvExcel(T.daily.cols, T.daily.rows), 'text/csv');
      toast('Таблица готова');
    } catch (e) { toast('Не удалось выгрузить: ' + (e.message || e)); }
  }
  async function copySummary() {
    const text = aiSummary(events);
    try { await navigator.clipboard.writeText(text); toast('Сводка скопирована. Вставь её в чат с ИИ.'); }
    catch {
      const ta = el('textarea', { value: text, readOnly: true }); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast('Сводка скопирована. Вставь её в чат с ИИ.'); } catch { toast('Не удалось скопировать'); }
      ta.remove();
    }
  }

  return { root, update(evs) { events = evs; render(); }, show() { render(); } };
}
