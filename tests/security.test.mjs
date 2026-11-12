// R4.0: безопасность сборки APK. Проверки без Android SDK:
//  • сборочный процесс (apk.yml): release вместо debug, проверка отпечатка и «не отлаживаемый», права записи только у публикации;
//  • разбор настоящего двоичного манифеста (образец — манифест прежней debug-сборки) и политика разрешений/открытых компонентов;
//  • правки проекта Android (scripts/patch-android.py) на настоящем проекте от `cap add android`: результат правильный и повтор ничего не меняет.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeZip } from '../zip.js';
import { readZipEntry, decodeAxml, summarize, audit, POLICY } from '../scripts/check-apk.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/AndroidManifest.debug.axml'));

test('apk.yml: release-сборка, проверка отпечатка и отладки, права записи только у публикации', () => {
  const y = read('.github/workflows/apk.yml');
  assert.match(y, /assembleRelease/); assert.ok(!/assembleDebug|app-debug\.apk/.test(y), 'debug-сборки в процессе больше нет');
  assert.match(y, /outputs\/apk\/release\/app-release\.apk/);
  assert.match(y, /EXPECTED='77:BC:5B:96:55:C2:65:E4:E6:6F:64:A6:60:79:CA:31:DB:C6:CC:76:1C:DF:CE:DB:71:F6:45:C1:65:99:A4:56'/, 'отпечаток постоянного ключа на месте');
  assert.match(y, /node scripts\/check-apk\.mjs out\/lifeos\.apk/);
  assert.match(y, /npm ci --ignore-scripts/);
  const head = y.slice(0, y.indexOf('\n  publish:')), publish = y.slice(y.indexOf('\n  publish:'));
  assert.match(y, /^permissions:\n  contents: read/m);
  assert.ok(!/contents: write/.test(head), 'сборка с npm-пакетами не может писать в репозиторий');
  assert.match(publish, /permissions:\n      contents: write/); assert.match(publish, /if: github\.ref == 'refs\/heads\/main'/);
  assert.ok(!/npm ci|npm install|gradlew/.test(publish), 'в задаче с правом записи нет установки пакетов и сборки');
  // личный ключ: по умолчанию выключен, включается только переменной репозитория
  assert.match(y, /if: \$\{\{ vars\.LIFEOS_USE_PRIVATE_KEY == 'yes' \}\}/);
  for (const s of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) assert.match(y, new RegExp(`secrets\\.${s}`));
});

test('ZIP: файл достаётся и из несжатого, и из сжатого архива', () => {
  const stored = Buffer.from(makeZip([{ name: 'AndroidManifest.xml', data: fixture }]));
  assert.ok(readZipEntry(stored, 'AndroidManifest.xml').equals(fixture));
  assert.equal(readZipEntry(stored, 'нет-такого'), null);
  const comp = zlib.deflateRawSync(fixture), nm = Buffer.from('AndroidManifest.xml');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(fixture.length, 22); lh.writeUInt16LE(nm.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(fixture.length, 24); cd.writeUInt16LE(nm.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + nm.length, 12); end.writeUInt32LE(30 + nm.length + comp.length, 16);
  const deflated = Buffer.concat([lh, nm, comp, cd, nm, end]);
  assert.ok(readZipEntry(deflated, 'AndroidManifest.xml').equals(fixture));
  assert.throws(() => readZipEntry(Buffer.from('не архив, просто текст достаточной длины для проверки'), 'x'), /ZIP/);
  // CLI: debug-манифест обязан провалить проверку (положительный контроль), код выхода 1
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-apk-'));
  fs.writeFileSync(path.join(tmp, 'debug.apk'), deflated);
  const r = spawnSync('node', [path.join(root, 'scripts/check-apk.mjs'), path.join(tmp, 'debug.apk')], { encoding: 'utf8', env: { ...process.env, ANDROID_HOME: tmp, ANDROID_SDK_ROOT: tmp } });
  assert.equal(r.status, 1); assert.match(r.stdout, /отлаживаем/); assert.match(r.stdout, /Отлаживаемое: ДА/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('манифест настоящей debug-сборки разобран верно и не проходит проверку', () => {
  const sum = summarize(decodeAxml(fixture));
  assert.equal(sum.package, 'app.lifeos.mobile'); assert.equal(sum.targetSdk, 35); assert.equal(sum.minSdk, 23);
  assert.deepEqual([...sum.permissions].sort(), ['android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS', 'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.WAKE_LOCK', 'app.lifeos.mobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION']);
  assert.equal(sum.app['android:debuggable'], true); assert.equal(sum.app['android:allowBackup'], false);
  const byName = n => sum.components.find(c => c.name.endsWith(n));
  assert.equal(byName('MainActivity').exported, true);
  assert.equal(byName('LocalNotificationRestoreReceiver').exported, false);
  assert.equal(byName('TimedNotificationPublisher').exported, undefined, 'без intent-filter и без exported: по умолчанию закрыт');
  assert.deepEqual([byName('ProfileInstallReceiver').exported, byName('ProfileInstallReceiver').permission], [true, 'android.permission.DUMP']);
  const r = audit(sum);
  assert.ok(r.errors.some(e => /android:debuggable=true/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.some(e => /usesCleartextTraffic/.test(e)));
  assert.ok(r.errors.some(e => /networkSecurityConfig/.test(e)) && r.errors.some(e => /dataExtractionRules/.test(e)));
  assert.ok(r.warnings.some(w => /WAKE_LOCK/.test(w)) && r.warnings.some(w => /ProfileInstallReceiver/.test(w)), 'терпимое даёт предупреждение, а не ошибку');
  assert.ok(!r.errors.some(e => /exported|разрешение/.test(e)), 'остальное в образце в порядке: ' + r.errors.join(' | '));
});

test('политика: «правильный» release проходит, любое отступление — ошибка', () => {
  const good = () => {
    const s = structuredClone(summarize(decodeAxml(fixture)));
    delete s.app['android:debuggable'];
    Object.assign(s.app, { 'android:usesCleartextTraffic': false, 'android:networkSecurityConfig': '@0x7f130001', 'android:dataExtractionRules': '@0x7f130002', 'android:fullBackupContent': '@0x7f130003' });
    s.permissions = s.permissions.filter(p => !/WAKE_LOCK/.test(p));
    s.components = s.components.filter(c => !/ProfileInstallReceiver/.test(c.name)).map(c => (c.kind === 'receiver' && !c.hasFilter ? { ...c, exported: false } : c));
    return s;
  };
  assert.deepEqual(audit(good()), { errors: [], warnings: [] });
  const bad = (mut, re) => { const s = good(); mut(s); const r = audit(s); assert.ok(r.errors.some(e => re.test(e)), `${re}: ${JSON.stringify(r)}`); };
  bad(s => { s.app['android:debuggable'] = true; }, /debuggable/);
  bad(s => { s.app['android:testOnly'] = true; }, /testOnly/);
  bad(s => { s.app['android:allowBackup'] = true; }, /allowBackup/);
  bad(s => { s.app['android:usesCleartextTraffic'] = true; }, /http/);
  bad(s => { delete s.app['android:dataExtractionRules']; }, /dataExtractionRules/);
  bad(s => { s.permissions.push('android.permission.RECORD_AUDIO'); }, /RECORD_AUDIO/);
  bad(s => { s.permissions.push('android.permission.CAMERA'); }, /CAMERA/);
  bad(s => { s.permissions.push('android.permission.ACCESS_FINE_LOCATION'); }, /ACCESS_FINE_LOCATION/);
  bad(s => { s.permissions = s.permissions.filter(p => !/INTERNET/.test(p)); }, /не хватает.*INTERNET/);
  bad(s => { s.components.push({ kind: 'receiver', name: 'x.Evil', exported: true, hasFilter: true }); }, /x\.Evil.*exported=true/);
  bad(s => { s.components.push({ kind: 'service', name: 'x.NoFlag', exported: undefined, hasFilter: true }); }, /не указан android:exported/);
  bad(s => { s.components.push({ kind: 'receiver', name: 'androidx.profileinstaller.ProfileInstallReceiver', exported: true, permission: undefined, hasFilter: true }); }, /ProfileInstallReceiver/);
  bad(s => { s.targetSdk = 30; }, /targetSdkVersion/);
  bad(s => { s.customPermissions.push({ name: 'x.PERM', level: '0x0' }); }, /x\.PERM/);
  assert.ok(POLICY.permissions.every(p => /^android\.permission\./.test(p)), 'в списке разрешённых нет микрофона, камеры и геолокации');
  assert.ok(!POLICY.permissions.some(p => /RECORD_AUDIO|CAMERA|LOCATION|CONTACTS|SMS|STORAGE/.test(p)));
});

// ---------- правки проекта Android на настоящем проекте от `cap add android` ----------
const capCli = path.join(root, 'node_modules/@capacitor/cli/bin/capacitor');
const havePython = spawnSync('python3', ['--version']).status === 0;
function snapshot(dir, base = dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) snapshot(p, base, out); else out[path.relative(base, p)] = fs.readFileSync(p).toString('base64');
  }
  return out;
}
test('patch-android.py: настоящий проект Capacitor правится верно и повторный запуск ничего не меняет', { skip: !fs.existsSync(capCli) || !havePython }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-cap-'));
  try {
    for (const f of ['package.json', 'capacitor.config.json']) fs.copyFileSync(path.join(root, f), path.join(tmp, f));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(tmp, 'dist')); fs.writeFileSync(path.join(tmp, 'dist/index.html'), '<!doctype html><html><head></head><body></body></html>');
    const env = { ...process.env, CI: 'true' };
    execFileSync('node', [capCli, 'add', 'android'], { cwd: tmp, env, stdio: 'pipe' });
    execFileSync('node', [capCli, 'sync', 'android'], { cwd: tmp, env, stdio: 'pipe' });
    fs.cpSync(path.join(root, 'assets/android-res'), path.join(tmp, 'android/app/src/main/res'), { recursive: true });
    const patch = envx => execFileSync('python3', [path.join(root, 'scripts/patch-android.py'), 'android'], { cwd: tmp, env: { ...env, ANDROID_VERSION_CODE: '77', ANDROID_VERSION_NAME: 'R4.0', ANDROID_APP_NAME: 'Тест', ...envx }, stdio: 'pipe' });
    patch();
    const first = snapshot(path.join(tmp, 'android'));
    patch();
    assert.deepEqual(snapshot(path.join(tmp, 'android')), first, 'повторный запуск ничего не меняет');
    const f = n => Buffer.from(first[n], 'base64').toString('utf8');
    const man = f('app/src/main/AndroidManifest.xml'), g = f('app/build.gradle');
    for (const a of ['android:allowBackup="false"', 'android:usesCleartextTraffic="false"', 'android:networkSecurityConfig="@xml/network_security_config"', 'android:dataExtractionRules="@xml/data_extraction_rules"', 'android:fullBackupContent="@xml/backup_rules"',
      'xmlns:tools=', '<uses-permission android:name="android.permission.WAKE_LOCK" tools:node="remove" />', 'ProfileInstallReceiver" tools:node="remove"']) assert.ok(man.includes(a), a);
    assert.equal((man.match(/android:exported="true"/g) || []).length, 1, 'открыто ровно одно окно');
    assert.match(g, /release \{\s*\/\/ lifeos:begin release\s*signingConfig signingConfigs\.debug\s*debuggable false/);
    assert.match(g, /checkReleaseBuilds = false/); assert.match(g, /storeFile file\("\.\.\/\.\.\/signing\/debug\.keystore"\)/); assert.match(g, /versionCode 77/);
    assert.match(f('app/src/main/res/xml/network_security_config.xml'), /cleartextTrafficPermitted="false"/);
    assert.match(f('app/src/main/res/xml/data_extraction_rules.xml'), /<cloud-backup>[\s\S]*<device-transfer>/);
    assert.match(f('app/src/main/assets/capacitor.config.json'), /"webContentsDebuggingEnabled": false/);
    assert.ok(first['app/src/main/java/app/lifeos/mobile/ApkInstallerPlugin.java']);
    // личный ключ: нужны все четыре переменные, иначе сборка останавливается
    assert.throws(() => patch({ LIFEOS_KEYSTORE_FILE: '/x.ks' }), /LIFEOS_KEYSTORE_PASSWORD|личный ключ/);
    patch({ LIFEOS_KEYSTORE_FILE: '/x.ks', LIFEOS_KEYSTORE_PASSWORD: 'p', LIFEOS_KEY_ALIAS: 'a', LIFEOS_KEY_PASSWORD: 'k' });
    assert.match(fs.readFileSync(path.join(tmp, 'android/app/build.gradle'), 'utf8'), /storeFile file\(System\.getenv\("LIFEOS_KEYSTORE_FILE"\)\)/);
    patch();
    assert.match(fs.readFileSync(path.join(tmp, 'android/app/build.gradle'), 'utf8'), /signing\/debug\.keystore/, 'без переменных снова общий ключ');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
