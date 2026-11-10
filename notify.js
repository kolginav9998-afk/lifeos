// Синхронизация напоминаний с системой (только в приложении для Android).
import { planReminders, TEST_ID } from './reminders.js';
import { syncNotifications, clearNotifications, scheduleTest, isNative } from './platform.js';
import { getPref } from './prefs.js';
import * as store from './store.js';
import * as vault from './vault.js';

export const info = { last: null };

export async function resync({ ask = false } = {}) {
  if (!isNative) return { ok: false, reason: 'web' };
  if (!getPref('remindersOn')) { info.last = await clearNotifications(); return info.last; }
  if (vault.status() === 'locked') return { ok: false, reason: 'locked' };          // не затираем план пустыми данными
  const items = planReminders(store.state.events, Date.now(), { taskHour: getPref('taskHour'), habitHour: getPref('habitHour') });
  info.last = await syncNotifications(items, { ask });
  return info.last;
}

let timer = null;
export function resyncSoon() { clearTimeout(timer); timer = setTimeout(() => { resync().catch(() => {}); }, 1500); }

export async function testNow() { return scheduleTest(TEST_ID, 5); }
