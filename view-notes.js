import { el, toast, dateRu } from './ui.js';
import { todayStr } from './events.js';
import { makeNote, updateNote, noteTitle, sortedNotes, MAX_NOTE } from './notes.js';
import { normalize } from './search.js';
import * as store from './store.js';

export function createNotesView() {
  let events = [];
  let editingId = null;
  let editorEl = null;
  const root = el('section', { id: 'view-notes', class: 'view' });

  const text = el('textarea', { id: 'note-input', rows: 3, placeholder: 'Новая заметка…', maxLength: MAX_NOTE });
  const form = el('form', { id: 'note-form', class: 'card form-stack' }, text, el('button', { type: 'submit', class: 'primary', textContent: 'Сохранить заметку' }));
  form.onsubmit = async e => {
    e.preventDefault();
    const t = text.value;
    if (!t.trim()) return;
    text.value = '';
    try { await store.save(makeNote(t)); } catch (err) { text.value = t; toast(err.message); }
  };
  const filter = el('input', { id: 'note-filter', type: 'search', placeholder: 'Фильтр по заметкам', autocomplete: 'off' });
  filter.oninput = () => render();
  const list = el('div', { id: 'note-list' });
  const empty = el('p', { class: 'muted', hidden: true, textContent: 'Заметок пока нет.' });
  root.append(form, filter, list, empty);

  function stopEdit() { editingId = null; editorEl = null; render(); }

  async function removeNote(n) {
    if (editingId === n.id) { editingId = null; editorEl = null; }
    const old = await store.remove(n.id);
    if (old) toast('Заметка удалена', { actionLabel: 'Отменить', onAction: () => store.save(old) });
  }

  function editor(n) {
    const ta = el('textarea', { rows: 6, maxLength: MAX_NOTE, class: 'edit-note', value: n.payload.text });
    const f = el('form', { class: 'card form-stack editing', dataset: { id: n.id } }, ta,
      el('div', { class: 'row' },
        el('button', { type: 'submit', class: 'primary save', textContent: 'Сохранить' }),
        el('button', { type: 'button', class: 'cancel', textContent: 'Отмена', onclick: () => stopEdit() }),
        el('button', { type: 'button', class: 'danger', textContent: 'Удалить', onclick: () => removeNote(n) })));
    f.onsubmit = async e => {
      e.preventDefault();
      try { await store.save(updateNote(n, ta.value)); stopEdit(); } catch (err) { toast(err.message); }
    };
    queueMicrotask(() => ta.focus());
    return f;
  }

  function card(n) {
    if (editingId === n.id) {
      if (!editorEl || editorEl.dataset.id !== n.id) editorEl = editor(n);
      return editorEl;
    }
    const lines = n.payload.text.split('\n');
    const title = noteTitle(n.payload.text);
    const rest = lines.slice(lines.findIndex(l => l.trim()) + 1).join('\n').trim();
    const c = el('article', { class: 'card note', tabIndex: 0, role: 'button', 'aria-label': 'Изменить заметку: ' + title,
      onclick: () => { editingId = n.id; editorEl = null; render(); }, onkeydown: e => { if (e.key === 'Enter') { editingId = n.id; editorEl = null; render(); } } },
      el('strong', { class: 'note-title', textContent: title }),
      rest ? el('p', { class: 'note-body', textContent: rest }) : null,
      el('span', { class: 'meta muted', textContent: dateRu(todayStr(n.payload.editedAt || n.ts)) }));
    return c;
  }

  function render() {
    const q = normalize(filter.value).trim();
    const all = sortedNotes(events);
    const shown = q ? all.filter(n => q.split(/\s+/).every(t => normalize(n.payload.text).includes(t))) : all;
    list.replaceChildren(...shown.map(card));
    empty.hidden = shown.length > 0;
    empty.textContent = all.length && !shown.length ? 'Ничего не найдено.' : 'Заметок пока нет.';
  }

  return { root, update(evs) { events = evs; render(); }, focusAdd() { text.focus(); } };
}
