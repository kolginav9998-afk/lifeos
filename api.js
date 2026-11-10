// Клиент сервера синхронизации. Единственное место, где приложение обращается к сети.
// Сервер получает только зашифрованные записи и ключи входа; пароль и ключ шифрования не отправляются.

export class ApiError extends Error {
  constructor(status, code, extra = {}) { super(code); this.name = 'ApiError'; this.status = status; this.code = code; this.extra = extra; }
  get retryAfterMs() { return Number(this.extra?.retryAfterMs) || 0; }
}

// Допускаем только https (и http для localhost при отладке); берём только «origin»: путь и параметры отбрасываем.
export function normalizeServerUrl(input) {
  let u;
  try { u = new URL(String(input ?? '').trim()); } catch { throw new Error('Некорректный адрес сервера'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Адрес сервера должен начинаться с https://');
  return u.origin;
}

export function createApi({ fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 20000 } = {}) {
  async function call(base, method, path, { body, token } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      });
    } catch (e) { throw new ApiError(0, e?.name === 'AbortError' ? 'timeout' : 'network'); }
    finally { clearTimeout(timer); }
    let data = null;
    try { data = await res.json(); } catch { /* тело не JSON */ }
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `http_${res.status}`, data ?? {});
    if (!data || typeof data !== 'object') throw new ApiError(res.status, 'bad_response');
    return data;
  }
  return {
    status: base => call(base, 'GET', '/v1/status'),
    loginParams: (base, username) => call(base, 'POST', '/v1/login/params', { body: { username } }),
    login: (base, body) => call(base, 'POST', '/v1/login', { body }),
    register: (base, body) => call(base, 'POST', '/v1/register', { body }),
    logout: (base, token) => call(base, 'POST', '/v1/logout', { token }),
    getMeta: (base, token) => call(base, 'GET', '/v1/meta', { token }),
    setMeta: (base, token, body) => call(base, 'POST', '/v1/meta', { token, body }),
    password: (base, token, body) => call(base, 'POST', '/v1/password', { token, body }),
    recoverParams: (base, username) => call(base, 'POST', '/v1/recover/params', { body: { username } }),
    recover: (base, body) => call(base, 'POST', '/v1/recover', { body }),
    recoverFinish: (base, body) => call(base, 'POST', '/v1/recover/finish', { body }),
    pull: (base, token, since, limit = 500) => call(base, 'GET', `/v1/sync?since=${since}&limit=${limit}`, { token }),
    push: (base, token, records) => call(base, 'POST', '/v1/sync', { token, body: { records } }),
    deleteAccount: (base, token, authKey) => call(base, 'DELETE', '/v1/account', { token, body: { authKey } }),
  };
}
