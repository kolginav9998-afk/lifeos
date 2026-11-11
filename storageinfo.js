// Место для данных приложения: по оценке браузера (usage — занято, quota — доступно). Только предупреждение.
const MB = 1024 * 1024;
const f = mb => (mb < 10 ? String(Math.round(mb * 10) / 10).replace('.', ',') : String(Math.round(mb)));

export function storageStatus({ usage = 0, quota = 0 } = {}) {
  if (!(Number.isFinite(quota) && quota > 0) || !(Number.isFinite(usage) && usage >= 0)) return null;
  const free = Math.max(0, quota - usage), ratio = usage / quota;
  const level = free < 50 * MB || ratio >= 0.9 ? 'low' : free < 200 * MB || ratio >= 0.75 ? 'warn' : 'ok';
  const usedMb = usage / MB, freeMb = free / MB;
  const line = `Занято приложением: ${f(usedMb)} МБ, свободно около ${f(freeMb)} МБ`;
  const text = level === 'low' ? `Свободной памяти почти не осталось (около ${f(freeMb)} МБ): новые записи могут не сохраниться. Сделай резервную копию и освободи место на телефоне.`
    : level === 'warn' ? `Свободной памяти становится мало (около ${f(freeMb)} МБ). Стоит сделать резервную копию и освободить место на телефоне.` : '';
  return { level, usedMb, freeMb, ratio, line, text };
}
