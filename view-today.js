import { el, fill, toast, dateRu, moneyText, weekdayOf } from './ui.js';
import { makeTask, updateTask, completeTask, reopenTask, groupTasks, todayStr, addDays, dueLabel, repeatLabel, profileOf } from './events.js';
import { parseQuick } from './quick.js';
import { getPref, setPref } from './prefs.js';
import { activeHabits } from './habits.js';
import { weekReview } from './review.js';
import { dayLog } from './journal.js';
import { spentBetween, unusualExpense, unusualText } from './money.js';
import { todayLoad, wordOfDay } from './academy.js';
import { activeExperiments, phaseOf } from './experiments.js';
import { parseCapture, captureLabel, buildCapture } from './capture.js';
import { strengthDays, doneWorkouts, WEEKLY_STRENGTH_GOAL } from './workouts.js';
import { openFocus, hasRunningFocus, focusMinutes } from './focus.js';
import { makeNote, templateText } from './notes.js';
import { upcomingBirthdays, dueContacts } from './people.js';
import { okrsOf, okrPace } from './okr.js';
import { makeIntention, intentionOf, decisionsDue, lowMoodNotice, LOW_MOOD_TEXT } from './reflect.js';
import { lightDayHint, overloadHint, caffeineHint, restDayHint } from './hints.js';
import { unseenChanges } from './changelog.js';
import { VERSION } from './version.js';
import { activeSick, startSick, endSick } from './sick.js';
import { checkupsDue } from './prevent.js';
import { planDay, planText, rankTasks } from './planday.js';
import { parkedDue, finishPark } from './parked.js';
import { createMoneyNudge } from './view-money-nudge.js';
import { createDeviceHints } from './view-device-hints.js';
import { createDayCards } from './view-day-cards.js';
import { lessonSkillStatus } from './skills.js';
import * as vault from './vault.js';
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

  const obList = el('ul', { class: 'steps', id: 'ob-steps' });
  const onboarding = el('div', { id: 'onboarding', class: 'card', hidden: true },
    el('strong', { textContent: 'Добро пожаловать в Life OS' }),
    el('p', { class: 'muted', textContent: 'Пять шагов, чтобы приложение начало работать на тебя. Данные хранятся только у тебя, шифруются на устройстве.' }),
    obList,
    el('div', { class: 'row' }, el('button', { type: 'button', textContent: 'Понятно', onclick: () => { setPref('onboardingDone', true); onboarding.hidden = true; } })));
  function renderOnboarding() {
    const has = t => events.some(e => e.type === t);
    const steps = [
      ['task', 'Добавь первую задачу', has('task'), () => input.focus()],
      ['checkin', 'Сделай отметку дня (Дневник)', has('checkin'), () => go('diary')],
      ['lesson', 'Пройди первый урок (Развитие → Учёба)', has('lesson'), () => go('learn')],
      ['test', 'Пройди первую проверку (Развитие → Тесты)', has('testrun'), () => go('tests')],
      ['lock', 'Включи защиту паролем (Ещё)', vault.hasVault(), () => go('more')],
    ];
    const left = steps.filter(s => !s[2]).length;
    onboarding.hidden = getPref('onboardingDone') || left === 0 || !!getPref('simple');
    obList.replaceChildren(...steps.map(([id, text, done, act]) => el('li', { class: done ? 'done' : '', dataset: { step: id } },
      el('span', { class: 'ob-mark', textContent: done ? '✓' : '○', 'aria-hidden': 'true' }),
      done ? el('span', { textContent: text }) : el('button', { type: 'button', class: 'link', textContent: text, onclick: act }))));
  }

  // фокус-таймер
  const focusHost = el('div', { id: 'focus-host', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Фокус' });
  const startFocus = (resume = false) => { openFocus(focusHost, { tasks: events.filter(e => e.type === 'task' && !e.payload.done).map(e => e.payload.text), resume }); focusHost.focus({ preventScroll: true }); };

  // слово дня: английский и иврит, перевод по касанию
  const wotd = el('div', { id: 'wotd', class: 'card tight', hidden: true });
  function renderWotd(today) {
    const rows = ['english', 'hebrew'].map(id => wordOfDay(today, id)).filter(Boolean);
    wotd.hidden = !rows.length || getPref('wotdHidden') === today || !!getPref('simple');
    wotd.replaceChildren(el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: 'Слово дня' }),
      el('button', { type: 'button', class: 'link', 'aria-label': 'Скрыть слово дня', textContent: 'скрыть', onclick: () => { setPref('wotdHidden', today); wotd.hidden = true; } })),
      ...rows.map(w => {
        const back = el('span', { class: 'muted', hidden: true, textContent: ` — ${w.back}` });
        const btn = el('button', { type: 'button', class: 'link wotd-show', dataset: { track: w.track }, textContent: w.front, onclick: () => { back.hidden = !back.hidden; } });
        return el('p', { class: 'wotd-row', dataset: { track: w.track } }, btn, back);
      }));
  }

  // намерение дня: одна строка «что сегодня зависит от меня»
  let editingIntent = false;
  const intInput = el('input', { id: 'intent-input', type: 'text', maxLength: 160, placeholder: 'Что сегодня зависит от меня? Одна строка', autocomplete: 'off' });
  const intForm = el('form', { id: 'intent-form', class: 'row' }, intInput, el('button', { type: 'submit', id: 'intent-save', class: 'primary', textContent: 'Записать' }));
  intForm.onsubmit = async e => {
    e.preventDefault();
    try {
      const today = todayStr();
      const ev = makeIntention(today, intInput.value, Date.now(), intentionOf(events, today));
      editingIntent = false; intInput.value = '';                  // до сохранения: оно перерисует экран
      await store.save(ev);
      toast('Намерение дня записано');
    } catch (err) { toast(err.message); }
  };
  const intentionBox = el('div', { id: 'intention', class: 'card tight' });
  function renderIntention(today) {
    const cur = intentionOf(events, today);
    if (cur && !editingIntent) {
      intentionBox.replaceChildren(el('div', { class: 'row' }, el('span', { class: 'muted', textContent: 'Намерение дня' }), el('strong', { id: 'intent-text', class: 'grow', textContent: cur.payload.text }),
        el('button', { type: 'button', id: 'intent-edit', class: 'link', textContent: 'изменить', onclick: () => { editingIntent = true; intInput.value = cur.payload.text; renderIntention(todayStr()); intInput.focus(); } })));
    } else intentionBox.replaceChildren(intForm);
  }

  // мягкие подсказки: мало сил, слишком много дел, долго низкое настроение
  const hintsBox = el('div', { id: 'hints' });
  function hintCard(id, text, ...buttons) { return el('div', { id, class: 'card calm hint-card' }, el('p', { textContent: text }), el('div', { class: 'row wrap' }, ...buttons)); }
  function renderHints(today, heavy) {
    const out = [];
    const sickEv = activeSick(events, today);
    if (sickEv) out.push(hintCard('sick-banner', 'Режим болезни: привычки и серии на паузе, пропуски не считаются срывом, проверки и напоминания о привычках отложены. Отдыхай.',
      el('button', { type: 'button', id: 'sick-banner-end', class: 'chip', textContent: 'Я поправился', onclick: async () => { await store.save(endSick(sickEv)); toast('Рад, что стало лучше. Серии продолжатся.'); } })));
    const light = !heavy && !sickEv && getPref('lightDayAsked') !== today && lightDayHint(events, today);
    if (light) out.push(hintCard('hint-light', light.text,
      el('button', { type: 'button', id: 'hint-light-on', class: 'chip', textContent: 'Включить «Тяжёлый день»', onclick: () => { setPref('heavyDay', true); setPref('lightDayAsked', today); render(); } }),
      el('button', { type: 'button', id: 'hint-light-sick', class: 'chip', textContent: 'Я заболел', onclick: async () => { try { setPref('lightDayAsked', today); await store.save(startSick(events)); } catch (e) { toast(e.message); } } }),
      el('button', { type: 'button', class: 'chip', textContent: 'Не сейчас', onclick: () => { setPref('lightDayAsked', today); render(); } })));
    const caf = !sickEv && getPref('caffeineAsked') !== today && caffeineHint(events, today);
    if (caf) out.push(hintCard('hint-caffeine', caf.text,
      el('button', { type: 'button', id: 'hint-caffeine-exp', class: 'chip', textContent: 'Проверить экспериментом', onclick: () => { setPref('caffeineAsked', today); go('insights'); } }),
      el('button', { type: 'button', class: 'chip', textContent: 'Понял', onclick: () => { setPref('caffeineAsked', today); render(); } })));
    const rest = !heavy && !sickEv && getPref('restAsked') !== today && restDayHint(events, today);
    if (rest) out.push(hintCard('hint-rest', rest.text,
      el('button', { type: 'button', id: 'hint-rest-on', class: 'chip', textContent: 'Включить «Тяжёлый день»', onclick: () => { setPref('heavyDay', true); setPref('restAsked', today); render(); } }),
      el('button', { type: 'button', class: 'chip', textContent: 'Понял', onclick: () => { setPref('restAsked', today); render(); } })));
    const over = !heavy && !sickEv && getPref('overloadAsked') !== today && overloadHint(events, today);
    if (over) out.push(hintCard('hint-overload', over.text,
      el('button', { type: 'button', id: 'hint-overload-on', class: 'chip', textContent: 'Оставить три главных', onclick: () => { setPref('heavyDay', true); setPref('overloadAsked', today); render(); } }),
      el('button', { type: 'button', class: 'chip', textContent: 'Справлюсь', onclick: () => { setPref('overloadAsked', today); render(); } })));
    if (lowMoodNotice(events, today) && (getPref('lowMoodUntil') || '') < today) out.push(hintCard('hint-lowmood', LOW_MOOD_TEXT,
      el('button', { type: 'button', id: 'hint-lowmood-go', class: 'chip', textContent: 'Что меня заряжает', onclick: () => go('reflect') }),
      el('button', { type: 'button', id: 'hint-lowmood-hide', class: 'chip', textContent: 'Понятно, напомнить через неделю', onclick: () => { setPref('lowMoodUntil', addDays(today, 7)); render(); } })));
    hintsBox.replaceChildren(...out);
  }

  // что нового: один раз после обновления
  const whatsNew = el('div', { id: 'whatsnew', class: 'card calm', hidden: true });
  function renderWhatsNew() {
    const last = getPref('lastSeenVersion');
    if (!last) { setPref('lastSeenVersion', VERSION); whatsNew.hidden = true; return; }       // первая установка: ничего не показываем
    const list = unseenChanges(last, VERSION);
    whatsNew.hidden = !list.length;
    if (!list.length) { whatsNew.replaceChildren(); return; }
    fill(whatsNew, el('strong', { textContent: `Что нового в ${VERSION}` }),
      ...list.flatMap(c => [list.length > 1 ? el('div', { class: 'muted', textContent: c.version }) : null, el('ul', { class: 'plain' }, ...c.items.map(t => el('li', { textContent: t })))]),
      el('button', { type: 'button', id: 'whatsnew-ok', class: 'chip', textContent: 'Понятно', onclick: () => { setPref('lastSeenVersion', VERSION); renderWhatsNew(); } }));
  }

  // отложенное: то, что вчера записали «на потом»
  const parkedBox = el('div', { id: 'parked', class: 'card calm', hidden: true });
  function renderParked(today) {
    const due = parkedDue(events, today);
    parkedBox.hidden = !due.length;
    if (parkedBox.hidden) { parkedBox.replaceChildren(); return; }
    fill(parkedBox, el('strong', { textContent: 'Отложенное: самое время вернуться' }),
      ...due.map(e => el('div', { class: 'row park-due', dataset: { id: e.id } }, el('span', { class: 'grow', textContent: e.payload.text }),
        el('button', { type: 'button', class: 'chip park-done', textContent: 'Разобрал', onclick: () => store.save(finishPark(e)) }),
        el('button', { type: 'button', class: 'chip park-snooze', textContent: 'Ещё на день', onclick: () => store.save({ ...e, payload: { ...e.payload, forDate: addDays(today, 1) } }) }))));
  }

  // деньги: желания, которые отлежали сутки, и просроченные долги
  const moneyNudge = createMoneyNudge({ go });
  const deviceHints = createDeviceHints({ go });
  const dayCards = createDayCards();

  // план дня: предложение по порядку и времени (не сохраняется)
  const planCard = el('details', { id: 'plan-day', class: 'card', hidden: true });
  function renderPlan(today) {
    const d = new Date(), plan = planDay(events, today, { nowMinutes: d.getHours() * 60 + d.getMinutes() });
    planCard.hidden = !plan.items.length || !!getPref('simple');
    if (planCard.hidden) { planCard.replaceChildren(); return; }               // текст задач не должен оставаться в скрытой разметке (при блокировке тоже)
    fill(planCard, el('summary', { textContent: 'План дня (предложение)' }),
      el('ul', { class: 'plain plan-list' }, ...plan.items.map(i => el('li', { class: 'plan-row', dataset: { kind: i.kind } }, el('strong', { textContent: `${i.from}–${i.to}` }), ` ${i.text}`))),
      plan.dropped.length ? el('p', { class: 'muted', textContent: `Не уместилось до вечера: ${plan.dropped.join('; ')}` }) : null,
      el('button', { type: 'button', id: 'plan-copy', class: 'chip', textContent: 'Скопировать', onclick: () => { navigator.clipboard?.writeText(planText(plan, today)).then(() => toast('План скопирован'), () => toast('Не удалось скопировать')); } }));
  }

  // ----- форма добавления -----
  const input = el('input', { id: 'add-input', type: 'text', placeholder: 'Задача, расход или замер…', enterKeyHint: 'done', maxLength: 500, required: true, autocomplete: 'off' });
  const addBtn = el('button', { type: 'submit', 'aria-label': 'Добавить', textContent: '+' });
  const due = el('input', { id: 'add-due', type: 'date' });
  const rep = repeatSelect('', ''); rep.id = 'add-repeat';
  const high = el('input', { id: 'add-high', type: 'checkbox' });
  const hint = el('div', { id: 'add-hint', class: 'hint', hidden: true });
  const cap = el('div', { id: 'cap-suggest', class: 'hint', hidden: true });
  const form = el('form', { id: 'add-form', autocomplete: 'off' },
    el('div', { class: 'add-row' }, input, addBtn),
    el('div', { class: 'opts-row' },
      el('label', {}, 'Срок ', due), el('label', {}, 'Повтор ', rep),
      el('label', { class: 'check-label' }, high, ' Важное')),
    hint, cap);

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
  // умный ввод: «потратил 350 на кофе», «вес 72,4», «заметка: …» — предлагаем, человек подтверждает
  function updateCapture() {
    cap.replaceChildren();
    if (due.value || rep.value || !input.value.trim()) { cap.hidden = true; return; }
    const habits = activeHabits(events, todayStr()).map(({ h }) => ({ id: h.id, name: h.payload.name }));
    const c = parseCapture(input.value, { habits });
    if (!c) { cap.hidden = true; return; }
    cap.append(el('span', { textContent: c.confidence === 'mid' ? 'Возможно, это: ' : 'Это похоже на: ' }),
      el('button', { type: 'button', id: 'cap-chip', class: 'chip', textContent: `Добавить ${captureLabel(c)}`, onclick: async () => {
        try {
          const ev = buildCapture(c, { habits });
          input.value = ''; updateHint(); updateCapture();
          await store.save(ev);
          const odd = ev.type === 'expense' ? unusualExpense(events, ev) : null;
          toast(odd ? unusualText(odd, ev.payload.category) : `Добавлено: ${captureLabel(c)}`, { actionLabel: 'Отменить', onAction: () => store.remove(ev.id) });
        } catch (err) { toast('Не удалось добавить: ' + err.message); }
      } }));
    cap.hidden = false;
  }
  input.addEventListener('input', () => { skipParse = false; updateHint(); updateCapture(); });
  due.addEventListener('input', updateHint); rep.addEventListener('input', updateHint);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    let text = input.value.trim();
    if (!text) return;
    let d = due.value || null, r = rep.value || null;
    const q = parsed();
    if (q) { text = q.text; d = q.due; r = q.repeat; }
    const pr = high.checked ? 'high' : 'normal';
    input.value = ''; due.value = ''; rep.value = ''; high.checked = false; skipParse = false; updateHint(); updateCapture();   // чистим сразу — быстрый ввод не теряется
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
  const minList = el('ul', { class: 'list open' });
  const minimum = el('div', { id: 'minimum', class: 'card', hidden: true }, el('div', { class: 'mini-head' }, el('h3', { textContent: 'Минимум на сегодня' }),
    el('button', { type: 'button', id: 'heavy-off', class: 'chip', textContent: 'Выйти из режима', onclick: () => { setPref('heavyDay', false); render(); } })),
    el('p', { class: 'muted', textContent: 'Тяжёлый день: только самое важное. Три дела, остальное подождёт. Привычки — в минимальной версии.' }), minList);
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

  root.append(hello, dateLine, whatsNew, summary, hintsBox, deviceHints.root, parkedBox, moneyNudge.root, intentionBox, planCard, dayCards.root, onboarding, wotd, focusHost, form, minimum, review, journal, ...Object.values(sections).map(s => s.sec), empty, doneBlock);

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
    const chips = [], opt = [];                       // opt — необязательные чипы: в простом режиме их нет
    chips.push(el('span', { class: 'chip static', textContent: `Задач: ${g.openCount}` }));
    if (g.overdue.length) chips.push(el('span', { class: 'chip static danger', textContent: `Просрочено: ${g.overdue.length}` }));
    const hs = activeHabits(events, today);
    const real = events.filter(e => e.type !== 'profile' && e.type !== 'budget').length;
    const last = getPref('lastBackupAt');
    const every = getPref('backupEveryDays');
    if (every > 0 && real >= 5 && (!last || Date.now() - last > every * 86400000)) chips.push(el('button', { type: 'button', id: 'backup-chip', class: 'chip', textContent: 'Сделай резервную копию', onclick: () => go('more') }));
    const sickNow = !!activeSick(events, today);
    if (hs.length) chips.push(el('button', { type: 'button', class: 'chip', textContent: sickNow ? 'Привычки: пауза' : (() => { const plan = hs.filter(x => x.st.scheduledToday || x.st.doneToday); return plan.length ? `Привычки: ${plan.filter(x => x.st.doneToday).length}/${plan.length}` : 'Привычки: сегодня не по плану'; })(), onclick: () => go('habits') }));
    const spent = spentBetween(events, today, today);
    if (spent) opt.push(el('button', { type: 'button', class: 'chip', textContent: `Потрачено сегодня: ${moneyText(spent)}`, onclick: () => go('money') }));
    const load = todayLoad(events, today);
    if (load.due + load.fresh) opt.push(el('button', { type: 'button', id: 'learn-chip', class: 'chip', textContent: `Повторение: ${load.due + load.fresh}`, onclick: () => go('learn') }));
    if (!events.some(e => e.type === 'checkin' && e.payload.date === today && e.payload.slot === 'm')) chips.push(el('button', { type: 'button', id: 'checkin-chip', class: 'chip', textContent: 'Отметка утра', onclick: () => go('diary') }));
    if (!sickNow && !events.some(e => e.type === 'testrun' && e.payload.date === today)) opt.push(el('button', { type: 'button', id: 'test-chip', class: 'chip', textContent: 'Проверка дня', onclick: () => go('tests') }));
    chips.push(el('button', { type: 'button', id: 'heavy-chip', class: 'chip', textContent: getPref('heavyDay') ? 'Тяжёлый день: включён' : 'Тяжёлый день', 'aria-pressed': String(!!getPref('heavyDay')), onclick: () => { setPref('heavyDay', !getPref('heavyDay')); render(); } }));
    const goalsOn = okrsOf(events, 'active');
    const skillsReady = lessonSkillStatus(events).ready.length;
    if (skillsReady) opt.push(el('button', { type: 'button', id: 'skills-chip', class: 'chip', textContent: `Новые навыки: ${skillsReady}`, onclick: () => go('skills') }));
    if (goalsOn.length) opt.push(el('button', { type: 'button', id: 'okr-chip', class: 'chip', textContent: `Цели: ${goalsOn.length}${goalsOn.some(g => okrPace(g, today).state === 'behind') ? ' ⚠' : ''}`, onclick: () => go('okr') }));
    const bds = upcomingBirthdays(events, today, 7), dueP = dueContacts(events, today);
    if (bds.length) opt.push(el('button', { type: 'button', id: 'bday-chip', class: 'chip', textContent: `🎂 ${bds[0].person.payload.name}: ${bds[0].inDays === 0 ? 'сегодня' : bds[0].inDays === 1 ? 'завтра' : `через ${bds[0].inDays} дн.`}${bds.length > 1 ? ` (+${bds.length - 1})` : ''}`, onclick: () => go('people') }));
    if (dueP.length) opt.push(el('button', { type: 'button', id: 'contact-chip', class: 'chip', textContent: `Написать: ${dueP.length}`, onclick: () => go('people') }));
    const chkDue = checkupsDue(events, today);
    if (chkDue.length) opt.push(el('button', { type: 'button', id: 'checkup-chip', class: 'chip', textContent: `Профилактика: ${chkDue.length}`, onclick: () => go('health') }));
    const decDue = decisionsDue(events, today);
    if (decDue.length) opt.push(el('button', { type: 'button', id: 'decision-chip', class: 'chip', textContent: `Решения: ${decDue.length} пора оценить`, onclick: () => go('reflect') }));
    const fm = focusMinutes(events, today);
    opt.push(el('button', { type: 'button', id: 'focus-chip', class: 'chip', textContent: fm ? `Фокус: ${fm} мин` : 'Фокус', onclick: () => startFocus() }));
    if (doneWorkouts(events).length) opt.push(el('button', { type: 'button', id: 'strength-chip', class: 'chip', textContent: `Силовые: ${strengthDays(events, today)}/${WEEKLY_STRENGTH_GOAL}`, onclick: () => go('workouts') }));
    for (const e of activeExperiments(events, today)) opt.push(el('button', { type: 'button', class: 'chip exp-chip', dataset: { exp: e.id }, textContent: `Эксперимент: фаза ${phaseOf(e.payload, today)}`, onclick: () => go('insights') }));
    if (!getPref('simple')) chips.push(...opt);
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
    const f1 = v => String(Math.round(v * 10) / 10).replace('.', ',');
    const hl = [];
    if (r.health.sleepDays) hl.push(`Сон: в среднем ${f1(r.health.sleepAvg)} ч (лучшая ночь ${f1(r.health.sleepBest)}, худшая ${f1(r.health.sleepWorst)}; отметок: ${r.health.sleepDays})`);
    if (r.health.activityDays) hl.push(`Активность: ${r.health.activityMinutes} из ${r.health.activityGoal} минут (ориентир ВОЗ — 150 и больше в неделю)`);
    if (r.health.strengthDays) hl.push(`Силовых дней: ${r.health.strengthDays} из ${WEEKLY_STRENGTH_GOAL}`);
    if (r.health.moodAvg !== null) hl.push(`Настроение: в среднем ${f1(r.health.moodAvg)} из 5`);
    if (hl.length) lines.push(el('p', { id: 'review-health', class: 'muted', textContent: hl.join(' · ') }));
    lines.push(el('p', { id: 'review-active', class: 'muted', textContent: `Дней с делом за ${r.active.of} дней: ${r.active.count}${r.active.streak ? ` · подряд: ${r.active.streak}` : ''}. Считается любое дело: минимум привычки, задача, урок, отметка, фокус.` }));
    lines.push(el('p', { id: 'review-variety', class: 'muted', textContent: `Разнообразие недели: ${r.variety.count} из ${r.variety.total} областей (${r.variety.areas.join(', ') || 'пока ничего'})${r.variety.reached ? ' · разносторонняя неделя ✓' : r.variety.missing.length ? `. Пусто: ${r.variety.missing.join(', ')}` : ''}` }));
    if (r.focus.minutes) lines.push(el('p', { id: 'review-focus', class: 'muted', textContent: `Фокус: ${r.focus.minutes} мин за неделю (сессий: ${r.focus.sessions}, дней: ${r.focus.days})` }));
    if (r.growth.lessons || r.growth.reviews || r.growth.tests) lines.push(el('p', { id: 'review-growth', class: 'muted', textContent: `Развитие: уроков ${r.growth.lessons}, ответов на карточки ${r.growth.reviews}, проверок ${r.growth.tests}` }));
    lines.push(el('button', { type: 'button', id: 'plan-week', class: 'chip', textContent: 'Составить план недели (заметка)', onclick: async () => { await store.save(makeNote(templateText('weekly', todayStr()))); toast('План недели создан в заметках', { actionLabel: 'Открыть', onAction: () => go('notes') }); } }));
    reviewBody.replaceChildren(...lines);
  }

  // три главных дела для тяжёлого дня: сначала «важное», затем по срокам (просроченное и сегодняшнее раньше)
  function renderMinimum(g, today, heavy) {
    minimum.hidden = !heavy;
    if (!heavy) return;
    const pick = rankTasks(events, today).slice(0, 3);
    minList.replaceChildren(...(pick.length ? pick.map(e => item(e, today)) : [el('li', { class: 'muted', textContent: 'Задач нет. Отдохни.' })]));
  }
  const moveOverdue = el('button', { type: 'button', id: 'move-overdue', class: 'chip', textContent: 'Перенести всё на сегодня', onclick: async () => {
    const today = todayStr();
    const old = events.filter(e => e.type === 'task' && !e.payload.done && e.payload.due && e.payload.due < today);
    if (!old.length) return;
    await store.saveMany(old.map(e => updateTask(e, { text: e.payload.text, due: today, repeat: e.payload.repeat?.type || '', priority: e.payload.priority })));
    toast(`Перенесено на сегодня: ${old.length}`, { actionLabel: 'Отменить', onAction: () => store.saveMany(old) });
  } });
  sections.overdue.sec.insertBefore(moveOverdue, sections.overdue.ul);

  function render() {
    const today = todayStr();
    const profile = profileOf(events);
    hello.textContent = profile?.payload.name ? `Привет, ${profile.payload.name}` : '';
    hello.hidden = !hello.textContent;
    const [y, m, d] = today.split('-').map(Number);
    const ds = new Date(y, m - 1, d, 12).toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });
    dateLine.textContent = ds.charAt(0).toUpperCase() + ds.slice(1);
    renderOnboarding();
    renderWotd(today);
    const g = groupTasks(events, today);
    const heavy = !!getPref('heavyDay');
    renderWhatsNew(); renderIntention(today); renderHints(today, heavy); renderParked(today); moneyNudge.update(events); deviceHints.update(events); renderPlan(today); dayCards.update(events);
    renderMinimum(g, today, heavy);
    for (const key of Object.keys(sections)) {
      sections[key].sec.hidden = heavy || g[key].length === 0;
      sections[key].ul.replaceChildren(...g[key].map(e => item(e, today)));
    }
    const simple = !!getPref('simple');
    doneBlock.hidden = heavy; review.hidden = heavy || simple; journal.hidden = heavy || simple;
    doneList.replaceChildren(...g.done.slice(0, 50).map(e => item(e, today)));
    doneCount.textContent = g.done.length;
    clearDone.hidden = g.done.length === 0;
    empty.hidden = heavy || g.openCount > 0;
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
    show() { render(); if (focusHost.hidden && hasRunningFocus()) startFocus(true); },
  };
}
