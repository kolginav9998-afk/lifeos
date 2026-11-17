// Контакты, приглашения, переписка и администрирование сервера. Подключается из core.js, сам ничего оттуда не импортирует
// (помощники приходят параметром H), чтобы не было круговых ссылок.
//
// Правила приватности (требование владельца: у каждого свой аккаунт, чужого никто не видит):
//  • общего списка людей нет; человек видит только своих контактов: того, кто его пригласил, и тех, кого пригласил он;
//  • на обращение к чужому или несуществующему ресурсу всегда один ответ «не найдено» (нельзя проверить, есть ли такое имя);
//  • сообщения и встречи зашифрованы на устройствах, сервер видит только «кто, кому, когда, размер»;
//  • администратор (первый аккаунт) видит служебные сведения об аккаунтах, но не содержимое, которого у сервера нет.

export const INVITE_MS = 7 * 24 * 3600 * 1000;
export const MAX_ACTIVE_INVITES = 5;
export const MSG_RETENTION_MS = 180 * 24 * 3600 * 1000;
export const MSG_PER_MINUTE = 60;
const MSG_MAX_BYTES = 16 * 1024;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';            // 32 знака без похожих (нет 0, 1, I, O): код удобно диктовать

export const maxAccounts = env => Math.min(50, Math.max(2, Number(env.MAX_ACCOUNTS) || 5));
const usersMayInvite = env => env.INVITES_BY_USERS === '1' || env.INVITES_BY_USERS === 'true';

export const isSocialPath = p => ['/v1/invites', '/v1/contacts', '/v1/keys', '/v1/chat/send', '/v1/chat/inbox', '/v1/chat/hide', '/v1/admin/accounts'].includes(p)
  || /^\/v1\/(invites|contacts)\/[^/]+$/.test(p) || /^\/v1\/admin\/accounts\/[^/]+(\/(disable|enable))?$/.test(p);

export const normalizeInvite = s => String(s ?? '').toUpperCase().replace(/[\s-]/g, '');
const INVITE_SHAPE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;
const newInviteCode = H => { let s = ''; for (const x of H.randomBytes(12)) s += ALPHABET[x & 31]; return s.match(/.{4}/g).join('-'); };
const inviteHash = (H, code) => H.sha256Hex(`invite:${normalizeInvite(code)}`);

// Приглашение, которое ещё можно использовать, или null (формат, незнакомый код, использован, отозван, просрочен: снаружи всё одинаково).
export async function findValidInvite(store, H, raw, now) {
  const code = normalizeInvite(raw);
  if (!INVITE_SHAPE.test(code)) return null;
  const inv = store.findInvite(await inviteHash(H, code));
  return inv && !inv.used_by && !inv.revoked && inv.expires_at >= now ? inv : null;
}

const decodeName = (H, raw) => { try { return H.normalizeUsername(decodeURIComponent(raw)); } catch { throw new H.HttpError(400, 'bad_username'); } };

export async function handleSocial(c) {
  const { request, url, path, method, store, env, now, account, reply, H } = c;
  const { HttpError } = H;
  const isAdmin = account.role === 'admin';
  const canInvite = isAdmin || usersMayInvite(env);
  const notFound = () => new HttpError(404, 'not_found');

  // ---------- приглашения ----------
  if (path === '/v1/invites' && method === 'POST') {
    if (!canInvite) throw notFound();
    if (store.activeInviteCount(account.id, now) >= MAX_ACTIVE_INVITES) throw new HttpError(429, 'too_many_invites');
    if (store.accountCount() >= maxAccounts(env)) throw new HttpError(403, 'accounts_limit');
    const code = newInviteCode(H), expiresAt = now + INVITE_MS;
    const id = store.createInvite(account.id, await inviteHash(H, code), now, expiresAt);
    return reply({ ok: true, id, code, expiresAt }, 201);                 // код показывается один раз: на сервере только его хэш
  }
  if (path === '/v1/invites' && method === 'GET') {
    if (!canInvite) throw notFound();
    return reply({ invites: store.listInvites(account.id).map(i => ({
      id: i.id, createdAt: i.created_at, expiresAt: i.expires_at, usedBy: i.used_name ?? null,
      state: i.used_at ? 'used' : i.revoked ? 'revoked' : i.expires_at < now ? 'expired' : 'active',
    })) });
  }
  const mInv = /^\/v1\/invites\/(\d{1,12})$/.exec(path);
  if (mInv && method === 'DELETE') {
    if (!canInvite || !store.revokeInvite(account.id, Number(mInv[1]))) throw notFound();
    return reply({ ok: true });
  }

  // ---------- контакты ----------
  if (path === '/v1/contacts' && method === 'GET') {
    return reply({ contacts: store.listContacts(account.id).map(a => ({
      username: a.username, display: a.display || null, pub: a.pub || null, since: a.since,
      via: a.invited_by === account.id ? 'invited' : account.invited_by === a.id ? 'inviter' : 'contact',
    })) });
  }
  const mCon = /^\/v1\/contacts\/([^/]+)$/.exec(path);
  if (mCon && method === 'DELETE') {
    const peer = store.getAccountByName(decodeName(H, mCon[1]));
    if (peer && store.isContact(account.id, peer.id)) store.removeContact(account.id, peer.id);
    return reply({ ok: true });                                              // ответ один и тот же: нельзя узнать, был ли такой контакт
  }

  // ---------- публичный ключ и имя в чате ----------
  if (path === '/v1/keys' && method === 'POST') {
    const b = await H.readJson(request);
    let pub = account.pub ?? null, display = account.display ?? null;
    if (b.pub !== undefined) {
      if (!H.isB64(b.pub, 65, 65) || H.unb64(b.pub)[0] !== 4) throw new HttpError(400, 'bad_key');      // несжатая точка P-256
      pub = b.pub;
    }
    if (b.display !== undefined) display = String(b.display ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || null;
    store.setKeys(account.id, pub, display, now);
    return reply({ ok: true });
  }

  // ---------- переписка (содержимое зашифровано на устройствах) ----------
  if (path === '/v1/chat/send' && method === 'POST') {
    const b = await H.readJson(request, 48 * 1024);
    if (!H.isB64(b.iv, 12, 12) || !H.isB64(b.ct, 16, MSG_MAX_BYTES)) throw new HttpError(400, 'bad_message');
    const peer = store.getAccountByName(H.normalizeUsername(b.to));
    if (!peer || peer.disabled || peer.id === account.id || !store.isContact(account.id, peer.id)) throw notFound();
    if (!store.hit(`msg:${account.id}`, now, 60_000, MSG_PER_MINUTE)) throw new HttpError(429, 'rate', { retryAfterMs: 60_000 });
    if (store.usedBytes(account.id) > (c.maxUserBytes ?? Infinity)) throw new HttpError(507, 'quota');
    store.purgeBox(now - MSG_RETENTION_MS);
    const r = store.putMessage(account.id, peer.id, now, b.iv, b.ct);
    return reply({ ok: true, seq: r.seq, ts: now }, 201);
  }
  if (path === '/v1/chat/inbox' && method === 'GET') {
    const after = Math.max(0, Number(url.searchParams.get('after') ?? 0) | 0);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100) | 0));
    const rows = store.listBox(account.id, after, limit);
    return reply({
      messages: rows.map(r => ({ seq: r.seq, from: r.out ? account.username : r.peer_name, to: r.out ? r.peer_name : account.username, ts: r.ts, iv: r.iv, ct: r.ct })),
      last: rows.length ? rows[rows.length - 1].seq : after,
      more: rows.length === limit,
    });
  }
  if (path === '/v1/chat/hide' && method === 'POST') {
    const b = await H.readJson(request);
    const peer = store.getAccountByName(H.normalizeUsername(b.with));
    if (peer) store.hidePeer(account.id, peer.id);
    return reply({ ok: true });
  }

  // ---------- администратор: только служебные сведения ----------
  if (path.startsWith('/v1/admin/')) {
    if (!isAdmin) throw notFound();                                           // для остальных этих маршрутов как будто нет
    if (path === '/v1/admin/accounts' && method === 'GET') {
      const all = store.listAccounts(), byId = new Map(all.map(a => [a.id, a]));
      return reply({
        max: maxAccounts(env), usersMayInvite: usersMayInvite(env),
        accounts: all.map(a => ({ username: a.username, display: a.display || null, role: a.role, disabled: !!a.disabled, createdAt: a.created_at, lastSeenAt: a.last_seen,
          usedBytes: store.usedBytes(a.id), invitedBy: a.invited_by ? byId.get(a.invited_by)?.username ?? null : null })),
      });
    }
    const m = /^\/v1\/admin\/accounts\/([^/]+)(?:\/(disable|enable))?$/.exec(path);
    if (m) {
      const target = store.getAccountByName(decodeName(H, m[1]));
      if (!target) throw notFound();
      if (target.id === account.id) throw new HttpError(400, 'cannot_self');
      if (method === 'POST' && m[2] === 'disable') { store.setDisabled(target.id, true); store.logAdmin(account.id, 'disable', target.username, now); return reply({ ok: true }); }
      if (method === 'POST' && m[2] === 'enable') { store.setDisabled(target.id, false); store.logAdmin(account.id, 'enable', target.username, now); return reply({ ok: true }); }
      if (method === 'DELETE' && !m[2]) { store.logAdmin(account.id, 'delete', target.username, now); store.deleteAccount(target.id); return reply({ ok: true }); }
    }
  }
  throw notFound();
}
