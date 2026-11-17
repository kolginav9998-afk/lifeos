// «Пригласить человека» и «Люди на сервере» (для владельца). Дочерний блок экрана «Чат».
import { el, fill, icon, toast, announce, setBusy } from './ui.js';

const SITE = 'https://kolginav9998-afk.github.io/lifeos/';
const siteBase = () => (/^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[::1\])/.test(location.hostname) ? location.origin + location.pathname : SITE);
const STATE = { active: 'действует', used: 'использовано', expired: 'просрочено', revoked: 'отозвано' };
const fmtBytes = n => (n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

// ui: { avatar, hhmm, dayLabel } — общие помощники приходят от экрана «Чат» (дочерние блоки друг друга не подключают).
export function createInvitePage({ api, base, token, onBack, ui }) {
  const { avatar, hhmm, dayLabel } = ui;
  const ago = ts => (ts ? `${dayLabel(ts)}, ${hhmm(ts)}` : 'ещё не заходил(а)');
  const root = el('div', { id: 'chat-invite', class: 'ch-page' });
  const code = el('div', { id: 'chat-inv-fresh', class: 'ch-fresh', hidden: true });
  const list = el('div', { id: 'chat-inv-list' }), people = el('div', { id: 'chat-people' });
  const msg = el('p', { id: 'chat-inv-msg', class: 'muted', role: 'status' });
  const make = el('button', { type: 'button', id: 'chat-inv-new', class: 'primary', textContent: 'Создать приглашение', onclick: () => create() });
  root.append(el('header', { class: 'ch-head' }, el('button', { type: 'button', id: 'chat-inv-back', class: 'icon-btn', 'aria-label': 'К списку переписок', onclick: onBack }, icon('chevL', 22)), el('strong', { textContent: 'Пригласить человека' })),
    el('p', { class: 'muted', textContent: 'Приглашение одноразовое и действует 7 суток. Человек создаст свой аккаунт на твоём сервере; вы увидите друг друга в чате. Других людей на сервере он не увидит.' }), make, msg, code,
    el('h3', { textContent: 'Мои приглашения' }), list, people);

  async function create() {
    setBusy(make, true, 'Создаю…');
    try {
      const r = await api.createInvite(base(), token());
      const link = `${siteBase()}?invite=${r.code}`;
      const share = typeof navigator.share === 'function' ? el('button', { type: 'button', id: 'chat-inv-share', class: 'chip', textContent: 'Поделиться', onclick: () => navigator.share({ title: 'Приглашение', text: `Приглашаю тебя в приложение. Код: ${r.code}`, url: link }).catch(() => {}) }) : null;
      fill(code, el('p', { textContent: 'Код приглашения (виден один раз, пока не закроешь страницу):' }), el('strong', { id: 'chat-inv-code', class: 'ch-code', textContent: r.code }), el('p', { class: 'muted', textContent: 'Ссылка для человека:' }), el('p', { id: 'chat-inv-link', class: 'ch-link', textContent: link }),
        el('div', { class: 'row wrap' }, el('button', { type: 'button', id: 'chat-inv-copy', class: 'chip', textContent: 'Скопировать ссылку', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована'); } catch { toast('Не удалось скопировать: выдели ссылку и скопируй вручную'); } } }), share));
      code.hidden = false; announce(`Приглашение создано: ${r.code}`);
      await load();
    } catch (e) { msg.textContent = e.status === 404 ? 'Приглашать людей может владелец сервера.' : e.status === 403 || e.status === 429 ? ({ accounts_limit: 'На сервере уже максимальное число аккаунтов.', too_many_invites: 'Уже есть пять действующих приглашений. Отзови ненужное.' }[e.code] ?? e.message) : 'Не получилось: проверь связь с сервером.'; announce(msg.textContent, { assertive: true }); }
    finally { setBusy(make, false); }
  }
  async function load() {
    try {
      const { invites } = await api.listInvites(base(), token());
      fill(list, invites.length ? invites.map(i => el('div', { class: 'ch-row' }, el('span', { textContent: `${dayLabel(i.createdAt)}: ${STATE[i.state]}${i.usedBy ? ` (${i.usedBy})` : ''}` }),
        i.state === 'active' ? el('button', { type: 'button', class: 'chip danger', textContent: 'Отозвать', onclick: async () => { await api.revokeInvite(base(), token(), i.id); toast('Приглашение отозвано'); load(); } }) : null)) : [el('p', { class: 'muted', textContent: 'Приглашений пока нет.' })]);
      make.hidden = false;
    } catch (e) { make.hidden = e.status === 404; fill(list, el('p', { class: 'muted', textContent: e.status === 404 ? 'Приглашать людей может владелец сервера.' : 'Не удалось загрузить приглашения.' })); }
    try {
      const { accounts, max } = await api.adminAccounts(base(), token());
      fill(people, el('h3', { textContent: `Люди на сервере (до ${max})` }), el('p', { class: 'muted', textContent: 'Ты видишь только служебные сведения: логин, когда заходил(а) и сколько места занято. Содержимое записей и переписки недоступно никому, кроме самого человека.' }),
        ...accounts.map(a => el('div', { class: 'ch-row' }, avatar(a.display || a.username), el('div', { class: 'ch-who' }, el('strong', { textContent: `${a.display || a.username}${a.role === 'admin' ? ' (владелец)' : ''}${a.disabled ? ' — отключён(а)' : ''}` }), el('span', { class: 'muted', textContent: `@${a.username} · был(а): ${ago(a.lastSeenAt)} · занято ${fmtBytes(a.usedBytes)}${a.invitedBy ? ` · пригласил(а): ${a.invitedBy}` : ''}` })),
          a.role === 'admin' ? null : el('div', { class: 'row wrap' },
            el('button', { type: 'button', class: 'chip', textContent: a.disabled ? 'Включить' : 'Отключить', onclick: async () => { await api.adminSetDisabled(base(), token(), a.username, !a.disabled); load(); } }),
            el('button', { type: 'button', class: 'chip danger', textContent: 'Удалить', onclick: async () => { if (!confirm(`Удалить аккаунт «${a.username}» вместе со всеми его данными и перепиской? Это нельзя отменить.`)) return; await api.adminDelete(base(), token(), a.username); toast('Аккаунт удалён'); load(); } })))));
    } catch { fill(people); }
  }
  return { root, load, hideCode() { code.hidden = true; fill(code); } };
}
