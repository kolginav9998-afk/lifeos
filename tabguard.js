// Защита от двух одновременно открытых окон (вкладок): считаем соседей и сообщаем об их записях, чтобы данные в окнах не расходились.
// BroadcastChannel работает только внутри одного браузера и одного приложения. Ничего никуда не отправляет.
// Сколько других окон сейчас открыто (обновляет app.js; экраны только читают и слушают событие lifeos:tabs).
export const tabState = { others: 0 };

export function createTabGuard({ onOthers = () => {}, onRemoteWrite = () => {}, name = 'lifeos-tabs', ttl = 20000, ChannelCtor = globalThis.BroadcastChannel } = {}) {
  if (!ChannelCtor) return { count: () => 0, announceWrite() {}, stop() {} };
  const id = Math.random().toString(36).slice(2, 10), ch = new ChannelCtor(name), others = new Map();
  let lastCount = 0;
  const alive = () => { const now = Date.now(); for (const [k, t] of others) if (now - t > ttl) others.delete(k); return others.size; };
  const changed = () => { const n = alive(); if (n !== lastCount) { lastCount = n; onOthers(n); } };
  ch.onmessage = e => {
    const m = e?.data;
    if (!m || typeof m !== 'object' || m.id === id) return;
    if (m.type === 'hello') { others.set(m.id, Date.now()); ch.postMessage({ type: 'here', id }); }
    else if (m.type === 'here') others.set(m.id, Date.now());
    else if (m.type === 'bye') others.delete(m.id);
    else if (m.type === 'wrote') { others.set(m.id, Date.now()); onRemoteWrite(); }
    changed();
  };
  ch.postMessage({ type: 'hello', id });
  const beat = setInterval(() => { ch.postMessage({ type: 'here', id }); changed(); }, Math.max(1000, Math.floor(ttl / 3)));
  beat.unref?.();
  return {
    id, count: alive,
    announceWrite() { ch.postMessage({ type: 'wrote', id }); },
    stop() { clearInterval(beat); try { ch.postMessage({ type: 'bye', id }); } catch { /* канал уже закрыт */ } ch.close(); },
  };
}
