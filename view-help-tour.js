// Знакомство при первом входе: три коротких карточки под шапкой. Показывается один раз на устройстве (настройка tourDone, её ставит app.js),
// каждую карточку можно пропустить кнопкой «Позже», закрыть крестиком или клавишей Escape. Тексты карточек: help.js (TOUR).
import { el, fill } from './ui.js';
import { TOUR } from './help.js';

// Перейти на экран из действия справки или знакомства: открыть экран, при необходимости прокрутить к нужной карточке
// и перенести на неё фокус (после перехода кнопка, на которую нажали, уже скрыта вместе со своим экраном).
export function openTarget(go, a) {
  go(a.go);
  const node = a.scrollTo ? document.getElementById(a.scrollTo) : null;
  const box = node ? (node.closest('.card') ?? node) : null;
  const heading = box ? (box.querySelector('h3') ?? box) : document.getElementById('title');
  box?.scrollIntoView?.({ block: 'start' });
  if (heading) { if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
}

// run(action) — выполнить действие карточки (в app.js это openTarget с go). Корень root вставляет app.js перед основным экраном.
export function createTour({ run }) {
  const root = el('section', { id: 'tour', class: 'card calm settings-card', role: 'region', 'aria-label': 'Знакомство с приложением', hidden: true });
  let index = 0, isOpen = false;
  const last = () => index === TOUR.length - 1;

  function paint(focus) {
    const c = TOUR[index];
    const title = el('h3', { id: 'tour-title', tabIndex: -1, textContent: c.title });
    fill(root,
      el('div', { class: 'tour-head' },
        el('span', { id: 'tour-step', class: 'muted', textContent: `Шаг ${index + 1} из ${TOUR.length}` }),
        el('button', { id: 'tour-close', type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть подсказки', textContent: '✕', onclick: () => close(true) })),
      title,
      el('p', { id: 'tour-text', textContent: c.text }),
      el('div', { class: 'row wrap' },
        el('button', { id: 'tour-act', type: 'button', class: 'primary', textContent: c.action.label, onclick: act }),
        el('button', { id: 'tour-later', type: 'button', textContent: 'Позже', onclick: later })));
    if (focus) title.focus({ preventScroll: true });
  }

  // Сделать то, что предлагает карточка, и перейти к следующей (после последней знакомство закрывается).
  function act() {
    const c = TOUR[index], done = last();
    if (!done) index += 1;
    try { run(c.action); } finally { if (done) close(false); else paint(false); }
  }
  function later() { if (last()) close(true); else { index += 1; paint(true); } }
  function close(restoreFocus) {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener('keydown', onKey);
    fill(root); root.hidden = true;
    if (restoreFocus) { const t = document.getElementById('title'); if (t) { if (!t.hasAttribute('tabindex')) t.tabIndex = -1; t.focus({ preventScroll: true }); } }
  }
  // Escape закрывает знакомство, если в этот момент не открыт поиск (ему Escape нужен для закрытия).
  const onKey = e => { if (e.key === 'Escape' && document.getElementById('search-panel')?.hidden !== false) close(true); };

  return {
    root,
    show(from = 0) {
      index = Math.max(0, Math.min(TOUR.length - 1, from));
      if (!isOpen) { isOpen = true; document.addEventListener('keydown', onKey); }
      root.hidden = false;
      paint(true);
    },
    close: () => close(true),
    isOpen: () => isOpen,
  };
}
