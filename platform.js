// Различия между сайтом и Android-приложением — только здесь.
// Всё остальное (логика, экраны, данные) — один и тот же код.

import { APP_NAME } from './config.js';
export const isNative = !!globalThis.Capacitor?.isNativePlatform?.();
export const platformName = isNative ? 'Android-приложение' : 'сайт';

function plugin(name) {
  const C = globalThis.Capacitor;
  return C?.Plugins?.[name] || C?.registerPlugin?.(name);
}

// Нативный плагин по имени (null на сайте).
export const nativePlugin = name => (isNative ? plugin(name) : null);

// Сохранить текстовый файл: на сайте — скачивание, в приложении — окно «Поделиться/Сохранить».
export async function saveTextFile(filename, text, mime = 'application/json') {
  if (isNative) {
    const Filesystem = plugin('Filesystem');
    const Share = plugin('Share');
    const { uri } = await Filesystem.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
    await Share.share({ title: filename, url: uri, dialogTitle: 'Сохранить резервную копию' });
    return 'share';
  }
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'download';
}

// Сохранить бинарный файл (например, ZIP): на сайте — скачивание, в приложении — окно «Поделиться/Сохранить».
export async function saveBinaryFile(filename, bytes, mime = 'application/octet-stream') {
  if (isNative) {
    const Filesystem = plugin('Filesystem');
    const Share = plugin('Share');
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const { uri } = await Filesystem.writeFile({ path: filename, data: btoa(bin), directory: 'CACHE' });
    await Share.share({ title: filename, url: uri, dialogTitle: 'Сохранить файл' });
    return 'share';
  }
  const blob = new Blob([bytes], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'download';
}

// ---- локальные уведомления (только в приложении для Android) ----
// Возвращает { ok, reason?, count? }. Никогда не бросает исключений: сбой уведомлений не должен ломать приложение.
export async function syncNotifications(items, { ask = false } = {}) {
  if (!isNative) return { ok: false, reason: 'web' };
  try {
    const LN = plugin('LocalNotifications');
    const perm = await (ask ? LN.requestPermissions() : LN.checkPermissions());
    if (perm.display !== 'granted') return { ok: false, reason: 'denied' };
    const pending = await LN.getPending();
    if (pending.notifications.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    if (items.length) {
      await LN.schedule({ notifications: items.map(i => ({
        id: i.id, title: i.title, body: i.body, schedule: { at: new Date(i.at), allowWhileIdle: true },
      })) });
    }
    return { ok: true, count: items.length };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

export async function clearNotifications() {
  if (!isNative) return { ok: false, reason: 'web' };
  try {
    const LN = plugin('LocalNotifications');
    const pending = await LN.getPending();
    if (pending.notifications.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

export async function scheduleTest(id, seconds) {
  if (!isNative) return { ok: false, reason: 'web' };
  try {
    const LN = plugin('LocalNotifications');
    const perm = await LN.requestPermissions();
    if (perm.display !== 'granted') return { ok: false, reason: 'denied' };
    await LN.schedule({ notifications: [{ id, title: APP_NAME, body: 'Тестовое напоминание. Всё работает.', schedule: { at: new Date(Date.now() + seconds * 1000), allowWhileIdle: true } }] });
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}
