// Архив данных: сохранить одним нажатием, загрузить на другом устройстве, конфликты, проверка файла, пароль, не тот файл.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, tab, until } from './helpers.mjs';
import { makeZip } from '../zip.js';

const t = await launch();
const { page, errors } = t;
page.on('dialog', d => d.accept());
await page.goto(t.url);
await until(page, () => !document.getElementById('app').hidden);
const text = (p, sel) => p.textContent(sel);
const toast = (p, re, timeout = 10000) => p.waitForFunction(r => new RegExp(r).test(document.getElementById('toast').textContent), re.source, { timeout }).catch(async e => { throw new Error(`Не появилось сообщение ${re}; сейчас: «${await p.textContent('#toast')}»`); });
const clearToast = p => p.evaluate(async () => (await import('./ui.js')).clearToast());
const evs = (p, type) => p.evaluate(async ty => (await import('./store.js')).state.events.filter(e => e.type === ty), type);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-e2e-'));
async function download(p, sel) { const [dl] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); const f = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(f); return f; }
async function freshDevice() {
  const ctx = await t.browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, locale: 'ru-RU' });
  const p = await ctx.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await p.goto(t.url); await until(p, () => !document.getElementById('app').hidden);
  return { ctx, p };
}

// ---------- данные и настройки ----------
await page.evaluate(async () => {
  const store = await import('./store.js'), ev = await import('./events.js'), hb = await import('./habits.js'), mo = await import('./money.js'), nt = await import('./notes.js'), sk = await import('./skills.js'), pr = await import('./prefs.js');
  const habit = hb.makeHabit({ name: 'Зарядка', days: [1, 3, 5] });
  await store.saveMany([ev.makeTask('Купить хлеб', Date.now(), { due: ev.todayStr() }), ev.makeTask('Позвонить маме'), habit, hb.makeHabitLog(habit, ev.todayStr(), 'full'), mo.makeExpense({ amount: 35000, category: 'Еда', date: ev.todayStr() }), nt.makeNote('Идея: собрать всё в одну таблицу'), sk.makeSkill({ title: 'Менять колесо', area: 'Дом и быт', level: 2 })]);
  pr.setPref('theme', 'dark'); pr.setPref('fontScale', 1.15); pr.setPref('simple', false); pr.setPref('remindersOn', true);
});
await tab(page, 'more');
assert.equal(await page.locator('#archive-box #bk-enc').count(), 1); assert.equal(await page.locator('#archive-box #export-btn').count(), 1); assert.equal(await page.locator('#archive-box #import-input').count(), 1);
await until(page, () => /Сейчас в архив войдёт записей: \d+\. Последний архив: ещё не делал\./.test(document.getElementById('archive-info').textContent));
assert.match(await text(page, '#archive-box'), /Все твои записи, навыки и настройки в одном файле/);

// ---------- сохранить одним нажатием ----------
const plainFile = await download(page, '#export-btn');
assert.match(path.basename(plainFile), /^lifeos-archive-\d{4}-\d{2}-\d{2}\.json$/);
const archive = JSON.parse(fs.readFileSync(plainFile, 'utf8'));
assert.equal(archive.app, 'lifeos'); assert.match(archive.version, /^R3\.\d+(\.\d+)?$/);
assert.deepEqual(archive.prefs, { theme: 'dark', fontScale: 1.15, parseDates: true, hideAmounts: false, simple: false, autoLockMin: 5, taskHour: 9, habitHour: 20, eveningHour: 21, bedtimeMin: -1, weeklyHour: -1, quietFrom: -1, quietTo: 7, daysOff: [], backupEveryDays: 14 }, 'настройки в архиве, но без привязанных к устройству');
assert.ok(archive.events.some(e => e.type === 'skill') && archive.events.some(e => e.type === 'habit_log') && archive.events.filter(e => e.type === 'task').length === 2);
await until(page, () => /Последний архив: сегодня/.test(document.getElementById('archive-info').textContent) && /Последняя копия: сегодня/.test(document.getElementById('stats').textContent));
const total = archive.events.length;

// ---------- новое устройство: всё загрузилось само, настройки тоже ----------
{
  const { ctx, p } = await freshDevice();
  await tab(p, 'more');
  await p.setInputFiles('#import-input', plainFile);
  await toast(p, new RegExp(`Восстановлено записей: ${total}.*настройки применены`));
  await p.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', null, { timeout: 15000 });      // после перезапуска тема из архива
  await until(p, () => !document.getElementById('app').hidden);
  assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim()), '1.15');
  assert.equal((await evs(p, 'task')).length, 2); assert.equal((await evs(p, 'skill')).length, 1); assert.equal((await evs(p, 'habit'))[0].payload.days.join(), '1,3,5');
  assert.equal(await p.evaluate(async () => (await import('./prefs.js')).getPref('remindersOn')), false, 'разрешение на уведомления на новом устройстве не переносится');
  await ctx.close();
}

// ---------- выборочная загрузка: без денег ----------
{
  const { ctx, p } = await freshDevice();
  await tab(p, 'more');
  await p.check('#imp-select');
  await p.setInputFiles('#import-input', plainFile);
  await until(p, () => document.getElementById('imp-groups'));
  const groups = await p.locator('.imp-group').allTextContents();
  assert.ok(groups.some(g => /Деньги: новых 1/.test(g)) && groups.some(g => /Дела: новых/.test(g)) && groups.some(g => /Учёба: новых 1/.test(g)), groups.join(' | '));
  const before = await text(p, '#imp-merge');
  await p.uncheck('.imp-group-box[data-group="Деньги"]');
  assert.notEqual(await text(p, '#imp-merge'), before, 'число в кнопке обновилось после снятия группы');
  await p.uncheck('#imp-prefs');                                                    // без перезапуска приложения
  await p.click('#imp-merge'); await toast(p, /Восстановлено записей: \d+/);
  await until(p, async () => (await (await import('./store.js')).state.events.filter(e => e.type === 'task')).length === 2);
  assert.equal((await evs(p, 'expense')).length, 0, 'деньги не загружены'); assert.equal((await evs(p, 'skill')).length, 1); assert.equal((await evs(p, 'note')).length, 1);
  await ctx.close();
}

// ---------- то же самое ещё раз: ничего нового ----------
await clearToast(page);
await page.setInputFiles('#import-input', plainFile);
await toast(page, /В архиве нет ничего нового/);
assert.equal(await page.locator('#imp-preview').isHidden(), true);

// ---------- проверка файла без загрузки ----------
await page.check('#imp-dry'); await page.setInputFiles('#import-input', plainFile);
await until(page, () => !document.getElementById('imp-preview').hidden);
assert.match(await text(page, '#imp-preview'), new RegExp(`Записей в файле: ${total}`)); assert.match(await text(page, '#imp-dry-note'), /Файл читается без ошибок/);
assert.equal(await page.locator('#imp-merge').count(), 0, 'в режиме проверки загружать нечего'); await page.click('#imp-cancel'); await page.uncheck('#imp-dry');
assert.equal(await page.locator('#imp-preview').isHidden(), true);

// ---------- конфликт: локально правили задачу после сохранения архива ----------
await page.evaluate(async () => { const st = await import('./store.js'), ev = await import('./events.js'); const task = st.state.events.find(e => e.type === 'task' && e.payload.text === 'Купить хлеб'); await st.save(ev.updateTask(task, { text: 'Купить хлеб и молоко' })); });
await clearToast(page);
await page.setInputFiles('#import-input', plainFile);
await until(page, () => !document.getElementById('imp-preview').hidden);
assert.match(await text(page, '#imp-preview'), /Новых для этого устройства: 0\. Уже есть такие же: \d+\. Отличаются от твоих: 1\./);
assert.match(await text(page, '#imp-differ'), /Задача: «Купить хлеб»/); assert.match(await text(page, '#imp-differ'), /остаются твои версии/);
await page.click('#imp-merge'); await toast(page, /Восстановлено записей: 0, отличающихся оставлено твоих: 1/);
assert.ok((await evs(page, 'task')).some(e => e.payload.text === 'Купить хлеб и молоко'), 'по умолчанию свои данные не затираются');
await clearToast(page);
await page.setInputFiles('#import-input', plainFile);
await until(page, () => !document.getElementById('imp-preview').hidden);
await page.click('#imp-replace'); await toast(page, /Восстановлено записей: 1/);
assert.ok((await evs(page, 'task')).some(e => e.payload.text === 'Купить хлеб') && !(await evs(page, 'task')).some(e => e.payload.text === 'Купить хлеб и молоко'), 'замена вернула версию из архива');

// ---------- не тот файл ----------
const zip = path.join(tmp, 'analysis.zip'); fs.writeFileSync(zip, makeZip([{ name: 'daily.csv', data: 'date\n2026-11-01\n' }], Date.now()));
await clearToast(page); await page.setInputFiles('#import-input', zip); await toast(page, /выгрузка для анализа \(ZIP\)/);
const junk = path.join(tmp, 'junk.json'); fs.writeFileSync(junk, '{"привет": 1}');
await clearToast(page); await page.setInputFiles('#import-input', junk); await toast(page, /Это не резервная копия Life OS/);
const broken = path.join(tmp, 'broken.json'); fs.writeFileSync(broken, '{"app":"lifeos","events":[');
await clearToast(page); await page.setInputFiles('#import-input', broken); await toast(page, /Ошибка/);
const future = path.join(tmp, 'future.json'); fs.writeFileSync(future, JSON.stringify({ app: 'lifeos', schema: 99, events: [] }));
await clearToast(page); await page.setInputFiles('#import-input', future); await toast(page, /более новой версией/);

// ---------- архив с паролем ----------
await page.fill('#bk-pass', 'abc'); await clearToast(page); await page.click('#bk-enc'); await toast(page, /не короче 8/);
await page.fill('#bk-pass', 'длинный-пароль-архива');
const encFile = await download(page, '#bk-enc');
assert.match(path.basename(encFile), /^lifeos-archive-\d{4}-\d{2}-\d{2}\.enc\.json$/);
assert.ok(!fs.readFileSync(encFile, 'utf8').includes('Купить хлеб'), 'в зашифрованном файле нет открытого текста');
{
  const { ctx, p } = await freshDevice();
  await tab(p, 'more');
  await p.setInputFiles('#import-input', encFile);
  await until(p, () => !document.getElementById('imp-row').hidden);
  await p.fill('#imp-pass', 'не-тот-пароль-12'); await p.click('#imp-go'); await toast(p, /Неверный пароль/);
  await p.fill('#imp-pass', 'длинный-пароль-архива'); await p.click('#imp-go');
  await toast(p, /Восстановлено записей/);
  await p.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', null, { timeout: 15000 });
  await until(p, () => !document.getElementById('app').hidden);
  assert.equal((await evs(p, 'task')).length, 2); assert.equal((await evs(p, 'note')).length, 1);
  await ctx.close();
}
assert.equal(await page.inputValue('#bk-pass'), '', 'пароль очищен после сохранения');

assert.deepEqual(errors, [], 'нет ошибок в консоли:\n' + errors.join('\n'));
await t.close();
console.log('E2E ARCHIVE OK');
