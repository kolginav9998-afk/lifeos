// «Ещё» → «Архив данных»: весь архив одним файлом. Сохранить (с паролем или без) и загрузить (файл сам определяется: открытый или зашифрованный).
// Загрузка по умолчанию только добавляет: если ничего не затирается, она проходит без вопросов; если в файле есть записи, отличающиеся от
// имеющихся, сначала показываем, что внутри, и просим выбрать.
import { el, fill, toast, setBusy, revealable, dateRu, agoText } from './ui.js';
import * as store from './store.js';
import { serialize, todayStr } from './events.js';
import { encryptBackup, decryptBackup, readBackup, backupKind, NeedPasswordError, BadBackupPasswordError, MAX_BACKUP_BYTES } from './backup.js';
import { importPlan, planEvents, planGroups, filterPlan, cleanPrefs, archiveName, looksLikeZip } from './archive.js';
import { describeEvent } from './search.js';
import { saveTextFile } from './platform.js';
import * as vault from './vault.js';
import { getPref, getPrefs, setPref } from './prefs.js';
import { VERSION } from './version.js';

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

  const remind = el('select', { id: 'archive-remind', 'aria-label': 'Как часто напоминать про архив' }, ...[[7, 'раз в неделю'], [14, 'раз в 2 недели'], [30, 'раз в месяц'], [0, 'не напоминать']].map(([v, t]) => el('option', { value: String(v), textContent: t })));
  remind.value = String(getPref('backupEveryDays'));
  remind.onchange = () => { setPref('backupEveryDays', Number(remind.value)); toast('Сохранено'); };

  const node = el('div', { class: 'form-stack', id: 'archive-box' },
    el('p', { class: 'muted', textContent: 'Все твои записи, навыки и настройки в одном файле. Сохрани его в надёжном месте: облако, почта себе, компьютер. Загрузить архив можно на любом устройстве: ничего не пропадёт.' }),
    info,
    el('strong', { textContent: 'Сохранить архив' }),
    revealable(bkPass),
    el('div', { class: 'row wrap' }, bkBtn, plainBtn),
    el('label', {}, 'Напоминать про архив: ', remind),
    el('strong', { textContent: 'Загрузить архив' }),
    el('p', { class: 'muted', textContent: 'Выбери файл (.json): открытый или зашифрованный. Новое добавится само, твои данные не затрутся. Если в файле есть отличающиеся записи, сначала покажу, что внутри.' }),
    el('div', { class: 'row wrap' }, impLabel, el('label', { class: 'check-label' }, dry, ' Только проверить файл'), el('label', { class: 'check-label' }, pick, ' Выбрать, что загружать')), impRow, preview);

  // при блокировке: пароли, ожидающий файл и показанное содержимое архива не должны оставаться
  const reset = () => { pending = null; impRow.hidden = true; impPass.value = ''; bkPass.value = ''; dry.checked = false; pick.checked = false; hidePreview(); };
  return { node, reset, update: refresh };
}
