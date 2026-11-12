// Проверки уроков «с нуля»: вступление к обычной и входной проверке и итоговая страница со статусом. Сами задания идут рядом (runSequence из view-zero-lesson.js).
// Дочерний блок экрана «С нуля» (view-zero.js): записи не сохраняет, кнопки действий получает от экрана.
import { el, icon } from './ui.js';
import { STATUS_LABEL } from './curriculum.js';

const need = (n, pass) => Math.ceil(n * pass - 1e-9);
const actionBtn = a => el('button', { type: 'button', id: a.id, class: a.primary ? 'primary' : '', textContent: a.label, onclick: a.onClick });
const ruCount = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };

// Перед обычной или входной проверкой: сколько заданий, сколько верных нужно и что подсказка не засчитывается. Неожиданная проверка без вступления.
export function checkIntro({ kind, lesson, chk, onStart }) {
  const need0 = need(chk.n, chk.pass);
  return el('div', { class: 'zero-lesson zero-intro' },
    el('h3', { class: 'zero-title', tabIndex: -1, textContent: kind === 'placement' ? `Входная проверка: ${lesson.title}` : `Проверка: ${lesson.title}` }),
    el('p', { textContent: kind === 'placement'
      ? 'Если ты уже умеешь это, проверка засчитает урок как освоенный, и следующие уроки откроются.'
      : 'Проверка показывает, освоен ли урок. Это не оценка тебе, а честное измерение.' }),
    el('ul', { class: 'plain' },
      el('li', { textContent: `Заданий: ${chk.n}. Нужно верных без подсказок: ${need0}.` }),
      el('li', { textContent: 'Ответ, после которого открыли подсказку, не засчитывается.' }),
      el('li', { textContent: 'Если закрыть окно на середине, проверка не запишется.' })),
    el('button', { type: 'button', id: 'zero-start-check', class: 'primary', textContent: 'Начать проверку', onclick: onStart }));
}

// Итог проверки. kind: quiz | surprise | placement; grade — результат gradeCheck; after — статус урока после записи (объект lessonStatus).
// opened — уроки, которые только что открылись; actions — кнопки [{ id, label, primary, onClick }]; badge(status) — значок статуса (текст и картинка).
export function resultPage({ kind, lesson, grade, pass = 0.8, after, opened = [], actions = [], badge }) {
  const st = after.status, passed = grade.passed;
  const needN = need(grade.n, pass);
  let title, lead;
  if (kind === 'surprise') {
    title = !passed ? 'Надо повторить' : st === 'confirmed' ? 'Подтверждено' : 'Ты это помнишь';
    lead = !passed ? `Это был урок «${lesson.title}». Он вернулся в «${STATUS_LABEL.seen}»: перечитай его и пройди проверку.`
      : `Это был урок «${lesson.title}». ${st === 'confirmed' ? 'Он устоял при неожиданной проверке.' : 'Ответы верные.'}`;
  } else if (kind === 'placement') {
    title = passed ? 'Засчитано по входной проверке' : 'Пока не засчитано';
    lead = passed ? `Урок «${lesson.title}» отмечен как «${STATUS_LABEL.mastered.toLowerCase()}».` : `Урок «${lesson.title}» лучше пройти по порядку: открой его и сделай задания.`;
  } else {
    title = passed ? (st === 'confirmed' ? 'Подтверждено' : 'Урок освоен') : 'Пока не освоено';
    lead = passed ? `Урок «${lesson.title}» теперь в статусе «${STATUS_LABEL[st].toLowerCase()}».` : `Нужно верных без подсказок: ${needN}. Перечитай урок и попробуй ещё раз: это нормально.`;
  }
  return el('div', { id: 'zero-result', class: `zero-lesson zero-result ${passed ? 'passed' : 'failed'}`, dataset: { status: st, kind, passed: passed ? 'yes' : 'no' } },
    el('h3', { class: 'zero-title', tabIndex: -1 }, icon(passed ? 'checkCircle' : 'alert', 22), ' ', title),
    el('p', { class: 'zero-score', textContent: `Верно без подсказок: ${grade.ok} из ${grade.n}` }),
    grade.hints ? el('p', { class: 'muted', textContent: `Ответов с подсказкой: ${grade.hints}. Они не засчитываются.` }) : null,
    el('p', {}, lead),
    el('p', { class: 'zero-newstatus' }, 'Статус урока: ', badge(st)),
    opened.length ? el('p', { class: 'zero-opened' }, icon('star', 16), ` ${ruCount(opened.length, 'Открылся урок', 'Открылись уроки', 'Открылись уроки')}: ${opened.slice(0, 3).map(l => `«${l.title}»`).join(', ')}${opened.length > 3 ? ` и ещё ${opened.length - 3}` : ''}.`) : null,
    passed && st !== 'seen' && kind !== 'surprise' ? el('p', { class: 'muted', textContent: 'Результат записан. Навык можно добавить в разделе «Навыки».' }) : el('p', { class: 'muted', textContent: 'Результат записан.' }),
    el('div', { class: 'row wrap zero-actions' }, ...actions.map(actionBtn)));
}
