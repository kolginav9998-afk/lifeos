// Быстрый вход на экране блокировки: кнопка «Войти по отпечатку» и окно отпечатка. Форма с паролем остаётся рядом и работает всегда.
// Отмена окна и «слишком много попыток» отпечатка не считаются неверными попытками пароля: в vault.unlock уходит только сохранённый пароль,
// и только после успешного отпечатка. Если сохранённый пароль больше не подходит (его сменили на другом устройстве), вход по отпечатку выключается.
import { $ } from './ui.js';
import * as vault from './vault.js';
import { quickUnlockEnabled, quickUnlockRun, QuickUnlockError } from './quick-unlock.js';

export function createLockQuick({ onUnlocked, onLockout }) {
  let busy = false;
  let quietUntil = 0;                       // до этого времени окно отпечатка само не открывается (после неудачи или отмены), иначе возврат из окна зациклил бы его
  const say = text => { $('lock-msg').textContent = text; };

  // Показать или спрятать кнопку. Возвращает true, если вход по отпечатку включён.
  function refresh() {
    const on = quickUnlockEnabled();
    $('lock-bio').hidden = !on;
    return on;
  }

  async function run({ auto = false } = {}) {
    if (busy || $('lock').hidden || !quickUnlockEnabled()) return;
    if (auto && Date.now() < quietUntil) return;
    if (vault.failState().waitMs > 0) { onLockout(); return; }          // пауза после неверных паролей действует и здесь: окно отпечатка зря не открываем
    busy = true; $('lock-bio').disabled = true; say('');
    try {
      await quickUnlockRun(async ({ password }) => { say('Проверяю…'); await vault.unlock(password); }, { isStale: e => e instanceof vault.WrongPasswordError });
      say('');
      await onUnlocked();
    } catch (e) {
      quietUntil = Date.now() + 2500;           // окно закрыто без входа: возвращение в приложение из окна отпечатка не должно сразу открыть его снова
      if (e instanceof vault.TooManyAttemptsError) { say(''); onLockout(); }
      else if (e instanceof QuickUnlockError) { say(e.reason === 'cancelled' ? '' : e.message); if (e.reason === 'stale') onLockout(); refresh(); }   // «пароль изменился», «не читается»: вход уже выключен, кнопку убираем
      else say('Ошибка: ' + (e?.message || e));
    } finally {
      busy = false; $('lock-bio').disabled = false;
    }
  }

  $('lock-bio').onclick = () => run();
  return { refresh, prompt: () => run({ auto: true }) };
}
