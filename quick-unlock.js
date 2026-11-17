// Быстрый вход по отпечатку пальца (или по лицу, если телефон распознаёт его надёжно). Только в приложении для Android:
// на сайте плагина нет, и всё честно отвечает «работает только в приложении».
//
// Что где лежит. Пароль (и логин аккаунта) хранит плагин NativeBiometric в защищённом хранилище Android: ключ шифрования живёт в Keystore
// (в защищённой части телефона, где она есть), зашифрованные значения лежат в закрытой памяти приложения. В настройках устройства (prefs.js)
// остаётся только отметка «быстрый вход включён»: она не попадает ни в архив, ни на сервер синхронизации.
// Отпечаток здесь — отдельная проверка ПЕРЕД чтением пароля (так устроен плагин), а не замок на самом ключе. Что это даёт и чего не даёт:
// docs/ADR.md (ADR-19) и docs/SECURITY.md. Пароль при этом остаётся запасным путём: ошибки отпечатка никогда не считаются неверными попытками пароля.
import { nativePlugin } from './platform.js';
import { getPref, setPref } from './prefs.js';
import { APP_NAME } from './config.js';

const SERVER = 'app.lifeos.mobile';                       // имя записи в плагине (не адрес сайта); совпадает с appId, менять нельзя: прежние записи перестанут находиться
const FLAG = 'quickUnlock';

const TEXT = {
  web: 'Работает только в приложении для Android. На сайте пароль вводится как обычно.',
  unavailable: 'На этом телефоне вход по отпечатку недоступен.',
  'not-enrolled': 'В телефоне нет сохранённых отпечатков. Добавь отпечаток в настройках телефона («Безопасность» → «Отпечаток пальца») и вернись сюда.',
  weak: 'Телефон распознаёт только упрощённо (например, лицо без надёжной защиты). Для входа нужен отпечаток пальца.',
  'no-lock': 'На телефоне не задан экран блокировки (код, рисунок или пароль). Задай его в настройках телефона, потом добавь отпечаток.',
  cancelled: 'Вход по отпечатку отменён.',
  failed: 'Отпечаток не распознан. Попробуй ещё раз или введи пароль.',
  'too-many': 'Слишком много попыток. Подожди полминуты или введи пароль.',
  'locked-out': 'Телефон заблокировал отпечаток после неудачных попыток. Разблокируй телефон кодом или введи пароль.',
  missing: 'Вход по отпечатку не настроен на этом телефоне. Он выключен: введи пароль, потом включи его заново в Аккаунте.',
  broken: 'Сохранённый вход не читается (так бывает после смены защиты телефона). Он выключен: введи пароль, потом включи вход по отпечатку заново.',
  stale: 'Пароль изменился. Вход по отпечатку выключен: введи новый пароль, потом включи его заново в Аккаунте.',
  error: 'Не получилось открыть окно отпечатка. Введи пароль.',
};

export class QuickUnlockError extends Error {
  constructor(reason, message) { super(message || TEXT[reason] || TEXT.error); this.name = 'QuickUnlockError'; this.reason = reason; }
}

const PROMPT = {
  unlock: { title: `Вход в «${APP_NAME}»`, subtitle: 'Приложи палец к сканеру', description: 'Отпечаток откроет приложение вместо пароля', negativeButtonText: 'Ввести пароль' },
  enable: { title: 'Включить вход по отпечатку', subtitle: 'Приложи палец к сканеру', description: 'Подтверди, что это ты, и вход по отпечатку включится', negativeButtonText: 'Отмена' },
};

// Окно отпечатка и обращения к плагину не должны подвешивать экран, если система не ответила.
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms);
  promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});

const plugin = () => nativePlugin('NativeBiometric');
const unavailable = reason => ({ ok: false, reason, text: TEXT[reason] });

// Код ошибки плагина (строка) -> причина, понятная интерфейсу.
function reasonOf(e) {
  switch (String(e?.code ?? '')) {
    case '16': case '15': case '17': case '11': return 'cancelled';      // нажал «Ввести пароль»/«Отмена», система закрыла окно, ушёл из приложения
    case '4': return 'too-many';                                         // у плагина это и «слишком много неудач», и временная блокировка телефона
    case '2': return 'locked-out';
    case '3': return 'not-enrolled';
    case '14': return 'no-lock';
    case '1': case 'UNIMPLEMENTED': return 'unavailable';
    case '10': return 'failed';
    default: return 'error';
  }
}

// Можно ли включить вход по отпечатку на этом телефоне: { ok } или { ok: false, reason, text }.
// Берём только «сильную» биометрию: окно проверки в плагине принимает именно её (отпечаток; лицо только на телефонах с надёжным распознаванием).
export async function quickUnlockAvailable() {
  const p = plugin();
  if (!p) return unavailable('web');
  let r;
  try { r = await withTimeout(p.isAvailable({ useFallback: false }), 5000); } catch { return unavailable('unavailable'); }
  if (r?.isAvailable) return r.strongBiometryIsAvailable === false ? unavailable('weak') : { ok: true };
  if (r?.errorCode === 3) return unavailable('not-enrolled');
  if (r?.deviceIsSecure === false) return unavailable('no-lock');
  return unavailable('unavailable');
}

// Есть ли вообще плагин: только в приложении для Android. На сайте — нет (экраны тогда пишут «работает только в приложении»).
export const quickUnlockSupported = () => !!plugin();

// Включён ли вход по отпечатку на этом устройстве (быстрая проверка без обращения к системе).
export const quickUnlockEnabled = () => !!getPref(FLAG) && quickUnlockSupported();

async function verify(p, kind) {
  try { await withTimeout(p.verifyIdentity({ ...PROMPT[kind], reason: PROMPT[kind].description, maxAttempts: 3, useFallback: false }), 120000); }
  catch (e) { throw new QuickUnlockError(reasonOf(e)); }
}

// Случайная строка для поля «логин» плагина. Плагин шифрует оба поля одним и тем же начальным вектором, поэтому по двум зашифрованным значениям
// можно узнать их «разность»; если одно из значений случайное, разность ничего не раскрывает. Настоящий логин и пароль лежат одним значением (в поле «пароль»).
function randomPad(n = 24) {
  const out = [], buf = new Uint8Array(32);
  while (out.length < n) {
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) if (b < 188 && out.length < n) out.push(String.fromCharCode(33 + (b % 94)));          // 188 = 2 × 94: без перекоса; знаки ! … ~
  }
  return out.join('');
}

// Включить: проверить телефон, показать окно отпечатка (подтверждение), сохранить пароль. Пароль к этому моменту уже проверен вызывающим.
export async function enableQuickUnlock({ username = '', password } = {}) {
  if (typeof password !== 'string' || !password) throw new QuickUnlockError('error', 'Не хватает пароля для сохранения.');
  const av = await quickUnlockAvailable();
  if (!av.ok) throw new QuickUnlockError(av.reason);
  const p = plugin();
  await verify(p, 'enable');
  try { await withTimeout(p.setCredentials({ server: SERVER, username: randomPad(), password: JSON.stringify({ v: 1, u: String(username ?? ''), p: password }) }), 15000); }
  catch { throw new QuickUnlockError('error', 'Не удалось сохранить вход в защищённое хранилище телефона. Пароль остаётся рабочим способом входа.'); }
  setPref(FLAG, true);
  return { ok: true };
}

// Выключить и стереть сохранённый пароль из хранилища телефона. Не бросает исключений: вызывается при выходе, смене пароля и стирании данных.
export async function disableQuickUnlock() {
  setPref(FLAG, false);
  const p = plugin();
  if (p) { try { await withTimeout(p.deleteCredentials({ server: SERVER }), 4000); } catch { /* записи нет или плагин молчит: отметка уже снята, этого достаточно */ } }
  return { ok: true };
}

function parseSaved(raw) {
  try {
    const d = JSON.parse(raw);
    if (d && d.v === 1 && typeof d.p === 'string' && d.p && typeof d.u === 'string') return { username: d.u, password: d.p };
  } catch { /* не наш формат */ }
  return null;
}

// Показать окно отпечатка и вернуть { username, password }. Ошибки: QuickUnlockError с понятным текстом (отменено, слишком много попыток…).
// Сохранённое, но нечитаемое (ключ пропал) выключает быстрый вход сам: иначе человек каждый раз упирался бы в одну и ту же ошибку.
export async function quickUnlockCredentials() {
  const p = plugin();
  if (!p) throw new QuickUnlockError('web');
  if (!getPref(FLAG)) throw new QuickUnlockError('missing');
  await verify(p, 'unlock');
  let saved = null, failure = 'broken';
  try { saved = parseSaved((await withTimeout(p.getCredentials({ server: SERVER }), 15000))?.password); }
  catch (e) { if (/No credentials found/i.test(String(e?.message ?? e))) failure = 'missing'; }
  if (!saved) { await disableQuickUnlock(); throw new QuickUnlockError(failure); }
  return saved;
}

// Получить сохранённые данные по отпечатку и передать их действию (разблокировка, вход в аккаунт). Если действие говорит «пароль не подходит»
// (isStale), быстрый вход выключается: в хранилище лежит старый пароль, а не неверная попытка человека. Остальные ошибки действия идут дальше как есть.
export async function quickUnlockRun(action, { isStale = () => false } = {}) {
  const cred = await quickUnlockCredentials();
  try { return await action(cred); }
  catch (e) {
    if (isStale(e)) { await disableQuickUnlock(); throw new QuickUnlockError('stale'); }
    throw e;
  }
}
