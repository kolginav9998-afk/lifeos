// R3.12: обновление изнутри (updater.js, нативный плагин, сборка) и профиль (profile.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseVersion, compareVersions, isTrustedUrl, readRelease, judge, checkApp, checkSite, shouldAutoCheck, percent, sizeText, downloadAndInstall, RELEASE_URL, APK_LINK } from '../updater.js';
import { AVATARS, COLORS, initials, profileCard, checkProfileForm, saveProfileRecord } from '../profile.js';
import { makeProfile, profileOf } from '../events.js';
import { VERSION } from '../version.js';

const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// ---------- версии ----------
test('версии: разбор и сравнение', () => {
  assert.deepEqual(parseVersion('R3.11.1'), [3, 11, 1]);
  assert.deepEqual(parseVersion('R3.12'), [3, 12, 0]);
  assert.equal(parseVersion('3.12'), null);
  assert.equal(parseVersion('R3.x'), null);
  assert.equal(parseVersion(null), null);
  assert.equal(compareVersions('R3.11', 'R3.11.1'), -1);
  assert.equal(compareVersions('R3.11.1', 'R3.12'), -1);
  assert.equal(compareVersions('R3.12', 'R3.12'), 0);
  assert.equal(compareVersions('R3.12.0', 'R3.12'), 0);
  assert.equal(compareVersions('R4.0', 'R3.99.9'), 1);
  assert.equal(compareVersions('R3.9', 'R3.10'), -1, 'числа сравниваются как числа, а не как строки');
  assert.equal(compareVersions('abc', 'R3.1'), null);
  assert.equal(judge('R3.11.1', 'R3.12'), 'newer');
  assert.equal(judge('R3.12', 'R3.12'), 'current');
  assert.equal(judge('R3.13', 'R3.12'), 'current', 'если на телефоне версия новее выпуска, обновлять нечего');
  assert.equal(judge('R3.12', 'что-то'), 'unknown');
  assert.ok(parseVersion(VERSION), 'версия приложения разбирается');
});

test('адрес обновления: только GitHub по https', () => {
  assert.ok(isTrustedUrl(APK_LINK));
  assert.ok(isTrustedUrl('https://objects.githubusercontent.com/x/y'));
  assert.ok(isTrustedUrl('https://release-assets.githubusercontent.com/a'));
  for (const bad of ['http://github.com/a', 'https://evil.example/github.com', 'https://github.com.evil.example/a', 'https://notgithub.com/a', 'ftp://github.com/a', 'javascript:alert(1)', '', null, undefined]) assert.equal(isTrustedUrl(bad), false, String(bad));
});

// ---------- сведения о выпуске ----------
const release = (over = {}) => ({
  body: '<!-- lifeos-update {"version":"R3.12","notes":["Первое","Второе"]} -->\nАвтосборка',
  assets: [{ name: 'lifeos.apk', size: 5673963, browser_download_url: APK_LINK, digest: 'sha256:' + 'ab'.repeat(32) }],
  ...over,
});
test('выпуск: разбор сведений', () => {
  const r = readRelease(release());
  assert.deepEqual(r, { version: 'R3.12', notes: ['Первое', 'Второе'], url: APK_LINK, size: 5673963, sha256: 'ab'.repeat(32) });
  // нет контрольной суммы и размера — не страшно
  const r2 = readRelease(release({ assets: [{ name: 'lifeos.apk', browser_download_url: APK_LINK }] }));
  assert.equal(r2.sha256, ''); assert.equal(r2.size, 0);
  // чужой или испорченный выпуск не принимается
  assert.equal(readRelease(null), null);
  assert.equal(readRelease(release({ body: 'просто текст' })), null);
  assert.equal(readRelease(release({ body: '<!-- lifeos-update {не json} -->' })), null);
  assert.equal(readRelease(release({ body: '<!-- lifeos-update {"version":"x"} -->' })), null);
  assert.equal(readRelease(release({ assets: [{ name: 'other.apk', browser_download_url: APK_LINK }] })), null);
  assert.equal(readRelease(release({ assets: [{ name: 'lifeos.apk', browser_download_url: 'https://evil.example/lifeos.apk' }] })), null, 'чужой адрес файла');
  assert.equal(readRelease(release({ assets: [{ name: 'lifeos.apk', browser_download_url: APK_LINK, digest: 'md5:zzz' }] })).sha256, '', 'неверный формат суммы игнорируется');
  // заметки ограничены
  const many = readRelease(release({ body: `<!-- lifeos-update ${JSON.stringify({ version: 'R3.12', notes: Array.from({ length: 20 }, (_, i) => `п${i}`).concat([5, '', '  ']) })} -->` }));
  assert.equal(many.notes.length, 8);
});

const okJson = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
test('проверка в приложении: новая, текущая и ошибки', async () => {
  let asked = null;
  const f = body => async (url, opt) => { asked = { url, opt }; return okJson(body); };
  const newer = await checkApp({ fetchFn: f(release()), current: 'R3.11.1' });
  assert.equal(asked.url, RELEASE_URL); assert.equal(asked.opt.cache, 'no-store');
  assert.deepEqual([newer.kind, newer.state, newer.latest, newer.release.url], ['app', 'newer', 'R3.12', APK_LINK]);
  assert.equal((await checkApp({ fetchFn: f(release()), current: 'R3.12' })).state, 'current');
  await assert.rejects(checkApp({ fetchFn: async () => ({ ok: false, status: 403 }), current: 'R3.11' }), /ограничил запросы/);
  await assert.rejects(checkApp({ fetchFn: async () => ({ ok: false, status: 500 }), current: 'R3.11' }), /код 500/);
  await assert.rejects(checkApp({ fetchFn: async () => { throw new TypeError('Failed to fetch'); }, current: 'R3.11' }), /Нет связи/);
  await assert.rejects(checkApp({ fetchFn: f({ body: 'ничего', assets: [] }), current: 'R3.11' }), /не найдены/);
});

test('проверка на сайте: читает version.js', async () => {
  const f = text => async url => { assert.match(url, /^version\.js\?t=\d+$/); return { ok: true, status: 200, text: async () => text }; };
  assert.deepEqual(await checkSite({ fetchFn: f("export const VERSION = 'R3.13';"), current: 'R3.12' }), { kind: 'site', state: 'newer', latest: 'R3.13', release: null });
  assert.equal((await checkSite({ fetchFn: f("export const VERSION = 'R3.12';"), current: 'R3.12' })).state, 'current');
  await assert.rejects(checkSite({ fetchFn: f('мусор'), current: 'R3.12' }), /прочитать версию/);
  await assert.rejects(checkSite({ fetchFn: async () => { throw new TypeError('x'); }, current: 'R3.12' }), /Нет связи/);
});

test('автопроверка: не чаще раза в 6 часов, и не ломается от часов в будущем', () => {
  const now = 1_000_000_000_000;
  assert.equal(shouldAutoCheck(0, now), true);
  assert.equal(shouldAutoCheck(now - 3600_000, now), false);
  assert.equal(shouldAutoCheck(now - 7 * 3600_000, now), true);
  assert.equal(shouldAutoCheck(now + 5000, now), true, 'отметка из будущего (часы переводили) не должна отключать проверку навсегда');
  assert.deepEqual([percent(50, 200), percent(5, 0), percent(300, 200), percent(-1, 10)], [25, 0, 100, 0]);
  assert.equal(sizeText(5673963), '5,4 МБ'); assert.equal(sizeText(2048), '2 КБ');
});

// ---------- порядок «скачать и установить» ----------
function fakePlugin(over = {}) {
  const calls = [];
  let handler = null;
  const p = {
    calls,
    info: async () => { calls.push('info'); return { canInstall: true }; },
    openInstallSettings: async () => { calls.push('settings'); },
    addListener: async (name, fn) => { calls.push('listen:' + name); handler = fn; return { remove: () => calls.push('unlisten') }; },
    download: async arg => { calls.push('download'); handler?.({ received: 50, total: 100 }); handler?.({ received: 100, total: 100 }); return { path: '/cache/updates/update.apk', size: 5673963, sha256: 'ab'.repeat(32), ...arg && {} }; },
    install: async arg => { calls.push('install:' + arg.path); return { started: true, needsPermission: false }; },
    ...over,
  };
  return p;
}
test('скачать и установить: обычный путь', async () => {
  const p = fakePlugin(), seen = [];
  const r = await downloadAndInstall({ plugin: p, release: readRelease(release()), onProgress: e => seen.push(e) });
  assert.deepEqual(r, { state: 'installing' });
  assert.deepEqual(p.calls, ['info', 'listen:progress', 'download', 'unlisten', 'install:/cache/updates/update.apk']);
  assert.deepEqual(seen, [{ received: 50, total: 100 }, { received: 100, total: 100 }]);
});
test('скачать и установить: нужно разрешение на установку', async () => {
  const p = fakePlugin({ info: async () => ({ canInstall: false }) });
  assert.deepEqual(await downloadAndInstall({ plugin: p, release: readRelease(release()) }), { state: 'needs-permission' });
  assert.ok(p.calls.includes('settings') && !p.calls.includes('download'), 'настройки открыты, скачивание не начиналось');
  const q = fakePlugin({ install: async () => ({ started: false, needsPermission: true }) });
  assert.deepEqual(await downloadAndInstall({ plugin: q, release: readRelease(release()) }), { state: 'needs-permission' });
});
test('скачать и установить: повреждённый файл не ставится', async () => {
  const bad = (file) => fakePlugin({ download: async () => file });
  await assert.rejects(downloadAndInstall({ plugin: bad({ path: '/p', size: 100, sha256: 'ab'.repeat(32) }), release: readRelease(release()) }), /не полностью/);
  await assert.rejects(downloadAndInstall({ plugin: bad({ path: '/p', size: 5673963, sha256: 'cd'.repeat(32) }), release: readRelease(release()) }), /Контрольная сумма/);
  await assert.rejects(downloadAndInstall({ plugin: bad({}), release: readRelease(release()) }), /не скачался/);
  const p = bad({ path: '/p', size: 100, sha256: 'x' });
  await assert.rejects(downloadAndInstall({ plugin: p, release: readRelease(release()) }));
  assert.ok(!p.calls?.includes('install'), 'установка не открывалась');
});
test('скачать и установить: ошибка загрузки снимает подписку на прогресс', async () => {
  const p = fakePlugin({ download: async () => { throw new Error('Сервер ответил кодом 404'); } });
  await assert.rejects(downloadAndInstall({ plugin: p, release: readRelease(release()) }), /404/);
  assert.ok(p.calls.includes('unlisten'));
  assert.ok(!p.calls.some(c => c.startsWith('install')));
});
test('скачать и установить: нет плагина или чужой адрес', async () => {
  await assert.rejects(downloadAndInstall({ plugin: null, release: readRelease(release()) }), /недоступно/);
  await assert.rejects(downloadAndInstall({ plugin: fakePlugin(), release: { url: 'https://evil.example/a.apk' } }), /не разрешён/);
});

// ---------- связка с нативной частью и сборкой ----------
test('нативный плагин: методы, которые вызывает updater.js, есть в Java', () => {
  const j = read('assets/android-java/ApkInstallerPlugin.java');
  assert.match(j, /@CapacitorPlugin\(name = "ApkInstaller"\)/);
  for (const m of ['info', 'openInstallSettings', 'download', 'cancel', 'install']) assert.match(j, new RegExp(`@PluginMethod\\s+public void ${m}\\(`), `метод ${m}`);
  assert.match(j, /notifyListeners\("progress"/);
  assert.match(j, /getPackageName\(\) \+ "\.fileprovider"/, 'тот же FileProvider, что в шаблоне Capacitor');
  assert.match(j, /canRequestPackageInstalls/);
  assert.ok(/trusted\(/.test(j) && /githubusercontent\.com/.test(j), 'скачивание только с GitHub');
  const u = read('updater.js');
  for (const m of ['info', 'openInstallSettings', 'download', 'install']) assert.match(u, new RegExp(`plugin\\.${m}\\(`), `updater.js вызывает ${m}`);
  assert.match(u, /addListener\?\.\('progress'/);
});
test('сборка APK: плагин, разрешение, номер сборки и сведения о выпуске', () => {
  const y = read('.github/workflows/apk.yml'), p = read('scripts/patch-android.py');
  assert.match(y, /ANDROID_VERSION_CODE: \$\{\{ github\.run_number \}\}/);
  assert.match(y, /ANDROID_VERSION_NAME/);
  assert.match(y, /<!-- lifeos-update \{"version":"\$VERSION","notes":\$NOTES\} -->/);
  assert.match(y, /--notes-file release-notes\.md/);
  assert.match(p, /registerPlugin\(ApkInstallerPlugin\.class\)/);
  assert.match(p, /REQUEST_INSTALL_PACKAGES/);
  assert.match(p, /versionCode/);
  // разметка выпуска, которую пишет сборка, читается приложением
  const marker = y.match(/<!-- lifeos-update (\{.*\}) -->/)[1].replace('"$VERSION"', '"R3.12"').replace('$NOTES', '["а","б"]');
  const rel = readRelease({ body: `<!-- lifeos-update ${marker} -->`, assets: [{ name: 'lifeos.apk', browser_download_url: APK_LINK }] });
  assert.equal(rel.version, 'R3.12');
});

// ---------- профиль ----------
test('профиль: буквы, значок и цвет', () => {
  assert.equal(initials('Анна Петрова'), 'АП');
  assert.equal(initials('  anna  '), 'A');
  assert.equal(initials('Мария Ивановна Сидорова'), 'МИ');
  assert.equal(initials(''), '');
  assert.equal(initials('🙂 Ёж'), '🙂Ё', 'эмодзи не ломается на половинки');
  const none = profileCard([], { username: 'egor' });
  assert.deepEqual([none.name, none.login, none.face, none.color, none.motto], ['', 'egor', 'E', 'violet', '']);
  const ev = [makeProfile('Анна Петрова', 1, null, { avatar: '🦊', color: 'teal', motto: 'Шаг за шагом' })];
  const c = profileCard(ev, { username: 'anna' });
  assert.deepEqual([c.name, c.face, c.emoji, c.color, c.hex, c.motto], ['Анна Петрова', '🦊', '🦊', 'teal', COLORS.teal, 'Шаг за шагом']);
  // испорченные значения (например, из чужой записи) не ломают экран
  const weird = profileCard([makeProfile('Ян', 1, null, { avatar: '<script>', color: 'red' })], null);
  assert.deepEqual([weird.emoji, weird.face, weird.color], ['', 'Я', 'violet']);
});
test('профиль: проверка формы и сохранение не затирают поля здоровья', () => {
  assert.deepEqual(checkProfileForm({ name: '  Анна   П  ', avatar: '🦊', color: 'rose', motto: ' девиз ' }), { name: 'Анна П', avatar: '🦊', color: 'rose', motto: 'девиз' });
  assert.deepEqual(checkProfileForm({}), { name: '', avatar: '', color: 'violet', motto: '' });
  assert.throws(() => checkProfileForm({ name: 'А' }), /хотя бы два/);
  assert.throws(() => checkProfileForm({ color: 'red' }), /цвет/);
  assert.throws(() => checkProfileForm({ avatar: 'x' }), /значок/);
  assert.equal(checkProfileForm({ name: 'я'.repeat(100), motto: 'д'.repeat(200) }).name.length, 60);
  assert.equal(checkProfileForm({ motto: 'д'.repeat(200) }).motto.length, 80);
  const health = makeProfile('Анна', 1, null, { heightCm: 170, birthYear: 1990, sleepTarget: 8 });
  const saved = saveProfileRecord([health], { name: 'Анна К', avatar: AVATARS[3], color: 'blue', motto: '' }, 5);
  assert.equal(saved.id, 'profile'); assert.equal(saved.type, 'profile');
  assert.equal(saved.payload.heightCm, 170); assert.equal(saved.payload.birthYear, 1990, 'рост и год рождения на месте');
  assert.deepEqual([saved.payload.name, saved.payload.avatar, saved.payload.color], ['Анна К', AVATARS[3], 'blue']);
  assert.equal(profileOf([saved]).payload.accountId, health.payload.accountId, 'служебный номер не меняется');
});
