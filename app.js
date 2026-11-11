import { install as installErrLog } from './errlog.js';
import { $, el, icon, toast } from './ui.js';

installErrLog();
import * as vault from './vault.js';
import * as db from './db.js';
import * as store from './store.js';
import { getPref, setPref } from './prefs.js';
import { isNative } from './platform.js';
import { searchEvents } from './search.js';
import { searchAcademy } from './academy.js';
import { VERSION } from './version.js';
import * as notify from './notify.js';
import { markShell, markData } from './perf.js';

import { createTodayView } from './view-today.js';
import { createHabitsView } from './view-habits.js';
import { createMoneyView } from './view-money.js';
import { createNotesView } from './view-notes.js';
import { createDiaryView } from './view-diary.js';
import { createHealthView } from './view-health.js';
import { createLearnView } from './view-learn.js';
import { createWorkoutsView } from './view-workouts.js';
import { createPlansView } from './view-plans.js';
import { createPeopleView } from './view-people.js';
import { createOkrView } from './view-okr.js';
import { createReflectView } from './view-reflect.js';
import { createTestsView } from './view-tests.js';
import { createInsightsView } from './view-insights.js';
import { createSettingsView } from './view-settings.js';
import { createAccountView } from './view-account.js';
import * as appSync from './app-sync.js';

// Экраны и группы вкладок. Нижняя панель — группы; внутри группы с несколькими экранами есть вторая строка переключателей.
const DEFS = [
  { id: 'today', group: 'today', title: 'Сегодня', sub: 'Задачи', make: ctx => createTodayView(ctx) },
  { id: 'habits', group: 'today', title: 'Привычки', sub: 'Привычки', make: () => createHabitsView() },
  { id: 'people', group: 'today', title: 'Люди', sub: 'Люди', make: () => createPeopleView() },
  { id: 'diary', group: 'diary', title: 'Дневник', sub: 'Дневник', make: () => createDiaryView() },
  { id: 'health', group: 'diary', title: 'Здоровье', sub: 'Здоровье', make: () => createHealthView() },
  { id: 'workouts', group: 'diary', title: 'Тренировки', sub: 'Тренировки', make: () => createWorkoutsView() },
  { id: 'notes', group: 'diary', title: 'Заметки', sub: 'Заметки', make: () => createNotesView() },
  { id: 'reflect', group: 'diary', title: 'Рефлексия', sub: 'Рефлексия', make: () => createReflectView() },
  { id: 'learn', group: 'grow', title: 'Учёба', sub: 'Учёба', make: () => createLearnView() },
  { id: 'tests', group: 'grow', title: 'Проверка', sub: 'Тесты', make: () => createTestsView() },
  { id: 'insights', group: 'grow', title: 'Аналитика', sub: 'Аналитика', make: () => createInsightsView() },
  { id: 'okr', group: 'grow', title: 'Цели', sub: 'Цели', make: () => createOkrView() },
  { id: 'money', group: 'money', title: 'Деньги', sub: 'Деньги', make: ctx => createMoneyView(ctx) },
  { id: 'plans', group: 'money', title: 'Планы', sub: 'Планы', make: () => createPlansView() },
  { id: 'more', group: 'more', title: 'Настройки', sub: 'Настройки', make: ctx => createSettingsView(ctx) },
  { id: 'account', group: 'more', title: 'Аккаунт', sub: 'Аккаунт', make: ctx => createAccountView(ctx) },
];
const GROUPS = [
  { id: 'today', label: 'Сегодня', icon: 'tasks' },
  { id: 'diary', label: 'Дневник', icon: 'diary' },
  { id: 'grow', label: 'Развитие', icon: 'growth' },
  { id: 'money', label: 'Деньги', icon: 'money' },
  { id: 'more', label: 'Ещё', icon: 'more' },
];
const FOCUS_TAB = { task: 'today', habit: 'habits', expense: 'money', note: 'notes', diary: 'diary', measure: 'health' };

// Простой режим: меньше вкладок и экранов, только самое нужное. Остальные экраны по-прежнему открываются из чипов и поиска.
const SIMPLE_VIEWS = new Set(['today', 'habits', 'diary', 'health', 'notes', 'more', 'account']);
const visibleDefs = () => (getPref('simple') ? DEFS.filter(d => SIMPLE_VIEWS.has(d.id)) : DEFS);

// ---------- тема ----------
function applyTheme() {
  const fs = Number(getPref('fontScale')) || 1;
  document.documentElement.style.setProperty('--fs', String([1, 1.15, 1.3].includes(fs) ? fs : 1));
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

function go(id) {
  const def = DEFS.find(d => d.id === id) ?? DEFS[0];
  current = def.id;
  for (const [vid, v] of Object.entries(views)) v.root.hidden = vid !== def.id;
  const v = views[def.id];
  if (v.show) v.show(); else v.update(store.state.events);        // настройки могли измениться (например, время последней копии)
  for (const b of $('tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === def.group));
  const vis = new Set(visibleDefs().map(d => d.id));
  const siblings = DEFS.filter(d => d.group === def.group && (vis.has(d.id) || d.id === def.id));
  const sub = $('subnav');
  sub.hidden = siblings.length < 2;
  sub.replaceChildren(...siblings.map(d => el('button', { type: 'button', dataset: { view: d.id }, 'aria-pressed': String(d.id === def.id), textContent: d.sub, onclick: () => go(d.id) })));
  $('title').textContent = def.title;
  setPref('tab', def.id);
  window.scrollTo(0, 0);
}

// ---------- состояние синхронизации в шапке ----------
const BADGE = { idle: ['☁ ✓', 'Всё синхронизировано'], syncing: ['☁ …', 'Синхронизация'], offline: ['☁ ✕', 'Нет связи, изменения сохранены'], error: ['☁ !', 'Ошибка синхронизации'], 'needs-login': ['☁ войти', 'Нужно войти заново'] };
appSync.onStatus(s => {
  const b = $('sync-badge');
  const info = BADGE[s.state];
  b.hidden = !info;
  if (info) { b.textContent = info[0]; b.title = info[1]; b.dataset.state = s.state; }
});

// ---------- поиск ----------
function closeSearch() { $('search-panel').hidden = true; $('search-input').value = ''; renderSearch(); }
function renderSearch() {
  const q = $('search-input').value;
  const box = $('search-results');
  if (!q.trim()) { box.replaceChildren(); return; }
  const res = searchEvents(store.state.events, q);
  const courses = searchAcademy(q);
  box.replaceChildren(...(res.length || courses.length
    ? [...res.map(r => el('button', { type: 'button', class: 'result', onclick: () => { closeSearch(); go(r.tab); } },
      el('span', { class: 'kind', textContent: r.kind }), el('span', { textContent: r.title }))),
      ...courses.map(r => el('button', { type: 'button', class: 'result course', dataset: { track: r.trackId }, onclick: () => { closeSearch(); go('learn'); views.learn.open(r.trackId, r.lessonId); } },
        el('span', { class: 'kind', textContent: r.kind }), el('span', { textContent: r.title })))]
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
  appSync.stop();
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
  markData();
  updateLockButton();
  appSync.start().catch(e => console.error(e));
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
  } else if (['task', 'habit', 'expense', 'note', 'diary', 'measure'].includes(add)) {
    go(FOCUS_TAB[add]); views[FOCUS_TAB[add]].focusAdd?.();
  }
  history.replaceState(null, '', location.pathname);       // не оставлять чужой текст в адресной строке
}

// ---------- сборка интерфейса ----------
let navReady = false;
function buildTabs() {
  const groups = GROUPS.filter(g => visibleDefs().some(d => d.group === g.id));
  $('tabs').replaceChildren(...groups.map(g => el('button', { type: 'button', dataset: { tab: g.id }, role: 'tab', 'aria-selected': 'false',
    onclick: () => go(visibleDefs().find(d => d.group === g.id).id) }, icon(g.icon), el('span', { textContent: g.label }))));
  $('tabs').style.gridTemplateColumns = `repeat(${groups.length}, 1fr)`;
}
// Включили или выключили простой режим: пересобрать вкладки; если текущий экран скрыт, перейти на «Сегодня».
function applyMode() {
  if (!navReady) return;
  buildTabs();
  go(visibleDefs().some(d => d.id === current) ? current : 'today');
  for (const v of Object.values(views)) v.update(store.state.events);
}

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

  const ctx = { go, lockNow, applyTheme, applyMode, onVaultChange: updateLockButton, openAccount: () => go('account'), exportCsv: () => views.more.exportCsv() };
  const main = $('view');
  for (const d of DEFS) { views[d.id] = d.make(ctx); main.append(views[d.id].root); }
  navReady = true; buildTabs();
  $('sync-badge').onclick = () => go('account');

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
markShell();
navigator.storage?.persist?.().catch(() => {});
// В приложении файлы уже внутри APK: офлайн-кэш сайта не нужен (и мешал бы обновлениям)
if (!isNative && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

if (vault.status() === 'locked') showLock(); else enterApp();

// вернулись в приложение — пересчитать «сегодня» (мог смениться день)
document.addEventListener('visibilitychange', () => { if (!document.hidden && vault.status() !== 'locked') store.refresh(); });
