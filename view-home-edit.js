// Окно «Добавить вещь» и «Изменить вещь». Обязательны только название и вид; всё остальное лежит в разделе «Ещё параметры».
// Из подробностей сюда же приходит «Копировать вещь»: поля заполнены, остаётся поправить, что отличается.
import { el, fill, icon, toast, announce } from './ui.js';
import * as store from './store.js';
import { KINDS, STATUS_LABEL, HOW_LABEL, TEMPLATES, makeItem, updateItem, fieldsOf, templateFields, defaultCare, parsePrice, placesOf, newItemId } from './home.js';

const money = minor => (minor === null || minor === undefined ? '' : String(minor / 100).replace('.', ','));
const opts = pairs => pairs.map(([v, t]) => el('option', { value: v, textContent: t }));

export function createEditWindow(H) {
  const host = el('div', { id: 'hm-edit', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Вещь' });
  let mode = 'add', item = null, careTouched = false, F = {}, more = null, err = null;

  const field = (label, input) => el('label', { class: 'field' }, el('span', { textContent: label }), input);
  const text = (name, label, { max = 40, list, ph = '', inputMode } = {}) => {
    const i = el('input', { id: `hm-f-${name}`, type: 'text', maxLength: max, autocomplete: 'off', placeholder: ph, inputMode });
    if (list) i.setAttribute('list', list);
    F[name] = i;
    return field(label, i);
  };
  const num = (name, label, min, max) => { const i = el('input', { id: `hm-f-${name}`, type: 'number', inputMode: 'numeric', min, max, step: 1 }); F[name] = i; return field(label, i); };
  const date = (name, label) => { const i = el('input', { id: `hm-f-${name}`, type: 'date' }); F[name] = i; return field(label, i); };
  const select = (name, label, pairs) => { const s = el('select', { id: `hm-f-${name}` }, ...opts(pairs)); F[name] = s; return field(label, s); };

  const setValues = f => {
    const c = f.care ?? defaultCare(f.kind ?? 'clothes');
    const v = { name: f.name ?? '', kind: f.kind ?? 'clothes', place: f.place ?? '', brand: f.brand ?? '', color: f.color ?? '', size: f.size ?? '', material: f.material ?? '', qty: f.qty && f.qty !== 1 ? String(f.qty) : '', price: money(f.priceMinor),
      bought: f.bought ?? '', warranty: f.warranty ?? '', how: c.how, temp: c.temp ?? '', wears: c.washEveryWears ?? '', days: c.washEveryDays ?? '', status: f.status ?? 'active', tags: (f.tags ?? []).join(', '), note: f.note ?? '' };
    for (const [k, x] of Object.entries(v)) F[k].value = String(x);
    syncCare();
  };
  function syncCare() { const none = F.how.value === 'none'; for (const k of ['temp', 'wears', 'days']) F[k].disabled = none; }
  const hasExtra = f => ['place', 'brand', 'color', 'size', 'material', 'bought', 'warranty', 'note'].some(k => f[k]) || (f.tags ?? []).length > 0 || f.priceMinor !== null && f.priceMinor !== undefined || (f.qty ?? 1) > 1;

  function collect() {
    const v = k => F[k].value, none = v('how') === 'none';
    return { name: v('name'), kind: v('kind'), place: v('place'), brand: v('brand'), color: v('color'), size: v('size'), material: v('material'), qty: v('qty') === '' ? 1 : v('qty'), bought: v('bought'), warranty: v('warranty'),
      priceMinor: parsePrice(v('price')), status: v('status'), tags: v('tags'), note: v('note'), care: { how: v('how'), temp: none ? null : v('temp'), washEveryWears: none ? null : v('wears'), washEveryDays: none ? null : v('days') } };
  }
  function close() { host.hidden = true; fill(host); item = null; }
  const busy = on => { for (const b of host.querySelectorAll('button[type=submit], #hm-save-more')) b.disabled = on; };

  async function save(again) {
    try {
      const f = collect();
      let ev;
      if (mode === 'edit') ev = updateItem(item, f);
      else { let t = Date.now(); while (store.get(newItemId(t))) t++; ev = makeItem(f, t); }
      err.textContent = '';
      const name = ev.payload.name, edited = mode === 'edit';
      busy(true);
      await store.save(ev);
      busy(false);
      if (!again) close();
      toast(edited ? 'Сохранено' : `Добавлено: «${name}»`, edited ? {} : { actionLabel: 'Отменить', onAction: () => store.remove(ev.id) });
      if (again) { const keep = { kind: F.kind.value, place: F.place.value }; setValues({ ...keep }); careTouched = false; F.name.focus(); announce(`Добавлено: ${name}. Можно записать следующую вещь.`); }
    } catch (x) {
      busy(false);
      err.textContent = x.message;
      if (/название|вид вещи/.test(x.message)) F.name.focus(); else { more.open = true; err.scrollIntoView?.({ block: 'nearest' }); }       // ошибка может быть в спрятанном поле
    }
  }

  function open(existing, preset) {
    mode = existing ? 'edit' : 'add'; item = existing; careTouched = false; F = {};
    const first = existing ? fieldsOf(existing) : preset ?? {};
    const title = existing ? 'Изменить вещь' : preset ? 'Копия вещи' : 'Новая вещь';
    host.setAttribute('aria-label', title);
    err = el('p', { class: 'error', id: 'hm-edit-err', role: 'alert' });
    const name = text('name', 'Название', { max: 80, ph: 'Например: куртка зимняя' });
    F.name.required = true; F.name.setAttribute('aria-required', 'true');
    const kind = select('kind', 'Вид вещи', KINDS), note = el('textarea', { id: 'hm-f-note', rows: 3, maxLength: 500 });
    F.note = note;
    F.kind.onchange = () => { if (mode === 'add' && !careTouched) { const c = defaultCare(F.kind.value); F.how.value = c.how; F.temp.value = c.temp ?? ''; F.wears.value = c.washEveryWears ?? ''; F.days.value = c.washEveryDays ?? ''; syncCare(); } };
    const places = el('datalist', { id: 'hm-places' }, ...placesOf(H.model().items).map(p => el('option', { value: p })));
    const how = select('how', 'Способ ухода', Object.entries(HOW_LABEL));
    const care = el('fieldset', { class: 'hm-care' }, el('legend', { textContent: 'Как стирать' }), how, el('div', { class: 'hm-grid' }, num('temp', 'Температура, °C', 0, 95), num('wears', 'Стирать после (надеваний)', 1, 365), num('days', 'Стирать раз в (дней)', 1, 365)));
    for (const k of ['how', 'temp', 'wears', 'days']) F[k].addEventListener('change', () => { careTouched = true; });
    F.how.addEventListener('change', syncCare);
    more = el('details', { id: 'hm-more', class: 'card hm-more' }, el('summary', { textContent: 'Ещё параметры' }),
      text('place', 'Где лежит', { max: 60, list: 'hm-places', ph: 'Шкаф, комод, балкон…' }), places,
      el('div', { class: 'hm-grid' }, text('brand', 'Бренд'), text('color', 'Цвет', { max: 30 }), text('size', 'Размер', { max: 20 }), text('material', 'Материал'), num('qty', 'Количество', 1, 9999), text('price', 'Цена, ₽ (за всё количество)', { max: 14, inputMode: 'decimal' }), date('bought', 'Куплено'), date('warranty', 'Гарантия до')),
      care, select('status', 'Состояние', Object.entries(STATUS_LABEL)), text('tags', 'Метки через запятую', { max: 120, ph: 'зима, работа' }),
      field('Заметка', note));
    const chips = !existing && !preset ? el('div', { class: 'hm-tpl' }, el('p', { class: 'muted', textContent: 'Быстрый старт: подставит название и правила стирки.' }),
      el('div', { class: 'chips' }, ...TEMPLATES.map(t => el('button', { type: 'button', class: 'chip', textContent: t.label, onclick: () => { const f = templateFields(t.key); setValues({ ...f }); careTouched = true; more.open = true; F.name.focus(); F.name.select(); announce(`Подставлено: ${t.label}. Поправь, что нужно, и нажми «Сохранить».`); } })))) : null;
    const saveBtn = el('button', { type: 'submit', id: 'hm-save', class: 'primary big-btn', textContent: existing ? 'Сохранить' : 'Добавить вещь' });
    const again = !existing ? el('button', { type: 'button', id: 'hm-save-more', class: 'big-btn', textContent: 'Сохранить и добавить ещё', onclick: () => save(true) }) : null;
    const form = el('form', { class: 'form-stack hm-form', noValidate: true }, name, kind, chips, more, err, saveBtn, again);
    form.onsubmit = e => { e.preventDefault(); save(false); };
    fill(host, el('div', { class: 'sess-top' }, el('strong', { textContent: title }), el('button', { type: 'button', id: 'hm-edit-close', class: 'chip', textContent: 'Закрыть', onclick: close })), form);
    setValues(first);
    more.open = !!existing || (!!preset && hasExtra(first));
    host.scrollTop = 0;
    host.hidden = false;
    F.name.focus({ preventScroll: true });
    if (existing) F.name.select?.();
  }
  return { root: host, open, close };
}
