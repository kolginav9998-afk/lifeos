// Экран «Люди»: ближайшие дни рождения и важные даты, «давно не общались» и «давно не виделись вживую», список людей с заметками, журналом контактов и долгами.
import { el, toast, dateRu, moneyText } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { CADENCES, makePerson, markContact, markMeet, logContact, contactsOf, contactSummary, dueMeets, personDebts, CHANNELS, CHANNEL_LABEL, updateNote, updateImportant, peopleOf, upcomingBirthdays, dueContacts, nextBirthday, nextImportant } from './people.js';

const dayWord = n => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} дн.`);
const agoWord = n => (n === 0 ? 'сегодня' : `${n} дн. назад`);
// хранится как 'MM-DD' (ежегодная) или 'YYYY-MM-DD' (разовая); в поле ввода показываем привычные «12.03» и «12.03.2020»
const fmtImportant = raw => !raw ? '' : raw.split('-').reverse().join('.');

export function createPeopleView() {
  let events = [];
  const root = el('section', { id: 'view-people', class: 'view' });
  const name = el('input', { id: 'pp-name', type: 'text', maxLength: 60, placeholder: 'Имя', autocomplete: 'off' });
  const bday = el('input', { id: 'pp-bday', type: 'text', inputMode: 'numeric', placeholder: 'День рождения: 12.03 или 12.03.1990', autocomplete: 'off' });
  const impDate = el('input', { id: 'pp-imp-date', type: 'text', inputMode: 'numeric', placeholder: 'Важная дата: 12.03 или 12.03.2020', autocomplete: 'off' });
  const impLabel = el('input', { id: 'pp-imp-label', type: 'text', maxLength: 60, placeholder: 'Что за день: годовщина, защита диплома…', autocomplete: 'off' });
  const cad = el('select', { id: 'pp-cad', 'aria-label': 'Как часто общаться' }, ...CADENCES.map(([v, t]) => el('option', { value: String(v), textContent: t })));
  const err = el('p', { class: 'error', id: 'pp-err' });
  const form = el('form', { class: 'form-stack' }, name, bday, impDate, impLabel, el('label', {}, 'Общаться: ', cad),
    el('button', { type: 'submit', id: 'pp-add', class: 'primary', textContent: 'Добавить человека' }), err);
  form.onsubmit = async e => {
    e.preventDefault();
    try { await store.save(makePerson({ name: name.value, birthday: bday.value, cadenceDays: Number(cad.value), importantDate: impDate.value, importantLabel: impLabel.value })); name.value = ''; bday.value = ''; impDate.value = ''; impLabel.value = ''; cad.value = '0'; err.textContent = ''; }
    catch (x) { err.textContent = x.message; }
  };
  const formCard = el('details', { class: 'card', id: 'pp-new' }, el('summary', { textContent: 'Добавить человека' }), form);

  function render() {
    const today = todayStr();
    const bd = upcomingBirthdays(events, today, 30), due = dueContacts(events, today), meets = dueMeets(events, today), all = peopleOf(events);
    const parts = [];
    parts.push(el('div', { class: 'card', id: 'pp-soon' }, el('h3', { textContent: 'Ближайшие дни рождения' }),
      ...(bd.length ? bd.map(b => el('p', { class: 'pp-bd', dataset: { id: b.person.id } }, el('strong', { textContent: b.person.payload.name }),
        el('span', { class: 'muted', textContent: ` — ${dateRu(b.date)} (${dayWord(b.inDays)})${b.age ? `, исполнится ${b.age}` : ''}` }))) : [el('p', { class: 'muted', textContent: 'В ближайшие 30 дней нет. Добавь день рождения близких — приложение напомнит.' })])));
    parts.push(el('div', { class: 'card', id: 'pp-due' }, el('h3', { textContent: 'Давно не общались' }),
      ...(due.length ? due.map(d => el('div', { class: 'row pp-due-row', dataset: { id: d.person.id } },
        el('span', { class: 'grow' }, el('strong', { textContent: d.person.payload.name }), el('span', { class: 'muted', textContent: d.never ? ' — ещё не отмечали контакт' : ` — ${d.days} дн. назад` })),
        el('button', { type: 'button', class: 'chip pp-contact', textContent: 'Написал(а) сегодня', onclick: async () => { await store.save(markContact(d.person, today)); toast(`Отмечено: ${d.person.payload.name}`); } }))) : [el('p', { class: 'muted', textContent: all.some(p => p.payload.cadenceDays) ? 'Всё в порядке: ни у кого срок не вышел.' : 'Выбери для человека периодичность общения — и здесь появятся напоминания.' })])));
    parts.push(el('div', { class: 'card', id: 'pp-meet' }, el('h3', { textContent: 'Давно не виделись вживую' }),
      ...(meets.length ? meets.map(d => el('div', { class: 'row pp-meet-row', dataset: { id: d.person.id } },
        el('span', { class: 'grow' }, el('strong', { textContent: d.person.payload.name }), el('span', { class: 'muted', textContent: d.never ? ' — встреч ещё не отмечали' : ` — вживую ${agoWord(d.days)}` })),
        el('button', { type: 'button', class: 'chip pp-meet', textContent: 'Встретились сегодня', onclick: async () => { await store.save(markMeet(d.person, today)); toast(`Отмечено: ${d.person.payload.name}`); } }))) : [el('p', { class: 'muted', textContent: all.some(p => p.payload.cadenceDays) ? 'Со всеми виделись недавно.' : 'Отмечай встречи в карточке человека — и здесь появятся напоминания.' })])));
    parts.push(formCard);
    if (all.length) parts.push(el('h2', { textContent: `Все (${all.length})` }));
    for (const p of all) {
      const nb = nextBirthday(p.payload, today), ni = nextImportant(p.payload, today);
      const cs = contactSummary(p, today), pd = personDebts(events, p), journal = contactsOf(p);
      const note = el('textarea', { rows: 2, maxLength: 500, class: 'pp-note', placeholder: 'Идеи подарков, о чём поговорить, важное…', 'aria-label': `Заметка о ${p.payload.name}` });
      note.value = p.payload.note;
      const impD = el('input', { type: 'text', class: 'pp-imp-date', inputMode: 'numeric', maxLength: 10, placeholder: '12.03 или 12.03.2020', 'aria-label': `Важная дата: ${p.payload.name}`, autocomplete: 'off' });
      impD.value = fmtImportant(p.payload.importantDate);
      const impL = el('input', { type: 'text', class: 'pp-imp-label', maxLength: 60, placeholder: 'Что за день', 'aria-label': `Что за день: ${p.payload.name}`, autocomplete: 'off' });
      impL.value = p.payload.importantLabel || '';
      // журнал контактов: канал, дата и «о чём говорили»
      const chSel = el('select', { class: 'pp-ch', 'aria-label': `Как общались: ${p.payload.name}` }, ...CHANNELS.map(([v, t]) => el('option', { value: v, textContent: t })));
      const chDate = el('input', { type: 'date', class: 'pp-ch-date', value: today, 'aria-label': `Дата контакта: ${p.payload.name}` });
      const chTopic = el('input', { type: 'text', class: 'pp-ch-topic', maxLength: 200, placeholder: 'О чём говорили (необязательно)', autocomplete: 'off', 'aria-label': `Тема разговора: ${p.payload.name}` });
      const journalCard = el('div', { class: 'pp-journal' },
        el('div', { class: 'row wrap' }, chSel, chDate, chTopic,
          el('button', { type: 'button', class: 'chip pp-log', textContent: 'Записать', onclick: async () => {
            try { await store.save(logContact(p, { date: chDate.value, channel: chSel.value, topic: chTopic.value })); chTopic.value = ''; toast('Контакт записан'); }
            catch (x) { toast(x.message); }
          } })),
        ...(journal.length ? [el('ul', { class: 'list pp-contacts' }, ...journal.slice(0, 5).map(c => el('li', { class: 'item' },
          el('span', { class: 'text', textContent: `${CHANNEL_LABEL[c.channel]}${c.topic ? ` — ${c.topic}` : ''}` }), el('span', { class: 'meta', textContent: dateRu(c.date) }))))] : []));
      const debtCard = pd.open.length ? el('div', { class: 'pp-debts' },
        el('p', { class: 'muted', textContent: `Долги: ${[pd.oweMeMinor ? `должен(а) мне ${moneyText(pd.oweMeMinor)}` : '', pd.iOweMinor ? `я должен(а) ${moneyText(pd.iOweMinor)}` : ''].filter(Boolean).join(' · ')}` }),
        el('ul', { class: 'list' }, ...pd.open.map(d => {
          const left = Math.max(0, d.payload.amountMinor - (d.payload.paidMinor || 0));
          return el('li', { class: 'item', dataset: { id: d.id } }, el('span', { class: 'text', textContent: `${d.payload.direction === 'owe_me' ? 'Мне должны' : 'Я должен(а)'}${d.payload.note ? ` — ${d.payload.note}` : ''}` }),
            el('span', { class: 'meta', textContent: `${moneyText(left)}${d.payload.due ? ` · до ${dateRu(d.payload.due)}` : ''}` }));
        }))) : null;
      parts.push(el('details', { class: 'card pp', dataset: { id: p.id } },
        el('summary', {}, el('span', { textContent: p.payload.name }), el('span', { class: 'muted', textContent: nb ? `🎂 ${dateRu(nb.date)}` : '' }), el('span', { class: 'muted', textContent: ni ? `📌 ${dateRu(ni.date)}` : '' })),
        el('p', { class: 'muted', textContent: `${cs.lastContact ? `Последний контакт: ${dateRu(cs.lastContact)}` : 'Контакт не отмечен'}${cs.lastMeet ? ` · вживую ${agoWord(cs.daysSinceMeet)}` : ''}${p.payload.cadenceDays ? ` · общаться ${CADENCES.find(c => c[0] === p.payload.cadenceDays)[1]}` : ''}` }),
        cs.lastTopic ? el('p', { class: 'muted pp-topic', textContent: `В прошлый раз говорили: ${cs.lastTopic}` }) : null,
        ni ? el('p', { class: 'muted pp-imp-line', textContent: `📌 ${dateRu(ni.date)}${ni.label ? ` — ${ni.label}` : ''} (${dayWord(ni.inDays)})` }) : null,
        el('div', { class: 'row wrap' }, el('label', {}, 'Важная дата ', impD), el('label', {}, 'Что за день ', impL),
          el('button', { type: 'button', class: 'chip pp-save-imp', textContent: 'Сохранить дату', onclick: async () => { try { await store.save(updateImportant(p, impD.value, impL.value)); toast('Сохранено'); } catch (x) { toast(x.message); } } })),
        note,
        journalCard,
        debtCard,
        el('div', { class: 'row wrap' },
          el('button', { type: 'button', class: 'chip pp-save', textContent: 'Сохранить заметку', onclick: async () => { await store.save(updateNote(p, note.value)); toast('Сохранено'); } }),
          el('button', { type: 'button', class: 'chip pp-contact-now', textContent: 'Общались сегодня', onclick: async () => { await store.save(markContact(p, today)); toast('Отмечено'); } }),
          el('button', { type: 'button', class: 'chip pp-meet-now', textContent: 'Виделись вживую', onclick: async () => { await store.save(markMeet(p, today)); toast('Отмечено'); } }),
          el('button', { type: 'button', class: 'chip danger', textContent: 'Удалить', onclick: async () => { const old = await store.remove(p.id); toast('Удалено', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }))));
    }
    root.replaceChildren(...parts);
  }
  return { root, update(evs) { events = evs; if (!root.hidden) render(); }, show() { render(); } };
}
