// Резервные копии. Зашифрованная копия не зависит от пароля входа: пароль задаётся при сохранении.
import { serialize, parseImport } from './events.js';
import * as C from './cryptoutil.js';
import { checkPassword } from './vault.js';

export class BadBackupPasswordError extends Error { constructor() { super('Неверный пароль копии или файл повреждён'); this.name = 'BadBackupPasswordError'; } }
export class NeedPasswordError extends Error { constructor() { super('Нужен пароль от копии'); this.name = 'NeedPasswordError'; } }

const AAD = C.textToBytes('lifeos-backup-v1');
export const MAX_BACKUP_BYTES = 30 * 1024 * 1024;

export function backupKind(text) {
  try {
    const d = JSON.parse(text);
    if (d && d.app === 'lifeos-enc') return 'encrypted';
    if (d && d.app === 'lifeos') return 'plain';
  } catch { /* не JSON */ }
  return 'unknown';
}

export async function encryptBackup(events, password, { iterations = C.PBKDF2_ITER, now = Date.now(), version, prefs } = {}) {
  const weak = checkPassword(password);
  if (weak) throw new Error(weak);
  const salt = C.randomBytes(16);
  const key = await C.deriveKey(password, salt, iterations);
  const { iv, ct } = await C.encryptBytes(key, C.textToBytes(serialize(events, now, { version, prefs })), AAD);
  return JSON.stringify({ app: 'lifeos-enc', v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: C.b64(salt), iv, ct });
}

export async function decryptBackup(text, password) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Это не файл Life OS'); }
  if (!d || d.app !== 'lifeos-enc' || d.v !== 1 || typeof d.salt !== 'string' || typeof d.iv !== 'string' || typeof d.ct !== 'string') {
    throw new Error('Это не зашифрованная копия Life OS');
  }
  if (!password) throw new NeedPasswordError();
  if (!Number.isInteger(d.iter) || d.iter < C.MIN_ITER || d.iter > C.MAX_ITER) throw new Error('Файл повреждён (параметры шифрования)');
  let plain;
  try {
    const key = await C.deriveKey(password, C.unb64(d.salt), d.iter);
    plain = C.bytesToText(await C.decryptBytes(key, { iv: d.iv, ct: d.ct }, AAD));
  } catch { throw new BadBackupPasswordError(); }
  return parseImport(plain);
}

// Единая точка: понимает и открытые, и зашифрованные копии.
export async function readBackup(text, password) {
  if (text.length > MAX_BACKUP_BYTES) throw new Error('Файл слишком большой');
  const kind = backupKind(text);
  if (kind === 'encrypted') return { ...(await decryptBackup(text, password)), encrypted: true };
  if (kind === 'plain') return { ...parseImport(text), encrypted: false };
  throw new Error('Это не резервная копия Life OS');
}
