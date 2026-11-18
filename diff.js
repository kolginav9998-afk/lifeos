// Сравнение двух копий данных: текущей и старого бэкапа (JSON). Только чтение — решения принимает человек.

// Стабильная сериализация: ключи сортируются, чтобы порядок полей не считался различием.
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

const shortVal = v => {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
};

// Различия полей полезной нагрузки: [{ field, was, now }] — was из бэкапа, now из текущих данных.
export function fieldDiffs(current, backup) {
  const a = current?.payload ?? {}, b = backup?.payload ?? {};
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'editedAt') continue;                                     // метка правки сама по себе не различие по смыслу
    if (stableStringify(a[k]) === stableStringify(b[k])) continue;
    out.push({ field: k, was: k in b ? shortVal(b[k]) : '—', now: k in a ? shortVal(a[k]) : '—' });
  }
  return out;
}

// Полная сводка различий двух наборов записей.
// onlyBackup — есть только в бэкапе; onlyCurrent — появились после бэкапа; changed — отличаются версии.
export function diffRecords(current, backup) {
  const here = new Map((current || []).map(e => [e.id, e]));
  const there = new Map((backup || []).map(e => [e.id, e]));
  const onlyBackup = [], onlyCurrent = [], changed = [];
  for (const [id, ev] of there) {
    const mine = here.get(id);
    if (!mine) onlyBackup.push(ev);
    else if (stableStringify(mine) !== stableStringify(ev)) changed.push({ id, type: ev.type, current: mine, backup: ev, fields: fieldDiffs(mine, ev) });
  }
  for (const [id, ev] of here) if (!there.has(id)) onlyCurrent.push(ev);
  const byTs = (a, b) => b.ts - a.ts;
  return {
    onlyBackup: onlyBackup.sort(byTs),
    onlyCurrent: onlyCurrent.sort(byTs),
    changed: changed.sort((a, b) => b.backup.ts - a.backup.ts),
  };
}

// Одна строка сводки: «только в бэкапе: 3, новых после бэкапа: 12, отличаются: 2».
export function diffSummary(d) {
  const parts = [];
  parts.push(`только в бэкапе: ${d.onlyBackup.length}`);
  parts.push(`новых после бэкапа: ${d.onlyCurrent.length}`);
  parts.push(`отличаются версии: ${d.changed.length}`);
  return parts.join(' · ');
}
