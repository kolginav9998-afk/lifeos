// Единое состояние: список событий + подписки. Все экраны читают отсюда и пишут через эти функции.
// Изменения применяются точечно (без перечитывания и повторной расшифровки всей базы).
import * as db from './db.js';
import { LockedError } from './vault.js';

export const state = { events: [] };
const byId = new Map();
const subs = new Set();
let lockedHandler = () => {};

export const onChange = fn => { subs.add(fn); return () => subs.delete(fn); };
export const setLockedHandler = fn => { lockedHandler = fn; };
function emit() {
  state.events = [...byId.values()];
  for (const fn of subs) { try { fn(state.events); } catch (e) { console.error(e); } }
}

export async function refresh() {
  let all;
  try { all = await db.getAll(); }
  catch (e) { if (e instanceof LockedError) { clear(); lockedHandler(); return; } throw e; }
  byId.clear();
  for (const ev of all) byId.set(ev.id, ev);
  emit();
}
export function clear() { byId.clear(); emit(); }

// Перечитать только указанные записи (после синхронизации) и убрать удалённые.
export async function reload(upsertIds = [], deletedIds = []) {
  try {
    for (const ev of await db.getMany(upsertIds)) byId.set(ev.id, ev);
  } catch (e) { if (e instanceof LockedError) { clear(); lockedHandler(); return; } throw e; }
  for (const id of deletedIds) byId.delete(id);
  emit();
}

async function guard(fn) {
  try { return await fn(); }
  catch (e) { if (e instanceof LockedError) { clear(); lockedHandler(); return undefined; } throw e; }
}

export const save = ev => guard(async () => { const s = await db.put(ev); byId.set(s.id, s); emit(); return s; });
export const saveMany = evs => guard(async () => { for (const s of await db.putMany(evs)) byId.set(s.id, s); emit(); });
export const remove = id => guard(async () => { const old = byId.get(id); await db.remove(id); byId.delete(id); emit(); return old; });
export const removeMany = ids => guard(async () => {
  const old = ids.map(i => byId.get(i)).filter(Boolean);
  await db.removeMany(ids);
  for (const id of ids) byId.delete(id);
  emit();
  return old;
});
export const byType = t => state.events.filter(e => e.type === t);
export const get = id => byId.get(id);
