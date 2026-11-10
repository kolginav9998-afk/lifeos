import { el, toast, dateRu, sparkline } from './ui.js';
import { todayStr } from './events.js';
import { makeProfile } from './events.js';
import { MEASURES, makeMeasure, updateMeasure, measureKeys, measuresOf, dailySeries, linearTrend, changeOver, bmi, whtr, bmiNote, whtrNote,
  sleepStats, bpAverage, healthProfile, checkHealthProfile, formatMeasure, measureLabel, ageFromBirthYear, measuresToCsv } from './health.js';
import { saveTextFile } from './platform.js';
import * as store from './store.js';

const num = x => String(Math.round(x * 100) / 100).replace('.', ',');
const signed = x => (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x));

export function createHealthView() {
  let events = [];
  let editing = null;
  const openKeys = new Set();           // раскрытые списки записей не сворачиваются при обновлении
  const root = el('section', { id: 'view-health', class: 'view' });

  // ----- сводка -----
  const summary = el('div', { id: 'health-summary', class: 'card' });

  // ----- профиль здоровья -----
  const hp = { h: el('input', { id: 'hp-height', type: 'text', inputMode: 'decimal', placeholder: 'Рост, см', autocomplete: 'off' }),
    b: el('input', { id: 'hp-birth', type: 'text', inputMode: 'numeric', placeholder: 'Год рождения', autocomplete: 'off' }),
    s: el('select', { id: 'hp-sex' }, ...[['', 'Пол не указан'], ['m', 'Мужской'], ['f', 'Женский']].map(([v, t]) => el('option', { value: v, textContent: t }))),
    z: el('input', { id: 'hp-sleep', type: 'text', inputMode: 'decimal', placeholder: 'Цель сна, ч (8)', autocomplete: 'off' }),
    g: el('input', { id: 'hp-goal', type: 'text', inputMode: 'decimal', placeholder: 'Целевой вес, кг', autocomplete: 'off' }) };
  const hpSave = el('button', { id: 'hp-save', type: 'submit', textContent: 'Сохранить' });
  const hpForm = el('form', { id: 'hp-form', class: 'form-stack' }, el('p', { class: 'muted', textContent: 'Нужны для расчёта ориентиров (ИМТ, талия к росту) и цели сна. Хранятся только у тебя.' }), hp.h, hp.b, hp.s, hp.z, hp.g, hpSave);
  hpForm.onsubmit = async e => {
    e.preventDefault();
    try {
      const f = checkHealthProfile({ heightCm: hp.h.value, birthYear: hp.b.value, sex: hp.s.value, sleepTarget: hp.z.value, goalWeight: hp.g.value });
      const prev = events.find(x => x.type === 'profile' && x.id === 'profile');
      await store.save(makeProfile(prev?.payload.name ?? '', Date.now(), prev, f));
      toast('Сохранено');
    } catch (err) { toast(err.message); }
  };
  const hpBox = el('details', { id: 'hp-box', class: 'card' }, el('summary', { textContent: 'Профиль здоровья' }), hpForm);

  // ----- добавление замера -----
  const kind = el('select', { id: 'ms-kind' }, ...Object.entries(MEASURES).map(([k, m]) => el('option', { value: k, textContent: m.label })));
  const value = el('input', { id: 'ms-value', type: 'text', inputMode: 'decimal', placeholder: 'Значение', autocomplete: 'off', required: true });
  const value2 = el('input', { id: 'ms-value2', type: 'text', inputMode: 'decimal', placeholder: 'Нижнее', autocomplete: 'off', hidden: true });
  const cname = el('input', { id: 'ms-name', type: 'text', placeholder: 'Название показателя', maxLength: 40, autocomplete: 'off', hidden: true });
  const cunit = el('input', { id: 'ms-unit', type: 'text', placeholder: 'Единицы', maxLength: 20, autocomplete: 'off', hidden: true });
  const date = el('input', { id: 'ms-date', type: 'date', value: todayStr() });
  const time = el('input', { id: 'ms-time', type: 'time' });
  const note = el('input', { id: 'ms-note', type: 'text', placeholder: 'Комментарий (необязательно)', maxLength: 300, autocomplete: 'off' });
  const title = el('strong', { textContent: 'Новый замер' });
  const add = el('button', { id: 'ms-add', type: 'submit', class: 'primary', textContent: 'Добавить' });
  const cancel = el('button', { type: 'button', class: 'cancel', textContent: 'Отмена', hidden: true });
  const form = el('form', { id: 'ms-form', class: 'card form-stack' }, title, kind,
    el('div', { class: 'two' }, value, value2), el('div', { class: 'two' }, cname, cunit), el('div', { class: 'two' }, date, time), note, el('div', { class: 'row' }, add, cancel));
  const syncKind = () => {
    const k = kind.value;
    value2.hidden = !MEASURES[k].two; cname.hidden = cunit.hidden = k !== 'custom';
    value.placeholder = MEASURES[k].two ? 'Верхнее' : `Значение${MEASURES[k].unit ? ', ' + MEASURES[k].unit : ''}`;
  };
  kind.onchange = syncKind; syncKind();
  const reset = () => { editing = null; value.value = value2.value = note.value = time.value = cname.value = cunit.value = ''; date.value = todayStr(); title.textContent = 'Новый замер'; add.textContent = 'Добавить'; cancel.hidden = true; kind.disabled = false; syncKind(); };
  cancel.onclick = reset;
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      const f = { value: value.value, value2: value2.value, date: date.value, time: time.value, note: note.value, name: cname.value, unit: cunit.value };
      if (editing) await store.save(updateMeasure(editing, f));
      else await store.save(makeMeasure({ kind: kind.value, ...f }));
      reset();
    } catch (err) { toast(err.message); }
  };
  function startEdit(ev) {
    const p = ev.payload;
    editing = ev; kind.value = p.kind; kind.disabled = true; syncKind();
    value.value = String(p.value).replace('.', ','); value2.value = p.value2 === undefined ? '' : String(p.value2); cname.value = p.name ?? ''; cunit.value = p.unit ?? '';
    date.value = p.date; time.value = p.time ?? ''; note.value = p.note ?? '';
    title.textContent = 'Изменить замер'; add.textContent = 'Сохранить'; cancel.hidden = false; form.scrollIntoView?.({ block: 'center' }); value.focus();
  }
  async function remove(ev) {
    const old = await store.remove(ev.id);
    if (editing?.id === ev.id) reset();
    if (old) toast('Замер удалён', { actionLabel: 'Отменить', onAction: () => store.save(old) });
  }

  const list = el('div', { id: 'health-list' });
  const empty = el('p', { class: 'muted', hidden: true, textContent: 'Замеров пока нет. Добавь первый выше.' });
  const csv = el('button', { id: 'health-csv', type: 'button', textContent: 'Скачать замеры (CSV)', onclick: () => saveTextFile(`health-${todayStr()}.csv`, measuresToCsv(store.state.events), 'text/csv').catch(e => toast(e.message)) });
  root.append(summary, form, list, empty, hpBox, el('div', { class: 'row' }, csv));

  function renderSummary(today) {
    const hpf = healthProfile(events);
    const lines = [];
    const w = dailySeries(events, 'weight').at(-1)?.value ?? null;
    const waist = dailySeries(events, 'waist').at(-1)?.value ?? null;
    const b = bmi(w, hpf.heightCm), r = whtr(waist, hpf.heightCm);
    if (b !== null) lines.push(`ИМТ ${num(b)} · ${bmiNote(b)} (ориентир, не диагноз)`);
    if (r !== null) lines.push(`Талия к росту ${num(r)} · ${whtrNote(r)}`);
    if (w !== null && hpf.goalWeight) lines.push(`До цели ${num(Math.abs(w - hpf.goalWeight))} кг ${w > hpf.goalWeight ? 'вниз' : 'вверх'}`);
    const sl = sleepStats(events, today, 7, hpf.sleepTarget);
    if (sl) lines.push(`Сон за 7 дней: в среднем ${num(sl.avg)} ч (цель ${num(sl.target)}), разброс ±${num(sl.sd)} ч, недосып ${num(sl.debt)} ч`);
    const bp = bpAverage(events, today, 7);
    if (bp) lines.push(`Давление за 7 дней: в среднем ${bp.sys}/${bp.dia} (замеров: ${bp.n})`);
    const age = ageFromBirthYear(hpf.birthYear);
    if (age !== null) lines.push(`Возраст: ${age}`);
    summary.replaceChildren(el('strong', { textContent: 'Сводка' }),
      ...(lines.length ? lines.map(t => el('p', { class: 'muted', textContent: t })) : [el('p', { class: 'muted', textContent: 'Добавь рост в профиле здоровья, замеры веса и талии, а в дневнике утренние отметки сна: сводка появится сама. Ориентиры не заменяют врача.' })]));
  }

  function card(k, today) {
    const m = measuresOf(events, k.key);
    const main = dailySeries(events, k.key);
    const last = m.at(-1);
    const c = el('article', { class: 'card mcard', dataset: { key: k.key } });
    c.append(el('h4', { textContent: k.label }), el('div', { class: 'big2', textContent: formatMeasure(last.payload) }),
      el('span', { class: 'muted', textContent: `${dateRu(last.payload.date)}${last.payload.time ? ' ' + last.payload.time : ''}` }));
    const stats = [];
    for (const d of [7, 30]) { const ch = changeOver(main, d, today); if (ch) stats.push(el('span', { class: `delta ${ch.delta > 0 ? 'up' : ch.delta < 0 ? 'down' : ''}`, textContent: `${d} дн.: ${signed(ch.delta)} ${last.payload.unit}` })); }
    const tr = linearTrend(main.slice(-30));
    if (tr) stats.push(el('span', { class: 'muted', textContent: `тренд: ${signed(tr.perWeek)} ${last.payload.unit}/нед` }));
    if (stats.length) {
      const row = [];
      stats.forEach((st, i) => { if (i) row.push(el('span', { class: 'muted', textContent: ' · ' })); row.push(st); });
      c.append(el('div', { class: 'row wrap' }, ...row));
    }
    c.append(sparkline(main.slice(-60).map(p => p.value), { width: 260, height: 44 }));
    const rows = m.slice().reverse().slice(0, 12).map(ev => el('div', { class: 'row meas-row', dataset: { id: ev.id } },
      el('button', { type: 'button', class: 'hist-row', onclick: () => startEdit(ev), 'aria-label': 'Изменить замер' },
        el('span', { textContent: dateRu(ev.payload.date) }), el('span', { class: 'muted', textContent: ev.payload.time ?? '' }), el('strong', { textContent: formatMeasure(ev.payload) }), el('span', { class: 'hist-snip', textContent: ev.payload.note ?? '' })),
      el('button', { type: 'button', class: 'del', textContent: '✕', 'aria-label': 'Удалить замер', onclick: () => remove(ev) })));
    const det = el('details', { open: openKeys.has(k.key) }, el('summary', { textContent: `Записи (${m.length})` }), ...rows);
    det.addEventListener('toggle', () => { if (det.open) openKeys.add(k.key); else openKeys.delete(k.key); });
    c.append(det);
    return c;
  }

  function render() {
    const today = todayStr();
    renderSummary(today);
    const keys = measureKeys(events);
    list.replaceChildren(...keys.map(k => card(k, today)));
    empty.hidden = keys.length > 0;
    const hpf = healthProfile(events);
    if (document.activeElement && hpBox.contains(document.activeElement)) return;
    hp.h.value = hpf.heightCm ?? ''; hp.b.value = hpf.birthYear ?? ''; hp.s.value = hpf.sex; hp.z.value = hpf.sleepTarget === 8 ? '' : hpf.sleepTarget; hp.g.value = hpf.goalWeight ?? '';
  }

  return { root, update(evs) { events = evs; render(); }, focusAdd() { value.focus(); } };
}
