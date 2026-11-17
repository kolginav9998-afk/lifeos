// Встречи в чате: карточка встречи, мастер «Предложить встречу» (4 шага), окно ответа приглашённого и список «Мои встречи».
// Дочерний блок экрана «Чат». Логика (проверки, состояния, календарь) лежит в meet.js; здесь только показ и действия.
import { el, fill, icon, toast, announce, focusNode, setBusy } from './ui.js';
import { todayStr, addDays } from './events.js';
import { saveTextFile } from './platform.js';
import { MEET_TYPES, meetTypeById, checkProposal, checkReply, timesFromSpec, pickerWeeks, describeMeeting, whenText, meetingToIcs, isUpcoming, myTurn, STATUS_TEXT, MAX_PLACES, DEFAULT_TIMES, datesIn } from './meet.js';
import { WEEKDAYS_SHORT } from './schedule.js';

const SUGGEST = {
  date: ['Кафе', 'Кино', 'Прогулка в парке', 'Ресторан', 'Каток', 'Выставка', 'Набережная'],
  business: ['Офис', 'Кафе рядом', 'Переговорная', 'Онлайн-звонок'],
  friends: ['Кафе', 'Боулинг', 'Парк', 'Дом', 'Квест'],
  family: ['Дом', 'Парк', 'Ресторан', 'Гости'],
  other: ['Кафе', 'Парк', 'Дом'],
};
const STATUS_ICON = { proposed: 'clock', answered: 'info', confirmed: 'checkCircle', declined: 'x', cancelled: 'x' };
const ru = (d, o) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', o);
const lab = (text, input) => el('label', { class: 'ch-f' }, el('span', { class: 'muted', textContent: text }), input);

// ---------- карточка встречи (в переписке и в списке) ----------
// actions: { reply(mt), confirm(mt), cancel(mt), ics(mt) } — что нажимается; compact: короче, для списка.
export function meetingCard(mt, me, actions = {}, { compact = false } = {}) {
  const d = describeMeeting(mt, me), t = meetTypeById(mt.type);
  const rows = [];
  if (mt.when) rows.push(['Когда', whenText(mt.when)]);
  if (mt.place) rows.push(['Где', mt.place.name]);
  if (!mt.when && !compact) rows.push(['Можно выбрать', `${ru(mt.proposal.window.from, { day: 'numeric', month: 'long' })} — ${ru(mt.proposal.window.to, { day: 'numeric', month: 'long' })}, время ${mt.proposal.times[0]}–${mt.proposal.times.at(-1)}`]);
  if (!mt.place && !compact) rows.push(['Варианты места', mt.proposal.places.map(p => p.name).join(', ') + (mt.proposal.allowOther ? ' или своё' : '')]);
  if (mt.note && !compact) rows.push(['Пояснение', mt.note]);
  if (mt.reply?.comment) rows.push(['Комментарий', mt.reply.comment]);
  const btns = [];
  if (actions.reply && d.turn === 'answer') btns.push(el('button', { type: 'button', class: 'primary', textContent: 'Выбрать дату, время и место', onclick: () => actions.reply(mt) }));
  if (actions.reply && d.turn === 'wait' && mt.status === 'answered' && me === mt.guest) btns.push(el('button', { type: 'button', class: 'chip', textContent: 'Изменить мой ответ', onclick: () => actions.reply(mt) }));
  if (actions.confirm && d.turn === 'confirm') btns.push(el('button', { type: 'button', class: 'primary', textContent: 'Подтвердить встречу', onclick: () => actions.confirm(mt) }));
  if (actions.cancel && ['proposed', 'answered', 'confirmed'].includes(mt.status)) btns.push(el('button', { type: 'button', class: 'chip danger', textContent: mt.status === 'confirmed' ? 'Отменить встречу' : 'Отозвать', onclick: () => actions.cancel(mt) }));
  if (actions.ics && mt.status === 'confirmed' && mt.when) btns.push(el('button', { type: 'button', class: 'chip', textContent: 'В календарь', onclick: () => actions.ics(mt) }));
  return el('article', { class: `mt-card mood-${t.mood} st-${mt.status}`, 'aria-label': `${t.title}: ${mt.title}. ${d.status}` },
    el('header', { class: 'mt-head' }, el('span', { class: 'mt-ico', 'aria-hidden': 'true' }, icon(t.icon, 22)), el('div', {}, el('strong', { class: 'mt-title', textContent: mt.title }), el('span', { class: 'muted', textContent: `${t.title} · ${me === mt.host ? 'с ' : 'от '}${d.other}` }))),
    el('p', { class: 'mt-status' }, el('span', { class: 'mt-st-ico', 'aria-hidden': 'true' }, icon(STATUS_ICON[mt.status] ?? 'info', 16)), el('span', { textContent: d.status })),
    d.hint && !compact ? el('p', { class: 'muted', textContent: d.hint }) : null,
    rows.length ? el('dl', { class: 'mt-dl' }, ...rows.flatMap(([k, v]) => [el('dt', { class: 'muted', textContent: k }), el('dd', { textContent: v })])) : null,
    btns.length ? el('div', { class: 'row wrap' }, ...btns) : null);
}

// ---------- мастер «Предложить встречу» ----------
export function createWizard({ onSend }) {
  let step = 0, peer = '', st = null;
  const fresh = () => ({ type: 'date', title: 'Свидание', note: '', places: [], allowOther: true, from: addDays(todayStr(), 1), to: addDays(todayStr(), 7), tFrom: DEFAULT_TIMES.from, tTo: DEFAULT_TIMES.to, step: 60, duration: 120, titleTouched: false });
  const host = el('div', { id: 'chat-wiz', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'chat-wiz-title' });
  const title = el('h3', { id: 'chat-wiz-title', tabIndex: -1 }), crumbs = el('p', { id: 'chat-wiz-steps', class: 'muted', role: 'status' }), body = el('div', { id: 'chat-wiz-body', class: 'form-stack' }), err = el('p', { id: 'chat-wiz-err', class: 'error', role: 'alert' });
  const back = el('button', { type: 'button', id: 'chat-wiz-back', textContent: 'Назад', onclick: () => { err.textContent = ''; step = Math.max(0, step - 1); paint(); } });
  const next = el('button', { type: 'button', id: 'chat-wiz-next', class: 'primary', onclick: () => go() });
  const close = el('button', { type: 'button', id: 'chat-wiz-close', textContent: 'Закрыть', onclick: () => { host.hidden = true; } });
  host.append(el('div', { class: 'sess-top' }, title), crumbs, body, err, el('div', { class: 'row wrap' }, back, next, close));
  const STEPS = ['Что за встреча', 'Куда пойти', 'Когда', 'Проверь и отправь'];
  const proposalOf = () => ({ type: st.type, title: st.title, note: st.note, window: { from: st.from, to: st.to }, times: { from: st.tFrom, to: st.tTo, step: st.step }, places: st.places.map(name => ({ name })), allowOther: st.allowOther, duration: st.duration });

  function paint() {
    title.textContent = STEPS[step];
    crumbs.textContent = `Шаг ${step + 1} из ${STEPS.length}`;
    back.hidden = step === 0; next.textContent = step === STEPS.length - 1 ? 'Отправить' : 'Дальше';
    if (step === 0) {
      const tiles = MEET_TYPES.map(t => el('button', { type: 'button', class: `ch-tile mood-${t.mood}`, 'aria-pressed': String(st.type === t.key),
        onclick: () => { st.type = t.key; if (!st.titleTouched) st.title = t.title; st.places = st.places.filter(Boolean); paint(); } }, icon(t.icon, 26), el('strong', { textContent: t.title })));
      const ttl = el('input', { id: 'chat-wiz-name', type: 'text', maxLength: 60, value: st.title, autocomplete: 'off', oninput: e => { st.title = e.target.value; st.titleTouched = true; } });
      const note = el('textarea', { id: 'chat-wiz-note', rows: 2, maxLength: 300, placeholder: 'Например: давно не виделись', oninput: e => { st.note = e.target.value; } }); note.value = st.note;
      fill(body, el('p', { class: 'muted', textContent: meetTypeById(st.type).intro }), el('div', { class: 'ch-tiles', role: 'group', 'aria-label': 'Вид встречи' }, ...tiles), lab('Название', ttl), lab('Пояснение (по желанию)', note));
    } else if (step === 1) {
      const input = el('input', { id: 'chat-wiz-place', type: 'text', maxLength: 60, autocomplete: 'off', placeholder: 'Например: кафе на набережной' });
      const add = name => { const n = String(name).trim(); if (!n) return; if (st.places.some(p => p.toLowerCase() === n.toLowerCase())) return toast('Это место уже в списке'); if (st.places.length >= MAX_PLACES) return toast(`Не больше ${MAX_PLACES} мест`); st.places.push(n); paint(); };
      const addBtn = el('button', { type: 'button', id: 'chat-wiz-add', class: 'chip', textContent: 'Добавить место', onclick: () => add(input.value) });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(input.value); } });
      const suggest = (SUGGEST[st.type] ?? SUGGEST.other).filter(s => !st.places.includes(s)).map(s => el('button', { type: 'button', class: 'chip', textContent: `+ ${s}`, onclick: () => add(s) }));
      const list = st.places.length ? el('ul', { class: 'chips ch-places' }, ...st.places.map((p, i) => el('li', { class: 'chip static' }, el('span', { textContent: p }), el('button', { type: 'button', class: 'link', 'aria-label': `Убрать место ${p}`, textContent: '✕', onclick: () => { st.places.splice(i, 1); paint(); } })))) : el('p', { class: 'muted', textContent: 'Пока ни одного места. Выбери из подсказок или впиши своё.' });
      const other = el('label', { class: 'row' }, el('input', { id: 'chat-wiz-other', type: 'checkbox', checked: st.allowOther, onchange: e => { st.allowOther = e.target.checked; } }), el('span', { textContent: 'Собеседник может предложить своё место' }));
      fill(body, el('p', { class: 'muted', textContent: 'Добавь от 1 до 8 мест. Собеседник выберет одно из них.' }), list, el('div', { class: 'row' }, input, addBtn), el('div', { class: 'chips', role: 'group', 'aria-label': 'Подсказки' }, ...suggest), other);
    } else if (step === 2) {
      const d = (id, key) => el('input', { id, type: 'date', value: st[key], min: todayStr(), onchange: e => { st[key] = e.target.value; paint(); } });
      const tm = (id, key) => el('input', { id, type: 'time', value: st[key], onchange: e => { st[key] = e.target.value; paint(); } });
      const stepSel = el('select', { id: 'chat-wiz-step', onchange: e => { st.step = Number(e.target.value); paint(); } }, ...[[30, 'каждые 30 минут'], [60, 'каждый час']].map(([v, t]) => el('option', { value: v, selected: st.step === v, textContent: t })));
      const durSel = el('select', { id: 'chat-wiz-dur', onchange: e => { st.duration = Number(e.target.value); } }, ...[[60, '1 час'], [90, '1,5 часа'], [120, '2 часа'], [180, '3 часа'], [240, '4 часа']].map(([v, t]) => el('option', { value: v, selected: st.duration === v, textContent: t })));
      const times = timesFromSpec({ from: st.tFrom, to: st.tTo, step: st.step });
      fill(body, el('p', { class: 'muted', textContent: 'Собеседник выберет день и время только из того, что ты предложишь.' }),
        el('div', { class: 'two' }, lab('Можно с', d('chat-wiz-from', 'from')), lab('по', d('chat-wiz-to', 'to'))),
        el('div', { class: 'two' }, lab('Время с', tm('chat-wiz-tfrom', 'tFrom')), lab('до', tm('chat-wiz-tto', 'tTo'))),
        lab('Варианты времени', stepSel), el('p', { id: 'chat-wiz-times', class: 'muted', textContent: times.length ? `Получится вариантов: ${times.length} (${times.slice(0, 6).join(', ')}${times.length > 6 ? '…' : ''})` : 'Время указано неверно' }), lab('Сколько продлится', durSel));
    } else {
      let p = null; try { p = checkProposal(proposalOf()); } catch (e) { err.textContent = e.message; }
      const me = '', fake = p ? { id: 'preview', type: p.type, title: p.title, note: p.note ?? '', host: me || 'я', guest: peer, proposal: p, status: 'proposed', reply: null, when: null, place: null } : null;
      fill(body, p ? el('p', { class: 'muted', textContent: `Это увидит ${peer}. Он(а) выберет день, время и место и ответит.` }) : null, fake ? meetingCard(fake, 'я', {}, {}) : null);
    }
    focusNode(title);
  }
  async function go() {
    err.textContent = '';
    try {
      if (step === 0 && !st.title.trim()) throw new Error('Назови встречу');
      if (step === 1 && !st.places.length) throw new Error('Добавь хотя бы одно место');
      if (step === 2) checkProposal(proposalOf());
      if (step < STEPS.length - 1) { step += 1; paint(); return; }
      const proposal = checkProposal(proposalOf());
      setBusy(next, true, 'Отправляю…');
      try { await onSend(peer, proposal); host.hidden = true; announce('Предложение отправлено'); } finally { setBusy(next, false); }
    } catch (e) { err.textContent = e.message; announce(e.message, { assertive: true }); }
  }
  return { root: host, open(p, preset = 'date') { peer = p; step = 0; st = fresh(); st.type = preset; st.title = meetTypeById(preset).title; err.textContent = ''; host.hidden = false; paint(); } };
}

// ---------- окно ответа приглашённого ----------
export function createReplySheet({ onReply }) {
  let mt = null, mode = 'accept', pick = null;
  const host = el('div', { id: 'chat-reply', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'chat-reply-title' });
  const title = el('h3', { id: 'chat-reply-title', tabIndex: -1 }), body = el('div', { id: 'chat-reply-body', class: 'form-stack' }), err = el('p', { id: 'chat-reply-err', class: 'error', role: 'alert' });
  const close = el('button', { type: 'button', id: 'chat-reply-close', textContent: 'Закрыть', onclick: () => { host.hidden = true; } });
  host.append(el('div', { class: 'sess-top' }, title), body, err, el('div', { class: 'row wrap' }, close));
  const fresh = () => ({ date: '', time: '', placeId: '', other: '', comment: '', cDate: addDays(todayStr(), 1), cTime: '19:00' });

  function paint() {
    const p = mt.proposal, t = meetTypeById(mt.type);
    title.textContent = mt.title;
    const seg = (m, text) => el('button', { type: 'button', class: 'seg', 'aria-pressed': String(mode === m), textContent: text, onclick: () => { mode = m; err.textContent = ''; paint(); } });
    const comment = el('textarea', { id: 'chat-reply-comment', rows: 2, maxLength: 300, placeholder: 'Комментарий (по желанию)', oninput: e => { pick.comment = e.target.value; } }); comment.value = pick.comment;
    const head = el('p', { class: 'muted', textContent: `${t.title} от ${mt.host}${mt.note ? `. ${mt.note}` : ''}` });
    const modes = el('div', { class: 'row wrap', role: 'group', 'aria-label': 'Ответ' }, seg('accept', 'Подходит'), p.allowOther ? seg('counter', 'Предложу своё') : null, seg('decline', 'Не смогу'));
    const parts = [head, modes];
    if (mode === 'accept') {
      const weeks = pickerWeeks(p.window);
      parts.push(el('strong', { textContent: 'День' }),
        el('div', { class: 'cal ch-cal', role: 'group', 'aria-label': 'Предложенные дни' },
          el('div', { class: 'cal-row cal-head' }, ...WEEKDAYS_SHORT.map(w => el('span', { class: 'cal-hd', textContent: w }))),
          ...weeks.map(wk => el('div', { class: 'cal-row' }, ...wk.map(c => el('div', { class: 'cal-cell' }, c ? el('button', { type: 'button', class: `cal-day ch-day${pick.date === c.date ? ' picked' : ''}`, 'aria-pressed': String(pick.date === c.date), 'aria-label': `${ru(c.date, { weekday: 'long', day: 'numeric', month: 'long' })}`,
            onclick: () => { pick.date = c.date; paint(); } }, el('span', { class: 'cal-n', 'aria-hidden': 'true', textContent: String(+c.date.slice(8)) })) : null))))),
        el('strong', { textContent: 'Время' }), el('div', { class: 'chips', role: 'group', 'aria-label': 'Время' }, ...p.times.map(tm => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(pick.time === tm), textContent: tm, onclick: () => { pick.time = tm; paint(); } }))),
        el('strong', { textContent: 'Место' }), placeTiles(p), p.allowOther ? lab('Или своё место', el('input', { id: 'chat-reply-other', type: 'text', maxLength: 60, value: pick.other, autocomplete: 'off', oninput: e => { pick.other = e.target.value; pick.placeId = ''; } })) : null);
    } else if (mode === 'counter') {
      parts.push(el('p', { class: 'muted', textContent: 'Предложи свой день, время и место. Автор решит, подходит ли.' }),
        el('div', { class: 'two' }, lab('День', el('input', { id: 'chat-reply-cdate', type: 'date', value: pick.cDate, min: todayStr(), onchange: e => { pick.cDate = e.target.value; } })), lab('Время', el('input', { id: 'chat-reply-ctime', type: 'time', value: pick.cTime, onchange: e => { pick.cTime = e.target.value; } }))),
        el('strong', { textContent: 'Место' }), placeTiles(p), lab('Или своё место', el('input', { id: 'chat-reply-other', type: 'text', maxLength: 60, value: pick.other, autocomplete: 'off', oninput: e => { pick.other = e.target.value; pick.placeId = ''; } })));
    } else parts.push(el('p', { class: 'muted', textContent: 'Можно коротко объяснить, почему не получится.' }));
    parts.push(comment, el('button', { type: 'button', id: 'chat-reply-send', class: 'primary', textContent: mode === 'decline' ? 'Отказаться' : mode === 'counter' ? 'Предложить своё' : 'Ответить: подходит', onclick: e => send(e.currentTarget) }));
    fill(body, ...parts);
  }
  const placeTiles = p => el('div', { class: 'ch-tiles', role: 'group', 'aria-label': 'Место' }, ...p.places.map(pl => el('button', { type: 'button', class: 'ch-tile', 'aria-pressed': String(pick.placeId === pl.id), onclick: () => { pick.placeId = pl.id; pick.other = ''; paint(); } }, icon('target', 22), el('strong', { textContent: pl.name }), pl.hint ? el('span', { class: 'muted', textContent: pl.hint }) : null)));
  async function send(btn) {
    err.textContent = '';
    try {
      const raw = mode === 'decline' ? { status: 'declined', comment: pick.comment }
        : mode === 'counter' ? { status: 'counter', date: pick.cDate, time: pick.cTime, placeId: pick.placeId || undefined, other: pick.other, comment: pick.comment }
          : { status: 'accepted', date: pick.date, time: pick.time, placeId: pick.placeId || undefined, other: pick.other, comment: pick.comment };
      const reply = checkReply(mt.proposal, raw, todayStr());
      setBusy(btn, true, 'Отправляю…');
      try { await onReply(mt, reply); host.hidden = true; announce('Ответ отправлен'); } finally { setBusy(btn, false); }
    } catch (e) { err.textContent = e.message; announce(e.message, { assertive: true }); }
  }
  return { root: host, open(m) { mt = m; mode = 'accept'; pick = fresh(); if (m.reply?.status === 'accepted') Object.assign(pick, { date: m.reply.date, time: m.reply.time, placeId: m.reply.placeId ?? '', other: m.reply.other ?? '' }); err.textContent = ''; host.hidden = false; paint(); focusNode(title); } };
}

// ---------- страница «Мои встречи» ----------
export function meetingsPage(list, me, actions) {
  const today = todayStr();
  const groups = [
    ['Ближайшие', list.filter(m => isUpcoming(m, today)).sort((a, b) => `${a.when.date} ${a.when.time}`.localeCompare(`${b.when.date} ${b.when.time}`))],
    ['Ждут ответа или подтверждения', list.filter(m => ['proposed', 'answered'].includes(m.status))],
    ['Прошедшие, отклонённые и отменённые', list.filter(m => !isUpcoming(m, today) && !['proposed', 'answered'].includes(m.status))],
  ].filter(([, l]) => l.length);
  if (!groups.length) return [el('p', { class: 'muted', textContent: 'Встреч пока нет. Открой переписку с человеком и нажми «Предложить встречу».' })];
  return groups.flatMap(([title, items]) => [el('h3', { textContent: title }), ...items.map(m => meetingCard(m, me, actions, { compact: true }))]);
}

// Файл календаря для подтверждённой встречи.
export async function exportIcs(mt, me) {
  try { await saveTextFile(`kompas-meeting-${mt.id}.ics`, meetingToIcs(mt, me), 'text/calendar', 'Добавить встречу в календарь'); }
  catch (e) { toast(e.message || 'Не удалось сохранить файл'); }
}
export { STATUS_TEXT, myTurn, datesIn };
