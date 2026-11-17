// Быстрый вход по отпечатку в профиле: карточка «Быстрый вход» (включить и выключить) и кнопка «Войти по отпечатку» для форм входа в аккаунт.
// Включение: сначала проверяется текущий пароль (vault.verify), потом телефон просит приложить палец, и только после этого пароль сохраняется.
import { el, toast, setBusy, revealable } from './ui.js';
import * as vault from './vault.js';
import { describeError } from './account.js';
import { quickUnlockSupported, quickUnlockAvailable, quickUnlockEnabled, enableQuickUnlock, disableQuickUnlock, quickUnlockRun, QuickUnlockError } from './quick-unlock.js';

// username() — логин подключённого аккаунта (пусто, если аккаунта нет): он сохраняется вместе с паролем для входа на экране аккаунта.
export function createQuickCard({ username = () => '' } = {}) {
  const root = el('section', { id: 'qu-card', class: 'card settings-card' });
  let avail = null;                         // ответ телефона: можно ли включить (null — ещё не спрашивали)
  let asking = false, busy = false, error = '', form = null;

  function buildForm() {
    const pass = el('input', { id: 'qu-pass', type: 'password', autocomplete: 'current-password', placeholder: 'Текущий пароль', 'aria-label': 'Текущий пароль' });
    const go = el('button', { id: 'qu-go', type: 'submit', class: 'primary', textContent: 'Включить' });
    const msg = el('p', { id: 'qu-msg', class: 'error', role: 'alert' });
    const f = el('form', { id: 'qu-form', class: 'form-stack' },
      el('p', { class: 'muted', textContent: 'Введи пароль, которым открываешь приложение. Потом телефон попросит приложить палец.' }), revealable(pass), msg,
      el('div', { class: 'row' }, go, el('button', { id: 'qu-cancel', type: 'button', textContent: 'Отмена', onclick: () => { asking = false; form = null; paint(); } })));
    f.onsubmit = async e => {
      e.preventDefault();
      if (busy || !pass.value) return;
      busy = true; msg.textContent = ''; setBusy(go, true, 'Проверяю пароль…');
      try {
        await vault.verify(pass.value);                                          // неверный пароль -> WrongPasswordError (счётчик попыток входа не трогаем)
        go.textContent = 'Приложи палец…';
        await enableQuickUnlock({ username: username(), password: pass.value });
        asking = false; form = null;
        toast('Вход по отпечатку включён');
      } catch (err) {
        msg.textContent = err instanceof vault.WrongPasswordError ? 'Неверный пароль'
          : err instanceof QuickUnlockError ? (err.reason === 'cancelled' ? 'Отпечаток не подтверждён, вход не включён. Можно попробовать ещё раз.' : err.message) : describeError(err);
      } finally { busy = false; pass.value = ''; setBusy(go, false); paint(); }
    };
    return f;
  }

  function paint() {
    const kids = [el('h3', { textContent: 'Быстрый вход' })];
    const on = quickUnlockEnabled();
    if (!quickUnlockSupported()) {
      kids.push(el('p', { id: 'qu-state', class: 'muted', textContent: 'Работает только в приложении для Android. На сайте пароль вводится как обычно.' }));
    } else if (!vault.hasVault()) {
      kids.push(el('p', { id: 'qu-state', class: 'muted', textContent: 'Сначала включи защиту паролем: «Меню» → «Настройки» → «Защита паролем». Тогда здесь можно будет включить вход по отпечатку.' }));
    } else {
      const blocked = !on && avail && !avail.ok;
      const sw = el('input', { id: 'qu-switch', type: 'checkbox', checked: on || asking, disabled: busy || blocked || (!on && !avail) });
      sw.onchange = async () => {
        if (sw.checked) { asking = true; error = ''; form ??= buildForm(); paint(); form.querySelector('input')?.focus(); return; }
        if (asking && !on) { asking = false; form = null; paint(); return; }
        sw.disabled = true;
        await disableQuickUnlock();
        toast('Вход по отпечатку выключен');
        paint();
      };
      kids.push(
        el('p', { class: 'muted', textContent: 'Вместо пароля приложи палец (или лицо, если телефон надёжно его распознаёт). Пароль остаётся запасным способом: его можно ввести всегда.' }),
        el('label', { class: 'check-label' }, sw, ' Вход по отпечатку'),
        asking ? form
          : on ? el('p', { id: 'qu-state', class: 'ok', textContent: '✓ Включён. На экране блокировки можно приложить палец вместо пароля.' })
            : blocked ? el('p', { id: 'qu-state', class: 'warn', textContent: avail.text })
              : el('p', { id: 'qu-state', class: 'muted', textContent: 'Выключен.' }));
    }
    root.replaceChildren(...kids.filter(Boolean));
  }

  // Спросить у телефона, можно ли включить (при открытии профиля): результат рисуется, когда придёт.
  async function refresh() {
    paint();
    if (!quickUnlockSupported() || !vault.hasVault()) return;
    avail = await quickUnlockAvailable();
    paint();
  }
  return { root, refresh };
}

// Кнопка «Войти по отпечатку» для форм входа в аккаунт. null, если вход по отпечатку не включён (на сайте — всегда).
// signIn({ username, password }) делает обычный вход и бросает ошибку, если вход не удался; isStale(e) говорит, что виноват сохранённый пароль.
export function quickSignInButton(id, signIn, { isStale } = {}) {
  if (!quickUnlockEnabled()) return null;
  const btn = el('button', { id, type: 'button', class: 'bio-btn', textContent: 'Войти по отпечатку' });
  btn.onclick = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await quickUnlockRun(signIn, { isStale }); }
    catch (e) {
      if (e instanceof QuickUnlockError) { if (e.reason !== 'cancelled') toast(e.message); }
      else toast(describeError(e));
    } finally { btn.disabled = false; btn.hidden = !quickUnlockEnabled(); }
  };
  return btn;
}
