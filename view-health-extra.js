// Дополнения к экрану «Здоровье»: режим болезни, протокол давления, календарь профилактики, данные на экстренный случай.
import { el, fill, toast, dateRu } from './ui.js';
import { todayStr, daysBetween } from './events.js';
import * as store from './store.js';
import { activeSick, startSick, endSick, MAX_SICK_DAYS } from './sick.js';
import { bpProtocol, BP_HOWTO } from './bp.js';
import { CHECKUP_TEMPLATES, CHECKUP_NOTE, makeCheckup, markCheckup, checkupsOf, checkupStatus } from './prevent.js';
import { BLOOD_TYPES, EMERGENCY_NOTE, makeEmergency, emergencyOf, emergencyLines } from './emergency.js';

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const wd = ymd => { const [y, m, d] = ymd.split('-').map(Number); return WD[new Date(y, m - 1, d).getDay()]; };
const ruDays = n => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? 'дней' : b === 1 ? 'день' : b >= 2 && b <= 4 ? 'дня' : 'дней'; };

export function createHealthExtras() {
  let events = [];

  // ---------- режим болезни ----------
  const sickCard = el('div', { id: 'sick-card', class: 'card' });
  function renderSick(today) {
    const a = activeSick(events, today);
    if (a) {
      const n = daysBetween(a.payload.from, today) + 1;
      fill(sickCard, el('strong', { textContent: 'Режим болезни включён' }),
        el('p', { class: 'muted', textContent: `С ${dateRu(a.payload.from)} · ${n} ${ruDays(n)}. Привычки и серии на паузе, пропуски не считаются срывом. Выключится сам через ${MAX_SICK_DAYS} дней.` }),
        el('p', { class: 'muted', textContent: 'Если температура держится больше трёх дней или состояние ухудшается, обратись к врачу.' }),
        el('button', { type: 'button', id: 'sick-end', class: 'primary', textContent: 'Я поправился', onclick: async () => { await store.save(endSick(a)); toast('Рад, что стало лучше. Серии продолжатся.'); } }));
    } else {
      fill(sickCard, el('strong', { textContent: 'Заболел или нет сил?' }),
        el('p', { class: 'muted', textContent: 'Режим болезни ставит привычки на паузу: пропуски не станут «срывом», серии не сгорят, напоминания о привычках замолчат.' }),
        el('button', { type: 'button', id: 'sick-start', class: 'chip', textContent: 'Включить режим болезни', onclick: async () => { try { await store.save(startSick(events)); toast('Режим болезни включён. Отдыхай.'); } catch (e) { toast(e.message); } } }));
    }
  }

  // ---------- протокол давления ----------
  const bpCard = el('div', { id: 'bp-protocol', class: 'card', hidden: true });
  function renderBp(today) {
    const p = bpProtocol(events, today);
    bpCard.hidden = !p;
    if (!p) return;
    const f = a => (a ? `${a.sys}/${a.dia} (${a.n})` : '—');
    fill(bpCard, el('strong', { textContent: 'Давление: неделя замеров' }),
      el('p', { class: 'muted', textContent: `Замеров: ${p.readings}. Полных дней: ${p.completeDays} из 7 (полный день: по два замера утром и вечером).` }),
      el('div', { class: 'bp-days', 'aria-label': 'Замеры по дням' }, ...p.byDay.map(d => el('span', { class: `bp-day${d.complete ? ' full' : d.n ? ' some' : ''}`, dataset: { date: d.date }, title: d.date },
        el('b', { textContent: wd(d.date) }), el('span', { textContent: d.complete ? '✓' : `у${d.morning} в${d.evening}` })))),
      el('p', { class: 'muted', textContent: `Среднее: утром ${f(p.avgMorning)}, вечером ${f(p.avgEvening)}, всего ${f(p.avgAll)}.${p.untimed ? ` Без времени: ${p.untimed}.` : ''}` }),
      el('p', { class: 'hint', textContent: p.enough ? 'Данных достаточно, чтобы показать врачу: Развитие → Аналитика → Отчёты → «Сводка для врача». Оценивает цифры врач.' : 'Для разговора с врачом желательно не меньше 12 замеров за 4 и более дней. Добавляй время замера: утро и вечер считаются отдельно.' }),
      el('details', {}, el('summary', { textContent: 'Как измерять' }), el('ul', { class: 'plain muted' }, ...BP_HOWTO.map(t => el('li', { textContent: t })))));
  }

  // ---------- профилактика ----------
  const chkName = el('input', { id: 'chk-name', type: 'text', maxLength: 80, placeholder: 'Что проверять, например «Стоматолог»', autocomplete: 'off' });
  const chkMonths = el('select', { id: 'chk-months', 'aria-label': 'Как часто' }, ...[[3, 'раз в 3 месяца'], [6, 'раз в полгода'], [12, 'раз в год'], [24, 'раз в 2 года']].map(([v, t]) => el('option', { value: String(v), textContent: t })));
  chkMonths.value = '12';
  const chkLast = el('input', { id: 'chk-last', type: 'date', 'aria-label': 'Когда был в последний раз' });
  const chkErr = el('p', { class: 'error', id: 'chk-err' });
  const chkForm = el('form', { class: 'form-stack' },
    el('div', { class: 'chips' }, ...CHECKUP_TEMPLATES.map(t => el('button', { type: 'button', class: 'chip chk-tpl', textContent: t.name, onclick: () => { chkName.value = t.name; if ([...chkMonths.options].some(o => o.value === String(t.months))) chkMonths.value = String(t.months); } }))),
    chkName, chkMonths, el('label', {}, 'Последний раз: ', chkLast), el('button', { type: 'submit', id: 'chk-add', class: 'primary', textContent: 'Добавить' }), chkErr);
  chkForm.onsubmit = async e => {
    e.preventDefault();
    try { await store.save(makeCheckup({ name: chkName.value, months: chkMonths.value, last: chkLast.value })); chkName.value = ''; chkLast.value = ''; chkErr.textContent = ''; }
    catch (x) { chkErr.textContent = x.message; }
  };
  const chkBox = el('details', { id: 'chk-new' }, el('summary', { textContent: 'Добавить проверку' }), chkForm);
  const chkCard = el('div', { id: 'prevent-card', class: 'card' });
  const statusText = s => s.state === 'never' ? 'нет отметки' : s.state === 'overdue' ? `просрочено на ${-s.daysLeft} ${ruDays(-s.daysLeft)}` : s.state === 'soon' ? `через ${s.daysLeft} ${ruDays(s.daysLeft)}` : `в порядке, до ${dateRu(s.due)}`;
  function renderPrevent(today) {
    const rows = checkupsOf(events).map(ev => {
      const s = checkupStatus(ev, today), bad = s.state === 'never' || s.state === 'overdue';
      return el('div', { class: `chk-row ${s.state}`, dataset: { id: ev.id, state: s.state } },
        el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: ev.payload.name }), el('span', { class: `badge ${bad ? 'bad' : 'good'}`, textContent: statusText(s) })),
        el('div', { class: 'row wrap' },
          el('button', { type: 'button', class: 'chip chk-today', textContent: 'Был сегодня', onclick: async () => { await store.save(markCheckup(ev, todayStr())); toast('Отмечено'); } }),
          el('label', { class: 'muted' }, 'или дата: ', el('input', { type: 'date', class: 'chk-date', value: ev.payload.last || '', max: todayStr(), 'aria-label': 'Дата последнего раза', onchange: async e => { const v = e.target.value; if (v && v <= todayStr()) { await store.save(markCheckup(ev, v)); toast('Дата сохранена'); } } })),
          el('button', { type: 'button', class: 'chip danger', 'aria-label': `Удалить: ${ev.payload.name}`, textContent: '✕', onclick: async () => { const old = await store.remove(ev.id); toast('Удалено', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } })));
    });
    fill(chkCard, el('strong', { textContent: 'Профилактика' }), el('p', { class: 'muted', textContent: CHECKUP_NOTE }),
      ...(rows.length ? rows : [el('p', { class: 'muted', textContent: 'Пока пусто. Добавь плановые проверки, чтобы не забывать о них.' })]), chkBox);
  }

  // ---------- данные на экстренный случай ----------
  const em = {
    blood: el('select', { id: 'em-blood', 'aria-label': 'Группа крови' }, ...BLOOD_TYPES.map(v => el('option', { value: v, textContent: v || 'Группа крови не указана' }))),
    allergies: el('input', { id: 'em-allergies', type: 'text', maxLength: 300, placeholder: 'Аллергии (лекарства, еда)', autocomplete: 'off' }),
    conditions: el('input', { id: 'em-conditions', type: 'text', maxLength: 300, placeholder: 'Хронические состояния', autocomplete: 'off' }),
    meds: el('input', { id: 'em-meds', type: 'text', maxLength: 300, placeholder: 'Постоянно принимаю', autocomplete: 'off' }),
    contactName: el('input', { id: 'em-contact', type: 'text', maxLength: 60, placeholder: 'Кому позвонить (имя)', autocomplete: 'off' }),
    contactPhone: el('input', { id: 'em-phone', type: 'tel', maxLength: 24, placeholder: 'Телефон', autocomplete: 'off' }),
    note: el('input', { id: 'em-note', type: 'text', maxLength: 300, placeholder: 'Что ещё важно знать', autocomplete: 'off' }),
  };
  const emErr = el('p', { class: 'error', id: 'em-err' });
  const emForm = el('form', { class: 'form-stack' }, em.blood, em.allergies, em.conditions, em.meds, el('div', { class: 'grid2' }, em.contactName, em.contactPhone), em.note,
    el('button', { type: 'submit', id: 'em-save', class: 'primary', textContent: 'Сохранить' }), emErr);
  const emBox = el('details', { id: 'em-form-box' }, el('summary', { id: 'em-form-sum', textContent: 'Заполнить' }), emForm);
  emForm.onsubmit = async e => {
    e.preventDefault();
    try {
      await store.save(makeEmergency({ bloodType: em.blood.value, allergies: em.allergies.value, conditions: em.conditions.value, meds: em.meds.value, contactName: em.contactName.value, contactPhone: em.contactPhone.value, note: em.note.value }, Date.now(), emergencyOf(events)));
      emErr.textContent = ''; emBox.open = false; toast('Сохранено');
    } catch (x) { emErr.textContent = x.message; }
  };
  const emHost = el('div', { id: 'em-overlay', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Данные на экстренный случай' });
  const emCard = el('div', { id: 'emergency-card', class: 'card' });
  function showEmergency(p) {
    const tel = String(p.contactPhone || '').replace(/[^\d+]/g, '');
    fill(emHost, el('div', { class: 'sess-top' }, el('strong', { textContent: 'Экстренные данные' }), el('button', { type: 'button', id: 'em-close', class: 'chip', textContent: 'Закрыть', onclick: () => { emHost.hidden = true; emHost.replaceChildren(); } })),
      ...emergencyLines(p).map(([k, v]) => el('div', { class: 'card em-line' }, el('div', { class: 'muted', textContent: k }), el('div', { class: 'em-big', textContent: v }))),
      tel ? el('a', { id: 'em-call', class: 'btn primary big-btn', href: `tel:${tel}`, textContent: `Позвонить: ${p.contactPhone}` }) : null);
    emHost.hidden = false; emHost.focus({ preventScroll: true });
  }
  function renderEmergency() {
    const cur = emergencyOf(events), p = cur?.payload;
    const hydrate = () => {
      em.blood.value = p?.bloodType ?? ''; for (const k of ['allergies', 'conditions', 'meds', 'contactName', 'contactPhone', 'note']) em[k].value = p?.[k] ?? '';
    };
    if (!emBox.contains(document.activeElement)) hydrate();
    emBox.querySelector('summary').textContent = p ? 'Изменить' : 'Заполнить';
    fill(emCard, el('strong', { textContent: 'Данные на экстренный случай' }), el('p', { class: 'muted', textContent: EMERGENCY_NOTE }),
      p ? el('div', { id: 'em-lines' }, ...emergencyLines(p).map(([k, v]) => el('p', { class: 'em-row' }, el('span', { class: 'muted', textContent: `${k}: ` }), el('span', { textContent: v })))) : null,
      p ? el('button', { type: 'button', id: 'em-show', class: 'chip', textContent: 'Показать крупно', onclick: () => showEmergency(p) }) : null, emBox);
  }

  function render() {
    const today = todayStr();
    renderSick(today); renderBp(today); renderPrevent(today); renderEmergency();
  }
  const top = el('div', { class: 'stack' }, sickCard);
  const bottom = el('div', { class: 'stack' }, bpCard, chkCard, emCard, emHost);
  render();
  return { top, bottom, update(evs) { events = evs; render(); } };
}
