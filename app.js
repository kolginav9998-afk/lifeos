import { makeTask, toggleTask, splitTasks, serialize, parseImport } from './events.js';
import * as db from './db.js';

const VERSION = 'R0.2.1';
const $ = id => document.getElementById(id);
let events = [];

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  kids.forEach(k => n.append(k));
  return n;
}

function item(ev) {
  const li = el('li', { className: 'item' + (ev.payload.done ? ' done' : '') });
  const check = el('button', { className: 'check', type: 'button', textContent: ev.payload.done ? '✓' : '' });
  check.setAttribute('aria-label', ev.payload.done ? 'Вернуть в работу' : 'Отметить сделанным');
  check.onclick = async () => { await db.put(toggleTask(ev)); await refresh(); };
  const text = el('span', { className: 'text', textContent: ev.payload.text });
  const del = el('button', { className: 'del', type: 'button', textContent: '✕' });
  del.setAttribute('aria-label', 'Удалить');
  del.onclick = async () => { await db.remove(ev.id); await refresh(); };
  li.append(check, text, del);
  return li;
}

function render() {
  const { open, done } = splitTasks(events);
  $('open-list').replaceChildren(...open.map(item));
  $('done-list').replaceChildren(...done.map(item));
  $('done-count').textContent = done.length;
  $('empty').hidden = open.length > 0;
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
  input.value = '';            // чистим сразу, чтобы быстрый ввод не терялся
  await db.put(makeTask(text));
  await refresh().then(renderDiag);
});

$('export-btn').onclick = () => {
  const blob = new Blob([serialize(events)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `lifeos-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say(`Экспортировано событий: ${events.length}`);
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
    `Режим: ${standalone ? 'установленное приложение' : 'вкладка браузера'}`,
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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

refresh().then(renderDiag);
