// Быстрый вход по отпечатку: логика (quick-unlock.js) с подставным плагином NativeBiometric. Настоящего телефона здесь нет:
// проверяем порядок вызовов (сначала отпечаток, потом чтение пароля), что именно уходит в хранилище, разбор ошибок и самовыключение.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

// Подставной плагин: журнал вызовов + «хранилище телефона».
const bio = {
  calls: [], store: new Map(),
  available: { isAvailable: true, strongBiometryIsAvailable: true, deviceIsSecure: true },
  verify: 'ok',                       // 'ok' или код ошибки плагина: '16' (отмена), '4' (слишком много попыток) …
  setFails: false, getFails: null,
  async isAvailable(o) { bio.calls.push(['isAvailable', o]); if (bio.availableError) throw bio.availableError; return bio.available; },
  async verifyIdentity(o) { bio.calls.push(['verifyIdentity', o]); if (bio.verify !== 'ok') throw Object.assign(new Error('отказ ' + bio.verify), { code: bio.verify }); },
  async setCredentials(o) { bio.calls.push(['setCredentials', o]); if (bio.setFails) throw new Error('Failed to save credentials'); bio.store.set(o.server, { username: o.username, password: o.password }); },
  async getCredentials(o) { bio.calls.push(['getCredentials', o]); if (bio.getFails) throw new Error(bio.getFails); const v = bio.store.get(o.server); if (!v) throw new Error('No credentials found'); return { ...v }; },
  async deleteCredentials(o) { bio.calls.push(['deleteCredentials', o]); if (bio.deleteFails) throw new Error('boom'); bio.store.clear(); },
};
const names = () => bio.calls.map(c => c[0]);
function reset() {
  Object.assign(bio, { calls: [], verify: 'ok', setFails: false, getFails: null, deleteFails: false, availableError: null,
    available: { isAvailable: true, strongBiometryIsAvailable: true, deviceIsSecure: true } });
  bio.store.clear();
  setPref('quickUnlock', false);                 // каждый тест начинается с выключенного входа
}

// «Android-приложение»: Capacitor подставляем ДО подключения модуля (platform.js читает его один раз при загрузке).
globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { NativeBiometric: bio }, registerPlugin: n => globalThis.Capacitor.Plugins[n] };
const q = await import('../quick-unlock.js');
const { getPref, setPref } = await import('../prefs.js');
const { QuickUnlockError } = q;
const PW = 'длинная-надёжная-фраза';

const reason = async p => { try { await p; } catch (e) { assert.ok(e instanceof QuickUnlockError, String(e)); return e.reason; } return 'нет ошибки'; };

test('доступность: отпечаток есть; нет сохранённых отпечатков; слабая биометрия; нет экрана блокировки; плагин молчит', async () => {
  reset();
  assert.deepEqual(await q.quickUnlockAvailable(), { ok: true });
  assert.deepEqual(bio.calls[0], ['isAvailable', { useFallback: false }], 'запасной вход по коду телефона не используем');
  bio.available = { isAvailable: false, errorCode: 3, deviceIsSecure: true };
  let r = await q.quickUnlockAvailable();
  assert.equal(r.ok, false); assert.equal(r.reason, 'not-enrolled'); assert.match(r.text, /нет сохранённых отпечатков/);
  bio.available = { isAvailable: true, strongBiometryIsAvailable: false, deviceIsSecure: true };
  r = await q.quickUnlockAvailable(); assert.equal(r.reason, 'weak'); assert.match(r.text, /нужен отпечаток пальца/, 'окно проверки принимает только надёжную биометрию');
  bio.available = { isAvailable: false, errorCode: 1, deviceIsSecure: false };
  assert.equal((await q.quickUnlockAvailable()).reason, 'no-lock');
  bio.available = { isAvailable: false, errorCode: 1, deviceIsSecure: true };
  assert.equal((await q.quickUnlockAvailable()).reason, 'unavailable');
  bio.availableError = Object.assign(new Error('plugin is not implemented'), { code: 'UNIMPLEMENTED' });
  assert.equal((await q.quickUnlockAvailable()).reason, 'unavailable', 'в сборке нет плагина: понятный отказ, а не сбой');
});

test('включение: сначала окно отпечатка, потом запись; в хранилище уходит случайное поле вместо логина и одно значение с паролем', async () => {
  reset();
  assert.equal(q.quickUnlockEnabled(), false);
  await q.enableQuickUnlock({ username: 'владелец', password: PW });
  assert.deepEqual(names(), ['isAvailable', 'verifyIdentity', 'setCredentials'], 'порядок: проверка телефона, отпечаток, запись');
  const [, ask] = bio.calls[1], [, put] = bio.calls[2];
  assert.equal(ask.useFallback, false); assert.equal(ask.maxAttempts, 3); assert.match(ask.title, /Включить вход по отпечатку/); assert.equal(ask.negativeButtonText, 'Отмена');
  assert.equal(put.server, 'app.lifeos.mobile', 'имя записи совпадает с appId и не меняется');
  assert.match(put.username, /^[!-~]{24}$/, 'в поле «логин» плагина — случайная строка, а не настоящий логин');
  assert.ok(!put.username.includes('владелец') && !put.password.startsWith(PW), 'значения не совпадают с открытым паролем и логином');
  assert.deepEqual(JSON.parse(put.password), { v: 1, u: 'владелец', p: PW }, 'логин и пароль лежат одним значением');
  assert.equal(q.quickUnlockEnabled(), true); assert.equal(getPref('quickUnlock'), true);
  // случайная строка каждый раз новая (общий начальный вектор плагина не должен давать одинаковых пар)
  await q.enableQuickUnlock({ username: 'владелец', password: PW });
  const pads = bio.calls.filter(c => c[0] === 'setCredentials').map(c => c[1].username);
  assert.equal(pads.length, 2); assert.notEqual(pads[0], pads[1]);
});

test('включение не удалось: отпечаток не подтверждён, нет пароля, хранилище отказало — ничего не включено и не записано', async () => {
  reset();
  bio.verify = '16';
  assert.equal(await reason(q.enableQuickUnlock({ username: 'a', password: PW })), 'cancelled');
  assert.ok(!names().includes('setCredentials'), 'без подтверждения отпечатком пароль не сохраняется');
  assert.equal(q.quickUnlockEnabled(), false);
  bio.verify = 'ok';
  assert.equal(await reason(q.enableQuickUnlock({ username: 'a', password: '' })), 'error');
  bio.setFails = true;
  assert.equal(await reason(q.enableQuickUnlock({ username: 'a', password: PW })), 'error');
  assert.equal(q.quickUnlockEnabled(), false, 'сбой записи не оставляет включённый вход без пароля');
  bio.available = { isAvailable: false, errorCode: 3 }; bio.setFails = false;
  assert.equal(await reason(q.enableQuickUnlock({ username: 'a', password: PW })), 'not-enrolled', 'нет отпечатков: окно даже не открывается');
  assert.equal(bio.calls.filter(c => c[0] === 'verifyIdentity').length, 2);
});

test('чтение: окно отпечатка раньше пароля, вернулись логин и пароль', async () => {
  reset();
  await q.enableQuickUnlock({ username: 'владелец', password: PW });
  bio.calls.length = 0;
  assert.deepEqual(await q.quickUnlockCredentials(), { username: 'владелец', password: PW });
  assert.deepEqual(names(), ['verifyIdentity', 'getCredentials']);
  assert.match(bio.calls[0][1].title, /Вход в «/); assert.equal(bio.calls[0][1].negativeButtonText, 'Ввести пароль', 'пароль всегда запасной путь');
  assert.deepEqual(bio.calls[1][1], { server: 'app.lifeos.mobile' });
});

test('отпечаток отменён или не прошёл: пароль не читается, вход остаётся включённым, понятный текст', async () => {
  reset();
  await q.enableQuickUnlock({ username: 'a', password: PW });
  const cases = { '16': 'cancelled', '15': 'cancelled', '17': 'cancelled', '4': 'too-many', '2': 'locked-out', '3': 'not-enrolled', '14': 'no-lock', '1': 'unavailable', '10': 'failed', UNIMPLEMENTED: 'unavailable', '0': 'error' };
  for (const [code, why] of Object.entries(cases)) {
    bio.calls.length = 0; bio.verify = code;
    const err = await q.quickUnlockCredentials().catch(e => e);
    assert.ok(err instanceof QuickUnlockError, code); assert.equal(err.reason, why, `код ${code}`);
    assert.ok(err.message.length > 10 && !/undefined|null/.test(err.message), err.message);
    assert.deepEqual(names(), ['verifyIdentity'], `код ${code}: пароль не прочитан`);
    assert.equal(q.quickUnlockEnabled(), true, `код ${code}: ошибка отпечатка не выключает вход`);
  }
  bio.verify = '4';
  assert.match((await q.quickUnlockCredentials().catch(e => e)).message, /Слишком много попыток/);
});

test('сохранённое не читается (ключ пропал, записи нет, мусор): вход выключается сам и просит пароль', async () => {
  reset();
  for (const [setup, why] of [
    [() => { bio.getFails = 'Failed to get credentials'; }, 'broken'],
    [() => { bio.store.clear(); }, 'missing'],
    [() => { bio.store.set('app.lifeos.mobile', { username: 'x', password: 'не-json' }); }, 'broken'],
    [() => { bio.store.set('app.lifeos.mobile', { username: 'x', password: JSON.stringify({ v: 2, u: '', p: PW }) }); }, 'broken'],
  ]) {
    reset();
    await q.enableQuickUnlock({ username: 'a', password: PW });
    setup();
    assert.equal(await reason(q.quickUnlockCredentials()), why);
    assert.equal(q.quickUnlockEnabled(), false, 'после ошибки вход выключен');
    assert.ok(names().includes('deleteCredentials'), 'остатки стёрты из хранилища телефона');
  }
  reset();
  assert.equal(await reason(q.quickUnlockCredentials()), 'missing', 'не включён: читать нечего');
  assert.ok(!names().includes('verifyIdentity'), 'окно отпечатка зря не открывается');
});

test('выключение: запись стёрта, отметка снята, повтор безопасен, сбой плагина не мешает', async () => {
  reset();
  await q.enableQuickUnlock({ username: 'a', password: PW });
  assert.deepEqual(await q.disableQuickUnlock(), { ok: true });
  assert.equal(q.quickUnlockEnabled(), false); assert.equal(bio.store.size, 0);
  assert.deepEqual(bio.calls.at(-1), ['deleteCredentials', { server: 'app.lifeos.mobile' }]);
  await q.disableQuickUnlock();                                      // второй раз ничего не ломает
  await q.enableQuickUnlock({ username: 'a', password: PW });
  bio.deleteFails = true;
  assert.deepEqual(await q.disableQuickUnlock(), { ok: true }, 'плагин упал: исключения нет');
  assert.equal(getPref('quickUnlock'), false, 'отметка всё равно снята');
});

test('quickUnlockRun: неверный сохранённый пароль выключает вход, остальные ошибки идут дальше как есть', async () => {
  reset();
  await q.enableQuickUnlock({ username: 'владелец', password: PW });
  assert.equal(await q.quickUnlockRun(async c => `вошёл ${c.username}`), 'вошёл владелец');
  assert.equal(q.quickUnlockEnabled(), true);
  const wrong = Object.assign(new Error('Неверный пароль'), { name: 'WrongPasswordError' });
  const isStale = e => e?.name === 'WrongPasswordError';
  assert.equal(await reason(q.quickUnlockRun(async () => { throw wrong; }, { isStale })), 'stale');
  assert.equal(q.quickUnlockEnabled(), false); assert.equal(bio.store.size, 0, 'старый пароль стёрт из хранилища');
  await q.enableQuickUnlock({ username: 'a', password: PW });
  const net = new Error('Нет связи');
  await assert.rejects(q.quickUnlockRun(async () => { throw net; }, { isStale }), e => e === net, 'сеть и прочее — не повод выключать вход');
  assert.equal(q.quickUnlockEnabled(), true);
  bio.verify = '16';
  let ran = false;
  assert.equal(await reason(q.quickUnlockRun(async () => { ran = true; }, { isStale })), 'cancelled');
  assert.equal(ran, false, 'действие не выполняется без отпечатка');
});

test('смена пароля, восстановление и выход сообщают «пароль изменился»: сервис аккаунта вызывает deps.credentialsChanged', async () => {
  const vault = await import('../vault.js');
  const { createAccountService } = await import('../account.js');
  const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const storage = mem();
  vault.useStorage(storage);
  await vault.create(PW, { iterations: 2000 });
  let n = 0;
  const svc = createAccountService({ api: {}, storage, authIter: 2000, deps: { credentialsChanged: () => { n++; } } });
  await assert.rejects(svc.changePassword({ oldPassword: 'не-тот-пароль-1', newPassword: 'новый-пароль-22' }), vault.WrongPasswordError);
  assert.equal(n, 0, 'неудачная смена ничего не выключает');
  await svc.changePassword({ oldPassword: PW, newPassword: 'новый-пароль-22' });
  assert.equal(n, 1, 'после смены пароля');
  await svc.logout();
  assert.equal(n, 2, 'после выхода');
  const failing = createAccountService({ api: {}, storage, authIter: 2000, deps: { credentialsChanged: () => { throw new Error('плагин упал'); } } });
  await failing.changePassword({ oldPassword: 'новый-пароль-22', newPassword: 'третий-пароль-333' });       // сбой быстрого входа не ломает смену пароля
  vault.useStorage(globalThis.localStorage);
});

test('сайт без плагина: «работает только в приложении», включить нельзя, кнопки не будет', () => {
  const code = `
    const q = await import('./quick-unlock.js');
    const { setPref } = await import('./prefs.js');
    setPref('quickUnlock', true);                       // даже если отметка осталась, без плагина вход не предлагается
    const out = { enabled: q.quickUnlockEnabled(), avail: await q.quickUnlockAvailable() };
    try { await q.enableQuickUnlock({ username: 'a', password: 'длинная-надёжная-фраза' }); out.enable = 'нет ошибки'; } catch (e) { out.enable = e.reason; }
    try { await q.quickUnlockCredentials(); out.read = 'нет ошибки'; } catch (e) { out.read = e.reason; }
    out.disable = await q.disableQuickUnlock();
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.enabled, false);
  assert.equal(out.avail.ok, false); assert.equal(out.avail.reason, 'web'); assert.match(out.avail.text, /Работает только в приложении для Android/);
  assert.equal(out.enable, 'web'); assert.equal(out.read, 'web'); assert.deepEqual(out.disable, { ok: true });
});
