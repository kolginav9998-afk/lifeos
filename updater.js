// Обновление приложения изнутри. Чистая логика: сравнение версий, разбор сведений о выпуске, порядок «проверить → скачать → установить».
// Сеть и системные вызовы передаются снаружи (так всё проверяется тестами без телефона).
//
// В Android-приложении: версия берётся из сведений о выпуске latest-apk на GitHub (их кладёт сборка), файл скачивает и устанавливает
// нативный плагин ApkInstaller (подтверждение установки всегда остаётся за пользователем). На сайте обновление — это перезагрузка страницы.

export const REPO = 'kolginav9998-afk/lifeos';
export const RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/tags/latest-apk`;
export const APK_ASSET = 'lifeos.apk';
export const APK_LINK = `https://github.com/${REPO}/releases/download/latest-apk/${APK_ASSET}`;
export const AUTO_CHECK_MS = 6 * 3600 * 1000;      // сама проверять не чаще раза в 6 часов
const MARK = /<!--\s*lifeos-update\s+(\{[\s\S]*?\})\s*-->/;

// «R3.11.1» → [3, 11, 1]; «R3.12» → [3, 12, 0]; не версия → null
export function parseVersion(v) {
  const m = /^R(\d{1,3})(?:\.(\d{1,3}))?(?:\.(\d{1,3}))?$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}
// -1: a старее b, 0: одинаковые, 1: a новее b, null: одну из версий не разобрать
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// Скачивать можно только с GitHub и только по https.
export function isTrustedUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /(^|\.)(github\.com|githubusercontent\.com)$/.test(x.hostname);
  } catch { return false; }
}

// Адрес файла обновления: строго файл нашего выпуска latest-apk в нашем репозитории, а не любой адрес на github.com
// (дальше GitHub сам перенаправляет на свои серверы файлов; их проверяют isTrustedUrl и нативный плагин).
export const MAX_APK_BYTES = 150 * 1024 * 1024;           // настоящий файл около 7 МБ; больше 150 МБ — явно не он
export function isReleaseAssetUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname.toLowerCase() === 'github.com' && !x.username && !x.password && !x.port && !x.search && !x.hash
      && x.pathname.toLowerCase() === `/${REPO}/releases/download/latest-apk/${APK_ASSET}`.toLowerCase();
  } catch { return false; }
}

// Сведения о выпуске из ответа GitHub API: { version, notes, url, size, sha256 } или null, если это не выпуск нашего приложения.
export function readRelease(json) {
  if (!json || typeof json !== 'object') return null;
  const m = MARK.exec(String(json.body ?? ''));
  let meta = null;
  try { meta = m ? JSON.parse(m[1]) : null; } catch { meta = null; }
  const asset = Array.isArray(json.assets) ? json.assets.find(a => a && a.name === APK_ASSET) : null;
  if (!meta || !parseVersion(meta.version) || !asset) return null;
  const url = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : APK_LINK;
  if (!isReleaseAssetUrl(url)) return null;
  if (Number(asset.size) > MAX_APK_BYTES) return null;
  const digest = typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(asset.digest) ? asset.digest.slice(7) : '';
  const notes = Array.isArray(meta.notes) ? meta.notes.filter(t => typeof t === 'string' && t.trim()).slice(0, 8).map(t => t.trim().slice(0, 200)) : [];
  return { version: String(meta.version), notes, url, size: Number(asset.size) > 0 ? Number(asset.size) : 0, sha256: digest };
}

// Новее ли выпуск, чем то, что установлено: 'newer' | 'current' | 'unknown'
export function judge(current, latest) {
  const c = compareVersions(latest, current);
  return c === null ? 'unknown' : c > 0 ? 'newer' : 'current';
}

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? 'GitHub временно ограничил запросы, попробуй позже' : `Не удалось узнать о новой версии (код ${res.status})`);
  return res.json();
}

// Проверка в Android-приложении.
export async function checkApp({ fetchFn = globalThis.fetch.bind(globalThis), current }) {
  let json;
  try { json = await getJson(fetchFn, RELEASE_URL); }
  catch (e) { throw e instanceof TypeError ? new Error('Нет связи: не получилось проверить обновления') : e; }
  const release = readRelease(json);
  if (!release) throw new Error('Сведения о новой версии не найдены');
  return { kind: 'app', state: judge(current, release.version), latest: release.version, release };
}

// Проверка на сайте: читаем version.js, который сейчас лежит на сайте.
export async function checkSite({ fetchFn = globalThis.fetch.bind(globalThis), current, url = 'version.js' }) {
  let text;
  try {
    const res = await fetchFn(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Не удалось узнать о новой версии (код ${res.status})`);
    text = await res.text();
  } catch (e) { throw e instanceof TypeError ? new Error('Нет связи: не получилось проверить обновления') : e; }
  const m = /VERSION\s*=\s*'([^']+)'/.exec(text);
  if (!m || !parseVersion(m[1])) throw new Error('Не удалось прочитать версию сайта');
  return { kind: 'site', state: judge(current, m[1]), latest: m[1], release: null };
}

export const shouldAutoCheck = (lastAt, now = Date.now(), every = AUTO_CHECK_MS) => !lastAt || now - lastAt >= every || lastAt > now;

export const percent = (received, total) => (total > 0 ? Math.max(0, Math.min(100, Math.round((received / total) * 100))) : 0);
export const sizeText = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`);

// Скачать и открыть установщик. plugin — нативный ApkInstaller. Возвращает:
//  { state: 'installing' }        — системное окно установки открыто;
//  { state: 'needs-permission' }  — нужно разрешить установку из этого приложения (настройки уже открыты), потом нажать «Обновить» ещё раз.
// Любая ошибка выбрасывается с понятным текстом.
export async function downloadAndInstall({ plugin, release, onProgress = () => {} }) {
  if (!plugin) throw new Error('В этой сборке обновление изнутри недоступно: скачай новую версию по ссылке');
  if (!release || !isReleaseAssetUrl(release.url)) throw new Error('Адрес обновления не разрешён');
  const info = await plugin.info();
  if (info && info.canInstall === false) {
    await plugin.openInstallSettings();
    return { state: 'needs-permission' };
  }
  const sub = await plugin.addListener?.('progress', e => onProgress({ received: Number(e?.received) || 0, total: Number(e?.total) || release.size || 0 }));
  let file;
  try { file = await plugin.download({ url: release.url }); }
  finally { sub?.remove?.(); }
  if (!file || !file.path) throw new Error('Файл обновления не скачался');
  if (file.size > MAX_APK_BYTES) throw new Error('Файл обновления слишком большой: обновление не установлено');
  if (release.size && file.size !== release.size) throw new Error('Файл скачался не полностью, попробуй ещё раз');
  if (release.sha256 && file.sha256 !== release.sha256) throw new Error('Контрольная сумма файла не совпала: обновление не установлено');
  const r = await plugin.install({ path: file.path });
  if (r && r.needsPermission) {
    await plugin.openInstallSettings();
    return { state: 'needs-permission' };
  }
  return { state: 'installing' };
}
