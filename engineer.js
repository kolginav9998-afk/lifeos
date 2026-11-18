// Панель инженера: размер базы по видам записей и отладочный бандл одним текстом.
// Чистая логика: ничего не знает про DOM, хранилище и платформу — всё приходит параметрами.

// Приблизительный размер записи: длина JSON (в IndexedDB чуть больше из-за служебных полей).
export function sizeByType(events) {
  const map = new Map();
  for (const e of events || []) {
    if (!e || typeof e.type !== 'string') continue;
    let bytes = 0;
    try { bytes = JSON.stringify(e).length; } catch { /* циклическая ссылка — не должна случаться */ }
    const row = map.get(e.type) || { type: e.type, count: 0, bytes: 0 };
    row.count += 1; row.bytes += bytes;
    map.set(e.type, row);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes || a.type.localeCompare(b.type));
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 Б';
  if (n < 1024) return `${Math.round(n)} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} КБ`;
  return `${(n / 1024 / 1024).toFixed(2).replace('.', ',')} МБ`;
}

// Отладочный бандл: один текст, который можно скопировать и прислать (версии, счётчики, ошибки).
// extra — дополнительные строки диагностики (состояние хранилища, платформа), errors — журнал ошибок.
export function debugBundle({ version = '?', events = [], errors = [], extra = [], now = Date.now() } = {}) {
  const rows = sizeByType(events);
  const total = rows.reduce((s, r) => s + r.bytes, 0);
  const L = [
    'Отладочный бандл «Компас»',
    `Версия: ${version}`,
    `Собран: ${new Date(now).toLocaleString('ru')}`,
    `Записей всего: ${events.length}, размер ≈ ${formatBytes(total)}`,
    '',
    'Записи по видам:',
    ...(rows.length ? rows.map(r => `- ${r.type}: ${r.count} шт, ${formatBytes(r.bytes)}`) : ['- пока пусто']),
  ];
  if (extra.length) L.push('', 'Хранилище и окружение:', ...extra.map(x => String(x)));
  L.push('', errors.length ? 'Последние ошибки:' : 'Ошибок не записано.', ...errors.map(x => `- ${String(x)}`));
  return L.join('\n') + '\n';
}
