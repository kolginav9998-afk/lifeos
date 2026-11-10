// Офлайн-оболочка. Список файлов и версия кэша генерируются сборкой автоматически.
const CACHE = 'lifeos-' + /*BUILD_HASH*/ 'dev';
const SHELL = /*SHELL_LIST*/ ['./'];   // список файлов и версия кэша подставляются при сборке (scripts/build-web.sh)

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
