// Помощники для данных курса «Английский с нуля»: чистые функции, без интерфейса. Импортируют только zero-kit.js.
import { choose, listen, typed, order, match, read } from './zero-kit.js';

export const MULTI = ['sh', 'ch', 'th', 'wh', 'ck', 'ng', 'nk', 'qu', 'ee', 'ea', 'oo', 'ai', 'ay', 'oa', 'ow', 'ar', 'or', 'er', 'ir', 'ur'];
// слово → плитки (сочетания букв считаются одной плиткой)
export const tl = (w, multi = MULTI) => { const out = []; for (let i = 0; i < w.length;) { const m = multi.find(x => w.startsWith(x, i)) ?? w[i]; out.push(m); i += m.length; } return out; };
// 'cat кошка|hat шляпа' → [['cat','кошка'], ['hat','шляпа']]
export const wp = s => s.split('|').map(x => { const i = x.indexOf(' '); return [x.slice(0, i), x.slice(i + 1)]; });
export const wl = s => wp(s).map(p => p[0]);
export const tab = (head, s) => [head, ...wp(s)];

// ===== задания на слова
export const ear = (w, a, b, o) => listen(w, w, [a, b], o);
export const mean = (w, ru, wrong, o) => choose('Что значит это слово?', ru, wrong, { big: w, ...o });
export const rhy = (w, right, wrong, o) => choose('Какое слово рифмуется с этим?', right, wrong, { big: w, ...o });
export const dict = (w, o) => typed('Послушай и впиши слово', [w], { say: w, ...o });
export const bld = (w, parts, o) => order('Послушай слово и собери его из букв', parts ?? tl(w), { say: w, ...o });
export const tr = (ru, w, o) => typed(`Как по-английски «${ru}»? Впиши слово`, [w], o);
export const rd = (text, o) => read(text, o);

// ===== Алфавит: таблица букв и генератор урока
// буква: [название, /IPA названия/, основной звук, слово-пример, перевод, ошибочный звук (ловушка), русское название-ловушка, заметка]
const LT = {
  a: ['эй', '/eɪ/', '«э» широкое /æ/', 'ant', 'муравей', 'Как русское «а»', '', 'В слове буква читается коротко и широко, не «эй».'],
  b: ['би', '/biː/', '«б» /b/', 'bed', 'кровать', '«в», потому что похожа на русскую В', 'вэ', 'Русская В тут не помощник: B даёт звук «б».'],
  c: ['си', '/siː/', '«к» /k/', 'cat', 'кошка', '«с», потому что похожа на русскую С', 'эс', 'Перед некоторыми гласными бывает «с», но основной звук — «к».'],
  d: ['ди', '/diː/', '«д» /d/', 'dog', 'собака', '«т», как оглушение на конце', '', 'На конце слова d остаётся звонким «д».'],
  e: ['и', '/iː/', '«э» короткое /ɛ/', 'egg', 'яйцо', 'Как русское «е» (с «й»)', '', 'В слове буква читается коротко, как «э», не «и».'],
  f: ['эф', '/ɛf/', '«ф» /f/', 'fan', 'вентилятор', '«в»', '', ''],
  g: ['джи', '/dʒiː/', '«г» /ɡ/', 'gum', 'жвачка', '«дж», как в названии', '', 'В названии «джи», но звук обычно «г».'],
  h: ['эйч', '/eɪtʃ/', 'выдох «х» /h/', 'hat', 'шляпа', '«н», потому что похожа на русскую Н', 'эн', 'Русская Н тут не помощник: H — это лёгкий выдох.'],
  i: ['ай', '/aɪ/', '«и» короткое /ɪ/', 'igloo', 'иглу', 'Как в названии: «ай»', '', 'В слове буква читается коротко, как «и», не «ай».'],
  j: ['джей', '/dʒeɪ/', '«дж» /dʒ/', 'jam', 'джем', '«ж»', '', ''],
  k: ['кей', '/keɪ/', '«к» /k/', 'kid', 'ребёнок', '', '', ''],
  l: ['эл', '/ɛl/', '«л» /l/', 'leg', 'нога', '«ль» мягкое', '', 'Английская l твёрдая, не «ль».'],
  m: ['эм', '/ɛm/', '«м» /m/', 'map', 'карта', '', '', ''],
  n: ['эн', '/ɛn/', '«н» /n/', 'net', 'сеть', '«м»', '', ''],
  o: ['оу', '/oʊ/', '«о» открытое /ɑ/', 'ox', 'бык', 'Как русское «у»', '', 'В слове буква читается коротко и открыто, не «оу».'],
  p: ['пи', '/piː/', '«п» /p/', 'pen', 'ручка', '«р», потому что похожа на русскую Р', 'эр', 'Русская Р тут не помощник: P даёт звук «п».'],
  q: ['кью', '/kjuː/', '«кв» /kw/', 'queen', 'королева', '«к» без «в»', '', 'Q читается «кв» и всегда стоит рядом с одной и той же гласной, её мы увидим в следующем уроке.'],
  r: ['ар', '/ɑr/', '«р» без раската /r/', 'red', 'красный', '«я», потому что похожа на русскую Я', 'я', 'Русская «р» раскатистая, английская — нет.'],
  s: ['эс', '/ɛs/', '«с» /s/', 'sun', 'солнце', '«ш»', '', ''],
  t: ['ти', '/tiː/', '«т» /t/', 'ten', 'десять', '«ч»', '', ''],
  u: ['ю', '/juː/', '«а» короткое /ʌ/', 'up', 'вверх', 'Как русское «у»', '', 'В слове буква читается коротко, как «а», не «ю».'],
  v: ['ви', '/viː/', '«в» /v/', 'van', 'фургон', '«б»', '', ''],
  w: ['дабл-ю', '/ˈdʌbəl juː/', 'быстрое «у» /w/', 'web', 'паутина', '', '', 'Губы трубочкой, зубы губу не касаются.'],
  x: ['экс', '/ɛks/', '«кс» /ks/', 'box', 'коробка', '«х», потому что похожа на русскую Х', 'ха', 'Русская Х тут не помощник: X даёт «кс».'],
  y: ['уай', '/waɪ/', '«й» /j/ в начале слова', 'yes', 'да', '«у», потому что похожа на русскую У', 'у', 'Русская У тут не помощник: в начале слова Y — это «й».'],
  z: ['зи', '/ziː/', '«з» /z/', 'zip', 'молния', '«ц»', '', 'В Британии эту букву называют «зед».'],
};
const NEAR = { a: 'oe', b: 'dpq', c: 'eosk', d: 'bqpt', e: 'ca', f: 'tl', g: 'qjy', h: 'nb', i: 'jl', j: 'ig', k: 'xh', l: 'it', m: 'nw', n: 'mhu', o: 'ac', p: 'qbd', q: 'pgd', r: 'np', s: 'zc', t: 'fl', u: 'vn', v: 'wu', w: 'vm', x: 'kz', y: 'vgj', z: 'sx' };
export const LETTERS = Object.keys(LT);
export const letterKey = c => LT[c][3];

// Урок алфавита по группе букв. o: { id, needs, title, goal, group, upto, body, task, minutes, show (доп. слова), extra (доп. задания), cards (доп. карточки) }
export function alphaLesson(o) {
  const g = [...o.group], upto = [...o.upto], V = 'aeiou';
  const U = c => c.toUpperCase(), nm = c => LT[c][0], ip = c => LT[c][1], sn = c => LT[c][2], key = c => LT[c][3];
  const near = c => [...(NEAR[c] ?? '')].filter(x => upto.includes(x));
  const uniq = (list, not) => [...new Set(list.filter(x => x && x !== not))].slice(0, 3);
  const nmW = c => uniq([LT[c][6], ...near(c).map(nm), ...upto.filter(x => x !== c).map(nm)], nm(c));
  const snW = c => uniq([V.includes(c) ? `Как в названии: «${nm(c)}»` : '', LT[c][5], ...near(c).map(sn), ...upto.filter(x => x !== c).map(sn)], sn(c));
  const lW = c => [...new Set([...near(c), ...upto.filter(x => x !== c)])].slice(0, 3).map(U);
  const note = c => LT[c][7] ? ` ${LT[c][7]}` : '';
  const [g0, g1, g2, g3] = g, last = g.at(-1);
  const nameQ = c => choose('Как называется эта буква?', nm(c), nmW(c), { big: `${U(c)} ${c}`, explain: `${U(c)} называется «${nm(c)}» ${ip(c)}.${note(c)}` });
  const earQ = c => listen(U(c), U(c), lW(c), { q: 'Какую букву ты услышал?', explain: `Услышано название: «${nm(c)}» ${ip(c)} — это буква ${U(c)}.` });
  const sndQ = c => choose('Какой звук обычно даёт эта буква?', sn(c), snW(c), { big: U(c), explain: `Основной звук буквы ${U(c)}: ${sn(c)}.${note(c)}` });
  const keyQ = c => choose(c === 'x' ? `Какая буква стоит в конце слова ${key(c)}?` : `С какой буквы начинается слово ${key(c)}?`, U(c), lW(c), { big: key(c), explain: `Слово ${key(c)} значит «${LT[c][4]}».` });
  return {
    id: o.id, title: o.title, minutes: Math.min(10, Math.max(o.minutes ?? 5, Math.round(2 + (11 + (o.extra ?? []).length) * 0.35))), stage: 'Алфавит', needs: o.needs, intro: g.join(' '), goal: o.goal,
    showcase: [...g.map(key), ...(o.show ?? [])], body: o.body, task: o.task,
    table: [['Буква', 'Название', 'Звук', 'Пример'], ...g.map(c => [`${U(c)} ${c}`, `${nm(c)} ${ip(c)}`, sn(c), `${key(c)} — ${LT[c][4]}`])],
    cards: [...g.map(c => [`Буква ${U(c)}: название и звук`, `«${nm(c)}» ${ip(c)}; звук ${sn(c)}; ${key(c)} — ${LT[c][4]}`]), ...(o.cards ?? [])],
    drills: [
      nameQ(g0), earQ(g1), sndQ(g0), nameQ(g2), earQ(g3 ?? g0), keyQ(g1), sndQ(g2),
      match('Соедини букву и её название', g.map(c => [U(c), nm(c)])),
      match('Соедини заглавную и строчную', g.map(c => [U(c), c])),
      typed(`Впиши строчную букву для заглавной ${U(last)}`, [last], { explain: `Заглавная ${U(last)} — строчная ${last}.` }),
      order('Расставь буквы по алфавиту', g.map(U)),
      ...(o.extra ?? []),
      read(`Назови вслух буквы: ${g.map(U).join(' ')}. Потом повтори звуки: ${g.map(sn).join('; ')}.`),
    ],
  };
}

// ===== Урок чтения слов. o: { id, needs, title, goal, minutes, stage, intro, sight, show, decay, body, task, words: 'cat кошка|hat шляпа', head, table, cardN, cards,
//   ears: [[слово, неверное, неверное, опции]], means: [[слово, перевод, неверный, неверный, опции]], rhymes: [[слово, рифма, неверная, неверная, опции]],
//   builds: [слово | [плитки]], dicts: [слово], trs: [[по-русски, слово]], pair: [[слово, перевод]] (3–6), extra: [задания], text }
export function wordLesson(o) {
  const W = wp(o.words);
  const D = [
    ...(o.ears ?? []).map(([w, a, b, opt]) => ear(w, a, b, opt)),
    ...(o.means ?? []).map(([w, ru, a, b, opt]) => mean(w, ru, [a, b], opt)),
    ...(o.rhymes ?? []).map(([w, r, a, b, opt]) => rhy(w, r, [a, b], opt)),
    ...(o.builds ?? []).map(x => Array.isArray(x) ? bld(x.join(''), x) : bld(x)),
    ...(o.dicts ?? []).map(w => dict(w)),
    ...(o.trs ?? []).map(([ru, w]) => tr(ru, w)),
    match('Соедини слово и перевод', o.pair ?? W.slice(0, 5)),
    ...(o.extra ?? []),
    read(o.text ?? `Прочитай вслух: ${W.slice(0, 8).map(p => p[0]).join(', ')}.`),
  ];
  return {
    id: o.id, title: o.title, minutes: Math.min(10, Math.max(o.minutes ?? 5, Math.round(2 + D.length * 0.35))), stage: o.stage ?? 'Фоника', needs: o.needs, intro: o.intro ?? '', goal: o.goal,
    ...(o.sight ? { sight: o.sight } : {}), ...(o.show ? { showcase: o.show } : {}), ...(o.decay ? { decay: o.decay } : {}),
    body: o.body, task: o.task, words: W.map(p => p[0]), table: o.table ?? tab(o.head ?? ['Слово', 'Перевод'], o.words),
    cards: [...W.slice(0, o.cardN ?? 8), ...(o.cards ?? [])], drills: D,
  };
}
