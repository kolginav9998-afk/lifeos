// Ядро чата (R4.3): ключи, контакты, получение и отправка зашифрованных сообщений, кэш расшифрованного, непрочитанное, встречи.
// Чистая логика с подставляемыми зависимостями (api, хранилище, ключи из журнала): без интерфейса и без прямого обращения к сети,
// поэтому целиком проверяется тестами против настоящего кода сервера. Экран только показывает то, что отдаёт это ядро.
//
// Доверие к ключу собеседника: при первой встрече запоминаем его открытый ключ; если потом на сервере ключ другой (новое устройство,
// новая установка или подмена), контакт получает статус 'changed', отправка блокируется, пока человек не подтвердит новый ключ
// (acceptKey) или не сверит код безопасности вживую. Прежняя переписка остаётся читаемой: расшифрованное хранится в кэше устройства.
import { generateChatKeys, importPrivate, sharedKey, encryptMessage, decryptMessage, safetyCode, validPublic, newMessageId } from './chat-crypto.js';
import { meetingsFromMessages } from './meet.js';

const norm = s => String(s ?? '').normalize('NFKC').trim().toLowerCase();
const MAX_KEPT = 1000;                          // сообщений на собеседника в кэше устройства
export class ChatError extends Error { constructor(code, text) { super(text ?? code); this.name = 'ChatError'; this.code = code; } }

export function createChat({ api, base, token, me, kv, getKeys, putKeys, now = () => Date.now(), newId = newMessageId }) {
  const meName = () => norm(me());
  const K = { cursor: 'cursor', thread: p => `thread:${p}`, read: p => `read:${p}`, peerKey: p => `peerkey:${p}` };
  let priv = null, myPub = null, contactList = [], loaded = false;
  const threads = new Map(), shared = new Map();          // peer → сообщения; peer|pub → общий ключ

  async function loadCache() {
    if (loaded) return;
    for (const c of (await kv.get('peers')) ?? []) threads.set(c, (await kv.get(K.thread(c))) ?? []);
    loaded = true;
  }
  async function saveThread(peer) {
    const list = threads.get(peer) ?? [];
    if (list.length > MAX_KEPT) list.splice(0, list.length - MAX_KEPT);
    await kv.set(K.thread(peer), list);
    await kv.set('peers', [...threads.keys()]);
  }

  // Ключи: берём из журнала, при отсутствии создаём и сохраняем в журнал; открытый ключ публикуем на сервере (повтор безвреден).
  async function init({ display } = {}) {
    await loadCache();
    let keys = getKeys();
    if (!keys) { keys = await generateChatKeys(); await putKeys(keys); }
    priv = await importPrivate(keys.priv);
    if (!priv) throw new ChatError('bad_key', 'Ключ чата повреждён');
    myPub = keys.pub;
    await api.setKeys(base, token(), { pub: myPub, ...(display !== undefined ? { display } : {}) });
    return { pub: myPub };
  }
  const need = () => { if (!priv) throw new ChatError('not_ready', 'Чат ещё не готов: открой раздел «Чат» заново'); };

  const keyFor = async (peer, pub) => {
    need();
    const id = `${peer}|${pub}`;
    if (!shared.has(id)) shared.set(id, await sharedKey(priv, pub, meName(), peer));
    return shared.get(id);
  };

  // Контакты с состоянием ключа: ok, changed (на сервере другой ключ, чем мы запомнили), none (человек ещё не открывал чат).
  async function contacts() {
    const { contacts: list } = await api.contacts(base, token());
    const out = [];
    for (const c of list) {
      const name = norm(c.username), trusted = await kv.get(K.peerKey(name));
      let keyStatus = 'none';
      if (c.pub && validPublic(c.pub)) {
        if (!trusted) { await kv.set(K.peerKey(name), c.pub); keyStatus = 'ok'; }
        else keyStatus = trusted === c.pub ? 'ok' : 'changed';
      }
      out.push({ ...c, username: name, keyStatus, trustedPub: trusted && keyStatus !== 'none' ? trusted : (c.pub || null) });
    }
    contactList = out;
    return out;
  }
  const contactOf = peer => contactList.find(c => c.username === norm(peer)) ?? null;
  const list = () => [...contactList];
  async function acceptKey(peer) {
    const c = contactOf(peer);
    if (!c?.pub) throw new ChatError('no_key', 'У человека нет ключа');
    await kv.set(K.peerKey(c.username), c.pub);
    c.keyStatus = 'ok'; c.trustedPub = c.pub;
  }
  async function safety(peer) {
    const c = contactOf(peer);
    if (!c?.pub || !myPub) return null;
    return safetyCode(myPub, c.pub);
  }

  // Забирает новые сообщения с сервера, расшифровывает и кладёт в кэш. Возвращает { added, byPeer }.
  async function poll() {
    need(); await loadCache();
    if (!contactList.length) await contacts();
    let after = (await kv.get(K.cursor)) ?? 0, added = 0;
    const byPeer = {};
    for (let guard = 0; guard < 50; guard++) {
      const res = await api.chatInbox(base, token(), after, 100);
      for (const m of res.messages) {
        const out = norm(m.from) === meName(), peer = norm(out ? m.to : m.from), c = contactOf(peer);
        const list = threads.get(peer) ?? []; threads.set(peer, list);
        if (list.some(x => x.seq === m.seq)) continue;
        let body = null;
        const pub = c?.trustedPub ?? c?.pub;
        if (pub) { try { body = await decryptMessage(await keyFor(peer, pub), m); } catch { body = null; } }
        list.push({ seq: m.seq, from: norm(m.from), to: norm(m.to), ts: m.ts, out, body: body ?? { v: 1, kind: 'unreadable' } });
        added++; if (!out) byPeer[peer] = (byPeer[peer] ?? 0) + 1;
      }
      after = Math.max(after, res.last);
      if (!res.more) break;
    }
    for (const peer of threads.keys()) { threads.get(peer).sort((a, b) => a.seq - b.seq); await saveThread(peer); }
    await kv.set(K.cursor, after);
    return { added, byPeer };
  }

  // Отправка: body — { kind, … } без служебных полей; id и время ставятся здесь. Возвращает сохранённое сообщение.
  async function send(peer, body) {
    need();
    const name = norm(peer);
    if (!contactList.length) await contacts();
    const c = contactOf(name);
    if (!c) throw new ChatError('not_contact', 'Этот человек не в твоих контактах');
    if (!c.pub) throw new ChatError('no_key', 'Человек ещё не открывал чат: попроси его зайти в приложение');
    if (c.keyStatus === 'changed') throw new ChatError('key_changed', 'У собеседника сменился код безопасности. Сверь его вживую и подтверди, прежде чем писать');
    const full = { v: 1, id: newId(), ts: now(), ...body };
    const sealed = await encryptMessage(await keyFor(name, c.trustedPub ?? c.pub), full);
    const res = await api.chatSend(base, token(), { to: name, ...sealed });
    const list = threads.get(name) ?? []; threads.set(name, list);
    list.push({ seq: res.seq, from: meName(), to: name, ts: full.ts, out: true, body: full });
    list.sort((a, b) => a.seq - b.seq);
    await saveThread(name);
    return list.find(x => x.seq === res.seq);
  }

  const thread = peer => [...(threads.get(norm(peer)) ?? [])];
  async function unread(peer) {
    const readTo = (await kv.get(K.read(norm(peer)))) ?? 0;
    return thread(peer).filter(m => !m.out && m.seq > readTo && m.body?.kind !== 'meet-status').length;
  }
  async function markRead(peer) {
    const list = thread(peer);
    if (list.length) await kv.set(K.read(norm(peer)), list[list.length - 1].seq);
  }
  async function unreadTotal() { let n = 0; for (const p of threads.keys()) n += await unread(p); return n; }
  // Встречи переписки и всех переписок (новые сверху). Пригодность и подделку проверяет meet.js.
  const meetings = (peer, today) => meetingsFromMessages(thread(peer).map(m => ({ from: m.from, to: m.to, ts: m.body?.ts ?? m.ts, seq: m.seq, body: m.body })), today);
  const allMeetings = today => [...threads.keys()].flatMap(p => meetings(p, today)).sort((a, b) => b.ts - a.ts);

  // Забыть всё на устройстве (при смене аккаунта): ключи в журнале здесь не трогаем, это решает вызывающий.
  async function forget() { threads.clear(); shared.clear(); contactList = []; loaded = false; await kv.set('peers', []); await kv.set(K.cursor, 0); }

  return { init, contacts, list, acceptKey, safety, poll, send, thread, unread, markRead, unreadTotal, meetings, allMeetings, forget, contactOf: peer => contactOf(peer), publicKey: () => myPub };
}
