// Офлайн-оболочка. При изменении файлов — поднять CACHE.
const CACHE = 'lifeos-r2.1';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'app.js', 'ui.js', 'prefs.js', 'store.js', 'db.js', 'vault.js', 'cryptoutil.js', 'backup.js', 'events.js', 'habits.js', 'money.js',
  'notes.js', 'search.js', 'review.js', 'quick.js', 'export.js', 'platform.js', 'version.js', 'reminders.js', 'notify.js',
  'view-today.js', 'view-habits.js', 'view-money.js', 'view-notes.js', 'view-settings.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Сначала сеть (чтобы обновления доходили сразу), при её отсутствии или тормозах — кэш.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(req, { cache: 'no-cache' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ]);
      if (res.ok && !new URL(req.url).search) cache.put(req, res.clone());   // запросы с ?параметрами («Поделиться») не кэшируем
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw new Error('offline and not cached');
    }
  })());
});
