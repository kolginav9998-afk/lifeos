// Экран «Люди»: ближайшие дни рождения, «давно не общались», список людей с заметками (идеи подарков, о чём поговорить).
import { el, toast, dateRu } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { CADENCES, makePerson, markContact, updateNote, peopleOf, upcomingBirthdays, dueContacts, nextBirthday } from './people.js';

const dayWord = n => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} дн.`);

export function createPeopleView() {
  let events = [];
  const root = el('section', { id: 'view-people', class: 'view' });
  const name = el('input', { id: 'pp-name', type: 'text', maxLength: 60, placeholder: 'Имя', autocomplete: 'off' });
  const bday = el('input', { id: 'pp-bday', type: 'text', inputMode: 'numeric', placeholder: 'День рождения: 12.03 или 12.03.1990', autocomplete: 'off' });
  const cad = el('select', { id: 'pp-cad', 'aria-label': 'Как часто общаться' }, ...CADENCES.map(([v, t]) => el('option', { value: String(v), textContent: t })));
  const err = el('p', { class: 'error', id: 'pp-err' });
  const form = el('form', { class: 'form-stack' }, name, bday, el('label', {}, 'Общаться: ', cad),
    el('button', { type: 'submit', id: 'pp-add', class: 'primary', textContent: 'Добавить человека' }), err);
  form.onsubmit = async e => {
    e.preventDefault();
    try { await store.save(makePerson({ name: name.value, birthday: bday.value, cadenceDays: Number(cad.value) })); name.value = ''; bday.value = ''; cad.value = '0'; err.textContent = ''; }
    catch (x) { err.textContent = x.message; }
  };
  const formCard = el('details', { class: 'card', id: 'pp-new' }, el('summary', { textContent: 'Добавить человека' }), form);

  function render() {
    const today = todayStr();
    const bd = upcomingBirthdays(events, today, 30), due = dueContacts(events, today), all = peopleOf(events);
    const parts = [];
    parts.push(el('div', { class: 'card', id: 'pp-soon' }, el('h3', { textContent: 'Ближайшие дни рождения' }),
      ...(bd.length ? bd.map(b => el('p', { class: 'pp-bd', dataset: { id: b.person.id } }, el('strong', { textContent: b.person.payload.name }),
        el('span', { class: 'muted', textContent: ` — ${dateRu(b.date)} (${dayWord(b.inDays)})${b.age ? `, исполнится ${b.age}` : ''}` }))) : [el('p', { class: 'muted', textContent: 'В ближайшие 30 дней нет. Добавь день рождения близких — приложение напомнит.' })])));
    parts.push(el('div', { class: 'card', id: 'pp-due' }, el('h3', { textContent: 'Давно не общались' }),
      ...(due.length ? due.map(d => el('div', { class: 'row pp-due-row', dataset: { id: d.person.id } },
        el('span', { class: 'grow' }, el('strong', { textContent: d.person.payload.name }), el('span', { class: 'muted', textContent: d.never ? ' — ещё не отмечали контакт' : ` — ${d.days} дн. назад` })),
        el('button', { type: 'button', class: 'chip pp-contact', textContent: 'Написал(а) сегодня', onclick: async () => { await store.save(markContact(d.person, today)); toast(`Отмечено: ${d.person.payload.name}`); } }))) : [el('p', { class: 'muted', textContent: all.some(p => p.payload.cadenceDays) ? 'Всё в порядке: ни у кого срок не вышел.' : 'Выбери для человека периодичность общения — и здесь появятся напоминания.' })])));
    parts.push(formCard);
    if (all.length) parts.push(el('h2', { textContent: `Все (${all.length})` }));
    for (const p of all) {
      const nb = nextBirthday(p.payload, today);
      const note = el('textarea', { rows: 2, maxLength: 500, class: 'pp-note', placeholder: 'Идеи подарков, о чём поговорить, важное…', 'aria-label': `Заметка о ${p.payload.name}` });
      note.value = p.payload.note;
      parts.push(el('details', { class: 'card pp', dataset: { id: p.id } },
        el('summary', {}, el('span', { textContent: p.payload.name }), el('span', { class: 'muted', textContent: nb ? `🎂 ${dateRu(nb.date)}` : '' })),
        el('p', { class: 'muted', textContent: `${p.payload.lastContact ? `Последний контакт: ${dateRu(p.payload.lastContact)}` : 'Контакт не отмечен'}${p.payload.cadenceDays ? ` · общаться ${CADENCES.find(c => c[0] === p.payload.cadenceDays)[1]}` : ''}` }), note,
        el('div', { class: 'row wrap' },
          el('button', { type: 'button', class: 'chip pp-save', textContent: 'Сохранить заметку', onclick: async () => { await store.save(updateNote(p, note.value)); toast('Сохранено'); } }),
          el('button', { type: 'button', class: 'chip pp-contact-now', textContent: 'Общались сегодня', onclick: async () => { await store.save(markContact(p, today)); toast('Отмечено'); } }),
          el('button', { type: 'button', class: 'chip danger', textContent: 'Удалить', onclick: async () => { const old = await store.remove(p.id); toast('Удалено', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }))));
    }
    root.replaceChildren(...parts);
  }
  return { root, update(evs) { events = evs; if (!root.hidden) render(); }, show() { render(); } };
}
