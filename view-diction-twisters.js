// Вкладка «Скороговорки»: выбор по звуку и уровню, крупный текст, три темпа с секундомером, самооценка чёткости 1–5 и личный рекорд.
import { el, fill, toast, announce, ratingRow } from './ui.js';
import { TWISTERS, SOUND_GROUPS, REPS, TEMPOS, filterTwisters, groupsOfTwister, twisterById, twisterBests, twisterBest, tempoTarget, tempoById, syllables, makeDiction, fmtNum, plural } from './diction.js';

const PAGE = 24;
const LETTERS = [...new Set(TWISTERS.flatMap(t => t.sounds).filter(s => s.length === 1))];
const bestText = b => `${tempoById(b.tempo).title.toLowerCase()}, чёткость ${b.rating} из 5, ${fmtNum(b.seconds)} с`;

export function createTwistersTab(k) {
  let group = '', sound = '', level = 0, shown = PAGE;

  function render(panel) {
    const arg = k.take();
    const draw = () => render(panel);
    const found = filterTwisters({ group, sound, level }), bests = twisterBests(k.events);
    const chip = (text, pressed, onclick, extra = {}) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), textContent: text, onclick, ...extra });
    const groups = el('div', { id: 'dic-tw-groups', class: 'chips', role: 'group', 'aria-label': 'Группа звуков' },
      chip('Все звуки', !group, () => { group = ''; sound = ''; shown = PAGE; draw(); }, { dataset: { group: '' } }),
      ...SOUND_GROUPS.map(g => chip(g.title, group === g.id, () => { group = g.id; sound = ''; shown = PAGE; draw(); }, { dataset: { group: g.id } })));
    const letters = group && group !== 'cluster' ? SOUND_GROUPS.find(g => g.id === group).letters.split('').filter(l => LETTERS.includes(l)) : [];
    const letterRow = letters.length > 1 ? el('div', { id: 'dic-tw-letters', class: 'chips', role: 'group', 'aria-label': 'Звук' },
      chip('Любой', !sound, () => { sound = ''; shown = PAGE; draw(); }), ...letters.map(l => chip(l.toUpperCase(), sound === l, () => { sound = l; shown = PAGE; draw(); }, { dataset: { sound: l } }))) : null;
    const levels = el('div', { id: 'dic-tw-levels', class: 'chips', role: 'group', 'aria-label': 'Уровень' }, ...[0, 1, 2, 3].map(l => chip(l ? `Уровень ${l}` : 'Любой уровень', level === l, () => { level = l; shown = PAGE; draw(); }, { dataset: { level: String(l) } })));
    const items = found.slice(0, shown).map(t => el('li', { class: 'dic-tw-item' }, el('button', { type: 'button', class: 'dic-tw-pick', dataset: { id: t.id }, onclick: () => train(t.id, []) },
      el('span', { class: 'dic-tw-text', textContent: t.text }),
      el('span', { class: 'muted', textContent: `Уровень ${t.level} · звуки: ${t.sounds.join(', ')}${bests[t.id] ? ` · рекорд: ${bestText(bests[t.id])}` : ''}` }))));
    fill(panel,
      el('div', { class: 'card' },
        el('h3', { textContent: 'Скороговорки' }),
        el('p', { class: 'muted', textContent: 'Сначала медленно и чётко, потом быстрее. Оценивай чёткость, а не скорость.' }),
        el('p', { class: 'dic-safety muted', textContent: 'Говори тихо и разборчиво, не криком. Если горло напряглось, остановись.' }),
        groups, letterRow, levels),
      el('p', { id: 'dic-tw-count', class: 'muted', role: 'status', textContent: found.length ? `Найдено: ${found.length}` : 'Ничего не найдено. Выбери другой звук или уровень.' }),
      el('ul', { id: 'dic-tw-list', class: 'dic-tw-list' }, ...items),
      found.length > shown ? el('button', { type: 'button', id: 'dic-tw-more', class: 'chip', textContent: `Показать ещё (${found.length - shown})`, onclick: () => { shown += PAGE; draw(); } }) : null);
    if (arg?.open) train(arg.open, (arg.queue ?? []).slice(1));
  }

  function train(id, queue) {
    const t = twisterById(id);
    if (!t) return;
    let tempo = 2, t0 = 0, timer = null, rating = null, elapsed = 0;
    k.open(api => {
      api.onClose(() => clearInterval(timer));
      const best = twisterBest(k.events, id);
      const clock = el('div', { id: 'dic-tw-clock', class: 'dic-clock', 'aria-hidden': 'true', textContent: '0:00' });
      const go = el('button', { type: 'button', id: 'dic-tw-go', class: 'primary big-btn', textContent: 'Старт' });
      const target = el('p', { id: 'dic-tw-target', class: 'muted', role: 'status' });
      const tempos = el('div', { id: 'dic-tw-tempos', class: 'chips', role: 'group', 'aria-label': 'Темп' }, ...TEMPOS.map(tp => el('button', { type: 'button', class: 'chip dic-tempo', dataset: { tempo: String(tp.id) }, 'aria-pressed': String(tp.id === tempo),
        textContent: `${tp.title}: ${tempoTarget(t.text, tp.id)} с`, onclick: () => { tempo = tp.id; paint(); } })));
      const result = el('div', { id: 'dic-tw-result', class: 'dic-result' });
      const paint = () => {
        for (const b of tempos.children) b.setAttribute('aria-pressed', String(Number(b.dataset.tempo) === tempo));
        target.textContent = `Цель: ${REPS} ${plural(REPS, ['повтор', 'повтора', 'повторов'])} подряд за ${tempoTarget(t.text, tempo)} с. Слогов в одном повторе: ${syllables(t.text)}.`;
      };
      const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      go.onclick = () => {
        if (!timer) {
          fill(result); rating = null; t0 = performance.now(); go.textContent = 'Стоп';
          timer = setInterval(() => { clock.textContent = fmt((performance.now() - t0) / 1000); }, 200);
          announce('Секундомер запущен');
        } else {
          clearInterval(timer); timer = null; elapsed = Math.round(((performance.now() - t0) / 1000) * 10) / 10; clock.textContent = fmt(elapsed); go.textContent = 'Ещё раз';
          const save = el('button', { type: 'button', id: 'dic-tw-save', class: 'primary', textContent: 'Сохранить', disabled: true, onclick: () => commit(save) });
          const rate = ratingRow('Насколько чётко получилось?', 'clarity', null, v => { rating = v; save.disabled = !v; });
          fill(result, el('p', { id: 'dic-tw-time', textContent: `Время на ${REPS} ${plural(REPS, ['повтор', 'повтора', 'повторов'])}: ${fmtNum(elapsed)} с. Цель была ${tempoTarget(t.text, tempo)} с.` }), rate, save);
          announce(`Время: ${fmtNum(elapsed)} секунды. Оцени чёткость от одного до пяти.`);
        }
      };
      async function commit(save) {
        let ev;
        try { ev = makeDiction({ kind: 'twister', seconds: elapsed, items: REPS, rating, ref: id, groups: groupsOfTwister(t), tempo }); } catch (e) { toast(e.message); return; }
        save.disabled = true;
        await k.save(ev);
        const nb = twisterBest(k.events, id), improved = nb && (!best || nb.tempo > best.tempo || (nb.tempo === best.tempo && nb.seconds < best.seconds));
        const note = rating >= 4 ? (improved ? `Новый личный рекорд: ${bestText(nb)}.` : `Записано.${nb ? ` Рекорд: ${bestText(nb)}.` : ''}`) : 'Записано. Чёткость ниже четырёх: потренируйся ещё в медленном темпе.';
        fill(result, el('p', { id: 'dic-tw-saved', class: 'ok', textContent: note }), queue.length ? el('button', { type: 'button', id: 'dic-tw-next', class: 'primary', textContent: 'Следующая скороговорка', onclick: () => train(queue[0], queue.slice(1)) }) : null);
        announce(note);
      }
      api.set(
        k.top('Скороговорка', 'dic-t-close', 'Закрыть', () => api.close()),
        el('div', { class: 'card bt-intro' },
          el('p', { id: 'dic-tw-text', class: 'dic-big', lang: 'ru', textContent: t.text }),
          el('p', { class: 'muted', textContent: `Уровень ${t.level} · звуки: ${t.sounds.join(', ')}${best ? ` · рекорд: ${bestText(best)}` : ' · рекорда пока нет'}` }),
          tempos, target, k.voice(() => t.text, () => tempoById(tempo).voice), clock, go, result, k.safety()));
      paint();
    });
  }
  return { render };
}
