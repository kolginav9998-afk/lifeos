// Календарь активности для экрана «Профиль»: 26 недель, по клетке на день, цвет — сколько было записей.
// Одним цветом ничего не сказано: рядом сводка словами и таблица по неделям (открывается кнопкой), поэтому сама сетка для диктора скрыта.
import { el, fill } from './ui.js';
import { activityByDay, activityText, activityWeeks, ACTIVITY_LEVELS } from './profile-stats.js';
import { plural } from './home.js';

const WEEKS = 26;
const ru = ymd => { const [, m, d] = ymd.split('-').map(Number); return `${d} ${['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][m - 1]}`; };
const records = n => `${n} ${plural(n, 'запись', 'записи', 'записей')}`;

export function createCalendar() {
  const grid = el('div', { id: 'pr-grid', class: 'pr-grid', 'aria-hidden': 'true' });
  const legend = el('ul', { id: 'pr-legend', class: 'pr-legend', 'aria-hidden': 'true' },
    ...ACTIVITY_LEVELS.map(([level, text]) => el('li', {}, el('i', { class: `pr-cell pr-l${level}` }), el('span', { textContent: text }))));
  const words = el('p', { id: 'pr-cal-text', class: 'pr-cal-text' });
  const caption = el('caption', { textContent: 'Записи по неделям, новые недели сверху' });
  const body = el('tbody');
  const table = el('table', { id: 'pr-cal-table', class: 'pr-table' }, caption,
    el('thead', {}, el('tr', {}, ...['Неделя', 'Записей', 'Активных дней'].map(t => el('th', { scope: 'col', textContent: t })))), body);
  const more = el('details', { id: 'pr-cal-more', class: 'pr-cal-more' }, el('summary', { textContent: 'Показать таблицей по неделям' }), table);
  const root = el('section', { id: 'pr-cal', class: 'card pr-cal' },
    el('h3', { class: 'pr-h', textContent: 'Календарь активности' }),
    el('p', { class: 'muted', textContent: 'Каждая клетка — один день, справа сегодняшний. Чем темнее клетка, тем больше записей в этот день.' }),
    grid, legend, words, more);

  // facts — уже посчитанные appFacts (серия): второй раз журнал не перебираем.
  function render(events, now, facts) {
    const cal = activityByDay(events, now, WEEKS);
    grid.style.setProperty('--cols', String(cal.weeks.length));
    fill(grid, ...cal.weeks.flatMap(week => week.map(c => el('i', { class: `pr-cell pr-l${c.level}${c.future ? ' pr-future' : ''}`, title: c.future ? '' : `${ru(c.date)}: ${c.count ? records(c.count) : 'записей нет'}` }))));
    words.textContent = `${activityText(cal)}${facts.streak ? ` Дней подряд сейчас: ${facts.streak}.` : ''}`;
    fill(body, ...activityWeeks(cal).map(w => el('tr', {}, el('th', { scope: 'row', textContent: w.text }), el('td', { textContent: String(w.count) }), el('td', { textContent: String(w.active) }))));
  }
  return { root, render };
}
