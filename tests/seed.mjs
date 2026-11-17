// Демо-данные для скриншотов и проверок оформления: задачи, привычки, расходы, отметки дня, замеры, заметка, профиль, вещи дома.
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
  // «Дом»: четыре вещи с отметками «надел», «использовал» и «постирал» за последние дни (время записи разнесено по дням: заполнен и календарь активности профиля)
  const Hm = await import('./home.js'), ago = n => { const [y, m, dd] = d(-n).split('-').map(Number); return new Date(y, m - 1, dd, 12).getTime(); };       // полдень того дня по местному времени: день записи не зависит от часа запуска и перехода на летнее время
  const items = [Hm.makeItem({ name: 'Куртка зимняя', kind: 'clothes', place: 'Шкаф в прихожей', priceMinor: 1250000, care: { how: 'machine', temp: 30, washEveryWears: 15 } }, ago(120) + 1),
    Hm.makeItem({ name: 'Футболка белая', kind: 'clothes', care: { how: 'machine', temp: 40, washEveryWears: 1 } }, ago(60) + 2),
    Hm.makeItem({ name: 'Полотенце банное', kind: 'towels' }, ago(40) + 3), Hm.makeItem({ name: 'Чайник', kind: 'kitchen', place: 'Кухня', priceMinor: 350000 }, ago(30) + 4)];
  evs.push(...items);
  [[0, 'wear', 0], [0, 'wear', 2], [0, 'wear', 5], [1, 'wear', 0], [1, 'wear', 1], [1, 'wash', 1], [2, 'use', 1], [2, 'wash', 6], [3, 'use', 0], [3, 'use', 3]]
    .forEach(([i, kind, n], k) => evs.push(Hm.makeLog(items[i], kind, { date: d(-n) }, ago(n) + 10 + k)));
  await s.saveMany(evs);
});
  await page.waitForTimeout(400);
}
