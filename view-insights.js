// Экран «Аналитика»: отклонения от личной нормы, подсказки, динамика, выгрузка данных.
import { el, toast, sparkline, dateRu } from './ui.js';
import { todayStr } from './events.js';
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
