// Иврит с нуля: современный (hezero) и библейский (hebib) маршруты. Структура, порядок букв, допуск, честность, написание слов.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TRACKS, validateTrack, lessonGoal } from '../academy.js';
import { lessonIndex, graphProblems, validateZeroTrack, scopeOf, hebrewWordProblems, GRADED, checkOf } from '../zero-kit.js';
import { W, MARKS } from '../zero-he-lex.js';
import { SENT } from '../zero-he-c.js';
import { WB } from '../zero-hb-lib.js';

const root = path.resolve(import.meta.dirname, '..');
const he = TRACKS.find(t => t.id === 'hezero'), hb = TRACKS.find(t => t.id === 'hebib');
const index = lessonIndex(TRACKS);
const BASE = [...'אבגדהוזחטיכלמנסעפצקרשת'], FIN = [...'ךםןףץ'];
const MARK_RE = /[\u0591-\u05C7]/g;
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out)); return out; };
const idsOf = t => t.lessons.map(l => l.id);
const tokens = l => String(l.intro ?? '').split(/\s+/).filter(Boolean);

// ---------- простое чтение огласованного слова (современный иврит): сверка с нашей транскрипцией ----------
const C = { 'א': '', 'ב': 'в', 'ג': 'г', 'ד': 'д', 'ה': 'х', 'ו': 'в', 'ז': 'з', 'ח': 'х', 'ט': 'т', 'י': 'й', 'כ': 'х', 'ך': 'х', 'ל': 'л', 'מ': 'м', 'ם': 'м', 'נ': 'н', 'ן': 'н', 'ס': 'с', 'ע': '', 'פ': 'ф', 'ף': 'ф', 'צ': 'ц', 'ץ': 'ц', 'ק': 'к', 'ר': 'р', 'ש': 'ш', 'ת': 'т' };
function pattern(word) {
  const cl = [];
  for (const ch of word.normalize('NFC')) { if (/[א-ת]/.test(ch)) cl.push({ l: ch, m: new Set() }); else if (cl.length) cl.at(-1).m.add(ch.codePointAt(0)); }
  let out = '';
  cl.forEach((c, i) => {
    const has = k => c.m.has(k), prev = cl[i - 1], last = i === cl.length - 1;
    const V = has(0x5B7) || has(0x5B8) || has(0x5B2) ? 'а' : has(0x5B6) || has(0x5B5) || has(0x5B1) ? 'е' : has(0x5B4) ? 'и' : has(0x5B9) || has(0x5B3) ? 'о' : has(0x5BB) ? 'у' : '';
    const shva = has(0x5B0), dag = has(0x5BC);
    if (c.l === 'ו' && has(0x5B9)) { out += 'о'; return; }
    if (c.l === 'ו' && dag && !V && !shva) { out += 'у'; return; }
    if (c.l === 'י' && !V && !shva) { if (prev && prev.m.has(0x5B4)) return; out += 'й'; return; }
    if (c.l === 'ה' && last && !V && !dag) return;
    if (last && c.l === 'ח' && has(0x5B7)) { out += 'ах'; return; }
    let k = C[c.l];
    if ('בכפ'.includes(c.l) && dag) k = { 'ב': 'б', 'כ': 'к', 'פ': 'п' }[c.l];
    if (c.l === 'ש' && has(0x5C2)) k = 'с';
    out += k + V + (shva ? '(?:е)?' : '');
  });
  return out.replace(/й/g, '');
}
const canon = t => t.toLowerCase().replace(/э/g, 'е').replace(/ё/g, 'о').replace(/я/g, 'а').replace(/ю/g, 'у').replace(/[ьъ]/g, '').replace(/[^а-я]/g, '').replace(/й/g, '');
const readsAs = (word, tr) => new RegExp('^' + word.split(/[\s\u05BE]+/).filter(Boolean).map(pattern).join('') + '$').test(canon(tr));

// ---------- современный маршрут ----------
test('иврит (современный): число уроков, id идут подряд, граф без циклов', () => {
  assert.ok(he.lessons.length >= 28 && he.lessons.length <= 42, `уроков: ${he.lessons.length}`);
  assert.deepEqual(idsOf(he), he.lessons.map((_, i) => `hz-${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(graphProblems(index), []);
  assert.deepEqual(validateTrack(he), []);
  assert.deepEqual(validateZeroTrack(he, index), []);
  assert.equal(he.zero, true); assert.equal(he.lang, 'hebrew'); assert.equal(he.branch, 'modern'); assert.equal(he.after, 'hebrew');
});

test('иврит: 22 буквы и 5 конечных форм введены по одному разу, конечные после всех обычных', () => {
  const seen = [], where = new Map();
  he.lessons.forEach((l, i) => { for (const tk of tokens(l)) for (const c of tk) if (/[א-ת]/.test(c)) { seen.push(c); if (!where.has(c)) where.set(c, i); } });
  assert.deepEqual([...seen].filter(c => BASE.includes(c)).sort(), [...BASE].sort(), 'каждая из 22 букв ровно один раз');
  assert.deepEqual([...seen].filter(c => FIN.includes(c)).sort(), [...FIN].sort(), 'каждая из 5 конечных форм ровно один раз');
  const lastBase = Math.max(...BASE.map(c => where.get(c))), firstFinal = Math.min(...FIN.map(c => where.get(c)));
  assert.ok(firstFinal > lastBase, 'конечные формы вводятся после всех обычных букв');
  const twice = seen.filter((c, i) => seen.indexOf(c) !== i);
  assert.deepEqual(twice, [], 'буква введена дважды');
});

test('иврит: этап niqqud есть, слова без огласовок только в уроках plain после него', () => {
  const ms = he.lessons.filter(l => l.milestone === 'niqqud');
  assert.equal(ms.length, 1);
  const at = he.lessons.indexOf(ms[0]);
  const plain = he.lessons.filter(l => l.plain === true);
  assert.ok(plain.length >= 3, 'уроков без огласовок не меньше трёх');
  for (const l of plain) assert.ok(he.lessons.indexOf(l) > at, `${l.id}: plain раньше этапа niqqud`);
  for (const l of he.lessons.slice(0, at + 1)) assert.ok(!l.plain, `${l.id}: до niqqud слов без огласовок быть не может`);
  // этапы идут в заявленном порядке
  const stages = [...new Set(he.lessons.map(l => l.stage))];
  assert.deepEqual(stages, ['Письмо', 'Алфавит', 'Конечные формы', 'Огласовки', 'Слоги', 'Первые слова', 'Без огласовок', 'Предложения', 'Разговор']);
});

test('иврит: у каждого урока не меньше 8 проверяемых заданий, мало «слушаний», цели не повторяются', () => {
  const goals = new Set();
  for (const t of [he, hb]) for (const l of t.lessons) {
    const graded = l.drills.filter(d => GRADED.has(d.t)).length;
    assert.ok(graded >= Math.max(8, checkOf(l).n + 2), `${l.id}: проверяемых ${graded}`);
    assert.ok(l.drills.filter(d => d.t === 'listen').length <= 1, `${l.id}: не больше одного задания на слух (голоса иврита может не быть)`);
    assert.ok(l.minutes >= 2 && l.minutes <= 10, `${l.id}: минуты`);
    assert.ok(!goals.has(l.goal), `${l.id}: цель повторяется`); goals.add(l.goal);
    assert.equal(lessonGoal(l.id), l.goal);
  }
});

test('иврит: каждое слово из words проходит проверку допуска; список слов не пуст там, где он нужен', () => {
  for (const t of [he, hb]) for (const l of t.lessons) {
    const sc = scopeOf(l.id, index);
    for (const w of l.words ?? []) assert.deepEqual(hebrewWordProblems(w, sc), [], `${l.id}: ${w}`);
  }
  for (const id of ['hz-14', 'hz-23', 'hz-24', 'hz-25', 'hz-26', 'hz-27', 'hz-29', 'hz-30', 'hz-32']) assert.ok(he.lessons.find(l => l.id === id).words.length >= 6, id);
});

// ---------- написание и честность ----------
test('все ивритские строки в NFC; в исходниках знаки огласовок не «невидимые»', () => {
  for (const t of [he, hb]) for (const s of strings(t)) assert.equal(s, s.normalize('NFC'), `не NFC: ${[...s].map(c => c.codePointAt(0).toString(16)).join(' ')}`);
  const files = fs.readdirSync(root).filter(f => /^(zero-(he|hb)-.*|c-zero-(he|hb))\.js$/.test(f));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.equal(src, src.normalize('NFC'), `${f}: исходник не в NFC`);
    assert.ok(!/(?<![\u05D0-\u05EA\u0591-\u05C7])[\u0591-\u05C7]/.test(src), `${f}: одинокий знак огласовки без буквы: пиши кодом \\u05B7`);
    assert.ok(Buffer.byteLength(src) <= 64_000, `${f}: больше 64 КБ`);
  }
});

test('божественное имя нигде не написано; нет пустых обещаний сроков', () => {
  for (const t of [he, hb]) {
    const all = strings(t);
    for (const s of all) {
      const bare = s.replace(MARK_RE, '').replace(/\u05BE/g, '');
      assert.ok(!/יהוה|ידוד|יקוק/.test(bare), `имя Бога: ${s}`);
      assert.ok(!/(за|через|всего)\s+\d+\s+(дн|недел|месяц)|гарантир|выучишь за/i.test(s), `обещание срока: ${s}`);
    }
  }
});

test('первый урок каждого маршрута честно говорит: курс написан ИИ и не проверен носителем или учителем', () => {
  for (const t of [he, hb]) {
    const text = [t.lessons[0].body.join(' '), ...t.lessons[0].drills.map(d => `${d.q} ${d.right ?? ''}`), t.lessons[0].cards.flat().join(' ')].join(' ');
    assert.match(text, /искусственн\w+ интеллект|ИИ/, `${t.id}: нет слов про ИИ`);
    assert.match(text, /не проверял|не проверен|не проверялся|не проверяли/, `${t.id}: нет слов про отсутствие проверки`);
    assert.match(text, /учител|носител/, `${t.id}: нет совета проверить у учителя`);
  }
});

test('ресурсы маршрутов берутся из каталога, ссылок и адресов в содержании нет', () => {
  const OK = new Set('british-council usa-learns bbc-learning-english duolingo hebrewpod101 hebrewglot ochjs yale-psychology cs50p helsinki-python stepik kaggle-learn freecodecamp coursera cisco-netacad sqlbolt linux-journey microsoft-learn openlearn anki'.split(' '));
  for (const t of [he, hb]) { assert.ok(t.resources.length >= 2); for (const r of t.resources) assert.ok(OK.has(r), r); assert.ok(!/https?:\/\//i.test(JSON.stringify(t))); }
});

test('слова словарика читаются так, как записана транскрипция; слоги собираются в слово; конечные буквы на месте', () => {
  assert.ok(Object.keys(W).length >= 80, 'в словарике не меньше 80 слов');
  for (const [k, [h, tr, ru, syl, p]] of Object.entries(W)) {
    assert.equal(h, h.normalize('NFC'), k);
    assert.ok(readsAs(h, tr), `${k}: ${h} читается /${pattern(h)}/, а в транскрипции «${tr}»`);
    assert.equal(syl.join(''), h, `${k}: слоги не собираются в слово`);
    assert.ok(ru.length > 0);
    const bare = h.replace(MARK_RE, ''), pl = p ?? bare, cut = s => s.replace(/[ויה]/g, m => (m === 'ה' ? 'ה' : '')).replace(/[וי]/g, '');
    assert.equal(cut(bare), cut(pl), `${k}: написание без огласовок ${pl} не сходится с ${bare}`);
    assert.ok(!/[כמנפצ]$/.test(pl) && !/[ךםןףץ][א-ת]/.test(pl), `${k}: конечная форма на месте? ${pl}`);
  }
  for (const [h, tr, ru, p] of SENT) {
    assert.ok(readsAs(h, tr), `предложение ${h}: транскрипция «${tr}»`);
    assert.equal(h.replace(MARK_RE, ''), p, `предложение ${h}: запись без огласовок`);
    for (const w of p.split(' ')) assert.ok(!/[כמנפצ]$/.test(w) && !/[ךםןףץ][א-ת]/.test(w), `${w}: конечные формы`);
  }
});

test('в уроках нет слов, где конечная форма стоит не в конце (и обычная буква вместо неё в конце)', () => {
  for (const t of [he, hb]) for (const l of t.lessons) for (const s of strings(l.drills).concat(strings(l.table ?? []), l.words ?? [])) {
    for (const m of s.matchAll(/[\u05D0-\u05EA\u0591-\u05C7]+/g)) {
      const w = m[0].replace(MARK_RE, '');
      if (w.length < 2) continue;
      assert.ok(!/[ךםןףץ].*[א-ת]/.test(w), `${l.id}: конечная форма в середине слова ${m[0]}`);
    }
  }
});

// ---------- библейский маршрут ----------
const MAQ = String.fromCharCode(0x5BE);
const CANT = new RegExp('[' + String.fromCharCode(0x591) + '-' + String.fromCharCode(0x5AF) + String.fromCharCode(0x5BD) + ']', 'g');
const bare = s => s.replace(new RegExp(MAQ, 'g'), ' ').replace(MARK_RE, '').replace(/\s+/g, ' ').trim();

test('библейский иврит: число уроков, id подряд, предпосылки только до этапа niqqud современного маршрута', () => {
  assert.ok(hb.lessons.length >= 10 && hb.lessons.length <= 16, `уроков: ${hb.lessons.length}`);
  assert.deepEqual(idsOf(hb), hb.lessons.map((_, i) => `hb-${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(validateTrack(hb), []);
  assert.deepEqual(validateZeroTrack(hb, index), []);
  assert.equal(hb.zero, true); assert.equal(hb.branch, 'biblical'); assert.equal(hb.after, 'hezero');
  const ms = he.lessons.findIndex(l => l.milestone === 'niqqud');
  assert.deepEqual(hb.lessons[0].needs, [he.lessons[ms].id], 'первый урок открывается после этапа niqqud');
  for (const l of hb.lessons) for (const n of l.needs) {
    if (n.startsWith('hz-')) assert.ok(he.lessons.findIndex(x => x.id === n) <= ms, `${l.id}: предпосылка ${n} позже этапа niqqud`);
    else assert.ok(n.startsWith('hb-'), `${l.id}: ${n}`);
  }
  assert.ok(he.lessons.every(l => l.needs.every(n => n.startsWith('hz-'))), 'современный маршрут не зависит от библейского');
});

test('библейский иврит: строки Бытия 1 совпадают с текстом, знаки кантилляции убираются без следа', () => {
  const verse = id => hb.lessons.find(l => l.id === id).cards.at(-1)[0];
  assert.equal(bare(verse('hb-09')), 'בראשית ברא אלהים את השמים ואת הארץ');
  assert.equal(bare(verse('hb-10')), 'ויאמר אלהים יהי אור ויהי אור');
  assert.equal(bare(verse('hb-11')), 'וירא אלהים את האור כי טוב');
  assert.equal(bare(verse('hb-12')), 'ויבדל אלהים בין האור ובין החשך');
  const withMarks = hb.lessons.find(l => l.id === 'hb-03').words[0];
  assert.ok(CANT.test(withMarks), 'в примере есть кантилляция');
  assert.equal(withMarks.normalize('NFD').replace(CANT, '').normalize('NFC'), verse('hb-09'), 'без кантилляции это строка Бытия 1:1 из урока');
  assert.ok(hb.lessons.some(l => /1:1/.test(l.title)) && hb.lessons.some(l => /1:3/.test(l.title)) && hb.lessons.some(l => /1:4/.test(l.title)));
});

test('словарик Бытия 1: чтение, слоги, конечные формы', () => {
  assert.ok(Object.keys(WB).length >= 30);
  for (const [k, [h, t, r, syl]] of Object.entries(WB)) {
    assert.equal(h, h.normalize('NFC'), k);
    assert.ok(readsAs(h, t), `${k}: ${h} читается /${pattern(h)}/, а в транскрипции «${t}»`);
    assert.equal(syl.join(''), h, `${k}: слоги не собираются в слово`);
    assert.ok(r.length > 0);
    const letters = h.replace(MARK_RE, '');
    assert.ok(!/[כמנפצ]$/.test(letters) && !/[ךםןףץ][א-ת]/.test(letters), `${k}: конечные формы`);
  }
});

test('отчёт: сколько уроков, заданий, слов и килобайт', t => {
  const rows = [he, hb].map(r => `${r.id}: уроков ${r.lessons.length}, заданий ${r.lessons.reduce((n, l) => n + l.drills.length, 0)}, слов ${new Set(r.lessons.flatMap(l => l.words ?? [])).size}, карточек ${r.lessons.reduce((n, l) => n + l.cards.length, 0)}`);
  const kb = fs.readdirSync(root).filter(f => /^(zero-(he|hb)-.*|c-zero-(he|hb))\.js$/.test(f)).map(f => `${f} ${(fs.statSync(path.join(root, f)).size / 1024).toFixed(1)} КБ`);
  t.diagnostic(rows.join(' | ') + ' | ' + kb.join(', '));
  assert.ok(true);
});

// ---------- общие защитные проверки (по образцу английского маршрута) ----------
test('граф: вход в современный маршрут один (hz-01), каждый урок достижим от него; библейский открывается только после niqqud', () => {
  assert.deepEqual(he.lessons.filter(l => !l.needs.length).map(l => l.id), ['hz-01']);
  for (const l of he.lessons) assert.ok(scopeOf(l.id, index).tokens.size >= 0 && [...closureOfIds(l.id)].includes('hz-01'), `${l.id}: не достижим от hz-01`);
  for (const l of hb.lessons) assert.ok(l.needs.length > 0, `${l.id}: пустые предпосылки`);
});
function closureOfIds(id, seen = new Set()) { if (seen.has(id)) return seen; seen.add(id); for (const n of index.get(id)?.lesson.needs ?? []) closureOfIds(n, seen); return seen; }

test('тексты: абзацы не длиннее 1500 знаков, слова в уроке не повторяются, карточки в пределах', () => {
  for (const t of [he, hb]) for (const l of t.lessons) {
    for (const p of l.body) assert.ok(p.length <= 1500, `${l.id}: абзац ${p.length} знаков`);
    const words = l.words ?? [];
    assert.equal(new Set(words).size, words.length, `${l.id}: повторы в words`);
    for (const [q, a] of l.cards) assert.ok(q.length <= 300 && a.length <= 500, `${l.id}: карточка`);
    assert.ok(new Set(l.cards.map(c => c[0])).size === l.cards.length, `${l.id}: одинаковые вопросы карточек`);
  }
});

test('письмо: иврит не слипается с кириллицей и латиницей; озвучиваемое (say) только ивритское', () => {
  for (const t of [he, hb]) {
    for (const s of strings(t.lessons)) assert.ok(!/[א-ת][А-Яа-яЁёA-Za-z]|[А-Яа-яЁёA-Za-z][א-ת]/.test(s), `слиплись письменности: ${s}`);
    for (const l of t.lessons) for (const d of l.drills) if (d.say !== undefined) assert.ok(/^[\s\S]*$/.test(d.say) && !/[А-Яа-яЁёA-Za-z]/.test(d.say) && /[א-ת]/.test(d.say), `${l.id}: say не ивритский: ${d.say}`);
  }
});

test('ссылок, адресов и ключа type: в уроках нет; у уроков нет лишних полей', () => {
  const ALLOWED = new Set(['id', 'title', 'minutes', 'stage', 'needs', 'intro', 'goal', 'body', 'task', 'cards', 'drills', 'table', 'words', 'check', 'decay', 'plain', 'milestone', 'sight', 'showcase']);
  for (const t of [he, hb]) for (const l of t.lessons) {
    assert.deepEqual(Object.keys(l).filter(k => !ALLOWED.has(k)), [], `${l.id}: лишние поля`);
    assert.ok(!/https?:\/\/|www\./i.test(JSON.stringify(l)));
    for (const d of l.drills) assert.ok(!('type' in d), `${l.id}: ключ type в задании`);
  }
});
