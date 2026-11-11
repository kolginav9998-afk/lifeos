// Реестр типов записей и защита данных: реестр совпадает с кодом и с docs/EVENTS.md, слишком новые копии не открываются.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REGISTRY, PRIVACY_LABEL, RELATIONS, BY_DAY, knownType, unknownTypes, registryMarkdown, erMarkdown } from '../registry.js';
import { parseImport, serialize, SCHEMA_VERSION } from '../events.js';
import { dataChecks } from '../datacheck.js';

const root = path.resolve(import.meta.dirname, '..');
const sources = fs.readdirSync(root).filter(f => f.endsWith('.js'));

test('реестр: описание, группа, поля, существующий модуль и допустимая приватность у каждого типа', () => {
  for (const [type, r] of Object.entries(REGISTRY)) {
    assert.match(type, /^[a-z][a-z0-9_]{0,39}$/, `тип ${type}`);
    assert.ok(r.label && r.group && r.fields, `${type}: label/group/fields`);
    assert.ok(Object.hasOwn(PRIVACY_LABEL, r.privacy), `${type}: приватность`);
    assert.equal(typeof r.analytics, 'boolean', `${type}: analytics`);
    assert.ok(fs.existsSync(path.join(root, r.module)), `${type}: модуль ${r.module} не найден`);
  }
  assert.ok(Object.keys(REGISTRY).length >= 38);
});

test('все типы записей, которые встречаются в коде, есть в реестре', () => {
  const HTML = new Set(['button', 'text', 'submit', 'password', 'date', 'checkbox', 'number', 'time', 'tel', 'search', 'file']);
  const NOT_EVENTS = new Set(['daily', 'weekly', 'monthly', 'password']);
  const found = new Map();
  const add = (t, f) => { if (!HTML.has(t) && !NOT_EVENTS.has(t)) found.set(t, f); };
  for (const f of sources) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of s.matchAll(/\btype: '([a-z_]+)'/g)) add(m[1], f);
    for (const m of s.matchAll(/\.type === '([a-z_]+)'/g)) add(m[1], f);
    for (const m of s.matchAll(/\bbase\('([a-z_]+)',/g)) add(m[1], f);
    for (const m of s.matchAll(/\bbase\([^,()]+(?:\([^)]*\))?, '([a-z_]+)',/g)) add(m[1], f);
  }
  const missing = [...found].filter(([t]) => !knownType(t)).map(([t, f]) => `${t} (${f})`);
  assert.deepEqual(missing, [], 'добавь тип в registry.js и перегенерируй docs/EVENTS.md');
  // и наоборот: в реестре нет «мёртвых» типов, которых нет в коде
  const dead = Object.keys(REGISTRY).filter(t => !found.has(t) && !['expense', 'income'].includes(t));
  assert.deepEqual(dead, [], 'тип есть в реестре, но не найден в коде');
});

test('docs/EVENTS.md совпадает с реестром', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/EVENTS.md'), 'utf8');
  assert.equal(doc.trim(), registryMarkdown().trim(), 'перегенерируй: node -e "import(\'./registry.js\').then(m=>require(\'fs\').writeFileSync(\'docs/EVENTS.md\', m.registryMarkdown()+\'\\n\'))"');
});

test('незнакомые типы находятся и попадают в проверку данных, но не ломают её', () => {
  const evs = [{ id: 'a', type: 'task', ts: 1, payload: { text: 'x', done: false, due: null } }, { id: 'b', type: 'hologram', ts: 2, payload: {} }, { id: 'c', type: 'hologram', ts: 3, payload: {} }, { id: 'd', type: 'zzz', ts: 4, payload: {} }];
  assert.deepEqual(unknownTypes(evs), [{ type: 'hologram', count: 2 }, { type: 'zzz', count: 1 }]);
  assert.deepEqual(unknownTypes([]), []);
  const r = dataChecks(evs, '2026-11-14');
  const u = r.find(x => x.id === 'unknown-types');
  assert.ok(u && /hologram \(2\), zzz \(1\)/.test(u.text) && u.level === 'info');
  assert.ok(!dataChecks(evs.slice(0, 1), '2026-11-14').some(x => x.id === 'unknown-types'));
});

test('копия, сделанная более новой версией, не открывается; своя и старые открываются', () => {
  const ev = { id: 'x1', type: 'task', ts: 1, payload: { text: 'a', done: false, due: null }, source: 'manual', confidence: 1, evidence: [] };
  assert.equal(parseImport(serialize([ev])).events.length, 1, 'копия этой версии');
  assert.equal(parseImport(JSON.stringify({ app: 'lifeos', events: [ev] })).events.length, 1, 'старая копия без номера схемы');
  assert.equal(parseImport(JSON.stringify({ app: 'lifeos', schema: 0, events: [ev] })).events.length, 1);
  assert.throws(() => parseImport(JSON.stringify({ app: 'lifeos', schema: SCHEMA_VERSION + 1, events: [ev] })), /более новой версией/);
});

test('ER-диаграмма: связи ссылаются на существующие типы, docs/ER.md совпадает с реестром', () => {
  for (const [parent, child, field, what] of RELATIONS) { assert.ok(knownType(parent) && knownType(child), `${parent} → ${child}`); assert.ok(field && what); assert.ok(REGISTRY[child].fields.includes(field), `у ${child} нет поля ${field}`); }
  for (const type of BY_DAY) { assert.ok(knownType(type), type); assert.match(REGISTRY[type].fields, /\bdate\b|takenAt|lesson/, `${type}: нет даты`); }
  assert.equal(new Set(BY_DAY).size, BY_DAY.length);
  const doc = fs.readFileSync(path.join(root, 'docs/ER.md'), 'utf8');
  assert.equal(doc.trim(), erMarkdown().trim(), 'перегенерируй: node -e "import(\'./registry.js\').then(m=>require(\'fs\').writeFileSync(\'docs/ER.md\', m.erMarkdown()+\'\\n\'))"');
  assert.match(doc, /```mermaid\nerDiagram\n/); assert.match(doc, /habit \|\|--o\{ habit_log : "habitId"/);
});
