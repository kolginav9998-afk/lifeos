// Хранилище сервера синхронизации на SQL. Один и тот же код работает
//  • в Cloudflare Durable Object (встроенный SQLite) и
//  • в Node (node:sqlite) — для тестов и для запуска на своём сервере.
// Адаптер базы даёт три функции: all(sql, ...params) -> rows, run(sql, ...params), tx(fn).
// Сервер НИКОГДА не видит открытых данных: в records лежат только зашифрованные на устройстве записи.

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS account (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     username TEXT NOT NULL, auth_salt TEXT NOT NULL, auth_iter INTEGER NOT NULL,
     hash_salt TEXT NOT NULL, auth_hash TEXT NOT NULL,
     rec_salt TEXT, rec_iter INTEGER, rec_hash TEXT,
     meta TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     th TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_used INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS records (
     id TEXT PRIMARY KEY, u INTEGER NOT NULL, seq INTEGER NOT NULL,
     d INTEGER NOT NULL DEFAULT 0, v INTEGER NOT NULL DEFAULT 1, iv TEXT, ct TEXT)`,
  `CREATE INDEX IF NOT EXISTS records_seq ON records (seq)`,
  `CREATE TABLE IF NOT EXISTS fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, last INTEGER NOT NULL)`,
];

const MAX_SESSIONS = 12;

export class SqlStore {
  constructor(db) { this.db = db; }
  migrate() { for (const s of SCHEMA) this.db.run(s); return this; }

  // ---- служебные значения ----
  kvGet(k) { return this.db.all('SELECT v FROM kv WHERE k = ?', k)[0]?.v ?? null; }
  kvSet(k, v) { this.db.run('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v)); }

  // ---- аккаунт (он один) ----
  getAccount() { return this.db.all('SELECT * FROM account WHERE id = 1')[0] ?? null; }
  createAccount(a, now) {
    this.db.run(`INSERT INTO account (id, username, auth_salt, auth_iter, hash_salt, auth_hash, rec_salt, rec_iter, rec_hash, meta, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    a.username, a.authSalt, a.authIter, a.hashSalt, a.authHash, a.recSalt ?? null, a.recIter ?? null, a.recHash ?? null, a.meta, now, now);
  }
  // hash_salt аккаунта не меняется никогда: от него зависит и хэш кода восстановления.
  updateCredentials(c, now) {
    this.db.run(`UPDATE account SET auth_salt = ?, auth_iter = ?, auth_hash = ?, meta = ?, updated_at = ? WHERE id = 1`,
      c.authSalt, c.authIter, c.authHash, c.meta, now);
  }
  updateMeta(meta, now) { this.db.run('UPDATE account SET meta = ?, updated_at = ? WHERE id = 1', meta, now); }

  // ---- сессии: хранится только хэш токена ----
  addSession(th, now, expires) {
    this.db.run('INSERT OR REPLACE INTO sessions (th, created_at, expires_at, last_used) VALUES (?, ?, ?, ?)', th, now, expires, now);
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', now);
    this.db.run(`DELETE FROM sessions WHERE th IN (SELECT th FROM sessions ORDER BY last_used DESC LIMIT -1 OFFSET ?)`, MAX_SESSIONS);
  }
  getSession(th) { return this.db.all('SELECT * FROM sessions WHERE th = ?', th)[0] ?? null; }
  touchSession(th, now, expires) { this.db.run('UPDATE sessions SET last_used = ?, expires_at = ? WHERE th = ?', now, expires, th); }
  deleteSession(th) { this.db.run('DELETE FROM sessions WHERE th = ?', th); }
  deleteSessionsExcept(th) { this.db.run('DELETE FROM sessions WHERE th <> ?', th ?? ''); }

  // ---- попытки входа ----
  getFails(k) { return this.db.all('SELECT n, last FROM fails WHERE k = ?', k)[0] ?? { n: 0, last: 0 }; }
  addFail(k, now) {
    this.db.run('INSERT INTO fails (k, n, last) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1, last = excluded.last', k, now);
    this.db.run('DELETE FROM fails WHERE last < ?', now - 24 * 3600 * 1000);
  }
  clearFails(k) { this.db.run('DELETE FROM fails WHERE k = ?', k); }

  // ---- записи (зашифрованные на устройстве) ----
  getRecord(id) { return this.db.all('SELECT id, u, seq, d, v, iv, ct FROM records WHERE id = ?', id)[0] ?? null; }

  // Принимает пачку. Правило: побеждает запись с большим u; при равенстве — принимается (идемпотентно).
  // Возвращает { seq, accepted, stale: [{id, u}] }.
  upsertRecords(list, now) {
    let accepted = 0;
    const stale = [];
    this.db.tx(() => {
      let seq = Number(this.kvGet('seq') ?? 0);
      for (const r of list) {
        const cur = this.db.all('SELECT u FROM records WHERE id = ?', r.id)[0];
        if (cur && cur.u > r.u) { stale.push({ id: r.id, u: cur.u }); continue; }
        seq += 1;
        this.db.run(`INSERT INTO records (id, u, seq, d, v, iv, ct) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET u = excluded.u, seq = excluded.seq, d = excluded.d, v = excluded.v, iv = excluded.iv, ct = excluded.ct`,
        r.id, r.u, seq, r.d ? 1 : 0, r.v ?? 1, r.d ? null : r.iv, r.d ? null : r.ct);
        accepted += 1;
      }
      this.kvSet('seq', seq);
    });
    return { seq: Number(this.kvGet('seq') ?? 0), accepted, stale };
  }

  // Страница записей новее курсора. maxBytes ограничивает размер ответа.
  listRecords(since, limit, maxBytes) {
    const rows = this.db.all('SELECT id, u, seq, d, v, iv, ct FROM records WHERE seq > ? ORDER BY seq ASC LIMIT ?', since, limit + 1);
    const out = [];
    let bytes = 0;
    let more = rows.length > limit;
    for (const r of rows.slice(0, limit)) {
      const size = (r.ct?.length ?? 0) + (r.iv?.length ?? 0) + 80;
      if (out.length && bytes + size > maxBytes) { more = true; break; }
      bytes += size;
      out.push({ id: r.id, u: r.u, s: r.seq, d: r.d, v: r.v, iv: r.iv, ct: r.ct });
    }
    const seq = more ? out[out.length - 1].s : Number(this.kvGet('seq') ?? 0);   // дошли до конца — сразу текущий конец журнала
    return { records: out, more, seq };
  }

  stats() {
    const r = this.db.all('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(ct)), 0) AS bytes FROM records')[0];
    return { count: r.n, bytes: r.bytes, seq: Number(this.kvGet('seq') ?? 0) };
  }

  wipeAll() {
    this.db.tx(() => {
      for (const t of ['account', 'sessions', 'records', 'fails']) this.db.run(`DELETE FROM ${t}`);
      this.db.run(`DELETE FROM kv WHERE k = 'seq'`);
    });
  }
}
