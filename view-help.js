// Экран «Справка» («Ещё» → «Справка»): список вопросов, поиск по словам и статьи простыми словами. Тексты и поиск: help.js.
// У статьи может быть кнопка действия (открыть Профиль, архив…): она переходит на нужный экран через ctx.go.
import { el, fill } from './ui.js';
import { HELP_ARTICLES, HELP_GROUPS, articleById, searchHelp } from './help.js';
import { openTarget } from './view-help-tour.js';

export function createHelpView(ctx = {}) {
  const root = el('section', { id: 'view-help', class: 'view' });
  let group = 'all', lastOpened = null;

  const box = el('input', { id: 'help-search', type: 'search', placeholder: 'Например: забыл пароль', autocomplete: 'off', 'aria-label': 'Поиск по справке' });
  const status = el('p', { id: 'help-status', class: 'muted', role: 'status' });
  const head = el('section', { id: 'help-head', class: 'card settings-card' },
    el('h3', { textContent: 'Справка' }),
    el('p', { class: 'muted', textContent: 'Ответы на частые вопросы простыми словами. Напиши слово (например, «пароль») или выбери вопрос.' }),
    box, status);
  const chips = el('div', { id: 'help-groups', class: 'chips', role: 'group', 'aria-label': 'Темы' },
    ...[{ key: 'all', title: 'Все' }, ...HELP_GROUPS].map(g => el('button', { type: 'button', class: 'chip', dataset: { group: g.key }, 'aria-pressed': String(g.key === group), textContent: g.title,
      onclick: () => { group = g.key; renderList(); } })));
  const list = el('div', { id: 'help-list', class: 'help-list' });
  const article = el('section', { id: 'help-article', class: 'card settings-card', hidden: true });
  root.append(head, chips, list, article);

  const item = a => el('button', { type: 'button', class: 'help-item', dataset: { article: a.id }, onclick: () => open(a.id) },
    el('strong', { textContent: a.title }), el('span', { class: 'muted', textContent: a.summary }));

  function renderList() {
    const q = box.value.trim();
    const hits = q ? searchHelp(q) : HELP_ARTICLES.filter(a => group === 'all' || a.groups.includes(group));
    chips.hidden = !!q;
    for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.group === group));
    status.textContent = !q ? '' : hits.length ? `Найдено ответов: ${hits.length}` : 'Ничего не найдено. Попробуй другое слово, например «пароль» или «архив». Все вопросы ниже.';
    fill(list, (hits.length ? hits : HELP_ARTICLES).map(item));
  }
  box.addEventListener('input', renderList);

  function showList(focus) {
    article.hidden = true; fill(article);
    head.hidden = false; list.hidden = false;
    renderList();
    if (focus === 'item') (list.querySelector(`[data-article="${lastOpened}"]`) ?? box).focus({ preventScroll: true });
  }

  const steps = items => el('ol', { class: 'plain help-steps' }, ...items.map(t => el('li', { textContent: t })));
  function act(a) { if (a.tour) ctx.showTour?.(); else openTarget(ctx.go ?? (() => {}), a); }

  // Открыть статью по id. Неизвестный id просто показывает список.
  function open(id) {
    const a = articleById(id);
    if (!a) { showList(); return false; }
    lastOpened = a.id;
    head.hidden = true; chips.hidden = true; list.hidden = true; article.hidden = false;
    const title = el('h3', { id: 'help-title', tabIndex: -1, textContent: a.title });
    fill(article,
      el('button', { id: 'help-back', type: 'button', class: 'link help-link', textContent: '← Все вопросы', onclick: () => showList('item') }),
      title,
      a.intro ? el('p', { id: 'help-intro', textContent: a.intro }) : null,
      a.stepsTitle ? el('h4', { class: 'help-sub', textContent: a.stepsTitle }) : null,
      steps(a.steps),
      ...(a.parts ?? []).flatMap(p => [el('h4', { class: 'help-sub', textContent: p.title }), steps(p.steps)]),
      a.limits?.length ? el('div', { id: 'help-limits', class: 'help-limits' }, el('strong', { textContent: 'Честно о границах' }), el('ul', { class: 'plain' }, ...a.limits.map(t => el('li', { textContent: t })))) : null,
      a.action || a.link ? el('div', { class: 'row wrap' },
        a.action ? el('button', { id: 'help-action', type: 'button', class: 'primary', textContent: a.action.label, onclick: () => act(a.action) }) : null,
        a.link ? el('a', { id: 'help-link', href: a.link.url, target: '_blank', rel: 'noopener', class: 'link-out', textContent: a.link.label }) : null) : null,
      a.related?.length ? el('div', { class: 'help-related' }, el('strong', { textContent: 'Смотри также' }),
        el('div', { class: 'chips' }, ...a.related.map(articleById).filter(Boolean).map(r => el('button', { type: 'button', class: 'chip', dataset: { related: r.id }, textContent: r.title, onclick: () => open(r.id) })))) : null);
    window.scrollTo(0, 0);
    title.focus({ preventScroll: true });
    return true;
  }

  return {
    root,
    update() {},
    // Каждый заход на экран начинается со списка.
    show() { box.value = ''; group = 'all'; showList(); },
    open,
    // Искать из другого места (например, когда в общем поиске ничего не нашлось).
    search(q) { box.value = String(q ?? ''); showList(); },
  };
}
