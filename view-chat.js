// Экран «Чат и встречи» (R4.3): список собеседников, переписка, предложение встречи и ответ на неё, «Мои встречи», приглашение человека.
// Сквозное шифрование и вся логика лежат в chat-core.js, chat-crypto.js, meet.js; склейка с приложением — app-chat.js. Здесь только показ.
import { el, fill, icon, emptyState, toast, announce } from './ui.js';
import * as store from './store.js';
import { api, account } from './app-sync.js';
import * as chatApp from './app-chat.js';
import { todayStr } from './events.js';
import { newMessageId, safetyCode } from './chat-crypto.js';
import { meetingRecord } from './meet.js';
import { createThread, avatar, hhmm, dayLabel } from './view-chat-thread.js';
import { createInvitePage } from './view-chat-invite.js';
import { meetingCard, createWizard, createReplySheet, meetingsPage, exportIcs } from './view-chat-meet.js';

const preview = m => (!m ? 'Сообщений пока нет' : ({ text: () => `${m.out ? 'Ты: ' : ''}${m.body.text}`, meet: () => `Встреча: ${m.body.meet?.title ?? ''}`, 'meet-reply': () => 'Ответ на встречу', 'meet-status': () => (m.body.status === 'confirmed' ? 'Встреча подтверждена' : 'Встреча отменена'), unreadable: () => 'Не удалось прочитать' }[m.body.kind] ?? (() => 'Сообщение'))());

export function createChatView() {
  const root = el('section', { id: 'view-chat', class: 'view' });
  const me = () => account.info()?.username ?? '';
  let page = 'list', peer = '', thread = null, invite = null, status = 'loading', problem = '', chat = null;
  const unreadBy = new Map();
  const listBox = el('div', { id: 'chat-list', class: 'ch-page' }), threadBox = el('div', { class: 'ch-page', hidden: true }), inviteBox = el('div', { class: 'ch-page', hidden: true }), meetsBox = el('div', { id: 'chat-meets', class: 'ch-page', hidden: true });
  const ui = { avatar, hhmm, dayLabel };

  // ---------- действия со встречами ----------
  const afterSend = async () => { try { await chatApp.refresh(); } catch { /* ошибка показана на экране */ } render(); };
  const chatOrThrow = () => chatApp.getChat();
  const wizard = createWizard({ onSend: async (to, proposal) => { const c = await chatOrThrow(); await c.send(to, { kind: 'meet', meet: { ...proposal, id: newMessageId() } }); await afterSend(); } });
  const reply = createReplySheet({ onReply: async (mt, r) => { const c = await chatOrThrow(); await c.send(mt.host === me() ? mt.guest : mt.host, { kind: 'meet-reply', meetId: mt.id, ...r }); await afterSend(); } });
  const sendStatus = async (mt, st) => { const c = await chatOrThrow(); await c.send(mt.host === me() ? mt.guest : mt.host, { kind: 'meet-status', meetId: mt.id, status: st }); await afterSend(); };
  const actions = {
    reply: mt => reply.open(mt),
    confirm: mt => sendStatus(mt, 'confirmed').then(() => announce('Встреча подтверждена')).catch(e => toast(e.message)),
    cancel: mt => { if (confirm(mt.status === 'confirmed' ? 'Отменить подтверждённую встречу? Собеседник увидит отмену.' : 'Отозвать это предложение?')) sendStatus(mt, 'cancelled').then(() => announce('Встреча отменена')).catch(e => toast(e.message)); },
    ics: mt => exportIcs(mt, me()),
  };
  const card = mt => meetingCard(mt, me(), actions);
  root.append(listBox, threadBox, inviteBox, meetsBox, wizard.root, reply.root);

  // ---------- записи о встречах в журнале (видны в «Профиле», на «Сегодня» и в календаре) ----------
  async function syncMeetingRecords(chat) {
    for (const mt of chat.allMeetings(todayStr())) {
      const rec = meetingRecord(mt, me()), old = store.state.events.find(e => e.id === rec.id);
      const same = old && old.payload.status === rec.payload.status && old.payload.when?.date === rec.payload.when?.date && old.payload.when?.time === rec.payload.when?.time && old.payload.place === rec.payload.place;
      if (!same) await store.save(rec).catch(e => console.error(e));
    }
  }

  // ---------- данные ----------
  async function refreshUnread(chat) { for (const c of chat.list()) unreadBy.set(c.username, await chat.unread(c.username)); }
  async function load() {
    status = 'loading'; render();
    try { await chatApp.refresh(); chat = await chatOrThrow(); await refreshUnread(chat); await syncMeetingRecords(chat); status = 'ready'; problem = ''; }
    catch (e) { status = 'error'; problem = e.message || 'Нет связи с сервером'; }
    render();
  }
  chatApp.onChat(async () => {
    if (root.hidden) return;
    try { chat = await chatOrThrow(); await refreshUnread(chat); await syncMeetingRecords(chat); status = 'ready'; problem = ''; } catch (e) { status = 'error'; problem = e.message; }
    render();
  });
  new MutationObserver(() => chatApp.setFast(!root.hidden)).observe(root, { attributes: true, attributeFilter: ['hidden'] });

  // ---------- страницы ----------
  function showPage(p) { page = p; listBox.hidden = p !== 'list'; threadBox.hidden = p !== 'thread'; inviteBox.hidden = p !== 'invite'; meetsBox.hidden = p !== 'meets'; }
  async function openPeer(name) {
    const chat = await chatOrThrow(), c = chat.contactOf(name);
    if (!c) return;
    peer = c.username;
    thread = createThread({ chat, contact: c, getMeetings: p => chat.meetings(p, todayStr()), card, onBack: () => { thread = null; showPage('list'); load(); }, onWizard: p => wizard.open(p), onSafety: () => openSafety(c), onSent: async () => { await refreshUnread(chat); } });
    fill(threadBox, thread.root);
    showPage('thread'); thread.render(true);
    await chat.markRead(peer); unreadBy.set(peer, 0); await chatApp.refresh().catch(() => {});
    document.getElementById('chat-input')?.focus();
  }
  async function openSafety(c) {
    const chat = await chatOrThrow(), code = await chat.safety(c.username);
    const host = el('div', { id: 'chat-safe', class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'chat-safe-title', tabIndex: -1 });
    const close = el('button', { type: 'button', id: 'chat-safe-close', textContent: 'Закрыть', onclick: () => host.remove() });
    const changed = chat.contactOf(c.username)?.keyStatus === 'changed';
    host.append(el('div', { class: 'sess-top' }, el('h3', { id: 'chat-safe-title', tabIndex: -1, textContent: `Код безопасности: ${c.display || c.username}` })),
      el('p', { class: 'muted', textContent: 'Если у вас на экранах одинаковые цифры, переписку никто не подменил. Сверьте код при встрече или по телефону: его никто, кроме вас двоих, не видит.' }),
      el('p', { id: 'chat-safe-code', class: 'ch-code', textContent: code ?? 'Код появится, когда у человека будет ключ чата.' }),
      changed ? el('div', { class: 'warn' }, el('p', { textContent: 'У собеседника ключ изменился. Пока не подтвердишь, писать ему нельзя.' }), el('button', { type: 'button', id: 'chat-safe-accept', class: 'primary', textContent: 'Код совпал, подтвердить', onclick: async () => { await chat.acceptKey(c.username); host.remove(); toast('Новый ключ подтверждён'); thread?.render(); } })) : null,
      el('div', { class: 'row' }, close));
    root.append(host);
    document.getElementById('chat-safe-title')?.focus();
  }
  function openInvite() {
    invite ??= createInvitePage({ api, base: () => account.info().server, token: () => account.token(), onBack: () => { showPage('list'); }, ui });
    fill(inviteBox, invite.root); invite.hideCode(); showPage('invite'); invite.load();
  }
  async function openMeets() {
    const chat = await chatOrThrow();
    fill(meetsBox, el('header', { class: 'ch-head' }, el('button', { type: 'button', id: 'chat-meets-back', class: 'icon-btn', 'aria-label': 'К списку переписок', onclick: () => showPage('list') }, icon('chevL', 22)), el('strong', { textContent: 'Мои встречи' })), ...meetingsPage(chat.allMeetings(todayStr()), me(), actions));
    showPage('meets');
  }

  function renderList() {
    const people = chat ? chat.list() : [];
    const body = [];
    body.push(el('div', { class: 'row wrap ch-top' },
      el('button', { type: 'button', id: 'chat-open-invite', class: 'chip', onclick: () => openInvite() }, icon('plus', 16), ' Пригласить человека'),
      el('button', { type: 'button', id: 'chat-open-meets', class: 'chip', onclick: () => openMeets().catch(e => toast(e.message)) }, icon('calendar', 16), ' Мои встречи')));
    if (status === 'loading' && !people.length) body.push(el('p', { id: 'chat-state', class: 'muted', role: 'status', textContent: 'Загружаю переписку…' }));
    if (status === 'error') body.push(el('p', { id: 'chat-state', class: 'warn', role: 'status', textContent: `${problem || 'Не получилось обновить'}. Переписка, которая уже загружена, доступна.` }), el('button', { type: 'button', id: 'chat-retry', class: 'chip', textContent: 'Повторить', onclick: () => load() }));
    if (status !== 'loading' && !people.length && !problem) body.push(emptyState({ art: 'users', id: 'chat-empty', title: 'Пока ни с кем не переписываешься', text: 'Пригласи человека: он создаст свой аккаунт, и вы сможете переписываться и назначать встречи. Всё шифруется, сервер не читает сообщения.', action: { label: 'Пригласить человека', icon: 'plus', onClick: () => openInvite() } }));
    if (people.length) body.push(el('ul', { class: 'ch-list', 'aria-label': 'Переписки' }, ...people.map(c => {
      const last = chat.thread(c.username).at(-1), n = unreadBy.get(c.username) ?? 0, name = c.display || c.username;
      return el('li', {}, el('button', { type: 'button', class: 'ch-contact', dataset: { peer: c.username }, onclick: () => openPeer(c.username).catch(e => toast(e.message)) },
        avatar(name), el('span', { class: 'ch-who' }, el('strong', { textContent: name }), el('span', { class: 'muted ch-prev', textContent: c.pub ? preview(last) : 'ещё не открывал(а) чат' })),
        el('span', { class: 'ch-meta' }, last ? el('time', { class: 'muted', textContent: hhmm(last.ts) }) : null, n ? el('span', { class: 'ch-badge', textContent: String(n) }) : null, n ? el('span', { class: 'sr-only', textContent: ' непрочитанных' }) : null)));
    })));
    fill(listBox, body);
  }
  function render() {
    if (!chatApp.available()) { fill(listBox, emptyState({ art: 'users', title: 'Чат доступен после входа в аккаунт', text: 'Войди в аккаунт («Меню» → «Аккаунт»): чат работает через твой сервер.' })); return; }
    renderList();
    if (page === 'thread' && thread) thread.render();
  }

  return { root, update() { if (!root.hidden) render(); }, show() { showPage(page === 'thread' && thread ? 'thread' : page === 'invite' ? 'invite' : page === 'meets' ? 'meets' : 'list'); chatApp.startPolling(true); load(); } };
}
