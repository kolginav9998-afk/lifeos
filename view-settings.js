import { el, toast, setBusy, agoText, revealable } from './ui.js';
import * as vault from './vault.js';
import * as db from './db.js';
import * as store from './store.js';
import { serialize, makeProfile, profileOf, todayStr } from './events.js';
import { encryptBackup, decryptBackup, readBackup, backupKind, NeedPasswordError, BadBackupPasswordError, MAX_BACKUP_BYTES } from './backup.js';
import { expensesToCsv } from './money.js';
import { toMarkdown } from './export.js';
import { saveTextFile, isNative, platformName } from './platform.js';
import { getPref, setPref } from './prefs.js';
import { VERSION } from './version.js';
import * as notify from './notify.js';
import { log as errorLog } from './errlog.js';
import { account } from './app-sync.js';
import { describeError } from './account.js';

const TYPE_NAMES = { task: 'задачи', habit: 'привычки', habit_log: 'отметки привычек', expense: 'расходы', income: 'доходы', note: 'заметки' };
const AUTOLOCK = [[0, 'сразу при сворачивании'], [1, 'через 1 минуту'], [5, 'через 5 минут'], [15, 'через 15 минут'], [60, 'через час'], [-1, 'никогда']];

function card(title, ...kids) { return el('section', { class: 'card settings-card' }, el('h3', { textContent: title }), ...kids); }
function field(id, props) { return el('input', { id, autocomplete: 'off', ...props }); }

export function createSettingsView({ lockNow, applyTheme, onVaultChange, openAccount = () => {} }) {
  let events = [];
  let pendingImport = null;                       // текст выбранного файла, ждущий пароля
  const root = el('section', { id: 'view-more', class: 'view' });

  // ---------- профиль ----------
  const nameInput = field('profile-name', { type: 'text', placeholder: 'Как к тебе обращаться (необязательно)', maxLength: 60 });
  const nameForm = el('form', { id: 'profile-form', class: 'row' }, nameInput, el('button', { type: 'submit', textContent: 'Сохранить' }));
  nameForm.onsubmit = async e => {
    e.preventDefault();
    await store.save(makeProfile(nameInput.value, Date.now(), profileOf(events)));
    toast('Имя сохранено');
  };

  // ---------- защита паролем ----------
  const secBox = el('div', { id: 'sec-box' });

  function enableForm() {
    const p1 = field('pw1', { type: 'password', autocomplete: 'new-password', placeholder: 'Пароль (не короче 8 символов)' });
    const p2 = field('pw2', { type: 'password', autocomplete: 'new-password', placeholder: 'Повтори пароль' });
    const ack = el('input', { id: 'pw-ack', type: 'checkbox' });
    const meter = el('div', { id: 'pw-strength', class: 'strength', 'aria-live': 'polite' });
    p1.addEventListener('input', () => {
      const st = vault.passwordStrength(p1.value);
      meter.className = 'strength s' + st.score;
      meter.textContent = p1.value ? `Надёжность: ${st.label}` : '';
    });
    const btn = el('button', { id: 'pw-enable', type: 'submit', class: 'primary', textContent: 'Включить защиту' });
    const form = el('form', { id: 'pw-form', class: 'form-stack' },
      el('p', { class: 'muted', textContent: 'Все данные на этом устройстве будут зашифрованы (AES-256, ключ из твоего пароля). Приложение будет просить пароль при открытии и блокироваться само.' }),
      el('p', { class: 'warn', textContent: 'Забытый пароль восстановить нельзя: у меня его нет и получить его неоткуда. Сначала сохрани резервную копию (раздел ниже).' }),
      revealable(p1), meter, revealable(p2), el('label', { class: 'check-label' }, ack, ' Я понимаю: без пароля данные не открыть'), btn);
    form.onsubmit = async e => {
      e.preventDefault();
      if (p1.value !== p2.value) return toast('Пароли не совпадают');
      const weak = vault.checkPassword(p1.value);
      if (weak) return toast(weak);
      if (!ack.checked) return toast('Подтверди галочкой, что понимаешь последствия');
      if (!getPref('lastBackupAt') && store.state.events.length
        && !confirm('Ты ещё не сохранял резервную копию. Если при шифровании что-то пойдёт не так, данные могут пропасть. Лучше сначала сохранить копию (раздел ниже). Включить защиту всё равно?')) return;
      setBusy(btn, true, 'Шифрую…');
      try {
        const n = await db.enableLock(p1.value);
        await store.refresh();
        toast(`Защита включена. Зашифровано записей: ${n}`);
        onVaultChange();
      } catch (err) { toast('Не удалось включить защиту: ' + err.message); }
      finally { p1.value = p2.value = ''; setBusy(btn, false); renderSecurity(); }
    };
    return form;
  }

  function manageBox() {
    const auto = el('select', { id: 'autolock' }, ...AUTOLOCK.map(([v, t]) => el('option', { value: String(v), textContent: t })));
    auto.value = String(getPref('autoLockMin'));
    auto.onchange = () => setPref('autoLockMin', Number(auto.value));

    const o = field('pw-old', { type: 'password', autocomplete: 'current-password', placeholder: 'Текущий пароль' });
    const n1 = field('pw-new1', { type: 'password', autocomplete: 'new-password', placeholder: 'Новый пароль' });
    const n2 = field('pw-new2', { type: 'password', autocomplete: 'new-password', placeholder: 'Повтори новый пароль' });
    const chBtn = el('button', { id: 'pw-change', type: 'submit', textContent: 'Сменить пароль' });
    const chForm = el('form', { class: 'form-stack' }, revealable(o), revealable(n1), revealable(n2), chBtn);
    chForm.onsubmit = async e => {
      e.preventDefault();
      if (n1.value !== n2.value) return toast('Новые пароли не совпадают');
      setBusy(chBtn, true, 'Меняю…');
      try { await account.changePassword({ oldPassword: o.value, newPassword: n1.value }); toast('Пароль изменён'); o.value = n1.value = n2.value = ''; }
      catch (err) { toast(err instanceof vault.WrongPasswordError ? 'Текущий пароль неверный' : describeError(err)); }
      finally { setBusy(chBtn, false); }
    };

    const off = field('pw-off', { type: 'password', autocomplete: 'current-password', placeholder: 'Пароль для подтверждения' });
    const offBtn = el('button', { id: 'pw-disable', type: 'submit', class: 'danger', textContent: 'Отключить защиту' });
    const offForm = el('form', { class: 'form-stack' },
      el('p', { class: 'muted', textContent: 'Данные снова будут храниться без шифрования, вход по паролю пропадёт.' }), revealable(off), offBtn);
    offForm.onsubmit = async e => {
      e.preventDefault();
      setBusy(offBtn, true, 'Расшифровываю…');
      let ok = false;
      try { await db.disableLock(off.value); await store.refresh(); toast('Защита отключена'); onVaultChange(); ok = true; }
      catch (err) { toast(err instanceof vault.WrongPasswordError ? 'Пароль неверный' : 'Не удалось: ' + err.message); }
      finally { off.value = ''; setBusy(offBtn, false); if (ok || vault.status() === 'none') renderSecurity(); }   // при ошибке раздел остаётся открытым
    };

    return el('div', { class: 'form-stack' },
      el('p', { class: 'ok', id: 'sec-status', textContent: '✓ Защита включена. Данные зашифрованы.' }),
      el('label', {}, 'Блокировать приложение: ', auto),
      el('div', { class: 'row' }, el('button', { id: 'lock-now', type: 'button', class: 'primary', textContent: 'Заблокировать сейчас', onclick: () => lockNow() })),
      el('details', {}, el('summary', { textContent: 'Сменить пароль' }), chForm),
      account.isLinked()
        ? el('p', { id: 'pw-off-blocked', class: 'muted', textContent: 'Защиту нельзя отключить, пока устройство подключено к аккаунту: данные на сервере зашифрованы. Сначала выйди из аккаунта.' })
        : el('details', {}, el('summary', { textContent: 'Отключить защиту' }), offForm));
  }

  function renderSecurity() {
    secBox.replaceChildren(vault.status() === 'none' ? enableForm() : manageBox());
  }

  // ---------- резервные копии ----------
  const stamp = () => todayStr();
  const bkPass = field('bk-pass', { type: 'password', autocomplete: 'new-password', placeholder: 'Пароль для копии (не короче 8 символов)' });
  const bkBtn = el('button', { id: 'bk-enc', type: 'button', class: 'primary', textContent: 'Сохранить зашифрованную копию' });
  bkBtn.onclick = async () => {
    setBusy(bkBtn, true, 'Шифрую…');
    try {
      const text = await encryptBackup(store.state.events, bkPass.value);
      const check = await decryptBackup(text, bkPass.value);               // сразу проверяем, что копию можно прочитать
      if (check.events.length !== store.state.events.length || check.skipped) throw new Error('Проверка копии не пройдена, файл не сохранён');
      await saveTextFile(`lifeos-${stamp()}.enc.json`, text);
      setPref('lastBackupAt', Date.now());
      toast(`Копия проверена и сохранена (записей: ${check.events.length})`);
      bkPass.value = '';
      renderStats();
    } catch (err) { toast(err.message); }
    finally { setBusy(bkBtn, false); }
  };
  const plainBtn = el('button', { id: 'export-btn', type: 'button', textContent: 'Копия открытым текстом (JSON)' });
  plainBtn.onclick = async () => {
    if (vault.hasVault() && !confirm('Файл будет БЕЗ шифрования: любой, кто его получит, прочтёт все данные. Продолжить?')) return;
    try { await saveTextFile(`lifeos-${stamp()}.json`, serialize(store.state.events)); setPref('lastBackupAt', Date.now()); renderStats(); toast(`Сохранено записей: ${store.state.events.length}`); }
    catch (err) { toast('Не удалось сохранить: ' + (err?.message || err)); }
  };
  const csvBtn = el('button', { id: 'export-csv', type: 'button', textContent: 'Расходы и доходы для Excel (CSV)', onclick: () => exportCsv() });
  const mdBtn = el('button', { id: 'export-md', type: 'button', textContent: 'Всё читаемо (Markdown)', onclick: () => saveTextFile(`lifeos-${stamp()}.md`, toMarkdown(store.state.events), 'text/markdown').catch(err => toast(err.message)) });
  async function exportCsv() {
    try { await saveTextFile(`money-${stamp()}.csv`, expensesToCsv(store.state.events), 'text/csv'); }
    catch (err) { toast('Не удалось сохранить: ' + (err?.message || err)); }
  }

  const impInput = el('input', { id: 'import-input', type: 'file', accept: '.json,application/json', hidden: true });
  const impPass = field('imp-pass', { type: 'password', autocomplete: 'current-password', placeholder: 'Пароль от этой копии' });
  const impGo = el('button', { id: 'imp-go', type: 'button', class: 'primary', textContent: 'Расшифровать и восстановить' });
  const impRow = el('div', { id: 'imp-row', class: 'row', hidden: true }, revealable(impPass), impGo);
  async function runImport(text, password) {
    try {
      const r = await readBackup(text, password);
      await store.saveMany(r.events);
      pendingImport = null; impRow.hidden = true; impPass.value = '';
      toast(`Восстановлено записей: ${r.events.length}` + (r.skipped ? `, пропущено повреждённых: ${r.skipped}` : ''));
    } catch (err) {
      if (err instanceof NeedPasswordError || err instanceof BadBackupPasswordError) { impRow.hidden = false; toast(err.message); }
      else { pendingImport = null; impRow.hidden = true; toast('Ошибка: ' + err.message); }
    }
  }
  impInput.onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) return toast('Файл слишком большой');
    const text = await file.text();
    if (backupKind(text) === 'encrypted') { pendingImport = text; impRow.hidden = false; impPass.focus(); toast('Копия зашифрована — введи пароль от неё'); return; }
    await runImport(text);
  };
  impGo.onclick = async () => { if (pendingImport) { setBusy(impGo, true, 'Расшифровываю…'); await runImport(pendingImport, impPass.value); setBusy(impGo, false); } };
  const impLabel = el('label', { class: 'btn' }, 'Восстановить из копии', impInput);

  // ---------- внешний вид и поведение ----------
  const theme = el('select', { id: 'theme-select' }, ...[['auto', 'как в системе'], ['light', 'светлая'], ['dark', 'тёмная']].map(([v, t]) => el('option', { value: v, textContent: t })));
  theme.value = getPref('theme');
  theme.onchange = () => { setPref('theme', theme.value); applyTheme(); };
  const parseDates = el('input', { id: 'pref-parse', type: 'checkbox', checked: !!getPref('parseDates') });
  parseDates.onchange = () => setPref('parseDates', parseDates.checked);
  const hideAmounts = el('input', { id: 'pref-hide', type: 'checkbox', checked: !!getPref('hideAmounts') });
  hideAmounts.onchange = () => { setPref('hideAmounts', hideAmounts.checked); store.refresh(); };

  // ---------- напоминания (только в приложении) ----------
  const remindBox = el('div', { id: 'remind-box', class: 'form-stack' });
  const hours = (values, off) => values.map(h => [h, h < 0 ? off : `в ${String(h).padStart(2, '0')}:00`]);
  function renderReminders() {
    if (!isNative) {
      remindBox.replaceChildren(el('p', { class: 'muted', textContent: 'Напоминания работают только в приложении для Android: сайт не может будить телефон. Они не требуют интернета и Google-сервисов, а в тексте уведомлений нет названий задач.' }));
      return;
    }
    const on = el('input', { id: 'pref-remind', type: 'checkbox', checked: !!getPref('remindersOn') });
    const th = el('select', { id: 'remind-task-hour' }, ...hours([-1, 7, 8, 9, 10, 11, 12], 'не напоминать').map(([v, t]) => el('option', { value: String(v), textContent: t })));
    const hh = el('select', { id: 'remind-habit-hour' }, ...hours([-1, 18, 19, 20, 21, 22], 'не напоминать').map(([v, t]) => el('option', { value: String(v), textContent: t })));
    th.value = String(getPref('taskHour')); hh.value = String(getPref('habitHour'));
    const status = el('p', { id: 'remind-status', class: 'muted', textContent: getPref('remindersOn') ? 'Включено' : 'Выключено' });
    const run = async ask => {
      const r = await notify.resync({ ask });
      status.textContent = r.ok ? `Запланировано уведомлений: ${r.count ?? 0}` : r.reason === 'denied' ? 'Нет разрешения на уведомления' : `Не удалось: ${r.reason}`;
      return r;
    };
    on.onchange = async () => {
      setPref('remindersOn', on.checked);
      const r = await run(on.checked);
      if (on.checked && !r.ok) { setPref('remindersOn', false); on.checked = false; toast(r.reason === 'denied' ? 'Разрешение не выдано. Включи уведомления для Life OS в настройках телефона.' : 'Не удалось включить напоминания'); }
    };
    th.onchange = () => { setPref('taskHour', Number(th.value)); if (getPref('remindersOn')) run(false); };
    hh.onchange = () => { setPref('habitHour', Number(hh.value)); if (getPref('remindersOn')) run(false); };
    const test = el('button', { id: 'remind-test', type: 'button', textContent: 'Тестовое уведомление через 5 секунд', onclick: async () => {
      const r = await notify.testNow();
      toast(r.ok ? 'Закрой экран или сверни приложение: уведомление придёт через 5 секунд' : r.reason === 'denied' ? 'Нет разрешения на уведомления' : `Не удалось: ${r.reason}`);
    } });
    remindBox.replaceChildren(
      el('label', { class: 'check-label' }, on, ' Напоминать о задачах и привычках'),
      el('label', {}, 'О задачах на день: ', th), el('label', {}, 'О привычках: ', hh), status, test,
      el('p', { class: 'muted', textContent: 'Если уведомления не приходят, на Huawei разреши приложению автозапуск и работу в фоне (Настройки → Батарея → Запуск приложений).' }));
  }

  // ---------- данные и диагностика ----------
  const stats = el('div', { id: 'stats', class: 'muted pre' });
  const corrupt = el('p', { id: 'corrupt', class: 'warn', hidden: true });
  const diag = el('pre', { id: 'diag', class: 'diag', 'aria-label': 'Диагностика хранилища' });

  async function renderDiag() {
    let persisted = 'неизвестно';
    try { if (navigator.storage?.persisted) persisted = (await navigator.storage.persisted()) ? 'да' : 'нет'; } catch { /* нет API */ }
    let meta = null;
    try { meta = JSON.parse(localStorage.getItem('lifeos.meta') || 'null'); } catch { /* нет */ }
    const c = await db.counts();
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    diag.textContent = [
      `Версия ${VERSION}`,
      meta ? `Запуск №${meta.launches} (первый: ${new Date(meta.first).toLocaleString('ru')})` : 'Запуски: счётчик недоступен',
      `Платформа: ${platformName}; ${isNative ? 'встроенное приложение' : standalone ? 'установленное приложение' : 'вкладка браузера'}`,
      `Записей: IndexedDB ${c.idb ?? 'ошибка'}, копия ${c.ls}`,
      `Защита от очистки: ${persisted}`,
      `Пароль: ${{ none: 'не задан', locked: 'задан (заблокировано)', unlocked: 'задан (открыто)' }[vault.status()]}`,
      db.state.idbOk === false ? `Ошибка IndexedDB: ${db.state.idbError}` : '',
      ...(errorLog.length ? ['Последние ошибки:', ...errorLog] : []),
    ].filter(Boolean).join('\n');
  }

  async function renderStats() {
    const cnt = {};
    for (const e of events) cnt[e.type] = (cnt[e.type] || 0) + 1;
    const parts = Object.entries(TYPE_NAMES).filter(([t]) => cnt[t]).map(([t, name]) => `${name}: ${cnt[t]}`);
    let usage = '';
    try { const est = await navigator.storage?.estimate?.(); if (est?.usage) usage = ` · занято ≈ ${Math.max(1, Math.round(est.usage / 1024))} КБ`; } catch { /* нет API */ }
    stats.textContent = (parts.length ? parts.join(' · ') : 'Данных пока нет') + usage + `\nПоследняя копия: ${agoText(getPref('lastBackupAt'))}`;
    const bad = db.state.corrupt.length;
    corrupt.hidden = bad === 0;
    corrupt.textContent = bad ? `Не удалось прочитать записей: ${bad}. Они не удалены и остались на диске. Если помнишь, что менял пароль или файлы вручную, восстанови данные из копии.` : '';
  }

  // ---------- опасная зона ----------
  const wipeConfirm = field('wipe-confirm', { type: 'text', placeholder: 'Напиши СТЕРЕТЬ, чтобы подтвердить' });
  const wipeBtn = el('button', { id: 'wipe-btn', type: 'button', class: 'danger', textContent: 'Стереть все данные', disabled: true });
  wipeConfirm.oninput = () => { wipeBtn.disabled = wipeConfirm.value.trim().toUpperCase() !== 'СТЕРЕТЬ'; };
  wipeBtn.onclick = async () => {
    setBusy(wipeBtn, true, 'Стираю…');
    try { await db.wipeAll(); location.reload(); }
    catch (err) { toast('Не удалось стереть: ' + err.message); setBusy(wipeBtn, false); }
  };

  const privacy = el('ul', { class: 'plain muted' },
    el('li', { textContent: 'Все данные хранятся только на этом устройстве (в браузере или внутри приложения). Приложение не отправляет их никуда: нет сервера, аналитики и рекламы.' }),
    el('li', { textContent: 'С включённой защитой записи шифруются AES-256-GCM, ключ получается из пароля (PBKDF2, 600 000 итераций) и хранится только в памяти, пока приложение открыто.' }),
    el('li', { textContent: 'Это защищает от посторонних, получивших телефон или файлы приложения. Короткий пароль можно подобрать перебором, поэтому лучше длинная фраза. Шифрование не проверялось независимым аудитом.' }),
    el('li', { textContent: 'После удаления следы старых записей могут оставаться в памяти устройства, пока система её не перезапишет. Для полной очистки используй «Стереть все данные» и перезагрузи телефон.' }),
    el('li', { textContent: 'Резервные копии сохраняй зашифрованными: открытый JSON читается любым.' }));

  const accountText = el('p', { id: 'settings-account', class: 'muted' });
  const accountCard = card('Аккаунт и синхронизация', accountText, el('div', { class: 'row' }, el('button', { id: 'open-account', type: 'button', class: 'primary', textContent: 'Открыть', onclick: () => openAccount() })));
  function renderAccountText() {
    const a = account.info();
    accountText.textContent = a ? `Подключён: ${a.username} · ${a.server}` : 'Не подключён. Один логин для телефона, приложения и браузера.';
  }

  root.append(
    accountCard,
    card('Профиль', nameForm),
    card('Защита паролем', secBox),
    card('Резервные копии и экспорт',
      el('div', { class: 'form-stack' }, revealable(bkPass), bkBtn),
      el('div', { class: 'row wrap' }, plainBtn, csvBtn, mdBtn),
      el('div', { class: 'row wrap' }, impLabel), impRow),
    card('Внешний вид и поведение',
      el('label', {}, 'Тема: ', theme),
      el('label', { class: 'check-label' }, parseDates, ' Понимать даты в тексте задачи («завтра», «10 числа»)'),
      el('label', { class: 'check-label' }, hideAmounts, ' Скрывать суммы на экране')),
    card('Напоминания', remindBox),
    card('Данные', stats, corrupt),
    card('Приватность', privacy),
    card('О приложении', diag),
    card('Опасная зона', el('p', { class: 'muted', textContent: 'Удаляет все записи, пароль и настройки на этом устройстве. Отменить нельзя.' }), wipeConfirm, wipeBtn));

  renderSecurity();
  renderReminders();
  renderAccountText();

  return {
    root,
    show() { renderSecurity(); renderAccountText(); this.update(store.state.events); },
    update(evs) {
      events = evs;
      if (document.activeElement !== nameInput) nameInput.value = profileOf(evs)?.payload.name || '';
      renderStats(); renderDiag();
    },
    reset() { pendingImport = null; impRow.hidden = true; impPass.value = ''; bkPass.value = ''; wipeConfirm.value = ''; wipeBtn.disabled = true; renderSecurity(); },
    renderSecurity,
    exportCsv,
  };
}
