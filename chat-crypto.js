// Сквозное шифрование переписки (R4.3). Чистые функции на WebCrypto, без сети и без хранилища.
// У человека одна пара ключей ECDH P-256. Закрытый ключ хранится в журнале записей (запись chatkey: шифруется вместе со всеми данными и
// едет между устройствами владельца), открытый публикуется на сервере (POST /v1/keys). Общий ключ двух людей получается так:
// ECDH (мой закрытый, его открытый) → HKDF-SHA-256 (соль = два имени по алфавиту, info = lifeos-chat-v1) → AES-GCM 256.
// Для каждого сообщения новый случайный iv; текст перед шифрованием дополняется пробелами до кратного 128 байтам, чтобы длина
// слабее выдавала содержание. Сервер видит только «кто, кому, когда, размер».
const te = new TextEncoder(), td = new TextDecoder();
export const CHAT_INFO = 'lifeos-chat-v1';
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
const PAD = 128;

export const toB64 = bytes => { let s = ''; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = s => Uint8Array.from(atob(String(s)), c => c.charCodeAt(0));
const normName = s => String(s ?? '').normalize('NFKC').trim().toLowerCase();

// Новая пара ключей. pub — несжатая точка (65 байт, первый байт 4) в base64, как её ждёт сервер; priv — PKCS#8 в base64 для записи chatkey.
export async function generateChatKeys() {
  const pair = await crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
  const pub = toB64(await crypto.subtle.exportKey('raw', pair.publicKey));
  const priv = toB64(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { pub, priv };
}

// Закрытый ключ по записи chatkey. Возвращает null, если ключ повреждён.
export async function importPrivate(privB64) {
  try { return await crypto.subtle.importKey('pkcs8', fromB64(privB64), CURVE, false, ['deriveBits']); } catch { return null; }
}
export function validPublic(pubB64) {
  try { const b = fromB64(pubB64); return b.length === 65 && b[0] === 4; } catch { return false; }
}

// Общий ключ AES-GCM с собеседником. nameA и nameB — имена входа обоих (порядок не важен). Бросает ошибку при неверном ключе.
export async function sharedKey(privKey, peerPubB64, nameA, nameB) {
  if (!privKey || !validPublic(peerPubB64)) throw new Error('bad_key');
  const peer = await crypto.subtle.importKey('raw', fromB64(peerPubB64), CURVE, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privKey, 256);
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const salt = te.encode([normName(nameA), normName(nameB)].sort().join('\n'));
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(CHAT_INFO) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Зашифровать объект сообщения { v: 1, id, kind, ts, … }. Возвращает { iv, ct } в base64.
export async function encryptMessage(key, obj) {
  const raw = te.encode(JSON.stringify(obj));
  const padded = new Uint8Array(Math.ceil(raw.length / PAD) * PAD).fill(0x20);
  padded.set(raw);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, padded);
  return { iv: toB64(iv), ct: toB64(ct) };
}

// Расшифровать; null, если ключ не тот, сообщение повреждено или это не наш формат.
export async function decryptMessage(key, { iv, ct }) {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct));
    const obj = JSON.parse(td.decode(plain));
    return obj && typeof obj === 'object' && obj.v === 1 ? obj : null;
  } catch { return null; }
}

// Код безопасности: короткий отпечаток двух открытых ключей (6 групп по 4 цифры), одинаковый у обоих собеседников.
// Его можно сверить вживую или голосом: если совпало, посредник ключи не подменял.
export async function safetyCode(pubA, pubB) {
  const parts = [String(pubA ?? ''), String(pubB ?? '')].sort();
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(`lifeos-safety-v1|${parts.join('|')}`)));
  const groups = [];
  for (let i = 0; i < 6; i++) groups.push(String(((d[2 * i] << 8) | d[2 * i + 1]) % 10000).padStart(4, '0'));
  return groups.join(' ');
}

// Идентификатор сообщения для склейки повторов и ответов (случайный, без привязки к содержанию).
export const newMessageId = () => toB64(crypto.getRandomValues(new Uint8Array(9))).replace(/\+/g, '-').replace(/\//g, '_');

// Запись журнала с ключами чата (одна на человека, id 'chatkey', заменяемая): так закрытый ключ шифруется вместе со всеми данными
// и появляется на каждом устройстве владельца. Отдельным открытым файлом он не выгружается.
export const chatKeyRecord = (keys, now = Date.now()) => ({ id: 'chatkey', type: 'chatkey', ts: now, payload: { pub: keys.pub, priv: keys.priv }, source: 'auto', confidence: 1, evidence: [] });
export function chatKeysOf(events) {
  const e = events.find(x => x.type === 'chatkey' && x.id === 'chatkey');
  return e?.payload && typeof e.payload.pub === 'string' && typeof e.payload.priv === 'string' ? { pub: e.payload.pub, priv: e.payload.priv } : null;
}
