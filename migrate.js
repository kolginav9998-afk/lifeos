// Миграции формата данных. SCHEMA_VERSION растёт только тогда, когда старые записи нельзя читать «как есть» (новые типы и поля
// версию не меняют: они только добавляются). Миграция превращает записи схемы N в записи схемы N+1 и не меняет исходный массив.
// Сейчас схема первая, миграций нет. Форма записи для будущего (как в тестах tests/r39.test.mjs):
//   { from: 1, to: 2, note: 'поле x переименовано в y', up: events => events.map(переименовать поле у нужных записей, остальные вернуть как есть) }
export const MIGRATIONS = [];

// Проблемы цепочки: версии идут подряд от 1 до target без дыр и повторов (иначе забыли написать миграцию).
export function chainProblems(migrations, target) {
  const out = [], seen = new Set();
  for (const m of migrations) {
    if (!Number.isInteger(m.from) || m.to !== m.from + 1) out.push(`миграция ${m.from}→${m.to}: шаг должен быть ровно на одну версию`);
    if (seen.has(m.from)) out.push(`две миграции с версии ${m.from}`);
    seen.add(m.from);
    if (typeof m.up !== 'function') out.push(`миграция ${m.from}→${m.to}: нет функции up`);
  }
  for (let v = 1; v < target; v++) if (!seen.has(v)) out.push(`нет миграции ${v}→${v + 1}`);
  for (const f of seen) if (f >= target) out.push(`миграция с версии ${f} лишняя: текущая схема ${target}`);
  return out;
}

// Привести записи схемы `from` к схеме `target`. Без поля schema (самые первые копии) считаем схему первой.
export function migrateEvents(events, from, target, migrations = MIGRATIONS) {
  const start = Number.isFinite(from) && from >= 1 ? Math.trunc(from) : 1;
  if (start > target) throw new Error('копия новее приложения');
  let cur = events;
  const applied = [];
  for (let v = start; v < target; v++) {
    const m = migrations.find(x => x.from === v);
    if (!m || m.to !== v + 1 || typeof m.up !== 'function') throw new Error(`нет миграции с версии ${v} на ${v + 1}`);
    const next = m.up(cur);
    if (!Array.isArray(next)) throw new Error(`миграция ${v}→${v + 1} вернула не список записей`);
    cur = next;
    applied.push({ from: v, to: v + 1, note: m.note || '' });
  }
  return { events: cur, applied };
}
