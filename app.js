import { makeTask, completeTask, reopenTask, groupTasks, todayStr, dueLabel, repeatLabel, serialize, parseImport } from './events.js';
import * as db from './db.js';
import { isNative, platformName, saveTextFile } from './platform.js';

const VERSION = 'R1.1';
const $ = id => document.getElementById(id);
let events = [];

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  kids.forEach(k => n.append(k));
  return n;
}

function item(ev, today) {
  const p = ev.payload;
  const lab = dueLabel(p.due, today);
  const li = el('li', { className: 'item' + (p.done ? ' done' : '') + (lab.cls === 'overdue' && !p.done ? ' is-overdue' : '') });
  const check = el('button', { className: 'check', type: 'button', textContent: p.done ? '✓' : '' });
  check.setAttribute('aria-label', p.done ? 'Вернуть в работу' : 'Отметить сделанным');
  check.onclick = async () => {
    if (!p.done) {
      const { updated, next } = completeTask(ev);
      await db.put(updated);
      if (next) await db.put(next);
    } else {
      const { updated, removeId } = reopenTask(ev);
      await db.put(updated);
      const nxt = removeId && events.find(e => e.id === removeId);
      if (nxt && !nxt.payload.done) await db.remove(removeId);
    }
    await refresh();
  };
  const metaBits = [];
  if (lab.text && !p.done) metaBits.push(el('span', { className: lab.cls, textContent: lab.text }));
  const rep = repeatLabel(p.repeat);
  if (rep) metaBits.push(document.createTextNode((metaBits.length ? ' · ' : '') + '↻ ' + rep));
  const body = el('div', { className: 'body' }, el('span', { className: 'text', textContent: p.text }));
  if (metaBits.length) body.append(el('span', { className: 'meta' }, ...metaBits));
  const del = el('button', { className: 'del', type: 'button', textContent: '✕' });
  del.setAttribute('aria-label', 'Удалить');
  del.onclick = async () => { await db.remove(ev.id); await refresh(); };
  li.append(check, body, del);
  return li;
}

function render() {
  const today = todayStr();
  $('date').textContent = new Date().toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });
  const g = groupTasks(events, today);
  for (const key of ['overdue', 'today', 'upcoming', 'nodate']) {
    const sec = $('g-' + key);
    sec.hidden = g[key].length === 0;
    sec.querySelector('ul').replaceChildren(...g[key].map(e => item(e, today)));
  }
  $('done-list').replaceChildren(...g.done.map(e => item(e, today)));
  $('done-count').textContent = g.done.length;
  $('empty').hidden = g.openCount > 0;
}

async function refresh() {
  events = await db.getAll();
  render();
}

function say(text) { $('msg').textContent = text; }

$('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('add-input');
  const text = input.value.trim();
  if (!text) return;
  const due = $('add-due').value || null;
  const repeat = $('add-repeat').value || null;
  input.value = '';            // чистим сразу, чтобы быстрый ввод не терялся
  $('add-due').value = '';
  $('add-repeat').value = '';
  await db.put(makeTask(text, Date.now(), { due, repeat }));
  await refresh().then(renderDiag);
});

$('export-btn').onclick = async () => {
  try {
    await saveTextFile(`lifeos-${new Date().toISOString().slice(0, 10)}.json`, serialize(events));
    say(`Экспортировано событий: ${events.length}`);
  } catch (err) { say('Не удалось сохранить: ' + (err?.message || err)); }
};

$('import-input').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { events: evs, skipped } = parseImport(await file.text());
    await db.putMany(evs);
    await refresh().then(renderDiag);
    say(`Импортировано: ${evs.length}` + (skipped ? `, пропущено битых: ${skipped}` : ''));
  } catch (err) { say('Ошибка: ' + err.message); }
};

// Диагностика хранилища: видно, переживают ли данные закрытие приложения
const META_KEY = 'lifeos.meta';
function bumpLaunch() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) || 'null') || { first: Date.now(), launches: 0 };
    m.launches += 1;
    localStorage.setItem(META_KEY, JSON.stringify(m));
    return m;
  } catch { return null; }
}
const meta = bumpLaunch();

async function renderDiag() {
  let persisted = 'неизвестно';
  try {
    if (navigator.storage?.persist) persisted = (await navigator.storage.persist()) ? 'да' : 'нет';
  } catch {}
  const c = await db.counts();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const lines = [
    meta ? `Запуск №${meta.launches} (первый: ${new Date(meta.first).toLocaleString('ru')})` : 'Запуски: счётчик недоступен',
    `Платформа: ${platformName}; ${isNative ? 'встроенное приложение' : standalone ? 'установленное приложение' : 'вкладка браузера'}`,
    `Записей: IndexedDB ${c.idb ?? 'ошибка'}, копия ${c.ls}`,
    `Защита от очистки: ${persisted}`,
    db.state.idbOk === false ? `Ошибка IndexedDB: ${db.state.idbError}` : '',
  ].filter(Boolean);
  $('diag').textContent = lines.join('\n');
}

function setStatus() {
  $('status').textContent = `${VERSION} · ${navigator.onLine ? 'онлайн' : 'офлайн'}`;
}
addEventListener('online', setStatus);
addEventListener('offline', setStatus);
setStatus();

// В приложении файлы уже внутри APK: офлайн-кэш сайта не нужен (и мешал бы обновлениям)
if (!isNative && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

refresh().then(renderDiag);
// вернулись в приложение — пересчитать «сегодня» (мог смениться день)
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
