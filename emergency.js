// Данные на экстренный случай: группа крови, аллергии, постоянные лекарства, контакт. Хранятся шифрованно вместе со всем остальным.
// Видны только после входа в приложение: для служб скорой помощи лучше ещё заполнить экстренную информацию в настройках телефона.
export const EMERGENCY_ID = 'emergency:me';
export const BLOOD_TYPES = ['', '0 (I) Rh+', '0 (I) Rh−', 'A (II) Rh+', 'A (II) Rh−', 'B (III) Rh+', 'B (III) Rh−', 'AB (IV) Rh+', 'AB (IV) Rh−'];
export const EMERGENCY_NOTE = 'Эти данные хранятся только у тебя и видны после входа в приложение. Для скорой помощи полезно заполнить ещё и «экстренную информацию» в настройках телефона: она доступна с экрана блокировки.';
export const FIELDS = [['bloodType', 'Группа крови'], ['allergies', 'Аллергии'], ['conditions', 'Хронические состояния'], ['meds', 'Постоянно принимаю'], ['contactName', 'Кому позвонить'], ['contactPhone', 'Телефон'], ['note', 'Важно знать']];

const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const LIMITS = { allergies: 300, conditions: 300, meds: 300, contactName: 60, note: 300 };

export function makeEmergency(f = {}, now = Date.now(), prev = null) {
  const p = {};
  const bt = String(f.bloodType ?? '');
  if (!BLOOD_TYPES.includes(bt)) throw new Error('Выбери группу крови из списка');
  if (bt) p.bloodType = bt;
  for (const [k, n] of Object.entries(LIMITS)) { const v = clean(f[k], n); if (v) p[k] = v; }
  const ph = clean(f.contactPhone, 24);
  if (ph) {
    if (!/^[+()\d\s-]+$/.test(ph) || (ph.match(/\d/g) || []).length < 5) throw new Error('Телефон: цифры, пробелы, плюс, скобки и дефис');
    p.contactPhone = ph;
  }
  if (!Object.keys(p).length) throw new Error('Заполни хотя бы одно поле');
  return { id: EMERGENCY_ID, type: 'emergency', ts: prev?.ts ?? now, payload: { ...p, ...(prev ? { editedAt: now } : {}) }, source: 'manual', confidence: 1, evidence: [] };
}
export const emergencyOf = events => events.find(e => e.type === 'emergency' && e.id === EMERGENCY_ID) ?? null;
export const emergencyLines = p => FIELDS.filter(([k]) => p[k]).map(([k, label]) => [label, p[k]]);
