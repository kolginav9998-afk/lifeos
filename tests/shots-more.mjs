// Полный обзор оформления: все экраны и состояния, обе темы, разные ширины, масштаб шрифта, пустые данные.
// Использование: node tests/shots-more.mjs <метка> [--theme=dark,light] [--w=390,320] [--fs=1,1.3] [--data=seed,empty] [--only=today,habits] [--dpr=1] [--slices=4] [--motion=1]
// Длинные экраны режутся на куски высотой в окно и склеиваются в одну картинку по горизонтали (shots/<метка>-<данные>-<ширина>[-fs][-тема]-<экран>.png).
import fs from 'node:fs';
import path from 'node:path';
import { launch, tab, until } from './helpers.mjs';
import { seedDemo } from './seed.mjs';

const args = process.argv.slice(2);
const tag = args[0] && !args[0].startsWith('--') ? args[0] : 'shot';
const opt = (k, d) => (args.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1];
const list = (k, d) => opt(k, d).split(',').filter(Boolean);
const themes = list('theme', 'dark,light'), widths = list('w', '390').map(Number), scales = list('fs', '1').map(Number), datas = list('data', 'seed');
const only = list('only', ''), dpr = Number(opt('dpr', 1)), maxSlices = Number(opt('slices', 4)), motion = opt('motion', 0) === '1' ? 'no-preference' : 'reduce';
const outDir = path.resolve(import.meta.dirname, '../shots');
fs.mkdirSync(outDir, { recursive: true });
const H = 844;

// ---------- дополнительные демо-данные: люди, тренировки, цели, навыки, решения, проверки, уроки ----------
async function seedMore(page) {
  await page.evaluate(async () => {
    const s = await import('./store.js'); const E = await import('./events.js');
    const P = await import('./people.js'); const W = await import('./workouts.js'); const O = await import('./okr.js'); const Pl = await import('./planning.js');
    const Sk = await import('./skills.js'); const R = await import('./reflect.js'); const A = await import('./academy.js'); const T = await import('./bt-core.js');
    const D = await import('./diary.js'); const Th = await import('./thoughts.js'); const Fo = await import('./focus.js'); const Ac = await import('./academy.js');
    const today = E.todayStr(); const d = n => E.addDays(today, n); const now = Date.now(); const evs = [];
    const person = (name, bd, cad, last, note) => { const p = P.makePerson({ name, birthday: bd, cadenceDays: cad, note }, now); if (last !== null) p.payload.lastContact = d(last); return p; };
    evs.push(person('Мама', '14.11', 7, -9, 'Позвонить в воскресенье'), person('Сергей', '03.12.1988', 30, -41, ''), person('Лена', '', 14, -3, 'Книга про сон'), person('Дмитрий', '21.11', 0, null, ''));
    // тренировки
    for (const [k, off] of [[0, -1], [1, -3], [2, -6]]) {
      let w = W.startWorkout({ templateId: null, name: ['Силовая: верх', 'Ноги и корпус', 'Лёгкая силовая'][k], date: d(off), now: now - (-off) * 86400000 });
      w = W.addExercise(w, 'Подтягивания'); w = W.addSet(w, 0, { reps: 8 + k, kg: 0 }); w = W.addSet(w, 0, { reps: 7, kg: 0 });
      w = W.addExercise(w, 'Жим гантелей'); w = W.addSet(w, 1, { reps: 10, kg: 20 + k * 2 }); w = W.addSet(w, 1, { reps: 9, kg: 22 });
      w = W.finishWorkout(w, { rpe: 6 + k, now: now - (-off) * 86400000 + 2400000 }); evs.push(w);
    }
    // цели
    evs.push(O.makeOkr({ title: 'Подготовиться к собеседованию', why: 'Хочу новую работу до конца квартала', due: d(40), krs: [{ text: 'Решить задач', target: 30, unit: 'шт' }, { text: 'Пробных собеседований', target: 4, unit: '' }] }, now));
    const okr2 = O.makeOkr({ title: 'Быть в форме', why: '', due: d(25), krs: [{ text: 'Тренировок', target: 12, unit: '' }] }, now + 1); okr2.payload.krs[0].current = 9; evs.push(okr2);
    const okr1 = evs.find(e => e.type === 'okr'); okr1.payload.krs[0].current = 11; okr1.payload.krs[1].current = 1;
    // планы: лимиты, копилки, подписки
    evs.push(Pl.makeLimit('Еда', 500000, now), Pl.makeLimit('Транспорт', 450000, now), Pl.makeLimit('Развлечения', 300000, now));
    const g = Pl.makeGoal({ title: 'Отпуск у моря', targetMinor: 15000000, dueDate: d(150) }, now); evs.push(g, Pl.makeGoalMove(g.id, 4200000, { date: d(-10) }, now));
    evs.push(Pl.makeSub({ name: 'Музыка', amountMinor: 29900, period: 'month', day: 12 }, now), Pl.makeSub({ name: 'Облако', amountMinor: 99000, period: 'year', day: 3, month: 12 }, now));
    // навыки и решения
    evs.push(Sk.makeSkill({ title: 'Могу объяснить, как работает сложный процент', area: 'Деньги', level: 2, date: d(-5) }, now), Sk.makeSkill({ title: 'Делаю планку 2 минуты', area: 'Здоровье', level: 3, date: d(-2) }, now + 1), Sk.makeSkill({ title: 'Читаю простые тексты по-английски', area: 'Языки', level: 1, date: d(-8) }, now + 2));
    evs.push(R.makeDecision({ title: 'Перейти на удалённую работу два дня в неделю', why: 'Меньше дороги, больше времени на сон', expect: 'Энергии станет больше', revisit: today }, now));
    evs.push(R.makeJoy({ text: 'Прогулка у реки после работы', date: d(-1) }, now), R.makeCharger('Тёплый душ и тишина 10 минут', now));
    evs.push(R.makeDayReview(d(-1), { win: 'Закончил отчёт и успел на тренировку', miss: 'Поздно лёг спать', learn: 'Телефон убирать за час до сна' }, now));
    evs.push(R.makeWeekReflection(today, { went: 'Три тренировки и прогулки', blocked: 'Недосып', change: 'Ложиться до 23:30' }, now));
    evs.push(Th.makeThought({ date: d(-2), situation: 'Задержали ответ по работе', thought: 'Я всё делаю не так', emotion: 'тревога', before: 7, alt: 'Ответ просто задержался', after: 4 }, now));
    // проверки: серия прохождений (хватит для личной нормы)
    for (let i = 7; i >= 1; i--) {
      const base = new Date(); base.setDate(base.getDate() - i); base.setHours(9, 15, 0, 0);
      const k = (i * 37) % 11;
      const payload = T.makeRun({ mode: 'quick', startedAt: base.getTime(), durationMs: 280000, state: { energy: 3 + (i % 3), mood: 3 + (i % 2) },
        results: {
          reaction: { metrics: { n: 5, median: 262 + k * 3, mean: 270 + k * 3, sd: 38, best: 230, lapses: i % 3 ? 0 : 1, falseStarts: 0 }, ms: 6000 },
          gonogo: { metrics: { n: 16, hits: 10, omissions: 0, commissions: i % 4 ? 0 : 1, correctRejections: 6, accuracy: 0.94, inhibition: 0.9, medianRT: 340, dPrime: 3.1 - k * 0.04 }, ms: 9000 },
          math: { metrics: { n: 18 + (i % 5), correct: 16 + (i % 4), accuracy: 0.9, meanMs: 2300, perMinute: 21 + (i % 4), maxLevel: 3 }, ms: 45000 } } });
      evs.push(T.makeRunEvent(payload, base.getTime()));
    }
    // уроки и карточки: курс английского начат
    const track = Ac.trackById('english');
    track.lessons.slice(0, 3).forEach((l, i) => evs.push(Ac.makeLessonDone(track, l, d(-i - 1), now - i)));
    await s.saveMany(evs);
  });
  await page.waitForTimeout(300);
}

// ---------- сцены ----------
const S = [];
const scene = (name, fn, o = {}) => S.push({ name, fn, ...o });
for (const id of ['today', 'habits', 'people', 'diary', 'health', 'workouts', 'notes', 'reflect', 'learn', 'skills', 'tests', 'insights', 'okr', 'money', 'plans', 'more', 'account']) scene(id, p => tab(p, id));
const trackOpen = async p => { await tab(p, 'learn'); await p.click('.track-card[data-track="english"]'); await p.waitForSelector('.lesson'); };
scene('learn-track', trackOpen, { after: p => p.click('#learn-back') });
scene('learn-lesson', async p => { await trackOpen(p); await p.click('.lesson[data-lesson="en-02"] summary'); }, { after: p => p.click('#learn-back') });
scene('learn-flash-q', async p => { await trackOpen(p); await p.click('#track-start'); await p.waitForSelector('#sess-q'); }, { viewport: true, after: p => p.click('#sess-close').then(() => p.click('#learn-back')) });
scene('learn-flash-a', async p => { await trackOpen(p); await p.click('#track-start'); await p.waitForSelector('#sess-q'); await p.click('#sess-show'); }, { viewport: true, after: p => p.click('#sess-close').then(() => p.click('#learn-back')) });
const testStart = async (p, id) => { await tab(p, 'tests'); await p.click(`#bt-single-${id}`); await p.waitForSelector('#bt-state-skip'); };
scene('tests-state', async p => { await testStart(p, 'math'); }, { viewport: true, after: p => p.click('#bt-abort') });
scene('tests-intro', async p => { await testStart(p, 'math'); await p.click('#bt-state-skip'); await p.waitForSelector('#bt-go'); }, { viewport: true, after: p => p.click('#bt-abort') });
scene('tests-count', async p => { await testStart(p, 'math'); await p.click('#bt-state-skip'); await p.click('#bt-go'); await p.waitForSelector('#bt-count'); }, { viewport: true, after: p => p.click('#bt-abort') });
scene('tests-run', async p => { await testStart(p, 'math'); await p.click('#bt-state-skip'); await p.click('#bt-go'); await p.waitForSelector('.bt-problem', { timeout: 8000 }); }, { viewport: true, after: p => p.click('#bt-abort') });
scene('tests-result', async p => { await testStart(p, 'recall'); await p.click('#bt-state-skip'); await p.waitForSelector('#bt-result', { timeout: 8000 }); }, { viewport: true, after: p => p.click('#bt-done') });
scene('tests-run-box', async p => { await testStart(p, 'reaction'); await p.click('#bt-state-skip'); await p.click('#bt-go'); await p.waitForSelector('#bt-box', { timeout: 8000 }); }, { viewport: true, after: p => p.click('#bt-abort') });
scene('toast', async p => { await tab(p, 'today'); await p.evaluate(async () => { const u = await import('./ui.js'); u.toast('Задача удалена', { actionLabel: 'Отменить', onAction() {}, ms: 60000 }); }); }, { viewport: true, after: p => p.evaluate(async () => (await import('./ui.js')).clearToast()) });
scene('toast-long', async p => { await tab(p, 'today'); await p.evaluate(async () => { const u = await import('./ui.js'); u.toast('Не удалось сохранить: нет места на устройстве. Освободи память и повтори.', { ms: 60000 }); }); }, { viewport: true, after: p => p.evaluate(async () => (await import('./ui.js')).clearToast()) });
scene('search', async p => { await tab(p, 'today'); await p.click('#search-btn'); await p.fill('#search-input', 'по'); await p.waitForTimeout(150); }, { viewport: true, after: p => p.evaluate(() => { document.getElementById('search-input').value = ''; document.getElementById('search-panel').hidden = true; }) });
scene('focus', async p => { await tab(p, 'today'); await p.click('#summary button:has-text("Фокус")'); await p.waitForSelector('#focus-host:not([hidden])'); }, { viewport: true, after: p => p.evaluate(() => { document.getElementById('focus-host').hidden = true; }) });
scene('today-editing', async p => { await tab(p, 'today'); await p.click('#view-today .item .body'); }, { after: p => p.keyboard.press('Escape') });
scene('habit-add', async p => { await tab(p, 'habits'); await p.click('.habit-add > summary'); });

// ---------- сборка кадра из кусков ----------
async function compose(hp, buf, W, N) {
  const b64 = buf.toString('base64');
  const img = i => `<div style="width:${W}px;height:${H}px;overflow:hidden;flex:none;background:#fff"><img src="data:image/png;base64,${b64}" style="display:block;width:${W}px;margin-top:-${i * H}px"></div>`;
  await hp.setViewportSize({ width: W * N + (N - 1) * 6, height: H });
  await hp.setContent(`<body style="margin:0;background:#c0c0c0;display:flex;gap:6px">${Array.from({ length: N }, (_, i) => img(i)).join('')}</body>`);
  await hp.waitForTimeout(60);
  return hp.screenshot({ type: 'png' });
}

const failures = [];
let count = 0;
for (const data of datas) {
  const t = await launch({ viewport: { width: widths[0], height: H }, ctxOptions: { deviceScaleFactor: dpr } });
  const p = t.page; p.setDefaultTimeout(4000);
  await p.goto(t.url);
  await until(p, () => !document.getElementById('app').hidden);
  if (data === 'seed') { await seedDemo(p); await seedMore(p); }
  const hctx = await t.browser.newContext({ deviceScaleFactor: dpr }); const hp = await hctx.newPage();
  for (const w of widths) for (const fsc of scales) for (const theme of themes) {
    await p.setViewportSize({ width: w, height: H });
    await p.emulateMedia({ colorScheme: theme, reducedMotion: motion });
    await p.evaluate(v => document.documentElement.style.setProperty('--fs', String(v)), fsc);
    for (const sc of S) {
      if (only.length && !only.includes(sc.name)) continue;
      try {
        await sc.fn(p);
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.waitForTimeout(280);
        const name = `${tag}-${data}-${w}${fsc !== 1 ? '-fs' + String(fsc).replace('.', '') : ''}-${theme}-${sc.name}.png`;
        let buf;
        if (sc.viewport) buf = await p.screenshot();
        else {
          const total = await p.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
          const n = Math.max(1, Math.min(maxSlices, Math.ceil(total / H)));
          const full = await p.screenshot({ fullPage: true });
          buf = n === 1 ? full : await compose(hp, full, w, n);
        }
        fs.writeFileSync(path.join(outDir, name), buf); count++;
      } catch (e) { failures.push(`${data}/${w}/${fsc}/${theme}/${sc.name}: ${String(e.message).split('\n')[0]}`); }
      try { await sc.after?.(p); } catch { /* окно уже закрыто */ }
    }
  }
  if (t.errors.length) failures.push(`console (${data}): ${t.errors.slice(0, 5).join(' | ')}`);
  await t.close();
}
console.log('screenshots:', count);
if (failures.length) console.log('failures:\n' + failures.join('\n'));
