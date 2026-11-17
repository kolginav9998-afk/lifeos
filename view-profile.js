// Экран «Профиль»: шапка (аватар, имя, девиз, «Вы с нами N дней»), период, плитки со статистикой по разделам, календарь активности, «Поделиться итогом».
// Все числа считает profile-stats.js (чистая логика), здесь только показ. Имя, значок и цвет меняются на экране «Аккаунт»: кнопка «Изменить профиль».
// Разделы приходят списком от profile-stats.js, поэтому новый раздел статистики появляется здесь сам. Экран считает цифры, только пока открыт.
import { el, fill, icon, emptyState, announce } from './ui.js';
import { getPref } from './prefs.js';
import { account } from './app-sync.js';
import { profileCard } from './profile.js';
import { plural } from './home.js';
import { PERIODS, periodRange, statsOverview, appFacts, shareText } from './profile-stats.js';
import { createCalendar } from './view-profile-cal.js';
import { createShareWindow } from './view-profile-share.js';

// Суммы можно скрыть («Скрывать суммы» в настройках): плитки с пометкой private показывают точки и значок валюты.
const mask = value => { const cur = /[^\d\s .,\-−]+$/u.exec(value)?.[0]; return `••••${cur ? ` ${cur}` : ''}`; };
const shown = t => (t.private && getPref('hideAmounts') ? mask(t.value) : t.value);

export function createProfileView(ctx = {}) {
  let events = [], period = 'month', last = null;
  const root = el('section', { id: 'view-profile', class: 'view' });
  const body = el('div', { id: 'pr-body', class: 'pr-body' });
  const cal = createCalendar(), share = createShareWindow();
  root.append(body, share.root);

  const go = screen => ctx.go?.(screen, { focus: true });
  const tile = t => el('div', { class: 'pr-tile', dataset: { key: t.key } },
    el('dt', { class: 'pr-l', textContent: t.label }), el('dd', { class: 'pr-v', textContent: shown(t) }), t.hint ? el('dd', { class: 'pr-hint', textContent: t.hint }) : null);

  function sectionCard(s) {
    const head = el('h3', { class: 'pr-h' }, icon(s.icon, 20), el('span', { textContent: s.title }));
    const card = (...kids) => el('section', { id: `pr-sec-${s.id}`, class: 'card pr-sec', dataset: { sec: s.id } }, head, ...kids);
    if (s.failed) return card(el('p', { class: 'muted', textContent: 'Этот раздел сейчас не удалось посчитать. Остальные цифры на месте.' }));
    if (s.empty) {
      const box = emptyState({ art: s.icon, title: 'Пока нет данных', text: s.emptyText, action: { label: s.emptyAction, onClick: () => go(s.screen) } });
      box.querySelector('.empty-a').dataset.fk = `empty:${s.id}`;
      return card(box);
    }
    return card(el('dl', { class: 'pr-tiles' }, ...s.tiles.map(tile)),
      el('button', { id: `pr-open-${s.id}`, type: 'button', class: 'pr-open', dataset: { fk: `open:${s.id}` }, textContent: 'Открыть раздел', 'aria-label': `Открыть раздел «${s.title}»`, onclick: () => go(s.screen) }));
  }

  function header(card, facts) {
    const days = facts.daysWith;
    return el('section', { id: 'pr-head', class: 'card profile-card pr-head' },
      el('div', { class: 'profile-head' },
        el('div', { id: 'pr-avatar', class: 'avatar big', 'aria-hidden': 'true', style: `--av:${card.hex}`, textContent: card.face }),
        el('div', { class: 'profile-who' },
          el('strong', { id: 'pr-name', textContent: card.name || card.login || 'Без имени' }),
          card.motto ? el('span', { id: 'pr-motto', class: 'profile-motto', textContent: card.motto }) : null,
          el('span', { id: 'pr-days', class: 'muted', textContent: days ? `Вы с нами ${days} ${plural(days, 'день', 'дня', 'дней')}` : 'Здесь начнётся счёт дней, как только появится первая запись' }))),
      el('div', { class: 'row wrap pr-actions' },
        el('button', { id: 'pr-edit', type: 'button', dataset: { fk: 'edit' }, textContent: 'Изменить профиль', onclick: () => ctx.editProfile?.() }),
        el('button', { id: 'pr-share', type: 'button', class: 'primary', dataset: { fk: 'share' }, textContent: 'Поделиться итогом', onclick: () => share.open(shareText(last.list, last.range)) })));
  }

  function choose(kind) {
    if (kind === period) return;
    period = kind;
    render();
    announce(`Период: ${last.range.label}, ${last.range.text}`);
  }
  const periodBlock = range => el('div', { class: 'pr-period' },
    el('div', { class: 'seg-group pr-seg', role: 'group', 'aria-label': 'Период' },
      ...PERIODS.map(([k, label]) => el('button', { id: `pr-p-${k}`, type: 'button', class: 'seg', dataset: { fk: `p:${k}` }, 'aria-pressed': String(k === period), textContent: label, onclick: () => choose(k) }))),
    el('p', { id: 'pr-range', class: 'muted', textContent: `Период: ${range.text}. Здесь только числа из твоих записей: без оценок и без сравнения с другими.` }));

  // Нажатая кнопка при перерисовке заменяется новой: фокус возвращаем на такую же (у кнопок есть метка data-fk).
  function render() {
    const a = document.activeElement, fk = a && root.contains(a) ? a.dataset.fk ?? null : null;
    const now = Date.now(), range = periodRange(period, now), list = statsOverview(events, now, range);
    last = { list, range };
    fill(body, header(profileCard(events, account.info()), appFacts(events, now)), periodBlock(range), ...list.map(sectionCard), cal.root);
    cal.render(events, now);
    if (fk) { const n = [...root.querySelectorAll('[data-fk]')].find(x => x.dataset.fk === fk); if (n && document.activeElement !== n) n.focus({ preventScroll: true }); }
  }
  return { root, update(evs) { events = evs; if (!root.hidden) render(); }, show() { render(); } };
}
