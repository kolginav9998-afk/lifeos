import { newId } from './events.js';
export const MAX_NOTE = 20000;

export function makeNote(text, now = Date.now()) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('empty note');
  if (t.length > MAX_NOTE) throw new Error('Заметка слишком длинная');
  return { id: newId(), type: 'note', ts: now, payload: { text: t }, source: 'manual', confidence: 1, evidence: [] };
}
export function updateNote(ev, text, now = Date.now()) {
  const n = makeNote(text, now);
  return { ...ev, payload: { ...ev.payload, text: n.payload.text, editedAt: now } };
}
export function noteTitle(text, max = 60) {
  const first = String(text).split('\n').find(l => l.trim()) || '';
  return first.length > max ? first.slice(0, max - 1) + '…' : first;
}
export const sortedNotes = events => events.filter(e => e.type === 'note').sort((a, b) => (b.payload.editedAt || b.ts) - (a.payload.editedAt || a.ts));
