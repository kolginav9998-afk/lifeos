// Экран «Рефлексия»: вечерний обзор, итоги недели, журнал решений, копилка радостей и «что меня заряжает».
import { el, fill, toast, dateRu } from './ui.js';
import { todayStr, addDays } from './events.js';
import * as store from './store.js';
import { getPref, setPref } from './prefs.js';
import {
  DAY_QUESTIONS, WEEK_QUESTIONS, VERDICTS, CHARGER_IDEAS, LOW_MOOD_TEXT,
  RITUAL_STEPS, makeRitual, ritualOf,
  makeDayReview, dayReviewOf, makeWeekReflection, weekReflectionOf, weekReflections, weekStart,
  makeDecision, closeDecision, decisionsOf, decisionStats, makeJoy, joysOf, pickJoy, makeCharger, chargersOf, lowMoodNotice,
} from './reflect.js';

const area = (id, ph, rows = 2) => el('textarea', { id, rows, maxLength: 600, placeholder: ph });

export function createReflectView() {
  let events = [];
  const root = el('section', { id: 'view-reflect', class: 'view' });
  const dirty = { rv: false, wk: false };
  let joyShown = 0;

  // ----- предупреждение о долго низком настроении -----
  const lowBox = el('div', { id: 'lowmood', class: 'card calm', hidden: true });

  // ----- вечерний обзор -----
  const rv = Object.fromEntries(DAY_QUESTIONS.map(([k, q]) => [k, area(`rv-${k}`, 'Одна-две строки', 2)]));
  for (const x of Object.values(rv)) x.addEventListener('input', () => { dirty.rv = true; });
  const rvSave = el('button', { type: 'button', id: 'rv-save', class: 'primary', textContent: 'Сохранить обзор' });
  const rvState = el('p', { class: 'muted', id: 'rv-state' });
  rvSave.onclick = async () => {
    try {
      const date = todayStr();
      await store.save(makeDayReview(date, Object.fromEntries(Object.entries(rv).map(([k, x]) => [k, x.value])), Date.now(), dayReviewOf(events, date)));
      dirty.rv = false; toast('Обзор дня сохранён');
    } catch (e) { toast(e.message); }
  };
  const rvCard = el('div', { class: 'card', id: 'rv-card' }, el('strong', { textContent: 'Вечерний обзор' }),
    el('p', { class: 'muted', textContent: 'Три коротких ответа перед сном: что получилось, что мешало, что изменю. Хватит одной строки.' }),
    ...DAY_QUESTIONS.map(([k, q]) => el('label', { class: 'field' }, el('span', { class: 'rating-label', textContent: q }), rv[k])), rvSave, rvState);

  // ----- вечерний ритуал -----
  const ritBoxes = {};
  for (const [k] of RITUAL_STEPS) ritBoxes[k] = el('input', { type: 'checkbox', class: 'rit-step', id: `rit-${k}`, dataset: { step: k } });
  const ritProgress = el('p', { class: 'muted', id: 'rit-progress' });
  async function saveRitual() {
    const date = todayStr(), prev = ritualOf(events, date), on = RITUAL_STEPS.map(([k]) => k).filter(k => ritBoxes[k].checked);
    try {
      if (!on.length) { if (prev) await store.remove(prev.id); return; }
      await store.save(makeRitual(date, on, Date.now(), prev));
    } catch (e) { toast(e.message); }
  }
  for (const b of Object.values(ritBoxes)) b.onchange = () => { ritProgress.textContent = `Сделано: ${Object.values(ritBoxes).filter(x => x.checked).length} из ${RITUAL_STEPS.length}`; saveRitual(); };
  const groups = [...new Set(RITUAL_STEPS.map(x => x[2]))];
  const ritCard = el('div', { class: 'card', id: 'rit-card' }, el('strong', { textContent: 'Вечерний ритуал' }),
    el('p', { class: 'muted', textContent: 'Короткий порядок на вечер помогает спокойно закончить день и лучше заснуть.' }),
    ...groups.flatMap(g => [el('div', { class: 'rating-label', textContent: g }), ...RITUAL_STEPS.filter(x => x[2] === g).map(([k, text]) => el('label', { class: 'check-label rit-row' }, ritBoxes[k], ` ${text}`))]), ritProgress);

  // ----- рефлексия недели -----
  const wk = Object.fromEntries(WEEK_QUESTIONS.map(([k, q]) => [k, area(`wk-${k}`, 'Пара предложений', 3)]));
  for (const x of Object.values(wk)) x.addEventListener('input', () => { dirty.wk = true; });
  const wkSave = el('button', { type: 'button', id: 'wk-save', class: 'primary', textContent: 'Сохранить итоги недели' });
  wkSave.onclick = async () => {
    try {
      const date = todayStr();
      await store.save(makeWeekReflection(date, Object.fromEntries(Object.entries(wk).map(([k, x]) => [k, x.value])), Date.now(), weekReflectionOf(events, date)));
      dirty.wk = false; toast('Итоги недели сохранены');
    } catch (e) { toast(e.message); }
  };
  const wkPast = el('details', { id: 'wk-past', class: 'plain-details' });
  const wkLabel = el('p', { class: 'muted', id: 'wk-label' });
  const wkCard = el('div', { class: 'card', id: 'wk-card' }, el('strong', { textContent: 'Итоги недели' }), wkLabel,
    ...WEEK_QUESTIONS.map(([k, q]) => el('label', { class: 'field' }, el('span', { class: 'rating-label', textContent: q }), wk[k])), wkSave, wkPast);

  // ----- журнал решений -----
  const decTitle = el('input', { id: 'dec-title', type: 'text', maxLength: 120, placeholder: 'Какое решение принял?', autocomplete: 'off' });
  const decWhy = area('dec-why', 'Почему так? Какие были варианты?');
  const decExpect = area('dec-expect', 'Что ожидаю получить?');
  const decRevisit = el('input', { id: 'dec-revisit', type: 'date', 'aria-label': 'Вернуться к решению' });
  const decErr = el('p', { class: 'error', id: 'dec-err' });
  const decForm = el('form', { class: 'form-stack' }, decTitle, decWhy, decExpect, el('label', {}, 'Вернуться и оценить: ', decRevisit),
    el('button', { type: 'submit', id: 'dec-add', class: 'primary', textContent: 'Записать решение' }), decErr);
  decForm.onsubmit = async e => {
    e.preventDefault();
    try {
      await store.save(makeDecision({ title: decTitle.value, why: decWhy.value, expect: decExpect.value, revisit: decRevisit.value || undefined }));
      decTitle.value = ''; decWhy.value = ''; decExpect.value = ''; decRevisit.value = ''; decErr.textContent = '';
    } catch (x) { decErr.textContent = x.message; }
  };
  const decCard = el('div', { class: 'card', id: 'dec-card' });

  function decisionRow(ev, today) {
    const p = ev.payload, due = p.revisit <= today;
    const verdict = el('select', { class: 'dec-verdict', 'aria-label': 'Как получилось' }, el('option', { value: '', textContent: 'Как получилось?' }), ...Object.entries(VERDICTS).map(([v, t]) => el('option', { value: v, textContent: t })));
    const outcome = el('textarea', { class: 'dec-outcome', rows: 2, maxLength: 600, placeholder: 'Что вышло на самом деле? Чему это научило?' });
    const done = el('button', { type: 'button', class: 'chip dec-close', textContent: 'Сохранить итог', onclick: async () => {
      try { await store.save(closeDecision(ev, { verdict: verdict.value, outcome: outcome.value })); toast('Итог записан'); } catch (e) { toast(e.message); }
    } });
    return el('div', { class: `dec${due ? ' due' : ''}`, dataset: { id: ev.id } },
      el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: p.title }), el('span', { class: `badge ${due ? 'bad' : 'good'}`, textContent: due ? 'пора оценить' : `до ${dateRu(p.revisit)}` })),
      p.expect ? el('p', { class: 'muted', textContent: `Ожидал: ${p.expect}` }) : null,
      el('details', {}, el('summary', { textContent: 'Подвести итог' }), el('div', { class: 'form-stack' }, verdict, outcome, done)),
      el('button', { type: 'button', class: 'chip danger dec-del', textContent: 'Удалить', onclick: async () => { const old = await store.remove(ev.id); toast('Решение удалено', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }));
  }
  function renderDecisions(today) {
    const { open, closed } = decisionsOf(events), st = decisionStats(events);
    fill(decCard, el('strong', { textContent: 'Журнал решений' }),
      el('p', { class: 'muted', textContent: 'Запиши важное решение и чего ждёшь от него. Через время вернись и честно сравни: так видно, где ты угадываешь, а где нет.' }),
      st ? el('p', { class: 'muted', id: 'dec-stats', textContent: `Оценено решений: ${st.n}. Лучше ожиданий: ${st.better}, как ждал: ${st.asExpected}, хуже: ${st.worse}.` }) : null,
      el('details', { id: 'dec-new' }, el('summary', { textContent: 'Новое решение' }), decForm),
      ...open.map(e => decisionRow(e, today)),
      closed.length ? el('details', { id: 'dec-closed' }, el('summary', { textContent: `Оценённые (${closed.length})` }),
        ...closed.map(e => el('div', { class: 'dec-done', dataset: { id: e.id } }, el('strong', { textContent: e.payload.title }),
          el('p', { class: 'muted', textContent: `${VERDICTS[e.payload.closed.verdict]}${e.payload.closed.outcome ? ` — ${e.payload.closed.outcome}` : ''}` })))) : null);
  }

  // ----- копилка радостей -----
  const joyText = el('input', { id: 'joy-text', type: 'text', maxLength: 200, placeholder: 'Что сегодня порадовало?', autocomplete: 'off' });
  const joyAdd = el('button', { type: 'submit', id: 'joy-add', class: 'primary', textContent: 'В копилку' });
  const joyErr = el('p', { class: 'error', id: 'joy-err' });
  const joyForm = el('form', { class: 'row' }, joyText, joyAdd);
  joyForm.onsubmit = async e => { e.preventDefault(); try { await store.save(makeJoy({ text: joyText.value })); joyText.value = ''; joyErr.textContent = ''; } catch (x) { joyErr.textContent = x.message; } };
  const joyPick = el('p', { id: 'joy-pick', class: 'joy-pick', hidden: true });
  const joyCard = el('div', { class: 'card', id: 'joy-card' });
  function renderJoys() {
    const list = joysOf(events);
    const rnd = list.length ? el('button', { type: 'button', id: 'joy-random', class: 'chip', textContent: 'Вспомнить хорошее', onclick: () => { const j = pickJoy(events, joyShown++ + Math.floor(Math.random() * 1000)); joyPick.hidden = !j; joyPick.textContent = j ? `${dateRu(j.payload.date)}: ${j.payload.text}` : ''; } }) : null;
    fill(joyCard, el('strong', { textContent: 'Копилка радостей' }),
      el('p', { class: 'muted', textContent: 'Записывай маленькие хорошие моменты. В трудный день их можно перечитать.' }), joyForm, joyErr, rnd, joyPick,
      ...list.slice(0, 5).map(j => el('div', { class: 'row joy-row', dataset: { id: j.id } }, el('span', { class: 'muted', textContent: dateRu(j.payload.date) }), el('span', { class: 'grow', textContent: j.payload.text }),
        el('button', { type: 'button', class: 'chip danger', 'aria-label': 'Удалить', textContent: '✕', onclick: async () => { const old = await store.remove(j.id); toast('Удалено', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }))),
      list.length > 5 ? el('p', { class: 'muted', textContent: `…и ещё ${list.length - 5} в копилке` }) : null);
  }

  // ----- что меня заряжает -----
  const chgText = el('input', { id: 'chg-text', type: 'text', maxLength: 80, placeholder: 'Что тебя заряжает?', autocomplete: 'off' });
  const chgErr = el('p', { class: 'error', id: 'chg-err' });
  const chgForm = el('form', { class: 'row' }, chgText, el('button', { type: 'submit', id: 'chg-add', class: 'primary', textContent: 'Добавить' }));
  chgForm.onsubmit = async e => { e.preventDefault(); try { await store.save(makeCharger(chgText.value)); chgText.value = ''; chgErr.textContent = ''; } catch (x) { chgErr.textContent = x.message; } };
  const chgCard = el('div', { class: 'card', id: 'chg-card' });
  function renderChargers() {
    const list = chargersOf(events), have = new Set(list.map(c => c.payload.text.toLowerCase()));
    chgCard.replaceChildren(el('strong', { textContent: 'Что меня заряжает' }),
      el('p', { class: 'muted', textContent: 'Список дел на плохой день: простые вещи, после которых обычно становится легче.' }),
      ...list.map(c => el('div', { class: 'row chg-row', dataset: { id: c.id } }, el('span', { class: 'grow', textContent: c.payload.text }),
        el('button', { type: 'button', class: 'chip danger', 'aria-label': `Убрать: ${c.payload.text}`, textContent: '✕', onclick: async () => { const old = await store.remove(c.id); toast('Убрано', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }))),
      el('div', { class: 'chips' }, ...CHARGER_IDEAS.filter(t => !have.has(t.toLowerCase())).slice(0, 5).map(t => el('button', { type: 'button', class: 'chip chg-idea', textContent: `＋ ${t}`, onclick: () => store.save(makeCharger(t)) }))),
      chgForm, chgErr);
  }

  root.append(lowBox, rvCard, ritCard, wkCard, decCard, joyCard, chgCard);

  function renderLow(today) {
    const n = lowMoodNotice(events, today);
    const snoozed = (getPref('lowMoodUntil') || '') >= today;
    lowBox.hidden = !n || snoozed;
    if (lowBox.hidden) return;
    lowBox.replaceChildren(el('strong', { textContent: 'О настроении' }), el('p', { textContent: LOW_MOOD_TEXT }),
      el('button', { type: 'button', id: 'lowmood-hide', class: 'chip', textContent: 'Понятно, напомнить через неделю', onclick: () => { setPref('lowMoodUntil', addDays(todayStr(), 7)); renderLow(todayStr()); } }));
  }

  function render() {
    const today = todayStr(), ws = weekStart(today);
    renderLow(today);
    if (!dirty.rv) {
      const r = dayReviewOf(events, today)?.payload ?? {};
      for (const [k] of DAY_QUESTIONS) rv[k].value = r[k] ?? '';
    }
    const rit = ritualOf(events, today);
    if (!ritCard.contains(document.activeElement)) { for (const [k] of RITUAL_STEPS) ritBoxes[k].checked = !!rit?.payload.steps.includes(k); }
    ritProgress.textContent = `Сделано: ${rit ? rit.payload.steps.length : 0} из ${RITUAL_STEPS.length}`;
    rvState.textContent = dayReviewOf(events, today) ? 'Обзор за сегодня сохранён. Можно дополнить.' : '';
    if (!dirty.wk) {
      const w = weekReflectionOf(events, today)?.payload ?? {};
      for (const [k] of WEEK_QUESTIONS) wk[k].value = w[k] ?? '';
    }
    wkLabel.textContent = `Неделя с ${dateRu(ws)}`;
    const past = weekReflections(events).filter(e => e.payload.week !== ws).slice(0, 4);
    wkPast.hidden = !past.length;
    wkPast.replaceChildren(el('summary', { textContent: `Прошлые недели (${past.length})` }),
      ...past.map(e => el('div', { class: 'wk-past-row' }, el('strong', { textContent: `Неделя с ${dateRu(e.payload.week)}` }),
        ...WEEK_QUESTIONS.filter(([k]) => e.payload[k]).map(([k, q]) => el('p', { class: 'muted', textContent: `${q.replace(/\?$/, '')}: ${e.payload[k]}` })))));
    renderDecisions(today); renderJoys(); renderChargers();
  }

  return { root, update(evs) { events = evs; if (!root.hidden) render(); }, show() { render(); } };
}
