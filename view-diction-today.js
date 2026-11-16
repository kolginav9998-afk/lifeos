// Вкладка «Сегодня»: серия занятий, неделя, слабые группы звуков и программа дня на 5, 10 или 15 минут.
import { el, fill } from './ui.js';
import { SOUND_GROUPS, dictionStreak, bestStreak, weekSummary, kindsToday, buildRoutine, weakGroups, suggestLevel, dayNumber, plural, fmtNum, twisterById } from './diction.js';

export function createTodayTab(k) {
  let minutes = [5, 10, 15].includes(k.pref('min', 10)) ? k.pref('min', 10) : 10;

  function start(b) {
    if (b.kind === 'breath') k.go('breath', { preset: b.refs[0], minutes: Math.min(5, Math.max(1, b.minutes)), auto: true });
    else if (b.kind === 'warmup') k.go('warmup', { ids: b.refs, set: 'routine' });
    else if (b.kind === 'twister') k.go('twisters', { open: b.refs[0], queue: b.refs });
    else if (b.kind === 'reading') k.go('reading', { text: b.refs[0] });
    else k.go('stress', { start: true });
  }

  function render(panel) {
    const events = k.events, today = k.today();
    const streak = dictionStreak(events, today), best = bestStreak(events), week = weekSummary(events, today), done = kindsToday(events, today);
    const weak = weakGroups(events, today, k.pref('weak', []));
    const level = suggestLevel(events);
    const routine = buildRoutine({ weak, minutes, seed: dayNumber(today), level });
    const next = routine.blocks.find(b => !done.has(b.kind));

    const stats = el('div', { id: 'dic-stats', class: 'card' },
      el('div', { class: 'dic-stat-row' },
        el('div', { class: 'dic-stat' }, el('span', { class: 'dic-num', id: 'dic-streak', textContent: String(streak) }), el('span', { class: 'muted', textContent: plural(streak, ['день подряд', 'дня подряд', 'дней подряд']) })),
        el('div', { class: 'dic-stat' }, el('span', { class: 'dic-num', id: 'dic-week-min', textContent: String(week.minutes) }), el('span', { class: 'muted', textContent: 'мин за неделю' })),
        el('div', { class: 'dic-stat' }, el('span', { class: 'dic-num', id: 'dic-week-n', textContent: String(week.sessions) }), el('span', { class: 'muted', textContent: plural(week.sessions, ['занятие', 'занятия', 'занятий']) }))),
      el('p', { class: 'muted', id: 'dic-streak-note', textContent: streak ? `Лучшая серия: ${best} ${plural(best, ['день', 'дня', 'дней'])}. Один пропуск не беда: вернись завтра.` : 'Серия начнётся с первого занятия. Хватит десяти минут.' }));

    const chips = el('div', { id: 'dic-weak', class: 'chips', role: 'group', 'aria-label': 'Что подтянуть' }, ...SOUND_GROUPS.map(g => el('button', { type: 'button', class: 'chip dic-weak', dataset: { group: g.id }, 'aria-pressed': String(weak.includes(g.id)), textContent: g.title,
      onclick: () => { const cur = weakGroups(k.events, today, k.pref('weak', [])), set = new Set(cur); if (set.has(g.id)) set.delete(g.id); else set.add(g.id); k.setPref('weak', [...set]); render(panel); } })));
    const mins = el('div', { id: 'dic-minutes', class: 'chips', role: 'group', 'aria-label': 'Длина программы' }, ...[5, 10, 15].map(m => el('button', { type: 'button', class: 'chip dic-min', dataset: { min: String(m) }, 'aria-pressed': String(m === minutes), textContent: `${m} мин`,
      onclick: () => { minutes = m; k.setPref('min', m); render(panel); } })));

    const blocks = el('ol', { id: 'dic-routine', class: 'dic-blocks' }, ...routine.blocks.map(b => {
      const isDone = done.has(b.kind);
      return el('li', { class: 'dic-block', dataset: { kind: b.kind, done: String(isDone) } },
        el('div', { class: 'dic-block-main' },
          el('strong', { textContent: b.title }),
          el('span', { class: 'muted', textContent: `${b.minutes} мин. ${b.note}` }),
          b.kind === 'twister' ? el('span', { class: 'muted dic-twlist', textContent: b.refs.map(id => `«${twisterById(id).text.length > 38 ? twisterById(id).text.slice(0, 36) + '…' : twisterById(id).text}»`).join(' · ') }) : null),
        el('div', { class: 'dic-block-act' },
          isDone ? el('span', { class: 'dic-done', textContent: 'Сделано сегодня ✓' }) : null,
          el('button', { type: 'button', class: 'chip dic-go', dataset: { kind: b.kind }, 'aria-label': `${isDone ? 'Ещё раз' : 'Начать'}: ${b.title}`, textContent: isDone ? 'Ещё раз' : 'Начать', onclick: () => start(b) })));
    }));

    const go = el('button', { type: 'button', id: 'dic-start', class: 'primary big-btn', textContent: next ? 'Начать программу' : 'Программа выполнена', disabled: !next, onclick: () => next && start(next) });
    fill(panel,
      stats,
      el('div', { class: 'card', id: 'dic-plan' },
        el('h3', { textContent: `Программа на сегодня: ${routine.minutes} минут` }),
        el('p', { class: 'muted', textContent: `Уровень скороговорок: ${level}. Он поднимется после трёх занятий с оценкой чёткости 4–5.` }),
        mins, blocks, go,
        !next ? el('p', { class: 'ok', id: 'dic-all-done', textContent: 'Всё сделано. Можно повторить любой блок.' }) : null),
      el('div', { class: 'card', id: 'dic-weak-card' },
        el('h3', { textContent: 'Что подтянуть' }),
        el('p', { class: 'muted', textContent: 'Выбери группы звуков, которые даются хуже: скороговорки в программе возьмут их. Выбор хранится на этом устройстве. Если ничего не выбрано, берём слабые группы из твоих оценок и самооценки.' }),
        chips,
        el('p', { class: 'muted', textContent: `Сейчас выбрано: ${weak.length ? weak.length : 'ничего'}.` })),
      el('p', { class: 'muted', textContent: 'Хочешь послушать себя? Запиши голос другой программой на телефоне: это приложение голос не записывает.' }));
  }
  return { render };
}
