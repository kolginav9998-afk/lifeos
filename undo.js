// «Ctrl+Z по жизни»: журнал недавних изменений и окно отмены (по умолчанию час).
// Журнал живёт в памяти: наблюдатель сравнивает список записей до и после каждого изменения
// и запоминает прежние версии — из них и делается восстановление.
import { describeEvent } from './search.js';

export const UNDO_WINDOW_MS = 60 * 60 * 1000;                    // окно отмены: один час
export const UNDO_LIMIT = 100;                                   // больше сотни шагов назад не помним

const sameEvent = (a, b) => a === b || (a.u !== undefined && b.u !== undefined ? a.u === b.u : JSON.stringify(a) === JSON.stringify(b));

// Разница двух состояний списка записей: что добавлено, изменено, удалено.
// Возвращает шаги вида { kind: 'created'|'updated'|'deleted', id, before, after }.
export function diffStates(prevList, nextList) {
  const prev = new Map((prevList || []).map(e => [e.id, e]));
  const next = new Map((nextList || []).map(e => [e.id, e]));
  const out = [];
  for (const [id, after] of next) {
    const before = prev.get(id);
    if (!before) out.push({ kind: 'created', id, before: null, after });
    else if (!sameEvent(before, after)) out.push({ kind: 'updated', id, before, after });
  }
  for (const [id, before] of prev) if (!next.has(id)) out.push({ kind: 'deleted', id, before, after: null });
  return out;
}

// Шаг человеческими словами: «Изменена задача «Купить хлеб»».
export function describeUndo(step) {
  const ev = step.after ?? step.before;
  const d = ev ? describeEvent(ev) : { kind: 'запись', title: '' };
  const what = `${String(d.kind).toLowerCase()}${d.title ? ` «${d.title}»` : ''}`;
  return { created: `Добавлено: ${what}`, updated: `Изменено: ${what}`, deleted: `Удалено: ${what}` }[step.kind] ?? `Изменено: ${what}`;
}

// Журнал отмены. prime() — исходная точка (без записи шагов), observe() — после каждого изменения списка.
export function createUndoLog(limit = UNDO_LIMIT) {
  let prev = null;
  const steps = [];
  return {
    prime(events) { prev = (events || []).slice(); },
    observe(events, now = Date.now()) {
      const next = (events || []).slice();
      if (prev) for (const s of diffStates(prev, next)) steps.push({ ...s, at: now });
      if (steps.length > limit) steps.splice(0, steps.length - limit);
      prev = next;
    },
    // Недавние шаги в окне отмены, свежие сверху.
    recent(now = Date.now(), windowMs = UNDO_WINDOW_MS) {
      return steps.filter(s => now - s.at <= windowMs).reverse();
    },
    size() { return steps.length; },
    // Полная очистка: при блокировке журнал не должен держать личные данные в памяти и в разметке.
    clear() { prev = null; steps.length = 0; },
  };
}

// Что вернуть, чтобы отменить шаг: save — записать прежнюю версию, remove — убрать добавленное.
export function undoAction(step) {
  if (step.kind === 'created') return { save: null, remove: step.id };
  return { save: step.before, remove: null };
}
