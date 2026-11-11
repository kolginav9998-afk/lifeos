import { el, toast, dateRu, ratingRow, stepper } from './ui.js';
import { todayStr, addDays } from './events.js';
import { makeCheckin, makeDiary, checkinOf, diaryOf, recentDays, sleepFromTimes, SLOTS, RATINGS, NUMBERS, FLAGS, hashtags, questionOfDay, onThisDay } from './diary.js';
import { makeMeasure } from './health.js';
import * as store from './store.js';

export function createDiaryView() {
  let events = [];
  let date = todayStr();
  const dirty = { m: false, e: false, d: false };
  const root = el('section', { id: 'view-diary', class: 'view' });

  // ----- выбор дня -----
  const dateInput = el('input', { id: 'diary-date', type: 'date', value: date });
  const go = d => { date = d || todayStr(); dateInput.value = date; dirty.m = dirty.e = dirty.d = false; hydrate(); renderHistory(); autoOpen(); };
  dateInput.onchange = () => go(dateInput.value);
  const nav = el('div', { class: 'day-nav' },
    el('button', { type: 'button', id: 'diary-prev', 'aria-label': 'Предыдущий день', textContent: '‹', onclick: () => go(addDays(date, -1)) }),
    dateInput,
    el('button', { type: 'button', id: 'diary-next', 'aria-label': 'Следующий день', textContent: '›', onclick: () => go(addDays(date, 1)) }),
    el('button', { type: 'button', id: 'diary-today', textContent: 'Сегодня', onclick: () => go(todayStr()) }));

  // ----- утро -----
  const mW = {};     // виджеты утра по полям
  for (const f of SLOTS.m.ratings) mW[f] = ratingRow(RATINGS[f], f, null, () => { dirty.m = true; });
  const bed = el('input', { id: 'ci-bed', type: 'time' });
  const wake = el('input', { id: 'ci-wake', type: 'time' });
  mW.sleepHours = stepper({ label: 'Сон', field: 'sleepHours', ...NUMBERS.sleepHours }, () => { dirty.m = true; });
  const onTimes = () => { dirty.m = true; const h = sleepFromTimes(bed.value, wake.value); if (h !== null) mW.sleepHours.setValue(h); };
  bed.oninput = onTimes; wake.oninput = onTimes;
  const weight = el('input', { id: 'ci-weight', type: 'text', inputMode: 'decimal', placeholder: 'Вес, кг (необязательно)', autocomplete: 'off' });
  weight.oninput = () => { dirty.m = true; };
  const mSave = el('button', { id: 'ci-m-save', type: 'button', class: 'primary', textContent: 'Сохранить утро' });
  const mSum = el('summary', { id: 'ci-m-sum' });
  const mBox = el('details', { id: 'ci-m', class: 'card' }, mSum,
    el('div', { class: 'grid2' }, el('label', { class: 'rating' }, el('span', { class: 'rating-label', textContent: 'Лёг' }), bed), el('label', { class: 'rating' }, el('span', { class: 'rating-label', textContent: 'Встал' }), wake)),
    mW.sleepHours, mW.sleepQuality, mW.energy, mW.mood, mW.stress, weight, mSave);

  // ----- вечер -----
  const eW = {};
  for (const f of SLOTS.e.ratings) eW[f] = ratingRow(RATINGS[f], f, null, () => { dirty.e = true; });
  for (const f of SLOTS.e.numbers) eW[f] = stepper({ label: NUMBERS[f].label, field: f, ...NUMBERS[f] }, () => { dirty.e = true; });
  const eF = {};
  for (const f of SLOTS.e.flags) { const cb = el('input', { type: 'checkbox', id: `ci-flag-${f}`, onchange: () => { dirty.e = true; } }); eF[f] = cb; }
  const flagRow = el('div', { class: 'flags', id: 'ci-flags' }, el('span', { class: 'rating-label', textContent: 'Питание сегодня' }), ...SLOTS.e.flags.map(f => el('label', { class: 'check-label' }, eF[f], ` ${FLAGS[f]}`)));
  const eNote = el('textarea', { id: 'ci-e-note', rows: 2, maxLength: 1000, placeholder: 'Что помогло и что мешало сегодня?' });
  eNote.oninput = () => { dirty.e = true; };
  const eSave = el('button', { id: 'ci-e-save', type: 'button', class: 'primary', textContent: 'Сохранить вечер' });
  const eSum = el('summary', { id: 'ci-e-sum' });
  const eBox = el('details', { id: 'ci-e', class: 'card' }, eSum,
    ...SLOTS.e.ratings.map(f => eW[f]), el('div', { class: 'grid2' }, ...SLOTS.e.numbers.map(f => eW[f])), flagRow, eNote, eSave);

  // ----- дневник -----
  const dText = el('textarea', { id: 'diary-text', rows: 5, maxLength: 20000, placeholder: 'О чём думаешь, что произошло, что понял… (теги: #работа #семья)' });
  const dHigh = el('input', { id: 'diary-highlight', type: 'text', maxLength: 300, placeholder: 'Главное за день', autocomplete: 'off' });
  const dG = [1, 2, 3].map(i => el('input', { id: `diary-g${i}`, type: 'text', maxLength: 200, placeholder: `Благодарность ${i}`, autocomplete: 'off' }));
  const tags = el('div', { class: 'tags', id: 'diary-tags' });
  const paintTags = () => tags.replaceChildren(...hashtags(dText.value).map(t => el('span', { class: 'tag', textContent: '#' + t })));
  for (const x of [dText, dHigh, ...dG]) x.addEventListener('input', () => { dirty.d = true; paintTags(); });
  const dSave = el('button', { id: 'diary-save', type: 'button', class: 'primary', textContent: 'Сохранить запись' });
  const dDel = el('button', { id: 'diary-delete', type: 'button', class: 'danger', textContent: 'Удалить запись', hidden: true });
  const dSum = el('summary', { textContent: 'Дневник' });
  const qText = el('span', { id: 'diary-question' });
  const qBtn = el('button', { id: 'diary-ask', type: 'button', class: 'chip', textContent: 'Ответить', onclick: () => {
    const head = `${qText.textContent}\n`;
    if (!dText.value.startsWith(head)) dText.value = head + dText.value;
    dirty.d = true; paintTags(); dText.focus(); dText.setSelectionRange(dText.value.length, dText.value.length);
  } });
  qText.className = 'q-text';
  const qRow = el('div', { class: 'q-row' }, el('span', { class: 'q-label', textContent: 'Вопрос дня' }), qText, qBtn);
  const past = el('div', { id: 'diary-past' });
  const dBox = el('details', { id: 'diary-box', class: 'card', open: true }, dSum, el('div', { class: 'form-stack' }, qRow, dText, tags, dHigh, ...dG, el('div', { class: 'row' }, dSave, dDel), past));

  // ----- история -----
  const strip = el('div', { id: 'mood-strip', class: 'mood-strip', 'aria-label': 'Настроение за 14 дней' });
  const hist = el('div', { id: 'diary-history', class: 'hist' });
  const histBox = el('div', { class: 'card' }, el('strong', { textContent: 'Последние дни' }), strip, hist);

  root.append(nav, mBox, eBox, dBox, histBox);

  // ----- сохранение -----
  mSave.onclick = async () => {
    try {
      const prev = checkinOf(events, date, 'm');
      const fields = { bed: bed.value, wake: wake.value };
      for (const f of SLOTS.m.ratings) fields[f] = mW[f].value;
      fields.sleepHours = mW.sleepHours.value;
      const batch = [makeCheckin('m', date, fields, '', Date.now(), prev)];
      if (weight.value.trim()) {
        const old = events.find(e => e.id === `mw:${date}`);
        const m = makeMeasure({ kind: 'weight', value: weight.value, date, note: 'утром' });
        batch.push({ ...m, id: `mw:${date}`, ts: old?.ts ?? m.ts });
      }
      await store.saveMany(batch);
      dirty.m = false; toast('Утро сохранено');
    } catch (e) { toast(e.message); }
  };
  eSave.onclick = async () => {
    try {
      const prev = checkinOf(events, date, 'e');
      const fields = {};
      for (const f of [...SLOTS.e.ratings, ...SLOTS.e.numbers]) fields[f] = eW[f].value;
      for (const f of SLOTS.e.flags) fields[f] = eF[f].checked;
      await store.save(makeCheckin('e', date, fields, eNote.value, Date.now(), prev));
      dirty.e = false; toast('Вечер сохранён');
    } catch (e) { toast(e.message); }
  };
  dSave.onclick = async () => {
    try {
      const prev = diaryOf(events, date);
      await store.save(makeDiary(date, { text: dText.value, highlight: dHigh.value, gratitude: dG.map(i => i.value) }, Date.now(), prev));
      dirty.d = false; toast('Запись сохранена');
    } catch (e) { toast(e.message); }
  };
  dDel.onclick = async () => {
    const old = await store.remove(`diary:${date}`);
    dirty.d = false;
    if (old) toast('Запись удалена', { actionLabel: 'Отменить', onAction: () => store.save(old) });
  };

  // ----- отображение сохранённого -----
  function hydrate() {
    const cm = checkinOf(events, date, 'm')?.payload ?? {}, ce = checkinOf(events, date, 'e')?.payload ?? {}, d = diaryOf(events, date)?.payload ?? {};
    if (!dirty.m) {
      for (const f of [...SLOTS.m.ratings, 'sleepHours']) mW[f].setValue(cm[f] ?? null);
      bed.value = cm.bed ?? ''; wake.value = cm.wake ?? '';
      weight.value = (events.find(e => e.id === `mw:${date}`)?.payload.value ?? '').toString().replace('.', ',');
    }
    if (!dirty.e) {
      for (const f of [...SLOTS.e.ratings, ...SLOTS.e.numbers]) eW[f].setValue(ce[f] ?? null);
      for (const f of SLOTS.e.flags) eF[f].checked = !!ce[f];
      eNote.value = ce.note ?? '';
    }
    if (!dirty.d) {
      dText.value = d.text ?? ''; dHigh.value = d.highlight ?? '';
      dG.forEach((inp, i) => { inp.value = d.gratitude?.[i] ?? ''; });
      paintTags();
    }
    qText.textContent = questionOfDay(date);
    past.replaceChildren(...onThisDay(events, date).map(x => el('p', { class: 'muted past' }, el('strong', { textContent: `${x.label} · ${dateRu(x.date)}: ` }), x.text)));
    mSum.textContent = `Утро${cm.date ? ' ✓' : ''}${cm.sleepHours ? ` · сон ${String(cm.sleepHours).replace('.', ',')} ч` : ''}`;
    eSum.textContent = `Вечер${ce.date ? ' ✓' : ''}`;
    dSum.textContent = `Дневник${d.date ? ' ✓' : ''}`;
    dDel.hidden = !d.date;
  }
  function autoOpen() {
    const h = new Date().getHours();
    const isToday = date === todayStr();
    mBox.open = !isToday || (!checkinOf(events, date, 'm') && h < 15);
    eBox.open = !isToday || (!checkinOf(events, date, 'e') && h >= 17);
  }

  function renderHistory() {
    const days = recentDays(events, todayStr(), 14);
    strip.replaceChildren(...days.slice().reverse().map(d => el('button', { type: 'button', class: `mood-dot${d.mood ? ' m' + Math.round(d.mood) : ''}${d.date === date ? ' sel' : ''}`, title: `${dateRu(d.date)}${d.mood ? ': настроение ' + d.mood.toFixed(1) : ''}`, 'aria-label': dateRu(d.date), onclick: () => go(d.date) })));
    hist.replaceChildren(...days.map(d => el('button', { type: 'button', class: 'hist-row' + (d.date === date ? ' sel' : ''), onclick: () => go(d.date) },
      el('span', { textContent: dateRu(d.date) }), el('span', { class: 'muted', textContent: d.mood ? `☺ ${d.mood.toFixed(1)}` : '' }),
      el('span', { class: 'muted', textContent: d.sleep ? `${String(d.sleep).replace('.', ',')} ч` : '' }), el('span', { class: 'hist-snip', textContent: d.text }))));
  }

  return {
    root,
    update(evs) { events = evs; hydrate(); renderHistory(); },
    show() { this.update(store.state.events); if (date === todayStr()) autoOpen(); },
    focusAdd() { dText.focus(); },
  };
}
