// Забота и анти-перегрузка (care.js): «проверь себя», возвращение после болезни,
// долгая болезнь, перепроверка экстренных данных, «пережить день», выходные, входящие.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKUP_EVERY_DAYS, CHECKUP_MARKS, cleanCheckupMarks, checkupDue,
  sickReturnDay, sickLong, SICK_LONG_DAYS, DOCTOR_TASK_TEXT,
  EMERGENCY_EVERY_DAYS, emergencyReviewDue,
  surviveTasks, nextWeekend, newTasksToday, INFLOW_NUDGE_FROM,
} from '../care.js';
import { makeTask, addDays } from '../events.js';
import { startSick, endSick } from '../sick.js';

const TODAY = '2026-11-18';                  // среда
const noon = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, 12).getTime(); };
const sickEv = (from, to) => ({ id: `sick:${from}`, type: 'sick', ts: noon(from), payload: { from, to }, source: 'manual', confidence: 1, evidence: [] });

test('cleanCheckupMarks: принимает только полный набор из трёх известных отметок', () => {
  assert.deepEqual(cleanCheckupMarks({ body: 'ok', head: 'so', things: 'hard' }), { body: 'ok', head: 'so', things: 'hard' });
  assert.equal(cleanCheckupMarks({ body: 'ok', head: 'so' }), null, 'не хватает отметки — не записываем');
  assert.equal(cleanCheckupMarks({ body: 'ok', head: 'so', things: '5' }), null, 'цифр нет: чужое значение отброшено');
  assert.equal(cleanCheckupMarks(null), null);
  assert.equal(cleanCheckupMarks({ body: 'ok', head: 'ok', things: 'ok', extra: 'ok' }).extra, undefined, 'лишние ключи не сохраняются');
  for (const m of CHECKUP_MARKS) assert.ok(cleanCheckupMarks({ body: m, head: m, things: m }), `отметка ${m} допустима`);
});

test('checkupDue: не чаще раза в две недели', () => {
  assert.equal(checkupDue('', TODAY), true, 'ни разу не было — пора');
  assert.equal(checkupDue(null, TODAY), true, 'ключа нет — пора');
  assert.equal(checkupDue(TODAY, TODAY), false, 'сегодня уже отмечались');
  assert.equal(checkupDue(addDays(TODAY, -(CHECKUP_EVERY_DAYS - 1)), TODAY), false, '13 дней — ещё рано');
  assert.equal(checkupDue(addDays(TODAY, -CHECKUP_EVERY_DAYS), TODAY), true, 'ровно 14 дней — пора');
  assert.equal(checkupDue('не дата', TODAY), false, 'повреждённая дата не донимает напоминанием');
});

test('sickReturnDay: первый день после закрытого периода болезни', () => {
  const ended = sickEv(addDays(TODAY, -4), addDays(TODAY, -1));
  assert.equal(sickReturnDay([ended], TODAY)?.id, ended.id, 'болезнь закончилась вчера — сегодня день возвращения');
  assert.equal(sickReturnDay([ended], addDays(TODAY, 1)), null, 'послезавтра уже не первый день');
  assert.equal(sickReturnDay([sickEv(addDays(TODAY, -4), TODAY)], TODAY), null, 'болезнь закрыта сегодня — возвращение завтра');
  assert.equal(sickReturnDay([sickEv(addDays(TODAY, -4), null)], TODAY), null, 'открытый период — не возвращение');
  assert.equal(sickReturnDay([], TODAY), null);
});

test('sickLong: болезнь дольше трёх дней', () => {
  assert.equal(sickLong(sickEv('2026-11-10', addDays('2026-11-10', SICK_LONG_DAYS))), true, 'четыре дня с начала — долгая');
  assert.equal(sickLong(sickEv('2026-11-10', addDays('2026-11-10', SICK_LONG_DAYS - 1))), false, 'три дня — ещё не долгая');
  assert.equal(sickLong(sickEv('2026-11-10', null)), false, 'открытый период не предлагает врача при закрытии');
  assert.equal(sickLong(null), false);
});

test('endSick + sickLong: после долгой болезни предлагаем задачу к врачу', () => {
  const long = endSick(startSick([], { from: addDays(TODAY, -4) }, noon(addDays(TODAY, -4))), noon(TODAY));
  assert.equal(sickLong(long), true);
  const short = endSick(startSick([], { from: addDays(TODAY, -2) }, noon(addDays(TODAY, -2))), noon(TODAY));
  assert.equal(sickLong(short), false);
  assert.match(DOCTOR_TASK_TEXT, /врач/);
});

test('emergencyReviewDue: раз в полгода', () => {
  assert.equal(emergencyReviewDue('', TODAY), true, 'ни разу не подтверждал — пора спросить');
  assert.equal(emergencyReviewDue(TODAY, TODAY), false);
  assert.equal(emergencyReviewDue(addDays(TODAY, -(EMERGENCY_EVERY_DAYS - 1)), TODAY), false, '181 день — ещё рано');
  assert.equal(emergencyReviewDue(addDays(TODAY, -EMERGENCY_EVERY_DAYS), TODAY), true, 'полгода прошло');
  assert.equal(emergencyReviewDue('не дата', TODAY), false);
});

test('surviveTasks: только необязательные дела на сегодня и просроченные', () => {
  const normalToday = makeTask('полить цветы', noon(TODAY), { due: TODAY });
  const overdue = makeTask('разобрать почту', noon(addDays(TODAY, -1)), { due: addDays(TODAY, -1) });
  const high = makeTask('важный звонок', noon(TODAY), { due: TODAY, priority: 'high' });
  const future = makeTask('потом', noon(TODAY), { due: addDays(TODAY, 2) });
  const nodate = makeTask('без срока', noon(TODAY), {});
  const done = { ...makeTask('сделано', noon(TODAY), { due: TODAY }), payload: { ...makeTask('x', noon(TODAY), { due: TODAY }).payload, done: true } };
  const list = surviveTasks([normalToday, overdue, high, future, nodate, done], TODAY).map(e => e.payload.text);
  assert.deepEqual(list.sort(), ['полить цветы', 'разобрать почту'].sort());
});

test('nextWeekend: ближайшая суббота, в выходные — следующая', () => {
  assert.equal(nextWeekend(TODAY), '2026-11-21', 'со среды — эта суббота');
  assert.equal(nextWeekend('2026-11-21'), '2026-11-28', 'в субботу — следующая');
  assert.equal(nextWeekend('2026-11-22'), '2026-11-28', 'в воскресенье — следующая суббота');
  assert.equal(nextWeekend('2026-11-20'), '2026-11-21', 'в пятницу — завтра');
  assert.equal(nextWeekend('2026-11-23'), '2026-11-28', 'с понедельника — через пять дней');
});

test('newTasksToday: считает задачи, созданные сегодня', () => {
  const t1 = makeTask('раз', noon(TODAY));
  const t2 = makeTask('два', noon(TODAY));
  const old = makeTask('вчерашняя', noon(addDays(TODAY, -1)));
  assert.equal(newTasksToday([t1, t2, old], TODAY), 2);
  assert.equal(newTasksToday([old], TODAY), 0);
  const three = [t1, t2, makeTask('три', noon(TODAY))];
  assert.ok(newTasksToday(three, TODAY) >= INFLOW_NUDGE_FROM, 'с третьей новой задачи — мягкий вопрос');
});

test('newTasksToday: правка старой задачи — не новая задача', () => {
  // В журнале у одной задачи несколько версий с одним id: создание и правки. Считаем только создание.
  const created = makeTask('старая задача', noon(addDays(TODAY, -3)));
  const edited = { ...created, ts: noon(TODAY), payload: { ...created.payload, text: 'старая задача, поправленная сегодня' } };
  assert.equal(newTasksToday([created, edited], TODAY), 0, 'правка сегодня не делает задачу новой');
  const fresh = makeTask('новая задача', noon(TODAY));
  const freshEdit = { ...fresh, ts: noon(TODAY) + 60000 };
  assert.equal(newTasksToday([created, edited, fresh, freshEdit], TODAY), 1, 'одна настоящая новая, остальное — правки');
});
