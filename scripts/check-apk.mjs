#!/usr/bin/env node
// Проверка готового APK перед выпуском (запускается в CI, см. .github/workflows/apk.yml). Работает без Android SDK:
// достаёт AndroidManifest.xml из APK, разбирает двоичный XML и проверяет безопасные настройки.
//   node scripts/check-apk.mjs out/lifeos.apk        — полная проверка (код выхода 1, если есть ошибки)
//   node scripts/check-apk.mjs --json out/lifeos.apk — то же, но выводит разобранный манифест
// Если на машине есть aapt2 (Android SDK build-tools), его ответ `dump badging` сверяется как вторая, независимая проверка.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

// ---------- ZIP: достать один файл ----------
export function readZipEntry(buf, wanted) {
  const eocdMin = Math.max(0, buf.length - 0xffff - 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= eocdMin; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('это не ZIP/APK: нет конца каталога');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP повреждён: каталог');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name === wanted) {
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('ZIP повреждён: заголовок файла');
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const raw = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) {
        const out = zlib.inflateRawSync(raw);
        if (out.length !== usize) throw new Error('ZIP повреждён: размер файла не совпал');
        return out;
      }
      throw new Error(`ZIP: неподдерживаемый способ сжатия ${method}`);
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

// ---------- двоичный XML Android (AXML) ----------
const NS_ANDROID = 'http://schemas.android.com/apk/res/android';

function readStringPool(buf, at) {
  const count = buf.readUInt32LE(at + 8), flags = buf.readUInt32LE(at + 16), strStart = buf.readUInt32LE(at + 20), headerSize = buf.readUInt16LE(at + 2);
  const utf8 = (flags & 0x100) !== 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    let o = at + strStart + buf.readUInt32LE(at + headerSize + 4 * i);
    if (utf8) {
      let c = buf[o++]; if (c & 0x80) o++;                       // длина в символах (нам не нужна)
      let b = buf[o++]; if (b & 0x80) b = ((b & 0x7f) << 8) | buf[o++];
      out.push(buf.toString('utf8', o, o + b));
    } else {
      let len = buf.readUInt16LE(o); o += 2;
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | buf.readUInt16LE(o); o += 2; }
      out.push(buf.toString('utf16le', o, o + len * 2));
    }
  }
  return out;
}

// Возвращает дерево { tag, attrs: { 'android:name': значение, … }, children: [] }.
export function decodeAxml(buf) {
  if (buf.length < 8 || buf.readUInt16LE(0) !== 0x0003) throw new Error('это не двоичный XML Android');
  let strings = [];
  const prefixes = new Map();                                    // uri -> префикс
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let off = buf.readUInt16LE(2);
  while (off + 8 <= buf.length) {
    const type = buf.readUInt16LE(off), size = buf.readUInt32LE(off + 4);
    if (size < 8) throw new Error('двоичный XML повреждён');
    if (type === 0x0001) strings = readStringPool(buf, off);
    else if (type === 0x0100) prefixes.set(strings[buf.readInt32LE(off + 20)], strings[buf.readInt32LE(off + 16)]);
    else if (type === 0x0102) {
      const nameIdx = buf.readInt32LE(off + 20), attrStart = buf.readUInt16LE(off + 24), attrSize = buf.readUInt16LE(off + 26), attrCount = buf.readUInt16LE(off + 28);
      const node = { tag: strings[nameIdx], attrs: {}, children: [] };
      for (let i = 0; i < attrCount; i++) {
        const a = off + 16 + attrStart + i * attrSize;
        const ns = buf.readInt32LE(a), nm = buf.readInt32LE(a + 4), raw = buf.readInt32LE(a + 8), dt = buf[a + 15], data = buf.readUInt32LE(a + 16);
        let key = strings[nm];
        if (ns >= 0) key = (strings[ns] === NS_ANDROID ? 'android' : (prefixes.get(strings[ns]) ?? strings[ns])) + ':' + key;
        let val;
        if (dt === 0x03) val = strings[raw >= 0 ? raw : data];
        else if (dt === 0x12) val = data !== 0;
        else if (dt === 0x10) val = data | 0;
        else if (dt === 0x11) val = data;
        else if (dt === 0x01) val = '@0x' + data.toString(16);
        else val = raw >= 0 ? strings[raw] : '0x' + data.toString(16);
        node.attrs[key] = val;
      }
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else if (type === 0x0103) stack.pop();
    off += size;
  }
  if (stack.length !== 1 || !root.children.length) throw new Error('двоичный XML оборван');
  return root.children[0];
}

// ---------- разбор манифеста и проверка ----------
const KINDS = ['activity', 'activity-alias', 'service', 'receiver', 'provider'];
const walk = (n, f) => { f(n); n.children.forEach(c => walk(c, f)); };

export function summarize(manifest) {
  const m = manifest;
  const app = m.children.find(c => c.tag === 'application');
  const sdk = m.children.find(c => c.tag === 'uses-sdk');
  const components = [];
  if (app) for (const c of app.children) if (KINDS.includes(c.tag)) {
    components.push({
      kind: c.tag, name: c.attrs['android:name'], exported: c.attrs['android:exported'],
      permission: c.attrs['android:permission'], hasFilter: c.children.some(x => x.tag === 'intent-filter'),
    });
  }
  return {
    package: m.attrs.package, sharedUserId: m.attrs['android:sharedUserId'],
    versionCode: m.attrs['android:versionCode'], versionName: m.attrs['android:versionName'],
    minSdk: sdk?.attrs['android:minSdkVersion'], targetSdk: sdk?.attrs['android:targetSdkVersion'],
    app: app ? app.attrs : null,
    permissions: m.children.filter(c => c.tag === 'uses-permission' || c.tag === 'uses-permission-sdk-23').map(c => c.attrs['android:name']),
    customPermissions: m.children.filter(c => c.tag === 'permission').map(c => ({ name: c.attrs['android:name'], level: c.attrs['android:protectionLevel'] })),
    components,
    features: m.children.filter(c => c.tag === 'uses-feature').map(c => c.attrs['android:name']),
  };
}

// Что разрешено. Всё остальное — ошибка: новое разрешение или открытый компонент не должны появляться незаметно.
export const POLICY = {
  permissions: ['android.permission.INTERNET', 'android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.POST_NOTIFICATIONS'],
  ownPermission: 'DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',           // служебное разрешение androidx.core, уровень signature
  toleratedPermissions: ['android.permission.WAKE_LOCK'],             // лишнее, но безвредное: только предупреждение
  exported: ['MainActivity'],                                          // единственный открытый компонент
  toleratedExported: [{ name: 'androidx.profileinstaller.ProfileInstallReceiver', permission: 'android.permission.DUMP' }],
  minTarget: 34,
};

export function audit(sum, policy = POLICY) {
  const errors = [], warnings = [];
  const app = sum.app;
  if (!app) return { errors: ['в манифесте нет <application>'], warnings };
  if (app['android:debuggable'] === true) errors.push('приложение отлаживаемое (android:debuggable=true): через него можно читать данные приложения и подключаться к WebView');
  if (app['android:testOnly'] === true) errors.push('приложение помечено testOnly');
  if (app['android:allowBackup'] !== false) errors.push('облачное копирование не выключено (android:allowBackup должен быть false)');
  if (app['android:usesCleartextTraffic'] !== false) errors.push('передача по http не запрещена (android:usesCleartextTraffic должен быть false)');
  for (const a of ['android:networkSecurityConfig', 'android:dataExtractionRules', 'android:fullBackupContent']) if (!app[a]) errors.push(`нет атрибута ${a}`);
  if (sum.sharedUserId) errors.push('задан sharedUserId');
  if (!(Number(sum.targetSdk) >= policy.minTarget)) errors.push(`targetSdkVersion ${sum.targetSdk} ниже ${policy.minTarget}`);

  const own = `${sum.package}.${policy.ownPermission}`;
  for (const p of sum.permissions) {
    if (policy.permissions.includes(p) || p === own) continue;
    if (policy.toleratedPermissions.includes(p)) warnings.push(`лишнее разрешение ${p} (не убралось при сборке манифеста)`);
    else errors.push(`неожиданное разрешение ${p}: если оно нужно, добавь его в POLICY (scripts/check-apk.mjs) и объясни в docs/SECURITY.md`);
  }
  for (const c of sum.customPermissions) if (c.name !== own) errors.push(`приложение объявляет своё разрешение ${c.name}`);
  for (const p of policy.permissions) if (!sum.permissions.includes(p)) errors.push(`не хватает разрешения ${p}: функция приложения перестанет работать`);

  for (const c of sum.components) {
    const label = `${c.kind} ${c.name}`;
    if (c.exported === undefined && c.hasFilter) errors.push(`${label}: есть intent-filter, но не указан android:exported`);
    const effective = c.exported === true;
    if (!effective) continue;
    if (policy.exported.some(n => c.name === n || c.name === `${sum.package}.${n}`)) continue;
    const tol = policy.toleratedExported.find(t => t.name === c.name);
    if (tol && c.permission === tol.permission) { warnings.push(`${label}: открыт, но закрыт разрешением ${tol.permission}`); continue; }
    errors.push(`${label}: открыт для других приложений (exported=true)`);
  }
  if (!sum.components.some(c => c.kind === 'activity' && c.exported === true)) errors.push('не найдено главное окно приложения');
  return { errors, warnings };
}

// ---------- запуск ----------
function findAapt2() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/usr/local/lib/android/sdk';
  const dir = path.join(sdk, 'build-tools');
  let versions = [];
  try { versions = fs.readdirSync(dir); } catch { /* SDK нет: проверка только нашим разбором */ }
  const num = v => v.split(/[.-]/).map(x => parseInt(x, 10) || 0);
  versions.sort((a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; });
  for (const v of versions) { const p = path.join(dir, v, 'aapt2'); if (fs.existsSync(p)) return p; }
  return null;
}

export function checkApk(file) {
  const apk = fs.readFileSync(file);
  const bin = readZipEntry(apk, 'AndroidManifest.xml');
  if (!bin) throw new Error('в APK нет AndroidManifest.xml');
  const sum = summarize(decodeAxml(bin));
  const res = audit(sum);
  let aapt2 = null;
  try {
    aapt2 = findAapt2();
    if (aapt2) {
      const badging = execFileSync(aapt2, ['dump', 'badging', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
      if (/^application-debuggable\s*$/m.test(badging)) res.errors.push('aapt2 dump badging: application-debuggable (APK отлаживаемый)');
      if (!/^package: name='[^']+'/m.test(badging)) res.warnings.push('aapt2 dump badging: не удалось прочитать строку package');
    }
  } catch (e) { res.warnings.push(`aapt2 не удалось запустить (${String(e.message).split('\n')[0]}); полагаемся на собственный разбор манифеста`); aapt2 = null; }
  return { sum, aapt2, ...res };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('Использование: node scripts/check-apk.mjs [--json] файл.apk'); process.exit(2); }
  let r;
  try { r = checkApk(file); } catch (e) { console.error(`::error::Не удалось проверить APK: ${e.message}`); process.exit(1); }
  const { sum } = r;
  if (json) console.log(JSON.stringify(sum, null, 2));
  console.log(`Пакет ${sum.package}, версия ${sum.versionName} (${sum.versionCode}), minSdk ${sum.minSdk}, targetSdk ${sum.targetSdk}`);
  console.log(`Отлаживаемое: ${sum.app?.['android:debuggable'] === true ? 'ДА' : 'нет'}; резервное копирование: ${sum.app?.['android:allowBackup'] === false ? 'выключено' : 'ВКЛЮЧЕНО'}; http: ${sum.app?.['android:usesCleartextTraffic'] === false ? 'запрещён' : 'НЕ запрещён'}`);
  console.log('Разрешения:', sum.permissions.join(', '));
  console.log('Открытые компоненты:', sum.components.filter(c => c.exported === true).map(c => `${c.kind} ${c.name}${c.permission ? ` (нужно ${c.permission})` : ''}`).join('; ') || 'нет');
  console.log(r.aapt2 ? `Сверка с aapt2 выполнена (${r.aapt2})` : 'aapt2 не найден: сверка только по собственному разбору манифеста');
  for (const w of r.warnings) console.log(`::warning::${w}`);
  for (const e of r.errors) console.log(`::error::${e}`);
  if (r.errors.length) { console.error(`Проверка APK не пройдена: ошибок ${r.errors.length}`); process.exit(1); }
  console.log('Проверка APK пройдена.');
}
