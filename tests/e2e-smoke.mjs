import assert from 'node:assert/strict';
import { VERSION } from '../version.js';
import { launch, tab, until } from './helpers.mjs';

const t = await launch();
const { page, errors } = t;
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
assert.equal(await page.textContent('#title'), 'Сегодня');
assert.equal((await page.textContent('#status')).trim(), `${VERSION} · онлайн`);
for (const [id, title] of [['habits', 'Привычки'], ['money', 'Деньги'], ['notes', 'Заметки'], ['more', 'Настройки'], ['today', 'Сегодня']]) {
  await tab(page, id);
  assert.equal(await page.textContent('#title'), title);
  assert.equal(await page.locator(`#view-${id}`).isVisible(), true, id);
}
// CSP действительно применена
const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content);
assert.match(csp, /script-src 'self'/);
assert.deepEqual(errors, [], 'нет ошибок и предупреждений в консоли:\n' + errors.join('\n'));
await t.close();
console.log('SMOKE OK');
