// Аккаунт на сервере синхронизации (один пользователь). Пароль никуда не отправляется:
// на сервер уходит только ключ входа, посчитанный из пароля. Данные шифруются на устройстве.
import { ApiError, normalizeServerUrl } from './api.js';
import * as vault from './vault.js';
import { PBKDF2_ITER, randomBytes, deriveAuthKey, b64, unb64 } from './cryptoutil.js';

export const normalizeUsername = u => String(u ?? '').normalize('NFKC').trim().toLowerCase();
const USER_RE = /^[\p{L}\p{N}._@+-]{3,64}$/u;

export function describeError(e) {
  if (e instanceof vault.WrongPasswordError) return 'Неверный пароль';
  if (e instanceof vault.WrongRecoveryCodeError) return 'Неверный код восстановления';
  if (!(e instanceof ApiError)) return e?.message || String(e);
  const map = {
    network: 'Нет связи с сервером. Проверь интернет и адрес сервера.', timeout: 'Сервер долго не отвечает. Попробуй ещё раз.',
    bad_credentials: 'Неверное имя или пароль', locked: `Слишком много попыток. Подожди ${Math.ceil(e.retryAfterMs / 1000)} с.`,
    account_exists: 'На этом сервере аккаунт уже создан. Войди в него.', bad_setup_code: 'Неверный код установки сервера',
    bad_username: 'Имя: 3–64 символа (буквы, цифры, . _ @ + -)', unauthorized: 'Сессия закончилась, войди снова',
    no_account: 'На сервере нет аккаунта', quota: 'На сервере закончилось место', bad_token: 'Код восстановления устарел, начни заново',
  };
  return map[e.code] || `Ошибка сервера (${e.code})`;
}

export function createAccountService({ api, storage = globalThis.localStorage, now = Date.now, authIter = PBKDF2_ITER, deps = {} } = {}) {
  const KEY = 'lifeos.account.v1';
  const SESS = 'lifeos.account.sess';
  const read = k => { try { return JSON.parse(storage.getItem(k) || 'null'); } catch { return null; } };
  let sessionCache = null;

  const info = () => read(KEY);
  const isLinked = () => !!info();

  async function saveSession(token, expiresAt) {
    sessionCache = { token, expiresAt };
    storage.setItem(SESS, JSON.stringify(await vault.seal({ id: 'session', token, expiresAt })));
  }
  async function loadSession() {
    const rec = read(SESS);
    if (!rec || !vault.isUnlocked()) return sessionCache;
    try { const s = await vault.open(rec); sessionCache = { token: s.token, expiresAt: s.expiresAt }; } catch { sessionCache = null; }
    return sessionCache;
  }
  const saveInfo = (server, username, authSalt, iter) => storage.setItem(KEY, JSON.stringify({ server, username, authSalt, authIter: iter, linkedAt: now() }));
  const forget = () => { sessionCache = null; storage.removeItem(KEY); storage.removeItem(SESS); };

  async function newAuth(password) {
    const salt = randomBytes(16);
    return { salt: b64(salt), iter: authIter, key: await deriveAuthKey(password, salt, authIter) };
  }
  const checkUser = name => { const u = normalizeUsername(name); if (!USER_RE.test(u)) throw new ApiError(400, 'bad_username'); return u; };

  return {
    info, isLinked, loadSession, session: () => sessionCache, token: () => sessionCache?.token ?? null, forget,
    clearMemory() { sessionCache = null; },

    async checkServer(url) {
      const server = normalizeServerUrl(url);
      const s = await api.status(server);
      if (s.app !== 'lifeos-sync') throw new ApiError(0, 'not_lifeos');
      return { server, registered: !!s.registered, setupCodeRequired: !!s.setupCodeRequired };
    },

    // Создать аккаунт. Если защиты паролем ещё нет — она включается (тем же паролем) и данные шифруются.
    async register({ server, username, password, setupCode }) {
      const base = normalizeServerUrl(server);
      const user = checkUser(username);
      const weak = vault.checkPassword(password);
      if (weak) throw new Error(weak);
      if (vault.status() === 'none') await deps.enableLock(password);
      else {
        if (vault.status() !== 'unlocked') throw new Error('Сначала разблокируй приложение');
        await vault.verify(password);                               // пароль аккаунта = пароль защиты на этом устройстве
      }
      const raw = await vault.unwrapRaw(password);
      let meta = vault.getMeta();
      let recovery, code = null;
      if (!meta.rec) {                                              // код восстановления нужен всегда: без него забытый пароль = потеря данных
        const r = await vault.makeRecovery(raw);
        meta = { ...meta, v: 2, rec: r.rec, changedAt: now() }; recovery = r.server; code = r.code;
      }
      const auth = await newAuth(password);
      const res = await api.register(base, { username: user, authKey: auth.key, authSalt: auth.salt, authIter: auth.iter, meta, ...(recovery ? { recovery } : {}), ...(setupCode ? { setupCode } : {}) });
      if (code) vault.commitMeta(meta);
      saveInfo(base, user, auth.salt, auth.iter);
      await saveSession(res.token, res.expiresAt);
      return { recoveryCode: code, expiresAt: res.expiresAt };
    },

    // Только сеть и проверка пароля — локальные данные не трогаем (нужно для «присоединения» устройства с данными).
    async authenticate({ server, username, password }) {
      const base = normalizeServerUrl(server);
      const user = normalizeUsername(username);
      const p = await api.loginParams(base, user);
      const authKey = await deriveAuthKey(password, unb64(p.salt), p.iter);
      const r = await api.login(base, { username: user, authKey });
      return { server: base, username: user, authSalt: p.salt, authIter: p.iter, token: r.token, expiresAt: r.expiresAt, meta: r.meta };
    },

    // Подходит ли ключ аккаунта к данным, уже лежащим на этом устройстве: 'empty' | 'same' | 'different'.
    async compatibility(auth, password, sampleSealed) {
      if (!sampleSealed) return 'empty';
      const raw = await vault.unwrapRaw(password, auth.meta);
      return (await vault.canOpenWith(raw, sampleSealed)) ? 'same' : 'different';
    },

    // Привязать устройство: принять ключ аккаунта (мету) и запомнить сессию.
    async link(auth, password) {
      await vault.adoptMeta(auth.meta, password);
      saveInfo(auth.server, auth.username, auth.authSalt, auth.authIter);
      await saveSession(auth.token, auth.expiresAt);
    },
    // Устройство уже содержит те же данные и тот же ключ: только запоминаем аккаунт.
    async linkKeepingKey(auth) {
      saveInfo(auth.server, auth.username, auth.authSalt, auth.authIter);
      await saveSession(auth.token, auth.expiresAt);
    },

    async logout() {
      const a = info();
      const s = await loadSession();
      if (a && s) { try { await api.logout(a.server, s.token); } catch { /* сеть недоступна — всё равно выходим локально */ } }
      forget();
    },

    // Смена пароля. С аккаунтом — вместе с сервером (сначала сервер, потом локально).
    async changePassword({ oldPassword, newPassword }) {
      const a = info();
      if (!a) return vault.changePassword(oldPassword, newPassword);
      const s = await loadSession();
      if (!s) throw new ApiError(401, 'unauthorized');
      const newMeta = await vault.prepareNewMeta(oldPassword, newPassword);    // здесь же проверяется старый пароль
      const oldAuthKey = await deriveAuthKey(oldPassword, unb64(a.authSalt), a.authIter);
      const na = await newAuth(newPassword);
      await api.password(a.server, s.token, { oldAuthKey, newAuthKey: na.key, newAuthSalt: na.salt, newAuthIter: na.iter, newMeta });
      vault.commitMeta(newMeta);
      saveInfo(a.server, a.username, na.salt, na.iter);
      return { ok: true };
    },

    // Создать (или заменить) код восстановления. Показывать нужно один раз.
    async createRecoveryCode(password) {
      const r = await vault.addRecovery(password);
      const a = info();
      if (a) {
        const s = await loadSession();
        if (!s) throw new ApiError(401, 'unauthorized');
        await api.setMeta(a.server, s.token, { meta: r.meta, recovery: r.server });
      }
      vault.commitMeta(r.meta);
      return r.code;
    },

    // Забыл пароль, но есть код восстановления: задать новый пароль и войти.
    async recover({ server, username, code, newPassword }) {
      const base = normalizeServerUrl(server);
      const user = normalizeUsername(username);
      const p = await api.recoverParams(base, user);
      const { authKey } = await vault.deriveRecovery(code, unb64(p.salt), p.iter);
      const r = await api.recover(base, { username: user, recoveryAuthKey: authKey });
      const { meta, raw } = await vault.adoptMetaWithCode(r.meta, code, newPassword);
      const na = await newAuth(newPassword);
      const f = await api.recoverFinish(base, { resetToken: r.resetToken, newAuthKey: na.key, newAuthSalt: na.salt, newAuthIter: na.iter, newMeta: meta });
      await vault.installUnlocked(meta, raw);
      saveInfo(base, user, na.salt, na.iter);
      await saveSession(f.token, f.expiresAt);
      return { ok: true };
    },

    // Удалить аккаунт и все данные на сервере (на устройствах данные остаются).
    async deleteServerAccount(password) {
      const a = info();
      const s = await loadSession();
      if (!a || !s) throw new ApiError(401, 'unauthorized');
      const authKey = await deriveAuthKey(password, unb64(a.authSalt), a.authIter);
      await api.deleteAccount(a.server, s.token, authKey);
      forget();
    },
  };
}
