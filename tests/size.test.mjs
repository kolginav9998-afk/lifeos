// Бюджет размера: сайт и приложение грузят одни и те же файлы. Рост выше порога должен быть осознанным решением.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startupText } from '../perf.js';

const root = path.resolve(import.meta.dirname, '..');
const BUDGET_TOTAL = 1_400_000;            // байт: весь веб-код (js, css, html, манифест)
const BUDGET_FILE = 64_000;                // байт: один файл
const files = [...fs.readdirSync(root).filter(f => f.endsWith('.js')), 'index.html', 'style.css', 'manifest.webmanifest'];
const sizes = files.map(f => [f, fs.statSync(path.join(root, f)).size]).sort((a, b) => b[1] - a[1]);
const total = sizes.reduce((s, [, n]) => s + n, 0);

test('размер сборки в пределах бюджета', t => {
  t.diagnostic(`всего ${Math.round(total / 1024)} КБ из ${Math.round(BUDGET_TOTAL / 1024)} КБ; крупнейшие: ${sizes.slice(0, 4).map(([f, n]) => `${f} ${Math.round(n / 1024)} КБ`).join(', ')}`);
  assert.ok(total <= BUDGET_TOTAL, `веб-код вырос до ${total} байт (бюджет ${BUDGET_TOTAL}). Если рост нужен, подними бюджет осознанно`);
  const big = sizes.filter(([, n]) => n > BUDGET_FILE).map(([f, n]) => `${f} (${n})`);
  assert.deepEqual(big, [], `файлы крупнее ${BUDGET_FILE} байт: разбей их на части`);
});

test('в кодовой базе нет встроенных больших вставок (data: с base64)', () => {
  for (const f of files.filter(x => x.endsWith('.js') || x.endsWith('.css') || x.endsWith('.html'))) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{2000,}/.test(s), `${f}: большая вставка base64`);
  }
});

test('замер запуска: формат текста для «О приложении»', () => {
  assert.equal(startupText({ shell: null, data: null }), '');
  assert.equal(startupText({ shell: 420, data: null }), 'Запуск: интерфейс за 420 мс');
  assert.equal(startupText({ shell: 420, data: 1350 }), 'Запуск: интерфейс за 420 мс, данные за 1,4 с');
  assert.equal(startupText({ shell: 999, data: 1000 }), 'Запуск: интерфейс за 999 мс, данные за 1 с');
});
