// Скрипт docs/analysis/analyze.py: настоящая выгрузка приложения → настоящий Python (изолированный режим -I).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRng } from '../stats.js';
import { makeRun, makeRunEvent } from '../bt-core.js';
import { makeCheckin } from '../diary.js';
import { buildExport } from '../bt-export.js';
import { makeZip } from '../zip.js';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'docs', 'analysis', 'analyze.py');
const DAY = 86400000, T0 = new Date(2026, 8, 1, 9, 0).getTime();
const iso = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hasPython = spawnSync('python3', ['-I', '-c', 'import sys; assert sys.version_info >= (3, 9)']).status === 0;
const py = (args) => spawnSync('python3', ['-I', SCRIPT, ...args], { encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-analysis-'));

function metrics(q) {
  return {
    reaction: { n: 5, median: Math.round(360 - 20 * q), mean: 380, sd: 40, best: 300, lapses: 0, falseStarts: 0 },
    gonogo: { n: 16, hits: 11, omissions: 1, commissions: 1, correctRejections: 3, accuracy: 0.87, inhibition: 0.75, medianRT: 400, dPrime: +(1.5 + 0.3 * q).toFixed(2) },
    stroop: { n: 12, correct: 11, accuracy: 0.92, meanCongruent: 700, meanIncongruent: 900, interference: Math.round(220 - 15 * q), errorsIncongruent: 1 },
    digits: { forward: 6, backward: 4, total: Math.round(10 + q), attempts: 8 },
    math: { n: 12, correct: 10, accuracy: 0.83, meanMs: 3000, perMinute: +(9 + q).toFixed(1), maxLevel: 3 },
    recall: { n: 6, correct: 5, accuracy: Math.min(1, 0.7 + 0.05 * q), meanMs: 4000, byCategory: { english: { n: 3, ok: 3 }, hebrew: { n: 3, ok: 1 } } },
  };
}
// 60 дней: результат проверок зависит от сна той же ночи (связь заложена специально), остальное — шум.
function fixture(days = 60) {
  const rng = makeRng(99), events = [];
  for (let i = 0; i < days; i++) {
    const startedAt = T0 + i * DAY, date = iso(startedAt);
    const sleep = 5 + Math.round(rng() * 40) / 10;              // 5…9 часов
    const q = (sleep - 7) * 2 + (rng() - 0.5);
    const results = {};
    for (const [id, m] of Object.entries(metrics(q))) results[id] = { metrics: m, ms: 30000, trials: [] };
    events.push(makeRunEvent(makeRun({ mode: 'quick', startedAt, durationMs: 300000, state: null, results }), startedAt));
    events.push(makeCheckin('m', date, { sleepHours: sleep, mood: 3 + Math.round(rng() * 2) }, '', startedAt + 1000));
  }
  return events;
}

test('analyze.py: настоящая выгрузка → отчёт, связь сна с результатом найдена', { skip: !hasPython && 'нет python3' }, () => {
  const dir = tmp(), zip = path.join(dir, 'lifeos-analysis.zip');
  fs.writeFileSync(zip, buildExport(fixture(), T0).zip);
  const r = py([zip]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^# Разбор выгрузки Life OS/);
  assert.match(r.stdout, /Дней в выгрузке: 60; без режима болезни: 60; с результатом проверок: \d+\./);
  assert.match(r.stdout, /Прохождений проверок: 60\./);
  assert.match(r.stdout, /## Тренд результата/); assert.match(r.stdout, /Наклон: -?\d+,\d{3} σ в неделю \(95% интервал от/);
  assert.match(r.stdout, /## По дням недели/); assert.match(r.stdout, /- пн: /);
  const sleepLine = r.stdout.split('\n').find(l => l.startsWith('- Сон, часов:'));
  assert.ok(sleepLine, r.stdout);
  assert.match(sleepLine, /ρ = 0,[6-9]\d/, 'сильная положительная связь'); assert.match(sleepLine, /возможная связь \(чем больше, тем выше результат\)/);
  assert.match(r.stdout, /наблюдения за одним человеком/, 'есть оговорка про причинность');
  // сохранение в файл
  const out = path.join(dir, 'report.md'), r2 = py([zip, '--out', out]);
  assert.equal(r2.status, 0, r2.stderr); assert.match(r2.stdout, /Отчёт сохранён/);
  assert.equal(fs.readFileSync(out, 'utf8'), r.stdout, 'в файле тот же отчёт');
});

test('analyze.py: больные дни исключаются, вечерние факторы берутся со сдвигом в день', { skip: !hasPython && 'нет python3' }, () => {
  const rng = makeRng(5), rows = [];
  const cols = ['date', 'runs', 'composite', 'sleepHours', 'caffeine', 'sick'];
  // кофе накануне портит результат на следующий день (сдвиг 1); в больные дни — обратная картина, её учитывать нельзя
  const caf = [];
  for (let i = 0; i < 50; i++) caf.push(Math.floor(rng() * 6));
  for (let i = 0; i < 50; i++) {
    const sick = i % 10 === 9;
    const prev = i ? caf[i - 1] : 2;
    rows.push({ date: iso(T0 + i * DAY), runs: 1, composite: sick ? prev * 0.5 : 1 - 0.4 * prev + (rng() - 0.5) * 0.3, sleepHours: 7, caffeine: caf[i], sick: sick ? 1 : 0 });
  }
  const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => r[c]).join(','))].join('\r\n') + '\r\n';
  const dir = tmp(), zip = path.join(dir, 'x.zip');
  fs.writeFileSync(zip, makeZip([{ name: 'daily.csv', data: csv }], T0));
  const r = py([zip]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Дней в выгрузке: 50; без режима болезни: 45; с результатом проверок: 45\./);
  const line = r.stdout.split('\n').find(l => l.startsWith('- Кофе и чай накануне:'));
  assert.ok(line, r.stdout); assert.match(line, /ρ = -0,[7-9]\d/, 'чем больше кофе накануне, тем ниже результат'); assert.match(line, /возможная связь \(чем больше, тем ниже результат\)/);
  assert.ok(!r.stdout.includes('- Сон, часов:'), 'у постоянного фактора связи нет');
});

test('analyze.py: мало данных, битый и несуществующий файл, справка', { skip: !hasPython && 'нет python3' }, () => {
  const dir = tmp();
  const tiny = path.join(dir, 'tiny.zip'), small = path.join(dir, 'small.zip');
  fs.writeFileSync(tiny, buildExport(fixture(3), T0).zip);
  const rt = py([tiny]);
  assert.equal(rt.status, 0, rt.stderr); assert.match(rt.stdout, /Дней в выгрузке: 3; без режима болезни: 3; с результатом проверок: 0\./); assert.match(rt.stdout, /слишком мало/, 'первые прохождения норму не считают');
  fs.writeFileSync(small, buildExport(fixture(8), T0).zip);
  const r = py([small]);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Дней в выгрузке: 8; без режима болезни: 8; с результатом проверок: [1-9]\./);
  assert.ok(!/Наклон:/.test(r.stdout), 'тренд на нескольких днях не строим'); assert.match(r.stdout, /Для тренда нужно хотя бы 10 дней/); assert.match(r.stdout, /Пока ни для одного фактора нет хотя бы 20 дней/);
  const empty = path.join(dir, 'empty.zip'); fs.writeFileSync(empty, makeZip([{ name: 'README.txt', data: 'x' }], T0));
  assert.match(py([empty]).stdout, /слишком мало/);
  const bad = path.join(dir, 'bad.zip'); fs.writeFileSync(bad, 'это не архив');
  const rb = py([bad]); assert.equal(rb.status, 1); assert.match(rb.stderr, /Не удалось открыть архив/);
  const rn = py([path.join(dir, 'нет.zip')]); assert.equal(rn.status, 1);
  const rh = py(['--help']); assert.equal(rh.status, 0); assert.match(rh.stdout, /--min-pairs/);
});

test('analyze.py: только стандартная библиотека и никакой сети', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const imports = [...src.matchAll(/^(?:import|from)\s+([\w.]+)/gm)].map(m => m[1].split('.')[0]).sort();
  assert.deepEqual(imports, ['argparse', 'csv', 'datetime', 'io', 'math', 'random', 'sys', 'zipfile']);
  assert.ok(!/socket|urllib|http|requests|subprocess|os\.system|eval\(|exec\(/.test(src), 'без сети, запуска программ и eval');
});

test('ноутбук-шаблон: корректный файл Jupyter, ячейки с кодом компилируются, сети нет', { skip: !hasPython && 'нет python3' }, () => {
  const file = path.resolve(import.meta.dirname, '..', 'docs', 'analysis', 'lifeos-analysis.ipynb');
  const nb = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(nb.nbformat, 4); assert.ok(nb.cells.length >= 6);
  for (const c of nb.cells) { assert.ok(['markdown', 'code'].includes(c.cell_type)); assert.ok(Array.isArray(c.source) && c.source.every(l => typeof l === 'string')); if (c.cell_type === 'code') { assert.deepEqual(c.outputs, []); assert.equal(c.execution_count, null); } }
  const code = nb.cells.filter(c => c.cell_type === 'code').map(c => c.source.join(''));
  assert.ok(code.length >= 4);
  assert.ok(!/socket|urllib|requests|subprocess|os\.system|read_csv\(\s*["']https?:/.test(code.join('\n')), 'без сети');
  const r = spawnSync('python3', ['-I', '-c', 'import json,sys; nb=json.load(open(sys.argv[1],encoding="utf-8")); [compile("".join(c["source"]),"cell","exec") for c in nb["cells"] if c["cell_type"]=="code"]; print("ok")', file], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'ok', r.stderr);
  const readme = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'docs', 'analysis', 'README.md'), 'utf8');
  assert.match(readme, /python3 analyze\.py lifeos-analysis\.zip/); assert.match(readme, /lifeos-analysis\.ipynb/);
});
