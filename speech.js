// Озвучка слов встроенным синтезом речи устройства. Без сети: текст никуда не отправляется.
// Если на телефоне нет голоса для нужного языка, кнопка сообщит об этом, а не промолчит.
export const LANG = { english: 'en-US', hebrew: 'he-IL' };
const SCRIPT = { english: /[A-Za-z]/, hebrew: /[֐-׿]/ };
const CYR = /[А-Яа-яЁё]/;

export const canSpeak = () => typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';

// Что произносить: слово или фраза без пояснения в скобках и без перевода после тире.
export function speakable(text) {
  return String(text ?? '').split(/\s[—–]\s/)[0].replace(/\([^)]*\)/g, ' ').replace(/[_]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
}

// Сторона карточки на изучаемом языке: ('q' или 'a') и текст для озвучки. Пропуски «___» заполняет ответ.
export function foreignSide(card, lang) {
  const re = SCRIPT[lang];
  if (!re) return null;
  const q = String(card.q ?? ''), a = String(card.a ?? '');
  const isForeign = s => re.test(s) && !CYR.test(speakable(s));
  if (/_{2,}/.test(q) && re.test(q)) {                         // «I ___ to the shop. (go)» → целиком с ответом
    const fill = speakable(a).split(/[,/]/)[0].trim();
    return { side: 'a', text: speakable(q.replace(/_{2,}/, ` ${fill} `)) };
  }
  if (isForeign(q)) return { side: 'q', text: speakable(q) };
  if (isForeign(a)) return { side: 'a', text: speakable(a) };
  return null;
}

// Произнести. Возвращает true, если запрос отправлен. onError вызывается, если голоса нет.
export function speak(text, lang, onError = () => {}) {
  if (!canSpeak() || !text) return false;
  try {
    const synth = globalThis.speechSynthesis;
    synth.cancel();
    const u = new globalThis.SpeechSynthesisUtterance(text);
    u.lang = LANG[lang] ?? lang; u.rate = 0.9;
    u.onerror = e => { if (e?.error && e.error !== 'canceled' && e.error !== 'interrupted') onError(e.error); };
    synth.speak(u);
    return true;
  } catch { onError('failed'); return false; }
}
