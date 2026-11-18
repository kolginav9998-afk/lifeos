// Консоль запросов к журналу — «гиковский» режим поверх обычного поиска.
// Синтаксис (условия через пробел, все должны выполняться):
//   type:expense,income   тип записи (через запятую — несколько)
//   amount>1000           сумма больше 1000 ₽ (есть и amount<500,50; только у записей с суммой)
//   last:30d              за последние 30 дней
//   from:2026-01-01       не раньше даты
//   to:2026-02-01         не позже даты
//   id:<идентификатор>    конкретная запись
//   re:/кофе|чай/i        регулярное выражение по тексту записи
//   остальные слова       обычный текстовый поиск (все слова должны встретиться)
//
// Верхняя половина файла — чистая логика (парсер, фильтры, отчёты, explain), без DOM: её проверяют тесты.
// Нижняя — вкладка «Запросы» в панели поиска; работает только в браузере (интерфейсные модули подгружаются лениво, чтобы логика оставалась чистой и тестируемой).
import { normalize, searchable, describeEvent } from './search.js';
import { todayStr, addDays, isYmd } from './events.js';
import { csvCell, formatMoney } from './money.js';
import { knownType, REGISTRY } from './registry.js';

// ---------- парсер ----------

export const RE_MAX_LEN = 120;          // дальше это уже не выражение, а роман; и тормозить может
const RE_BACKREF = /\\[1-9]/;           // обратные ссылки способны устроить экспоненциальный перебор
const RE_NESTED = /\([^()]*(?:[+*]|\{\d)/; // группа с квантором внутри — кандидат на (…+)+ ; точную проверку делает rejectNested

// Есть ли в выражении «квантор группы, внутри которой уже есть квантор» — главный источник катастрофического перебора.
function hasNestedQuantifier(src) {
  let depth = 0, innerQuant = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[') { while (i < src.length && src[i] !== ']') { if (src[i] === '\\') i++; i++; } continue; }
    if (ch === '(') { innerQuant.push(false); depth++; continue; }
    if (ch === ')') {
      const had = innerQuant.pop() ?? false; depth--;
      let j = i + 1;
      while (src[j] === '?') j++;                          // (…)? — ленивый/нежадный маркер сам по себе не квантор группы…
      const q = src[i + 1];
      if (had && (q === '+' || q === '*' || q === '{')) return true;
      if (q === '+' || q === '*' || q === '{') { if (depth > 0) innerQuant[depth - 1] = true; }
      continue;
    }
    if ((ch === '+' || ch === '*' || ch === '{') && depth > 0) innerQuant[depth - 1] = true;
  }
  return false;
}

// Компиляция регулярного выражения с защитой: длина, обратные ссылки, вложенные кванторы.
// Возвращает { re } или { error }. «Таймаута» в JS нет, поэтому страхуемся заранее + режем длину текстов при поиске.
export function compileRe(source, flags = 'i') {
  const s = String(source ?? '').trim();
  if (!s) return { error: 'Пустое выражение' };
  if (s.length > RE_MAX_LEN) return { error: `Слишком длинное выражение (не больше ${RE_MAX_LEN} символов)` };
  if (RE_BACKREF.test(s)) return { error: 'Обратные ссылки (\\1, \\2…) не поддерживаются' };
  if (RE_NESTED.test(s) && hasNestedQuantifier(s)) return { error: 'Слишком сложное выражение: повтор внутри повтора может работать очень долго' };
  try { return { re: new RegExp(s, flags.replace(/[^gi]/g, '')) }; }
  catch { return { error: 'Ошибка в регулярном выражении' }; }
}

const AMOUNT_RE = /^amount([<>])(\d+(?:[.,]\d{1,2})?)$/;
const toMinor = s => Math.round(Number(s.replace(',', '.')) * 100);

// Разбор строки запроса. Чистая функция: тот же ввод — тот же результат.
// Возвращает { ok, query, errors }: query всегда есть (частично разобранный), ok === (без ошибок и есть хоть одно условие).
export function parseQuery(input) {
  const q = { types: [], amount: null, lastDays: null, from: '', to: '', id: '', re: null, text: [] };
  const errors = [];
  const tokens = [];
  const raw = String(input ?? '').trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < raw.length; i++) {
    let t = raw[i];
    if (/^re:\//.test(t) && !/^re:\/(.+)\/[a-z]*$/.test(t)) {   // re:/кофе или чай/i — шаблон может содержать пробелы: склеиваем до закрывающего слэша
      while (i + 1 < raw.length && !/^re:\/(.+)\/[a-z]*$/.test(t)) t += ' ' + raw[++i];
    }
    tokens.push(t);
  }
  for (const t of tokens) {
    let m;
    if ((m = /^type:(.+)$/.exec(t))) {
      for (const name of m[1].split(',')) {
        if (!/^[a-z][a-z0-9_]*$/.test(name)) { errors.push(`Некорректный тип «${name}»`); continue; }
        if (!knownType(name)) { errors.push(`Неизвестный тип «${name}»`); continue; }
        if (!q.types.includes(name)) q.types.push(name);
      }
    } else if ((m = AMOUNT_RE.exec(t))) {
      q.amount = { op: m[1], minor: toMinor(m[2]) };
    } else if ((m = /^last:(\d+)d$/.exec(t))) {
      const n = Number(m[1]);
      if (n < 1 || n > 3660) errors.push(`last: от 1d до 3660d, а не «${m[1]}d»`);
      else q.lastDays = n;
    } else if ((m = /^from:(\S+)$/.exec(t))) {
      if (isYmd(m[1])) q.from = m[1]; else errors.push(`from: нужна дата ГГГГ-ММ-ДД, а не «${m[1]}»`);
    } else if ((m = /^to:(\S+)$/.exec(t))) {
      if (isYmd(m[1])) q.to = m[1]; else errors.push(`to: нужна дата ГГГГ-ММ-ДД, а не «${m[1]}»`);
    } else if ((m = /^id:(\S+)$/.exec(t))) {
      q.id = m[1];
    } else if ((m = /^re:\/(.*)\/([a-z]*)$/.exec(t)) || (m = /^re:(\S+)()$/.exec(t))) {
      const r = compileRe(m[1], m[2] || 'i');
      if (r.error) errors.push(`re: ${r.error}`); else q.re = r.re;
    } else {
      q.text.push(normalize(t));
    }
  }
  if (q.from && q.to && q.from > q.to) errors.push('from: позже, чем to:');
  const has = q.types.length || q.amount || q.lastDays || q.from || q.to || q.id || q.re || q.text.length;
  return { ok: !errors.length && !!has, query: q, errors };
}

// ---------- фильтры ----------

// Дата записи: своё поле date, а если его нет — день создания события.
export const eventDate = (ev, now = Date.now()) => (ev.payload && isYmd(ev.payload.date)) ? ev.payload.date : todayStr(ev.ts ?? now);

const RE_TEXT_MAX = 4000;               // регулярку прогоняем не по всему тексту, а по началу: защита от тяжёлых случаев
const textOf = ev => { const s = searchable(ev); return s ? String(s.text ?? '') : ''; };

// Список условий запроса с русскими подписями: нужен и для фильтра, и для explain («какое условие не сработало»).
export function conditions(q, now = Date.now()) {
  const today = todayStr(now);
  const out = [];
  if (q.types.length) out.push({ label: `тип: ${q.types.map(t => REGISTRY[t]?.label ?? t).join(' или ')}`, test: ev => q.types.includes(ev.type) });
  if (q.id) out.push({ label: `id: ${q.id}`, test: ev => ev.id === q.id });
  if (q.amount) {
    const label = q.amount.op === '>' ? `сумма больше ${formatMoney(q.amount.minor)}` : `сумма меньше ${formatMoney(q.amount.minor)}`;
    out.push({ label, test: ev => typeof ev.payload?.amountMinor === 'number' && (q.amount.op === '>' ? ev.payload.amountMinor > q.amount.minor : ev.payload.amountMinor < q.amount.minor) });
  }
  if (q.lastDays) {
    const since = addDays(today, -(q.lastDays - 1));
    out.push({ label: `за последние ${q.lastDays} дн. (с ${since})`, test: ev => eventDate(ev, now) >= since });
  }
  if (q.from) out.push({ label: `не раньше ${q.from}`, test: ev => eventDate(ev, now) >= q.from });
  if (q.to) out.push({ label: `не позже ${q.to}`, test: ev => eventDate(ev, now) <= q.to });
  if (q.re) out.push({ label: `шаблон /${q.re.source}/`, test: ev => q.re.test(textOf(ev).slice(0, RE_TEXT_MAX)) });
  for (const t of q.text) out.push({ label: `текст «${t}»`, test: ev => normalize(textOf(ev)).includes(t) });
  return out;
}

export const QUERY_LIMIT = 500;         // больше пяти сотен строк в таблице всё равно никто глазами не пройдёт

// Выполнить запрос: отфильтрованные события, новые сверху. Строки готовы для таблицы и CSV.
export function runQuery(events, q, { now = Date.now(), limit = QUERY_LIMIT } = {}) {
  const conds = conditions(q, now);
  const rows = [];
  for (const ev of events) {
    if (!conds.every(c => c.test(ev))) continue;
    const s = describeEvent(ev);
    rows.push({ ev, kind: s.kind, title: s.title, date: eventDate(ev, now), amountMinor: typeof ev.payload?.amountMinor === 'number' ? ev.payload.amountMinor : null });
  }
  rows.sort((a, b) => b.ev.ts - a.ev.ts);
  const total = rows.length;
  return { rows: rows.slice(0, limit), total };
}

// Таблица результата в CSV (точка с запятой — чтобы «Эксель» на русской локали понял без настроек).
export function queryToCsv(rows) {
  const lines = [['Дата', 'Тип', 'Запись', 'Сумма', 'id'].join(';')];
  for (const r of rows) {
    const amount = r.amountMinor === null ? '' : (r.amountMinor / 100).toFixed(2).replace('.', ',');
    lines.push([r.date, r.kind, r.title, amount, r.ev.id].map(csvCell).join(';'));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------- поиск по регулярному выражению ----------

// Безопасный поиск по шаблону с предпросмотром: первые limit совпадений со сниппетом + полное число совпадений.
export function regexSearch(events, source, flags = 'i', { limit = 20 } = {}) {
  const c = compileRe(source, flags);
  if (c.error) return { error: c.error, matches: [], total: 0 };
  const re = c.re;
  const sorted = [...events].sort((a, b) => b.ts - a.ts);
  const matches = [];
  let total = 0;
  for (const ev of sorted) {
    const text = textOf(ev).slice(0, RE_TEXT_MAX);
    if (!text) continue;
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) continue;
    total++;
    if (matches.length < limit) {
      const from = Math.max(0, m.index - 24), to = Math.min(text.length, m.index + m[0].length + 24);
      const snippet = (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '');
      const s = describeEvent(ev);
      matches.push({ ev, kind: s.kind, title: s.title, snippet });
    }
  }
  return { matches, total };
}

// ---------- хроно-отчёт ----------

// Даты из поля ввода: через запятую/пробел/точку с запятой, только настоящие даты, без повторов, по возрастанию.
export function parseDatesInput(input) {
  const seen = new Set();
  for (const part of String(input ?? '').split(/[\s,;]+/)) if (isYmd(part)) seen.add(part);
  return [...seen].sort();
}

// Все записи за выбранные даты одним пакетом в Markdown (для заметок, отчёта врачу, переноса в дневник).
export function chronoReport(events, dates, { now = Date.now() } = {}) {
  const days = parseDatesInput(dates.join(' '));
  if (!days.length) return { md: '', count: 0 };
  const byDay = new Map(days.map(d => [d, []]));
  for (const ev of events) {
    const d = eventDate(ev, now);
    if (byDay.has(d)) byDay.get(d).push(ev);
  }
  const L = [`# Записи за ${days.length === 1 ? 'день ' + days[0] : days.length + ' дн. (' + days[0] + ' — ' + days[days.length - 1] + ')'}`, ''];
  let count = 0;
  for (const d of days) {
    const list = byDay.get(d).sort((a, b) => a.ts - b.ts);
    L.push(`## ${d}`, '');
    if (!list.length) { L.push('_Записей нет._', ''); continue; }
    for (const ev of list) {
      const s = describeEvent(ev);
      const amount = typeof ev.payload?.amountMinor === 'number' ? ` — ${formatMoney(ev.payload.amountMinor)}` : '';
      L.push(`- ${s.kind}: ${s.title}${amount}`);
      count++;
    }
    L.push('');
  }
  return { md: L.join('\n'), count };
}

// ---------- explain: «почему я вижу эту запись» ----------

// Цепочка версий записи по id (в журнале может быть несколько событий с одним id: создание и правки)
// плюс — если дан запрос — какие его условия сработали, а какие нет.
export function explainEvent(events, id, q = null, { now = Date.now() } = {}) {
  const chain = events.filter(e => e.id === id).sort((a, b) => a.ts - b.ts || String(a.u ?? '').localeCompare(String(b.u ?? '')));
  if (!chain.length) return { found: false, id, chain: [], notes: ['Записи с таким id в журнале нет.'], match: null };
  const notes = [];
  const first = chain[0], last = chain[chain.length - 1];
  notes.push(`Запись типа «${REGISTRY[last.type]?.label ?? last.type}», версий в журнале: ${chain.length}.`);
  notes.push(`Создана ${new Date(first.ts).toLocaleString('ru-RU')} (источник: ${first.source ?? 'неизвестен'}).`);
  if (chain.length > 1) notes.push(`Последняя версия от ${new Date(last.ts).toLocaleString('ru-RU')}: запись правили, в журнале остались все версии.`);
  if (last.payload?.editedAt) notes.push(`В записи есть отметка о правке: ${new Date(last.payload.editedAt).toLocaleString('ru-RU')}.`);
  if (last.confidence !== undefined && last.confidence !== 1) notes.push(`Достоверность записи: ${last.confidence} (обычно 1).`);
  const match = q ? conditions(q, now).map(c => ({ label: c.label, ok: c.test(last) })) : null;
  return { found: true, id, chain: chain.map(ev => ({ ev, ...describeEvent(ev) })), notes, match };
}

// ---------- вкладка «Запросы» в панели поиска (только браузер) ----------

async function initQueryPanel() {
  const [{ $, el, fill, toast, copyText }, store, { getPref, setPref }, { saveTextFile }] =
    await Promise.all([import('./ui.js'), import('./store.js'), import('./prefs.js'), import('./platform.js')]);
  const panel = $('search-panel');
  if (!panel || $('query-view')) return;               // панель не та или уже подключились
  const input = $('search-input'), results = $('search-results');

  const tabSearch = el('button', { type: 'button', role: 'tab', class: 'search-tab', textContent: 'Поиск' });
  const tabQuery = el('button', { type: 'button', role: 'tab', class: 'search-tab', textContent: 'Запросы' });
  const tabs = el('div', { class: 'search-tabs', role: 'tablist', 'aria-label': 'Режим поиска' }, tabSearch, tabQuery);

  // --- консоль запроса ---
  const qInput = el('input', { id: 'query-input', type: 'search', autocomplete: 'off', 'aria-label': 'Запрос к журналу',
    placeholder: 'type:expense amount>1000 last:30d' });
  const runBtn = el('button', { type: 'button', class: 'primary', textContent: 'Выполнить' });
  const outBox = el('div', { class: 'query-out', role: 'status' });
  const explainBox = el('div', { class: 'query-explain', hidden: true });

  // --- сохранённые виды (хранятся в настройках устройства, prefs: не личные записи, а «избранные фильтры») ---
  const nameInput = el('input', { type: 'text', maxlength: '40', autocomplete: 'off', 'aria-label': 'Название вида', placeholder: 'Название вида' });
  const saveBtn = el('button', { type: 'button', class: 'chip', textContent: 'Сохранить вид' });
  const viewsBox = el('div', { class: 'query-views' });

  // --- регулярное выражение с предпросмотром ---
  const reInput = el('input', { type: 'search', autocomplete: 'off', 'aria-label': 'Регулярное выражение', placeholder: 'Регулярное выражение, напр. кофе|чай' });
  const reBox = el('div', { class: 'query-re' });

  // --- хроно-отчёт ---
  const datesInput = el('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Даты для отчёта', placeholder: 'Даты: 2026-11-01, 2026-11-05' });
  const datesBtn = el('button', { type: 'button', class: 'chip', textContent: 'Скопировать отчёт' });

  const view = el('div', { id: 'query-view', hidden: true },
    el('p', { class: 'muted query-hint', textContent: 'Условия через пробел: type:тип, amount>1000, amount<500, last:30d, from:2026-01-01, to:…, id:…, re:/шаблон/ и просто слова.' }),
    el('div', { class: 'query-row' }, qInput, runBtn),
    el('div', { class: 'query-row' }, nameInput, saveBtn),
    viewsBox, outBox, explainBox,
    el('div', { class: 'query-row' }, reInput),
    reBox,
    el('div', { class: 'query-row' }, datesInput, datesBtn));

  panel.prepend(tabs);
  results.after(view);

  // --- вкладки ---
  const show = (which, focus = true) => {
    const isQ = which === 'q';
    for (const [btn, on] of [[tabSearch, !isQ], [tabQuery, isQ]]) { btn.setAttribute('aria-selected', String(on)); btn.classList.toggle('on', on); }
    input.hidden = isQ; results.hidden = isQ; view.hidden = !isQ;
    setPref('queryTab', isQ ? 'q' : 's');
    if (focus && !panel.hidden) (isQ ? qInput : input).focus();
  };
  tabSearch.onclick = () => show('s');
  tabQuery.onclick = () => show('q');
  show(getPref('queryTab') === 'q' ? 'q' : 's', false);
  // Когда панель открывают кнопкой или клавишей «/», app.js фокусирует обычный поиск — перехватим, если активна вкладка запросов.
  new MutationObserver(() => { if (!panel.hidden && !view.hidden) qInput.focus(); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });

  // --- выполнение запроса ---
  const renderOut = () => {
    fill(explainBox); explainBox.hidden = true;
    const raw = qInput.value.trim();
    if (!raw) { fill(outBox); return; }
    const { query, errors } = parseQuery(raw);
    if (errors.length) { fill(outBox, el('p', { class: 'error', textContent: errors.join(' ') })); return; }
    const { rows, total } = runQuery(store.state.events, query, {});
    if (!rows.length) { fill(outBox, el('p', { class: 'muted', textContent: 'Ничего не подошло' })); return; }
    const csvBtn = el('button', {
      type: 'button', class: 'chip', textContent: 'В CSV', onclick: async () => {
        await saveTextFile(`lifeos-query-${todayStr()}.csv`, '\uFEFF' + queryToCsv(rows), 'text/csv', 'Сохранить результат запроса');
        toast('CSV сохранён');
      },
    });
    const head = el('div', { class: 'query-meta' },
      el('span', { class: 'muted', textContent: total > rows.length ? `Найдено: ${total}, показаны первые ${rows.length}` : `Найдено: ${total}` }), csvBtn);
    const table = el('table', { class: 'query-table' },
      el('thead', {}, el('tr', {}, ...['Дата', 'Тип', 'Запись', 'Сумма', ''].map(h => el('th', { textContent: h })))),
      el('tbody', {}, rows.map(r => el('tr', {},
        el('td', { textContent: r.date }),
        el('td', { textContent: r.kind }),
        el('td', { textContent: r.title }),
        el('td', { textContent: r.amountMinor === null ? '' : formatMoney(r.amountMinor) }),
        el('td', {}, el('button', { type: 'button', class: 'query-why', textContent: '?', 'aria-label': `Почему я вижу «${r.title}»`, onclick: () => renderExplain(r.ev.id, query) }))))));
    fill(outBox, head, table);
  };
  const renderExplain = (id, query) => {
    const ex = explainEvent(store.state.events, id, query, {});
    const card = [el('div', { class: 'query-row' },
      el('strong', { textContent: 'Почему я вижу эту запись' }),
      el('button', { type: 'button', class: 'chip', textContent: 'Закрыть', onclick: () => { fill(explainBox); explainBox.hidden = true; } }))];
    card.push(el('ul', {}, ex.notes.map(n => el('li', { textContent: n }))));
    if (ex.chain.length > 1) card.push(el('p', { class: 'muted', textContent: 'Цепочка версий (от старой к новой):' }),
      el('ol', {}, ex.chain.map(c => el('li', { textContent: `${new Date(c.ev.ts).toLocaleString('ru-RU')} — ${c.kind}: ${c.title}` }))));
    if (ex.match) card.push(el('p', { class: 'muted', textContent: 'Условия запроса:' }),
      el('ul', {}, ex.match.map(mo => el('li', { class: mo.ok ? 'query-ok' : 'query-no', textContent: `${mo.ok ? '✓' : '✗'} ${mo.label}` }))));
    fill(explainBox, card);
    explainBox.hidden = false;
  };
  runBtn.onclick = renderOut;
  qInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); renderOut(); } };
  qInput.oninput = () => { if (!qInput.value.trim()) { fill(outBox); fill(explainBox); explainBox.hidden = true; } };

  // --- сохранённые виды ---
  const getViews = () => (Array.isArray(getPref('queryViews')) ? getPref('queryViews') : []).filter(v => v && typeof v.name === 'string' && typeof v.query === 'string');
  const renderViews = () => fill(viewsBox,
    getViews().map(v => el('span', { class: 'chip query-view' },
      el('button', { type: 'button', class: 'query-view-run', textContent: v.name, onclick: () => { qInput.value = v.query; renderOut(); } }),
      el('button', {
        type: 'button', class: 'query-view-del', textContent: '×', 'aria-label': `Удалить вид «${v.name}»`, onclick: () => {
          setPref('queryViews', getViews().filter(x => x.name !== v.name)); renderViews();
        },
      }))),
    getViews().length ? null : el('span', { class: 'muted', textContent: 'Сохранённых видов пока нет' }));
  saveBtn.onclick = () => {
    const name = nameInput.value.trim().slice(0, 40), query = qInput.value.trim();
    if (!name || !query) { toast('Нужны название и запрос'); return; }
    if (!parseQuery(query).ok) { toast('Сначала исправь ошибки в запросе'); return; }
    const views = getViews().filter(v => v.name !== name);
    views.push({ name, query });
    if (views.length > 20) views.shift();              // «библиотека» без перегруза: старые виды вытесняются
    setPref('queryViews', views);
    nameInput.value = '';
    renderViews();
    toast(`Вид «${name}» сохранён`);
  };
  renderViews();

  // --- регулярное выражение с предпросмотром ---
  reInput.oninput = () => {
    const s = reInput.value.trim();
    if (!s) { fill(reBox); return; }
    const r = regexSearch(store.state.events, s, 'i', { limit: 8 });
    if (r.error) { fill(reBox, el('p', { class: 'error', textContent: r.error })); return; }
    fill(reBox,
      el('p', { class: 'muted', textContent: r.total ? `Совпадений: ${r.total}${r.total > r.matches.length ? `, показаны первые ${r.matches.length}` : ''}` : 'Совпадений нет' }),
      r.matches.map(mo => el('div', { class: 'query-re-hit' }, el('span', { class: 'kind', textContent: mo.kind }), el('span', { textContent: mo.snippet }))));
  };

  // --- хроно-отчёт ---
  datesBtn.onclick = () => {
    const dates = parseDatesInput(datesInput.value);
    if (!dates.length) { toast('Напиши даты вроде 2026-11-01 через запятую'); return; }
    const { md, count } = chronoReport(store.state.events, dates, {});
    copyText(md, `Отчёт скопирован: ${count} записей за ${dates.length} дн.`);
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { initQueryPanel(); });
  else initQueryPanel();
}
