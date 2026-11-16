// Дикция: экран открывается; программа дня и слабые звуки; плеер разминки (таймер удержания и счётчик повторов); дыхание; скороговорка (темп, секундомер,
// оценка, рекорд); викторина по ударениям; чтение вслух с измерителем слов в минуту; самооценка с динамикой; серия занятий; курс (мини-тест, отметка урока);
// образец голоса (русский голос и честное сообщение, если его нет); окно тренажёра (роль, фокус, Escape). Время в тренажёрах прокручивается часами Playwright.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, tab, until, appReady, waitText, waitCount, waitVisible, eventually, root, settleTheme } from './helpers.mjs';

const t = await launch({ ctxOptions: { serviceWorkers: 'block', bypassCSP: true } });
const { page, errors } = t;
// поддельный синтез речи: русский голос есть, вызовы записываются
await page.addInitScript(() => {
  window.__spoken = [];
  window.__voices = [{ lang: 'ru-RU' }];
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => window.__voices, speak: u => window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate }), cancel() {} } });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
});
await page.clock.install();
await page.goto(t.url);
await appReady(page);

const text = sel => page.textContent(sel);
const events = type => page.evaluate(async type => (await import('./store.js')).state.events.filter(e => e.type === type).map(e => ({ id: e.id, ...e.payload })), type);
const run = ms => page.clock.runFor(ms);
const dayShift = n => page.evaluate(async n => { const E = await import('./events.js'); return E.addDays(E.todayStr(), n); }, n);
const noise = list => list.filter(x => !/Failed to load resource|Service Worker registration blocked/.test(x));

// доступность: axe-core в светлой и тёмной теме на каждой вкладке и в каждом окне тренажёра; серьёзные нарушения и «исправленные» правила — ошибка
const AXE = fs.readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const ZERO_RULES = new Set(['heading-order', 'label', 'select-name', 'button-name', 'link-name', 'aria-required-parent', 'aria-allowed-role', 'aria-allowed-attr', 'landmark-one-main', 'region', 'landmark-unique', 'duplicate-id', 'duplicate-id-aria', 'list', 'listitem', 'scrollable-region-focusable', 'aria-hidden-focus', 'nested-interactive', 'label-content-name-mismatch', 'aria-required-children', 'aria-valid-attr-value']);
const a11y = [];
async function ax(label) {
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ content: AXE });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await settleTheme(page, theme, 150);
    const res = await page.evaluate(async tags => (await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => `${n.target.join(' ')} ${(n.any[0] || n.all[0] || n.none[0] || {}).message || ''}`) })), TAGS);
    for (const v of res) if (v.impact === 'serious' || v.impact === 'critical' || ZERO_RULES.has(v.id)) a11y.push(`${theme} / ${label}: [${v.impact}] ${v.id}: ${v.nodes.slice(0, 2).join(' | ')}`);
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

// ===== 1. Экран открывается, вкладки, честные границы =====
await tab(page, 'diction');
assert.equal(await text('#title'), 'Дикция');
assert.deepEqual(await page.locator('#subnav button').allTextContents(), ['Курсы', 'С нуля', 'Дикция', 'Навыки', 'Тесты', 'Цели', 'Аналитика']);
assert.deepEqual(await page.locator('#dic-tabs [role=tab]').allTextContents(), ['Сегодня', 'Разминка', 'Дыхание', 'Скороговорки', 'Ударения', 'Чтение вслух', 'Оценка', 'Курс']);
assert.equal(await page.getAttribute('#dic-tab-today', 'aria-selected'), 'true');
assert.equal(await page.getAttribute('#dic-panel', 'aria-labelledby'), 'dic-tab-today');
assert.match(await text('#dic-safety'), /логопеду или ЛОРу/);
assert.match(await text('#dic-safety'), /не записывает голос/);
await page.focus('#dic-tab-today'); await page.keyboard.press('ArrowRight');
assert.equal(await page.getAttribute('#dic-tab-warmup', 'aria-selected'), 'true', 'стрелка вправо открывает следующую вкладку');
assert.equal(await page.evaluate(() => document.activeElement.id), 'dic-tab-warmup');
await page.keyboard.press('Home');
assert.equal(await page.getAttribute('#dic-tab-today', 'aria-selected'), 'true');

// ===== 2. Сегодня: программа и слабые звуки =====
assert.equal(await text('#dic-streak'), '0');
assert.equal(await page.locator('#dic-routine .dic-block').count(), 4, 'на десять минут четыре блока');
assert.deepEqual(await page.locator('#dic-routine .dic-block').evaluateAll(n => n.map(x => x.dataset.kind).slice(0, 3)), ['breath', 'warmup', 'twister']);
await page.click('#dic-weak .dic-weak[data-group="r"]');
assert.equal(await page.getAttribute('#dic-weak .dic-weak[data-group="r"]', 'aria-pressed'), 'true');
assert.match(await text('#dic-routine .dic-block[data-kind="twister"] strong'), /Звук Р/, 'скороговорки подобраны под выбранный звук');
await page.click('#dic-minutes .dic-min[data-min="5"]');
assert.equal(await page.locator('#dic-routine .dic-block').count(), 3);
await page.click('#dic-minutes .dic-min[data-min="15"]');
assert.equal(await page.locator('#dic-routine .dic-block').count(), 5);
await page.click('#dic-minutes .dic-min[data-min="10"]');
await ax('сегодня');

// ===== 3. Разминка: плеер с таймером удержания и счётчиком повторов =====
await page.click('#dic-tab-warmup');
assert.ok(await page.locator('.dic-ex').count() >= 20, 'упражнений около двадцати');
await page.click('.dic-ex[data-ex="spade"] summary');
assert.match(await text('.dic-ex[data-ex="spade"]'), /Типичные ошибки/);
await ax('разминка: список');
await page.click('#dic-sets .dic-set[data-set="min3"]');
await waitVisible(page, '#dic-host');
assert.deepEqual(await page.evaluate(() => { const d = document.getElementById('dic-host'); return [d.getAttribute('role'), d.getAttribute('aria-modal'), d.contains(document.activeElement), document.getElementById('tabs').inert]; }), ['dialog', 'true', true, true], 'окно тренажёра: роль, фокус внутри, остальное недоступно');
assert.match(await text('#dic-ex-count'), /Повтор 1 из \d+/);
await ax('плеер разминки');
await page.keyboard.press('Escape');
assert.equal(await page.locator('#dic-host').isVisible(), true, 'Escape не обрывает идущую разминку');
for (let guard = 0; guard < 150; guard++) {
  const label = (await text('#dic-ex-main')).trim();
  if (label === 'Начать повтор') { await page.click('#dic-ex-main'); await run(11000); }       // удержание: таймер считает секунды сам
  else if (label === 'Завершить') { await page.click('#dic-ex-main'); break; }                   // последняя кнопка: запись идёт асинхронно
  else await page.click('#dic-ex-main');                                                         // «Сделал» или «Дальше»
}
await waitText(page, '#dic-w-fin-title', 'Разминка готова');
assert.match(await text('#dic-w-fin-note'), /^Записано: упражнений \d+, время \d+:\d\d/);
const warm = await eventually(() => events('diction'), r => assert.ok(r.some(x => x.kind === 'warmup')));
assert.ok(warm[0].items >= 3 && warm[0].seconds >= 20 && warm[0].ref === 'min3', JSON.stringify(warm[0]));
await page.click('#dic-w-close');
await waitVisible(page, '#dic-host', false);
assert.equal(await page.evaluate(() => document.getElementById('tabs').inert), false, 'после закрытия страница снова доступна');

// быстрый выход из плеера записывает только сделанное (меньше двадцати секунд — не записывается)
await page.click('#dic-sets .dic-set[data-set="lips"]');
await page.click('#dic-stop');
assert.match(await text('#dic-w-fin-note'), /Ни одно упражнение не завершено/);
await page.click('#dic-w-close');

// ===== 4. Дыхание: ритм, запись в общие данные дыхания =====
await page.click('#dic-tab-breath');
await page.click('#dic-presets .dic-preset[data-preset="sound-s"]');
assert.match(await text('#dic-preset-hint'), /вдох 4 с, выдох 10 с/);
await ax('дыхание');
await page.click('#dic-lengths .dic-len[data-min="1"]');
await page.click('#dic-breath-go');
await waitVisible(page, '#dic-circle');
await run(1000);
assert.match(await text('#dic-br-left'), /Осталось 0:\d\d/);
await ax('дыхание: окно');
await run(25000);
await page.click('#dic-stop');
await waitText(page, '#dic-b-fin-title', 'Остановлено');
assert.match(await text('#dic-b-fin-note'), /Записано: 0:\d\d, циклов дыхания: \d/);
const br = await eventually(() => events('breath'), r => assert.equal(r.length, 1));
assert.ok(br[0].seconds >= 20, 'та же запись «Дыхание», что и на экране «Здоровье»');
assert.ok((await events('diction')).some(x => x.kind === 'breath' && x.ref === 'sound-s'));
await page.click('#dic-b-close');

// ===== 5. Скороговорки: фильтры, три темпа, секундомер, оценка, рекорд =====
await page.click('#dic-tab-twisters');
assert.equal(await page.locator('#dic-tw-list .dic-tw-pick').count(), 24, 'первая порция');
await page.click('#dic-tw-more');
assert.ok(await page.locator('#dic-tw-list .dic-tw-pick').count() > 24);
await ax('скороговорки: список');
await page.click('#dic-tw-groups .chip[data-group="hushing"]');
assert.deepEqual(await page.locator('#dic-tw-letters .chip').allTextContents(), ['Любой', 'Ш', 'Ж', 'Ч', 'Щ']);
await page.click('#dic-tw-letters .chip[data-sound="щ"]');
await page.click('#dic-tw-levels .chip[data-level="2"]');
assert.match(await text('#dic-tw-count'), /Найдено: \d+/);
const metas = await page.locator('#dic-tw-list .dic-tw-pick .muted').allTextContents();
assert.ok(metas.length >= 2 && metas.every(m => m.startsWith('Уровень 2') && /звуки:.*щ/.test(m)), 'фильтр по звуку и уровню');
await page.click('#dic-tw-groups .chip[data-group=""]'); await page.click('#dic-tw-levels .chip[data-level="1"]');
const pick = page.locator('#dic-tw-list .dic-tw-pick').first();
const twId = await pick.getAttribute('data-id');
await pick.click();
await waitVisible(page, '#dic-tw-text');
assert.equal(await page.locator('#dic-tw-tempos .dic-tempo').count(), 3);
assert.match(await text('#dic-tw-target'), /Цель: 3 повтора подряд за \d+ с\. Слогов в одном повторе: \d+\./);
await page.click('#dic-tw-tempos .dic-tempo[data-tempo="1"]');
const slowTarget = Number((await text('#dic-tw-target')).match(/за (\d+) с/)[1]);
await page.click('#dic-tw-tempos .dic-tempo[data-tempo="3"]');
assert.ok(Number((await text('#dic-tw-target')).match(/за (\d+) с/)[1]) < slowTarget, 'в быстром темпе цель короче');
await page.click('#dic-tw-go'); await run(9000); await page.click('#dic-tw-go');
assert.match(await text('#dic-tw-time'), /Время на 3 повтора: 9(,\d)? с/);
assert.equal(await page.locator('#dic-tw-save').isDisabled(), true, 'без оценки сохранить нельзя');
await page.click('.rating[data-field="clarity"] .rate[data-v="4"]');
await ax('скороговорка: оценка');
await page.click('#dic-tw-save');
await waitText(page, '#dic-tw-saved', /Новый личный рекорд: быстро, чёткость 4 из 5/);
const tws = await eventually(() => events('diction'), r => assert.ok(r.some(x => x.kind === 'twister')));
const tw = tws.find(x => x.kind === 'twister');
assert.deepEqual([tw.ref, tw.rating, tw.tempo, tw.items], [twId, 4, 3, 3]);
assert.ok(tw.seconds >= 9 && tw.groups.length >= 1);
await page.keyboard.press('Escape');                                            // между забегами Escape закрывает окно
await waitVisible(page, '#dic-host', false);
assert.match(await text(`#dic-tw-list .dic-tw-pick[data-id="${twId}"] .muted`), /рекорд: быстро, чёткость 4 из 5/, 'рекорд виден в списке');

// образец голоса: русский голос и скорость по темпу, честное сообщение без голоса
await page.locator(`#dic-tw-list .dic-tw-pick[data-id="${twId}"]`).click();
await page.click('#dic-tw-tempos .dic-tempo[data-tempo="1"]');
await page.click('.dic-voice');
const spoken = await page.evaluate(() => window.__spoken);
assert.deepEqual([spoken.length, spoken[0].lang, spoken[0].rate], [1, 'ru-RU', 0.7], 'русский голос, медленный темп');
await page.evaluate(() => { window.__voices = [{ lang: 'en-US' }]; });
await page.click('.dic-voice');
assert.match(await text('.dic-voice-note'), /нет русского голоса/);
assert.equal((await page.evaluate(() => window.__spoken)).length, 1, 'без русского голоса ничего не произносится');
await page.evaluate(() => { window.__voices = [{ lang: 'ru-RU' }]; });
await page.click('#dic-t-close');

// ===== 6. Ударения: викторина =====
await page.click('#dic-tab-stress');
await ax('ударения');
await page.click('#dic-st-go');
await waitVisible(page, '#dic-st-q');
let okCount = 0;
for (let i = 0; i < 10; i++) {
  assert.match(await text('#dic-st-q'), /^Где ударение в слове «[а-яё-]+»\?$/);
  const opts = page.locator('.dic-opt');
  assert.ok(await opts.count() >= 2 && await opts.count() <= 3);
  assert.match(await opts.first().getAttribute('aria-label'), /ударение на «[а-яё]»/);
  if (i === 0) await run(6000);
  await opts.nth(i % 2).click();
  assert.match(await text('#dic-st-fb'), /^(Верно|Не совсем)/, 'ответ назван словами, а не только цветом');
  assert.equal(await page.locator('.dic-opt .dic-mark').count() >= 1, true);
  if (i === 1) await ax('ударения: ответ');
  if ((await text('#dic-st-fb')).startsWith('Верно')) okCount++;
  await page.click('#dic-st-next');
}
await waitText(page, '#dic-s-fin-title', `Верно ${okCount} из 10`);
assert.match(await text('#dic-s-fin-note'), /^Раунд записан\./);
const st = (await eventually(() => events('diction'), r => assert.ok(r.some(x => x.kind === 'stress')))).find(x => x.kind === 'stress');
assert.deepEqual([st.items, st.ok ?? 0, (st.miss ?? []).length], [10, okCount, 10 - okCount], 'ошибки запомнены для повторения');
if (okCount < 10) { assert.ok(await page.locator('#dic-st-wrong li').count() === 10 - okCount); await page.click('#dic-st-again'); await waitVisible(page, '#dic-st-q'); await page.click('#dic-stop'); }
await page.click('#dic-s-close');
assert.match(await text('#dic-st-miss'), okCount < 10 ? /Ждут повторения слов с прошлых ошибок: \d+/ : /пока нет/);

// ===== 7. Чтение вслух: измеритель слов в минуту =====
await page.click('#dic-tab-reading');
assert.ok(await page.locator('#dic-read-pick option').count() >= 13);
await page.selectOption('#dic-read-pick', 'rt08');
const words = Number((await text('#dic-read-info')).match(/Слов: (\d+)/)[1]);
assert.equal(words, 28);
assert.ok(await page.locator('#dic-read-card .dic-pause').count() >= 5 && await page.locator('#dic-read-card .dic-emph').count() >= 1, 'паузы и ударения видны');
await ax('чтение: текст');
await page.click('#dic-read-marks');
assert.equal(await page.locator('#dic-read-card .dic-pause').count(), 0, 'разметку можно скрыть');
await page.click('#dic-read-open');
await waitVisible(page, '#dic-rd-go');
await page.click('#dic-rd-go'); await run(14000); await page.click('#dic-rd-go');
const wpmText = await text('#dic-rd-wpm');
const pace = Number(wpmText.match(/^(\d+) слов/)[1]);
assert.ok(pace >= 110 && pace <= 130, `темп ${pace} при 28 словах за 14 секунд (около 120)`);
assert.match(await text('#dic-rd-band'), /^Комфортно\./);
assert.match(await text('#dic-rd-result'), /ориентиры, а не норма/i);
await ax('чтение: результат');
await page.click('.rating[data-field="reading"] .rate[data-v="5"]');
await page.click('#dic-rd-save');
await waitText(page, '#dic-rd-saved', /Записано: \d+ слов в минуту, оценка 5 из 5/);
const rd = (await eventually(() => events('diction'), r => assert.ok(r.some(x => x.kind === 'reading')))).find(x => x.kind === 'reading');
assert.deepEqual([rd.items, rd.rating, rd.ref, rd.wpm], [28, 5, 'rt08', pace]);
await page.click('#dic-r-close');
await page.selectOption('#dic-read-pick', 'own');
await page.fill('#dic-read-own', 'Один два три *четыре* / пять');
assert.equal(await text('#dic-read-info'), 'Слов: 5');
assert.equal(await page.locator('#dic-read-open').isDisabled(), false);
await page.fill('#dic-read-own', 'Слишком коротко');
assert.equal(await page.locator('#dic-read-open').isDisabled(), true, 'меньше пяти слов не измеряем');

// ===== 8. Самооценка: шесть пунктов, динамика, история =====
const old = await dayShift(-14);
await page.evaluate(async d => { const D = await import('./diction.js'), s = await import('./store.js'); await s.save(D.makeSelf({ scores: { clarity: 2, tempo: 3, volume: 3, intonation: 2, pauses: 2, fillers: 2 }, note: 'Первая оценка', date: d })); }, old);
await page.click('#dic-tab-rubric');
await waitVisible(page, '#dic-self-result');
assert.equal(await text('#dic-self-avg'), '2,3');
assert.match(await text('#dic-self-dir'), /отправная точка/);
assert.equal(await page.locator('#dic-self-save').isDisabled(), true, 'пока не оценены все шесть пунктов, сохранить нельзя');
for (const [id, v] of [['clarity', 4], ['tempo', 4], ['volume', 4], ['intonation', 3], ['pauses', 3], ['fillers', 3]]) await page.click(`.dic-rubric-row[data-id="${id}"] .rate[data-v="${v}"]`);
assert.equal(await page.locator('#dic-self-save').isDisabled(), false);
await page.click('#dic-self-weak .dic-weak[data-group="velar"]');
await page.fill('#dic-self-note', 'Читаю ровнее');
await page.click('#dic-self-save');
await waitText(page, '#dic-self-avg', '3,5');
assert.match(await text('#dic-self-dir'), /Средний балл вырос на 1,2 по сравнению с прошлой оценкой/);
assert.equal(await page.locator('#dic-self-delta li').count(), 6);
assert.match(await text('#dic-self-delta'), /Чёткость: 4 из 5, выросла на 2/);
assert.match(await text('#dic-self-focus'), /Слабее всего: Интонация/);
assert.match(await page.getAttribute('#dic-self-result svg.spark', 'aria-label'), /Средний балл по датам: 2,3, 3,5/);
await ax('оценка');
assert.equal(await page.locator('#dic-self-history .dic-hist').count(), 2);
const self = await eventually(() => events('dictself'), r => assert.equal(r.length, 2));
assert.deepEqual(self.find(x => x.note === 'Читаю ровнее').weak.includes('velar'), true);
await page.click('#dic-self-history .dic-del >> nth=0');
await waitCount(page, '#dic-self-history .dic-hist', 1);

// ===== 9. Серия занятий =====
const [d1, d2] = [await dayShift(-1), await dayShift(-2)];
await page.evaluate(async ds => { const D = await import('./diction.js'), s = await import('./store.js'); for (const d of ds) await s.save(D.makeDiction({ kind: 'reading', seconds: 60, items: 30, date: d })); }, [d1, d2]);
await page.click('#dic-tab-today');
await waitText(page, '#dic-streak', '3');
assert.match(await text('#dic-stats'), /дня подряд/);
assert.match(await text('#dic-routine .dic-block[data-kind="warmup"]'), /Сделано сегодня ✓/);
assert.equal(await page.locator('#dic-routine .dic-block[data-kind="warmup"] .dic-go').textContent(), 'Ещё раз');

// из программы дня запускается тренажёр сразу
await page.click('#dic-routine .dic-block[data-kind="twister"] .dic-go');
await waitVisible(page, '#dic-tw-text');
await page.click('#dic-t-close');
assert.equal(await page.getAttribute('#dic-tab-twisters', 'aria-selected'), 'true');

// ===== 10. Курс: уроки, мини-тест, отметка =====
await page.click('#dic-tab-course');
assert.equal(await page.locator('.dic-lesson').count(), 32);
assert.equal(await text('#dic-course-count'), 'Пройдено уроков: 0 из 32');
assert.equal(await page.locator('#dic-mentor .prompt').count(), 3);
await page.click('#dic-course-next');
assert.equal(await page.getAttribute('.dic-lesson[data-lesson="di-01"]', 'open'), '');
assert.match(await text('.dic-lesson[data-lesson="di-01"]'), /логопеду или к ЛОРу/);
await ax('курс: урок');
const first = await page.evaluate(async () => { const t = (await import('./academy.js')).trackById('diction'); return t.lessons[0].drills[0]; });
await page.click('.dic-quiz-start[data-lesson="di-01"]');
assert.equal(await text('.dic-quiz[data-lesson="di-01"] .quiz-q'), first.q);
await page.locator('.dic-quiz[data-lesson="di-01"] .quiz-opt', { hasText: first.right }).first().click();
assert.equal(await text('.dic-quiz[data-lesson="di-01"] .dic-fb'), 'Верно.');
await ax('курс: мини-тест');
await page.click('.dic-quiz[data-lesson="di-01"] .dic-quiz-next');
await page.click('.dic-lesson[data-lesson="di-01"] [data-done="di-01"]');
await waitText(page, '#dic-course-count', 'Пройдено уроков: 1 из 32');
const les = await eventually(() => events('lesson'), r => assert.ok(r.some(x => x.lesson === 'di-01')));
assert.deepEqual([les[0].track, les[0].lesson], ['diction', 'di-01']);
await tab(page, 'learn');
assert.match(await text('.track-card[data-track="diction"]'), /Дикция: ясная речь[\s\S]*Уроки 1\/32/, 'курс виден и в «Учёбе»');

// ===== 11. Узкий экран 320 px и крупный шрифт: ничего не вылезает за край (вкладки и окна тренажёров) =====
await tab(page, 'diction');
await page.setViewportSize({ width: 320, height: 640 });
await page.evaluate(() => document.documentElement.style.setProperty('--fs', '1.3'));
const overflow = sel => page.evaluate(sel => [document.documentElement.scrollWidth > innerWidth ? `страница шире экрана: ${document.documentElement.scrollWidth}` : '',
  ...[...document.querySelectorAll(sel)].filter(n => { const r = n.getBoundingClientRect(); return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5) && !n.closest('svg'); }).slice(0, 3).map(n => `за краем: ${n.tagName}.${n.className} «${(n.textContent || '').slice(0, 30)}»`)].filter(Boolean), sel);
for (const id of ['today', 'warmup', 'breath', 'twisters', 'stress', 'reading', 'rubric', 'course']) {
  await page.click(`#dic-tab-${id}`);
  assert.deepEqual(await overflow('#dic-panel *, #dic-tabs *'), [], `вкладка «${id}» на 320 px`);
}
await page.click('#dic-tab-twisters'); await page.locator('#dic-tw-list .dic-tw-pick').nth(5).click();
assert.deepEqual(await overflow('#dic-host *'), [], 'окно скороговорки на 320 px'); await page.click('#dic-t-close');
await page.click('#dic-tab-stress'); await page.click('#dic-st-go');
assert.deepEqual(await overflow('#dic-host *'), [], 'окно ударений на 320 px'); await page.click('#dic-stop'); await page.click('#dic-s-close');
await page.click('#dic-tab-reading'); await page.selectOption('#dic-read-pick', 'rt06'); await page.click('#dic-read-open');
assert.deepEqual(await overflow('#dic-host *'), [], 'окно чтения на 320 px'); await page.click('#dic-r-close');
await page.click('#dic-tab-warmup'); await page.click('#dic-sets .dic-set[data-set="tongue"]');
assert.deepEqual(await overflow('#dic-host *'), [], 'окно разминки на 320 px'); await page.click('#dic-stop'); await page.click('#dic-w-close');

assert.deepEqual(a11y, [], 'доступность:\n' + a11y.join('\n'));
assert.deepEqual(noise(errors), [], 'нет ошибок в консоли:\n' + noise(errors).join('\n'));
await t.close();
console.log('E2E DICTION OK');
