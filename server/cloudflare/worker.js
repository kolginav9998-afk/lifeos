// Cloudflare Worker + Durable Object (встроенный SQLite). Один объект «main» хранит единственный аккаунт и все записи.
// Бесплатный тариф Cloudflare включает такие объекты; данные в них зашифрованы на устройствах.
import { DurableObject } from 'cloudflare:workers';
import { handle, edgeReply } from '../core.js';
import { SqlStore } from '../sqlstore.js';

export class Vault extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.store = new SqlStore({
      all: (q, ...p) => sql.exec(q, ...p).toArray(),
      run: (q, ...p) => { sql.exec(q, ...p).toArray(); },
      tx: fn => ctx.storage.transactionSync(fn),
    }).migrate();
  }
  async fetch(request) { return handle(request, this.store, this.env); }
}

export default {
  async fetch(request, env) {
    // Всё постороннее (сканеры, чужие адреса) отсекаем здесь, не будя базу: у бесплатного тарифа есть дневные лимиты на обращения к ней.
    if (!new URL(request.url).pathname.startsWith('/v1/')) return edgeReply(request, env, 404, 'not_found');
    try {
      const stub = env.VAULT.get(env.VAULT.idFromName('main'));
      return await stub.fetch(request);
    } catch {
      return edgeReply(request, env, 503, 'unavailable');            // без подробностей: сбой объекта не должен показывать страницу с внутренними сведениями
    }
  },
};
