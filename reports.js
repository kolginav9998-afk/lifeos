// Отчёты в виде текста (Markdown): итоги месяца и сводка для врача, а также панель сна. Только факты из данных, без диагнозов.
import { addDays, todayStr, daysBetween } from './events.js';
import { summarizeMonth, formatMoney, shiftMonth, monthLabel, balanceOfMonth } from './money.js';
import { activeHabits, logsOf } from './habits.js';
import { checkinOf, dayMood, hashtags } from './diary.js';
import { measuresOf, dailySeries, linearTrend, bmi, bmiNote, healthProfile, ageFromBirthYear, formatMeasure, measureLabel } from './health.js';
import { runsOf } from './bt-core.js';
import { analyzeRuns, insights } from './bt-analytics.js';
import { doneWorkouts, strengthDays } from './workouts.js';
import { focusWeek } from './focus.js';
import { median, mean, sd, round } from './stats.js';
import { medsOf, adherence, WHEN } from './meds.js';
import { sickCount } from './sick.js';
import { practiceBy } from './practice.js';

const f1 = v => String(Math.round(v * 10) / 10).replace('.', ',');
const f0 = v => String(Math.round(v));
const dim = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const rangeDays = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const hmToMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '')); return m ? +m[1] * 60 + +m[2] : null; };
// Время «ночью» (после полуночи) и «вечером» нужно сравнивать по кругу: 23:30 и 00:30 — это час разницы.
function circularSd(minutes) {
  if (minutes.length < 3) return null;
  const ang = minutes.map(m => (m / 1440) * 2 * Math.PI);
  const C = mean(ang.map(Math.cos)), S = mean(ang.map(Math.sin));
  const R = Math.min(1, Math.hypot(C, S));
  return Math.sqrt(-2 * Math.log(Math.max(R, 1e-9))) * (1440 / (2 * Math.PI));
}

// ---------- сон ----------
export function sleepPanel(events, today, n = 14, target = 7) {
  const days = rangeDays(addDays(today, -(n - 1)), today).map(date => ({ date, hours: checkinOf(events, date, 'm')?.payload.sleepHours ?? null }));
  const hours = days.map(d => d.hours).filter(Number.isFinite);
  const wakes = days.map(d => hmToMin(checkinOf(events, d.date, 'm')?.payload.wake)).filter(Number.isFinite);
  const beds = days.map(d => hmToMin(checkinOf(events, d.date, 'm')?.payload.bed)).filter(Number.isFinite);
  const wakeSd = circularSd(wakes), bedSd = circularSd(beds);
  const worst = hours.length ? Math.min(...hours) : null, best = hours.length ? Math.max(...hours) : null;
  const weekHours = days.slice(-7).map(d => d.hours).filter(Number.isFinite);
  return {
    days, nights: hours.length, avg: hours.length ? mean(hours) : null, best, worst,
    under: hours.filter(h => h < target).length, target,
    debt: weekHours.length ? Math.max(0, target * weekHours.length - weekHours.reduce((a, b) => a + b, 0)) : null, debtNights: weekHours.length,
    wakeSd, bedSd,
    regularity: wakeSd === null ? null : wakeSd < 30 ? 'stable' : wakeSd < 60 ? 'mid' : 'irregular',
  };
}
export const REGULARITY_TEXT = { stable: 'стабильный (разброс подъёма меньше 30 минут)', mid: 'средний (разброс подъёма 30–60 минут)', irregular: 'нерегулярный (разброс подъёма больше часа)' };

// ---------- итоги месяца ----------
export function monthReport(events, ym, { now = Date.now() } = {}) {
  const today = todayStr(now);
  const from = `${ym}-01`, last = `${ym}-${String(dim(ym)).padStart(2, '0')}`;
  const to = today < last && today >= from ? today : last;
  const days = rangeDays(from, to);
  const prevYm = shiftMonth(ym, -1);
  const L = [`# Мой месяц: ${monthLabel(ym)}`, '', `_Составлено приложением Life OS по моим записям (${today}). Это наблюдения, а не диагнозы._`, ''];

  // задачи
  const doneIn = (a, b) => events.filter(e => e.type === 'task' && e.payload.done && e.payload.doneAt && todayStr(e.payload.doneAt) >= a && todayStr(e.payload.doneAt) <= b).length;
  const prevFrom = `${prevYm}-01`, prevTo = `${prevYm}-${String(dim(prevYm)).padStart(2, '0')}`;
  const tasks = doneIn(from, to);
  L.push('## Задачи', `- Сделано: ${tasks} (в прошлом месяце: ${doneIn(prevFrom, prevTo)})`, `- Открытых сейчас: ${events.filter(e => e.type === 'task' && !e.payload.done).length}`, '');

  // привычки
  const hs = activeHabits(events, to);
  if (hs.length) {
    L.push('## Привычки');
    for (const { h } of hs) {
      const hits = logsOf(events, h.id).filter(l => l.payload.date >= from && l.payload.date <= to).length;
      const start = h.payload.startDate > from ? h.payload.startDate : from;
      const span = Math.max(1, daysBetween(start, to) + 1);
      L.push(`- ${h.payload.name}: ${hits} из ${span} дн. (${Math.round(Math.min(1, hits / span) * 100)}%)`);
    }
    L.push('');
  }

  // время на главное: учёба, фокус, тренировки
  const studyMin = Object.values(practiceBy(events, from, to)).reduce((n, r) => n + r.total, 0);
  const focusMin = events.filter(e => e.type === 'focus' && e.payload.date >= from && e.payload.date <= to).reduce((n, e) => n + e.payload.minutes, 0);
  const workMin = doneWorkouts(events).filter(e => e.payload.date >= from && e.payload.date <= to).reduce((n, e) => n + (e.payload.minutes || 0), 0);
  if (studyMin || focusMin || workMin) L.push('## Время на главное', `- Учёба: ${studyMin} мин (уроки по плану, говорение по записи, карточки по 15 секунд на ответ)`, `- Фокус: ${focusMin} мин`, `- Тренировки: ${workMin} мин`, '');

  // болезнь
  const sickN = sickCount(events, from, to, today);
  if (sickN) L.push('## Болезнь', `- Дней в режиме болезни: ${sickN} (привычки и серии в эти дни стояли на паузе)`, '');

  // деньги
  const exp = summarizeMonth(events, ym, 'expense'), inc = summarizeMonth(events, ym, 'income'), prevExp = summarizeMonth(events, prevYm, 'expense');
  if (exp.count || inc.count) {
    L.push('## Деньги');
    L.push(`- Расходы: ${formatMoney(exp.total)}${prevExp.total ? ` (в прошлом месяце ${formatMoney(prevExp.total)})` : ''}`);
    if (inc.count) L.push(`- Доходы: ${formatMoney(inc.total)}; баланс ${formatMoney(balanceOfMonth(events, ym).balance)}`);
    for (const c of exp.byCategory.slice(0, 5)) L.push(`  - ${c.category}: ${formatMoney(c.total)} (${Math.round(c.share * 100)}%)`);
    L.push('');
  }

  // сон и самочувствие
  const sl = sleepPanel(events, to, days.length);
  const wellbeing = days.map(d => ({ mood: dayMood(events, d), energy: checkinOf(events, d, 'e')?.payload.energy ?? checkinOf(events, d, 'm')?.payload.energy, stress: checkinOf(events, d, 'e')?.payload.stress ?? checkinOf(events, d, 'm')?.payload.stress }));
  const avgOf = k => { const v = wellbeing.map(x => x[k]).filter(Number.isFinite); return v.length ? mean(v) : null; };
  if (sl.nights || avgOf('mood') !== null) {
    L.push('## Сон и самочувствие');
    if (sl.nights) L.push(`- Сон: в среднем ${f1(sl.avg)} ч (ночей с отметкой: ${sl.nights}); лучшая ${f1(sl.best)}, худшая ${f1(sl.worst)}; меньше ${sl.target} ч: ${sl.under}`);
    if (sl.regularity) L.push(`- Режим: ${REGULARITY_TEXT[sl.regularity]}`);
    if (avgOf('mood') !== null) L.push(`- Настроение: ${f1(avgOf('mood'))} из 5${avgOf('energy') !== null ? `, энергия ${f1(avgOf('energy'))}` : ''}${avgOf('stress') !== null ? `, стресс ${f1(avgOf('stress'))}` : ''}`);
    L.push('');
  }

  // здоровье и движение
  const hl = [];
  const weight = dailySeries(events, 'weight').filter(p => p.date >= from && p.date <= to);
  if (weight.length >= 2) hl.push(`- Вес: ${f1(weight[0].value)} → ${f1(weight.at(-1).value)} кг (${weight.at(-1).value - weight[0].value > 0 ? '+' : weight.at(-1).value - weight[0].value < 0 ? '−' : ''}${f1(Math.abs(weight.at(-1).value - weight[0].value))})`);
  else if (weight.length === 1) hl.push(`- Вес: ${f1(weight[0].value)} кг`);
  const bps = measuresOf(events, 'bp').filter(e => e.payload.date >= from && e.payload.date <= to);
  if (bps.length) hl.push(`- Давление: в среднем ${f0(mean(bps.map(e => e.payload.value)))}/${f0(mean(bps.map(e => e.payload.value2)))} (замеров: ${bps.length})`);
  const exMin = days.map(d => checkinOf(events, d, 'e')?.payload.exercise).filter(Number.isFinite);
  if (exMin.length) hl.push(`- Активность: ${exMin.reduce((a, b) => a + b, 0)} мин за ${exMin.length} дн. с отметкой`);
  const wk = doneWorkouts(events).filter(w => w.payload.date >= from && w.payload.date <= to);
  if (wk.length) hl.push(`- Тренировок: ${wk.length}; силовых дней: ${new Set(wk.filter(w => w.payload.exercises.some(e => e.kind !== 'cardio')).map(w => w.payload.date)).size}`);
  const fc = events.filter(e => e.type === 'focus' && e.payload.date >= from && e.payload.date <= to);
  if (fc.length) hl.push(`- Фокус: ${fc.reduce((s, e) => s + e.payload.minutes, 0)} мин в ${fc.length} сессиях`);
  if (hl.length) L.push('## Здоровье и движение', ...hl, '');

  // развитие
  const gl = [];
  const lessons = events.filter(e => e.type === 'lesson' && e.payload.date >= from && e.payload.date <= to).length;
  const reviews = events.filter(e => e.type === 'srs').reduce((n, e) => n + (e.payload.hist || []).filter(h => h[0] >= from && h[0] <= to).length, 0);
  if (lessons || reviews) gl.push(`- Учёба: уроков ${lessons}, ответов на карточки ${reviews}`);
  const runs = runsOf(events).filter(r => r.date >= from && r.date <= to);
  if (runs.length) {
    const an = analyzeRuns(runsOf(events));
    const comps = an.perRun.filter(r => r.date >= from && r.date <= to && r.composite !== null).map(r => r.composite);
    gl.push(`- Проверки: ${runs.length}${comps.length ? `; общий результат в среднем ${comps.reduce((a, b) => a + b, 0) / comps.length >= 0 ? '+' : '−'}${f1(Math.abs(mean(comps)))}σ относительно моей нормы` : ''}`);
  }
  const exps = events.filter(e => e.type === 'experiment' && !e.payload.cancelled && e.payload.startDate >= from && e.payload.startDate <= to);
  if (exps.length) gl.push(`- Эксперименты начато: ${exps.map(e => e.payload.title).join('; ')}`);
  if (gl.length) L.push('## Развитие', ...gl, '');

  // дневник (без текстов)
  const diary = events.filter(e => e.type === 'diary' && e.payload.date >= from && e.payload.date <= to);
  if (diary.length) {
    const tags = new Map();
    for (const d of diary) for (const t of d.payload.tags || hashtags(d.payload.text)) tags.set(t, (tags.get(t) || 0) + 1);
    const top = [...tags].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => `#${t} (${n})`);
    L.push('## Дневник', `- Записей: ${diary.length} из ${days.length} дней${top.length ? `; частые темы: ${top.join(', ')}` : ''}`, '');
  }

  // наблюдения аналитики: заголовки и осторожные пояснения (числа и метод, без личных текстов)
  const ins = insights(events, now).filter(i => !['empty', 'need-more', 'need-checkins', 'no-relations'].includes(i.id)).slice(0, 4);
  if (ins.length) {
    L.push('## Что заметила аналитика (осторожно)');
    for (const i of ins) L.push(`- **${i.title}.** ${i.text}`);
    L.push('', '_Это связи и наблюдения по моим данным, а не доказанные причины. Чем больше дней с отметками, тем они надёжнее._', '');
  }
  L.push('## Мои выводы и планы на следующий месяц', '', '- ', '- ', '- ', '');
  return L.join('\n');
}

// ---------- сводка для врача ----------
export function doctorSummary(events, today, { days = 30, now = Date.now() } = {}) {
  const from = addDays(today, -(days - 1));
  const prof = healthProfile(events);
  const L = [`# Сводка для врача: ${days} дней до ${today}`, '', '_Составлена приложением Life OS по моим собственным записям. Это не диагноз и не заменяет осмотр; данные вводились вручную._', ''];
  const age = prof.birthYear ? ageFromBirthYear(prof.birthYear, now) : null;
  const pl = [age ? `возраст ${age}` : '', prof.heightCm ? `рост ${f0(prof.heightCm)} см` : '', prof.goalWeight ? `цель по весу ${f1(prof.goalWeight)} кг` : ''].filter(Boolean);
  if (pl.length) L.push('## Профиль', `- ${pl.join(' · ')}`, '');

  const w = dailySeries(events, 'weight').filter(p => p.date >= from && p.date <= today);
  if (w.length) {
    const tr = linearTrend(w);
    const vals = w.map(p => p.value);
    L.push('## Вес', `- Записей: ${w.length}; первая ${f1(w[0].value)} кг (${w[0].date}), последняя ${f1(w.at(-1).value)} кг (${w.at(-1).date}); от ${f1(Math.min(...vals))} до ${f1(Math.max(...vals))}`);
    if (tr) L.push(`- Тренд: ${tr.perWeek > 0 ? '+' : tr.perWeek < 0 ? '−' : ''}${f1(Math.abs(tr.perWeek))} кг в неделю`);
    if (prof.heightCm) { const b = bmi(w.at(-1).value, prof.heightCm); if (b) L.push(`- ИМТ ${f1(b)} (${bmiNote(b)}; ориентир, не диагноз)`); }
    L.push('');
  }
  const bps = measuresOf(events, 'bp').filter(e => e.payload.date >= from && e.payload.date <= today);
  const pulses = measuresOf(events, 'pulse').filter(e => e.payload.date >= from && e.payload.date <= today);
  if (bps.length || pulses.length) {
    L.push('## Давление и пульс');
    if (bps.length) {
      L.push(`- Давление: замеров ${bps.length}, в среднем ${f0(mean(bps.map(e => e.payload.value)))}/${f0(mean(bps.map(e => e.payload.value2)))}; максимум ${Math.max(...bps.map(e => e.payload.value))}/${Math.max(...bps.map(e => e.payload.value2))}`);
      L.push('- Последние замеры: ' + bps.slice(-10).map(e => `${e.payload.date}${e.payload.time ? ' ' + e.payload.time : ''} ${e.payload.value}/${e.payload.value2}`).join('; '));
    }
    if (pulses.length) L.push(`- Пульс: замеров ${pulses.length}, в среднем ${f0(mean(pulses.map(e => e.payload.value)))} уд/мин (от ${Math.min(...pulses.map(e => e.payload.value))} до ${Math.max(...pulses.map(e => e.payload.value))})`);
    L.push('');
  }
  const sickN = sickCount(events, from, today, today);
  if (sickN) L.push('## Самочувствие', `- Дней в режиме болезни за период: ${sickN}`, '');
  const sl = sleepPanel(events, today, days, 7);
  if (sl.nights) L.push('## Сон', `- В среднем ${f1(sl.avg)} ч (ночей с отметкой: ${sl.nights}); меньше 7 ч: ${sl.under}`, ...(sl.regularity ? [`- Режим: ${REGULARITY_TEXT[sl.regularity]}`] : []), '');
  const dayList = rangeDays(from, today);
  const moods = dayList.map(d => dayMood(events, d)).filter(Number.isFinite);
  const stress = dayList.map(d => checkinOf(events, d, 'e')?.payload.stress ?? checkinOf(events, d, 'm')?.payload.stress).filter(Number.isFinite);
  const energy = dayList.map(d => checkinOf(events, d, 'e')?.payload.energy ?? checkinOf(events, d, 'm')?.payload.energy).filter(Number.isFinite);
  if (moods.length) L.push('## Самочувствие (оценки 1–5)', `- Настроение ${f1(mean(moods))}${energy.length ? `, энергия ${f1(mean(energy))}` : ''}${stress.length ? `, стресс ${f1(mean(stress))}` : ''} (дней с отметкой: ${moods.length})`, '');
  const ex = dayList.map(d => checkinOf(events, d, 'e')?.payload.exercise).filter(Number.isFinite);
  const wkDays = strengthDays(events, today, days);
  if (ex.length || wkDays) L.push('## Активность', ...(ex.length ? [`- По отметкам: ${f0(ex.reduce((a, b) => a + b, 0) / (days / 7))} мин в неделю в среднем`] : []), ...(wkDays ? [`- Силовых дней за период: ${wkDays}`] : []), '');
  const others = ['glucose', 'temp', 'waist'].map(k => { const m = measuresOf(events, k).filter(e => e.payload.date >= from && e.payload.date <= today); return m.length ? `- ${measureLabel(m[0].payload)}: ${m.slice(-5).map(e => `${e.payload.date} ${formatMeasure(e.payload)}`).join('; ')}` : null; }).filter(Boolean);
  if (others.length) L.push('## Другие замеры', ...others, '');
  const meds = medsOf(events).filter(m => m.payload.active);
  const adh = new Map(adherence(events, today, Math.min(days, 14)).map(a => [a.med.id, a]));
  L.push('## Что я хочу обсудить', '', '- ', '- ', '- ', '', '## Лекарства и добавки, которые принимаю', '');
  if (meds.length) for (const m of meds) { const a = adh.get(m.id); L.push(`- ${m.payload.name}${m.payload.dose ? ` ${m.payload.dose}` : ''}, ${WHEN[m.payload.when]}${a ? ` (отмечено ${a.taken} из ${a.of} дн.)` : ''}`); }
  else L.push('- ');
  L.push('');
  return L.join('\n');
}
