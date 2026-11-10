import { el, toast, dateRu, moneyText, weekdayOf } from './ui.js';
import { makeTask, updateTask, completeTask, reopenTask, groupTasks, todayStr, addDays, dueLabel, repeatLabel, profileOf } from './events.js';
import { parseQuick } from './quick.js';
import { getPref, setPref } from './prefs.js';
import { activeHabits } from './habits.js';
import { weekReview } from './review.js';
import { dayLog } from './journal.js';
import { spentBetween } from './money.js';
import { todayLoad } from './academy.js';
import * as store from './store.js';

const REPEAT_OPTS = [['', 'не повторять'], ['daily', 'каждый день'], ['weekly', 'каждую неделю'], ['monthly', 'каждый месяц']];
const repeatSelect = (cls, value = '') => {
  const s = el('select', { class: cls }, ...REPEAT_OPTS.map(([v, t]) => el('option', { value: v, textContent: t })));
  s.value = value;
  return s;
};

export function createTodayView({ go }) {
  let editingId = null;
  let editorEl = null;                  // редактор переживает перерисовки, чтобы не терять введённое
  let skipParse = false;
  let events = [];

  const root = el('section', { id: 'view-today', class: 'view' });

  const hello = el('div', { class: 'hello' });
  const dateLine = el('div', { id: 'date', class: 'date' });
  const summary = el('div', { id: 'summary', class: 'chips' });

  const onboarding = el('div', { id: 'onboarding', class: 'card', hidden: true },
    el('strong', { textContent: 'Добро пожаловать в Life OS' }),
    el('ul', { class: 'plain' },
      el('li', { textContent: 'Задачи: пиши как говоришь — «оплатить жильё 10 числа каждого месяца».' }),
      el('li', { textContent: 'Привычки, расходы и заметки — во вкладках внизу.' }),
      el('li', { textContent: 'Данные хранятся только на этом устройстве. Включи защиту паролем во вкладке «Ещё».' })),
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'primary', textContent: 'Открыть защиту', onclick: () => { setPref('onboardingDone', true); onboarding.hidden = true; go('more'); } }),
      el('button', { type: 'button', textContent: 'Понятно', onclick: () => { setPref('onboardingDone', true); onboarding.hidden = true; } })));

  // ----- форма добавления -----
  const input = el('input', { id: 'add-input', type: 'text', placeholder: 'Что нужно сделать?', enterKeyHint: 'done', maxLength: 500, required: true, autocomplete: 'off' });
  const addBtn = el('button', { type: 'submit', 'aria-label': 'Добавить', textContent: '+' });
  const due = el('input', { id: 'add-due', type: 'date' });
  const rep = repeatSelect('', ''); rep.id = 'add-repeat';
  const high = el('input', { id: 'add-high', type: 'checkbox' });
  const hint = el('div', { id: 'add-hint', class: 'hint', hidden: true });
  const form = el('form', { id: 'add-form', autocomplete: 'off' },
    el('div', { class: 'add-row' }, input, addBtn),
    el('div', { class: 'opts-row' },
      el('label', {}, 'Срок ', due), el('label', {}, 'Повтор ', rep),
      el('label', { class: 'check-label' }, high, ' Важное')),
    hint);

  function parsed() {
    if (!getPref('parseDates') || skipParse || due.value || rep.value) return null;
    const q = parseQuick(input.value);
    return q.found.length ? q : null;
  }
  function describe(q) {
    const bits = [];
    if (q.due) { const l = dueLabel(q.due, todayStr()); bits.push(`срок: ${l.cls === '' && l.text.match(/^\d/) ? l.text : l.text}`); }
    if (q.repeat) bits.push(`повтор: ${repeatLabel({ type: q.repeat })}`);
    return bits.join(', ');
  }
  function updateHint() {
    const q = parsed();
    hint.replaceChildren();
    if (!q) { hint.hidden = true; return; }
    hint.append(el('span', { textContent: `Распознано — ${describe(q)}. ` }),
      el('button', { type: 'button', class: 'link', textContent: 'Не надо', onclick: () => { skipParse = true; updateHint(); } }));
    hint.hidden = false;
  }
  input.addEventListener('input', () => { skipParse = false; updateHint(); });
  due.addEventListener('input', updateHint); rep.addEventListener('input', updateHint);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    let text = input.value.trim();
    if (!text) return;
    let d = due.value || null, r = rep.value || null;
    const q = parsed();
    if (q) { text = q.text; d = q.due; r = q.repeat; }
    const pr = high.checked ? 'high' : 'normal';
    input.value = ''; due.value = ''; rep.value = ''; high.checked = false; skipParse = false; updateHint();   // чистим сразу — быстрый ввод не теряется
    try { await store.save(makeTask(text, Date.now(), { due: d, repeat: r, priority: pr })); }
    catch (err) { toast('Не удалось добавить: ' + err.message); }
  });

  // ----- итоги недели -----
  const reviewBody = el('div', { class: 'review-body' });
  const review = el('details', { id: 'review', class: 'card' }, el('summary', { textContent: 'Итоги недели' }), reviewBody);

  // ----- журнал дня -----
  const jDate = el('input', { id: 'journal-date', type: 'date', value: todayStr() });
  const jList = el('ul', { id: 'journal-list', class: 'journal' });
  const journal = el('details', { id: 'journal', class: 'card' }, el('summary', { textContent: 'Журнал дня' }),
    el('div', { class: 'row' }, jDate, el('button', { type: 'button', textContent: 'Сегодня', onclick: () => { jDate.value = todayStr(); renderJournal(); } })), jList);
  jDate.oninput = () => renderJournal();
  function renderJournal() {
    const date = jDate.value || todayStr();
    const log = dayLog(events, date);
    jList.replaceChildren(...(log.length ? log.map(x => el('li', {},
      el('span', { class: 'muted j-time', textContent: new Date(x.ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) }),
      el('span', { class: 'j-kind', textContent: x.kind }), el('span', { class: 'j-text', textContent: x.text })))
      : [el('li', { class: 'muted', textContent: 'В этот день записей нет.' })]));
  }

  // ----- списки -----
  const sections = {};
  for (const [key, title, cls] of [['overdue', 'Просрочено', 'overdue'], ['today', 'Сегодня', ''], ['upcoming', 'Скоро', ''], ['nodate', 'Без срока', '']]) {
    const ul = el('ul', { class: 'list open' });
    sections[key] = { sec: el('section', { id: 'g-' + key, hidden: true }, el('h2', { class: cls, textContent: title }), ul), ul };
  }
  const empty = el('p', { id: 'empty', class: 'muted', hidden: true, textContent: 'Пока пусто. Добавь первую задачу.' });
  const doneList = el('ul', { id: 'done-list', class: 'list' });
  const doneCount = el('span', { id: 'done-count', textContent: '0' });
  const clearDone = el('button', { type: 'button', id: 'clear-done', textContent: 'Очистить сделанные' });
  const doneBlock = el('details', { id: 'done-block' }, el('summary', {}, 'Сделано: ', doneCount), doneList, el('div', { class: 'row' }, clearDone));
  clearDone.onclick = async () => {
    const ids = events.filter(e => e.type === 'task' && e.payload.done).map(e => e.id);
    if (!ids.length) return;
    const old = await store.removeMany(ids);
    toast(`Удалено сделанных: ${ids.length}`, { actionLabel: 'Отменить', onAction: () => store.saveMany(old) });
  };

  root.append(hello, dateLine, summary, onboarding, form, review, journal, ...Object.values(sections).map(s => s.sec), empty, doneBlock);

  // ----- элементы списка -----
  async function removeTask(ev) {
    if (editingId === ev.id) { editingId = null; editorEl = null; }
    const old = await store.remove(ev.id);
    if (old) toast('Задача удалена', { actionLabel: 'Отменить', onAction: () => store.save(old) });
  }

  function stopEdit() { editingId = null; editorEl = null; render(); }

  function editor(ev) {
    const p = ev.payload;
    const text = el('input', { type: 'text', value: p.text, maxLength: 500, required: true, class: 'edit-text' });
    const d = el('input', { type: 'date', value: p.due || '', class: 'edit-due' });
    const r = repeatSelect('edit-repeat', p.repeat?.type || '');
    const pr = el('input', { type: 'checkbox', class: 'edit-high', checked: p.priority === 'high' });
    const today = todayStr();
    const chip = (label, val) => el('button', { type: 'button', class: 'chip', textContent: label, onclick: () => { d.value = val; } });
    const save = el('button', { type: 'submit', class: 'save primary', textContent: 'Сохранить' });
    const cancel = el('button', { type: 'button', class: 'cancel', textContent: 'Отмена', onclick: () => stopEdit() });
    const form = el('form', { class: 'item editing', dataset: { id: ev.id } },
      text,
      el('div', { class: 'chips' }, chip('Сегодня', today), chip('Завтра', addDays(today, 1)), chip('Через неделю', addDays(today, 7)), chip('Без срока', '')),
      el('div', { class: 'opts-row' }, el('label', {}, 'Срок ', d), el('label', {}, 'Повтор ', r), el('label', { class: 'check-label' }, pr, ' Важное')),
      el('div', { class: 'row' }, save, cancel));
    form.onsubmit = async e => {
      e.preventDefault();
      try {
        await store.save(updateTask(ev, { text: text.value, due: d.value || null, repeat: r.value || null, priority: pr.checked ? 'high' : 'normal' }));
        stopEdit();
      } catch (err) { toast('Не удалось сохранить: ' + err.message); }
    };
    queueMicrotask(() => text.focus());
    return form;
  }

  function item(ev, today) {
    const p = ev.payload;
    if (editingId === ev.id && !p.done) {
      if (!editorEl || editorEl.dataset.id !== ev.id) editorEl = editor(ev);
      return editorEl;
    }
    const lab = dueLabel(p.due, today);
    const li = el('li', { class: 'item' + (p.done ? ' done' : '') + (lab.cls === 'overdue' && !p.done ? ' is-overdue' : '') });
    const check = el('button', { class: 'check', type: 'button', textContent: p.done ? '✓' : '', 'aria-label': p.done ? 'Вернуть в работу' : 'Отметить сделанным' });
    check.onclick = async () => {
      if (!p.done) {
        const { updated, next } = completeTask(ev);
        await store.saveMany(next ? [updated, next] : [updated]);
      } else {
        const { updated, removeId } = reopenTask(ev);
        const nxt = removeId && events.find(e => e.id === removeId);
        await store.save(updated);
        if (nxt && !nxt.payload.done) await store.remove(removeId);
      }
    };
    const meta = [];
    if (lab.text && !p.done) meta.push(el('span', { class: lab.cls, textContent: lab.text }));
    const rl = repeatLabel(p.repeat);
    if (rl) meta.push(document.createTextNode((meta.length ? ' · ' : '') + '↻ ' + rl));
    const body = el('div', { class: 'body' }, el('span', { class: 'text', textContent: (p.priority === 'high' && !p.done ? '★ ' : '') + p.text }));
    if (!p.done) {
      body.tabIndex = 0; body.setAttribute('role', 'button'); body.setAttribute('aria-label', 'Изменить: ' + p.text);
      const edit = () => { editingId = ev.id; editorEl = null; render(); };
      body.onclick = edit;
      body.onkeydown = e => { if (e.key === 'Enter') edit(); };
    }
    if (meta.length) body.append(el('span', { class: 'meta' }, ...meta));
    const del = el('button', { class: 'del', type: 'button', textContent: '✕', 'aria-label': 'Удалить', onclick: () => removeTask(ev) });
    li.append(check, body, del);
    return li;
  }

  function renderSummary(g, today) {
    const chips = [];
    chips.push(el('span', { class: 'chip static', textContent: `Задач: ${g.openCount}` }));
    if (g.overdue.length) chips.push(el('span', { class: 'chip static danger', textContent: `Просрочено: ${g.overdue.length}` }));
    const hs = activeHabits(events, today);
    const real = events.filter(e => e.type !== 'profile' && e.type !== 'budget').length;
    const last = getPref('lastBackupAt');
    if (real >= 5 && (!last || Date.now() - last > 14 * 86400000)) chips.push(el('button', { type: 'button', id: 'backup-chip', class: 'chip', textContent: 'Сделай резервную копию', onclick: () => go('more') }));
    if (hs.length) chips.push(el('button', { type: 'button', class: 'chip', textContent: `Привычки: ${hs.filter(x => x.st.doneToday).length}/${hs.length}`, onclick: () => go('habits') }));
    const spent = spentBetween(events, today, today);
    if (spent) chips.push(el('button', { type: 'button', class: 'chip', textContent: `Потрачено сегодня: ${moneyText(spent)}`, onclick: () => go('money') }));
    const load = todayLoad(events, today);
    if (load.due + load.fresh) chips.push(el('button', { type: 'button', id: 'learn-chip', class: 'chip', textContent: `Повторение: ${load.due + load.fresh}`, onclick: () => go('learn') }));
    if (!events.some(e => e.type === 'checkin' && e.payload.date === today && e.payload.slot === 'm')) chips.push(el('button', { type: 'button', id: 'checkin-chip', class: 'chip', textContent: 'Отметка утра', onclick: () => go('diary') }));
    if (!events.some(e => e.type === 'testrun' && e.payload.date === today)) chips.push(el('button', { type: 'button', id: 'test-chip', class: 'chip', textContent: 'Проверка дня', onclick: () => go('tests') }));
    summary.replaceChildren(...chips);
  }

  function renderReview(today) {
    const r = weekReview(events, today);
    const max = Math.max(1, ...r.perDay.map(x => x.count));
    const bars = el('div', { class: 'bars' }, ...r.perDay.map(x => {
      const bar = el('div', { class: 'bar-col', title: `${dateRu(x.date)}: ${x.count}` },
        el('span', { class: 'bar-fill' }), el('span', { class: 'bar-n', textContent: String(x.count) }), el('span', { class: 'bar-d', textContent: weekdayOf(x.date) }));
      bar.firstChild.style.setProperty('--h', Math.round((x.count / max) * 100) + '%');
      return bar;
    }));
    const lines = [
      el('p', {}, el('strong', { textContent: `Сделано задач: ${r.tasksDone}` }), el('span', { class: 'muted', textContent: ` (прошлые 7 дней: ${r.prevDone})` })),
      bars,
    ];
    if (r.habits.length) lines.push(el('p', { class: 'muted', textContent: 'Привычки: ' + r.habits.map(h => `${h.name} — ${h.hits} из ${h.of}`).join('; ') }));
    if (r.spent || r.spentPrev) lines.push(el('p', { class: 'muted', textContent: `Потрачено: ${moneyText(r.spent)} (прошлые 7 дней: ${moneyText(r.spentPrev)})` }));
    if (r.notes) lines.push(el('p', { class: 'muted', textContent: `Новых заметок: ${r.notes}` }));
    reviewBody.replaceChildren(...lines);
  }

  function render() {
    const today = todayStr();
    const profile = profileOf(events);
    hello.textContent = profile?.payload.name ? `Привет, ${profile.payload.name}` : '';
    hello.hidden = !hello.textContent;
    const [y, m, d] = today.split('-').map(Number);
    const ds = new Date(y, m - 1, d, 12).toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });
    dateLine.textContent = ds.charAt(0).toUpperCase() + ds.slice(1);
    onboarding.hidden = getPref('onboardingDone') || events.some(e => e.type === 'task');
    const g = groupTasks(events, today);
    for (const key of Object.keys(sections)) {
      sections[key].sec.hidden = g[key].length === 0;
      sections[key].ul.replaceChildren(...g[key].map(e => item(e, today)));
    }
    doneList.replaceChildren(...g.done.slice(0, 50).map(e => item(e, today)));
    doneCount.textContent = g.done.length;
    clearDone.hidden = g.done.length === 0;
    empty.hidden = g.openCount > 0;
    renderSummary(g, today);
    renderReview(today);
    renderJournal();
  }

  return {
    root,
    update(evs) { events = evs; render(); },
    prefill(text) { input.value = String(text).slice(0, 500); updateHint(); input.focus(); },
    focusAdd() { input.focus(); },
    hasEditing: () => !!editingId,
  };
}
