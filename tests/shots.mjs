// Скриншоты основных экранов для оценки дизайна: node tests/shots.mjs <метка> [dark|light|both] [экраны через запятую]
import fs from 'node:fs';
import path from 'node:path';
import { launch, tab, until } from './helpers.mjs';
import { seedDemo } from './seed.mjs';

const tag = process.argv[2] || 'base';
const which = process.argv[3] || 'both';
const only = (process.argv[4] || '').split(',').filter(Boolean);
const outDir = path.resolve(import.meta.dirname, '../shots');
fs.mkdirSync(outDir, { recursive: true });

const t = await launch({ viewport: { width: 390, height: 844 }, ctxOptions: { deviceScaleFactor: 2 } });
const p = t.page;
await p.goto(t.url);
await until(p, () => !document.getElementById('app').hidden);

await seedDemo(p);

const screens = [['today', 'today'], ['habits', 'habits'], ['diary', 'diary'], ['health', 'health'], ['money', 'money'], ['learn', 'learn'], ['settings', 'more'], ['profile', 'account']];
const themes = which === 'both' ? ['dark', 'light'] : [which];
for (const theme of themes) {
  await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  for (const [name, id] of screens) {
    if (only.length && !only.includes(name)) continue;
    await tab(p, id);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(outDir, `${tag}-${theme}-${name}.png`), fullPage: !!process.env.FULL });
  }
}
console.log('screenshots:', fs.readdirSync(outDir).filter(f => f.startsWith(tag)).length);
await t.close();
