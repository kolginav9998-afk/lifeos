// Запуск сервера синхронизации на Node 22+ (для тестов и для своего сервера).
//   PORT=8787 DB_PATH=./lifeos.db ALLOWED_ORIGINS=https://kolginav9998-afk.github.io node server/node/server.js
// По умолчанию слушает только 127.0.0.1 (за прокси с https: Caddy, Cloudflare Tunnel). Чтобы слушать все адреса, задай HOST=0.0.0.0.
// За прокси задай TRUST_PROXY=1: тогда адресом клиента считается последний адрес из X-Forwarded-For (его дописывает ваш прокси).
// Без TRUST_PROXY заголовки X-Forwarded-For и CF-Connecting-IP от клиента игнорируются: иначе защиту от подбора пароля обходят подменой заголовка.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../core.js';
import { SqlStore } from '../sqlstore.js';

export function openStore(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  const adapter = {
    all: (sql, ...p) => db.prepare(sql).all(...p).map(r => ({ ...r })),
    run: (sql, ...p) => { db.prepare(sql).run(...p); },
    tx(fn) { db.exec('BEGIN IMMEDIATE'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
  return { store: new SqlStore(adapter).migrate(), close: () => db.close() };
}

// Адрес клиента для защиты от подбора. Подделать его заголовком нельзя, если нет доверенного прокси.
export function clientIp(req, trustProxy = false) {
  const direct = req.socket?.remoteAddress || 'unknown';
  if (!trustProxy) return direct;
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return chain.length ? chain[chain.length - 1] : direct;
}

export function createServer({ dbPath = ':memory:', env = {}, now, trustProxy = false } = {}) {
  const { store, close } = openStore(dbPath);
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const c of req) { size += c.length; if (size > 4 * 1024 * 1024) { res.writeHead(413).end(); return; } chunks.push(c); }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const url = `http://${req.headers.host || 'localhost'}${req.url}`;
      const headers = { ...req.headers };
      delete headers['x-forwarded-for'];
      headers['cf-connecting-ip'] = clientIp(req, trustProxy);          // ядро берёт адрес отсюда; присланное клиентом выброшено
      const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const response = await handle(request, store, env, now ? now() : Date.now());
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) { console.error('fatal:', e?.message); res.writeHead(500).end(); }
  });
  server.headersTimeout = 15_000;                                       // медленные «капельные» запросы не держат соединения вечно
  server.requestTimeout = 30_000;
  return { server, store, close: () => { server.close(); close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server } = createServer({
    dbPath: process.env.DB_PATH || './lifeos-sync.db',
    env: { ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS, SETUP_CODE: process.env.SETUP_CODE },
    trustProxy: process.env.TRUST_PROXY === '1',
  });
  const port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Сервер синхронизации слушает ${host}:${port}`));
}
