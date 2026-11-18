// Replay-проигрыватель: состояние «как было» на конец выбранной даты.
// Хранилище держит только последнюю версию каждой записи, поэтому перемотка честная только в одну сторону:
// отбираются записи, созданные до среза, а отметки о выполнении, сделанные после среза, откатываются.
// Правки ТЕКСТА после даты отмотать нельзя (старых версий текста не хранится) — об этом говорит подпись на экране.

// Конец дня 'YYYY-MM-DD' в локальном времени — момент среза.
export function endOfDayTs(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

// Копия списка записей, как он выглядел на cutoffTs.
// Откатываем только обратимые по данным поля: done/doneAt (задачи), editedAt (метка правки).
export function snapshotAt(events, cutoffTs) {
  if (!Number.isFinite(cutoffTs)) return [];
  const out = [];
  for (const e of events || []) {
    if (!e || typeof e.ts !== 'number' || e.ts > cutoffTs) continue;
    const p = e.payload || {};
    let payload = p, changed = false;
    if (p.done && Number.isFinite(p.doneAt) && p.doneAt > cutoffTs) {
      const { done, doneAt, spawnedId, ...rest } = p;
      payload = { ...rest, done: false, doneAt: null };
      changed = true;
    }
    if (Number.isFinite(payload.editedAt) && payload.editedAt > cutoffTs) {
      const { editedAt, ...rest } = payload;
      payload = rest;
      changed = true;
    }
    out.push(changed ? { ...e, payload } : e);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// Краткая сводка среза: сколько записей и каких видов было на дату.
export function replaySummary(events) {
  const byType = new Map();
  for (const e of events || []) {
    if (!e || typeof e.type !== 'string') continue;
    byType.set(e.type, (byType.get(e.type) || 0) + 1);
  }
  const rows = [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  return { total: rows.reduce((s, r) => s + r.count, 0), byType: rows };
}
