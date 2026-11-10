// Сервер синхронизации Life OS: обработчик запросов на стандартных Web API (Request/Response).
// Работает в Cloudflare Workers, Deno, Bun и Node 18+. Хранилище подставляется снаружи (см. sqlstore.js).
//
// Модель безопасности («нулевое знание»):
//  • пароль на сервер не отправляется: клиент считает из него authKey (PBKDF2) и шлёт только его;
//  • сервер хранит лишь HMAC от authKey, а не сам пароль;
//  • данные приходят уже зашифрованными на устройстве; ключ шифрования сервер не знает;
//  • «мета» (обёрнутый ключ данных) — тоже зашифрована паролем (и кодом восстановления).
// Аккаунт на сервере ровно один: регистрация открыта, только пока его нет.

const VERSION = 1;
const MAX_BODY = 3 * 1024 * 1024;              // 3 МБ на запрос
const MAX_BATCH = 200;                          // записей в одной отправке
const MAX_RECORD_CT = 256 * 1024;               // размер зашифрованной записи (base64-символов)
const MAX_META = 8192;
const SESSION_MS = 30 * 24 * 3600 * 1000;
const PAGE_BYTES = 900 * 1024;
const MAX_TOTAL_BYTES = 400 * 1024 * 1024;
const DEFAULT_ORIGINS = ['https://kolginav9998-afk.github.io', 'https://localhost', 'http://localhost', 'capacitor://localhost'];
export const lockoutMs = n => (n < 5 ? 0 : Math.min(1000 * 2 ** (n - 5), 15 * 60 * 1000));

const te = new TextEncoder();
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const isB64 = (s, minBytes, maxBytes) => {
  if (typeof s !== 'string' || s.length % 4 !== 0 || !B64.test(s)) return false;
  const bytes = (s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
  return bytes >= minBytes && bytes <= maxBytes;
};
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function sha256Hex(s) { return hex(await crypto.subtle.digest('SHA-256', te.encode(s))); }
async function hmacHex(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, dataBytes));
}

export const normalizeUsername = u => String(u ?? '').normalize('NFKC').trim().toLowerCase();
const USER_RE = /^[\p{L}\p{N}._@+-]{3,64}$/u;

class HttpError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}

// ---------- ответы ----------
function allowedOrigin(origin, env) {
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS).split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_ORIGINS);
  if (list.includes('*')) return origin;
  return list.includes(origin) ? origin : null;
}
function headersFor(request, env, extra = {}) {
  const h = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    ...extra,
  };
  const o = allowedOrigin(request.headers.get('origin'), env);
  if (o) {
    h['access-control-allow-origin'] = o;
    h['access-control-allow-headers'] = 'authorization, content-type';
    h['access-control-allow-methods'] = 'GET, POST, DELETE, OPTIONS';
    h['access-control-max-age'] = '600';
    h.vary = 'Origin';
  }
  return h;
}
const json = (request, env, body, status = 200) => new Response(JSON.stringify(body), { status, headers: headersFor(request, env) });

// ---------- чтение и проверка тела ----------
async function readJson(request) {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'too_large');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_large');
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('shape');
    return v;
  } catch { throw new HttpError(400, 'bad_json'); }
}

function checkWrap(w) {
  return w && typeof w === 'object' && isB64(w.iv, 12, 12) && isB64(w.ct, 16, 256);
}
function checkMeta(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (JSON.stringify(m).length > MAX_META) return false;
  if (m.v !== 1 && m.v !== 2) return false;
  if (!Number.isInteger(m.iter) || m.iter < 1000 || m.iter > 10_000_000) return false;
  if (!isB64(m.salt, 16, 64) || !checkWrap(m.wrap)) return false;
  if (m.rec !== undefined) {
    const r = m.rec;
    if (!r || !Number.isInteger(r.iter) || r.iter < 1000 || r.iter > 10_000_000 || !isB64(r.salt, 16, 64) || !checkWrap(r.wrap)) return false;
  }
  return true;
}
const checkAuthKey = k => isB64(k, 32, 32);

function checkRecord(r, now) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || r.id.length < 1 || r.id.length > 100) return null;
  if (!Number.isSafeInteger(r.u) || r.u < 0) return null;
  const d = r.d ? 1 : 0;
  const u = Math.min(r.u, now + 24 * 3600 * 1000);            // часы устройства не должны уезжать в будущее
  if (d) return { id: r.id, u, d: 1, v: 1 };
  if (!isB64(r.iv, 12, 12) || typeof r.ct !== 'string' || r.ct.length > MAX_RECORD_CT || !isB64(r.ct, 16, MAX_RECORD_CT)) return null;
  return { id: r.id, u, d: 0, v: Number.isInteger(r.v) ? r.v : 1, iv: r.iv, ct: r.ct };
}

// ---------- защита от перебора ----------
function clientKey(request) {
  return request.headers.get('cf-connecting-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}
function checkLock(store, key, now) {
  const f = store.getFails(`ip:${key}`);
  const g = store.getFails('all');
  const wait = Math.max(lockoutMs(f.n) - (now - f.last), lockoutMs(Math.floor(g.n / 10)) - (now - g.last), 0);
  if (wait > 0) throw new HttpError(429, 'locked', { retryAfterMs: wait });
}
const failedAttempt = (store, key, now) => { store.addFail(`ip:${key}`, now); store.addFail('all', now); };
const clearAttempts = (store, key) => store.clearFails(`ip:${key}`);

// ---------- сессии ----------
async function newSession(store, now) {
  const token = b64url(randomBytes(32));
  const th = await sha256Hex(token);
  const expires = now + SESSION_MS;
  store.addSession(th, now, expires);
  return { token, expiresAt: expires };
}
async function authenticate(request, store, now) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get('authorization') ?? '');
  if (!m) throw new HttpError(401, 'unauthorized');
  const th = await sha256Hex(m[1]);
  const s = store.getSession(th);
  if (!s || s.expires_at < now) throw new HttpError(401, 'unauthorized');
  if (now - s.last_used > 3600 * 1000) store.touchSession(th, now, now + SESSION_MS);     // продлеваем при использовании
  return { th, account: store.getAccount() };
}

async function verifyAuth(account, authKeyB64, prefix = '') {
  const salt = unb64(account[`${prefix}hash_salt`] ?? account.hash_salt);
  const h = await hmacHex(salt, unb64(authKeyB64));
  return safeEqual(h, prefix === 'rec_' ? account.rec_hash : account.auth_hash);
}

// Правдоподобные «параметры» для несуществующего пользователя, чтобы нельзя было проверять, есть ли такой логин.
async function decoyParams(store, username) {
  let key = store.kvGet('decoy_key');
  if (!key) { key = b64url(randomBytes(32)); store.kvSet('decoy_key', key); }
  const mac = await hmacHex(te.encode(key), te.encode(`decoy:${username}`));
  return { salt: btoa(String.fromCharCode(...mac.match(/../g).slice(0, 16).map(x => parseInt(x, 16)))), iter: 600000 };
}

// ---------- маршруты ----------
async function route(request, store, env, now) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: headersFor(request, env) });

  if (path === '/v1/status' && method === 'GET') {
    const acc = store.getAccount();
    return json(request, env, { app: 'lifeos-sync', v: VERSION, registered: !!acc, setupCodeRequired: !!env.SETUP_CODE, time: now });
  }

  // --- регистрация ---
  if (path === '/v1/register' && method === 'POST') {
    const b = await readJson(request);
    const username = normalizeUsername(b.username);
    if (!USER_RE.test(username)) throw new HttpError(400, 'bad_username');
    if (!checkAuthKey(b.authKey) || !isB64(b.authSalt, 16, 64) || !Number.isInteger(b.authIter) || b.authIter < 1000 || b.authIter > 10_000_000) throw new HttpError(400, 'bad_auth');
    if (!checkMeta(b.meta)) throw new HttpError(400, 'bad_meta');
    let rec = null;
    if (b.recovery !== undefined) {
      const r = b.recovery;
      if (!r || !checkAuthKey(r.authKey) || !isB64(r.salt, 16, 64) || !Number.isInteger(r.iter) || r.iter < 1000 || r.iter > 10_000_000) throw new HttpError(400, 'bad_recovery');
      rec = r;
    }
    if (env.SETUP_CODE && !safeEqual(String(b.setupCode ?? ''), String(env.SETUP_CODE))) throw new HttpError(403, 'bad_setup_code');
    const hashSaltBytes = randomBytes(16);
    const authHash = await hmacHex(hashSaltBytes, unb64(b.authKey));
    const recHash = rec ? await hmacHex(hashSaltBytes, unb64(rec.authKey)) : null;
    // дальше без await: проверка «аккаунта нет» и запись — одно неделимое действие
    if (store.getAccount()) throw new HttpError(409, 'account_exists');
    store.createAccount({
      username, authSalt: b.authSalt, authIter: b.authIter, hashSalt: btoa(String.fromCharCode(...hashSaltBytes)), authHash,
      recSalt: rec?.salt, recIter: rec?.iter, recHash, meta: JSON.stringify(b.meta),
    }, now);
    const s = await newSession(store, now);
    return json(request, env, { ok: true, ...s }, 201);
  }

  // --- параметры входа (публичные) ---
  if (path === '/v1/login/params' && method === 'POST') {
    const b = await readJson(request);
    const username = normalizeUsername(b.username);
    const acc = store.getAccount();
    if (acc && acc.username === username) return json(request, env, { salt: acc.auth_salt, iter: acc.auth_iter });
    return json(request, env, await decoyParams(store, username));
  }

  // --- вход ---
  if (path === '/v1/login' && method === 'POST') {
    const b = await readJson(request);
    if (!checkAuthKey(b.authKey)) throw new HttpError(400, 'bad_auth');
    const key = clientKey(request);
    checkLock(store, key, now);
    const username = normalizeUsername(b.username);
    const acc = store.getAccount();
    let ok = false;
    if (acc && acc.username === username) ok = await verifyAuth(acc, b.authKey);
    else await hmacHex(randomBytes(16), unb64(b.authKey));            // выравниваем время ответа
    if (!ok) { failedAttempt(store, key, now); throw new HttpError(401, 'bad_credentials'); }
    clearAttempts(store, key);
    const s = await newSession(store, now);
    return json(request, env, { ok: true, ...s, meta: JSON.parse(acc.meta) });
  }

  // --- восстановление по коду: шаг 1 (проверка кода) ---
  if (path === '/v1/recover/params' && method === 'POST') {
    const b = await readJson(request);
    const username = normalizeUsername(b.username);
    const acc = store.getAccount();
    if (acc && acc.username === username && acc.rec_salt) return json(request, env, { salt: acc.rec_salt, iter: acc.rec_iter });
    return json(request, env, await decoyParams(store, `rec:${username}`));
  }
  if (path === '/v1/recover' && method === 'POST') {
    const b = await readJson(request);
    if (!checkAuthKey(b.recoveryAuthKey)) throw new HttpError(400, 'bad_auth');
    const key = clientKey(request);
    checkLock(store, key, now);
    const username = normalizeUsername(b.username);
    const acc = store.getAccount();
    let ok = false;
    if (acc && acc.username === username && acc.rec_hash) ok = await verifyAuth(acc, b.recoveryAuthKey, 'rec_');
    if (!ok) { failedAttempt(store, key, now); throw new HttpError(401, 'bad_credentials'); }
    clearAttempts(store, key);
    // короткоживущий токен только для шага 2 (смена пароля)
    const resetToken = b64url(randomBytes(32));
    store.kvSet('reset_th', `${await sha256Hex(resetToken)}:${now + 10 * 60 * 1000}`);
    return json(request, env, { ok: true, resetToken, meta: JSON.parse(acc.meta) });
  }
  if (path === '/v1/recover/finish' && method === 'POST') {
    const b = await readJson(request);
    if (typeof b.resetToken !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(b.resetToken)) throw new HttpError(400, 'bad_token');
    if (!checkAuthKey(b.newAuthKey) || !isB64(b.newAuthSalt, 16, 64) || !Number.isInteger(b.newAuthIter) || b.newAuthIter < 1000 || b.newAuthIter > 10_000_000) throw new HttpError(400, 'bad_auth');
    if (!checkMeta(b.newMeta)) throw new HttpError(400, 'bad_meta');
    const th = await sha256Hex(b.resetToken);
    const acc0 = store.getAccount();
    if (!acc0) throw new HttpError(404, 'no_account');
    const newHash = await hmacHex(unb64(acc0.hash_salt), unb64(b.newAuthKey));
    const stored = store.kvGet('reset_th') ?? '';
    const [sth, exp] = stored.split(':');
    if (!stored || !safeEqual(sth ?? '', th) || Number(exp) < now) throw new HttpError(401, 'bad_token');
    store.kvSet('reset_th', '');
    store.updateCredentials({ authSalt: b.newAuthSalt, authIter: b.newAuthIter, authHash: newHash, meta: JSON.stringify(b.newMeta) }, now);
    store.deleteSessionsExcept('');
    const s = await newSession(store, now);
    return json(request, env, { ok: true, ...s });
  }

  // ===== дальше — только с входом =====
  if (!['/v1/logout', '/v1/meta', '/v1/password', '/v1/sync', '/v1/account'].includes(path)) throw new HttpError(404, 'not_found');
  const { th, account } = await authenticate(request, store, now);
  if (!account) throw new HttpError(401, 'unauthorized');

  if (path === '/v1/logout' && method === 'POST') { store.deleteSession(th); return json(request, env, { ok: true }); }

  if (path === '/v1/meta' && method === 'GET') return json(request, env, { meta: JSON.parse(account.meta), username: account.username });

  if (path === '/v1/password' && method === 'POST') {
    const b = await readJson(request);
    if (!checkAuthKey(b.oldAuthKey) || !checkAuthKey(b.newAuthKey) || !isB64(b.newAuthSalt, 16, 64) || !Number.isInteger(b.newAuthIter) || b.newAuthIter < 1000 || b.newAuthIter > 10_000_000) throw new HttpError(400, 'bad_auth');
    if (!checkMeta(b.newMeta)) throw new HttpError(400, 'bad_meta');
    const key = clientKey(request);
    checkLock(store, key, now);
    const okOld = await verifyAuth(account, b.oldAuthKey);
    const newHash = await hmacHex(unb64(account.hash_salt), unb64(b.newAuthKey));
    if (!okOld) { failedAttempt(store, key, now); throw new HttpError(401, 'bad_credentials'); }
    clearAttempts(store, key);
    store.updateCredentials({ authSalt: b.newAuthSalt, authIter: b.newAuthIter, authHash: newHash, meta: JSON.stringify(b.newMeta) }, now);
    store.deleteSessionsExcept(th);                                  // другие устройства войдут заново
    return json(request, env, { ok: true });
  }

  // обновить только «мету» (например, добавили код восстановления)
  if (path === '/v1/meta' && method === 'POST') {
    const b = await readJson(request);
    if (!checkMeta(b.meta)) throw new HttpError(400, 'bad_meta');
    let recUpdate = null;
    if (b.recovery !== undefined) {
      const r = b.recovery;
      if (!r || !checkAuthKey(r.authKey) || !isB64(r.salt, 16, 64) || !Number.isInteger(r.iter) || r.iter < 1000 || r.iter > 10_000_000) throw new HttpError(400, 'bad_recovery');
      recUpdate = { salt: r.salt, iter: r.iter, hash: await hmacHex(unb64(account.hash_salt), unb64(r.authKey)) };
    }
    store.db.tx(() => {
      store.updateMeta(JSON.stringify(b.meta), now);
      if (recUpdate) store.db.run('UPDATE account SET rec_salt = ?, rec_iter = ?, rec_hash = ? WHERE id = 1', recUpdate.salt, recUpdate.iter, recUpdate.hash);
    });
    return json(request, env, { ok: true });
  }

  if (path === '/v1/sync' && method === 'GET') {
    const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) | 0);
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 500) | 0));
    return json(request, env, store.listRecords(since, limit, PAGE_BYTES));
  }

  if (path === '/v1/sync' && method === 'POST') {
    const b = await readJson(request);
    if (!Array.isArray(b.records) || b.records.length > MAX_BATCH) throw new HttpError(400, 'bad_batch');
    const clean = [];
    for (const r of b.records) {
      const c = checkRecord(r, now);
      if (!c) throw new HttpError(400, 'bad_record', { id: typeof r?.id === 'string' ? r.id.slice(0, 100) : null });
      clean.push(c);
    }
    if (store.stats().bytes > MAX_TOTAL_BYTES) throw new HttpError(507, 'quota');
    const res = store.upsertRecords(clean, now);
    return json(request, env, { ok: true, ...res, time: now });
  }

  if (path === '/v1/account' && method === 'DELETE') {
    const b = await readJson(request);
    if (!checkAuthKey(b.authKey)) throw new HttpError(400, 'bad_auth');
    const key = clientKey(request);
    checkLock(store, key, now);
    if (!(await verifyAuth(account, b.authKey))) { failedAttempt(store, key, now); throw new HttpError(401, 'bad_credentials'); }
    store.wipeAll();
    return json(request, env, { ok: true });
  }

  throw new HttpError(404, 'not_found');
}

export async function handle(request, store, env = {}, now = Date.now()) {
  try {
    return await route(request, store, env, now);
  } catch (e) {
    if (e instanceof HttpError) return json(request, env, { error: e.code, ...e.extra }, e.status);
    console.error('server error:', e?.message);               // подробности (и тем более данные) в ответ не отдаём
    return json(request, env, { error: 'server_error' }, 500);
  }
}
