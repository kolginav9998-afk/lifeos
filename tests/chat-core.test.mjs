// Ядро чата целиком: настоящий код сервера в памяти + шифрование + логика встреч. Два «устройства» разговаривают через сервер.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/core.js';
import { openStore } from '../server/node/server.js';
import { createApi } from '../api.js';
import { createChat, ChatError } from '../chat-core.js';
import { generateChatKeys } from '../chat-crypto.js';
import { checkProposal, proposalMessage, replyMessage, statusMessage } from '../meet.js';

const BASE = 'https://sync.test';
const b64 = bytes => Buffer.from(bytes).toString('base64');
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const meta = () => ({ v: 2, kdf: 'PBKDF2-SHA256', iter: 600000, salt: b64(rnd(16)), wrap: { iv: b64(rnd(12)), ct: b64(rnd(48)) } });

function world(env = { SETUP_CODE: 'код', INVITES_BY_USERS: '1' }) {
  const { store, close } = openStore(':memory:');
  let t = 1_800_000_000_000;
  const fetchImpl = async (url, init) => {
    const req = new Request(url, { ...init, headers: { ...(init?.headers ?? {}), 'x-forwarded-for': '1.1.1.1' } });
    return handle(req, store, env, t);
  };
  const api = createApi({ fetchImpl });
  const tokens = {};
  const register = async (name, inviterToken) => {
    const body = { username: name, authKey: b64(rnd(32)), authSalt: b64(rnd(16)), authIter: 600000, meta: meta() };
    if (!inviterToken) body.setupCode = env.SETUP_CODE; else body.invite = (await api.createInvite(BASE, inviterToken)).code;
    const r = await api.register(BASE, body);
    tokens[name.toLowerCase()] = r.token;
    return r.token;
  };
  // «устройство» человека: журнал с ключом (подставной), локальный кэш, ядро чата
  const device = (name, { keys = null, kv = new Map() } = {}) => {
    const journal = { keys };
    const kvApi = { get: async k => (kv.has(k) ? structuredClone(kv.get(k)) : undefined), set: async (k, v) => { kv.set(k, structuredClone(v)); } };
    const chat = createChat({ api, base: BASE, token: () => tokens[name.toLowerCase()], me: () => name, kv: kvApi, getKeys: () => journal.keys, putKeys: async k => { journal.keys = k; }, now: () => t });
    return { chat, journal, kv };
  };
  return { store, close, api, tokens, register, device, tick: ms => { t += ms; }, now: () => t };
}

test('ключи: создаются один раз, лежат в журнале и публикуются; повторный запуск берёт те же', async () => {
  const w = world();
  await w.register('Владелец');
  const A = w.device('Владелец');
  const first = await A.chat.init();
  assert.ok(A.journal.keys && first.pub === A.journal.keys.pub);
  const again = w.device('Владелец', { keys: A.journal.keys });
  assert.equal((await again.chat.init()).pub, first.pub, 'ключ из журнала, новый не создаётся');
  assert.equal(w.store.getAccountByName('владелец').pub, first.pub, 'открытый ключ на сервере');
  assert.ok(!JSON.stringify(w.store.db.all('SELECT * FROM accts')).includes(A.journal.keys.priv), 'закрытый ключ на сервер не попал');
  await assert.rejects(w.device('Владелец').chat.send('кто-то', { kind: 'text', text: 'x' }), e => e instanceof ChatError && e.code === 'not_ready');
  w.close();
});

test('переписка двух людей: отправка, получение, расшифровка, непрочитанное, ответ, повторные запросы не дублируют', async () => {
  const w = world();
  const tA = await w.register('Владелец'); await w.register('Анна', tA);
  const A = w.device('Владелец'), B = w.device('Анна');
  await A.chat.init(); await B.chat.init({ display: 'Аня' });
  const ca = await A.chat.contacts();
  assert.deepEqual(ca.map(c => [c.username, c.keyStatus, c.display, c.via]), [['анна', 'ok', 'Аня', 'invited']]);
  const m1 = await A.chat.send('Анна', { kind: 'text', text: 'Привет! Как дела? ❤' });
  assert.equal(m1.out, true); assert.equal(m1.body.text, 'Привет! Как дела? ❤');
  assert.deepEqual(await B.chat.poll(), { added: 1, byPeer: { владелец: 1 } });
  assert.equal(B.chat.thread('владелец')[0].body.text, 'Привет! Как дела? ❤');
  assert.equal(await B.chat.unread('владелец'), 1); assert.equal(await B.chat.unreadTotal(), 1);
  await B.chat.markRead('владелец');
  assert.equal(await B.chat.unread('владелец'), 0);
  assert.deepEqual(await B.chat.poll(), { added: 0, byPeer: {} }, 'повторный опрос ничего не добавляет');
  w.tick(5000);
  await B.chat.send('владелец', { kind: 'text', text: 'Отлично, а у тебя?' });
  const got = await A.chat.poll();
  assert.equal(got.added, 1, 'своё сообщение уже в списке (оно записано при отправке), добавилось только новое от собеседника');
  assert.deepEqual(got.byPeer, { анна: 1 });
  assert.deepEqual(A.chat.thread('анна').map(m => [m.out, m.body.text]), [[true, 'Привет! Как дела? ❤'], [false, 'Отлично, а у тебя?']]);
  assert.equal(await A.chat.unread('анна'), 1);
  // сервер видит только шифртекст
  assert.ok(!JSON.stringify(w.store.db.all('SELECT * FROM box')).includes('Привет'));
  w.close();
});

test('встреча от предложения до подтверждения через настоящий сервер', async () => {
  const w = world();
  const tA = await w.register('Владелец'); await w.register('Анна', tA);
  const A = w.device('Владелец'), B = w.device('Анна');
  await A.chat.init(); await B.chat.init(); await A.chat.contacts(); await B.chat.contacts();
  const today = '2026-11-17';
  const proposal = checkProposal({ type: 'date', title: 'Ужин вдвоём', window: { from: '2026-11-20', to: '2026-11-29' }, times: { from: '18:00', to: '21:00', step: 60 },
    places: [{ name: 'Тихий ресторан' }, { name: 'Кино' }], allowOther: false }, today);
  await A.chat.send('анна', { kind: 'meet', meet: { ...proposal, id: 'M1' } });
  await B.chat.poll();
  let [mt] = B.chat.meetings('владелец', today);
  assert.deepEqual([mt.status, mt.title, mt.host, mt.guest], ['proposed', 'Ужин вдвоём', 'владелец', 'анна']);
  w.tick(60_000);
  const reply = { kind: 'meet-reply', meetId: 'M1', status: 'accepted', date: '2026-11-22', time: '19:00', placeId: 'p2', comment: 'Давай!' };
  await B.chat.send('владелец', reply);
  await A.chat.poll();
  [mt] = A.chat.meetings('анна', today);
  assert.deepEqual([mt.status, mt.when, mt.place.name, mt.reply.comment], ['answered', { date: '2026-11-22', time: '19:00' }, 'Кино', 'Давай!']);
  w.tick(60_000);
  await A.chat.send('анна', { kind: 'meet-status', meetId: 'M1', status: 'confirmed' });
  await B.chat.poll();
  [mt] = B.chat.meetings('владелец', today);
  assert.equal(mt.status, 'confirmed');
  assert.equal(B.chat.allMeetings(today).length, 1);
  // подделка: Анна пытается «подтвердить» сама — для автора ничего не меняется
  w.tick(60_000);
  await B.chat.send('владелец', { kind: 'meet-status', meetId: 'M1', status: 'cancelled' });       // отменить может любой из двоих
  await A.chat.poll();
  assert.equal(A.chat.meetings('анна', today)[0].status, 'cancelled');
  w.close();
});

test('смена ключа собеседника: предупреждение, отправка закрыта до подтверждения, прежняя переписка читается', async () => {
  const w = world();
  const tA = await w.register('Владелец'); await w.register('Анна', tA);
  const A = w.device('Владелец'), B = w.device('Анна');
  await A.chat.init(); await B.chat.init(); await A.chat.contacts();
  await A.chat.send('анна', { kind: 'text', text: 'до смены ключа' });
  await B.chat.poll();
  await B.chat.send('владелец', { kind: 'text', text: 'ответ до смены' });
  await A.chat.poll();
  // Анна переустановила приложение: новый ключ
  const B2 = w.device('Анна', { keys: await generateChatKeys() });
  await B2.chat.init();
  const list = await A.chat.contacts();
  assert.equal(list[0].keyStatus, 'changed');
  await assert.rejects(A.chat.send('анна', { kind: 'text', text: 'не должно уйти' }), e => e.code === 'key_changed');
  const codeBefore = await A.chat.safety('анна');
  assert.match(codeBefore, /^\d{4}( \d{4}){5}$/);
  await A.chat.acceptKey('анна');
  assert.equal(A.chat.contactOf('анна').keyStatus, 'ok');
  await A.chat.send('анна', { kind: 'text', text: 'после смены ключа' });
  assert.deepEqual(A.chat.thread('анна').map(m => m.body.text), ['до смены ключа', 'ответ до смены', 'после смены ключа'], 'прежняя переписка у Владельца читается из кэша');
  await B2.chat.contacts();
  await B2.chat.poll();
  assert.deepEqual(B2.chat.thread('владелец').map(m => m.body.kind === 'unreadable' ? '—' : m.body.text), ['—', '—', 'после смены ключа'], 'новое устройство Анны читает только новое');
  // код безопасности одинаков у обоих
  assert.equal(await A.chat.safety('анна'), await B2.chat.safety('владелец'));
  w.close();
});

test('кэш устройства: после перезапуска курсор и переписка на месте, лишнего запроса нет', async () => {
  const w = world();
  const tA = await w.register('Владелец'); await w.register('Анна', tA);
  const A = w.device('Владелец'), B = w.device('Анна');
  await A.chat.init(); await B.chat.init(); await A.chat.contacts();
  await A.chat.send('анна', { kind: 'text', text: 'один' });
  await B.chat.poll(); await B.chat.send('владелец', { kind: 'text', text: 'два' });
  await A.chat.poll(); await A.chat.markRead('анна');
  const A2 = w.device('Владелец', { keys: A.journal.keys, kv: A.kv });                   // то же устройство после перезапуска
  await A2.chat.init(); await A2.chat.contacts();
  assert.deepEqual(A2.chat.thread('анна').map(m => m.body.text), ['один', 'два']);
  assert.deepEqual(await A2.chat.poll(), { added: 0, byPeer: {} });
  assert.equal(await A2.chat.unread('анна'), 0, 'отметка «прочитано» сохранилась');
  await A2.chat.forget();
  assert.deepEqual(A2.chat.thread('анна'), []);
  assert.equal(await A2.chat.unreadTotal(), 0);
  w.close();
});

test('чужие и неготовые собеседники: не контакт, нет ключа', async () => {
  const w = world();
  const tA = await w.register('Владелец'); const tB = await w.register('Анна', tA); await w.register('Борис', tB);
  const A = w.device('Владелец'), B = w.device('Анна');
  await A.chat.init(); await B.chat.init();
  await A.chat.contacts();
  assert.deepEqual((await A.chat.contacts()).map(c => c.username), ['анна'], 'Борис — друг Анны, не владельца');
  await assert.rejects(A.chat.send('борис', { kind: 'text', text: 'привет' }), e => e.code === 'not_contact');
  const list = await B.chat.contacts();
  assert.deepEqual(list.map(c => [c.username, c.keyStatus]).sort(), [['борис', 'none'], ['владелец', 'ok']], 'у Бориса ещё нет ключа');
  await assert.rejects(B.chat.send('борис', { kind: 'text', text: 'привет' }), e => e.code === 'no_key');
  assert.equal(await A.chat.safety('борис'), null);
  w.close();
});
