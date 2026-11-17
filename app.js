import { install as installErrLog } from './errlog.js';
import { $, el, icon, toast, clearToast, announce, watchDialogs, releaseDialogs, watchHeadings, focusNode, keepFocusIn } from './ui.js';

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
import { REQUIRE_ACCOUNT } from './config.js';
import { profileCard } from './profile.js';
import { autoCheckUpdate } from './view-update.js';

import { createTodayView } from './view-today.js';
import { createHabitsView } from './view-habits.js';
import { createMoneyView } from './view-money.js';
import { createNotesView } from './view-notes.js';
import { createDiaryView } from './view-diary.js';
import { createHealthView } from './view-health.js';
import { createLearnView } from './view-learn.js';
import { createZeroView } from './view-zero.js';
import { createDictionView } from './view-diction.js';
import { openLessonIds } from './curriculum.js';
import { createSkillsView } from './view-skills.js';
import { createWorkoutsView } from './view-workouts.js';
import { createPlansView } from './view-plans.js';
import { createPeopleView } from './view-people.js';
import { createOkrView } from './view-okr.js';
import { createReflectView } from './view-reflect.js';
import { createTestsView } from './view-tests.js';
import { createInsightsView } from './view-insights.js';
import { createSettingsView } from './view-settings.js';
import { createAccountView } from './view-account.js';
import { createHelpView } from './view-help.js';
import { createMenuView } from './view-menu.js';
import { createHomeView } from './view-home.js';
import { createProfileView } from './view-profile.js';
import { createSalaryView } from './view-salary.js';
import { createScheduleView } from './view-schedule.js';
import { createTour, openTarget } from './view-help-tour.js';
import { searchHelp } from './help.js';
import * as appSync from './app-sync.js';
import { createTabGuard, tabState } from './tabguard.js';

// Экраны и группы вкладок. Нижняя панель — группы; внутри группы с несколькими экранами есть вторая строка переключателей.
const DEFS = [
  { id: 'today', group: 'today', title: 'Сегодня', sub: 'Задачи', make: ctx => createTodayView(ctx) },
  { id: 'habits', group: 'today', title: 'Привычки', sub: 'Привычки', make: () => createHabitsView() },
  { id: 'diary', group: 'today', title: 'Дневник', sub: 'Дневник', make: () => createDiaryView() },
  { id: 'health', group: 'today', title: 'Здоровье', sub: 'Здоровье', make: () => createHealthView() },
  { id: 'workouts', group: 'today', title: 'Тренировки', sub: 'Тренировки', make: () => createWorkoutsView() },
  { id: 'notes', group: 'today', title: 'Заметки', sub: 'Заметки', make: () => createNotesView() },
  { id: 'reflect', group: 'today', title: 'Рефлексия', sub: 'Итоги', make: () => createReflectView() },
  { id: 'people', group: 'today', title: 'Люди', sub: 'Люди', make: () => createPeopleView() },
  { id: 'home', group: 'home', title: 'Дом', sub: 'Вещи', make: ctx => createHomeView(ctx) },
  { id: 'money', group: 'money', title: 'Деньги', sub: 'Расходы', make: ctx => createMoneyView(ctx) },
  { id: 'salary', group: 'money', title: 'Зарплата', sub: 'Зарплата', make: ctx => createSalaryView(ctx) },
  { id: 'schedule', group: 'money', title: 'График работы', sub: 'График', make: ctx => createScheduleView(ctx) },
  { id: 'plans', group: 'money', title: 'Планы', sub: 'Планы', make: () => createPlansView() },
  { id: 'learn', group: 'grow', title: 'Учёба', sub: 'Курсы', make: ctx => createLearnView(ctx) },
  { id: 'zero', group: 'grow', title: 'С нуля', sub: 'С нуля', make: () => createZeroView() },
  { id: 'diction', group: 'grow', title: 'Дикция', sub: 'Дикция', make: ctx => createDictionView(ctx) },
  { id: 'skills', group: 'grow', title: 'Навыки', sub: 'Навыки', make: () => createSkillsView() },
  { id: 'tests', group: 'grow', title: 'Тесты и проверки', sub: 'Тесты', make: () => createTestsView() },
  { id: 'okr', group: 'grow', title: 'Цели', sub: 'Цели', make: () => createOkrView() },
  { id: 'insights', group: 'grow', title: 'Аналитика', sub: 'Аналитика', make: () => createInsightsView() },
  { id: 'menu', group: 'more', title: 'Меню', sub: 'Все разделы', make: ctx => createMenuView(ctx) },
  { id: 'profile', group: 'more', title: 'Профиль', sub: 'Профиль', make: ctx => createProfileView(ctx) },
  { id: 'account', group: 'more', title: 'Аккаунт', sub: 'Аккаунт', make: ctx => createAccountView(ctx) },
  { id: 'more', group: 'more', title: 'Настройки', sub: 'Настройки', make: ctx => createSettingsView(ctx) },
  { id: 'help', group: 'more', title: 'Справка', sub: 'Справка', make: ctx => createHelpView(ctx) },
];
const GROUPS = [
  { id: 'today', label: 'Сегодня', icon: 'tasks' },
  { id: 'home', label: 'Дом', icon: 'home' },
  { id: 'money', label: 'Деньги', icon: 'money' },
  { id: 'grow', label: 'Учёба', icon: 'growth' },
  { id: 'more', label: 'Меню', icon: 'more' },
];
// Режимы оформления (--mode-accent в style.css): у учёбы, денег, аналитики и безопасности свой акцент, у остальных — основной.
const MODE_OF = { learn: 'learn', tests: 'learn', skills: 'learn', zero: 'learn', diction: 'learn', money: 'finance', salary: 'finance', schedule: 'finance', insights: 'analytics', okr: 'analytics', plans: 'analytics', reflect: 'analytics', profile: 'analytics', account: 'security', more: 'security', help: 'security' };
const FOCUS_TAB = { task: 'today', habit: 'habits', expense: 'money', note: 'notes', diary: 'diary', measure: 'health' };

// Простой режим: меньше вкладок и экранов, только самое нужное. Остальные экраны по-прежнему открываются из чипов и поиска.
const SIMPLE_VIEWS = new Set(['today', 'habits', 'diary', 'health', 'notes', 'menu', 'profile', 'home', 'more', 'account', 'help', 'zero', 'diction']);
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

function go(id, { focus = false } = {}) {
  const def = DEFS.find(d => d.id === id) ?? DEFS[0];
  current = def.id;
  $('app').dataset.mode = MODE_OF[def.id] || 'memory';
  for (const [vid, v] of Object.entries(views)) v.root.hidden = vid !== def.id;
  const v = views[def.id];
  if (v.show) v.show(); else v.update(store.state.events);        // настройки могли измениться (например, время последней копии)
  for (const b of $('tabs').children) { if (b.dataset.tab === def.group) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  const vis = new Set(visibleDefs().map(d => d.id));
  const siblings = DEFS.filter(d => d.group === def.group && (vis.has(d.id) || d.id === def.id));
  const sub = $('subnav');
  sub.hidden = siblings.length < 2;
  sub.replaceChildren(...siblings.map(d => el('button', { type: 'button', dataset: { view: d.id }, 'aria-current': d.id === def.id ? 'page' : false, textContent: d.sub, onclick: () => navigate(d.id) })));
  $('title').textContent = def.title;
  setPref('tab', def.id);
  window.scrollTo(0, 0);
  if (focus) focusNode($('title'));                       // человек сам сменил экран: диктор называет новый заголовок, а Tab идёт дальше по шапке и содержимому
}
// Переход по действию человека (вкладка, ссылка, результат поиска): со сменой фокуса. Внутренние переходы (запуск, блокировка) идут через go() без неё.
const navigate = id => go(id, { focus: true });

// ---------- аватар в шапке: имя и цвет профиля ----------
function paintAvatar(evs) {
  const c = profileCard(evs, appSync.account.info());
  const b = $('profile-btn');
  b.textContent = c.face;
  b.style.setProperty('--av', c.hex);
  b.title = c.name || c.login || 'Профиль';
  b.setAttribute('aria-label', `Профиль: ${c.name || c.login || 'без имени'}`);
}

// ---------- состояние синхронизации в шапке ----------
const BADGE = { idle: ['☁ ✓', 'Всё синхронизировано'], syncing: ['☁ …', 'Синхронизация'], offline: ['☁ ✕', 'Нет связи, изменения сохранены'], error: ['☁ !', 'Ошибка синхронизации'], 'needs-login': ['☁ войти', 'Нужно войти заново'] };
let syncProblem = '';
appSync.onStatus(s => {
  const b = $('sync-badge');
  const info = BADGE[s.state];
  b.hidden = !info;
  if (info) { b.textContent = info[0]; b.title = info[1]; b.dataset.state = s.state; b.setAttribute('aria-label', `Синхронизация: ${info[1]}`); }
  // Диктору сообщаем только о сбоях и о возвращении связи; обычные «синхронизирую…» и «готово» молчат, чтобы не мешать.
  const problem = ['offline', 'error', 'needs-login'].includes(s.state) ? info[1] : '';
  if (problem && problem !== syncProblem) announce(problem);
  else if (!problem && syncProblem && s.state === 'idle') announce('Синхронизация снова работает');
  if (problem || s.state === 'idle') syncProblem = problem;
});

// ---------- поиск ----------
function setSearchOpen(open) { $('search-panel').hidden = !open; $('search-btn').setAttribute('aria-expanded', String(open)); }
function closeSearch() {
  const had = $('search-panel').contains(document.activeElement);
  setSearchOpen(false); $('search-input').value = ''; renderSearch();
  if (had) $('search-btn').focus();                       // фокус не должен пропасть вместе с закрытой панелью
}
function renderSearch() {
  const q = $('search-input').value;
  const box = $('search-results');
  if (!q.trim()) { box.replaceChildren(); return; }
  const res = searchEvents(store.state.events, q);
  const courses = searchAcademy(q, 12, openLessonIds(store.state.events));          // уроки «с нуля» только открытые и только по названию
  box.replaceChildren(...(res.length || courses.length
    ? [...res.map(r => el('button', { type: 'button', class: 'result', onclick: () => { closeSearch(); navigate(r.tab); } },
      el('span', { class: 'kind', textContent: r.kind }), el('span', { textContent: r.title }))),
      ...courses.map(r => el('button', { type: 'button', class: 'result course', dataset: { track: r.trackId }, onclick: () => { closeSearch(); if (r.zero) { navigate('zero'); views.zero.open(r.trackId, r.lessonId); } else { navigate('learn'); views.learn.open(r.trackId, r.lessonId); } } },
        el('span', { class: 'kind', textContent: r.kind }), el('span', { textContent: r.title })))]
    : [el('p', { class: 'muted', textContent: 'Ничего не найдено' }),
      ...searchHelp(q, 2).map(h => el('button', { type: 'button', class: 'chip help-hit', dataset: { help: h.id }, onclick: () => { closeSearch(); openHelp(h.id); } }, `Справка: ${h.title}`))]));
}

// Открыть «Справку» (и сразу статью, если указан её id).
function openHelp(id) { go('help'); if (id) views.help.open(id); }

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
  releaseDialogs();
  $('app').hidden = true;
  $('gate').hidden = true; gateView = null;
  $('lock').hidden = false;
  document.body.classList.remove('privacy');
  $('lock-input').value = ''; $('lock-input').type = 'password'; $('lock-reveal').textContent = 'показать';
  $('lock-msg').textContent = '';
  $('forgot').open = false; $('reset-confirm').value = ''; $('reset-btn').disabled = true;
  clearToast();
  if (navReady) { buildViews(); go(current); }
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

// Экран входа: пока не вошёл в аккаунт, приложение не открывается. Данные на устройстве при этом остаются на месте.
let gateView = null;
async function showGate() {
  appSync.stop();
  releaseDialogs();
  $('app').hidden = true; $('lock').hidden = true; $('gate').hidden = false;
  document.body.classList.remove('privacy');
  clearToast(); closeSearch();
  if (gateView) return;
  try { await store.refresh(); } catch (e) { console.error(e); }              // записи этого устройства нужны входу (присоединение к аккаунту)
  gateView = createAccountView({ go: navigate, gate: true, onVaultChange: updateLockButton, onAuthenticated: () => { gateView = null; freshSignIn = true; enterApp(); } });
  $('gate-body').replaceChildren(gateView.root);
  focusNode(gatePick($('gate-body')));
}
// Экран входа перерисовывается по шагам (проверка сервера, форма, код восстановления): фокус всегда на заголовке шага, дальше Tab идёт к полям.
const gatePick = box => box.querySelector('h3') ?? box.querySelector('input,button');

// Знакомство с приложением: один раз на устройстве, сразу после первого входа (настройка tourDone).
let freshSignIn = false;
function startTour() {
  if (getPref('tourDone')) return;
  setPref('tourDone', true);                              // отмечаем сразу: даже если закрыть приложение посреди знакомства, оно не вернётся
  tour.show();
}

async function enterApp() {
  if (REQUIRE_ACCOUNT && !appSync.account.isLinked()) { await showGate(); return; }
  const fromCover = !$('lock').hidden || !$('gate').hidden;                  // пароль или вход были на экране (кнопка уже заблокирована, поэтому по фокусу не определить)
  gateView = null;
  $('gate').hidden = true;
  $('lock').hidden = true;
  $('app').hidden = false;
  if (fromCover) focusNode($('title'));                  // пароль или вход введены: фокус не должен остаться на исчезнувшем экране
  paintAvatar(store.state.events);                       // кнопка профиля сразу с буквами логина, не пустая, пока грузятся записи
  try { const n = await db.sealPending(); if (n) toast(`Дошифровано записей: ${n}`); } catch (e) { console.error(e); }
  await store.refresh();
  markData();
  updateLockButton();
  appSync.start().catch(e => console.error(e));
  startTabGuard();
  paintAvatar(store.state.events);
  if (freshSignIn) { freshSignIn = false; startTour(); }
  if (!entered) {
    entered = true; handleUrlParams();
    autoCheckUpdate(r => toast(`Доступна новая версия ${r.latest}`, { actionLabel: 'Обновить', onAction: () => navigate('account'), ms: 12000 }));
  }
}

// Второе окно с этим же приложением: считаем окна и подтягиваем чужие записи, чтобы данные не расходились.
let tabGuard = null;
function startTabGuard() {
  if (tabGuard) return;
  tabGuard = createTabGuard({
    onOthers: n => { tabState.others = n; window.dispatchEvent(new CustomEvent('lifeos:tabs', { detail: n })); },
    onRemoteWrite: () => { if (vault.status() !== 'locked') store.refresh().catch(e => console.error(e)); },
  });
  db.onWrite(() => tabGuard.announceWrite());
  addEventListener('pagehide', () => tabGuard?.stop());                     // сообщаем соседям, что окно закрылось
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
  if (e.key === '/') { e.preventDefault(); setSearchOpen(true); $('search-input').focus(); }
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
// Экраны создаются заново и при блокировке: в скрытых экранах и открытых окнах не должно оставаться личных данных.
function buildViews() {
  const main = $('view'), ctx = { go: navigate, lockNow, applyTheme, applyMode, onVaultChange: updateLockButton, openAccount: () => go('account'),
    editProfile: () => { navigate('account'); const form = views.account.root.querySelector('#profile-edit'); if (form) form.open = true; },        // «Изменить профиль»: аккаунт с раскрытой формой имени, значка и цвета
    exportCsv: () => views.more.exportCsv(),
    openHelp, openZero: (trackId, lessonId) => { navigate('zero'); views.zero.open(trackId, lessonId); }, showTour: () => { window.scrollTo(0, 0); tour.show(); },
    onLoggedOut: () => { paintAvatar(store.state.events); if (REQUIRE_ACCOUNT) showGate(); } };
  for (const d of DEFS) {
    const v = d.make(ctx);
    if (views[d.id]) views[d.id].root.replaceWith(v.root); else main.append(v.root);
    views[d.id] = v;
  }
  for (const v of Object.values(views)) v.update([]);
}
let navReady = false;
function buildTabs() {
  const groups = GROUPS.filter(g => visibleDefs().some(d => d.group === g.id));
  $('tabs').replaceChildren(...groups.map(g => el('button', { type: 'button', dataset: { tab: g.id },
    onclick: () => navigate(visibleDefs().find(d => d.group === g.id).id) }, icon(g.icon), el('span', { textContent: g.label }))));
  $('tabs').style.gridTemplateColumns = `repeat(${groups.length}, minmax(0, 1fr))`;      // minmax(0, …): длинная подпись не раздвигает панель за край экрана
}
// Включили или выключили простой режим: пересобрать вкладки; если текущий экран скрыт, перейти на «Сегодня».
function applyMode() {
  if (!navReady) return;
  buildTabs();
  go(visibleDefs().some(d => d.id === current) ? current : 'today');
  for (const v of Object.values(views)) v.update(store.state.events);
}

// Знакомство с приложением живёт под шапкой и остаётся на месте, пока переходишь между экранами.
const tour = createTour({ run: act => openTarget(go, act) });

function build() {
  $('view').before(tour.root);
  $('search-btn').append(icon('search'));
  $('lock-top').append(icon('lock'));
  $('search-btn').onclick = () => {
    if ($('search-panel').hidden) { setSearchOpen(true); $('search-input').focus(); } else closeSearch();
  };
  $('search-input').oninput = renderSearch;
  $('lock-top').onclick = () => lockNow();
  $('profile-btn').onclick = () => navigate('profile');                  // аватар открывает профиль с цифрами; имя, значок и аккаунт — по кнопке «Изменить профиль»
  $('skip-link').onclick = e => { e.preventDefault(); focusNode($('view'), { preventScroll: false }); };       // «Перейти к содержимому» (видна при фокусе с клавиатуры)

  buildViews();
  navReady = true; buildTabs();
  $('sync-badge').onclick = () => navigate('account');
  watchDialogs($('view'));                                // единое поведение окон: фокус внутри, Tab по кругу, Escape, возврат фокуса
  watchHeadings($('view')); watchHeadings($('gate'));     // уровни заголовков без пропусков
  keepFocusIn($('gate-body'), gatePick);

  store.onChange(evs => { for (const v of Object.values(views)) v.update(evs); renderSearch(); paintAvatar(evs); notify.resyncSoon(); });
  store.setLockedHandler(showLock);
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
