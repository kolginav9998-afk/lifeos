// Криптопримитивы на WebCrypto (без сторонних библиотек).
// PBKDF2-SHA256 -> AES-256-GCM. Для каждой записи свой случайный IV; в AAD кладём идентификатор,
// чтобы шифртекст нельзя было незаметно подменить другим.

const te = new TextEncoder();
const td = new TextDecoder();

export const PBKDF2_ITER = 600000;
export const MIN_ITER = 1000;
export const MAX_ITER = 10_000_000;

export const textToBytes = s => te.encode(s);
export const bytesToText = b => td.decode(b);
export const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));

export function b64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function deriveKey(password, salt, iterations) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITER || iterations > MAX_ITER) throw new Error('bad iterations');
  const base = await crypto.subtle.importKey('raw', te.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const importAesKey = raw => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

export async function encryptBytes(key, plain, aad) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain);
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
// Бросает исключение, если ключ/данные/AAD не совпали или шифртекст изменён.
export async function decryptBytes(key, { iv, ct }, aad) {
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: aad }, key, unb64(ct));
  return new Uint8Array(out);
}

// Сырые байты из пароля (для ключа входа на сервер). Это НЕ ключ шифрования: у них разные соли и метки.
export async function deriveBits(password, salt, iterations, label) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITER || iterations > MAX_ITER) throw new Error('bad iterations');
  const base = await crypto.subtle.importKey('raw', te.encode(`${label}\u0000${String(password).normalize('NFKC')}`), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256));
}
export const deriveAuthKey = async (password, salt, iterations) => b64(await deriveBits(password, salt, iterations, 'lifeos-auth-v1'));
