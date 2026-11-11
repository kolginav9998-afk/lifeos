// Карта зависимостей: нет циклов между модулями и соблюдены слои (логика не знает про экраны и хранилище).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = fs.readdirSync(root).filter(f => f.endsWith('.js'));
const graph = new Map();
for (const f of files) {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  const deps = new Set();
  for (const m of s.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*'\.\/([^']+\.js)'/gm)) deps.add(m[1]);
  for (const m of s.matchAll(/^\s*import\s*'\.\/([^']+\.js)'/gm)) deps.add(m[1]);
  graph.set(f, [...deps]);
}

// Сильно связные компоненты (Тарьян): любой набор из двух и более модулей — цикл.
function cycles() {
  let idx = 0; const st = [], on = new Set(), ind = new Map(), low = new Map(), out = [];
  const strong = v => {
    ind.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!graph.has(w)) continue;
      if (!ind.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), ind.get(w)));
    }
    if (low.get(v) === ind.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1 || (graph.get(v) ?? []).includes(v)) out.push(c.sort()); }
  };
  for (const v of graph.keys()) if (!ind.has(v)) strong(v);
  return out;
}

test('все импорты указывают на существующие файлы', () => {
  const missing = [];
  for (const [f, deps] of graph) for (const d of deps) if (!graph.has(d)) missing.push(`${f} → ${d}`);
  assert.deepEqual(missing, []);
});

test('циклических зависимостей между модулями нет', t => {
  t.diagnostic(`модулей: ${files.length}, связей: ${[...graph.values()].reduce((a, b) => a + b.length, 0)}`);
  assert.deepEqual(cycles(), [], 'цикл между модулями: вынеси общее в отдельный файл');
});

test('слои: логика не импортирует экраны, интерфейс и хранилище', () => {
  const UI_LAYER = new Set(['ui.js', 'store.js', 'db.js', 'platform.js', 'vault.js', 'app.js', 'app-sync.js', 'notify.js', 'errlog.js']);
  const PURE = ['events.js', 'stats.js', 'srs.js', 'habits.js', 'money.js', 'health.js', 'diary.js', 'reflect.js', 'sick.js', 'prevent.js', 'emergency.js', 'bp.js', 'hints.js', 'registry.js', 'writing.js', 'speech.js',
    'reports.js', 'export.js', 'planning.js', 'people.js', 'okr.js', 'academy.js', 'bt-core.js', 'bt-logic.js', 'bt-analytics.js', 'bt-export.js', 'capture.js', 'quick.js', 'ics.js', 'datacheck.js', 'search.js',
    'journal.js', 'review.js', 'reminders.js', 'meds.js', 'notes.js', 'thoughts.js', 'experiments.js', 'zip.js', 'cryptoutil.js'];
  const bad = [];
  for (const f of PURE) {
    assert.ok(graph.has(f), `${f}: файла нет`);
    for (const d of graph.get(f)) if (UI_LAYER.has(d) || d.startsWith('view-')) bad.push(`${f} → ${d}`);
  }
  assert.deepEqual(bad, [], 'чистая логика зависит от интерфейса');
});

test('экраны не импортируют друг друга (кроме дочернего блока «Здоровья»), никто не импортирует app.js', () => {
  const bad = [];
  for (const [f, deps] of graph) {
    for (const d of deps) {
      if (d === 'app.js') bad.push(`${f} → app.js`);
      if (f.startsWith('view-') && d.startsWith('view-') && !(f === 'view-health.js' && d === 'view-health-extra.js')) bad.push(`${f} → ${d}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('файлы курсов c-*.js — чистые данные: ни от чего не зависят', () => {
  for (const f of files.filter(x => x.startsWith('c-'))) assert.deepEqual(graph.get(f), [], f);
});
