// Вкладка «Настройки» экрана «Зарплата»: оплата, переработки, налог (готовые примеры и своя таблица), надбавки, удержания, отпуск и больничный, выплаты. Дочерний блок.
// Форма одна, сохраняется одной кнопкой; введённое не пропадает, пока не изменятся сами настройки.
import { el, fill, toast, announce } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { cfgFromTemplate, makeWorkcfg, cfgOf, normMinutes, fmtDur } from './schedule.js';
import { monthLabel } from './money.js';
import { makePaycfg, payEvent, normalizePay, parseMinor, parseMult, minorToInput, ROUNDING, roundingId, CURRENCIES, DISCLAIMER } from './salary.js';
import { TAX_PRESETS, presetTax, parsePercent, describeTax, MAX_BRACKETS } from './salary-tax.js';

const lab = (text, input, hint) => { const t = el('span', { class: 'muted', textContent: text }), l = el('label', { class: 'work-f' }, t, input, hint ? el('span', { class: 'muted', textContent: hint }) : null); l.t = t; return l; };
const txt = (id, props = {}) => el('input', { id, type: 'text', inputMode: 'decimal', autocomplete: 'off', ...props });
const sel = (id, opts) => el('select', { id }, ...opts.map(([v, t]) => el('option', { value: v, textContent: t })));
const need = (label, fn) => { try { return fn(); } catch (e) { throw new Error(`${label}: ${e.message}`); } };
const whole = (label, input, lo, hi) => { const t = input.value.trim().replace(',', '.'), n = t === '' ? 0 : Number(t); if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${label}: целое число от ${lo} до ${hi}`); return n; };
const num = v => String(v).replace('.', ',');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Налог в виде, удобном для полей (строки), и обратно.
const taxToDraft = t => (t.kind === 'flat' ? { kind: 'flat', rate: num(t.rateBp / 100), basis: 'annual', rows: [] }
  : { kind: 'brackets', rate: '13', basis: t.basis, rows: t.brackets.map(b => ({ upTo: b.upToMinor === null ? '' : minorToInput(b.upToMinor), rate: num(b.rateBp / 100) })) });
const presetIdOf = t => TAX_PRESETS.find(p => same(p.tax, t))?.pid ?? (t.kind === 'brackets' ? 'own' : 'flat');

// Список строк «название + сумма или процент» (надбавки и удержания).
function listEditor({ id, title, hint, pctText, withWhen }) {
  let rows = [];
  const box = el('div', { id: `${id}-rows`, class: 'form-stack' }), add = el('button', { type: 'button', id: `${id}-add`, class: 'chip', textContent: 'Добавить строку', onclick: () => { rows.push({ name: '', value: '', unit: 'rub', taxable: true, when: 'after' }); paint(); box.lastElementChild?.querySelector('input')?.focus(); } });
  function paint() {
    add.disabled = rows.length >= 12;
    fill(box, rows.map((r, i) => {
      const inp = (key, props) => el('input', { ...props, value: r[key], autocomplete: 'off', oninput: e => { r[key] = e.target.value; } });
      const unit = el('select', { onchange: e => { r.unit = e.target.value; } }, el('option', { value: 'rub', textContent: 'в деньгах', selected: r.unit === 'rub' }), el('option', { value: 'pct', textContent: pctText, selected: r.unit === 'pct' }));
      const extra = withWhen ? el('select', { 'aria-label': 'Когда удерживается', onchange: e => { r.when = e.target.value; } }, el('option', { value: 'after', textContent: 'после налога', selected: r.when === 'after' }), el('option', { value: 'before', textContent: 'до налога: уменьшает налог', selected: r.when === 'before' }))
        : el('label', { class: 'check-label' }, el('input', { type: 'checkbox', checked: r.taxable, onchange: e => { r.taxable = e.target.checked; } }), ' Облагается налогом');
      return el('fieldset', { class: 'work-shift-row' }, el('legend', { textContent: `${title}: строка ${i + 1}` }), el('div', { class: 'two' }, lab('Название', inp('name', { type: 'text', maxLength: 40 })), lab('Сумма или процент', inp('value', { type: 'text', inputMode: 'decimal' }))), unit, extra,
        el('button', { type: 'button', class: 'chip danger', textContent: 'Убрать строку', 'aria-label': `Убрать строку ${i + 1}: ${title}`, onclick: () => { rows.splice(i, 1); paint(); add.focus(); } }));
    }));
  }
  const root = el('details', { id, class: 'card' }, el('summary', { textContent: title }), el('div', { class: 'form-stack' }, el('p', { class: 'muted', textContent: hint }), box, add));
  return {
    root, load(list) { rows = list.map(a => ({ name: a.name, value: a.pctBp ? num(a.pctBp / 100) : minorToInput(a.amountMinor), unit: a.pctBp ? 'pct' : 'rub', taxable: a.taxable !== false, when: a.when === 'before' ? 'before' : 'after' })); paint(); },
    collect: () => rows.filter(r => r.name.trim() || r.value.trim()).map(r => {
      if (!r.name.trim()) throw new Error(`${title}: назови строку`);
      return { name: r.name, ...(r.unit === 'pct' ? { pctBp: need(`«${r.name}»`, () => parsePercent(r.value)) } : { amountMinor: need(`«${r.name}»`, () => parseMinor(r.value)) }), ...(withWhen ? { when: r.when } : { taxable: r.taxable }) };
    }),
  };
}

export function createSettingsPanel({ events, go }) {
  let lastSig = '', tax = taxToDraft(presetTax('flat'));
  const mode = sel('sal-s-mode', [['salary', 'Оклад в месяц'], ['hourly', 'Ставка за час']]), base = txt('sal-s-base', { placeholder: 'Например, 100000' }), baseL = lab('', base);
  const cur = sel('sal-s-cur', Object.entries(CURRENCIES).map(([c, s]) => [c, `${s} ${c}`])), hourly = txt('sal-s-hourly', { placeholder: 'пусто — оклад ÷ норма часов' }), hourlyL = lab('Ставка за час для переработок', hourly, 'Если пусто, считаю так: оклад ÷ норма часов месяца.');
  const normInfo = el('p', { id: 'sal-s-norm', class: 'muted' });
  const otBasis = sel('sal-s-otbasis', [['day', 'За каждый день: минуты сверх плановой смены'], ['month', 'За месяц: минуты сверх нормы часов']]), otMult = txt('sal-s-otmult', { placeholder: '2' }), ot1min = txt('sal-s-ot1min', { inputMode: 'numeric', placeholder: '0' }), ot1mult = txt('sal-s-ot1mult', { placeholder: '1,5' });
  const otRound = sel('sal-s-otround', ROUNDING.map(r => [r.rid, r.label]));
  const taxPreset = sel('sal-s-taxpreset', TAX_PRESETS.map(p => [p.pid, p.title])), taxRate = txt('sal-s-taxrate', { placeholder: '13', oninput: () => { tax.rate = taxRate.value; paintTaxNow(); } });
  const taxBasis = sel('sal-s-taxbasis', [['annual', 'Пороги за год (с начала года)'], ['monthly', 'Пороги за каждый месяц отдельно']]), taxFree = txt('sal-s-taxfree', { placeholder: '0' }), taxNow = el('p', { id: 'sal-s-taxnow', class: 'muted' });
  const flatBox = lab('Ставка налога, %', taxRate), brBox = el('div', { id: 'sal-s-brackets', class: 'form-stack' }), brRows = el('div', { class: 'form-stack' });
  const brAdd = el('button', { type: 'button', id: 'sal-s-bradd', class: 'chip', textContent: 'Добавить ступень', onclick: () => { tax.rows.splice(tax.rows.length - 1, 0, { upTo: '', rate: '' }); paintBr(); } });
  brBox.append(lab('Как считать пороги', taxBasis), brRows, brAdd);
  const allow = listEditor({ id: 'sal-s-allow', title: 'Надбавки и премии', hint: 'Постоянные доплаты каждый месяц: за вредность, классность, проезд. Процент считается от оклада (или от заработанного по ставке). Разовую премию месяца вноси на вкладке «Расчёт».', pctText: '% от оклада', withWhen: false });
  const deduct = listEditor({ id: 'sal-s-deduct', title: 'Удержания', hint: 'Что вычитается из зарплаты: профсоюз, кредит, алименты. «До налога» значит, что удержание уменьшает и налоговую базу. Процент считается от начисленного.', pctText: '% от начисленного', withWhen: true });
  const vac = txt('sal-s-vac', { inputMode: 'numeric' }), sick = txt('sal-s-sick', { inputMode: 'numeric' }), unp = txt('sal-s-unp', { inputMode: 'numeric' }), night = txt('sal-s-night', { inputMode: 'numeric', placeholder: '0' });
  const advDay = txt('sal-s-advday', { inputMode: 'numeric', placeholder: '0' }), advPct = txt('sal-s-advpct', { inputMode: 'numeric' }), salDay = txt('sal-s-salday', { inputMode: 'numeric', placeholder: '0' });
  const err = el('p', { id: 'sal-s-err', class: 'error' });

  const sec = (id, title, ...kids) => el('details', { id, class: 'card', open: true }, el('summary', { textContent: title }), el('div', { class: 'form-stack' }, ...kids));
  const form = el('form', { id: 'sal-s-form', class: 'form-stack' },
    sec('sal-s-pay', 'Оплата', lab('Как платят', mode), baseL, lab('Валюта', cur), hourlyL, normInfo, el('button', { type: 'button', id: 'sal-s-gosch', class: 'chip', textContent: 'Открыть график и норму часов', onclick: () => go?.('schedule') })),
    sec('sal-s-ot', 'Переработки', el('p', { class: 'muted', textContent: 'Переработки считаются по минутам и оплачиваются по коэффициенту от часовой ставки. Например, коэффициент 2 — вдвое.' }), lab('Что считать переработкой', otBasis), lab('Коэффициент (например, 2)', otMult),
      el('div', { class: 'two' }, lab('Первые минуты по другому коэффициенту: сколько (0 — не нужно)', ot1min), lab('Коэффициент для первых минут', ot1mult)), lab('Округление минут переработки', otRound)),
    sec('sal-s-tax', 'Налог', el('p', { class: 'muted', textContent: 'Готовые наборы — только примеры, не справка: ставки и пороги проверь для своей страны и года и поправь. Налог на самом деле удерживает работодатель.' }),
      lab('Начать с примера', taxPreset), flatBox, brBox, lab('Необлагаемая сумма в месяц (вычет), до налога', taxFree, 'Эта сумма не облагается налогом (если у тебя есть такой вычет). Если нет, оставь пустым.'), taxNow),
    allow.root, deduct.root,
    sec('sal-s-leave', 'Отпуск, больничный, ночные', el('p', { class: 'muted', textContent: 'Сколько процентов обычной оплаты получает день отпуска, больничного или «за свой счёт». Больничные обычно платит не работодатель, поэтому по умолчанию 0.' }),
      el('div', { class: 'two' }, lab('Отпуск, % оплаты', vac), lab('Больничный, % оплаты', sick)), lab('За свой счёт, % оплаты', unp), lab('Доплата за ночные часы (22:00–06:00), % к ставке (0 — нет)', night)),
    sec('sal-s-paydays', 'Выплаты', el('p', { class: 'muted', textContent: 'Нужны, чтобы показать, когда ждать аванс и остаток. Ставь 0, если не нужно.' }), el('div', { class: 'two' }, lab('День аванса в месяце (0 — нет)', advDay), lab('Аванс, % от суммы на руки', advPct)), lab('День выплаты остатка в следующем месяце (0 — нет)', salDay)),
    err, el('button', { type: 'submit', id: 'sal-s-save', class: 'primary', textContent: 'Сохранить настройки' }), el('p', { class: 'muted', textContent: DISCLAIMER }));
  const root = el('div', { id: 'sal-set', class: 'form-stack' }, form);

  function paintBr() {
    const n = tax.rows.length;
    fill(brRows, tax.rows.map((r, i) => el('div', { class: 'two work-br' }, i < n - 1 ? lab(`Ступень ${i + 1}: до суммы`, el('input', { type: 'text', inputMode: 'decimal', autocomplete: 'off', value: r.upTo, oninput: e => { r.upTo = e.target.value; } })) : el('p', { class: 'muted', textContent: `Ступень ${i + 1}: всё, что выше` }),
      lab(`Ступень ${i + 1}: ставка, %`, el('input', { type: 'text', inputMode: 'decimal', autocomplete: 'off', value: r.rate, oninput: e => { r.rate = e.target.value; paintTaxNow(); } })),
      n > 1 ? el('button', { type: 'button', class: 'chip danger', textContent: 'Убрать ступень', 'aria-label': `Убрать ступень ${i + 1}`, onclick: () => { tax.rows.splice(i, 1); if (!tax.rows.length) tax.rows.push({ upTo: '', rate: '' }); paintBr(); brAdd.focus(); } }) : null)));
    brAdd.disabled = n >= MAX_BRACKETS;
  }
  function collectTax() {
    if (tax.kind === 'flat') return { kind: 'flat', rateBp: need('Ставка налога', () => parsePercent(tax.rate)) };
    const n = tax.rows.length;
    return { kind: 'brackets', basis: tax.basis, brackets: tax.rows.map((r, i) => ({ upToMinor: i === n - 1 ? null : need(`Ступень ${i + 1}: порог`, () => parseMinor(r.upTo)), rateBp: need(`Ступень ${i + 1}: ставка`, () => parsePercent(r.rate)) })) };
  }
  function paintTaxNow() { try { taxNow.textContent = `Сейчас: ${describeTax(collectTax())}.`; } catch { taxNow.textContent = ''; } }
  function paintTax() { flatBox.hidden = tax.kind !== 'flat'; brBox.hidden = tax.kind !== 'brackets'; taxBasis.value = tax.basis; taxRate.value = tax.rate; if (tax.kind === 'brackets') paintBr(); paintTaxNow(); }
  taxPreset.onchange = () => { tax = taxToDraft(presetTax(taxPreset.value)); paintTax(); announce(TAX_PRESETS.find(p => p.pid === taxPreset.value).title); };
  taxBasis.onchange = () => { tax.basis = taxBasis.value; paintTaxNow(); };
  const paintMode = () => { baseL.t.textContent = mode.value === 'hourly' ? 'Ставка за час, до налога' : 'Оклад в месяц, до налога'; hourlyL.hidden = mode.value === 'hourly'; };
  mode.onchange = paintMode;

  function load(p) {
    mode.value = p.mode; base.value = p.baseMinor ? minorToInput(p.baseMinor) : ''; cur.value = p.currency; hourly.value = p.hourlyMinor ? minorToInput(p.hourlyMinor) : '';
    otBasis.value = p.ot.basis; otMult.value = num(p.ot.multMille / 1000); ot1min.value = p.ot.tier1Min || ''; ot1mult.value = num(p.ot.tier1MultMille / 1000); otRound.value = roundingId(p.ot);
    tax = taxToDraft(p.tax); taxPreset.value = presetIdOf(p.tax); taxFree.value = p.taxFreeMinor ? minorToInput(p.taxFreeMinor) : ''; allow.load(p.allowances); deduct.load(p.deductions);
    vac.value = p.leavePct.vacation; sick.value = p.leavePct.sick; unp.value = p.leavePct.unpaid; night.value = p.nightPct || ''; advDay.value = p.advance.day || ''; advPct.value = p.advance.pct; salDay.value = p.salaryDay || '';
    paintMode(); paintTax();
  }
  function collect() {
    const hourlyMode = mode.value === 'hourly', rnd = ROUNDING.find(r => r.rid === otRound.value);
    return {
      mode: mode.value, baseMinor: need(hourlyMode ? 'Ставка за час' : 'Оклад', () => parseMinor(base.value)), currency: cur.value,
      hourlyMinor: !hourlyMode && hourly.value.trim() ? need('Ставка за час для переработок', () => parseMinor(hourly.value)) : 0,
      ot: { basis: otBasis.value, multMille: need('Коэффициент переработки', () => parseMult(otMult.value)), tier1Min: whole('Первые минуты', ot1min, 0, 1440), tier1MultMille: ot1mult.value.trim() ? need('Коэффициент для первых минут', () => parseMult(ot1mult.value)) : 1500, roundMin: rnd.roundMin, roundDir: rnd.roundDir },
      tax: collectTax(), taxFreeMinor: taxFree.value.trim() ? need('Необлагаемая сумма', () => parseMinor(taxFree.value, true)) : 0, allowances: allow.collect(), deductions: deduct.collect(),
      leavePct: { vacation: whole('Отпуск', vac, 0, 100), sick: whole('Больничный', sick, 0, 100), unpaid: whole('За свой счёт', unp, 0, 100) }, nightPct: whole('Ночная доплата', night, 0, 100),
      advance: { day: whole('День аванса', advDay, 0, 31), pct: whole('Процент аванса', advPct, 0, 100) }, salaryDay: whole('День выплаты остатка', salDay, 0, 31),
    };
  }
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      err.textContent = '';
      const evs = [makePaycfg(collect(), payEvent(events()))];
      if (!cfgOf(events())) evs.unshift(makeWorkcfg(cfgFromTemplate('w52', todayStr())));          // без графика нет нормы часов: ставлю «5 через 2», его можно изменить в «Графике»
      await store.saveMany(evs); toast('Настройки зарплаты сохранены'); announce('Настройки зарплаты сохранены');
    } catch (x) { err.textContent = x.message; announce(x.message, { assertive: true }); }
  };
  return {
    root,
    render(s) {
      const p = s.pay ?? normalizePay({}), sig = JSON.stringify(p);
      if (sig !== lastSig) { lastSig = sig; load(p); }
      normInfo.textContent = s.cfg ? `Норма часов в месяце «${monthLabel(s.ym).toLowerCase()}»: ${fmtDur(normMinutes(s.ym, s.cfg))}. Норму, праздники и график меняют в разделе «График».` : 'График пока не выбран: при сохранении поставлю «5 через 2», его можно изменить в разделе «График».';
    },
  };
}
