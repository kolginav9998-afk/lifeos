// ЗАГОТОВКА экрана «График работы»: полную версию пишет своя команда, этот файл она заменит целиком.
// Контракт экрана: функция create…View(ctx) возвращает { root, update(events), show?() }; корень — <section id="view-schedule" class="view">.
import { el } from './ui.js';

export function createScheduleView(ctx = {}) {
  const root = el('section', { id: 'view-schedule', class: 'view' },
    el('section', { class: 'card settings-card' }, el('h3', { textContent: 'График работы' }), el('p', { class: 'muted', textContent: 'Здесь будет график: рабочие дни и смены, выходные, отметка часов.' })));
  return { root, update() {} };
}
