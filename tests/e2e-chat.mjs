// Экран «Чат и встречи» в настоящем браузере против настоящего сервера: приглашение, переписка, мастер встречи, ответ, подтверждение, код безопасности.
// «Анна» — второй человек: её ядро чата работает в Node против того же сервера.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, tab, until, appReady, waitText, settleTheme, root } from './helpers.mjs';
import { createServer } from '../server/node/server.js';
import { createApi } from '../api.js';
import { createChat } from '../chat-core.js';
import { checkProposal, replyMessage } from '../meet.js';

const PW = 'длинная-надёжная-фраза';
const server = createServer({ env: { ALLOWED_ORIGINS: '*', SETUP_CODE: 'код-123' } });
await new Promise(r => server.server.listen(0, r));
const SERVER = `http://localhost:${server.server.address().port}`;
const t = await launch({ buildEnv: { LIFEOS_REQUIRE_ACCOUNT: '1', LIFEOS_SERVER_URL: SERVER }, ctxOptions: { bypassCSP: true } });
const A = t.page;
A.on('dialog', d => d.accept());
const b64 = n => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64');
// доступность (axe) на каждом состоянии экрана: серьёзных и критических нарушений и ошибок порядка заголовков, имён и подписей быть не должно
const AXE = fs.readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const ZERO = new Set(['heading-order', 'label', 'select-name', 'button-name', 'link-name', 'aria-required-parent', 'aria-required-children', 'aria-allowed-role', 'aria-allowed-attr', 'duplicate-id', 'duplicate-id-aria', 'list', 'listitem', 'nested-interactive']);
const found = [];
async function axeNow(label) {
  if (!(await A.evaluate(() => typeof window.axe !== 'undefined'))) await A.addScriptTag({ content: AXE });
  await A.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80)))));
  const run = () => A.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target.join(' ') + ' :: ' + n.html.replace(/\s+/g, ' ').slice(0, 90)) })));
  let res = await run();
  if (res.some(v => v.id === 'color-contrast')) { await A.waitForTimeout(400); const again = await run(); res = res.filter(v => v.id !== 'color-contrast').concat(again.filter(v => v.id === 'color-contrast')); }
  for (const v of res) if (v.impact === 'serious' || v.impact === 'critical' || ZERO.has(v.id)) found.push(`${label}: ${v.id} [${v.impact}] ${v.nodes.slice(0, 2).join(' | ')}`);
}

// ===== владелец входит =====
await A.goto(t.url);
await until(A, () => document.getElementById('gate-register'), null, 30000);
await A.fill('#gate-user', 'Владелец'); await A.fill('#gate-pass', PW); await A.fill('#gate-pass2', PW); await A.fill('#gate-setup', 'код-123');
await A.click('#gate-register');
await until(A, () => document.getElementById('gate-code'), null, 90000);
await A.check('#gate-code-ok'); await A.click('#gate-code-done');
await appReady(A, 30000);
await until(A, async () => (await import('./app-sync.js')).status.lastSyncAt > 0, null, 30000);

// ===== экран «Чат»: пусто, есть приглашение =====
await tab(A, 'chat');
assert.equal(await A.textContent('#title'), 'Чат и встречи');
await until(A, () => document.getElementById('chat-empty'), null, 20000);
await axeNow('чат: пусто');
await A.click('#chat-open-invite');
await until(A, () => document.getElementById('chat-inv-new') && !document.getElementById('chat-inv-new').hidden);
await A.click('#chat-inv-new');
await until(A, () => document.getElementById('chat-inv-code') && /^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/.test(document.getElementById('chat-inv-code').textContent));
const code = await A.textContent('#chat-inv-code');
assert.match(await A.textContent('#chat-inv-link'), new RegExp(`\\?invite=${code}$`));
await axeNow('приглашение');
await until(A, () => document.querySelector('#chat-inv-list .ch-row'));

// ===== Анна регистрируется по приглашению и пишет =====
const api = createApi();
const reg = await api.register(SERVER, { username: 'Анна', authKey: b64(32), authSalt: b64(16), authIter: 600000, invite: code, meta: { v: 2, kdf: 'PBKDF2-SHA256', iter: 600000, salt: b64(16), wrap: { iv: b64(12), ct: b64(48) } } });
const kv = new Map(), journal = { keys: null };
const anna = createChat({ api, base: SERVER, token: () => reg.token, me: () => 'Анна', getKeys: () => journal.keys, putKeys: async k => { journal.keys = k; }, kv: { get: async k => kv.get(k), set: async (k, v) => { kv.set(k, v); } } });
await anna.init({ display: 'Аня' }); await anna.contacts();
await anna.send('владелец', { kind: 'text', text: 'Привет! Это Аня ❤' });

await A.click('#chat-inv-back');
await A.click('#chat-retry').catch(() => {});
await until(A, () => document.querySelector('.ch-contact[data-peer="анна"] .ch-badge'), null, 40000);                   // непрочитанное видно
assert.equal(await A.getAttribute('#tabs [data-tab="today"]', 'data-badge'), '1', 'число на вкладке «Сегодня»');
await axeNow('чат: список с непрочитанным');
await A.click('.ch-contact[data-peer="анна"]');
await waitText(A, '#chat-log', /Привет! Это Аня/);
await axeNow('переписка');
assert.equal(await A.textContent('#chat-peer-name'), 'Аня');
// ответ владельца
await A.fill('#chat-input', 'Привет, Аня! Давай увидимся?'); await A.click('#chat-send');
await waitText(A, '#chat-log', /Давай увидимся/);
await anna.poll();
assert.equal(anna.thread('владелец').at(-1).body.text, 'Привет, Аня! Давай увидимся?');

// ===== код безопасности: одинаков у обоих =====
await A.click('#chat-safety');
await until(A, () => /^\d{4}( \d{4}){5}$/.test(document.getElementById('chat-safe-code').textContent));
assert.equal(await A.textContent('#chat-safe-code'), await anna.safety('владелец'));
await axeNow('код безопасности');
await A.click('#chat-safe-close');

// ===== мастер встречи: 4 шага =====
await A.click('#chat-meet');
await until(A, () => !document.getElementById('chat-wiz').hidden);
assert.equal(await A.textContent('#chat-wiz-title'), 'Что за встреча');
await axeNow('мастер: шаг 1');
await A.fill('#chat-wiz-name', 'Ужин вдвоём');
await A.click('#chat-wiz-next');
await until(A, () => document.getElementById('chat-wiz-title').textContent === 'Куда пойти');
await A.click('#chat-wiz-next');
await until(A, () => /хотя бы одно место/.test(document.getElementById('chat-wiz-err').textContent));                // без мест дальше нельзя
await axeNow('мастер: шаг 2 без мест');
await A.fill('#chat-wiz-place', 'Тихий ресторан'); await A.click('#chat-wiz-add');
await A.click('#chat-wiz-body .chip:has-text("+ Кино")');
await A.click('#chat-wiz-next');
await until(A, () => document.getElementById('chat-wiz-title').textContent === 'Когда');
await until(A, () => /Получится вариантов: 6/.test(document.getElementById('chat-wiz-times').textContent));
await axeNow('мастер: шаг 3');
await A.click('#chat-wiz-next');
await until(A, () => document.getElementById('chat-wiz-title').textContent === 'Проверь и отправь');
assert.match(await A.textContent('#chat-wiz-body'), /Ужин вдвоём/);
await axeNow('мастер: шаг 4');
await A.click('#chat-wiz-next');
await until(A, () => document.getElementById('chat-wiz').hidden);
await until(A, () => /Ждёт ответа/.test(document.getElementById('chat-log').textContent));

// ===== Анна получает предложение и отвечает (в Node) =====
await anna.poll();
const [mt0] = anna.meetings('владелец', '2000-01-01');
assert.deepEqual([mt0.title, mt0.status, mt0.proposal.places.map(p => p.name)], ['Ужин вдвоём', 'proposed', ['Тихий ресторан', 'Кино']]);
const day = mt0.proposal.window.from;
await anna.send('владелец', { kind: 'meet-reply', meetId: mt0.id, status: 'accepted', date: day, time: mt0.proposal.times[2], placeId: 'p2', comment: 'С радостью!' });

// ===== владелец видит ответ и подтверждает =====
await until(A, () => /Ответ получен/.test(document.getElementById('chat-log').textContent), null, 40000);
assert.match(await A.textContent('#chat-log'), /Кино/);
await axeNow('переписка: ответ получен');
assert.match(await A.textContent('#chat-log'), /С радостью/);
await A.click('#chat-log button:has-text("Подтвердить встречу")');
await until(A, () => /Подтверждена/.test(document.getElementById('chat-log').textContent));
await anna.poll();
assert.equal(anna.meetings('владелец', '2000-01-01')[0].status, 'confirmed');
// встреча записана в журнал человека
await until(A, async () => (await import('./store.js')).state.events.some(e => e.type === 'meeting' && e.payload.status === 'confirmed' && e.payload.title === 'Ужин вдвоём'), null, 20000);
assert.equal(await A.locator('#chat-log button:has-text("В календарь")').count(), 1);

// ===== «Мои встречи» =====
await A.click('#chat-back');
await A.click('#chat-open-meets');
await until(A, () => /Ужин вдвоём/.test(document.getElementById('chat-meets').textContent));
await axeNow('мои встречи');

// ===== Анна зовёт владельца на деловую встречу: окно ответа в браузере =====
await A.click('#chat-meets-back');
const p2 = checkProposal({ type: 'business', title: 'Обсудить планы', window: { from: mt0.proposal.window.from, to: mt0.proposal.window.to }, times: ['10:00', '11:00'], places: [{ name: 'Офис' }, { name: 'Кафе рядом' }], allowOther: true }, '2000-01-01');
await anna.send('владелец', { kind: 'meet', meet: { ...p2, id: 'BIZ1' } });
await A.click('.ch-contact[data-peer="анна"]');
await until(A, () => /Обсудить планы/.test(document.getElementById('chat-log').textContent), null, 40000);
await A.click('#chat-log button:has-text("Выбрать дату, время и место")');
await until(A, () => !document.getElementById('chat-reply').hidden);
await axeNow('окно ответа');
await A.click('#chat-reply-send');
await until(A, () => /Эта дата вне предложенных|Выбери дату/.test(document.getElementById('chat-reply-err').textContent));        // без выбора ответить нельзя
await A.click(`#chat-reply-body .ch-day[aria-label*="${new Date(`${mt0.proposal.window.from}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}"]`);
await A.click('#chat-reply-body .chip:has-text("11:00")');
await A.click('#chat-reply-body .ch-tile:has-text("Кафе рядом")');
await A.fill('#chat-reply-comment', 'Давай в кафе');
await A.click('#chat-reply-send');
await until(A, () => document.getElementById('chat-reply').hidden);
await anna.poll();
const biz = anna.meetings('владелец', '2000-01-01').find(x => x.id === 'BIZ1');
assert.deepEqual([biz.status, biz.when.time, biz.place.name, biz.reply.comment], ['answered', '11:00', 'Кафе рядом', 'Давай в кафе']);

// ===== тёмная тема на главных состояниях =====
await A.emulateMedia({ colorScheme: 'dark' }); await settleTheme(A, 'dark');
await axeNow('тёмная: переписка');
await A.click('#chat-back'); await axeNow('тёмная: список');
await A.click('#chat-open-invite'); await axeNow('тёмная: приглашение');

// ===== узкий экран и крупный шрифт: ничего не вылезает за край =====
await A.emulateMedia({ colorScheme: 'light' }); await settleTheme(A, 'light');
await A.setViewportSize({ width: 320, height: 640 });
await A.evaluate(() => document.documentElement.style.setProperty('--fs', '1.3'));
const overflow = label => A.evaluate(l => {
  const vw = document.documentElement.clientWidth, bad = [];
  if (document.documentElement.scrollWidth > vw + 1) bad.push(`${l}: страница шире окна (${document.documentElement.scrollWidth} > ${vw})`);
  for (const n of document.querySelectorAll('#view-chat *, #chat-wiz *, #chat-reply *')) {
    if (n.closest('.ch-log, [hidden]') && !n.closest('.ch-msg, .mt-card')) continue;
    const r = n.getBoundingClientRect(), st = getComputedStyle(n);
    if (r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && (r.right > vw + 1 || r.left < -1) && !n.closest('.sr-only')) bad.push(`${l}: ${n.tagName.toLowerCase()}.${String(n.className).slice(0, 30)} выходит за край (${Math.round(r.left)}…${Math.round(r.right)})`);
  }
  return bad.slice(0, 4);
}, label);
const narrow = [];
await until(A, () => document.getElementById('chat-inv-new') && document.getElementById('chat-invite').offsetParent !== null); narrow.push(...await overflow('приглашение'));        // страница приглашения осталась открытой после проверки тёмной темы
await A.click('#chat-inv-back'); narrow.push(...await overflow('список'));
await A.click('.ch-contact[data-peer="анна"]'); await until(A, () => document.getElementById('chat-log')); await A.waitForTimeout(300); narrow.push(...await overflow('переписка'));
await A.click('#chat-meet'); await until(A, () => !document.getElementById('chat-wiz').hidden);
for (let i = 1; i <= 4; i++) { narrow.push(...await overflow(`мастер ${i}`)); if (i === 2) { await A.fill('#chat-wiz-place', 'Очень длинное название места для проверки переноса строк'); await A.click('#chat-wiz-add'); } if (i < 4) await A.click('#chat-wiz-next'); }
await A.click('#chat-wiz-close');
await A.click('#chat-log button:has-text("Изменить мой ответ")').catch(() => {});
if (await A.locator('#chat-reply:not([hidden])').count()) { narrow.push(...await overflow('ответ на встречу')); await A.click('#chat-reply-close'); }
await A.click('#chat-back'); await A.click('#chat-open-meets'); await until(A, () => document.getElementById('chat-meets') && !document.getElementById('chat-meets').hidden); narrow.push(...await overflow('мои встречи'));
assert.deepEqual(narrow, [], 'вёрстка на 320 px и шрифте 130 %');

assert.deepEqual(found, [], 'доступность: нарушения на экране «Чат и встречи»');
assert.deepEqual(t.errors.filter(e => !/net::|Failed to load|favicon/i.test(String(e))), [], 'в консоли без ошибок');
console.log('E2E CHAT OK');
await t.browser.close(); server.close(); process.exit(0);
