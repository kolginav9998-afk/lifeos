// Замер запуска для «О приложении»: сколько прошло от начала загрузки страницы до показа интерфейса и до загрузки данных.
const t = { shell: null, data: null };
const now = () => Math.round(performance.now());
export const markShell = () => { if (t.shell === null) t.shell = now(); };
export const markData = () => { if (t.data === null) t.data = now(); };
export const startup = () => ({ ...t });
export const startupText = (v = t) => {
  if (v.shell === null) return '';
  const ms = x => (x >= 1000 ? `${String(Math.round(x / 100) / 10).replace('.', ',')} с` : `${x} мс`);
  return `Запуск: интерфейс за ${ms(v.shell)}${v.data !== null ? `, данные за ${ms(v.data)}` : ''}`;
};
