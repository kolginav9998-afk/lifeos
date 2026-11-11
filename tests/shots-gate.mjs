// Скриншоты экрана входа и экрана пароля для оценки дизайна: node tests/shots-gate.mjs <метка>
import fs from 'node:fs';
import path from 'node:path';
import { launch, until } from './helpers.mjs';
import { createServer } from '../server/node/server.js';

const tag = process.argv[2] || 'gate';
const outDir = path.resolve(import.meta.dirname, '../shots');
fs.mkdirSync(outDir, { recursive: true });
const server = createServer({ env: { ALLOWED_ORIGINS: '*', SETUP_CODE: 'код-123' } });
await new Promise(r => server.server.listen(0, r));
const SERVER = `http://localhost:${server.server.address().port}`;

const t = await launch({ viewport: { width: 390, height: 844 }, ctxOptions: { deviceScaleFactor: 2 }, buildEnv: { LIFEOS_REQUIRE_ACCOUNT: '1', LIFEOS_SERVER_URL: SERVER } });
const p = t.page;
await p.goto(t.url);
await until(p, () => document.getElementById('gate-register'));
for (const theme of ['dark', 'light']) {
  await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(outDir, `${tag}-${theme}-gate.png`) });
}
// создать аккаунт и перезагрузить: экран пароля
await p.fill('#gate-user', 'anna'); await p.fill('#gate-pass', 'длинная-надёжная-фраза'); await p.fill('#gate-pass2', 'длинная-надёжная-фраза'); await p.fill('#gate-setup', 'код-123');
await p.click('#gate-register');
await until(p, () => document.getElementById('gate-code'), null, 60000);
for (const theme of ['dark', 'light']) {
  await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(outDir, `${tag}-${theme}-code.png`) });
}
await p.check('#gate-code-ok'); await p.click('#gate-code-done');
await until(p, () => !document.getElementById('app').hidden, null, 30000);
await p.reload();
await until(p, () => !document.getElementById('lock').hidden);
for (const theme of ['dark', 'light']) {
  await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(outDir, `${tag}-${theme}-lock.png`) });
}
await t.close(); server.close();
console.log('screenshots:', fs.readdirSync(outDir).filter(f => f.startsWith(tag)).length);
