// Карточка «Версия и обновления»: узнать, есть ли новая версия, и обновиться кнопкой.
// Android-приложение: скачивает APK и открывает системный установщик (подтверждение остаётся за тобой, данные сохраняются).
// Сайт: обновление — это перезагрузка страницы с новыми файлами.
import { el } from './ui.js';
import { isNative, nativePlugin } from './platform.js';
import { VERSION } from './version.js';
import { CHANGELOG } from './changelog.js';
import { getPref, setPref } from './prefs.js';
import { checkApp, checkSite, downloadAndInstall, percent, sizeText, shouldAutoCheck, APK_LINK } from './updater.js';

let found = null;                    // последний результат проверки (общий для карточки и фоновой проверки)

const checkNow = () => (isNative ? checkApp : checkSite)({ current: VERSION });

// Фоновая проверка при запуске: не чаще раза в несколько часов; о каждой новой версии сообщает один раз.
export async function autoCheckUpdate(notify) {
  if (!navigator.onLine || !shouldAutoCheck(getPref('updateCheckedAt'))) return null;
  setPref('updateCheckedAt', Date.now());
  try {
    const r = await checkNow();
    if (r.state === 'newer') {
      found = r;
      if (getPref('updateNotified') !== r.latest) { setPref('updateNotified', r.latest); notify?.(r); }
    }
    return r;
  } catch { return null; }                                   // тихо: нет сети или GitHub занят — это не ошибка для человека
}
export const updateAvailable = () => found?.state === 'newer';

export function createUpdateCard() {
  const root = el('section', { id: 'upd-card', class: 'card settings-card' });
  let st = found?.state === 'newer' ? { phase: 'newer', result: found } : { phase: 'idle' };
  let bar = null, barText = null;

  async function check() {
    st = { phase: 'checking' }; paint();
    try {
      const r = await checkNow();
      found = r.state === 'newer' ? r : null;
      setPref('updateCheckedAt', Date.now());
      st = r.state === 'newer' ? { phase: 'newer', result: r } : r.state === 'current' ? { phase: 'current', latest: r.latest } : { phase: 'error', error: 'Не удалось понять, какая версия новее' };
    } catch (e) { st = { phase: 'error', error: e.message }; }
    paint();
  }

  async function reloadSite() {
    try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* не критично */ }
    location.reload();
  }

  async function runUpdate() {
    const result = st.result;
    st = { phase: 'downloading', progress: 0, result }; paint();
    try {
      const r = await downloadAndInstall({
        plugin: nativePlugin('ApkInstaller'), release: result.release,
        onProgress: e => { st.progress = percent(e.received, e.total); if (bar) { bar.style.width = st.progress + '%'; bar.parentElement.setAttribute('aria-valuenow', String(st.progress)); } if (barText) barText.textContent = `Скачиваю: ${st.progress}%`; },
      });
      st = r.state === 'installing' ? { phase: 'installing', result } : { phase: 'permission', result };
    } catch (e) { st = { phase: 'error', error: e.message, result }; }
    paint();
  }

  function paint() {
    bar = barText = null;
    const kids = [el('h3', { textContent: 'Версия и обновления' }),
      el('p', { id: 'upd-version' }, el('strong', { textContent: VERSION }), el('span', { class: 'muted', textContent: isNative ? ' · Android-приложение' : ' · сайт' }))];
    const status = (text, cls = 'muted') => kids.push(el('p', { id: 'upd-status', class: cls, role: 'status', textContent: text }));
    const checkBtn = (label = 'Проверить обновления') => el('button', { id: 'upd-check', type: 'button', textContent: label, onclick: check });
    const link = () => el('a', { id: 'upd-link', href: APK_LINK, target: '_blank', rel: 'noopener', class: 'link-out', textContent: 'Скачать файл по ссылке и установить вручную' });
    const notes = r => (r?.release?.notes?.length ? el('ul', { class: 'plain muted upd-notes' }, ...r.release.notes.map(t => el('li', { textContent: t }))) : null);
    let actions = [checkBtn()];

    if (st.phase === 'idle') status('Проверка ещё не выполнялась.');
    else if (st.phase === 'checking') { status('Проверяю…'); actions = []; }
    else if (st.phase === 'current') status('Установлена последняя версия.', 'ok');
    else if (st.phase === 'newer') {
      const r = st.result;
      status(`Доступна новая версия ${r.latest}${r.release?.size ? ` (${sizeText(r.release.size)})` : ''}.`, 'ok');
      kids.push(notes(r));
      if (isNative) kids.push(el('p', { class: 'muted', textContent: 'Нажми «Обновить»: файл скачается, затем Android спросит подтверждение. Данные останутся на месте.' }));
      actions = [el('button', { id: 'upd-go', type: 'button', class: 'primary', textContent: isNative ? 'Обновить' : 'Обновить страницу', onclick: isNative ? runUpdate : reloadSite })];
    } else if (st.phase === 'downloading') {
      kids.push(el('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Загрузка обновления', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(st.progress) }, bar = el('span', { id: 'upd-bar', style: `width:${st.progress}%` })));
      kids.push(barText = el('p', { id: 'upd-status', class: 'muted', role: 'status', textContent: `Скачиваю: ${st.progress}%` }));
      actions = [el('button', { id: 'upd-cancel', type: 'button', textContent: 'Отмена', onclick: () => { nativePlugin('ApkInstaller')?.cancel?.(); } })];
    } else if (st.phase === 'installing') {
      status('Откроется окно Android: нажми «Установить». Когда установка закончится, открой приложение снова. Данные останутся на месте.', 'ok');
      actions = [checkBtn('Проверить ещё раз')];
    } else if (st.phase === 'permission') {
      status('Разреши установку из этого приложения (настройки открыты), вернись сюда и нажми «Обновить» ещё раз.', 'warn');
      actions = [el('button', { id: 'upd-go', type: 'button', class: 'primary', textContent: 'Обновить', onclick: runUpdate })];
    } else {
      status(st.error || 'Не получилось обновиться.', 'warn');
      if (isNative) kids.push(link());
      if (st.result) actions.unshift(el('button', { id: 'upd-go', type: 'button', class: 'primary', textContent: 'Попробовать ещё раз', onclick: runUpdate }));
    }
    kids.push(el('div', { class: 'row wrap' }, ...actions));
    const now = CHANGELOG[0];
    if (now && st.phase !== 'downloading') {
      kids.push(el('details', { id: 'upd-changes' }, el('summary', { textContent: `Что нового в ${now.version}` }), el('ul', { class: 'plain muted' }, ...now.items.map(t => el('li', { textContent: t })))));
    }
    root.replaceChildren(...kids.filter(Boolean));
  }
  paint();
  return { root, check, refresh: () => { if (st.phase === 'idle' || st.phase === 'current' || st.phase === 'error') { if (found?.state === 'newer') st = { phase: 'newer', result: found }; paint(); } } };
}
