// Движок синхронизации. Модель: у каждой записи есть метка u; побеждает запись с большим u (последняя правка).
// Удаление — «надгробие» с меткой u. Всё, что приходит и уходит, зашифровано на устройстве.
//
// Порядок: сначала забираем новое с сервера (применяем только то, что новее локального), потом отправляем свои
// изменённые записи. Ничего не стирается, пока не доказано, что чужая версия новее.
import { ApiError } from './api.js';

export const BATCH = 100;
export const BATCH_BYTES = 1_200_000;
const MAX_ROUNDS = 4;

/**
 * deps:
 *   api, server, getToken()           — доступ к серверу
 *   local: { metas()→Map(id→u), get(id), writeMany(recs), deleteMany(ids), stampU(id,u) } — хранилище БЕЗ отметок изменений
 *   validate(rec)→bool                — можно ли расшифровать запись (ключ тот же)
 *   clock: { tick(), observe(u) }
 *   loadState()/saveState(st)         — { since, dirty:{id:{u,d}}, lastSyncAt }
 *   onStatus(s), onApplied({upserts, deletes}), onUnauthorized()
 */
export function createSync(deps) {
  const { api, server, getToken, local, validate, clock, loadState, saveState, now = Date.now, onStatus = () => {}, onApplied = () => {}, onUnauthorized = () => {} } = deps;
  let st = { since: 0, dirty: {}, lastSyncAt: 0, ...(loadState() || {}) };
  let status = { state: 'idle', lastSyncAt: st.lastSyncAt, pending: Object.keys(st.dirty).length, error: null, bad: 0 };
  let running = null;
  let saveTimer = null;

  const persist = () => { clearTimeout(saveTimer); saveState(st); };
  const persistSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveState(st), 300); };
  const emit = patch => { status = { ...status, ...patch, pending: Object.keys(st.dirty).length }; onStatus(status); };

  // ---- отметки об изменениях ----
  function notifyWrite({ id, u, d }) { st.dirty[id] = { u, d: d ? 1 : 0 }; emit({}); persistSoon(); }

  async function markAllDirty() {
    const metas = await local.metas();
    for (const [id, u0] of metas) {
      let u = u0;
      if (!u) { u = clock.tick(); await local.stampU(id, u); }      // записи, созданные до синхронизации, не имели метки
      st.dirty[id] = { u, d: 0 };
    }
    persist(); emit({});
  }

  // ---- приём ----
  async function pullAll(metas) {
    let rounds = 0, reset = false;
    for (;;) {
      const page = await api.pull(server, getToken(), st.since, 500);
      if (!reset && page.seq < st.since && !page.records.length) {                // сервер «забыл» всё (был сброшен)
        reset = true; st.since = 0; await markAllDirty(); continue;
      }
      await applyPage(page.records, metas);
      st.since = page.seq;
      persist();
      if (!page.more) return;
      if (++rounds > 2000) throw new Error('too_many_pages');
    }
  }

  async function applyPage(records, metas) {
    const upserts = [], deletes = [];
    let bad = 0;
    for (const r of records) {
      clock.observe(r.u);
      const d = st.dirty[r.id];
      const lu = Math.max(metas.get(r.id) ?? 0, d?.u ?? 0);
      if (r.u > lu) {
        if (r.d) { deletes.push(r.id); metas.delete(r.id); delete st.dirty[r.id]; }
        else if (await validate(r)) { upserts.push({ id: r.id, v: r.v ?? 1, u: r.u, iv: r.iv, ct: r.ct }); metas.set(r.id, r.u); delete st.dirty[r.id]; }
        else bad += 1;
      } else if (r.u < lu) {
        if (!d) st.dirty[r.id] = { u: lu, d: 0 };                                  // локальная версия новее — её нужно отправить
      } else if (d && d.u === r.u) delete st.dirty[r.id];                          // эхо нашей же записи
    }
    if (deletes.length) await local.deleteMany(deletes);
    if (upserts.length) await local.writeMany(upserts);
    if (bad) emit({ bad: status.bad + bad });
    if (upserts.length || deletes.length) onApplied({ upserts: upserts.map(r => r.id), deletes });
  }

  // ---- отправка ----
  async function pushAll() {
    let needsPull = false;
    const ids = Object.keys(st.dirty);
    let i = 0;
    while (i < ids.length) {
      const batch = [];
      let bytes = 0;
      while (i < ids.length && batch.length < BATCH) {
        const id = ids[i];
        const dd = st.dirty[id];
        if (!dd) { i++; continue; }
        let rec;
        if (dd.d) rec = { id, u: dd.u, d: 1 };
        else {
          const raw = await local.get(id);
          if (!raw) { delete st.dirty[id]; i++; continue; }                         // запись уже исчезла — отправлять нечего
          if (!raw.ct) throw new Error('not_encrypted');                            // открытые данные на сервер не отправляются никогда
          rec = { id, u: raw.u ?? dd.u, d: 0, v: raw.v ?? 1, iv: raw.iv, ct: raw.ct };
        }
        const size = (rec.ct?.length ?? 0) + 120;
        if (batch.length && bytes + size > BATCH_BYTES) break;
        batch.push(rec); bytes += size; i++;
      }
      if (!batch.length) continue;
      const res = await api.push(server, getToken(), batch);
      const stale = new Set((res.stale || []).map(s => s.id));
      for (const rec of batch) {
        const dd = st.dirty[rec.id];
        if (dd && dd.u === rec.u && !stale.has(rec.id)) delete st.dirty[rec.id];  // ушло; если за это время правили снова — остаётся
      }
      if (stale.size) needsPull = true;
      persist(); emit({});
    }
    return { needsPull };
  }

  // ---- один проход ----
  function syncOnce() {
    if (running) return running;
    running = (async () => {
      emit({ state: 'syncing', error: null });
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const metas = await local.metas();
          await pullAll(metas);
          const { needsPull } = await pushAll();
          if (!needsPull) break;
        }
        st.lastSyncAt = now(); persist();
        emit({ state: 'idle', lastSyncAt: st.lastSyncAt, error: null });
        return { ok: true };
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 401) { emit({ state: 'needs-login', error: e.code }); onUnauthorized(); }
          else if (e.status === 0) emit({ state: 'offline', error: e.code });
          else emit({ state: 'error', error: e.code, retryAfterMs: e.retryAfterMs });
        } else emit({ state: e?.name === 'LockedError' ? 'locked' : 'error', error: e?.message || String(e) });
        return { ok: false, error: e };
      } finally { running = null; }
    })();
    return running;
  }

  return {
    syncOnce, notifyWrite, markAllDirty,
    get status() { return status; },
    get since() { return st.since; },
    dirtyIds: () => Object.keys(st.dirty),
    resetCursor() { st.since = 0; persist(); },
    flush: persist,
  };
}
