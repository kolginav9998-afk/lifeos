// Окно подробностей вещи: счётчики, все параметры, история отметок, правка, копирование, состояние (на хранении, продано, выброшено) и удаление с подтверждением.
import { el, fill, icon, toast, dateRu, moneyText, focusNode } from './ui.js';
import * as store from './store.js';
import { STATUS_LABEL, KIND_LABEL, LOG_NOUN, quickLogs, logButton, statsLine, careOf, careText, washProgress, ageText, timesText, plural, makeLog, newLogId, moveItem, updateItem, fieldsOf, lastLog } from './home.js';

const LOG_ORDER = ['wear', 'use', 'wash', 'water', 'repair', 'move', 'note'];

export function createDetailWindow(H) {
  const host = el('div', { id: 'hm-detail', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Вещь' });
  let openId = null, confirming = false, showAll = false;

  const stamp = item => { let t = Date.now(); while (store.get(newLogId(item.id, t))) t++; return t; };
  const fk = (id, k) => ({ fk: `${id}|${k}` });

  // Форма «Добавить запись в историю» создаётся один раз на открытие окна: при обновлении данных набранное не пропадает.
  const kindSel = el('select', { id: 'hm-log-kind' }), dateIn = el('input', { id: 'hm-log-date', type: 'date' }), placeIn = el('input', { id: 'hm-log-place', type: 'text', maxLength: 60, autocomplete: 'off' });
  const noteIn = el('input', { id: 'hm-log-note', type: 'text', maxLength: 200, autocomplete: 'off' }), logErr = el('p', { class: 'error', role: 'alert' });
  const placeField = el('label', { class: 'field', hidden: true }, el('span', { textContent: 'Новое место' }), placeIn);
  kindSel.onchange = () => { placeField.hidden = kindSel.value !== 'move'; };
  const logForm = el('form', { class: 'form-stack', noValidate: true }, el('label', { class: 'field' }, el('span', { textContent: 'Что произошло' }), kindSel), el('label', { class: 'field' }, el('span', { textContent: 'Когда (если не сегодня)' }), dateIn),
    placeField, el('label', { class: 'field' }, el('span', { textContent: 'Заметка' }), noteIn), logErr, el('button', { type: 'submit', id: 'hm-log-save', class: 'primary', textContent: 'Добавить в историю' }));
  const logBox = el('details', { id: 'hm-addlog', class: 'card' }, el('summary', { textContent: 'Добавить запись в историю' }), logForm);
  logForm.onsubmit = async e => {
    e.preventDefault();
    const item = H.model().byId.get(openId);
    if (!item) return;
    try {
      const date = dateIn.value || undefined, note = noteIn.value, now = stamp(item);
      if (kindSel.value === 'move') { if (!placeIn.value.trim()) throw new Error('Напиши, куда переложил(а)'); const r = moveItem(item, placeIn.value, now, { date, note }); await store.saveMany([r.item, r.log]); }
      else await store.save(makeLog(item, kindSel.value, { date, note }, now));
      logErr.textContent = ''; noteIn.value = ''; placeIn.value = ''; dateIn.value = '';
      toast('Записано в историю');
    } catch (x) { logErr.textContent = x.message; }
  };

  function close() { openId = null; confirming = false; host.hidden = true; fill(host); }
  function open(id) {
    openId = id; confirming = false; showAll = false; logBox.open = false; logErr.textContent = '';
    const kind = H.model().byId.get(id)?.payload.kind;
    fill(kindSel, ...LOG_ORDER.map(k => el('option', { value: k, textContent: logButton(k, kind) })));
    kindSel.value = quickLogs(kind)[0] ?? 'note'; kindSel.onchange();
    dateIn.max = H.model().today;
    host.hidden = false;
    render(H.model());
    host.scrollTop = 0;
    focusNode(host.querySelector('.hm-title'));
  }

  async function setStatus(item, status) {
    const old = item;
    await store.save(updateItem(item, { status }));
    toast(`«${item.payload.name}»: ${STATUS_LABEL[status].toLowerCase()}`, { actionLabel: 'Отменить', onAction: () => store.save(old) });
  }
  async function remove(item, logs) {
    close();
    const gone = await store.removeMany([item.id, ...logs.map(l => l.id)]);
    toast(`Удалено: «${item.payload.name}»`, { actionLabel: 'Вернуть', onAction: () => store.saveMany(gone) });
  }

  function render(m) {
    if (!openId) return;
    const item = m.byId.get(openId);
    if (!item) { close(); return; }
    const p = item.payload, s = m.stats.get(item.id), logs = m.logs.get(item.id), c = careOf(p), acts = quickLogs(p.kind), washable = acts.includes('wash') && c.how !== 'none';
    const top = host.scrollTop, dt = d => (d.slice(0, 4) === m.today.slice(0, 4) ? dateRu(d) : `${dateRu(d)} ${d.slice(0, 4)}`);
    host.setAttribute('aria-label', `Вещь: ${p.name}`);
    const btn = (k, label, onclick, cls = '', ic = null) => el('button', { type: 'button', class: cls, dataset: fk(item.id, k), onclick }, ic ? icon(ic, 18) : null, label);
    const w = washable ? washProgress(item, s) : null;
    const meter = w ? el('div', { class: `progress thin${s.needsWash ? ' warn' : ''}`, 'aria-hidden': 'true' }, el('span')) : null;
    meter?.firstChild.style.setProperty('--w', `${Math.round(Math.min(1, w.fraction) * 100)}%`);
    const verb = acts.includes('wear') ? 'надето' : 'использовано', use = acts.includes('wear') ? 'надевание' : 'использование';
    const lines = [el('p', { textContent: statsLine(s, p.kind) }), !w && washable ? el('p', { textContent: `С последней стирки ${verb}: ${timesText(s.wearsSinceWash)}` }) : null,
      w ? el('p', { textContent: `${w.text}${s.needsWash ? ' · пора стирать' : ''}` }) : null, meter, s.lastWorn ? el('p', { textContent: `Последний раз ${verb}: ${dt(s.lastWorn)}` }) : null,
      washable ? el('p', { textContent: s.lastWashed ? `Последняя стирка: ${dt(s.lastWashed)}` : 'Ещё не стирали' }) : null, el('p', { textContent: `У тебя уже: ${ageText(s.ageDays)}` }),
      s.costPerWear !== null ? el('p', { textContent: `Цена за одно ${use}: ${moneyText(s.costPerWear)}` }) : null].filter(x => x && x.textContent !== '');
    const params = [['Вид', KIND_LABEL[p.kind]], ['Состояние', STATUS_LABEL[p.status]], ['Где лежит', p.place], ['Бренд', p.brand], ['Цвет', p.color], ['Размер', p.size], ['Материал', p.material], ['Количество', p.qty > 1 ? `${p.qty} шт.` : ''],
      ['Куплено', p.bought ? dt(p.bought) : ''], ['Цена', p.priceMinor !== null && p.priceMinor !== undefined ? moneyText(p.priceMinor) : ''], ['Гарантия до', p.warranty ? dt(p.warranty) : ''], ['Уход', acts.includes('wash') || c.how !== 'none' ? careText(c) : ''],
      ['Действует до', p.validUntil ? dt(p.validUntil) : ''], ['Съесть до', p.useBy ? dt(p.useBy) : ''],
      ['Полив', Number.isInteger(p.waterEveryDays) ? `раз в ${p.waterEveryDays} ${plural(p.waterEveryDays, 'день', 'дня', 'дней')}` : ''],
      ['Обслуживание', Number.isInteger(p.serviceEveryDays) ? `раз в ${p.serviceEveryDays} ${plural(p.serviceEveryDays, 'день', 'дня', 'дней')}` : ''],
      ['«Кончается» при остатке', Number.isInteger(p.lowAt) ? `${p.lowAt} шт.` : ''],
      ['Метки', (p.tags ?? []).join(', ')], ['Заметка', p.note]].filter(([, v]) => v);
    const shown = showAll ? logs : logs.slice(0, 12), last = lastLog(logs);
    const hist = logs.length ? [el('ul', { class: 'hm-hist' }, ...shown.map(l => {
      const what = `${LOG_NOUN[l.payload.kind] ?? l.payload.kind}${l.payload.place ? `: ${l.payload.place}` : ''}`;
      return el('li', { class: 'hm-hrow' }, el('span', { class: 'hm-hd', textContent: dt(l.payload.date) }), el('span', { class: 'hm-hk', textContent: l.payload.note ? `${what} · ${l.payload.note}` : what }),
        el('button', { type: 'button', class: 'icon-btn hm-hdel', 'aria-label': `Удалить запись: ${what}, ${dt(l.payload.date)}`, dataset: fk(item.id, `del-${l.id}`),
          onclick: async () => { const old = await store.remove(l.id); toast('Запись удалена', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }, icon('x', 18)));
    })), logs.length > 12 ? btn('all', showAll ? 'Показать меньше' : `Показать все (${logs.length})`, () => H.keep(() => { showAll = !showAll; render(H.model()); }), 'chip') : null,
    btn('undo', 'Отменить последнюю запись', async () => { const old = await store.remove(last.id); toast('Последняя запись отменена', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); }, 'chip', 'undo')]
      : [el('p', { class: 'muted', textContent: 'Записей пока нет. Нажми «Надел» или «Постирал» — они появятся здесь.' })];
    const states = p.status === 'active' ? [['stored', 'Убрать на хранение'], ['sold', 'Продал(а)'], ['gone', 'Выбросил(а) или потерял(а)']] : [['active', 'Вернуть в использование']];
    const sure = confirming ? el('div', { class: 'card hm-confirm', role: 'group', 'aria-label': 'Подтверждение удаления' }, el('p', { textContent: `Удалить «${p.name}» и всю историю (${logs.length} ${plural(logs.length, 'запись', 'записи', 'записей')})?` }),
      el('div', { class: 'row wrap' }, btn('yes', 'Да, удалить', () => remove(item, logs), 'danger'), btn('no', 'Нет, оставить', () => H.keep(() => { confirming = false; render(H.model()); }))))
      : btn('del', 'Удалить вещь…', () => H.keep(() => { confirming = true; render(H.model()); }), 'chip danger', 'trash');
    fill(host,
      el('div', { class: 'sess-top' }, el('span', { class: 'muted', textContent: KIND_LABEL[p.kind] }), el('button', { type: 'button', id: 'hm-detail-close', class: 'chip', textContent: 'Закрыть', onclick: close })),
      el('h3', { class: 'hm-title', tabIndex: -1, textContent: p.qty > 1 ? `${p.name} × ${p.qty}` : p.name }),
      acts.length && ['active', 'stored'].includes(p.status) ? el('div', { class: 'hm-quick' }, ...acts.map((k, i) => btn(k, logButton(k, p.kind), () => H.mark([item], k), `hm-q${i === 0 ? ' primary' : ''}`, k === 'wash' ? 'sync' : 'check'))) : null,
      el('section', { class: 'card hm-lines' }, el('h2', { class: 'hm-h', textContent: 'Сколько раз' }), ...lines),
      el('section', { class: 'card' }, el('h2', { class: 'hm-h', textContent: 'Параметры' }), el('dl', { class: 'hm-dl' }, ...params.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]))),
      el('section', { class: 'card' }, el('h2', { class: 'hm-h', textContent: 'История' }), ...hist),
      logBox,
      el('div', { class: 'hm-actions' }, btn('edit', 'Изменить', () => H.openEdit(item), 'primary', 'edit'), btn('copy', 'Копировать вещь', () => H.openEdit(null, fieldsOf(item)), '', 'copy')),
      el('section', { class: 'card' }, el('h2', { class: 'hm-h', textContent: 'Состояние вещи' }), el('div', { class: 'row wrap' }, ...states.map(([k, t]) => btn(`st-${k}`, t, () => setStatus(item, k), 'chip')))),
      sure);
    host.scrollTop = top;
  }
  return { root: host, open, close, render };
}
