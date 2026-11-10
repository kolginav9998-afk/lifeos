// Журнал последних ошибок: показывается в «Ещё → О приложении», чтобы на телефоне можно было просто сделать скриншот.
// Хранится только в памяти и никуда не отправляется.
export const log = [];

export function install() {
  const push = (kind, msg) => {
    log.push(`${new Date().toLocaleTimeString('ru')} ${kind}: ${String(msg ?? '').slice(0, 200)}`);
    if (log.length > 8) log.shift();
  };
  addEventListener('error', e => push('ошибка', e.message || e.error));
  addEventListener('unhandledrejection', e => push('отказ', e.reason?.message || e.reason));
}
