// Питомец: имя, вес, ветеринар и прививки. Чистая логика: без интерфейса, хранилища и часов (сегодняшний день приходит параметром).
// Записи: pet — питомец (id: pet:<uuid>), petvac — прививка (id: petvac:<uuid>). Следующая прививка считается сама:
// у прививки есть дата «сделана» и необязательная дата «следующая» — по ней «Дом» показывает напоминание-чип.
import { isYmd, daysBetween, todayStr, newId } from './events.js';

export const PET_KIND = { cat: 'Кот', dog: 'Собака', other: 'Другой питомец' };
export const VAC_SOON_DAYS = 30;                       // за столько дней прививка считается близкой
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function makePet({ name, kind = 'cat', weightKg = null, vetName = '', vetPhone = '', note = '' } = {}, now = Date.now()) {
  const n = clean(name, 60);
  if (!n) throw new Error('Назови питомца');
  if (!PET_KIND[kind]) throw new Error('Выбери, кто это');
  const raw = String(weightKg ?? '').trim().replace(',', '.');
  const w = raw === '' ? null : Number(raw);
  if (w !== null && !(Number.isFinite(w) && w > 0 && w <= 200)) throw new Error('Вес: число больше 0 и до 200 кг');
  return { id: `pet:${newId()}`, type: 'pet', ts: now, payload: { name: n, kind, weightKg: w, vetName: clean(vetName, 60), vetPhone: clean(vetPhone, 30), note: clean(note, 300) }, source: 'manual', confidence: 1, evidence: [] };
}
// Правка: id, время создания и неизвестные поля (от более новой версии) сохраняются.
export function updatePet(ev, changes, now = Date.now()) {
  const next = makePet({ ...ev.payload, ...changes }, now);
  return { ...ev, payload: { ...next.payload, editedAt: now } };
}
export const petsOf = events => events.filter(e => e.type === 'pet' && e.payload && typeof e.payload.name === 'string').sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
export const petLine = p => [PET_KIND[p.kind] ?? p.kind, p.weightKg !== null && p.weightKg !== undefined ? `${String(p.weightKg).replace('.', ',')} кг` : ''].filter(Boolean).join(' · ');

export function makeVac(petRef, { name, date, nextDue = '' } = {}, now = Date.now()) {
  const pet = typeof petRef === 'string' ? petRef : petRef?.id;
  if (!pet) throw new Error('Выбери питомца');
  const n = clean(name, 60);
  if (!n) throw new Error('Назови прививку');
  if (!isYmd(date)) throw new Error('Дата прививки: выбери день');
  if (date > todayStr(now)) throw new Error('Прививка не может быть в будущем');
  const due = String(nextDue ?? '').trim();
  if (due && !isYmd(due)) throw new Error('Следующая прививка: выбери день');
  const payload = { pet, name: n, date };
  if (due) payload.nextDue = due;                       // необязательное: без него напоминаний нет
  return { id: `petvac:${newId()}`, type: 'petvac', ts: now, payload, source: 'manual', confidence: 1, evidence: [] };
}
export const vacsOf = (events, petId = null) =>
  events.filter(e => e.type === 'petvac' && (!petId || e.payload?.pet === petId))
    .sort((a, b) => (a.payload.date === b.payload.date ? b.ts - a.ts : a.payload.date < b.payload.date ? 1 : -1));   // свежие сверху

// Состояние одной прививки на сегодня: null — даты «следующая» нет, напоминать не о чем.
export function vacState(vac, today) {
  const due = vac?.payload?.nextDue;
  if (!due || !isYmd(due) || !isYmd(today)) return null;
  const left = daysBetween(today, due);
  return { due, left, overdue: left < 0, soon: left >= 0 && left <= VAC_SOON_DAYS };
}
// Напоминание для «Дома»: прививки, у которых срок наступил или близко (просроченные первыми).
export function vaccinesDue(events, today, days = VAC_SOON_DAYS) {
  const pets = new Map(petsOf(events).map(p => [p.id, p]));
  return vacsOf(events)
    .map(vac => ({ vac, pet: pets.get(vac.payload.pet) ?? null, state: vacState(vac, today) }))
    .filter(r => r.state && r.state.left <= days)
    .sort((a, b) => a.state.left - b.state.left || a.vac.payload.name.localeCompare(b.vac.payload.name, 'ru'));
}
// Текст чипа: «Мурка: комплексная — просрочена на 5 дн.» / «…через 12 дн.» / «…сегодня».
export function vacChipText({ vac, pet, state }, plural) {
  const when = state.left < 0 ? `просрочена на ${-state.left} дн.` : state.left === 0 ? 'сегодня' : `через ${state.left} ${plural(state.left, 'день', 'дня', 'дней')}`;
  return `${pet ? `${pet.payload.name}: ` : ''}${vac.payload.name} — ${when}`;
}
