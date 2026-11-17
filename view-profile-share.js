// Окно «Поделиться итогом» для экрана «Профиль»: короткий текст из цифр. Его видно целиком до отправки; можно скопировать или сохранить файлом.
// В итог не входят деньги, здоровье и названия (это решает profile-stats.js: в текст идут только плитки с пометкой share).
import { el, toast, copyText, focusNode } from './ui.js';
import { saveTextFile } from './platform.js';
import { todayStr } from './events.js';

export function createShareWindow() {
  const title = el('strong', { id: 'pr-share-title', tabIndex: -1, textContent: 'Поделиться итогом' });
  const text = el('textarea', { id: 'pr-share-text', readOnly: true, rows: 8, 'aria-label': 'Текст итога' });
  const note = el('p', { id: 'pr-share-note', class: 'muted' });
  const copy = el('button', { id: 'pr-share-copy', type: 'button', class: 'primary', textContent: 'Скопировать', onclick: () => copyText(text.value, 'Итог скопирован') });
  const save = el('button', { id: 'pr-share-save', type: 'button', textContent: 'Сохранить файлом', onclick: async () => {
    try { const how = await saveTextFile(`itogi-${todayStr()}.txt`, text.value, 'text/plain', 'Отправить итог'); toast(how === 'share' ? 'Выбери, куда отправить итог' : 'Файл сохранён'); }
    catch { toast('Не удалось сохранить файл. Скопируй текст и вставь куда нужно.'); }
  } });
  const host = el('div', { id: 'pr-share-win', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Итог, которым можно поделиться' },
    el('div', { class: 'sess-top' }, title, el('button', { id: 'pr-share-close', type: 'button', class: 'link', textContent: 'Закрыть', onclick: () => close() })),
    note, text, el('div', { class: 'row wrap' }, copy, save));

  function close() { host.hidden = true; }
  // body — готовый текст итога (пустой, если нечем делиться).
  function open(body) {
    text.value = body;
    const has = body.trim().length > 0;
    copy.disabled = save.disabled = !has;
    text.hidden = !has;
    note.textContent = has ? 'Это короткий текст из цифр. Денег, здоровья и названий в нём нет. Посмотри и отправь, если хочешь.' : 'Пока нечем делиться: сделай несколько записей, и здесь появится итог.';
    host.hidden = false;
    host.scrollTop = 0;
    focusNode(title);
  }
  return { root: host, open, close };
}
