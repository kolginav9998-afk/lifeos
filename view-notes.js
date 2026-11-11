import { el, toast, dateRu } from './ui.js';
import { todayStr } from './events.js';
import { makeNote, updateNote, noteTitle, sortedNotes, MAX_NOTE, NOTE_TEMPLATES, templateText, noteTags, tagCloud, resolveLinks, backlinks } from './notes.js';
import { normalize } from './search.js';
import * as store from './store.js';

export function createNotesView() {
  let events = [];
  let editingId = null;
  let editorEl = null;
  const root = el('section', { id: 'view-notes', class: 'view' });

  const text = el('textarea', { id: 'note-input', rows: 3, placeholder: 'Новая заметка…', maxLength: MAX_NOTE });
  const tpl = el('select', { id: 'note-tpl', 'aria-label': 'Шаблон заметки' }, el('option', { value: '', textContent: 'Без шаблона' }), ...NOTE_TEMPLATES.map(t => el('option', { value: t.id, textContent: t.title })));
  tpl.onchange = () => {
    if (!tpl.value) return;
    const body = templateText(tpl.value, todayStr());
    text.value = text.value.trim() ? `${text.value.trim()}\n\n${body}` : body;
    tpl.value = '';
    text.focus(); const p = text.value.indexOf(': ') >= 0 && !text.value.includes('\n\n---') ? text.value.indexOf('\n') : text.value.length; text.setSelectionRange(p, p);
  };
  const form = el('form', { id: 'note-form', class: 'card form-stack' }, text, tpl, el('button', { type: 'submit', class: 'primary', textContent: 'Сохранить заметку' }));
  form.onsubmit = async e => {
    e.preventDefault();
    const t = text.value;
    if (!t.trim()) return;
    text.value = '';
    try { await store.save(makeNote(t)); } catch (err) { text.value = t; toast(err.message); }
  };
  const filter = el('input', { id: 'note-filter', type: 'search', placeholder: 'Фильтр по заметкам', autocomplete: 'off' });
  filter.oninput = () => render();
  const tagBar = el('div', { id: 'note-tags', class: 'chips' });
  const list = el('div', { id: 'note-list' });
  const empty = el('p', { class: 'muted', hidden: true, textContent: 'Заметок пока нет.' });
  root.append(form, filter, tagBar, list, empty);

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
    const links = resolveLinks(events, n), back = backlinks(events, n);
    const chip = (t, target, prefix) => target ? el('button', { type: 'button', class: 'chip link-chip', textContent: `${prefix} ${noteTitle(target.payload.text, 40)}`, onclick: () => { editingId = target.id; editorEl = null; render(); } })
      : el('span', { class: 'chip static', textContent: `${prefix} ${t} (нет такой заметки)` });
    if (links.length || back.length) f.insertBefore(el('div', { class: 'chips note-links' }, ...links.map(l => chip(l.title, l.target, '→')), ...back.map(b => chip('', b, '←'))), f.lastChild);
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
      noteTags(n.payload.text).length ? el('div', { class: 'tags' }, ...noteTags(n.payload.text).map(t => el('span', { class: 'tag', textContent: '#' + t }))) : null,
      (() => { const l = resolveLinks(events, n).length, b = backlinks(events, n).length; return l || b ? el('span', { class: 'meta muted', textContent: `${l ? `ссылок: ${l}` : ''}${l && b ? ' · ' : ''}${b ? `упоминаний: ${b}` : ''}` }) : null; })(),
      el('span', { class: 'meta muted', textContent: dateRu(todayStr(n.payload.editedAt || n.ts)) }));
    return c;
  }

  function render() {
    const q = normalize(filter.value).trim();
    const all = sortedNotes(events);
    const shown = q ? all.filter(n => q.split(/\s+/).every(t => normalize(n.payload.text).includes(t))) : all;
    tagBar.replaceChildren(...tagCloud(events).map(([t, n]) => el('button', { type: 'button', class: 'chip tag-chip', dataset: { tag: t }, textContent: `#${t} · ${n}`, onclick: () => { filter.value = filter.value === '#' + t ? '' : '#' + t; render(); } })));
    list.replaceChildren(...shown.map(card));
    empty.hidden = shown.length > 0;
    empty.textContent = all.length && !shown.length ? 'Ничего не найдено.' : 'Заметок пока нет.';
  }

  return { root, update(evs) { events = evs; render(); }, focusAdd() { text.focus(); } };
}
