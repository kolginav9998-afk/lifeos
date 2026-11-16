// Вкладка «Дыхание»: упражнения с ритмом вдоха и выдоха, в том числе выдох на звук. Фазы и запись — из breathing.js (общие с экраном «Здоровье»).
import { el, fill, announce } from './ui.js';
import { breathPhase, makeBreath } from './breathing.js';
import { BREATH_PRESETS, fmtClock, makeDiction } from './diction.js';

const LENGTHS = [1, 2, 3, 5];

export function createBreathTab(k) {
  let preset = 'calm', minutes = 2;
  const presetOf = id => BREATH_PRESETS.find(b => b.id === id) ?? BREATH_PRESETS[0];

  function render(panel) {
    const arg = k.take();
    if (arg?.preset && BREATH_PRESETS.some(b => b.id === arg.preset)) preset = arg.preset;
    if (arg?.minutes && LENGTHS.includes(arg.minutes)) minutes = arg.minutes;
    const draw = () => render(panel);
    const p = presetOf(preset);
    const presets = el('div', { id: 'dic-presets', class: 'chips', role: 'group', 'aria-label': 'Упражнение' }, ...BREATH_PRESETS.map(b => el('button', { type: 'button', class: 'chip dic-preset', dataset: { preset: b.id }, 'aria-pressed': String(b.id === preset),
      textContent: b.title, onclick: () => { preset = b.id; draw(); } })));
    const lengths = el('div', { id: 'dic-lengths', class: 'chips', role: 'group', 'aria-label': 'Длительность' }, ...LENGTHS.map(m => el('button', { type: 'button', class: 'chip dic-len', dataset: { min: String(m) }, 'aria-pressed': String(m === minutes),
      textContent: `${m} мин`, onclick: () => { minutes = m; draw(); } })));
    fill(panel,
      el('div', { class: 'card' },
        el('h3', { textContent: 'Дыхание для речи' }),
        el('p', { class: 'muted', textContent: 'Ровный выдох — основа голоса. Вдох носом, выдох через слегка сомкнутые губы. Плечи не поднимай.' }),
        presets,
        el('p', { id: 'dic-preset-hint', class: 'dic-hint', textContent: `${p.title}: вдох ${p.inhale} с, выдох ${p.exhale} с. ${p.hint}` }),
        lengths,
        el('button', { type: 'button', id: 'dic-breath-go', class: 'primary big-btn', textContent: 'Начать', onclick: () => run(p, minutes) }),
        el('p', { class: 'dic-safety muted', textContent: 'Закружилась голова или стало неприятно? Остановись и дыши как обычно. Те же упражнения без привязки к речи есть на экране «Здоровье».' })));
    if (arg?.auto) run(p, minutes);
  }

  function run(p, mins) {
    const total = mins * 60;
    k.open(api => {
      let timer = null;
      api.onClose(() => clearTimeout(timer));
      const circle = el('div', { id: 'dic-circle', class: 'breath-circle', 'aria-hidden': 'true' });
      const word = el('div', { id: 'dic-br-word', class: 'bt-problem', textContent: 'Вдох' });
      const left = el('div', { id: 'dic-br-left', class: 'muted bt-timer' });
      api.set(k.top(`Дыхание · ${p.title}`, 'dic-stop', 'Закончить', () => finish(false)),
        el('div', { class: 'bt-stage' }, circle, word, left, el('p', { class: 'dic-hint', textContent: p.hint }), k.safety()));
      announce(`${p.title}. Вдох ${p.inhale} секунд, выдох ${p.exhale}.`);
      const t0 = performance.now();
      let last = null;
      const tick = () => {
        const ms = performance.now() - t0;
        if (ms >= total * 1000) return finish(true);
        const ph = breathPhase(ms, p.inhale * 1000, p.exhale * 1000);
        if (ph.phase !== last) { last = ph.phase; word.textContent = ph.phase === 'in' ? 'Вдох' : 'Выдох'; circle.style.transitionDuration = `${(ph.phase === 'in' ? p.inhale : p.exhale)}s`; circle.dataset.phase = ph.phase; }
        left.textContent = `Осталось ${fmtClock(total - ms / 1000)}`;
        timer = setTimeout(tick, 200);
      };
      tick();
      async function finish(completed) {
        clearTimeout(timer);
        const sec = Math.min(total, Math.round((performance.now() - t0) / 1000));
        let note = 'Слишком коротко: меньше двадцати секунд не записываю.';
        if (sec >= 20) {
          const cycles = Math.floor(sec / (p.inhale + p.exhale));
          await k.saveAll([makeBreath(k.today(), sec), makeDiction({ kind: 'breath', seconds: sec, items: cycles, ref: p.id })]);
          note = `Записано: ${fmtClock(sec)}, циклов дыхания: ${cycles}.`;
        }
        api.set(el('div', { class: 'card bt-intro' }, el('h3', { id: 'dic-b-fin-title', tabIndex: -1, textContent: completed ? 'Готово' : 'Остановлено' }), el('p', { id: 'dic-b-fin-note', textContent: note }),
          el('button', { type: 'button', id: 'dic-b-close', class: 'primary big-btn', textContent: 'Закрыть', onclick: () => api.close() })));
        document.getElementById('dic-b-fin-title')?.focus({ preventScroll: true });
        announce(note);
      }
    });
  }
  return { render };
}
