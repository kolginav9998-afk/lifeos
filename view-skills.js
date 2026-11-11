// Экран «Навыки»: набор того, что ты точно изучил или научился делать. Из уроков навык предлагается сам (урок пройден и карточки выучены),
// остальное добавляется вручную: «научился делать…».
import { el, fill, toast, dateRu, copyText } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { TRACKS } from './academy.js';
import { LEVELS, LEVEL_HINT, SOURCES, AREA_SUGGESTIONS, makeSkill, updateSkill, setLevel, skillGroups, skillStats, skillsText, skillFromLesson, readySkillEvents, lessonSkillStatus } from './skills.js';
import { normalize } from './search.js';

const bar = (value, total) => el('div', { class: 'bar', role: 'img', 'aria-label': `${value} из ${total}` }, el('span', { style: `width:${total ? Math.round((value / total) * 100) : 0}%` }));
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function createSkillsView() {
  let events = [];
  let editingId = null, editorEl = null;                 // редактор переживает перерисовки, чтобы не терять введённое
  const root = el('section', { id: 'view-skills', class: 'view' });

  // ---------- форма нового навыка ----------
  const sTitle = el('input', { id: 'skill-title', type: 'text', maxLength: 120, placeholder: 'Что ты теперь умеешь? Например: менять колесо', autocomplete: 'off' });
  const sArea = el('input', { id: 'skill-area', type: 'text', maxLength: 40, placeholder: 'Область (по желанию): Работа, Спорт…', autocomplete: 'off' });
  sArea.setAttribute('list', 'skill-areas');
  const areaList = el('datalist', { id: 'skill-areas' });
  const sLevel = el('select', { id: 'skill-level', 'aria-label': 'Уровень' }, ...Object.entries(LEVELS).map(([v, t]) => el('option', { value: v, textContent: `${t}: ${LEVEL_HINT[v]}` })));
  sLevel.value = '2';
  const sDate = el('input', { id: 'skill-date', type: 'date', 'aria-label': 'Когда научился' });
  const sNote = el('input', { id: 'skill-note', type: 'text', maxLength: 300, placeholder: 'Как проверил или где применил (по желанию)', autocomplete: 'off' });
  const sErr = el('p', { class: 'error', id: 'skill-err' });
  const form = el('form', { class: 'form-stack' }, sTitle, sArea, areaList, el('label', {}, 'Уровень: ', sLevel), el('label', {}, 'Дата: ', sDate), sNote,
    el('button', { type: 'submit', id: 'skill-add', class: 'primary', textContent: 'Добавить навык' }), sErr);
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      const ev = makeSkill({ title: sTitle.value, area: sArea.value, level: sLevel.value, date: sDate.value || todayStr(), note: sNote.value });
      await store.save(ev);
      sTitle.value = ''; sNote.value = ''; sDate.value = ''; sErr.textContent = '';
      toast('Навык добавлен', { actionLabel: 'Отменить', onAction: () => store.remove(ev.id) });
    } catch (x) { sErr.textContent = x.message; }
  };
  const formCard = el('details', { class: 'card', id: 'skill-new' }, el('summary', { textContent: 'Добавить навык вручную («научился делать…»)' }), form);
  const filter = el('input', { id: 'skill-filter', type: 'search', placeholder: 'Поиск по навыкам', autocomplete: 'off', 'aria-label': 'Поиск по навыкам' });
  filter.oninput = () => renderList();
  const top = el('div', { class: 'stack' }), listBox = el('div', { class: 'stack' });
  root.append(top, filter, listBox);

  // ---------- строка навыка и редактор ----------
  async function removeSkill(ev) {
    if (editingId === ev.id) { editingId = null; editorEl = null; }
    const old = await store.remove(ev.id);
    toast('Навык удалён', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {});
  }
  function editor(ev) {
    const p = ev.payload;
    const t = el('input', { type: 'text', value: p.title, maxLength: 120, class: 'edit-skill-title', 'aria-label': 'Название навыка' });
    const a = el('input', { type: 'text', value: p.area, maxLength: 40, class: 'edit-skill-area', 'aria-label': 'Область' });
    a.setAttribute('list', 'skill-areas');
    const lv = el('select', { class: 'edit-skill-level', 'aria-label': 'Уровень' }, ...Object.entries(LEVELS).map(([v, tx]) => el('option', { value: v, textContent: `${tx}: ${LEVEL_HINT[v]}` })));
    lv.value = String(p.level);
    const d = el('input', { type: 'date', value: p.date, max: todayStr(), class: 'edit-skill-date', 'aria-label': 'Дата' });
    const n = el('input', { type: 'text', value: p.note, maxLength: 300, class: 'edit-skill-note', placeholder: 'Заметка', 'aria-label': 'Заметка' });
    const err = el('p', { class: 'error edit-skill-err' });
    const f = el('form', { class: 'card form-stack editing', dataset: { id: ev.id } }, t, a, el('label', {}, 'Уровень: ', lv), el('label', {}, 'Дата: ', d), n,
      el('div', { class: 'row' }, el('button', { type: 'submit', class: 'primary save', textContent: 'Сохранить' }), el('button', { type: 'button', class: 'cancel', textContent: 'Отмена', onclick: () => { editingId = null; editorEl = null; render(); } })), err);
    f.onsubmit = async e => {
      e.preventDefault();
      try { const next = updateSkill(ev, { title: t.value, area: a.value, level: lv.value, date: d.value, note: n.value }); editingId = null; editorEl = null; await store.save(next); }      // выходим из правки до сохранения: оно перерисует экран
      catch (x) { err.textContent = x.message; }
    };
    queueMicrotask(() => t.focus());
    return f;
  }
  function row(ev) {
    if (editingId === ev.id) { if (!editorEl || editorEl.dataset.id !== ev.id) editorEl = editor(ev); return editorEl; }
    const p = ev.payload;
    return el('div', { class: 'skill-row', dataset: { id: ev.id, level: String(p.level), source: p.source } },
      el('div', { class: 'row' }, el('strong', { class: 'grow skill-title', textContent: p.title }), el('span', { class: `badge lvl${p.level}`, textContent: LEVELS[p.level] })),
      el('div', { class: 'muted', textContent: `${dateRu(p.date)} · ${SOURCES[p.source] ?? ''}` }),
      p.evidence ? el('div', { class: 'muted skill-evidence', textContent: p.evidence }) : null,
      p.note ? el('div', { class: 'skill-note-text', textContent: p.note }) : null,
      el('div', { class: 'row wrap' },
        p.level < 3 ? el('button', { type: 'button', class: 'chip skill-up', textContent: `Теперь: ${LEVELS[p.level + 1].toLowerCase()}`, onclick: async () => { await store.save(setLevel(ev, p.level + 1)); toast(`Уровень: ${LEVELS[p.level + 1].toLowerCase()}`, { actionLabel: 'Отменить', onAction: () => store.save(ev) }); } }) : null,
        el('button', { type: 'button', class: 'chip skill-edit', textContent: 'Изменить', onclick: () => { editingId = ev.id; editorEl = null; render(); } }),
        el('button', { type: 'button', class: 'chip danger skill-del', 'aria-label': `Удалить: ${p.title}`, textContent: 'Удалить', onclick: () => removeSkill(ev) })));
  }

  // ---------- экран ----------
  function renderTop() {
    const st = skillStats(events), status = lessonSkillStatus(events);
    const areas = [...new Set([...TRACKS.map(t => t.title), ...AREA_SUGGESTIONS, ...skillGroups(events).map(g => g.area)])];
    areaList.replaceChildren(...areas.map(a => el('option', { value: a })));
    const parts = [];
    parts.push(el('div', { class: 'card', id: 'skills-head' }, el('h3', { textContent: 'Мои навыки' }),
      st.total ? el('p', { id: 'skills-count', textContent: `Всего: ${st.total} · ${Object.entries(LEVELS).map(([v, t]) => `${t.toLowerCase()}: ${st.byLevel[v]}`).join(' · ')} · областей: ${st.areas}` }) : null,
      el('p', { class: 'muted', textContent: 'Сюда попадает то, что ты точно изучил или научился делать. Из уроков навык предлагается, когда урок пройден и выучено больше 80% его карточек (повторение раз в две недели и реже). Остальное добавляй сам.' }),
      st.total ? el('button', { type: 'button', id: 'skills-copy', class: 'chip', textContent: 'Скопировать список', onclick: () => copyText(skillsText(events), 'Список навыков скопирован') }) : null));
    if (status.ready.length) {
      parts.push(el('div', { class: 'card', id: 'skills-ready' }, el('h3', { textContent: `Можно добавить в навыки (${status.ready.length})` }),
        el('p', { class: 'muted', textContent: 'Эти уроки пройдены, и ты уже уверенно помнишь их карточки.' }),
        ...status.ready.map(r => el('div', { class: 'row ready-row', dataset: { lesson: r.lesson.id } },
          el('span', { class: 'grow' }, el('strong', { textContent: cap(r.goal || r.lesson.title) }), el('div', { class: 'muted', textContent: `${r.track.title} · выучено карточек ${r.mastered} из ${r.total}` })),
          el('button', { type: 'button', class: 'chip ready-add', textContent: 'Добавить', onclick: async () => { const ev = skillFromLesson(r.track, r.lesson, events); await store.save(ev); toast('Навык добавлен', { actionLabel: 'Отменить', onAction: () => store.remove(ev.id) }); } }))),
        status.ready.length > 1 ? el('button', { type: 'button', id: 'ready-add-all', class: 'primary', textContent: 'Добавить все', onclick: async () => { const evs = readySkillEvents(events); await store.saveMany(evs); toast(`Добавлено навыков: ${evs.length}`, { actionLabel: 'Отменить', onAction: () => store.removeMany(evs.map(x => x.id)) }); } }) : null));
    }
    if (status.learning.length) {
      parts.push(el('div', { class: 'card', id: 'skills-learning' }, el('h3', { textContent: 'Изучаю' }),
        el('p', { class: 'muted', textContent: 'Пройденные уроки, карточки которых ещё закрепляются.' }),
        ...status.learning.slice(0, 5).map(r => el('div', { class: 'learning-row', dataset: { lesson: r.lesson.id } },
          el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: cap(r.goal || r.lesson.title) }), el('span', { class: 'muted', textContent: `${r.mastered} из ${r.total} (нужно ${r.needed})` })),
          bar(r.mastered, r.needed)))));
    }
    parts.push(formCard);
    fill(top, ...parts);
    filter.hidden = st.total <= 8;
  }
  function renderList() {
    const q = normalize(filter.value).trim(), total = skillStats(events).total;
    const groups = skillGroups(events).map(g => ({ ...g, items: q ? g.items.filter(e => q.split(/\s+/).every(w => normalize(`${e.payload.title} ${e.payload.area} ${e.payload.note} ${e.payload.evidence}`).includes(w))) : g.items })).filter(g => g.items.length);
    const parts = [];
    if (!total) parts.push(el('p', { class: 'muted', id: 'skills-empty', textContent: 'Пока навыков нет. Добавь первый вручную или пройди урок и выучи его карточки: навык появится здесь.' }));
    else if (!groups.length) parts.push(el('p', { class: 'muted', textContent: 'Ничего не найдено.' }));
    for (const g of groups) parts.push(el('div', { class: 'card skill-group', dataset: { area: g.area } }, el('h3', { textContent: `${g.area} (${g.items.length})` }), ...g.items.map(row)));
    fill(listBox, ...parts);
  }
  const render = () => { renderTop(); renderList(); };
  render();
  return { root, update(evs) { events = evs; if (!root.hidden) render(); }, show() { render(); } };
}
