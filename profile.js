// Профиль: имя, аватар (эмодзи и цвет) и девиз. Хранится в записи profile (id 'profile') вместе с полями здоровья и едет на другие устройства
// вместе с остальными записями (в зашифрованном виде). Чистая логика.
import { makeProfile, profileOf } from './events.js';

export const AVATARS = ['🙂', '😎', '🦊', '🐼', '🦁', '🐯', '🐨', '🦉', '🐙', '🌵', '🚀', '⭐', '🔥', '🌊', '🍀', '🎧'];
export const COLORS = { violet: '#7c5cff', blue: '#2f7bff', teal: '#14b8a6', green: '#22a559', amber: '#e08a00', rose: '#e0436a' };
export const COLOR_NAMES = { violet: 'фиолетовый', blue: 'синий', teal: 'бирюзовый', green: 'зелёный', amber: 'янтарный', rose: 'розовый' };
export const DEFAULT_COLOR = 'violet';
export const MAX_NAME = 60;
export const MAX_MOTTO = 80;

const clean = (s, n) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, n);

// «Анна Петрова» → «АП», «anna» → «A», пусто → «»
export function initials(name) {
  const words = clean(name, MAX_NAME).split(' ').filter(Boolean);
  return words.slice(0, 2).map(w => Array.from(w)[0].toUpperCase()).join('');
}

// То, что нужно экрану: имя, логин, аватар (эмодзи или буквы), цвет, девиз.
export function profileCard(events, account = null) {
  const p = profileOf(events)?.payload ?? {};
  const color = Object.hasOwn(COLORS, p.color) ? p.color : DEFAULT_COLOR;
  const name = clean(p.name, MAX_NAME);
  const login = account?.username ?? '';
  const emoji = AVATARS.includes(p.avatar) ? p.avatar : '';
  const letters = initials(name) || initials(login) || '?';
  return { name, login, emoji, letters, color, hex: COLORS[color], motto: clean(p.motto, MAX_MOTTO), face: emoji || letters };
}

// Проверка формы профиля: возвращает значения, которые можно сохранять.
export function checkProfileForm({ name, avatar, color, motto } = {}) {
  const n = clean(name, MAX_NAME);
  if (n.length > 0 && n.length < 2) throw new Error('Имя: хотя бы два символа (или оставь пустым)');
  const c = color || DEFAULT_COLOR;
  if (!Object.hasOwn(COLORS, c)) throw new Error('Выбери цвет из списка');
  const a = avatar || '';
  if (a && !AVATARS.includes(a)) throw new Error('Выбери значок из списка');
  return { name: n, avatar: a, color: c, motto: clean(motto, MAX_MOTTO) };
}

// Запись для сохранения. Поля здоровья в той же записи не трогаем.
export function saveProfileRecord(events, form, now = Date.now()) {
  const f = checkProfileForm(form);
  return makeProfile(f.name, now, profileOf(events), { avatar: f.avatar, color: f.color, motto: f.motto });
}
