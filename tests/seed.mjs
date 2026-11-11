// Демо-данные для скриншотов и проверок оформления: задачи, привычки, расходы, отметки дня, замеры, заметка, профиль.
export async function seedDemo(page) {
  await page.evaluate(async () => {
  const s = await import('./store.js'); const E = await import('./events.js'); const H = await import('./habits.js');
  const M = await import('./money.js'); const D = await import('./diary.js'); const Hl = await import('./health.js'); const N = await import('./notes.js');
  const today = E.todayStr(); const d = n => E.addDays(today, n); const now = Date.now();
  const evs = [];
  evs.push(E.makeProfile('Анна Петрова', now, null, { avatar: '🦊', color: 'violet', motto: 'Шаг за шагом' }));
  evs.push(E.makeTask('Позвонить в банк', now, { due: today }));
  evs.push(E.makeTask('Купить продукты на неделю', now + 1, { due: today }));
  evs.push(E.makeTask('Подготовить отчёт для встречи', now + 2, { due: d(1) }));
  evs.push(E.makeTask('Записаться к врачу', now + 3, { due: d(-1) }));
  const done = E.makeTask('Оплатить интернет', now + 4, { due: today }); done.payload.done = true; done.payload.doneAt = now; evs.push(done);
  const hs = [H.makeHabit({ name: 'Зарядка 10 минут', minimum: '1 минута', full: '10 минут', anchor: 'после чистки зубов' }, now), H.makeHabit({ name: 'Чтение перед сном', minimum: '1 страница', full: '20 минут' }, now + 1), H.makeHabit({ name: 'Стакан воды утром', minimum: 'глоток', full: 'стакан' }, now + 2)];
  evs.push(...hs);
  for (let i = 0; i < 14; i++) for (const [k, h] of hs.entries()) if ((i + k) % 3 !== 2) evs.push(H.makeHabitLog(h, d(-i), (i + k) % 2 ? 'full' : 'min', now + i));
  const cats = ['Еда', 'Транспорт', 'Дом', 'Здоровье', 'Развлечения'];
  for (let i = 0; i < 12; i++) evs.push(M.makeExpense({ amount: String(300 + ((i * 370) % 2400)), category: cats[i % cats.length], note: '', date: d(-(i % 9)) }, now + i));
  evs.push(M.makeIncome({ amount: '85000', category: 'Зарплата', date: d(-3) }, now));
  evs.push(M.makeBudget(7000000, now));
  for (let i = 0; i < 8; i++) {
    evs.push(D.makeCheckin('m', d(-i), { sleepQuality: 3 + (i % 3), energy: 2 + (i % 4), mood: 3 + (i % 3), stress: 2 + (i % 3), sleepHours: 6.5 + (i % 4) * 0.5 }, '', now + i));
    evs.push(D.makeCheckin('e', d(-i), { mood: 3 + ((i + 1) % 3), energy: 3, stress: 2, focus: 3 + (i % 3), productivity: 3 + (i % 2), social: 3 }, 'Хороший день', now + i));
    evs.push(Hl.makeMeasure({ kind: 'weight', value: 72.4 - i * 0.15, date: d(-i) }, now + i));
  }
  evs.push(Hl.makeMeasure({ kind: 'bp', value: 122, value2: 79, date: d(-1) }, now));
  evs.push(N.makeNote('Идея: сделать недельный обзор по воскресеньям\nи записывать три главных вывода', now));
  await s.saveMany(evs);
});
  await page.waitForTimeout(400);
}
