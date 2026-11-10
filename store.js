// Единое состояние: список событий + подписки. Все экраны читают отсюда и пишут через эти функции.
import * as db from './db.js';
import { LockedError } from './vault.js';

export const state = { events: [] };
const subs = new Set();
let lockedHandler = () => {};

export const onChange = fn => { subs.add(fn); return () => subs.delete(fn); };
export const setLockedHandler = fn => { lockedHandler = fn; };
function emit() {
  for (const fn of subs) { try { fn(state.events); } catch (e) { console.error(e); } }
}

export async function refresh() {
  try { state.events = await db.getAll(); }
  catch (e) { if (e instanceof LockedError) { clear(); lockedHandler(); return; } throw e; }
  emit();
}
export function clear() { state.events = []; emit(); }

async function guard(fn) {
  try { return await fn(); }
  catch (e) { if (e instanceof LockedError) { clear(); lockedHandler(); return undefined; } throw e; }
}

export const save = ev => guard(async () => { await db.put(ev); await refresh(); });
export const saveMany = evs => guard(async () => { await db.putMany(evs); await refresh(); });
export const remove = id => guard(async () => { const old = state.events.find(e => e.id === id); await db.remove(id); await refresh(); return old; });
export const removeMany = ids => guard(async () => {
  const set = new Set(ids);
  const old = state.events.filter(e => set.has(e.id));
  await db.removeMany(ids); await refresh(); return old;
});
export const byType = t => state.events.filter(e => e.type === t);
