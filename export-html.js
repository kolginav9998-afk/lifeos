// «Вечный» HTML-архив: все данные одним файлом, который открывается в любом браузере
// без приложения и без интернета хоть через 20 лет. Данные (JSON), оформление и мини-движок
// просмотра — внутри файла; внешних ссылок и библиотек нет.
// Безопасность генератора: JSON экранируется (\u003c и U+2028/U+2029), чтобы запись со словом
// «</script>» не могла сломать или заразить файл; все тексты в движке выводятся через textContent;
// сам HTML строится строками, данные в разметку не подставляются.
import { APP_NAME } from './config.js';
import { REGISTRY } from './registry.js';
import { SCHEMA_VERSION, todayStr } from './events.js';
import { formatMoney } from './money.js';

// Суммы расходов и доходов по месяцам (копейки). Повреждённые записи пропускаем.
export function moneyMonths(events) {
  const m = new Map();
  for (const e of events) {
    if (e?.type !== 'expense' && e?.type !== 'income') continue;
    const date = e.payload?.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}/.test(date)) continue;
    const amount = e.payload.amountMinor;
    if (!Number.isSafeInteger(amount)) continue;
    const ym = date.slice(0, 7);
    const row = m.get(ym) ?? { month: ym, expense: 0, income: 0 };
    row[e.type] += amount;
    m.set(ym, row);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// Метаданные для движка просмотра: подписи типов и порядок разделов (как в реестре).
function viewMeta(events) {
  const types = {};
  const groups = [];
  for (const [type, r] of Object.entries(REGISTRY)) {
    types[type] = { label: r.label, group: r.group };
    if (!groups.includes(r.group)) groups.push(r.group);
  }
  return { types, groups, money: moneyMonths(events) };
}

// JSON для вставки в <script>: «<» и разделители строк не должны встречаться буквально.
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Текст в разметку (название приложения, версия) — только экранированным.
const escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Оформление архива: спокойное, тёмное/светлое по prefers-color-scheme, без внешних ресурсов.
const CSS = `
:root{color-scheme:light dark;--bg:#f5f4f0;--card:#ffffff;--text:#2a2823;--muted:#6f6a5e;--line:#e4dfd3;--accent:#3d6b4f;--exp:#a4543f;--inc:#3d6b4f;--warnbg:#fbf3e0;--warntext:#7a5b13}
@media (prefers-color-scheme:dark){:root{--bg:#17181a;--card:#222326;--text:#e8e6e1;--muted:#9c978c;--line:#3a3b3f;--accent:#8ab894;--exp:#d08a72;--inc:#8ab894;--warnbg:#2e2a1d;--warntext:#d9b96a}}
*{box-sizing:border-box}
body{margin:0;padding:0 16px 64px;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header.top,div.controls,#shown,#money,#list,footer{max-width:880px;margin-left:auto;margin-right:auto}
h1{font-size:1.6rem;margin:24px 0 4px}
h2{font-size:1.2rem;margin:0 0 12px}
.muted{color:var(--muted)}
.warn{background:var(--warnbg);color:var(--warntext);border-radius:10px;padding:10px 14px}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:18px 0 6px}
input,select,button{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px}
input[type=search]{flex:1;min-width:180px}
button{cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
@media (prefers-color-scheme:dark){button.primary{color:#101511}}
#shown{margin:6px 0 18px}
details.grp{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:10px 0;padding:0 14px}
details.grp>summary{cursor:pointer;padding:12px 0;display:flex;gap:10px;align-items:baseline;list-style:none}
details.grp>summary::-webkit-details-marker{display:none}
details.grp>summary .gname{font-weight:600}
details.grp>summary .gcount{color:var(--muted)}
article.rec{border-top:1px solid var(--line);padding:10px 0}
.rhead{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.chip{font-size:.8rem;border:1px solid var(--line);border-radius:999px;padding:1px 10px;color:var(--muted)}
.rdate{color:var(--muted);font-size:.85rem}
.rtitle{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}
details.raw summary{cursor:pointer;color:var(--muted);font-size:.85rem}
details.raw pre{background:var(--bg);border-radius:8px;padding:10px;overflow:auto;font-size:.8rem;white-space:pre-wrap;overflow-wrap:anywhere}
button.more{margin:10px 0 14px}
#money{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}
#money[hidden]{display:none}
table.mtable{width:100%;border-collapse:collapse}
table.mtable th,table.mtable td{text-align:left;padding:6px 8px;border-top:1px solid var(--line)}
table.mtable tr:first-child th{border-top:none}
table.mtable tr.total td{font-weight:600}
.mval{display:block;white-space:nowrap}
.bar{height:6px;border-radius:3px;background:var(--line);margin-top:4px;min-width:40px}
.bar .fill{height:6px;border-radius:3px}
.bar.exp .fill{background:var(--exp)}
.bar.inc .fill{background:var(--inc)}
footer{margin-top:28px}
`;

// Мини-движок просмотра внутри файла: разделы, поиск, фильтры, суммы, выгрузка исходного JSON.
// Работает только через createElement/textContent — данные никогда не попадают в разметку как HTML.
// (Слова вроде inner»HTML здесь сознательно не используются и не должны появляться.)
const ENGINE = `
'use strict';
var EVENTS=DATA.events||[];
var TYPES=VIEW.types||{};
var GROUPS=VIEW.groups||[];
var MONEY=VIEW.money||[];
var MONTHS=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
var PAGE=200;
var state={q:'',type:'',from:'',to:''};
var hayCache=new Map();
function pad(n){return String(n).padStart(2,'0');}
function isoDate(ts){var d=new Date(ts);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function moneyFmt(minor){var neg=minor<0?'-':'';var a=Math.abs(minor);var r=Math.trunc(a/100),k=a%100;var s=String(r).replace(/\\B(?=(\\d{3})+(?!\\d))/g,' ');return neg+s+(k?','+String(k).padStart(2,'0'):'')+' ₽';}
function norm(s){return String(s==null?'':s).toLowerCase().replace(/ё/g,'е');}
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
function typeInfo(e){return TYPES[e.type]||{label:'Запись «'+e.type+'»',group:'Прочее'};}
function dateOf(e){var p=e.payload||{};if(typeof p.date==='string'&&p.date.length>=10)return p.date.slice(0,10);if(typeof p.from==='string'&&p.from.length>=10)return p.from.slice(0,10);if(typeof p.week==='string'&&p.week.length>=10)return p.week.slice(0,10);return isoDate(e.ts||0);}
function str(v,n){var s=String(v==null?'':v).replace(/\\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s;}
function title(e){var p=e.payload||{};switch(e.type){
case 'task':return (p.done?'✓ ':'')+str(p.text,120);
case 'note':return str(p.text,120);
case 'diary':return str(p.highlight||p.text||'',120);
case 'habit':return str(p.name,80);
case 'expense':case 'income':return moneyFmt(p.amountMinor||0)+' · '+str(p.category,40)+(p.note?' — '+str(p.note,60):'');
case 'measure':return str(p.kind==='custom'?p.name:p.kind,40);
case 'workout':return str(p.name,80);
case 'focus':return str((p.minutes||0)+' мин'+(p.label?' · '+p.label:''),80);
case 'checkin':return (p.slot==='m'?'Утро':'Вечер')+(p.note?': '+str(p.note,80):'');
case 'thought':return str(p.thought,100);
case 'person':return str(p.name,80);
case 'okr':return str(p.title,100);
case 'intention':return str(p.text,100);
case 'dayreview':return str(p.win||p.miss||p.learn||'',100);
case 'weekreflect':return str(p.went||p.blocked||p.change||'',100);
case 'decision':return str(p.title,100);
case 'joy':return str(p.text,100);
case 'parked':return str(p.text,100);
case 'wish':return str(p.text,100);
case 'skill':return str(p.title,80);
case 'lessonnote':return str(p.text,100);
case 'goal':return str(p.title,80);
case 'sub':return str(p.name,60);
case 'debt':return str(p.who,60);
case 'item':return str(p.name,80);
case 'med':return str(p.name,60);
case 'medlog':return str(p.date,20);
case 'habit_log':return str(p.date,20);
case 'ucard':return str(p.q,100);
case 'experiment':return str(p.title,80);
case 'emergency':return 'Данные на экстренный случай';
case 'profile':return str(p.name,60)||'Профиль';
default:var keys=Object.keys(p);for(var i=0;i<keys.length;i++){if(typeof p[keys[i]]==='string'&&p[keys[i]])return str(p[keys[i]],100);}return '';}}
function hay(e){var h=hayCache.get(e.id);if(h==null){h=norm(title(e)+' '+JSON.stringify(e.payload));hayCache.set(e.id,h);}return h;}
function matches(e){if(state.type&&e.type!==state.type)return false;var d=dateOf(e);if(state.from&&d<state.from)return false;if(state.to&&d>state.to)return false;if(state.q){var toks=norm(state.q).split(/\\s+/).filter(Boolean);var h=hay(e);for(var i=0;i<toks.length;i++){if(h.indexOf(toks[i])<0)return false;}}return true;}
function recNode(e){var info=typeInfo(e);var a=el('article','rec');var head=el('header','rhead');head.appendChild(el('span','chip',info.label));head.appendChild(el('span','rdate',dateOf(e)));a.appendChild(head);var t=title(e);if(t)a.appendChild(el('p','rtitle',t));var det=el('details','raw');det.appendChild(el('summary',null,'Данные записи'));det.appendChild(el('pre',null,JSON.stringify(e,null,2)));a.appendChild(det);return a;}
function groupNode(name,items,open){
var det=el('details','grp');if(open)det.open=true;
var sum=el('summary');sum.appendChild(el('span','gname',name));sum.appendChild(el('span','gcount','записей: '+items.length));det.appendChild(sum);
var box=el('div','items');det.appendChild(box);
var rendered=0;
var btn=el('button','more');btn.type='button';btn.hidden=true;
function more(){var slice=items.slice(rendered,rendered+PAGE);rendered+=slice.length;for(var i=0;i<slice.length;i++)box.appendChild(recNode(slice[i]));if(rendered<items.length){btn.textContent='Показать ещё ('+(items.length-rendered)+')';btn.hidden=false;}else btn.hidden=true;}
btn.addEventListener('click',more);
det.appendChild(btn);
det.addEventListener('toggle',function(){if(det.open&&rendered===0)more();});
if(open)more();
return det;}
function filterActive(){return !!(state.q||state.type||state.from||state.to);}
function renderAll(){var list=document.getElementById('list');list.textContent='';
var byGroup=new Map();var order=GROUPS.slice();
for(var i=0;i<EVENTS.length;i++){var e=EVENTS[i];var g=typeInfo(e).group;if(!byGroup.has(g)){byGroup.set(g,[]);if(order.indexOf(g)<0)order.push(g);}if(matches(e))byGroup.get(g).push(e);}
var shown=0;var open=filterActive();
for(var j=0;j<order.length;j++){var items=byGroup.get(order[j])||[];if(!items.length)continue;shown+=items.length;list.appendChild(groupNode(order[j],items,open));}
document.getElementById('shown').textContent=shown===EVENTS.length?'Записей: '+shown:'Показано записей: '+shown+' из '+EVENTS.length;}
function moneyCell(v,max,cls){var td=el('td');td.appendChild(el('span','mval',moneyFmt(v)));var bar=el('div','bar '+cls);var fill=el('div','fill');fill.style.width=Math.round(v/max*100)+'%';bar.appendChild(fill);td.appendChild(bar);return td;}
function renderMoney(){var sec=document.getElementById('money');sec.textContent='';if(!MONEY.length){sec.hidden=true;return;}
sec.appendChild(el('h2',null,'Деньги по месяцам'));
var max=1;for(var i=0;i<MONEY.length;i++){max=Math.max(max,MONEY[i].expense,MONEY[i].income);}
var table=el('table','mtable');var head=el('tr');['Месяц','Расход','Доход'].forEach(function(h){head.appendChild(el('th',null,h));});table.appendChild(head);
var te=0,ti=0;
MONEY.forEach(function(r){te+=r.expense;ti+=r.income;var tr=el('tr');var ym=r.month.split('-');tr.appendChild(el('td',null,(MONTHS[Number(ym[1])-1]||ym[1])+' '+ym[0]));tr.appendChild(moneyCell(r.expense,max,'exp'));tr.appendChild(moneyCell(r.income,max,'inc'));table.appendChild(tr);});
var tr=el('tr','total');tr.appendChild(el('td',null,'Всего'));tr.appendChild(moneyCell(te,max,'exp'));tr.appendChild(moneyCell(ti,max,'inc'));table.appendChild(tr);
sec.appendChild(table);}
function renderTypeFilter(){var sel=document.getElementById('f-type');var counts={};EVENTS.forEach(function(e){counts[e.type]=(counts[e.type]||0)+1;});
Object.keys(TYPES).forEach(function(t){if(!counts[t])return;var o=el('option',null,TYPES[t].label+' ('+counts[t]+')');o.value=t;sel.appendChild(o);});
Object.keys(counts).filter(function(t){return !TYPES[t];}).sort().forEach(function(t){var o=el('option',null,t+' ('+counts[t]+')');o.value=t;sel.appendChild(o);});}
function bind(){var q=document.getElementById('f-q');var tp=document.getElementById('f-type');var from=document.getElementById('f-from');var to=document.getElementById('f-to');
q.addEventListener('input',function(){state.q=q.value;renderAll();});
tp.addEventListener('change',function(){state.type=tp.value;renderAll();});
from.addEventListener('change',function(){state.from=from.value;renderAll();});
to.addEventListener('change',function(){state.to=to.value;renderAll();});
document.getElementById('f-reset').addEventListener('click',function(){q.value='';tp.value='';from.value='';to.value='';state={q:'',type:'',from:'',to:''};renderAll();});
document.getElementById('dl').addEventListener('click',function(){
var blob=new Blob([JSON.stringify(DATA,null,2)],{type:'application/json'});
var url=URL.createObjectURL(blob);
var a=document.createElement('a');a.href=url;a.download='lifeos-archive-'+isoDate(DATA.exportedAt||Date.now())+'.json';
document.body.appendChild(a);a.click();a.remove();
setTimeout(function(){URL.revokeObjectURL(url);},1000);});}
renderTypeFilter();renderMoney();bind();renderAll();
`;

// Полный текст архива. Собирается частями (массив кусков + join), чтобы не падать на десятках тысяч записей.
// meta: { exportedAt, version, prefs, appName } — дату генерации передавай сюда, чтобы сборка была детерминированной.
export function buildHtmlArchive(events, meta = {}) {
  const list = Array.isArray(events) ? events : [];
  const exportedAt = Number.isFinite(meta.exportedAt) ? meta.exportedAt : Date.now();
  const version = typeof meta.version === 'string' ? meta.version : null;
  const appName = typeof meta.appName === 'string' ? meta.appName : APP_NAME;
  // Порядок стабилизируем: один и тот же набор записей даёт одинаковый файл.
  const sorted = list.slice().sort((a, b) => (a.ts - b.ts) || String(a.id).localeCompare(String(b.id)));
  const data = { app: 'lifeos', schema: SCHEMA_VERSION, exportedAt, version, prefs: meta.prefs ?? null, events: sorted };
  const view = viewMeta(sorted);
  const date = todayStr(exportedAt);
  const L = [];
  L.push('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">',
    '\n<meta name="viewport" content="width=device-width, initial-scale=1">',
    `\n<title>${escHtml(appName)} — архив данных от ${date}</title>`,
    '\n<style>', CSS, '</style>\n</head>\n<body>',
    '\n<header class="top">',
    `\n<h1>${escHtml(appName)} — архив данных</h1>`,
    `\n<p class="muted">Выгружено ${date}${version ? `, версия приложения ${escHtml(version)}` : ''}. Записей: ${sorted.length}.</p>`,
    '\n<p class="warn">Файл не зашифрован: храни его как личный документ и не отправляй тем, кому не доверяешь.</p>',
    '\n</header>',
    '\n<div class="controls">',
    '\n<input id="f-q" type="search" placeholder="Поиск по тексту…" aria-label="Поиск по записям">',
    '\n<select id="f-type" aria-label="Тип записи"><option value="">Все типы</option></select>',
    '\n<label>с <input id="f-from" type="date"></label>',
    '\n<label>по <input id="f-to" type="date"></label>',
    '\n<button id="f-reset" type="button">Сбросить</button>',
    '\n<button id="dl" type="button" class="primary">Скачать исходный JSON</button>',
    '\n</div>',
    '\n<p id="shown" class="muted"></p>',
    '\n<section id="money"></section>',
    '\n<main id="list"></main>',
    '\n<footer><p class="muted">Файл самодостаточный: работает без интернета и приложения. Кнопка «Скачать исходный JSON» отдаёт данные в исходном виде — этот файл можно загрузить обратно в приложение. Разделы сворачиваются; у каждой записи есть подробности («Данные записи»).</p></footer>',
    '\n<script>\nconst DATA = ', safeJson(data), ';\nconst VIEW = ', safeJson(view), ';\n', ENGINE, '\n</' + 'script>\n</body>\n</html>\n');
  return L.join('');
}

// Суммы к показу в подписи кнопки/проверке: формат как в приложении.
export function moneyTotalText(events) {
  const m = moneyMonths(events);
  const expense = m.reduce((s, r) => s + r.expense, 0);
  const income = m.reduce((s, r) => s + r.income, 0);
  return { expense, income, expenseText: formatMoney(expense), incomeText: formatMoney(income) };
}
