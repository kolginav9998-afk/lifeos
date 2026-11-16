// Мастер графика: готовый график или свой цикл, дата начала цикла, предпросмотр на две недели. Дочерний блок экрана «График».
import { el, fill, toast, announce, focusNode } from './ui.js';
import { todayStr, addDays } from './events.js';
import * as store from './store.js';
import { TEMPLATES, templateById, cfgFromTemplate, makeWorkcfg, normalizeCfg, cfgOf, cfgEvent, dayPlan, shiftOf, WEEKDAYS_SHORT, WEEKDAYS_LONG, dowMon } from './schedule.js';

export function createWizard({ events }) {
  let tid = 'w52', steps = ['d', 'd', ''], week = [true, true, true, true, true, false, false], start = todayStr(), base = null;
  const host = el('div', { id: 'sch-wiz', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sch-wiz-title' });
  const title = el('h3', { id: 'sch-wiz-title', tabIndex: -1, textContent: 'Выбери график' });
  const tplBtns = TEMPLATES.map(t => el('button', { type: 'button', class: 'work-tpl', dataset: { tpl: t.tid }, onclick: () => { tid = t.tid; paint(); announce(`${t.title}. ${t.about}`); } },
    el('strong', { textContent: t.title }), el('span', { class: 'muted', textContent: t.about })));
  const startIn = el('input', { id: 'sch-wiz-start', type: 'date', value: start, onchange: () => { start = startIn.value || todayStr(); paint(); } });
  const startBox = el('label', { class: 'work-f' }, el('span', { class: 'muted', textContent: 'Дата первого дня цикла (например, твой первый рабочий день)' }), startIn);
  const weekBtns = WEEKDAYS_SHORT.map((w, i) => el('button', { type: 'button', class: 'chip', textContent: w, 'aria-label': `${w} (${WEEKDAYS_LONG[i]}): рабочий день`, onclick: () => { week[i] = !week[i]; paint(); announce(`${WEEKDAYS_LONG[i]}: ${week[i] ? 'рабочий' : 'выходной'}`); } }));
  const weekBox = el('div', { class: 'form-stack' }, el('strong', { textContent: 'Рабочие дни недели' }), el('div', { class: 'chips', role: 'group', 'aria-label': 'Рабочие дни недели' }, ...weekBtns));
  const stepList = el('ol', { id: 'sch-wiz-steps', class: 'work-steps', 'aria-label': 'Порядок дней в цикле' }), adders = el('div', { class: 'chips', role: 'group', 'aria-label': 'Добавить день в цикл' });
  const cycleBox = el('div', { class: 'form-stack' }, el('strong', { textContent: 'Порядок дней в цикле' }), stepList, adders);
  const strip = el('p', { id: 'sch-wiz-strip', class: 'work-strip' }), err = el('p', { id: 'sch-wiz-err', class: 'error' });
  const apply = el('button', { type: 'submit', id: 'sch-wiz-apply', class: 'primary', textContent: 'Применить график' });
  const form = el('form', { id: 'sch-wiz-form', class: 'form-stack' }, el('div', { id: 'sch-wiz-tpls', class: 'work-tpls', role: 'group', 'aria-label': 'Готовые графики' }, ...tplBtns), startBox, weekBox, cycleBox,
    el('strong', { textContent: 'Как это будет выглядеть в ближайшие две недели' }), strip, err,
    el('div', { class: 'row' }, apply, el('button', { type: 'button', id: 'sch-wiz-close', textContent: 'Закрыть', onclick: () => { host.hidden = true; } })));
  host.append(title, el('p', { class: 'muted', textContent: 'Выбери, как устроены твои рабочие дни. Любой день потом можно поменять отдельно: отпуск, больничный, замену.' }), form);

  const shifts = () => (base?.shifts?.length && (tid === 'cus' || tid === 'wcu') ? base.shifts : templateById(tid).shifts);
  const firstKey = () => shifts().find(s => !s.off)?.key ?? 'd';
  function raw() {
    const r = cfgFromTemplate(tid, start, base);
    if (tid === 'cus') return { ...r, shifts: shifts(), pattern: { kind: 'cycle', cycle: steps, start } };
    if (tid === 'wcu') return { ...r, shifts: shifts(), pattern: { kind: 'week', week: week.map(on => (on ? firstKey() : '')) } };
    return r;
  }
  const stepName = k => (k ? `${shiftOf({ shifts: shifts() }, k)?.letter ?? k}` : 'вых');
  function paint() {
    for (const b of tplBtns) b.setAttribute('aria-pressed', String(b.dataset.tpl === tid));
    const t = templateById(tid), cyc = t.pattern.kind === 'cycle';
    startBox.hidden = !cyc; weekBox.hidden = tid !== 'wcu'; cycleBox.hidden = tid !== 'cus';
    weekBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(week[i])));
    fill(stepList, steps.map((k, i) => el('li', { class: 'chip static', textContent: stepName(k), 'aria-label': `День ${i + 1}: ${k ? shiftOf({ shifts: shifts() }, k)?.name : 'выходной'}` })));
    try {
      const c = normalizeCfg(raw()), today = todayStr();
      fill(strip, Array.from({ length: 14 }, (_, i) => { const d = addDays(today, i), p = dayPlan(d, c, null); return el('span', { class: `chip static${p.kind === 'work' ? ` sc${p.color}` : ''}`, textContent: `${WEEKDAYS_SHORT[dowMon(d)]} ${+d.slice(8)}: ${p.letter || 'раб'}` }); }));
    } catch { fill(strip); }
    err.textContent = '';
  }
  const add = (k, label) => el('button', { type: 'button', class: 'chip', textContent: label, onclick: () => { if (steps.length < 60) steps = [...steps, k]; paint(); announce(`Добавлено: ${label}`); } });
  function buildAdders() {
    fill(adders, shifts().filter(s => !s.off).map(s => add(s.key, `Добавить: ${s.letter} ${s.name}`)), shifts().filter(s => s.off).map(s => add(s.key, `Добавить: ${s.name}`)), add('', 'Добавить: выходной'),
      el('button', { type: 'button', class: 'chip', textContent: 'Убрать последний', onclick: () => { steps = steps.slice(0, -1); paint(); } }),
      el('button', { type: 'button', class: 'chip', textContent: 'Начать заново', onclick: () => { steps = []; paint(); } }));
  }
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      if (tid === 'cus' && !steps.length) throw new Error('Добавь в цикл хотя бы один день');
      if (tid === 'wcu' && !week.some(Boolean)) throw new Error('Отметь хотя бы один рабочий день недели');
      const ev = makeWorkcfg(raw(), cfgEvent(events()));
      host.hidden = true;
      await store.save(ev); toast('График сохранён'); announce('График сохранён');
    } catch (x) { err.textContent = x.message; announce(x.message, { assertive: true }); }
  };
  return {
    root: host,
    open() {
      base = cfgOf(events()); start = todayStr();
      if (base) {
        tid = TEMPLATES.some(t => t.tid === base.tplId) ? base.tplId : base.pattern.kind === 'week' ? 'wcu' : 'cus';
        if (base.pattern.kind === 'cycle') { start = base.pattern.start; steps = [...base.pattern.cycle]; } else week = base.pattern.week.map(Boolean);
        if (tid === 'cus' && !steps.length) steps = ['d', 'd', ''];
      } else tid = 'w52';
      startIn.value = start; buildAdders(); paint(); host.hidden = false; focusNode(title);
    },
  };
}
