// Каталог внешних курсов: ровно двадцать утверждённых id, полные поля, допустимые значения, честные даты проверки; отметки о прохождении.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isYmd } from '../events.js';
import { TRACKS } from '../academy.js';
import {
  RESOURCES, RESOURCE_IDS, SUBJECTS, LEVELS, LANGS, COSTS, FORMATS, AVAILABILITY, RESOURCE_STATUSES, SUBJECT_LABEL, LANG_LABEL, COST_LABEL, FORMAT_LABEL, LEVEL_LABEL, AVAILABILITY_LABEL, RESOURCE_STATUS_LABEL,
  resourceById, resourcesOfTrack, filterResources, makeResourceEvent, resourceStatus, resourceOf, resourceEventId,
} from '../zero-resources.js';

const CANONICAL = ['british-council', 'usa-learns', 'bbc-learning-english', 'duolingo', 'hebrewpod101', 'hebrewglot', 'ochjs', 'yale-psychology', 'cs50p', 'helsinki-python', 'stepik', 'kaggle-learn', 'freecodecamp', 'coursera', 'cisco-netacad', 'sqlbolt', 'linux-journey', 'microsoft-learn', 'openlearn', 'anki'];

test('каталог: id ровно из списка раздела 8, без повторов', () => {
  assert.equal(RESOURCES.length, 20);
  assert.deepEqual([...RESOURCE_IDS].sort(), [...CANONICAL].sort());
  assert.equal(new Set(RESOURCE_IDS).size, 20);
  assert.equal(resourceById('anki').title, 'Anki'); assert.equal(resourceById('нет'), null);
});

test('каталог: все поля есть, значения допустимы, адреса https, даты проверки честные', () => {
  const FIELDS = ['id', 'title', 'subject', 'level', 'lang', 'cost', 'costNote', 'url', 'format', 'availability', 'lastChecked', 'note', 'provider'];
  const urls = new Set();
  for (const x of RESOURCES) {
    assert.deepEqual(Object.keys(x).sort(), [...FIELDS].sort(), x.id);
    for (const k of ['id', 'title', 'costNote', 'url', 'note', 'provider']) assert.ok(typeof x[k] === 'string' && x[k].trim() === x[k] && x[k].length > 1, `${x.id}.${k}`);
    assert.match(x.id, /^[a-z0-9-]+$/);
    assert.ok(SUBJECTS.includes(x.subject) && LEVELS.includes(x.level) && LANGS.includes(x.lang) && COSTS.includes(x.cost) && FORMATS.includes(x.format) && AVAILABILITY.includes(x.availability), x.id);
    const u = new URL(x.url);
    assert.equal(u.protocol, 'https:', `${x.id}: только https`);
    assert.ok(u.hostname.includes('.') && !u.username && !u.password, x.id);
    assert.ok(!urls.has(x.url), `${x.id}: адрес повторяется`); urls.add(x.url);
    assert.ok(x.note.length >= 40 && x.note.length <= 300, `${x.id}: описание 1–2 фразы (${x.note.length})`);
    assert.ok((x.note.match(/[.!?](\s|$)/g) ?? []).length <= 3, `${x.id}: описание слишком длинное`);
    assert.ok(x.costNote.length <= 160, x.id);
    // дата проверки ставится только вместе с «адрес открывался»; без проверки — null и «не проверялся»
    if (x.lastChecked === null) assert.notEqual(x.availability, 'ok', `${x.id}: без даты проверки не может быть «открывался»`);
    else { assert.ok(isYmd(x.lastChecked), `${x.id}: дата проверки`); assert.equal(x.availability, 'ok', x.id); }
    assert.ok(SUBJECT_LABEL[x.subject] && LEVEL_LABEL[x.level] && LANG_LABEL[x.lang] && COST_LABEL[x.cost] && FORMAT_LABEL[x.format] && AVAILABILITY_LABEL[x.availability], `${x.id}: подписи`);
    assert.ok(!/[A-Za-z]{30,}/.test(x.note), x.id);
  }
  assert.deepEqual(Object.keys(RESOURCE_STATUS_LABEL), RESOURCE_STATUSES);
  // бесплатным («free») можно назвать только то, в чём уверены: платные продукты — в costNote
  assert.ok(RESOURCES.filter(x => x.cost === 'free').every(x => x.costNote.length > 4));
});

test('курсы: каждый id из track.resources есть в каталоге, у маршрутов «с нуля» они заданы', () => {
  for (const t of TRACKS) for (const id of t.resources ?? []) assert.ok(resourceById(id), `${t.id}: ${id}`);
  const zero = TRACKS.filter(t => t.zero);
  assert.ok(zero.length >= 3);
  for (const t of zero) assert.ok(Array.isArray(t.resources) && t.resources.length >= 1, `${t.id}: resources`);
  assert.deepEqual(resourcesOfTrack({ resources: ['anki', 'нет', 'duolingo'] }).map(x => x.id), ['anki', 'duolingo'], 'неизвестные id пропускаются, порядок курса сохраняется');
  assert.deepEqual(resourcesOfTrack({}), []);
});

test('фильтры по предмету, языку и цене', () => {
  const all = RESOURCES;
  assert.equal(filterResources(all, {}).length, 20);
  assert.equal(filterResources(all, { subject: 'all', lang: '', cost: 'all' }).length, 20);
  assert.ok(filterResources(all, { subject: 'hebrew' }).every(x => x.subject === 'hebrew') && filterResources(all, { subject: 'hebrew' }).length >= 2);
  assert.deepEqual(filterResources(all, { lang: 'ru' }).map(x => x.id), ['stepik']);
  const free = filterResources(all, { cost: 'free' });
  assert.ok(free.length >= 5 && free.every(x => x.cost === 'free'));
  assert.deepEqual(filterResources(all, { subject: 'english', cost: 'freemium' }), [], 'сочетание фильтров');
  assert.equal(filterResources(all, { subject: 'english', lang: 'en', cost: 'free' }).length, filterResources(all, { subject: 'english', cost: 'free' }).length);
});

test('отметки о курсах: одна запись на курс, обновляется, неверные значения не принимаются', () => {
  const now = new Date(2026, 5, 3, 12).getTime();
  const e = makeResourceEvent('duolingo', 'in_progress', '  по десять минут  ', now);
  assert.deepEqual(e, { id: 'res:duolingo', type: 'resource', ts: now, payload: { id: 'duolingo', status: 'in_progress', note: 'по десять минут', date: '2026-06-03' }, source: 'manual', confidence: 1, evidence: [] });
  assert.equal(resourceEventId('anki'), 'res:anki');
  assert.equal(makeResourceEvent('duolingo', 'completed', '', now + 1).id, e.id, 'тот же id — запись обновляется');
  assert.equal(makeResourceEvent('anki', 'abandoned', 'x'.repeat(500), now).payload.note.length, 300);
  assert.throws(() => makeResourceEvent('нет-такого', 'completed'), /каталоге/);
  assert.throws(() => makeResourceEvent('anki', 'done'), /статус/);
  assert.equal(resourceStatus([], 'anki'), 'not_started');
  assert.equal(resourceStatus([e], 'duolingo'), 'in_progress'); assert.equal(resourceStatus([e], 'anki'), 'not_started');
  assert.equal(resourceStatus([{ ...e, payload: { ...e.payload, status: 'сломано' } }], 'duolingo'), 'not_started');
  assert.equal(resourceOf([e], 'duolingo'), e); assert.equal(resourceOf([e], 'anki'), null);
});
