// Вкладка «Быт»: питомец и прививки, растения, документы со сроком, обслуживание техники, кладовая и расходники,
// гарантии, сезонные дела и смена гардероба, чек-лист лекарств в дорогу. Каждый блок тихий: нет данных — короткая подсказка или ничего.
import { el, fill, icon, toast, copyText, dateRu } from './ui.js';
import * as store from './store.js';
import { makeTask } from './events.js';
import { plural, updateItem, adjustQty, homeSeason, SEASON_LABEL, SEASON_CHORES, choreOpen, wardrobeSwap, storedClothes,
  waterText, docText, serviceText, warrantiesExpiring, householdAlerts } from './home.js';
import { petsOf, vacsOf, makePet, updatePet, makeVac, vacState, vacChipText, petLine, PET_KIND } from './pet.js';
import { travelText } from './meds.js';

export function createCareTab(H) {
  const root = el('div', { class: 'hm-care' });
  const card = (id, title, ...kids) => el('section', { class: 'card hm-card-t', id }, el('h2', { class: 'hm-h', textContent: title }), ...kids);
  const link = (item, text) => el('button', { type: 'button', class: 'link hm-link', textContent: text ?? item.payload.name, onclick: () => H.openDetail(item.id) });
  const chipBtn = (text, onclick, fk, cls = 'chip') => el('button', { type: 'button', class: cls, textContent: text, dataset: fk ? { fk } : {}, onclick });

  // ---------- верхняя лента: что просит внимания ----------
  function attention(a) {
    const lines = [];
    for (const r of a.vaccines) lines.push(`Прививка: ${vacChipText(r, plural)}`);
    for (const r of a.plants.filter(x => x.water.due)) lines.push(`Полить: ${r.item.payload.name}`);
    for (const r of a.docs.filter(x => x.doc.level !== 'warn')) { const t = docText(r.doc); lines.push(`${r.item.payload.name}: ${t[0].toLowerCase()}${t.slice(1)}`); }
    for (const r of a.service.filter(x => x.service.due)) lines.push(`Обслужить: ${r.item.payload.name}`);
    for (const r of a.pantry.filter(x => x.pantry.expired || x.pantry.out)) lines.push(r.pantry.out ? `«${r.item.payload.name}» кончилось` : `${r.item.payload.name}: срок вышел`);
    for (const r of a.supplies.filter(x => x.supply.out || x.supply.low)) lines.push(r.supply.out ? `«${r.item.payload.name}» кончилось` : `«${r.item.payload.name}» кончается`);
    if (!lines.length) return null;
    return card('hm-care-alert', `Просит внимания: ${lines.length}`, el('ul', { class: 'hm-top' }, ...lines.map(t => el('li', {}, el('span', { class: 'hm-val', textContent: t })))));
  }

  // ---------- сезонные дела ----------
  function season(events, today) {
    const s = homeSeason(today);
    if (!s) return null;
    const chores = SEASON_CHORES[s];
    return card('hm-season', `${SEASON_LABEL[s]}: дела по дому`, el('ul', { class: 'hm-chores' }, ...chores.map(text => {
      const added = choreOpen(events, text);
      return el('li', { class: 'hm-chore' }, el('span', { textContent: text }),
        added ? el('span', { class: 'muted', textContent: 'уже в задачах' })
          : chipBtn('В задачу', async () => { await store.save(makeTask(text)); toast(`В задачах: «${text}»`); }, `chore|${text}`));
    })));
  }

  // ---------- смена гардероба ----------
  function wardrobe(m, today) {
    const s = wardrobeSwap(today);
    if (!s) return null;
    const stored = storedClothes(m.items);
    if (!stored.length) return card('hm-wardrobe', `${SEASON_LABEL[s]}: гардероб`, el('p', { class: 'muted', textContent: 'На хранении ничего нет — всё под рукой.' }));
    return card('hm-wardrobe', `${SEASON_LABEL[s]}: гардероб`, el('p', { class: 'muted', textContent: `На хранении: ${stored.length} ${plural(stored.length, 'вещь', 'вещи', 'вещей')}. Проверь список — и верни всё одним нажатием.` }),
      el('ul', { class: 'hm-top' }, ...stored.slice(0, 8).map(item => el('li', {}, link(item), item.payload.place ? el('span', { class: 'hm-val', textContent: item.payload.place }) : null))),
      stored.length > 8 ? el('p', { class: 'muted', textContent: `…и ещё ${stored.length - 8}` }) : null,
      chipBtn(`Вернуть всё в использование (${stored.length})`, async () => {
        await store.saveMany(stored.map(item => updateItem(item, { status: 'active' })));
        toast(`Возвращено с хранения: ${stored.length} ${plural(stored.length, 'вещь', 'вещи', 'вещей')}`, { actionLabel: 'Отменить', onAction: () => store.saveMany(stored) });
      }, 'wardrobe-all', 'primary'));
  }

  // ---------- питомцы ----------
  function petForm(pet) {
    const name = el('input', { type: 'text', maxLength: 60, required: true, value: pet?.payload.name ?? '', placeholder: 'Имя', 'aria-label': 'Имя питомца' });
    const kind = el('select', { 'aria-label': 'Кто это' }, ...Object.entries(PET_KIND).map(([v, t]) => el('option', { value: v, textContent: t, selected: (pet?.payload.kind ?? 'cat') === v })));
    const weight = el('input', { type: 'text', inputMode: 'decimal', maxLength: 6, value: pet?.payload.weightKg ?? '', placeholder: 'Вес, кг', 'aria-label': 'Вес в килограммах' });
    const vet = el('input', { type: 'text', maxLength: 60, value: pet?.payload.vetName ?? '', placeholder: 'Ветеринар или клиника', 'aria-label': 'Ветеринар или клиника' });
    const phone = el('input', { type: 'tel', maxLength: 30, value: pet?.payload.vetPhone ?? '', placeholder: 'Телефон ветеринара', 'aria-label': 'Телефон ветеринара' });
    const err = el('p', { class: 'error', role: 'alert' });
    const form = el('form', { class: 'form-stack', noValidate: true }, name, el('div', { class: 'hm-grid' }, kind, weight), vet, phone, err,
      el('button', { type: 'submit', class: 'primary', textContent: pet ? 'Сохранить' : 'Добавить питомца' }));
    form.onsubmit = async e => {
      e.preventDefault();
      try {
        const fields = { name: name.value, kind: kind.value, weightKg: weight.value, vetName: vet.value, vetPhone: phone.value };
        await store.save(pet ? updatePet(pet, fields) : makePet(fields));
        toast(pet ? 'Сохранено' : `Теперь с нами: ${fields.name.trim()}`);
      } catch (x) { err.textContent = x.message; }
    };
    return form;
  }
  function vacForm(pet, today) {
    const name = el('input', { type: 'text', maxLength: 60, required: true, placeholder: 'Название прививки', 'aria-label': 'Название прививки' });
    const date = el('input', { type: 'date', value: today, max: today, 'aria-label': 'Когда сделана' });
    const next = el('input', { type: 'date', 'aria-label': 'Следующая прививка (необязательно)' });
    const err = el('p', { class: 'error', role: 'alert' });
    const form = el('form', { class: 'form-stack', noValidate: true }, name,
      el('label', { class: 'field' }, el('span', { textContent: 'Когда сделана' }), date),
      el('label', { class: 'field' }, el('span', { textContent: 'Следующая (необязательно) — напомню сам' }), next), err,
      el('button', { type: 'submit', class: 'primary', textContent: 'Записать прививку' }));
    form.onsubmit = async e => {
      e.preventDefault();
      try { await store.save(makeVac(pet, { name: name.value, date: date.value, nextDue: next.value })); toast(`Прививка записана: ${name.value.trim()}`); }
      catch (x) { err.textContent = x.message; }
    };
    return form;
  }
  function petCard(pet, events, today) {
    const p = pet.payload, vacs = vacsOf(events, pet.id);
    const vetLine = [p.vetName, p.vetPhone].filter(Boolean).join(' · ');
    const rows = vacs.map(v => {
      const st = vacState(v, today);
      const state = st ? (st.left < 0 ? `следующая просрочена на ${-st.left} дн.` : st.left === 0 ? 'следующая сегодня' : `следующая ${dateRu(st.due)} (через ${st.left} дн.)`) : '';
      return el('li', { class: 'hm-hrow' }, el('span', { class: 'hm-hd', textContent: dateRu(v.payload.date) }),
        el('span', { class: 'hm-hk', textContent: `${v.payload.name}${state ? ` · ${state}` : ''}` }),
        el('button', { type: 'button', class: 'icon-btn hm-hdel', 'aria-label': `Удалить прививку: ${v.payload.name}`, dataset: { fk: `vacdel|${v.id}` },
          onclick: async () => { const old = await store.remove(v.id); toast('Прививка удалена', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }, icon('x', 18)));
    });
    return el('div', { class: 'hm-pet' },
      el('p', {}, el('strong', { textContent: p.name }), el('span', { class: 'muted', textContent: ` · ${petLine(p)}` })),
      vetLine ? el('p', { class: 'muted', textContent: `Ветеринар: ${vetLine}` }) : null,
      p.note ? el('p', { class: 'muted', textContent: p.note }) : null,
      vacs.length ? el('ul', { class: 'hm-hist' }, ...rows) : el('p', { class: 'muted', textContent: 'Прививок пока нет. Запиши первую — срок следующей посчитается сам.' }),
      el('div', { class: 'row wrap' },
        chipBtn('Удалить питомца', async () => {
          const gone = await store.removeMany([pet.id, ...vacs.map(v => v.id)]);
          toast(`Удалено: ${p.name}`, { actionLabel: 'Вернуть', onAction: () => store.saveMany(gone) });
        }, `petdel|${pet.id}`)),
      el('details', { class: 'hm-soon' }, el('summary', { textContent: 'Записать прививку' }), vacForm(pet, today)),
      el('details', { class: 'hm-soon' }, el('summary', { textContent: 'Изменить питомца' }), petForm(pet)));
  }
  function pets(events, today) {
    const list = petsOf(events);
    const box = card('hm-pets', list.length > 1 ? 'Питомцы' : 'Питомец',
      ...list.map(pet => petCard(pet, events, today)),
      el('details', { class: 'hm-soon' }, el('summary', { textContent: list.length ? 'Добавить ещё питомца' : 'Добавить питомца' }), petForm(null)));
    return box;
  }

  // ---------- вещи с правилами ----------
  const ruleRow = (item, stateText, warn, action) => el('li', { class: 'hm-row' },
    el('span', { class: 'hm-rname' }, link(item)),
    el('span', { class: `hm-mtext${warn ? ' warn' : ''}`, textContent: stateText }), action ?? null);
  function plants(a) {
    if (!a.plants.length) return null;
    return card('hm-plants', 'Растения', el('ul', { class: 'hm-rows' }, ...a.plants.map(({ item, water }) =>
      ruleRow(item, `${waterText(water)} · каждые ${water.every} дн.`, water.due, chipBtn('Полил', () => H.mark([item], 'water'), `water|${item.id}`)))));
  }
  function docs(a) {
    if (!a.docs.length) return null;
    return card('hm-docs', 'Документы со сроком', el('p', { class: 'muted', textContent: 'Напомню за 90 и за 30 дней. Продлить — «Изменить» → поле «Действует до».' }),
      el('ul', { class: 'hm-rows' }, ...a.docs.map(({ item, doc }) =>
        ruleRow(item, `${docText(doc)} · до ${dateRu(doc.until)}`, doc.level !== 'ok' && doc.level !== 'warn', el('span', { class: 'row' },
          chipBtn('Изменить', () => H.openEdit(item), `docedit|${item.id}`))))));
  }
  function service(a) {
    if (!a.service.length) return null;
    return card('hm-service', 'Обслуживание техники', el('ul', { class: 'hm-rows' }, ...a.service.map(({ item, service: s }) =>
      ruleRow(item, `${serviceText(s)} · раз в ${s.every} дн.`, s.due, chipBtn('Обслужил', () => H.mark([item], 'repair'), `service|${item.id}`)))));
  }

  // ---------- запасы ----------
  function qtyRow(item, stateText, warn) {
    const p = item.payload;
    const bump = delta => async () => {
      const next = adjustQty(item, delta);
      await store.save(next);
      if (next.payload.qty === 0) toast(`«${p.name}» кончилось — пора в список покупок`);
    };
    return el('li', { class: 'hm-row' },
      el('span', { class: 'hm-rname' }, link(item)),
      el('span', { class: `hm-mtext${warn ? ' warn' : ''}`, textContent: stateText }),
      el('span', { class: 'row' },
        el('button', { type: 'button', class: 'chip', textContent: '−', 'aria-label': `${p.name}: ушло`, dataset: { fk: `qty-|${item.id}` }, onclick: bump(-1) }),
        el('button', { type: 'button', class: 'chip', textContent: '+', 'aria-label': `${p.name}: пришло`, dataset: { fk: `qty+|${item.id}` }, onclick: bump(1) })));
  }
  function pantry(a) {
    if (!a.pantry.length) return null;
    return card('hm-pantry', 'Кладовая', el('ul', { class: 'hm-rows' }, ...a.pantry.map(({ item, pantry: s }) => {
      const left = s.left === null ? '' : s.expired ? ` · срок вышел ${-s.left} дн. назад` : s.soon ? ` · съесть до ${dateRu(s.useBy)}` : ` · до ${dateRu(s.useBy)}`;
      return qtyRow(item, `осталось: ${s.qty}${s.out ? ' · кончилось' : ''}${left}`, s.out || s.expired || s.soon);
    })));
  }
  function supplies(a) {
    if (!a.supplies.length) return null;
    return card('hm-supplies', 'Расходники', el('ul', { class: 'hm-rows' }, ...a.supplies.map(({ item, supply: s }) =>
      qtyRow(item, `осталось: ${s.qty}${s.out ? ' · кончилось' : s.low ? ' · кончается' : ''}`, s.out || s.low))));
  }

  // ---------- гарантии и дорога ----------
  function warranties(m, today) {
    const list = warrantiesExpiring(m.items, today, 90);
    if (!list.length) return null;
    return card('hm-warranties', `Гарантии: ${list.length} ${plural(list.length, 'истекает', 'истекают', 'истекают')}`,
      el('ul', { class: 'hm-rows' }, ...list.map(({ item, daysLeft: left }) =>
        ruleRow(item, `до ${dateRu(item.payload.warranty)} (${left === 0 ? 'сегодня' : `ещё ${left} ${plural(left, 'день', 'дня', 'дней')}`})`, left <= 30, el('span', { class: 'row' },
          chipBtn('Открыть', () => H.openDetail(item.id), `wopen|${item.id}`),
          chipBtn('Гарантия…', () => H.openEdit(item), `wedit|${item.id}`))))));
  }
  function travel(events) {
    const text = travelText(events);
    if (!text) return null;
    return card('hm-travel', 'Лекарства в дорогу', el('p', { class: 'muted', textContent: 'Чек-лист из активного списка: утро, день, вечер — скопируй и возьми с собой.' }),
      el('button', { type: 'button', class: 'chip', dataset: { fk: 'travel-copy' }, onclick: () => copyText(text, 'Чек-лист скопирован') }, icon('copy', 16), 'Скопировать списком'));
  }

  function render(m) {
    const events = H.events(), today = m.today;
    const a = householdAlerts(events, today);
    const parts = [attention(a), season(events, today), wardrobe(m, today), pets(events, today), plants(a), docs(a), service(a), pantry(a), supplies(a), warranties(m, today), travel(events)].filter(Boolean);
    parts.push(el('details', { class: 'card hm-soon' }, el('summary', { textContent: 'Как это работает' }),
      el('p', { class: 'muted', textContent: 'Растение — вещь с полем «Поливать раз в N дней»; документ со сроком — вещь с полем «Действует до»; техника с ТО — поле «Обслуживание раз в N дней»; кладовая и расходники — виды вещей «Кладовая и еда» и «Расходники». Всё это задаётся в «Ещё параметры» при добавлении или правке вещи.' })));
    fill(root, ...parts);
  }
  return { root, render };
}
