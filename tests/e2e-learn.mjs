import assert from 'node:assert/strict';
import { launch, tab, until, ymd } from './helpers.mjs';

const t = await launch({ ctxOptions: { permissions: ['clipboard-read', 'clipboard-write'] } });
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = sel => page.textContent(sel);
const toast = async re => until(page, r => new RegExp(r).test(document.getElementById('toast').textContent), re.source);

// ---------- главная «Учёбы» ----------
await tab(page, 'learn');
assert.equal(await text('#title'), 'Учёба');
assert.equal(await page.locator('.track-card').count(), 9, '8 курсов и свои карточки');
assert.equal(await text('#learn-count'), '0');
assert.equal(await page.locator('#learn-start').count(), 0, 'пока нечего повторять');
assert.equal(await page.locator('#tabs button').count(), 5);

// ---------- курс: наставник, уроки ----------
await page.click('.track-card[data-track="english"]');
assert.equal(await page.locator('.lesson').count(), 16);
await page.click('#mentor summary');
await page.click('#mentor button[data-prompt="0"]');
await toast(/Скопировано/);
assert.match(await page.evaluate(() => navigator.clipboard.readText()), /репетитор английского/);
await page.click('.lesson[data-lesson="en-01"] summary');
assert.match(await text('.lesson[data-lesson="en-01"]'), /Задание/);
await page.click('button[data-done="en-01"]');
await toast(/Урок пройден/);
assert.equal(await page.getAttribute('.lesson[data-lesson="en-01"]', 'open'), '', 'урок остался раскрытым после отметки');
assert.match(await text('.lesson[data-lesson="en-01"] .lesson-n'), /✓/);
assert.match(await text('#view-learn'), /Уроки 1\/16/);

// ---------- сессия повторения ----------
const startText = await text('#track-start');
assert.match(startText, /\(5\)/, 'в день по 5 новых карточек на курс');
await page.click('#track-start');
assert.equal(await page.isVisible('#sess'), true);
assert.equal(await text('#sess-pos'), '1 / 5');
assert.ok((await text('#sess-q')).length > 0);
assert.equal(await page.locator('#sess-a').count(), 0, 'ответ скрыт до нажатия');
await page.click('#sess-show');
assert.ok((await text('#sess-a')).length > 0);
assert.equal(await page.locator('.grade').count(), 3);
await page.click('.grade.again');                                  // забыл — вернётся в сессию
assert.equal(await text('#sess-pos'), '2 / 6', 'забытая карточка добавлена в очередь');
for (let i = 0; i < 5; i++) { await page.click('#sess-show'); await page.click('.grade.good'); }
await until(page, () => document.getElementById('sess-result'));
assert.match(await text('#sess-result'), /\d+%/);
await page.click('#sess-done');
assert.equal(await page.isVisible('#sess'), false);

// на сегодня всё: новых больше нет (лимит), повторять рано
assert.match(await text('#view-learn'), /Уроки 1\/16/);
await page.click('#learn-back');
assert.equal(await text('#learn-count'), '0');
assert.match(await text('#learn-streak'), /Занятий подряд: 1 дн\./);

// ---------- состояние переживает перезапуск; просроченное появляется в очереди ----------
await page.reload();
await until(page, () => !document.getElementById('app').hidden);
await tab(page, 'learn');
assert.equal(await text('#learn-count'), '0');
await page.evaluate(async () => {
  const store = await import('./store.js'); const ac = await import('./academy.js'); const srs = await import('./srs.js');
  const en = ac.trackById('english'); const cards = ac.cardsOfTrack(en).filter(c => c.kind === 'deck');
  await store.save(ac.makeSrsEvent({ ...srs.newState(cards[20].id, '2026-01-01'), box: 2, due: '2026-01-05', reps: 3 }));
});
await until(page, () => document.getElementById('learn-count')?.textContent === '1');
assert.match(await text('#learn-today'), /к повторению: 1/);
await page.click('#learn-start');
assert.equal(await text('#sess-pos'), '1 / 1');
await page.keyboard.press('Space');                                // горячие клавиши: пробел — показать ответ, 3 — «помню»
await page.keyboard.press('3');
await until(page, () => document.getElementById('sess-result'));
await page.keyboard.press('Escape');
assert.equal(await page.isVisible('#sess'), false);
await until(page, () => document.getElementById('learn-count')?.textContent === '0');

// ---------- свои карточки ----------
await page.click('.track-card[data-track="my"]');
await page.click('#my-add');
assert.match(await text('#my-err'), /Заполни вопрос и ответ/);
await page.fill('#my-q', 'Столица Израиля?'); await page.fill('#my-a', 'Иерусалим');
await page.click('#my-add'); await toast(/Карточка добавлена/);
await until(page, () => document.querySelectorAll('#my-list .entry').length === 1);
await page.click('#learn-back');
assert.equal(await text('#learn-count'), '1', 'своя карточка в общем повторении');
await page.click('.track-card[data-track="my"]');
await page.click('#my-list .chip.danger');
await until(page, () => !document.getElementById('my-list'));

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E LEARN OK');
