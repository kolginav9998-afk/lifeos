// «Ещё» → «Архив данных»: весь архив одним файлом. Сохранить (с паролем или без) и загрузить (файл сам определяется: открытый или зашифрованный).
// Загрузка по умолчанию только добавляет: если ничего не затирается, она проходит без вопросов; если в файле есть записи, отличающиеся от
// имеющихся, сначала показываем, что внутри, и просим выбрать.
import { el, fill, toast, setBusy, revealable, dateRu, agoText, copyText } from './ui.js';
import * as store from './store.js';
import * as db from './db.js';
import { serialize, todayStr, addDays, parseImport } from './events.js';
import { encryptBackup, decryptBackup, readBackup, backupKind, NeedPasswordError, BadBackupPasswordError, MAX_BACKUP_BYTES } from './backup.js';
import { importPlan, planEvents, planGroups, filterPlan, cleanPrefs, archiveName, looksLikeZip } from './archive.js';
import { buildHtmlArchive } from './export-html.js';
import { describeEvent } from './search.js';
import { saveTextFile } from './platform.js';
import * as vault from './vault.js';
import { getPref, getPrefs, setPref } from './prefs.js';
import { VERSION } from './version.js';
import { sizeByType, formatBytes, debugBundle } from './engineer.js';
import { snapshotAt, endOfDayTs, replaySummary } from './replay.js';
import { createUndoLog, describeUndo, undoAction, diffStates } from './undo.js';
import { diffRecords, diffSummary } from './diff.js';
import { dryRunTrigger, OVERDUE_SPLIT_RULE, watchdog, makeWatchdogTask } from './triggers.js';
import { dayDraft, diaryToGitMarkdown } from './export.js';
import { log as errorLog } from './errlog.js';

// Журнал отмены («Ctrl+Z по жизни») — один на приложение, переживает пересборку экранов при блокировке.
// Массовые замены списка (блокировка, вход, синхронизация) в журнал не пишем: порогом отсекаем «всё сразу».
let undoLog = null;
let undoPrev = null;
const UNDO_BULK = 20;
function getUndoLog() {
  if (!undoLog) {
    undoLog = createUndoLog();
    undoPrev = store.state.events.slice();
    undoLog.prime(undoPrev);
    store.onChange(evs => {
      const bulk = undoPrev && diffStates(undoPrev, evs).length > UNDO_BULK;
      if (bulk) undoLog.prime(evs);                                       // это не правка человека, а смена состояния целиком
      else undoLog.observe(evs);
      undoPrev = evs.slice();
    });
  }
  return undoLog;
}

const field = (id, props) => el('input', { id, autocomplete: 'off', ...props });

export function createArchive({ onSaved = () => {} } = {}) {
  let pending = null;                                   // текст выбранного файла, ждущий пароля
  const extra = () => ({ version: VERSION, prefs: cleanPrefs(getPrefs()) });

  // ---------- сохранить ----------
  const info = el('p', { id: 'archive-info', class: 'muted' });
  const refresh = () => { info.textContent = `Сейчас в архив войдёт записей: ${store.state.events.length}. Последний архив: ${agoText(getPref('lastBackupAt'))}.`; };
  const bkPass = field('bk-pass', { type: 'password', autocomplete: 'new-password', placeholder: 'Пароль для архива (по желанию, не короче 8 символов)' });
  const bkBtn = el('button', { id: 'bk-enc', type: 'button', class: 'primary', textContent: 'Сохранить архив с паролем' });
  bkBtn.onclick = async () => {
    setBusy(bkBtn, true, 'Шифрую…');
    try {
      const text = await encryptBackup(store.state.events, bkPass.value, extra());
      const check = await decryptBackup(text, bkPass.value);               // сразу проверяем, что архив можно прочитать
      if (check.events.length !== store.state.events.length || check.skipped) throw new Error('Проверка архива не пройдена, файл не сохранён');
      await saveTextFile(archiveName(todayStr(), true), text);
      setPref('lastBackupAt', Date.now());
      toast(`Архив проверен и сохранён (записей: ${check.events.length})`);
      bkPass.value = '';
      refresh(); onSaved();
    } catch (err) { toast(err.message); }
    finally { setBusy(bkBtn, false); }
  };
  const plainBtn = el('button', { id: 'export-btn', type: 'button', textContent: 'Сохранить архив без пароля' });
  plainBtn.onclick = async () => {
    if (vault.hasVault() && !confirm('Файл будет БЕЗ шифрования: любой, кто его получит, прочтёт все данные. Продолжить?')) return;
    try {
      const text = serialize(store.state.events, Date.now(), extra());
      await saveTextFile(archiveName(todayStr(), false), text);
      setPref('lastBackupAt', Date.now());
      toast(`Сохранено записей: ${store.state.events.length}`);
      refresh(); onSaved();
    } catch (err) { toast('Не удалось сохранить: ' + (err?.message || err)); }
  };

  // «Вечный» HTML-архив: один файл, который откроется в любом браузере без приложения и интернета.
  const htmlBtn = el('button', { id: 'export-html', type: 'button', textContent: 'Вечный HTML-архив' });
  htmlBtn.onclick = async () => {
    if (!confirm('Файл будет БЕЗ шифрования: любой, кто его получит, прочтёт все данные. Храни его как личный документ. Продолжить?')) return;
    setBusy(htmlBtn, true, 'Собираю…');
    try {
      const html = buildHtmlArchive(store.state.events, { exportedAt: Date.now(), version: VERSION, prefs: cleanPrefs(getPrefs()) });
      await saveTextFile(`lifeos-archive-${todayStr()}.html`, html, 'text/html');
      setPref('lastBackupAt', Date.now());
      toast(`HTML-архив сохранён (записей: ${store.state.events.length})`);
      refresh(); onSaved();
    } catch (err) { toast('Не удалось сохранить: ' + (err?.message || err)); }
    finally { setBusy(htmlBtn, false); }
  };

  // ---------- загрузить ----------
  const impInput = el('input', { id: 'import-input', type: 'file', accept: '.json,application/json,text/plain', hidden: true });
  const impLabel = el('label', { class: 'btn', id: 'import-label' }, 'Загрузить архив', impInput);
  const dry = el('input', { id: 'imp-dry', type: 'checkbox' });
  const pick = el('input', { id: 'imp-select', type: 'checkbox' });
  const impPass = field('imp-pass', { type: 'password', autocomplete: 'current-password', placeholder: 'Пароль от этого архива' });
  const impGo = el('button', { id: 'imp-go', type: 'button', class: 'primary', textContent: 'Расшифровать и загрузить' });
  const impRow = el('div', { id: 'imp-row', class: 'row', hidden: true }, revealable(impPass), impGo);
  const preview = el('div', { id: 'imp-preview', class: 'card calm', hidden: true });
  const hidePreview = () => { preview.hidden = true; preview.replaceChildren(); };

  // План с учётом отмеченных групп данных (если выбор включён).
  const selectedPlan = inf => { const boxes = [...preview.querySelectorAll('.imp-group-box')]; return boxes.length ? filterPlan(inf.plan, new Set(boxes.filter(b => b.checked).map(b => b.dataset.group))) : inf.plan; };
  async function apply(inf, mode, withPrefs) {
    try {
      const plan = selectedPlan(inf);
      inf = { ...inf, plan };
      const evs = planEvents(inf.plan, mode);
      await store.saveMany(evs);
      const parts = [`Восстановлено записей: ${evs.length}`];
      if (mode === 'merge' && inf.plan.differ.length) parts.push(`отличающихся оставлено твоих: ${inf.plan.differ.length}`);
      if (inf.plan.same) parts.push(`уже было таких же: ${inf.plan.same}`);
      if (inf.r.skipped) parts.push(`пропущено повреждённых: ${inf.r.skipped}`);
      if (inf.r.migrated?.length) parts.push(`формат архива обновлён (версия ${inf.r.migrated[0].from} → ${inf.r.migrated.at(-1).to})`);
      if (withPrefs) { for (const [k, v] of Object.entries(inf.prefs)) setPref(k, v); parts.push('настройки применены, перезапускаю…'); }
      hidePreview();
      toast(parts.join(', '));
      refresh(); onSaved();
      if (withPrefs) setTimeout(() => location.reload(), 1500);                 // чтобы тема, размер текста и напоминания сразу вступили в силу
    } catch (err) { toast('Ошибка: ' + err.message); }
  }

  function showPreview(inf, dryRun) {
    const { plan, r, prefs } = inf, n = plan.differ.length;
    const prefsBox = Object.keys(prefs).length ? el('label', { class: 'check-label' }, el('input', { id: 'imp-prefs', type: 'checkbox', checked: inf.emptyDevice }), ' Восстановить и настройки (тема, размер текста, время напоминаний)') : null;
    const groups = pick.checked && !dryRun ? planGroups(plan) : [];
    const refresh = () => { const sp = selectedPlan(inf); const m = document.getElementById('imp-merge'), r2 = document.getElementById('imp-replace'); if (m) m.textContent = sp.fresh.length ? `Добавить только новое (${sp.fresh.length})` : 'Ничего нового не добавлять'; if (r2) r2.textContent = `Добавить и заменить отличающиеся (${sp.differ.length})`; };
    const groupBox = groups.length ? el('div', { id: 'imp-groups', class: 'form-stack' }, el('strong', { textContent: 'Что загружать' }), ...groups.map(g => el('label', { class: 'check-label imp-group' },
      el('input', { type: 'checkbox', class: 'imp-group-box', checked: true, dataset: { group: g.group }, onchange: refresh }), ` ${g.group}: новых ${g.fresh}${g.differ ? `, отличается ${g.differ}` : ''}`))) : null;
    const lines = [
      `Записей в файле: ${plan.total}, видов данных: ${plan.types}${plan.range ? `, за период ${dateRu(todayStr(plan.range.from))} — ${dateRu(todayStr(plan.range.to))}` : ''}.`,
      `Новых для этого устройства: ${plan.fresh.length}. Уже есть такие же: ${plan.same}. Отличаются от твоих: ${n}.`,
      r.migrated?.length ? `Формат файла старый, он будет обновлён (версия ${r.migrated[0].from} → ${r.migrated.at(-1).to}).` : '',
      r.skipped ? `Повреждённых записей в файле: ${r.skipped}, они будут пропущены.` : '',
    ].filter(Boolean);
    const samples = plan.differ.slice(0, 3).map(d => { const x = describeEvent(d.incoming); return `${x.kind}${x.title ? `: «${x.title}»` : ''}`; });
    fill(preview,
      el('strong', { textContent: r.meta?.exportedAt ? `Архив от ${dateRu(todayStr(r.meta.exportedAt))}${r.meta.version ? ` (версия ${r.meta.version})` : ''}` : 'Архив' }),
      ...lines.map(t => el('p', { class: 'muted', textContent: t })),
      n ? el('p', { class: 'muted', id: 'imp-differ', textContent: `Отличаются, например: ${samples.join('; ')}${n > 3 ? ' и другие' : ''}. По умолчанию остаются твои версии.` }) : null,
      groupBox,
      dryRun ? el('p', { class: 'hint', id: 'imp-dry-note', textContent: 'Файл читается без ошибок. Это только проверка: ничего не загружено.' }) : prefsBox,
      el('div', { class: 'row wrap' },
        dryRun ? null : el('button', { type: 'button', id: 'imp-merge', class: 'primary', textContent: plan.fresh.length ? `Добавить только новое (${plan.fresh.length})` : 'Ничего нового не добавлять', onclick: () => apply(inf, 'merge', !!document.getElementById('imp-prefs')?.checked) }),
        !dryRun && n ? el('button', { type: 'button', id: 'imp-replace', class: 'chip', textContent: `Добавить и заменить отличающиеся (${n})`, onclick: () => { if (confirm(`Эти ${n} записей на устройстве будут заменены версиями из архива. Продолжить?`)) apply(inf, 'replace', !!document.getElementById('imp-prefs')?.checked); } }) : null,
        el('button', { type: 'button', id: 'imp-cancel', class: 'chip', textContent: dryRun ? 'Закрыть' : 'Отмена', onclick: hidePreview })));
    preview.hidden = false;
  }

  // Что делать с прочитанным архивом: чистое добавление применяем сразу, остальное показываем.
  async function decide(r) {
    const plan = importPlan(store.state.events, r.events), prefs = cleanPrefs(r.prefs);
    const emptyDevice = !store.state.events.some(e => e.type !== 'profile');
    const prefsDiffer = Object.entries(prefs).some(([k, v]) => JSON.stringify(v) !== JSON.stringify(getPref(k)));
    const inf = { r, plan, prefs, emptyDevice };
    if (dry.checked) return showPreview(inf, true);
    if (pick.checked || plan.differ.length || (prefsDiffer && !emptyDevice)) return showPreview(inf, false);
    if (!plan.fresh.length && !(prefsDiffer && emptyDevice)) { toast('В архиве нет ничего нового: все записи уже есть на этом устройстве'); return; }
    await apply(inf, 'merge', prefsDiffer && emptyDevice);
  }
  async function run(text, password) {
    try {
      const r = await readBackup(text, password);
      pending = null; impRow.hidden = true; impPass.value = '';
      await decide(r);
    } catch (err) {
      if (err instanceof NeedPasswordError || err instanceof BadBackupPasswordError) { impRow.hidden = false; toast(err.message); }
      else { pending = null; impRow.hidden = true; toast('Ошибка: ' + err.message); }
    }
  }
  impInput.onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    hidePreview();
    if (file.size > MAX_BACKUP_BYTES) return toast('Файл слишком большой');
    if (looksLikeZip(new Uint8Array(await file.slice(0, 4).arrayBuffer()))) return toast('Это выгрузка для анализа (ZIP): из неё нельзя восстановить данные. Выбери файл архива с расширением .json');
    const text = await file.text();
    if (backupKind(text) === 'encrypted') { pending = text; impRow.hidden = false; impPass.focus(); toast('Архив зашифрован: введи пароль от него'); return; }
    await run(text);
  };
  impGo.onclick = async () => { if (pending) { setBusy(impGo, true, 'Расшифровываю…'); await run(pending, impPass.value); setBusy(impGo, false); } };

  // ---------- для гиков: диагностика и восстановление ----------
  const geekSize = el('div', { id: 'geek-size', class: 'muted geek-pre' });
  const renderGeekSize = () => {
    const rows = sizeByType(store.state.events);
    const total = rows.reduce((s, r) => s + r.bytes, 0);
    geekSize.textContent = rows.length
      ? `Размер базы ≈ ${formatBytes(total)} (по JSON, в IndexedDB чуть больше)\n` + rows.map(r => `${r.type}: ${r.count} шт · ${formatBytes(r.bytes)}`).join('\n')
      : 'Записей пока нет';
  };
  const bundleBtn = el('button', { id: 'geek-bundle', type: 'button', textContent: 'Скопировать отладочный бандл', onclick: async () => {
    const c = await db.counts();
    copyText(debugBundle({
      version: VERSION, events: store.state.events, errors: errorLog,
      extra: [`IndexedDB: ${c.idb ?? 'ошибка'} записей`, `копия в localStorage: ${c.ls ?? 'выключена'}`, `последний архив: ${agoText(getPref('lastBackupAt'))}`],
    }), 'Бандл скопирован: теперь его можно вставить в письмо или заметку');
  } });

  // Replay: «как было» на конец выбранной даты, только чтение.
  const replayDate = el('input', { id: 'geek-replay-date', type: 'date', max: todayStr(), 'aria-label': 'Дата среза' });
  replayDate.value = todayStr();
  const replayOut = el('div', { id: 'geek-replay-out', class: 'card calm', hidden: true });
  const replayBtn = el('button', { id: 'geek-replay', type: 'button', textContent: 'Показать, как было', onclick: () => {
    const ts = endOfDayTs(replayDate.value);
    if (!Number.isFinite(ts)) return toast('Выбери дату');
    const snap = snapshotAt(store.state.events, ts);
    const sum = replaySummary(snap);
    fill(replayOut,
      el('strong', { textContent: `Состояние на конец ${dateRu(replayDate.value)}` }),
      el('p', { class: 'muted', textContent: `Записей: ${sum.total}${sum.byType.length ? ' — ' + sum.byType.map(r => `${r.type}: ${r.count}`).join(', ') : ''}` }),
      el('p', { class: 'muted', textContent: 'Показаны записи, созданные до этой даты; отметки «сделано» позже даты откачены. Правки текста после даты отмотать нельзя — старых версий текста не хранится.' }),
      ...snap.slice(-15).reverse().map(e => { const d = describeEvent(e); return el('p', { class: 'muted geek-line', textContent: `${todayStr(e.ts)} · ${d.kind}${d.title ? ` — «${d.title}»` : ''}` }); }),
      sum.total > 15 ? el('p', { class: 'muted', textContent: `…и ещё ${sum.total - 15}` }) : null);
    replayOut.hidden = false;
  } });

  // Отмена за последний час: список изменений человеческими словами, восстановление прежней версии.
  const undoOut = el('div', { id: 'geek-undo-out', class: 'form-stack' });
  const renderUndo = () => {
    const steps = getUndoLog().recent();
    fill(undoOut, steps.length
      ? steps.map(s => el('div', { class: 'row geek-undo-row' },
          el('span', { class: 'geek-undo-text', textContent: describeUndo(s) }),
          el('button', { type: 'button', class: 'chip', textContent: 'Вернуть', onclick: async () => {
            const act = undoAction(s);
            if (!confirm(`Отменить шаг: ${describeUndo(s)}?`)) return;
            try {
              if (act.remove) await store.remove(act.remove);
              else if (act.save) await store.save(act.save);
              toast('Шаг отменён'); renderUndo();
            } catch (err) { toast('Не удалось: ' + err.message); }
          } })))
      : [el('p', { class: 'muted', textContent: 'За последний час изменений не было. Журнал живёт, пока открыто приложение.' })]);
  };

  // Diff со старым бэкапом: только просмотр различий и копирование записи.
  const diffInput = el('input', { id: 'geek-diff-input', type: 'file', accept: '.json,application/json,text/plain', hidden: true });
  const diffLabel = el('label', { class: 'btn', id: 'geek-diff-label' }, 'Сравнить со старым бэкапом', diffInput);
  const diffOut = el('div', { id: 'geek-diff-out', class: 'card calm', hidden: true });
  const recordRow = (ev, extra = null) => {
    const d = describeEvent(ev);
    return el('div', { class: 'geek-diff-row' },
      el('p', { class: 'geek-undo-text', textContent: `${d.kind}${d.title ? ` — «${d.title}»` : ''} (${todayStr(ev.ts)})` }),
      extra,
      el('button', { type: 'button', class: 'chip', textContent: 'Копировать запись из бэкапа', onclick: () => copyText(JSON.stringify(ev, null, 2), 'Запись скопирована') }));
  };
  diffInput.onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) return toast('Файл слишком большой');
    const text = await file.text();
    if (backupKind(text) === 'encrypted') return toast('Бэкап зашифрован: сравнение работает с открытым .json');
    let r;
    try { r = parseImport(text); } catch (err) { return toast(err.message); }
    const d = diffRecords(store.state.events, r.events);
    fill(diffOut,
      el('strong', { textContent: `Различия с бэкапом${r.meta?.exportedAt ? ` от ${dateRu(todayStr(r.meta.exportedAt))}` : ''}` }),
      el('p', { class: 'muted', textContent: diffSummary(d) }),
      d.changed.length ? el('strong', { textContent: 'Отличаются версии' }) : null,
      ...d.changed.slice(0, 20).map(c => recordRow(c.backup, c.fields.length
        ? el('ul', { class: 'plain muted geek-diff-fields' }, ...c.fields.slice(0, 5).map(f => el('li', { textContent: `${f.field}: было ${f.was} → стало ${f.now}` })))
        : null)),
      d.changed.length > 20 ? el('p', { class: 'muted', textContent: `…и ещё ${d.changed.length - 20} отличающихся` }) : null,
      d.onlyBackup.length ? el('strong', { textContent: 'Есть только в бэкапе' }) : null,
      ...d.onlyBackup.slice(0, 20).map(ev => recordRow(ev)),
      d.onlyBackup.length > 20 ? el('p', { class: 'muted', textContent: `…и ещё ${d.onlyBackup.length - 20}` }) : null,
      !d.changed.length && !d.onlyBackup.length ? el('p', { class: 'muted', textContent: 'В бэкапе нет ничего, чего бы не было сейчас, или что отличалось бы.' }) : null);
    diffOut.hidden = false;
  };

  // Git-friendly выгрузка дневника и авточерновик итога дня.
  const gitBtn = el('button', { id: 'geek-git-md', type: 'button', textContent: 'Дневник для git (markdown с путями)', onclick: async () => {
    try { await saveTextFile(`lifeos-diary-git-${todayStr()}.md`, diaryToGitMarkdown(store.state.events), 'text/markdown'); toast('Выгрузка сохранена'); }
    catch (err) { toast('Не удалось сохранить: ' + (err?.message || err)); }
  } });
  const draftOut = el('pre', { id: 'geek-draft-out', class: 'diag', hidden: true });
  const draftBtn = el('button', { id: 'geek-day-draft', type: 'button', textContent: 'Черновик итога дня', onclick: () => {
    const text = dayDraft(store.state.events, todayStr());
    draftOut.textContent = text; draftOut.hidden = false;
    copyText(text, 'Черновик скопирован: вставь в дневник и допиши от себя');
  } });

  // Триггер с сухим прогоном и сторож тишины.
  const trigOut = el('p', { id: 'geek-trigger-out', class: 'muted' });
  const dryBtn = el('button', { id: 'geek-trigger-dry', type: 'button', class: 'chip', textContent: 'Сухой прогон за месяц', onclick: () => {
    const today = todayStr();
    const r = dryRunTrigger(store.state.events, { from: addDays(today, -30), to: today });
    trigOut.textContent = r.hits
      ? `Правило «${r.rule.text}» сработало бы за месяц ${r.hits} раз(а): ${r.tasks.slice(0, 5).map(t => `«${t.text}» (${t.days} дн.)`).join(', ')}${r.hits > 5 ? '…' : ''}`
      : `Правило «${r.rule.text}» за месяц ни разу бы не сработало.`;
  } });
  const watchOut = el('div', { id: 'geek-watchdog', class: 'form-stack' });
  const renderWatchdog = () => {
    const w = watchdog(store.state.events);
    fill(watchOut, w
      ? [el('p', { class: 'warn', textContent: `Сторож тишины: ${w.text}` }),
        el('button', { type: 'button', class: 'chip', id: 'geek-watchdog-task', textContent: 'Создать задачу «проверь, всё ли живо»', onclick: async () => {
          try { await store.save(makeWatchdogTask()); toast('Задача создана на сегодня'); renderWatchdog(); }
          catch (err) { toast('Не удалось: ' + err.message); }
        } })]
      : [el('p', { class: 'muted', textContent: 'Сторож тишины: записи свежие, всё в порядке.' })]);
  };

  const geek = el('details', { id: 'geek-box', class: 'geek' },
    el('summary', { textContent: 'Для гиков: диагностика и восстановление' }),
    el('div', { class: 'form-stack' },
      el('strong', { textContent: 'Панель инженера' }), geekSize, el('div', { class: 'row wrap' }, bundleBtn),
      el('strong', { textContent: 'Replay: как было на дату' }),
      el('div', { class: 'row wrap' }, replayDate, replayBtn), replayOut,
      el('strong', { textContent: 'Ctrl+Z по жизни (последний час)' }), undoOut,
      el('strong', { textContent: 'Сравнение со старым бэкапом' }),
      el('p', { class: 'muted', textContent: 'Открой старый открытый .json-бэкап: покажу различия. Ничего не меняется — только просмотр и копирование записи.' }),
      el('div', { class: 'row wrap' }, diffLabel), diffOut,
      el('strong', { textContent: 'Выгрузки и черновики' }),
      el('div', { class: 'row wrap' }, gitBtn, draftBtn), draftOut,
      el('strong', { textContent: 'Триггеры' }),
      el('p', { class: 'muted', textContent: `Правило: ${OVERDUE_SPLIT_RULE.text}. Сначала — сухой прогон: сколько раз оно сработало бы за прошлый месяц.` }),
      el('div', { class: 'row wrap' }, dryBtn), trigOut,
      watchOut));

  const remind = el('select', { id: 'archive-remind', 'aria-label': 'Как часто напоминать про архив' }, ...[[7, 'раз в неделю'], [14, 'раз в 2 недели'], [30, 'раз в месяц'], [0, 'не напоминать']].map(([v, t]) => el('option', { value: String(v), textContent: t })));
  remind.value = String(getPref('backupEveryDays'));
  remind.onchange = () => { setPref('backupEveryDays', Number(remind.value)); toast('Сохранено'); };

  const node = el('div', { class: 'form-stack', id: 'archive-box' },
    el('p', { class: 'muted', textContent: 'Все твои записи, навыки и настройки в одном файле. Сохрани его в надёжном месте: облако, почта себе, компьютер. Загрузить архив можно на любом устройстве: ничего не пропадёт.' }),
    info,
    el('strong', { textContent: 'Сохранить архив' }),
    revealable(bkPass),
    el('div', { class: 'row wrap' }, bkBtn, plainBtn),
    el('strong', { textContent: 'Вечный HTML-архив' }),
    el('p', { class: 'muted', textContent: 'Один файл, который откроется в любом браузере даже через много лет — без приложения и интернета: разделы, поиск, фильтры, суммы по деньгам. Исходные данные можно скачать из него обратно. Файл не зашифрован — храни его как личный документ.' }),
    el('div', { class: 'row wrap' }, htmlBtn),
    el('label', {}, 'Напоминать про архив: ', remind),
    el('strong', { textContent: 'Загрузить архив' }),
    el('p', { class: 'muted', textContent: 'Выбери файл (.json): открытый или зашифрованный. Новое добавится само, твои данные не затрутся. Если в файле есть отличающиеся записи, сначала покажу, что внутри.' }),
    el('div', { class: 'row wrap' }, impLabel, el('label', { class: 'check-label' }, dry, ' Только проверить файл'), el('label', { class: 'check-label' }, pick, ' Выбрать, что загружать')), impRow, preview, geek);

  // при блокировке: пароли, ожидающий файл и показанное содержимое архива не должны оставаться
  const reset = () => { pending = null; impRow.hidden = true; impPass.value = ''; bkPass.value = ''; dry.checked = false; pick.checked = false; hidePreview();
    geek.open = false; replayOut.hidden = true; replayOut.replaceChildren(); diffOut.hidden = true; diffOut.replaceChildren(); draftOut.hidden = true; draftOut.textContent = ''; trigOut.textContent = ''; renderUndo(); renderWatchdog(); };
  return { node, reset, update: () => { refresh(); renderGeekSize(); renderUndo(); renderWatchdog(); } };
}
