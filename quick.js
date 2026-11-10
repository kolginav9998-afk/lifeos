// Разбор дат и повторов прямо в тексте задачи: «купить хлеб завтра», «оплатить жильё 10 числа каждого месяца».
// Это обычные правила, без ИИ и без сети. Если уверенности нет — ничего не меняем.
import { addDays, todayStr, isYmd } from './events.js';

const WD = { понедельник: 1, вторник: 2, среду: 3, среда: 3, четверг: 4, пятницу: 5, пятница: 5, субботу: 6, суббота: 6, воскресенье: 0 };
const MONTHS = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
const WD_RE = 'понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье';
const PRE = '(?:(?:до|на|к|в|во|с)\\s+)?';
const re = p => new RegExp(`(?<![\\p{L}\\d])${p}(?![\\p{L}\\d])`, 'iu');

const dim = (y, m) => new Date(y, m, 0).getDate();
const parts = s => s.split('-').map(Number);
function pad(n) { return String(n).padStart(2, '0'); }
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function nextDayOfMonth(day, today) {          // ближайшее «N-е число» не раньше сегодня
  const [y, m, d] = parts(today);
  const c = Math.min(day, dim(y, m));
  if (c >= d) return ymd(y, m, c);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return ymd(ny, nm, Math.min(day, dim(ny, nm)));
}
function nextWeekday(wd, today) {              // строго после сегодня
  const [y, m, d] = parts(today);
  const cur = new Date(y, m - 1, d, 12).getDay();
  let diff = (wd - cur + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(today, diff);
}
function nextDate(day, month, today) {         // «15 ноября»: ближайшая такая дата, прошедшую переносим на год
  const [y, m, d] = parts(today);
  for (const yy of [y, y + 1]) {
    if (day > dim(yy, month)) continue;
    const c = ymd(yy, month, day);
    if (c >= today) return c;
  }
  return null;
}

export function parseQuick(input, now = Date.now()) {
  const original = String(input ?? '');
  let text = original;
  const today = todayStr(now);
  let due = null, repeat = null, day = null;
  const found = [];
  const take = (m, label) => { text = text.replace(m[0], ' '); found.push(label); };

  // повтор
  let m;
  if ((m = text.match(re(`кажд(?:ый|ую|ое)\\s+(${WD_RE})`)))) { repeat = 'weekly'; due = nextWeekday(WD[m[1].toLowerCase()], today); take(m, 'каждую неделю'); }
  else if ((m = text.match(re('(?:каждый\\s+день|ежедневно)')))) { repeat = 'daily'; take(m, 'каждый день'); }
  else if ((m = text.match(re('(?:каждую\\s+неделю|еженедельно)')))) { repeat = 'weekly'; take(m, 'каждую неделю'); }
  else if ((m = text.match(re('(?:каждый\\s+месяц|каждого\\s+месяца|ежемесячно)')))) { repeat = 'monthly'; take(m, 'каждый месяц'); }
  else if ((m = text.match(re('кажд(?:ого|ое)\\s+(\\d{1,2})(?:-?го)?(?:\\s+числа)?')))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 31) { repeat = 'monthly'; day = n; take(m, 'каждый месяц'); }
  }

  // дата (первое совпадение по приоритету)
  if (!due) {
    if ((m = text.match(re(`${PRE}(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})`)))) {
      const d = nextDate(Number(m[1]), MONTHS[m[2].toLowerCase()], today);
      if (d) { due = d; take(m, 'дата'); }
    }
  }
  if (!due && (m = text.match(re(`${PRE}через\\s+(\\d{1,3})\\s+(?:день|дня|дней|дн)`)))) { due = addDays(today, Number(m[1])); take(m, 'через N дней'); }
  if (!due && (m = text.match(re(`${PRE}через\\s+(\\d{1,2})\\s+(?:неделю|недели|недель|нед)`)))) { due = addDays(today, 7 * Number(m[1])); take(m, 'через N недель'); }
  if (!due && (m = text.match(re(`${PRE}через\\s+неделю`)))) { due = addDays(today, 7); take(m, 'через неделю'); }
  if (!due && (m = text.match(re(`${PRE}послезавтра`)))) { due = addDays(today, 2); take(m, 'послезавтра'); }
  if (!due && (m = text.match(re(`${PRE}завтра`)))) { due = addDays(today, 1); take(m, 'завтра'); }
  if (!due && (m = text.match(re(`${PRE}сегодня`)))) { due = today; take(m, 'сегодня'); }
  if (!due && (m = text.match(re(`(?:в|во)\\s+(${WD_RE})`)))) { due = nextWeekday(WD[m[1].toLowerCase()], today); take(m, 'день недели'); }
  if (!due && (m = text.match(re(`${PRE}(\\d{1,2})(?:-?го)?\\s+числа`)))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 31) { day = day ?? n; due = nextDayOfMonth(n, today); take(m, 'число месяца'); }
  }
  if (repeat === 'monthly' && day && !due) due = nextDayOfMonth(day, today);

  text = text.replace(/\s+/g, ' ').replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '').trim();
  if (!text || (!due && !repeat) || (due && !isYmd(due))) return { text: original.trim(), due: null, repeat: null, found: [] };
  return { text, due, repeat, found };
}
