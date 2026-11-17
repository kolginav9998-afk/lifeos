// Переписка с одним человеком: шапка, сообщения (пузыри, карточки встреч, служебные строки), поле ввода. Дочерний блок экрана «Чат».
// Страница строится один раз при открытии переписки; при опросе перерисовывается только список сообщений, поле ввода и черновик остаются.
import { el, fill, icon, toast, announce, setBusy } from './ui.js';
import { COLORS } from './profile.js';

export const hhmm = ts => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export const dayLabel = ts => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const HEX = Object.values(COLORS);
export const colorOf = name => HEX[[...String(name)].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7) % HEX.length];
export const avatar = (name, cls = '') => el('span', { class: `ch-av ${cls}`.trim(), 'aria-hidden': 'true', style: `--av:${colorOf(name)}`, textContent: [...String(name)][0]?.toUpperCase() ?? '?' });
const REPLY_WORD = { accepted: 'выбрал(а) день, время и место', counter: 'предлагает своё', declined: 'не получится' };

export function createThread({ chat, contact, getMeetings, card, onBack, onWizard, onSafety, onSent }) {
  const peer = contact.username, name = contact.display || contact.username;
  const root = el('div', { id: 'chat-thread', class: 'ch-page' });
  const head = el('header', { class: 'ch-head' },
    el('button', { type: 'button', id: 'chat-back', class: 'icon-btn', 'aria-label': 'К списку переписок', onclick: onBack }, icon('chevL', 22)),
    avatar(name), el('div', { class: 'ch-who' }, el('strong', { id: 'chat-peer-name', textContent: name }), el('span', { class: 'muted', textContent: `@${peer}` })),
    el('button', { type: 'button', id: 'chat-safety', class: 'chip', onclick: onSafety }, icon('shield', 16), ' Код безопасности'));
  const banner = el('div', { id: 'chat-banner' });
  const log = el('div', { id: 'chat-log', class: 'ch-log', role: 'log', 'aria-live': 'polite', 'aria-label': `Переписка с ${name}`, tabIndex: 0 });
  const input = el('textarea', { id: 'chat-input', rows: 2, maxLength: 2000, placeholder: 'Напиши сообщение', 'aria-label': 'Сообщение' });
  const send = el('button', { type: 'submit', id: 'chat-send', class: 'primary', 'aria-label': 'Отправить' }, icon('share', 20), ' Отправить');
  const meet = el('button', { type: 'button', id: 'chat-meet', class: 'chip', onclick: () => onWizard(peer) }, icon('heart', 16), ' Предложить встречу');
  const form = el('form', { id: 'chat-form', class: 'ch-form' }, input, el('div', { class: 'row wrap' }, send, meet));
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
  form.onsubmit = async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    setBusy(send, true, 'Отправляю…');
    try { await chat.send(peer, { kind: 'text', text }); input.value = ''; await onSent(); render(true); }
    catch (x) { toast(x.message); announce(x.message, { assertive: true }); }
    finally { setBusy(send, false); }
  };
  root.append(head, banner, log, form);

  function line(m, text) { return el('p', { class: 'ch-sys' }, el('span', { textContent: text }), el('time', { class: 'muted', textContent: ` ${hhmm(m.ts)}` })); }
  function render(forceBottom = false) {
    const c = chat.contactOf(peer) ?? contact;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const meetings = new Map(getMeetings(peer).map(x => [x.id, x]));
    const nodes = [];
    let lastDay = '';
    for (const m of chat.thread(peer)) {
      const day = dayLabel(m.ts);
      if (day !== lastDay) { nodes.push(el('p', { class: 'ch-day-sep', textContent: day })); lastDay = day; }
      const b = m.body;
      if (b.kind === 'text') nodes.push(el('div', { class: `ch-msg ${m.out ? 'out' : 'in'}` }, el('p', { textContent: b.text }), el('time', { class: 'muted', textContent: `${m.out ? 'Ты' : name}, ${hhmm(m.ts)}` })));
      else if (b.kind === 'meet') { const mt = meetings.get(String(b.meet?.id)); if (mt) nodes.push(el('div', { class: 'ch-card' }, card(mt))); }
      else if (b.kind === 'meet-reply') nodes.push(line(m, `${m.out ? 'Ты' : name}: ${REPLY_WORD[b.status] ?? 'ответил(а)'}`));
      else if (b.kind === 'meet-status') nodes.push(line(m, b.status === 'confirmed' ? 'Встреча подтверждена' : 'Встреча отменена'));
      else if (b.kind === 'unreadable') nodes.push(el('p', { class: 'ch-sys', textContent: 'Сообщение не удалось прочитать: оно отправлено со старым ключом.' }));
    }
    fill(log, nodes.length ? nodes : [el('p', { class: 'muted', textContent: 'Сообщений пока нет. Напиши первым.' })]);
    const warn = [];
    if (!c.pub) warn.push(el('p', { class: 'warn', textContent: `${name} ещё не открывал(а) чат. Писать можно, когда человек зайдёт в приложение.` }));
    if (c.keyStatus === 'changed') warn.push(el('div', { class: 'warn' }, el('p', { textContent: `У ${name} сменился код безопасности. Это бывает после переустановки приложения, но так может выглядеть и подмена. Сверь код вживую или по телефону и подтверди.` }), el('button', { type: 'button', id: 'chat-key-open', class: 'chip', textContent: 'Сверить код', onclick: onSafety })));
    fill(banner, warn);
    const blocked = !c.pub || c.keyStatus === 'changed';
    input.disabled = send.disabled = meet.disabled = blocked;
    if (forceBottom || nearBottom) log.scrollTop = log.scrollHeight;
  }
  return { root, render, focus: () => input.focus(), peer };
}
