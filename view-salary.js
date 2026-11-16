// ЗАГОТОВКА экрана «Зарплата»: полную версию пишет своя команда, этот файл она заменит целиком.
// Контракт экрана: функция create…View(ctx) возвращает { root, update(events), show?() }; корень — <section id="view-salary" class="view">.
import { el } from './ui.js';

export function createSalaryView(ctx = {}) {
  const root = el('section', { id: 'view-salary', class: 'view' },
    el('section', { class: 'card settings-card' }, el('h3', { textContent: 'Зарплата' }), el('p', { class: 'muted', textContent: 'Здесь будет расчёт зарплаты: оклад, налог, переработки по минутам и прогноз до конца месяца.' })));
  return { root, update() {} };
}
