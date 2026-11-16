// Библейский иврит: словарик строк Бытия 1 и генераторы заданий. Чистые данные и функции (подключает только zero-kit.js).
// Слово: [с огласовками, как читается (по-современному), перевод, слоги для сборки (в порядке чтения)]
import { choose, typed, order, match, read, listen } from './zero-kit.js';

export const MAQAF = String.fromCharCode(0x5BE), SOF = String.fromCharCode(0x5C3);
export const WB = {
  bBereshit: ['בְּרֵאשִׁית', 'берешит', 'в начале', ['בְּ', 'רֵא', 'שִׁית']], bBara: ['בָּרָא', 'бара', 'сотворил', ['בָּ', 'רָא']], bElohim: ['אֱלֹהִים', 'элохим', 'Бог', ['אֱ', 'לֹ', 'הִים']],
  bEt: ['אֵת', 'эт', 'знак дополнения (не переводится)', ['אֵת']], bEt2: ['אֶת', 'эт', 'знак дополнения, перед макафом', ['אֶת']], bShamayim: ['הַשָּׁמַיִם', 'хашамаим', 'небо, небеса', ['הַ', 'שָּׁ', 'מַ', 'יִם']],
  bVeEt: ['וְאֵת', 'веэт', 'и (знак дополнения)', ['וְ', 'אֵת']], bArets: ['הָאָרֶץ', 'хаарец', 'земля', ['הָ', 'אָ', 'רֶץ']], bVayomer: ['וַיֹּאמֶר', 'вайомер', 'и сказал', ['וַ', 'יֹּא', 'מֶר']],
  bYehi: ['יְהִי', 'йехи', 'да будет', ['יְ', 'הִי']], bOr: ['אוֹר', 'ор', 'свет', ['אוֹר']], bVayehi: ['וַיְהִי', 'вайехи', 'и стало', ['וַ', 'יְהִי']], bVayar: ['וַיַּרְא', 'вайяр', 'и увидел', ['וַ', 'יַּרְא']],
  bHaor: ['הָאוֹר', 'хаор', 'свет (тот самый)', ['הָ', 'אוֹר']], bKi: ['כִּי', 'ки', 'что, потому что', ['כִּי']], bVayavdel: ['וַיַּבְדֵּל', 'вайавдель', 'и отделил', ['וַ', 'יַּבְ', 'דֵּל']],
  bBein: ['בֵּין', 'бейн', 'между', ['בֵּין']], bUvein: ['וּבֵין', 'увейн', 'и между', ['וּ', 'בֵין']], bChoshech: ['הַחֹשֶׁךְ', 'хахошех', 'тьма', ['הַ', 'חֹ', 'שֶׁךְ']],
  bLaor: ['לָאוֹר', 'лаор', 'к свету', ['לָ', 'אוֹר']], bBaarets: ['בָּאָרֶץ', 'баарец', 'на земле', ['בָּ', 'אָ', 'רֶץ']], bKeadam: ['כְּאָדָם', 'кеадам', 'как человек', ['כְּ', 'אָ', 'דָם']],
  bKatav: ['כָּתַב', 'катав', 'писал', ['כָּ', 'תַב']], bKotev: ['כֹּתֵב', 'котев', 'пишущий', ['כֹּ', 'תֵב']], bMichtav: ['מִכְתָּב', 'михтав', 'письмо', ['מִכְ', 'תָּב']], bKtav: ['כְּתָב', 'ктав', 'письменность', ['כְּ', 'תָב']],
  bPaal: ['פָּעַל', 'паал', 'простое действие', ['פָּ', 'עַל']], bNifal: ['נִפְעַל', 'нифъаль', 'страдательное или возвратное', ['נִפְ', 'עַל']], bPiel: ['פִּעֵל', 'пиэль', 'усиленное действие', ['פִּ', 'עֵל']],
  bPual: ['פֻּעַל', 'пуаль', 'страдательное к пиэль', ['פֻּ', 'עַל']], bHifil: ['הִפְעִיל', 'хифъиль', 'заставить сделать', ['הִפְ', 'עִיל']], bHufal: ['הֻפְעַל', 'хуфъаль', 'страдательное к хифъиль', ['הֻפְ', 'עַל']],
  bHitpael: ['הִתְפַּעֵל', 'хитпаэль', 'возвратное, «себе»', ['הִתְ', 'פַּ', 'עֵל']],
  bTov: ['טוֹב', 'тов', 'хороший', ['טוֹב']],
};
export const he = k => WB[k][0];
export const tr = k => WB[k][1];
export const ru = k => WB[k][2];
const skel = k => he(k).replace(/[^א-ת]/g, '');
const sim = (a, b) => { const x = new Set(skel(a)), y = new Set(skel(b)); return [...x].filter(c => y.has(c)).length - Math.abs(skel(a).length - skel(b).length) * 0.5; };
export const like = (k, ks, n = 2) => ks.filter(x => x !== k && ru(x) !== ru(k)).map((x, i) => [x, sim(k, x) - i * 0.01]).sort((a, b) => b[1] - a[1]).slice(0, n).map(a => a[0]);
export const table = ks => [['Слово', 'Читается', 'Значит'], ...ks.map(k => [he(k), tr(k), ru(k)])];
export const cards = ks => ks.map(k => [he(k), `${tr(k)}: ${ru(k)}`]);
const parts = s => s.split(/[;,]\s*/).filter(Boolean);

export const meaningQ = (k, ks) => choose('Что значит это слово?', ru(k), like(k, ks).map(ru), { big: he(k), say: he(k), lang: 'hebrew', explain: `${he(k)} читается «${tr(k)}» и значит «${ru(k)}».` });
export const findWordQ = (k, ks) => choose(`Какое слово значит «${parts(ru(k))[0]}»?`, he(k), like(k, ks).map(he), { explain: `${he(k)} читается «${tr(k)}».` });
export const readWordQ = (k, ks) => choose('Как читается это слово?', tr(k), like(k, ks).map(tr), { big: he(k), explain: `Читай справа налево, слог за слогом: «${tr(k)}».` });
export const typedWordQ = k => typed('Впиши по-русски, что значит это слово.', parts(ru(k)), { big: he(k), hint: `Читается «${tr(k)}».` });
export const orderWordQ = k => order('Собери слово из слогов. Первый слог ложится справа.', WB[k][3], { dir: 'rtl', hint: 'Читай справа налево: первый слог самый правый.' });
export const listenWordQ = (k, ks) => listen(he(k), he(k), like(k, ks).map(he), { lang: 'hebrew', hint: `Это слово читается «${tr(k)}».`, explain: `Это «${tr(k)}»: ${ru(k)}.` });
export const matchWordQ = ks => match('Соедини слова и значения.', ks.slice(0, 5).map(k => [he(k), ru(k)]));
export const readAloudQ = (text, q = 'Прочитай вслух, справа налево') => read(text, { q, lang: 'hebrew' });

// Урок про строку Бытия. o: keys (слова), parts (плитки строки в порядке чтения), text (строка целиком), gloss (смысл), wrong (два неверных смысла), others (две другие строки для «на слух»), extra
export function verseLesson(id, prev, o) {
  const ks = o.keys, multi = ks.filter(k => WB[k][3].length >= 2);
  return {
    id, title: o.title, minutes: o.minutes ?? 7, stage: o.stage ?? 'Чтение Бытия', needs: [prev], intro: '', decay: 1.2, goal: o.goal, body: o.body, task: o.task,
    table: table(ks), words: ks.map(he), cards: [...cards(ks), [o.text, o.gloss]],
    drills: [
      ...ks.slice(0, 3).map(k => meaningQ(k, ks)), ...ks.slice(3, 5).map(k => findWordQ(k, ks)), ...ks.slice(0, 2).map(k => readWordQ(k, ks)),
      typedWordQ(o.typedKey ?? ks[1]), ...multi.slice(0, 2).map(orderWordQ),
      order('Собери строку из слов. Первое слово ложится справа.', o.parts, { dir: 'rtl', hint: 'Читай справа налево: первое слово самое правое.' }),
      choose('Что значит вся строка?', o.gloss, o.wrong, { big: o.text, say: o.text, lang: 'hebrew' }),
      listen(o.text, o.text, o.others, { lang: 'hebrew', hint: `Смысл: ${o.gloss}.`, explain: `Это строка: ${o.gloss}.` }),
      matchWordQ(ks), readAloudQ(o.text, 'Прочитай строку вслух, справа налево'),
      ...(o.extra ?? []),
    ],
  };
}
