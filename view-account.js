import { el, toast, setBusy, revealable } from './ui.js';
import * as vault from './vault.js';
import * as db from './db.js';
import * as store from './store.js';
import * as sync from './app-sync.js';
import { account } from './app-sync.js';
import { describeError } from './account.js';
import { DEFAULT_SERVER } from './config.js';
import { encryptBackup } from './backup.js';
import { saveTextFile } from './platform.js';
import { getPref, setPref } from './prefs.js';

const LAST_SERVER = 'lifeos.account.lastServer';
const STATE_TEXT = {
  off: 'Не подключено', idle: 'Всё синхронизировано', syncing: 'Синхронизация…', offline: 'Нет связи: изменения сохранены и отправятся позже',
  error: 'Ошибка синхронизации', 'needs-login': 'Нужно войти заново', locked: 'Приложение заблокировано',
};
const field = (id, props) => el('input', { id, autocomplete: 'off', ...props });
const when = ts => (ts ? new Date(ts).toLocaleString('ru') : 'ещё не было');

export function createAccountView({ go, onVaultChange = () => {} }) {
  const root = el('section', { id: 'view-account', class: 'view' });
  let checked = null;             // результат проверки сервера
  let recoveryCode = null;        // показанный код (пока не подтверждён)
  let afterCode = null;           // что сделать, когда код подтверждён
  let pendingJoin = null;         // вход на устройстве с чужими данными: ждём подтверждения
  let showRecover = false;

  const lastServer = () => { try { return localStorage.getItem(LAST_SERVER) || DEFAULT_SERVER || ''; } catch { return DEFAULT_SERVER || ''; } };
  const card = (title, ...kids) => el('section', { class: 'card settings-card' }, el('h3', { textContent: title }), ...kids);
  const guard = async (btn, label, fn) => {
    setBusy(btn, true, label);
    try { return await fn(); }
    catch (e) { toast(describeError(e)); return undefined; }
    finally { setBusy(btn, false); }
  };

  // ---------- код восстановления ----------
  function recoveryCard(code, onDone) {
    const ok = el('input', { id: 'acc-code-ok', type: 'checkbox' });
    const done = el('button', { id: 'acc-code-done', type: 'button', class: 'primary', textContent: 'Готово', disabled: true });
    ok.onchange = () => { done.disabled = !ok.checked; };
    done.onclick = async () => { const next = onDone; recoveryCode = null; afterCode = null; render(); await next?.(); };
    return card('Сохрани код восстановления',
      el('p', { class: 'warn', textContent: 'Это единственный способ вернуть доступ, если забудешь пароль. Покажу один раз. Запиши на бумагу или сохрани в менеджере паролей.' }),
      el('div', { id: 'acc-code', class: 'code', textContent: code }),
      el('div', { class: 'row wrap' },
        el('button', { type: 'button', textContent: 'Скопировать', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Скопировано'); } catch { toast('Не удалось скопировать: выдели код вручную'); } } }),
        el('button', { type: 'button', textContent: 'Сохранить в файл', onclick: () => saveTextFile('lifeos-recovery-code.txt', `Life OS — код восстановления\n${code}\n\nХрани отдельно от пароля.\n`, 'text/plain').catch(e => toast(e.message)) })),
      el('label', { class: 'check-label' }, ok, ' Я сохранил код в надёжном месте'), done);
  }

  // ---------- старт синхронизации после входа / регистрации ----------
  async function startSync(markAll) {
    try { localStorage.setItem(LAST_SERVER, account.info().server); } catch { /* не критично */ }
    await sync.start({ markAll });
    onVaultChange();
  }

  // ---------- вход на устройстве с данными: сначала копия, затем присоединение ----------
  async function joinWithLocalData(auth, password, btn) {
    const snapshot = store.state.events.filter(e => e.type);                // расшифрованные записи этого устройства
    setBusy(btn, true, 'Сохраняю копию…');
    try {
      const file = await encryptBackup(snapshot, password);                  // копия под паролем аккаунта
      await saveTextFile(`lifeos-before-join-${new Date().toISOString().slice(0, 10)}.enc.json`, file);
      const prefs = localStorage.getItem('lifeos.prefs.v1');
      await db.wipeAll();
      if (prefs) localStorage.setItem('lifeos.prefs.v1', prefs);
      await account.link(auth, password);
      await store.refresh();
      await sync.start();                                                    // подписка на записи включена до возврата данных
      await store.saveMany(snapshot);
      await sync.syncNow();
      toast(`Устройство присоединено. Добавлено своих записей: ${snapshot.length}`);
    } finally { setBusy(btn, false); pendingJoin = null; render(); }
  }

  async function afterLogin(auth, password, btn) {
    const raw = await db.raw.all();
    const sealed = raw.find(r => vault.isSealed(r));
    const anyLocal = raw.length > 0;
    if (!anyLocal) { await account.link(auth, password); await store.refresh(); await startSync(false); toast('Вход выполнен'); return; }
    let compat = 'different';
    if (vault.status() === 'unlocked' && sealed && !raw.some(r => !vault.isSealed(r))) compat = await account.compatibility(auth, password, sealed);
    if (compat === 'same') { await account.link(auth, password); await store.refresh(); await startSync(true); toast('Вход выполнен'); return; }
    pendingJoin = { auth, password, count: raw.length };
    render();
  }

  // ---------- неподключённое состояние ----------
  function unlinkedCards() {
    const cards = [];
    const server = field('acc-server', { type: 'text', placeholder: 'Адрес сервера, например https://…workers.dev', value: lastServer(), inputMode: 'url', autocapitalize: 'off', spellcheck: false });
    const check = el('button', { id: 'acc-check', type: 'button', class: 'primary', textContent: 'Проверить сервер' });
    const msg = el('p', { id: 'acc-msg', class: 'muted', textContent: checked ? (checked.registered ? 'Сервер найден. Аккаунт уже создан — войди.' : 'Сервер найден. Аккаунта ещё нет — создай его.') : '' });
    check.onclick = () => guard(check, 'Проверяю…', async () => {
      checked = await account.checkServer(server.value);
      server.value = checked.server;
      render();
    });
    cards.push(card('Аккаунт: вход с любого устройства',
      el('p', { class: 'muted', textContent: 'Один логин и пароль для телефона, приложения и браузера. Данные хранятся на сервере в зашифрованном виде: сервер не может их прочитать, а пароль на него не отправляется.' }),
      el('div', { class: 'form-stack' }, server, check, msg)));
    if (!checked) {
      cards.push(card('Как подключить', el('ol', { class: 'plain muted' },
        el('li', { textContent: 'Развернуть свой сервер один раз (бесплатно): docs/SERVER.md.' }),
        el('li', { textContent: 'Вставить его адрес выше и нажать «Проверить сервер».' }),
        el('li', { textContent: 'Создать аккаунт и записать код восстановления.' }),
        el('li', { textContent: 'На других устройствах: тот же адрес, «Войти».' }))));
      return cards;
    }
    if (pendingJoin) { cards.push(joinCard()); return cards; }
    cards.push(checked.registered ? loginCard() : registerCard());
    if (checked.registered) cards.push(recoverCard());
    return cards;
  }

  function registerCard() {
    const user = field('acc-user', { type: 'text', placeholder: 'Логин (3–64 символа)', autocapitalize: 'off', required: true });
    const p1 = field('acc-pass', { type: 'password', placeholder: 'Пароль (он же пароль защиты на устройстве)', autocomplete: 'new-password' });
    const p2 = field('acc-pass2', { type: 'password', placeholder: 'Повтори пароль', autocomplete: 'new-password' });
    const setup = field('acc-setup', { type: 'text', placeholder: 'Код установки сервера', hidden: !checked.setupCodeRequired });
    const meter = el('div', { id: 'acc-strength', class: 'strength', 'aria-live': 'polite' });
    p1.addEventListener('input', () => { const st = vault.passwordStrength(p1.value); meter.className = 'strength s' + st.score; meter.textContent = p1.value ? `Надёжность: ${st.label}` : ''; });
    const btn = el('button', { id: 'acc-register', type: 'submit', class: 'primary', textContent: 'Создать аккаунт' });
    const form = el('form', { id: 'acc-reg-form', class: 'form-stack' },
      el('p', { class: 'muted', textContent: vault.status() === 'none' ? 'На этом устройстве будет включена защита паролем: данные зашифруются.' : 'Введи текущий пароль защиты на этом устройстве: аккаунт будет с тем же паролем.' }),
      user, revealable(p1), meter, vault.status() === 'none' ? revealable(p2) : null, checked.setupCodeRequired ? setup : null, btn);
    form.onsubmit = async e => {
      e.preventDefault();
      if (vault.status() === 'none' && p1.value !== p2.value) return toast('Пароли не совпадают');
      await guard(btn, 'Создаю…', async () => {
        const r = await account.register({ server: checked.server, username: user.value, password: p1.value, setupCode: setup.value || undefined });
        recoveryCode = r.recoveryCode;
        afterCode = async () => { await startSync(true); toast('Аккаунт создан. Данные отправляются на сервер.'); };
        await store.refresh();
        if (!recoveryCode) { afterCode = null; await startSync(true); toast('Аккаунт создан'); }
        render();
      });
    };
    return card('Создать аккаунт', form);
  }

  function loginCard() {
    const user = field('acc-user', { type: 'text', placeholder: 'Логин', autocapitalize: 'off', required: true });
    const pass = field('acc-pass', { type: 'password', placeholder: 'Пароль', autocomplete: 'current-password' });
    const btn = el('button', { id: 'acc-login', type: 'submit', class: 'primary', textContent: 'Войти' });
    const form = el('form', { id: 'acc-login-form', class: 'form-stack' }, user, revealable(pass), btn,
      el('button', { type: 'button', class: 'link', id: 'acc-forgot', textContent: 'Забыл пароль', onclick: () => { showRecover = !showRecover; render(); } }));
    form.onsubmit = async e => {
      e.preventDefault();
      await guard(btn, 'Вхожу…', async () => {
        const auth = await account.authenticate({ server: checked.server, username: user.value, password: pass.value });
        await afterLogin(auth, pass.value, btn);
        render();
      });
    };
    return card('Войти в аккаунт', form);
  }

  function recoverCard() {
    if (!showRecover) return el('span');
    const user = field('acc-rec-user', { type: 'text', placeholder: 'Логин', autocapitalize: 'off', required: true });
    const code = field('acc-rec-code', { type: 'text', placeholder: 'Код восстановления (XXXX-XXXX-…)', autocapitalize: 'characters', spellcheck: false, required: true });
    const pass = field('acc-rec-pass', { type: 'password', placeholder: 'Новый пароль', autocomplete: 'new-password' });
    const btn = el('button', { id: 'acc-rec-go', type: 'submit', class: 'primary', textContent: 'Задать новый пароль и войти' });
    const form = el('form', { id: 'acc-rec-form', class: 'form-stack' }, user, code, revealable(pass), btn);
    form.onsubmit = async e => {
      e.preventDefault();
      await guard(btn, 'Восстанавливаю…', async () => {
        const raw = await db.raw.all();
        if (raw.length && !vault.isUnlocked()) throw new Error('На устройстве есть зашифрованные данные: разблокируй их или сотри данные перед восстановлением');
        await account.recover({ server: checked.server, username: user.value, code: code.value, newPassword: pass.value });
        await store.refresh(); await startSync(true); showRecover = false; toast('Пароль изменён, вход выполнен');
        render();
      });
    };
    return card('Восстановление по коду', form);
  }

  function joinCard() {
    const btn = el('button', { id: 'acc-join-go', type: 'button', class: 'primary', textContent: 'Сохранить копию и присоединить устройство' });
    btn.onclick = () => guard(btn, 'Работаю…', () => joinWithLocalData(pendingJoin.auth, pendingJoin.password, btn));
    return card('На этом устройстве уже есть данные',
      el('p', { textContent: `Записей на устройстве: ${pendingJoin.count}. Они зашифрованы другим ключом или не защищены. Сначала я сохраню зашифрованную копию (файл), затем присоединю устройство к аккаунту и добавлю эти записи к общим.` }),
      el('p', { class: 'warn', textContent: 'Файл с копией сохрани: это страховка.' }), btn,
      el('button', { type: 'button', textContent: 'Отмена', onclick: () => { pendingJoin = null; render(); } }));
  }

  // ---------- подключённое состояние ----------
  function linkedCards() {
    const a = account.info();
    const cards = [];
    const st = sync.status;
    const line = el('p', { id: 'acc-status', class: st.state === 'idle' ? 'ok' : 'muted' });
    const detail = el('p', { id: 'acc-detail', class: 'muted' });
    const showsRelogin = st.state === 'needs-login';
    const paint = s => {
      // форма «Войти заново» появляется/исчезает только при окончательной смене состояния (промежуточная «синхронизация» ввод не стирает)
      if (s.state !== 'syncing' && (s.state === 'needs-login') !== showsRelogin) { queueMicrotask(render); return; }
      line.textContent = (STATE_TEXT[s.state] || s.state) + (s.state === 'error' && s.error ? ` (${s.error})` : '');
      line.className = s.state === 'idle' ? 'ok' : s.state === 'error' || s.state === 'needs-login' ? 'warn' : 'muted';
      detail.textContent = `Последняя синхронизация: ${when(s.lastSyncAt)} · ждут отправки: ${s.pending ?? 0}` + (s.bad ? ` · не удалось прочитать: ${s.bad}` : '');
    };
    unsub?.(); unsub = sync.onStatus(paint);
    const now = el('button', { id: 'acc-sync-now', type: 'button', class: 'primary', textContent: 'Синхронизировать сейчас', onclick: async e => { await guard(e.currentTarget, 'Синхронизирую…', async () => { const r = await sync.syncNow(); if (!r.ok && sync.status.state !== 'error' && sync.status.state !== 'offline') toast('Синхронизация не запущена'); }); } });

    cards.push(card('Аккаунт', el('p', {}, el('strong', { id: 'acc-name', textContent: a.username }), el('span', { class: 'muted', textContent: ` · ${a.server}` })), line, detail, el('div', { class: 'row wrap' }, now)));

    if (st.state === 'needs-login') {
      const pass = field('acc-relogin-pass', { type: 'password', placeholder: 'Пароль', autocomplete: 'current-password' });
      const btn = el('button', { id: 'acc-relogin', type: 'submit', class: 'primary', textContent: 'Войти заново' });
      const f = el('form', { class: 'form-stack' }, revealable(pass), btn);
      f.onsubmit = async e => {
        e.preventDefault();
        await guard(btn, 'Вхожу…', async () => {
          const auth = await account.authenticate({ server: a.server, username: a.username, password: pass.value });
          await account.link(auth, pass.value); await startSync(false); toast('Вход выполнен'); render();
        });
      };
      cards.push(card('Сессия закончилась', f));
    }

    // смена пароля
    const o = field('acc-old', { type: 'password', placeholder: 'Текущий пароль', autocomplete: 'current-password' });
    const n1 = field('acc-new1', { type: 'password', placeholder: 'Новый пароль', autocomplete: 'new-password' });
    const n2 = field('acc-new2', { type: 'password', placeholder: 'Повтори новый пароль', autocomplete: 'new-password' });
    const chBtn = el('button', { id: 'acc-change', type: 'submit', textContent: 'Сменить пароль' });
    const chForm = el('form', { class: 'form-stack' }, el('p', { class: 'muted', textContent: 'Пароль изменится на сервере и на этом устройстве. Остальные устройства войдут заново с новым паролем.' }), revealable(o), revealable(n1), revealable(n2), chBtn);
    chForm.onsubmit = async e => {
      e.preventDefault();
      if (n1.value !== n2.value) return toast('Новые пароли не совпадают');
      await guard(chBtn, 'Меняю…', async () => { await account.changePassword({ oldPassword: o.value, newPassword: n1.value }); o.value = n1.value = n2.value = ''; toast('Пароль изменён'); });
    };

    // новый код восстановления
    const rp = field('acc-rec-new-pass', { type: 'password', placeholder: 'Пароль для подтверждения', autocomplete: 'current-password' });
    const rb = el('button', { id: 'acc-newcode', type: 'submit', textContent: 'Создать новый код' });
    const rf = el('form', { class: 'form-stack' }, el('p', { class: 'muted', textContent: 'Прежний код перестанет работать.' }), revealable(rp), rb);
    rf.onsubmit = async e => {
      e.preventDefault();
      await guard(rb, 'Создаю…', async () => { recoveryCode = await account.createRecoveryCode(rp.value); afterCode = null; rp.value = ''; render(); });
    };

    // удаление аккаунта на сервере
    const dp = field('acc-del-pass', { type: 'password', placeholder: 'Пароль', autocomplete: 'current-password' });
    const dc = field('acc-del-confirm', { type: 'text', placeholder: 'Напиши УДАЛИТЬ' });
    const db_ = el('button', { id: 'acc-delete', type: 'submit', class: 'danger', textContent: 'Удалить аккаунт на сервере', disabled: true });
    dc.oninput = () => { db_.disabled = dc.value.trim().toUpperCase() !== 'УДАЛИТЬ'; };
    const df = el('form', { class: 'form-stack' }, el('p', { class: 'muted', textContent: 'С сервера исчезнут все данные. На устройствах данные останутся. Потом можно создать аккаунт заново.' }), revealable(dp), dc, db_);
    df.onsubmit = async e => {
      e.preventDefault();
      await guard(db_, 'Удаляю…', async () => { await account.deleteServerAccount(dp.value); sync.stop(); checked = null; toast('Аккаунт на сервере удалён'); render(); });
    };

    cards.push(card('Безопасность аккаунта',
      el('details', {}, el('summary', { textContent: 'Сменить пароль' }), chForm),
      el('details', {}, el('summary', { textContent: 'Код восстановления' }), rf),
      el('details', {}, el('summary', { textContent: 'Удалить аккаунт на сервере' }), df)));

    const out = el('button', { id: 'acc-logout', type: 'button', textContent: 'Выйти (данные останутся на устройстве)' });
    out.onclick = () => guard(out, 'Выхожу…', async () => { sync.stop(); await account.logout(); checked = null; onVaultChange(); toast('Вы вышли из аккаунта'); render(); });
    cards.push(card('Выход', el('p', { class: 'muted', textContent: 'Выход не стирает данные на этом устройстве и не удаляет аккаунт.' }), out));
    return cards;
  }

  let unsub = null;
  function render() {
    unsub?.(); unsub = null;
    if (recoveryCode) { root.replaceChildren(recoveryCard(recoveryCode, afterCode)); return; }
    root.replaceChildren(...(account.isLinked() ? linkedCards() : unlinkedCards()));
  }
  render();

  // Данные обновляются часто (в том числе синхронизацией) — экран перерисовываем только при открытии, чтобы не стирать вводимое.
  return { root, update() {}, show: render, render };
}
