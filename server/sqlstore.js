// Хранилище сервера синхронизации на SQL. Один и тот же код работает
//  • в Cloudflare Durable Object (встроенный SQLite) и
//  • в Node (node:sqlite) — для тестов и для запуска на своём сервере.
// Адаптер базы даёт три функции: all(sql, ...params) -> rows, run(sql, ...params), tx(fn).
// Сервер НИКОГДА не видит открытых данных: в recs и box лежат только зашифрованные на устройствах записи и сообщения.
//
// Несколько аккаунтов (R4.3): у каждого человека свой uid. Каждый запрос к данным получает uid и ограничен им;
// счётчики журнала и почты у каждого аккаунта свои, чтобы по пропускам в номерах нельзя было судить о чужой активности.
// Старые таблицы account и records (один аккаунт) при первом запуске копируются в новые и остаются нетронутыми:
// так при откате на прежний код данные на момент перехода не пропадают.

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS accts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0, invited_by INTEGER,
     auth_salt TEXT NOT NULL, auth_iter INTEGER NOT NULL, hash_salt TEXT NOT NULL, auth_hash TEXT NOT NULL,
     rec_salt TEXT, rec_iter INTEGER, rec_hash TEXT,
     meta TEXT NOT NULL, pub TEXT, display TEXT,
     seq INTEGER NOT NULL DEFAULT 0, mseq INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_seen INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     th TEXT PRIMARY KEY, uid INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_used INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS recs (
     uid INTEGER NOT NULL, id TEXT NOT NULL, u INTEGER NOT NULL, seq INTEGER NOT NULL,
     d INTEGER NOT NULL DEFAULT 0, v INTEGER NOT NULL DEFAULT 1, iv TEXT, ct TEXT, PRIMARY KEY (uid, id))`,
  `CREATE INDEX IF NOT EXISTS recs_seq ON recs (uid, seq)`,
  `CREATE TABLE IF NOT EXISTS fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, last INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS resets (th TEXT PRIMARY KEY, uid INTEGER NOT NULL, exp INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS invites (
     id INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER NOT NULL, code_hash TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_by INTEGER, used_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS contacts (a INTEGER NOT NULL, b INTEGER NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (a, b))`,
  `CREATE TABLE IF NOT EXISTS box (
     uid INTEGER NOT NULL, seq INTEGER NOT NULL, peer INTEGER NOT NULL, out INTEGER NOT NULL, ts INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL,
     PRIMARY KEY (uid, seq))`,
  `CREATE INDEX IF NOT EXISTS box_peer ON box (uid, peer)`,
  `CREATE TABLE IF NOT EXISTS rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, win INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS adminlog (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL)`,
];

const MAX_SESSIONS = 12;

export class SqlStore {
  constructor(db) { this.db = db; }

  migrate() {
    // Наличие таблицы и столбца проверяем пробным запросом: так не зависим от того, какие служебные таблицы SQLite доступны в окружении (Cloudflare, Node).
    const probe = sql => { try { this.db.all(sql); return true; } catch { return false; } };
    const tableExists = t => probe(`SELECT 1 FROM ${t} LIMIT 0`);
    const hasColumn = (t, c) => probe(`SELECT ${c} FROM ${t} LIMIT 0`);
    // старая таблица сессий (без uid): добавляем столбец, все прежние сессии принадлежат первому аккаунту
    if (tableExists('sessions') && !hasColumn('sessions', 'uid')) this.db.run('ALTER TABLE sessions ADD COLUMN uid INTEGER NOT NULL DEFAULT 1');
    for (const s of SCHEMA) this.db.run(s);
    // перенос прежнего единственного аккаунта и его записей (один раз; признак в kv не даёт «воскресить» удалённый аккаунт)
    if (this.kvGet('migrated_v2') === null) {
      this.db.tx(() => {
        if (tableExists('account') && this.accountCount() === 0) {
          const old = this.db.all('SELECT * FROM account WHERE id = 1')[0];
          if (old) {
            this.db.run(`INSERT INTO accts (id, username, role, auth_salt, auth_iter, hash_salt, auth_hash, rec_salt, rec_iter, rec_hash, meta, seq, created_at, updated_at, last_seen)
              VALUES (1, ?, 'admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            old.username, old.auth_salt, old.auth_iter, old.hash_salt, old.auth_hash, old.rec_salt ?? null, old.rec_iter ?? null, old.rec_hash ?? null, old.meta,
            Number(this.kvGet('seq') ?? 0), old.created_at, old.updated_at, old.updated_at);
            if (tableExists('records')) this.db.run('INSERT OR IGNORE INTO recs (uid, id, u, seq, d, v, iv, ct) SELECT 1, id, u, seq, d, v, iv, ct FROM records');
          }
        }
        this.kvSet('migrated_v2', '1');
      });
    }
    return this;
  }

  // ---- служебные значения ----
  kvGet(k) { return this.db.all('SELECT v FROM kv WHERE k = ?', k)[0]?.v ?? null; }
  kvSet(k, v) { this.db.run('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v)); }

  // ---- аккаунты ----
  getAccount() { return this.db.all('SELECT * FROM accts ORDER BY id LIMIT 1')[0] ?? null; }                  // первый аккаунт (удобно для тестов)
  getAccountById(id) { return this.db.all('SELECT * FROM accts WHERE id = ?', id)[0] ?? null; }
  getAccountByName(username) { return this.db.all('SELECT * FROM accts WHERE username = ?', username)[0] ?? null; }
  accountCount() { return this.db.all('SELECT COUNT(*) AS n FROM accts')[0].n; }
  listAccounts() { return this.db.all('SELECT * FROM accts ORDER BY id'); }

  // Создаёт аккаунт. Без приглашения возможен только самый первый (он становится администратором); с приглашением —
  // следующие, и пригласивший с новым человеком становятся контактами. Всё одним неделимым действием.
  // Бросает Error с кодом: account_exists, name_taken, bad_invite.
  registerAccount(a, inviteId, now) {
    let uid = 0;
    this.db.tx(() => {
      if (!inviteId && this.accountCount() > 0) throw new Error('account_exists');
      if (this.getAccountByName(a.username)) throw new Error('name_taken');
      let invitedBy = null;
      if (inviteId) {
        const inv = this.db.all('SELECT * FROM invites WHERE id = ?', inviteId)[0];
        if (!inv || inv.used_by || inv.revoked || inv.expires_at < now) throw new Error('bad_invite');
        invitedBy = inv.owner;
      }
      this.db.run(`INSERT INTO accts (username, role, invited_by, auth_salt, auth_iter, hash_salt, auth_hash, rec_salt, rec_iter, rec_hash, meta, created_at, updated_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.username, inviteId ? 'user' : 'admin', invitedBy, a.authSalt, a.authIter, a.hashSalt, a.authHash, a.recSalt ?? null, a.recIter ?? null, a.recHash ?? null, a.meta, now, now, now);
      uid = this.getAccountByName(a.username).id;
      if (inviteId) {
        this.db.run('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?', uid, now, inviteId);
        this.db.run('INSERT OR IGNORE INTO contacts (a, b, since) VALUES (?, ?, ?)', invitedBy, uid, now);
        this.db.run('INSERT OR IGNORE INTO contacts (a, b, since) VALUES (?, ?, ?)', uid, invitedBy, now);
      }
    });
    return uid;
  }
  // hash_salt аккаунта не меняется никогда: от него зависит и хэш кода восстановления.
  updateCredentials(uid, c, now) {
    this.db.run('UPDATE accts SET auth_salt = ?, auth_iter = ?, auth_hash = ?, meta = ?, updated_at = ? WHERE id = ?', c.authSalt, c.authIter, c.authHash, c.meta, now, uid);
  }
  updateMeta(uid, meta, now) { this.db.run('UPDATE accts SET meta = ?, updated_at = ? WHERE id = ?', meta, now, uid); }
  setRecovery(uid, r) { this.db.run('UPDATE accts SET rec_salt = ?, rec_iter = ?, rec_hash = ? WHERE id = ?', r.salt, r.iter, r.hash, uid); }
  touchSeen(uid, now) { this.db.run('UPDATE accts SET last_seen = ? WHERE id = ?', now, uid); }
  setKeys(uid, pub, display, now) { this.db.run('UPDATE accts SET pub = ?, display = ?, updated_at = ? WHERE id = ?', pub, display, now, uid); }
  setDisabled(uid, flag) {
    this.db.tx(() => {
      this.db.run('UPDATE accts SET disabled = ? WHERE id = ?', flag ? 1 : 0, uid);
      if (flag) this.db.run('DELETE FROM sessions WHERE uid = ?', uid);
    });
  }
  // Удаляет аккаунт со всем: записями, сессиями, приглашениями, контактами, ключом и перепиской (у собеседников тоже).
  deleteAccount(uid) {
    this.db.tx(() => {
      for (const q of ['DELETE FROM recs WHERE uid = ?', 'DELETE FROM sessions WHERE uid = ?', 'DELETE FROM resets WHERE uid = ?', 'DELETE FROM invites WHERE owner = ?',
        'DELETE FROM box WHERE uid = ?', 'DELETE FROM box WHERE peer = ?', 'DELETE FROM contacts WHERE a = ?', 'DELETE FROM contacts WHERE b = ?']) this.db.run(q, uid);
      this.db.run('UPDATE invites SET used_by = NULL WHERE used_by = ?', uid);
      this.db.run('UPDATE accts SET invited_by = NULL WHERE invited_by = ?', uid);
      this.db.run('DELETE FROM accts WHERE id = ?', uid);
    });
  }

  // ---- сессии: хранится только хэш токена ----
  addSession(uid, th, now, expires) {
    this.db.run('INSERT OR REPLACE INTO sessions (th, uid, created_at, expires_at, last_used) VALUES (?, ?, ?, ?, ?)', th, uid, now, expires, now);
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', now);
    this.db.run('DELETE FROM sessions WHERE uid = ? AND th IN (SELECT th FROM sessions WHERE uid = ? ORDER BY last_used DESC LIMIT -1 OFFSET ?)', uid, uid, MAX_SESSIONS);
  }
  getSession(th) { return this.db.all('SELECT * FROM sessions WHERE th = ?', th)[0] ?? null; }
  touchSession(th, now, expires) { this.db.run('UPDATE sessions SET last_used = ?, expires_at = ? WHERE th = ?', now, expires, th); }
  deleteSession(th) { this.db.run('DELETE FROM sessions WHERE th = ?', th); }
  deleteSessionsExcept(uid, th) { this.db.run('DELETE FROM sessions WHERE uid = ? AND th <> ?', uid, th ?? ''); }

  // ---- токены восстановления пароля (шаг 2): хранится хэш, живёт десять минут ----
  addReset(uid, th, now, exp) {
    this.db.run('DELETE FROM resets WHERE uid = ? OR exp < ?', uid, now - 3600 * 1000);
    this.db.run('INSERT OR REPLACE INTO resets (th, uid, exp) VALUES (?, ?, ?)', th, uid, exp);
  }
  // Возвращает uid и тут же удаляет токен (одноразовый); null, если токена нет или он просрочен.
  takeReset(th, now) {
    const r = this.db.all('SELECT uid, exp FROM resets WHERE th = ?', th)[0];
    if (!r) return null;
    this.db.run('DELETE FROM resets WHERE th = ?', th);
    return r.exp >= now ? r.uid : null;
  }

  // ---- попытки входа ----
  getFails(k) { return this.db.all('SELECT n, last FROM fails WHERE k = ?', k)[0] ?? { n: 0, last: 0 }; }
  addFail(k, now) {
    this.db.run('INSERT INTO fails (k, n, last) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1, last = excluded.last', k, now);
    this.db.run('DELETE FROM fails WHERE last < ?', now - 24 * 3600 * 1000);
  }
  clearFails(k) { this.db.run('DELETE FROM fails WHERE k = ?', k); }

  // Окно на количество действий (например, сообщений в минуту). true — можно, false — предел исчерпан.
  hit(k, now, windowMs, max) {
    const r = this.db.all('SELECT n, win FROM rate WHERE k = ?', k)[0];
    if (!r || now - r.win >= windowMs) {
      this.db.run('INSERT INTO rate (k, n, win) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = 1, win = excluded.win', k, now);
      this.db.run('DELETE FROM rate WHERE win < ?', now - 3600 * 1000);
      return true;
    }
    if (r.n >= max) return false;
    this.db.run('UPDATE rate SET n = n + 1 WHERE k = ?', k);
    return true;
  }

  // ---- записи (зашифрованные на устройстве), у каждого аккаунта свои ----
  // getRecord(id) без uid — запись первого аккаунта (так писали тесты, пока аккаунт был один)
  getRecord(uid, id) {
    if (id === undefined) { id = uid; uid = this.getAccount()?.id ?? 0; }
    return this.db.all('SELECT id, u, seq, d, v, iv, ct FROM recs WHERE uid = ? AND id = ?', uid, id)[0] ?? null;
  }

  // Принимает пачку. Правило: побеждает запись с большим u; при равенстве — принимается (идемпотентно).
  // Возвращает { seq, accepted, stale: [{id, u}] }.
  upsertRecords(uid, list, now) {
    let accepted = 0, seq = 0;
    const stale = [];
    this.db.tx(() => {
      seq = Number(this.db.all('SELECT seq FROM accts WHERE id = ?', uid)[0]?.seq ?? 0);
      for (const r of list) {
        const cur = this.db.all('SELECT u FROM recs WHERE uid = ? AND id = ?', uid, r.id)[0];
        if (cur && cur.u > r.u) { stale.push({ id: r.id, u: cur.u }); continue; }
        seq += 1;
        this.db.run(`INSERT INTO recs (uid, id, u, seq, d, v, iv, ct) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(uid, id) DO UPDATE SET u = excluded.u, seq = excluded.seq, d = excluded.d, v = excluded.v, iv = excluded.iv, ct = excluded.ct`,
        uid, r.id, r.u, seq, r.d ? 1 : 0, r.v ?? 1, r.d ? null : r.iv, r.d ? null : r.ct);
        accepted += 1;
      }
      this.db.run('UPDATE accts SET seq = ? WHERE id = ?', seq, uid);
    });
    return { seq, accepted, stale };
  }

  // Страница записей новее курсора. maxBytes ограничивает размер ответа.
  listRecords(uid, since, limit, maxBytes) {
    const rows = this.db.all('SELECT id, u, seq, d, v, iv, ct FROM recs WHERE uid = ? AND seq > ? ORDER BY seq ASC LIMIT ?', uid, since, limit + 1);
    const out = [];
    let bytes = 0;
    let more = rows.length > limit;
    for (const r of rows.slice(0, limit)) {
      const size = (r.ct?.length ?? 0) + (r.iv?.length ?? 0) + 80;
      if (out.length && bytes + size > maxBytes) { more = true; break; }
      bytes += size;
      out.push({ id: r.id, u: r.u, s: r.seq, d: r.d, v: r.v, iv: r.iv, ct: r.ct });
    }
    const seq = more ? out[out.length - 1].s : Number(this.db.all('SELECT seq FROM accts WHERE id = ?', uid)[0]?.seq ?? 0);   // дошли до конца — сразу текущий конец журнала
    return { records: out, more, seq };
  }

  // Без uid — сводка по всему серверу (для тестов и общей квоты); с uid — по одному аккаунту.
  stats(uid) {
    if (uid === undefined) {
      const r = this.db.all('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(ct)), 0) AS bytes FROM recs')[0];
      return { count: r.n, bytes: r.bytes, seq: Number(this.db.all('SELECT COALESCE(MAX(seq), 0) AS s FROM accts')[0].s) };
    }
    const r = this.db.all('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(ct)), 0) AS bytes FROM recs WHERE uid = ?', uid)[0];
    return { count: r.n, bytes: r.bytes, seq: Number(this.db.all('SELECT seq FROM accts WHERE id = ?', uid)[0]?.seq ?? 0) };
  }
  // Занято у аккаунта: журнал записей плюс отправленные им сообщения (место входит в квоту отправителя).
  usedBytes(uid) {
    const a = this.db.all('SELECT COALESCE(SUM(LENGTH(ct)), 0) AS b FROM recs WHERE uid = ?', uid)[0].b;
    const m = this.db.all('SELECT COALESCE(SUM(LENGTH(ct)), 0) AS b FROM box WHERE uid = ? AND out = 1', uid)[0].b;
    return a + m;
  }
  totalBytes() {
    return this.db.all('SELECT COALESCE(SUM(LENGTH(ct)), 0) AS b FROM recs')[0].b + this.db.all('SELECT COALESCE(SUM(LENGTH(ct)), 0) AS b FROM box')[0].b;
  }

  // ---- приглашения: хранится только хэш кода ----
  createInvite(owner, codeHash, now, expires) {
    this.db.run('INSERT INTO invites (owner, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)', owner, codeHash, now, expires);
    return this.db.all('SELECT id FROM invites WHERE code_hash = ?', codeHash)[0].id;
  }
  activeInviteCount(owner, now) {
    return this.db.all('SELECT COUNT(*) AS n FROM invites WHERE owner = ? AND used_by IS NULL AND revoked = 0 AND expires_at >= ?', owner, now)[0].n;
  }
  listInvites(owner) {
    return this.db.all(`SELECT i.id, i.created_at, i.expires_at, i.used_at, i.revoked, a.username AS used_name FROM invites i LEFT JOIN accts a ON a.id = i.used_by WHERE i.owner = ? ORDER BY i.id DESC LIMIT 50`, owner);
  }
  revokeInvite(owner, id) {
    const r = this.db.all('SELECT id FROM invites WHERE id = ? AND owner = ? AND used_by IS NULL AND revoked = 0', id, owner)[0];
    if (!r) return false;
    this.db.run('UPDATE invites SET revoked = 1 WHERE id = ?', id);
    return true;
  }
  findInvite(codeHash) { return this.db.all('SELECT * FROM invites WHERE code_hash = ?', codeHash)[0] ?? null; }

  // ---- контакты (связь в обе стороны) ----
  isContact(a, b) { return this.db.all('SELECT 1 AS x FROM contacts WHERE a = ? AND b = ?', a, b).length > 0; }
  listContacts(uid) {
    return this.db.all(`SELECT a.id, a.username, a.display, a.pub, a.invited_by, c.since FROM contacts c JOIN accts a ON a.id = c.b WHERE c.a = ? AND a.disabled = 0 ORDER BY a.username`, uid);
  }
  // Убирает связь с обеих сторон и переписку в ящике того, кто убирает.
  removeContact(uid, peer) {
    this.db.tx(() => {
      this.db.run('DELETE FROM contacts WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', uid, peer, peer, uid);
      this.db.run('DELETE FROM box WHERE uid = ? AND peer = ?', uid, peer);
    });
  }

  // ---- переписка: у каждого участника своя строка и свой номер, содержимое зашифровано на устройствах ----
  putMessage(from, to, now, iv, ct) {
    let mine = 0;
    this.db.tx(() => {
      mine = Number(this.db.all('SELECT mseq FROM accts WHERE id = ?', from)[0].mseq) + 1;
      const theirs = Number(this.db.all('SELECT mseq FROM accts WHERE id = ?', to)[0].mseq) + 1;
      this.db.run('UPDATE accts SET mseq = ? WHERE id = ?', mine, from);
      this.db.run('UPDATE accts SET mseq = ? WHERE id = ?', theirs, to);
      this.db.run('INSERT INTO box (uid, seq, peer, out, ts, iv, ct) VALUES (?, ?, ?, 1, ?, ?, ?)', from, mine, to, now, iv, ct);
      this.db.run('INSERT INTO box (uid, seq, peer, out, ts, iv, ct) VALUES (?, ?, ?, 0, ?, ?, ?)', to, theirs, from, now, iv, ct);
    });
    return { seq: mine };
  }
  listBox(uid, after, limit) {
    return this.db.all(`SELECT b.seq, b.out, b.ts, b.iv, b.ct, a.username AS peer_name FROM box b JOIN accts a ON a.id = b.peer WHERE b.uid = ? AND b.seq > ? ORDER BY b.seq ASC LIMIT ?`, uid, after, limit);
  }
  hidePeer(uid, peer) { this.db.run('DELETE FROM box WHERE uid = ? AND peer = ?', uid, peer); }
  purgeBox(before) { this.db.run('DELETE FROM box WHERE ts < ?', before); }

  // ---- журнал действий администратора ----
  logAdmin(actor, action, target, now) {
    this.db.run('INSERT INTO adminlog (ts, actor, action, target) VALUES (?, ?, ?, ?)', now, actor, action, target);
    this.db.run('DELETE FROM adminlog WHERE id NOT IN (SELECT id FROM adminlog ORDER BY id DESC LIMIT 500)');
  }

  wipeAll() {
    this.db.tx(() => {
      for (const t of ['accts', 'sessions', 'recs', 'fails', 'resets', 'invites', 'contacts', 'box', 'rate', 'adminlog']) this.db.run(`DELETE FROM ${t}`);
      this.db.run(`DELETE FROM kv WHERE k IN ('seq', 'reset_th')`);
    });
  }
}
