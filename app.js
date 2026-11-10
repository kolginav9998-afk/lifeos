import { install as installErrLog } from './errlog.js';
import { $, el, icon, toast } from './ui.js';

installErrLog();
import * as vault from './vault.js';
import * as db from './db.js';
import * as store from './store.js';
import { getPref, setPref } from './prefs.js';
import { isNative } from './platform.js';
import { searchEvents } from './search.js';
import { VERSION } from './version.js';
import * as notify from './notify.js';
import { createTodayView } from './view-today.js';
import { createHabitsView } from './view-habits.js';
import { createMoneyView } from './view-money.js';
import { createNotesView } from './view-notes.js';
import { createSettingsView } from './view-settings.js';

const TABS = [
  { id: 'today', label: 'Сегодня', title: 'Сегодня', icon: 'tasks' },
  { id: 'habits', label: 'Привычки', title: 'Привычки', icon: 'habits' },
  { id: 'money', label: 'Деньги', title: 'Деньги', icon: 'money' },
  { id: 'notes', label: 'Заметки', title: 'Заметки', icon: 'notes' },
  { id: 'more', label: 'Ещё', title: 'Настройки', icon: 'more' },
];
const FOCUS_TAB = { task: 'today', habit: 'habits', expense: 'money', note: 'notes' };

// ---------- тема ----------
function applyTheme() {
  const t = getPref('theme');
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
}

// ---------- счётчик запусков (для диагностики) ----------
function bumpLaunch() {
  try {
    const m = JSON.parse(localStorage.getItem('lifeos.meta') || 'null') || { first: Date.now(), launches: 0 };
    m.launches += 1;
    localStorage.setItem('lifeos.meta', JSON.stringify(m));
  } catch { /* не критично */ }
}

// ---------- вкладки ----------
const views = {};
let current = 'today';
let entered = false;

function go(tab) {
  if (!views[tab]) tab = 'today';
  current = tab;
  for (const [id, v] of Object.entries(views)) v.root.hidden = id !== tab;
  views[tab].update(store.state.events);                   // настройки могли измениться (например, время последней копии)
  for (const b of $('tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  $('title').textContent = TABS.find(t => t.id === tab).title;
  setPref('tab', tab);
  window.scrollTo(0, 0);
}

// ---------- поиск ----------
function closeSearch() { $('search-panel').hidden = true; $('search-input').value = ''; renderSearch(); }
function renderSearch() {
  const q = $('search-input').value;
  const box = $('search-results');
  if (!q.trim()) { box.replaceChildren(); return; }
  const res = searchEvents(store.state.events, q);
  box.replaceChildren(...(res.length
    ? res.map(r => el('button', { type: 'button', class: 'result', onclick: () => { closeSearch(); go(r.tab); } },
      el('span', { class: 'kind', textContent: r.kind }), el('span', { textContent: r.title })))
    : [el('p', { class: 'muted', textContent: 'Ничего не найдено' })]));
}

// ---------- вход и блокировка ----------
let lockTimer = null;
function updateLockout() {
  clearInterval(lockTimer);
  const tick = () => {
    const { waitMs } = vault.failState();
    if (waitMs > 0) {
      $('lock-msg').textContent = `Слишком много попыток. Подожди ${Math.ceil(waitMs / 1000)} с.`;
      $('lock-btn').disabled = true;
    } else {
      clearInterval(lockTimer);
      $('lock-btn').disabled = false;
      if ($('lock-msg').textContent.startsWith('Слишком')) $('lock-msg').textContent = '';
    }
  };
  if (vault.failState().waitMs > 0) { tick(); lockTimer = setInterval(tick, 500); }
}

function showLock() {
  $('app').hidden = true;
  $('lock').hidden = false;
  document.body.classList.remove('privacy');
  $('lock-input').value = ''; $('lock-input').type = 'password'; $('lock-reveal').textContent = 'показать';
  $('lock-msg').textContent = '';
  $('forgot').open = false; $('reset-confirm').value = ''; $('reset-btn').disabled = true;
  views.more?.reset();
  closeSearch();
  updateLockout();
  $('lock-input').focus();
}

function lockNow() {
  if (!vault.hasVault()) return;
  vault.lock();
  store.clear();
  showLock();
}

function updateLockButton() { $('lock-top').hidden = !vault.hasVault(); }

async function enterApp() {
  $('lock').hidden = true;
  $('app').hidden = false;
  try { const n = await db.sealPending(); if (n) toast(`Дошифровано записей: ${n}`); } catch (e) { console.error(e); }
  await store.refresh();
  updateLockButton();
  if (!entered) { entered = true; handleUrlParams(); }
}

$('lock-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('lock-input').value;
  if (!pw) return;
  $('lock-btn').disabled = true;
  $('lock-msg').textContent = 'Проверяю…';
  try {
    await vault.unlock(pw);
    $('lock-input').value = ''; $('lock-msg').textContent = '';
    await enterApp();
  } catch (err) {
    $('lock-input').value = '';
    if (err instanceof vault.TooManyAttemptsError) { updateLockout(); }
    else if (err instanceof vault.WrongPasswordError) { $('lock-msg').textContent = 'Неверный пароль'; updateLockout(); }
    else { $('lock-msg').textContent = 'Ошибка: ' + err.message; }
  } finally {
    if (vault.failState().waitMs === 0) $('lock-btn').disabled = false;
  }
});
$('lock-reveal').onclick = () => { const i = $('lock-input'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('lock-reveal').textContent = show ? 'скрыть' : 'показать'; };
$('reset-confirm').oninput = () => { $('reset-btn').disabled = $('reset-confirm').value.trim().toUpperCase() !== 'СТЕРЕТЬ'; };
$('reset-btn').onclick = async () => { $('reset-btn').disabled = true; await db.wipeAll(); location.reload(); };

// ---------- автоблокировка и «шторка» приватности ----------
const autoLockMs = () => { const m = getPref('autoLockMin'); return m < 0 ? Infinity : m * 60000; };
let hiddenAt = 0;
let lastActive = Date.now();
document.addEventListener('visibilitychange', () => {
  if (!vault.hasVault()) return;
  if (document.hidden) {
    hiddenAt = Date.now();
    document.body.classList.add('privacy');                // в списке недавних приложений не видно содержимого
    if (autoLockMs() === 0 && vault.isUnlocked()) lockNow();
  } else {
    document.body.classList.remove('privacy');
    if (vault.isUnlocked() && hiddenAt && Date.now() - hiddenAt >= autoLockMs()) lockNow();
    hiddenAt = 0;
  }
});
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true });
setInterval(() => {
  const ms = autoLockMs();
  if (vault.isUnlocked() && ms > 0 && ms !== Infinity && Date.now() - lastActive >= ms) lockNow();
}, 15000);

// ---------- горячие клавиши (для сайта на компьютере) ----------
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || $('app').hidden) return;
  const t = e.target;
  const typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  if (e.key === 'Escape') { if (!$('search-panel').hidden) closeSearch(); return; }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); $('search-panel').hidden = false; $('search-input').focus(); }
  else if (e.key === 'n' || e.key === 'т') { e.preventDefault(); go('today'); views.today.focusAdd(); }
});

// ---------- ссылки: «поделиться» из других приложений и ярлыки ----------
function handleUrlParams() {
  const q = new URLSearchParams(location.search);
  if (!q.toString()) return;
  const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join(' ').trim().slice(0, 500);
  const add = q.get('add');
  if (shared) {
    go('today'); views.today.prefill(shared);
    toast('Получено из другого приложения. Проверь текст и нажми «+».');
  } else if (['task', 'habit', 'expense', 'note'].includes(add)) {
    go(FOCUS_TAB[add]); views[FOCUS_TAB[add]].focusAdd?.();
  }
  history.replaceState(null, '', location.pathname);       // не оставлять чужой текст в адресной строке
}

// ---------- сборка интерфейса ----------
function build() {
  $('search-btn').append(icon('search'));
  $('lock-top').append(icon('lock'));
  $('search-btn').onclick = () => {
    const p = $('search-panel');
    p.hidden = !p.hidden;
    if (!p.hidden) $('search-input').focus(); else closeSearch();
  };
  $('search-input').oninput = renderSearch;
  $('lock-top').onclick = () => lockNow();

  views.today = createTodayView({ go });
  views.more = createSettingsView({ lockNow, applyTheme, onVaultChange: updateLockButton });
  views.habits = createHabitsView();
  views.money = createMoneyView({ exportCsv: () => views.more.exportCsv() });
  views.notes = createNotesView();
  const main = $('view');
  for (const t of TABS) main.append(views[t.id].root);
  $('tabs').replaceChildren(...TABS.map(t => el('button', { type: 'button', dataset: { tab: t.id }, role: 'tab', 'aria-selected': 'false', onclick: () => go(t.id) },
    icon(t.icon), el('span', { textContent: t.label }))));

  store.onChange(evs => { for (const v of Object.values(views)) v.update(evs); renderSearch(); notify.resyncSoon(); });
  store.setLockedHandler(showLock);
  for (const v of Object.values(views)) v.update([]);
}

function setStatus() { $('status').textContent = `${VERSION} · ${navigator.onLine ? 'онлайн' : 'офлайн'}`; }
addEventListener('online', setStatus);
addEventListener('offline', setStatus);

// ---------- запуск ----------
applyTheme();
bumpLaunch();
build();
setStatus();
go(getPref('tab'));
navigator.storage?.persist?.().catch(() => {});
// В приложении файлы уже внутри APK: офлайн-кэш сайта не нужен (и мешал бы обновлениям)
if (!isNative && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

if (vault.status() === 'locked') showLock(); else enterApp();

// вернулись в приложение — пересчитать «сегодня» (мог смениться день)
document.addEventListener('visibilitychange', () => { if (!document.hidden && vault.status() !== 'locked') store.refresh(); });
