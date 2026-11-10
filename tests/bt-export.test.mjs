import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, makeZip, readZip } from '../zip.js';
import { toCsv, toCsvExcel, buildExport, buildTables, README } from '../bt-export.js';
import { makeRun, makeRunEvent } from '../bt-core.js';
import { makeCheckin, makeDiary } from '../diary.js';
import { makeMeasure } from '../health.js';
import { makeHabit, makeHabitLog } from '../habits.js';
import { makeTask, completeTask } from '../events.js';

const dec = new TextDecoder();
const T0 = new Date(2026, 9, 1, 9, 30).getTime();

test('zip: CRC32 как у стандарта и круговая проверка архива', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  const files = [{ name: 'a.txt', data: 'привет' }, { name: 'dir/b.csv', data: new Uint8Array([1, 2, 3, 255]) }, { name: 'empty.txt', data: '' }];
  const zip = makeZip(files, T0);
  assert.equal(zip[0], 0x50); assert.equal(zip[1], 0x4b);
  const back = readZip(zip);
  assert.deepEqual(back.map(f => f.name), ['a.txt', 'dir/b.csv', 'empty.txt']);
  assert.equal(dec.decode(back[0].data), 'привет');
  assert.deepEqual([...back[1].data], [1, 2, 3, 255]);
  assert.equal(back[2].data.length, 0);
  const broken = new Uint8Array(zip); broken[40] ^= 0xff;                // порча данных ловится контрольной суммой
  assert.throws(() => readZip(broken), /CRC|bad central/);
});
test('zip: большой набор файлов и совместимость со стандартным распаковщиком', async () => {
  const files = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.csv`, data: 'x,y\n' + '1,2\n'.repeat(500 + i) }));
  const zip = makeZip(files, T0);
  assert.equal(readZip(zip).length, 30);
  // независимая проверка: python3 из стандартной поставки
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  fs.writeFileSync(path.join(dir, 't.zip'), zip);
  let out;
  try { out = execFileSync('python3', ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip(), len(z.namelist()), z.read("f3.csv").decode()[:7].replace(chr(10),"|"))', path.join(dir, 't.zip')], { encoding: 'utf8' }).trim(); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }
  assert.equal(out, 'None 30 x,y|1,2');
});
test('csv: кавычки, переводы строк, защита от формул, числа и пустые значения', () => {
  const csv = toCsv(['a', 'b', 'c'], [{ a: 'x,y', b: '=2+2', c: -1.5 }, { a: 'строка\nвторая', b: '-5', c: null }, { a: 'say "hi"', b: '@cmd', c: true }]);
  assert.ok(csv.startsWith('﻿a,b,c\r\n'));
  assert.ok(csv.includes('"x,y",\'=2+2,-1.5'));
  assert.ok(csv.includes('"строка\nвторая",-5,'), 'число-строка с минусом не портится');
  assert.ok(csv.includes('"say ""hi""",\'@cmd,1'));
  assert.equal(toCsvExcel(['v'], [{ v: 1.5 }]), '﻿v\r\n1,5\r\n');
});

function sample() {
  const events = [];
  for (let i = 0; i < 8; i++) {
    const startedAt = T0 + i * 86400000;
    const date = (() => { const d = new Date(startedAt); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    events.push(makeRunEvent(makeRun({ mode: 'quick', startedAt, durationMs: 250000, state: { sleepy: 2, noise: false }, results: {
      reaction: { metrics: { n: 5, median: 300 + i, mean: 310, sd: 30, best: 260, lapses: 0, falseStarts: 0 }, trials: [{ rt: 300 }, { rt: 305 }], ms: 4000 },
      recall: { metrics: { n: 6, correct: 4, accuracy: 0.667, meanMs: 3000, byCategory: { english: { n: 3, ok: 2 } } }, trials: [], ms: 9000 },
    } }), startedAt));
    events.push(makeCheckin('m', date, { sleepHours: 7, mood: 4 }, '', startedAt));
  }
  const h = makeHabit({ name: 'Зарядка' }, T0);
  events.push(h, makeHabitLog(h, '2026-10-01', 'full', T0));
  events.push(makeMeasure({ kind: 'weight', value: '72,5', date: '2026-10-01' }, T0));
  events.push(makeDiary('2026-10-01', { text: 'очень личный текст дневника' }, T0));
  events.push(completeTask(makeTask('сделано', T0), T0).updated);
  return events;
}
test('выгрузка: таблицы, ZIP и приватность', () => {
  const events = sample();
  const { T } = buildTables(events);
  assert.equal(T.runs.rows.length, 8);
  assert.equal(T.runs.rows[0].reaction_value, 300);
  assert.equal(T.runs.rows[0].reaction_valid, true);
  assert.equal(T.runs.rows[0].state_sleepy, 2);
  assert.equal(T.runs.rows[0].time, '09:30');
  assert.ok(T.metrics.rows.some(r => r.test === 'recall' && r.metric === 'byCategory.english.ok' && r.value === 2));
  assert.equal(T.trials.rows.filter(r => r.test === 'reaction').length, 16);
  const d1 = T.daily.rows.find(r => r.date === '2026-10-01');
  assert.equal(d1.habitsDone, 1); assert.equal(d1.weightKg, 72.5); assert.equal(d1.sleepHours, 7); assert.equal(d1.tasksDone, 1);
  const { files, zip } = buildExport(events, T0);
  const back = readZip(zip);
  assert.deepEqual(back.map(f => f.name).sort(), files.map(f => f.name).sort());
  for (const need of ['README.txt', 'daily.csv', 'daily_excel.csv', 'test_runs.csv', 'test_metrics.csv', 'test_trials.csv', 'checkins.csv', 'measures.csv', 'habits.csv', 'lessons.csv', 'learning.csv', 'testruns.json']) assert.ok(back.some(f => f.name === need), need);
  const all = back.map(f => dec.decode(f.data)).join('\n');
  assert.ok(!all.includes('очень личный текст'), 'текст дневника не выгружается');
  assert.ok(README.includes('Чего нет в выгрузке'));
  const json = JSON.parse(dec.decode(back.find(f => f.name === 'testruns.json').data));
  assert.equal(json.length, 8);
  const runsCsv = dec.decode(back.find(f => f.name === 'test_runs.csv').data);
  assert.equal(runsCsv.split('\r\n')[0].replace('﻿', '').split(',')[0], 'run_id');
});
test('выгрузка: пустые данные не ломаются', () => {
  const { zip, files } = buildExport([], T0);
  assert.equal(readZip(zip).length, files.length);
});
