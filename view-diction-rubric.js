// Вкладка «Оценка»: самооценка речи по шести пунктам (1–5), динамика со значком-графиком, слабые группы звуков и история.
import { el, fill, toast, announce, ratingRow, sparkline, dateRu } from './ui.js';
import { RUBRIC, RUBRIC_IDS, SOUND_GROUPS, makeSelf, selfOf, selfTrend, scoreAverage, fmtNum, weakGroups } from './diction.js';

const titleOf = id => RUBRIC.find(r => r.id === id).title;
const arrow = d => (d > 0 ? `выросла на ${d}` : d < 0 ? `снизилась на ${-d}` : 'без изменений');

export function createRubricTab(k) {
  let scores = {}, note = '', weak = null;                 // черновик живёт, пока открыт экран: перерисовка из-за синхронизации его не сбрасывает

  function render(panel) {
    const events = k.events, today = k.today();
    if (weak === null) weak = weakGroups(events, today, k.pref('weak', []));
    const trend = selfTrend(events);
    const rows = RUBRIC.map(r => {
      const row = ratingRow(r.title, r.id, scores[r.id] ?? null, v => { if (v) scores[r.id] = v; else delete scores[r.id]; saveBtn.disabled = RUBRIC_IDS.some(id => !scores[id]); });
      return el('div', { class: 'dic-rubric-row', dataset: { id: r.id } }, row, el('p', { class: 'muted dic-ask', textContent: `${r.ask} 1 — ${r.low}; 5 — ${r.high}.` }));
    });
    const noteBox = el('textarea', { id: 'dic-self-note', rows: 2, maxLength: 300, placeholder: 'Заметка (по желанию): что получилось, что хочу улучшить', 'aria-label': 'Заметка к оценке' });
    noteBox.value = note; noteBox.oninput = () => { note = noteBox.value; };
    const weakChips = el('div', { id: 'dic-self-weak', class: 'chips', role: 'group', 'aria-label': 'Слабые группы звуков' }, ...SOUND_GROUPS.map(g => el('button', { type: 'button', class: 'chip dic-weak', dataset: { group: g.id }, 'aria-pressed': String(weak.includes(g.id)), textContent: g.title,
      onclick: () => { weak = weak.includes(g.id) ? weak.filter(x => x !== g.id) : [...weak, g.id]; chipRefresh(); } })));
    const chipRefresh = () => { for (const b of weakChips.children) b.setAttribute('aria-pressed', String(weak.includes(b.dataset.group))); };
    const saveBtn = el('button', { type: 'button', id: 'dic-self-save', class: 'primary big-btn', textContent: 'Сохранить оценку', disabled: RUBRIC_IDS.some(id => !scores[id]), onclick: async () => {
      let ev;
      try { ev = makeSelf({ scores, note, weak, date: today }); } catch (e) { toast(e.message); return; }
      saveBtn.disabled = true;
      scores = {}; note = '';                                  // состояние сбрасываем ДО сохранения: оно перерисует экран
      k.setPref('weak', weak);
      await k.save(ev);
      k.done(`Оценка сохранена: средний балл ${fmtNum(scoreAverage(ev.payload.scores))}`);
    } });

    fill(panel,
      el('div', { class: 'card' },
        el('h3', { textContent: 'Самооценка речи' }),
        el('p', { class: 'muted', textContent: 'Запиши минуту своей речи другой программой, послушай и оцени шесть пунктов от 1 до 5. Оценивай по записи, а не по ощущениям. Повторяй раз в одну-две недели.' }),
        ...rows, noteBox,
        el('h3', { textContent: 'Слабые звуки' }), weakChips, saveBtn),
      trend ? result(trend) : el('div', { class: 'card', id: 'dic-self-empty' }, el('strong', { textContent: 'Пока нет оценок' }), el('p', { class: 'muted', textContent: 'Первая оценка станет отправной точкой: с ней ты сравнишь результат через пару недель.' })),
      trend ? history(events) : null);
  }

  function result(t) {
    const avgs = t.avgs, last = avgs.at(-1);
    const dir = t.direction === 'none' ? 'Это отправная точка. Следующую оценку сделай через одну-две недели.' : t.direction === 'up' ? `Средний балл вырос на ${fmtNum(t.overallDelta)} по сравнению с прошлой оценкой.` : t.direction === 'down' ? `Средний балл снизился на ${fmtNum(-t.overallDelta)}. Это бывает: сравни по записи и вернись к слабому пункту.` : 'Средний балл не изменился.';
    const spark = avgs.length > 1 ? sparkline(avgs.map(a => a.avg), { width: 220, height: 48 }) : null;
    if (spark) spark.setAttribute('aria-label', `Средний балл по датам: ${avgs.map(a => fmtNum(a.avg)).join(', ')}`);
    return el('div', { class: 'card', id: 'dic-self-result' },
      el('h3', { textContent: 'Результат' }),
      el('p', {}, el('span', { class: 'dic-num', id: 'dic-self-avg', textContent: fmtNum(last.avg) }), el('span', { class: 'muted', textContent: ` из 5, ${dateRu(last.date)}` })),
      el('p', { id: 'dic-self-dir', textContent: dir }),
      spark,
      el('ul', { class: 'plain', id: 'dic-self-delta' }, ...RUBRIC_IDS.map(id => el('li', { textContent: `${titleOf(id)}: ${t.latest.scores[id]} из 5${t.deltaPrev ? `, ${arrow(t.deltaPrev[id])}` : ''}` }))),
      el('p', { id: 'dic-self-focus', class: 'muted', textContent: `Слабее всего: ${titleOf(t.weakest)}. Сильнее всего: ${titleOf(t.strongest)}.` }));
  }

  function history(events) {
    const list = selfOf(events).slice(-6).reverse();
    return el('div', { class: 'card', id: 'dic-self-history' }, el('h3', { textContent: 'История оценок' }),
      el('ul', { class: 'list' }, ...list.map(e => el('li', { class: 'entry dic-hist' }, el('div', { class: 'grow' }, el('strong', { textContent: `${dateRu(e.payload.date)}: ${fmtNum(scoreAverage(e.payload.scores))} из 5` }), e.payload.note ? el('div', { class: 'muted', textContent: e.payload.note }) : null),
        el('button', { type: 'button', class: 'chip danger dic-del', dataset: { id: e.id }, 'aria-label': `Удалить оценку от ${dateRu(e.payload.date)}`, textContent: 'Удалить',
          onclick: async () => { const old = await k.remove(e.id); toast('Оценка удалена', old ? { actionLabel: 'Вернуть', onAction: () => k.save(old) } : {}); announce('Оценка удалена'); } })))));
  }
  return { render };
}
