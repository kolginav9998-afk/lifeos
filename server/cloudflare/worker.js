// Cloudflare Worker + Durable Object (встроенный SQLite). Один объект «main» хранит единственный аккаунт и все записи.
// Бесплатный тариф Cloudflare включает такие объекты; данные в них зашифрованы на устройствах.
import { DurableObject } from 'cloudflare:workers';
import { handle } from '../core.js';
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
    const stub = env.VAULT.get(env.VAULT.idFromName('main'));
    return stub.fetch(request);
  },
};
