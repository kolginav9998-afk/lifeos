// Проверка адресов каталога внешних курсов (zero-resources.js). Нужен выход в интернет.
//   node scripts/check-resources.mjs           — показать код ответа каждого адреса
//   node scripts/check-resources.mjs --write   — записать дату в блок CHECKS файла zero-resources.js, но только для адресов, которые ответили (2xx/3xx)
// Сайты, которые не ответили, остаются «не проверялся» (availability 'unknown', lastChecked null): честнее, чем гадать. TLS всегда проверяется.
import fs from 'node:fs';
import { RESOURCES } from '../zero-resources.js';

const write = process.argv.includes('--write');
const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const get = (url, method) => fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; link-check)' } });

const ok = [];
for (const x of RESOURCES) {
  let code = 0, final = x.url;
  try {
    let res = await get(x.url, 'HEAD');
    if (res.status >= 400) res = await get(x.url, 'GET');                      // часть сайтов не любит HEAD
    code = res.status; final = res.url;
  } catch { code = 0; }
  const good = code >= 200 && code < 400;
  if (good) ok.push(x.id);
  console.log(`${String(code || 'нет').padEnd(5)} ${x.id.padEnd(22)} ${good ? '' : '!! '}${final}`);
}
console.log(`\nОтветили: ${ok.length} из ${RESOURCES.length}`);

if (write) {
  const file = new URL('../zero-resources.js', import.meta.url);
  const src = fs.readFileSync(file, 'utf8');
  const lines = ok.map(id => `  '${id}': ['ok', '${today}'],\n`).join('');
  const next = src.replace(/\/\/ CHECKS:begin[\s\S]*?\/\/ CHECKS:end/, `// CHECKS:begin\n${lines}  // CHECKS:end`);
  if (next === src) console.log('Файл не изменился.'); else { fs.writeFileSync(file, next); console.log('Записано в zero-resources.js (блок CHECKS).'); }
}
