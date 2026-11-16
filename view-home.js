// ЗАГОТОВКА экрана «Дом»: полную версию пишет своя команда, этот файл она заменит целиком.
// Контракт экрана: функция create…View(ctx) возвращает { root, update(events), show?() }; корень — <section id="view-home" class="view">.
import { el } from './ui.js';

export function createHomeView(ctx = {}) {
  const root = el('section', { id: 'view-home', class: 'view' },
    el('section', { class: 'card settings-card' }, el('h3', { textContent: 'Дом' }), el('p', { class: 'muted', textContent: 'Здесь будет список вещей и одежды: что есть, где лежит, сколько раз стирал и носил.' })));
  return { root, update() {} };
}
