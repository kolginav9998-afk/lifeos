# Типы записей

_Файл создан из `registry.js` и сверяется с ним тестом: правь реестр, а не этот файл._

Все данные Life OS — журнал событий `{id, type, ts, payload, source, confidence, evidence}`. Новые типы только добавляются; записи прошлых версий читаются всегда, а незнакомые типы сохраняются и не мешают.

Всего типов: 44. «В выгрузке» — попадают ли данные этой записи в ZIP для аналитики (числа и отметки, названия привычек и упражнений). Тексты дневника, заметок, мыслей и решений, а также деньги в выгрузку не входят.

## Дела

| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |
|---|---|---|---|---|---|
| `task` | Задача | text, due, repeat, priority, done, doneAt | личный текст | да | `events.js` |
| `focus` | Сессия фокуса | date, minutes, planned, completed, label | числа и отметки | да | `focus.js` |

## Привычки

| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |
|---|---|---|---|---|---|
| `habit` | Привычка | name, anchor, minimum, full, identity, plan, startDate, archived | личный текст | да | `habits.js` |
| `habit_log` | Отметка привычки | habitId, date, level (full|min) | числа и отметки | да | `habits.js` |

## Деньги

| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |
|---|---|---|---|---|---|
| `expense` | Расход | amountMinor, currency, category, note, date | деньги | нет | `money.js` |
| `income` | Доход | amountMinor, currency, category, note, date | деньги | нет | `money.js` |
| `budget` | Бюджет месяца | amountMinor | деньги | нет | `money.js` |
| `limit` | Лимит по категории | category, amountMinor | деньги | нет | `planning.js` |
| `goal` | Копилка | title, targetMinor, dueDate | деньги | нет | `planning.js` |
| `goalmove` | Взнос в копилку | goalId, amountMinor, date, note | деньги | нет | `planning.js` |
| `sub` | Подписка | name, amountMinor, period, day, month, active | деньги | нет | `planning.js` |
| `wish` | Хочу купить (отсрочка на сутки) | text, amountMinor, date, until, status, resolvedDate | деньги | нет | `wishes.js` |
| `debt` | Долг или заём | who, amountMinor, direction, due, note, date, paidMinor, settled, settledDate | деньги | нет | `debts.js` |

## Заметки и дневник

| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |
|---|---|---|---|---|---|
| `note` | Заметка | text | личный текст | нет | `notes.js` |
| `diary` | Запись дневника | date, text, highlight, gratitude, tags | личный текст | нет | `diary.js` |

## Здоровье

| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |
|---|---|---|---|---|---|
| `checkin` | Отметка дня (утро/вечер) | date, slot (m|e), оценки 1–5, сон, кофе, нагрузка, питание (veg, protein, sweets), note | здоровье | да | `diary.js` |
| `measure` | Замер здоровья | kind, value, value2, date, time, unit, note | здоровье | да | `health.js` |
| `med` | Лекарство или добавка | name, dose, when, note, active | здоровье | нет | `meds.js` |
| `medlog` | Отметка «принял» | medId, date, takenAt | здоровье | нет | `meds.js` |
| `workout` | Тренировка | date, name, exercises[sets], done, minutes, rpe, note | здоровье | да | `workouts.js` |
| `breath` | Дыхание | date, seconds, before, after | здоровье | нет | `breathing.js` |
| `thought` | Запись дневника мыслей | date, situation, thought, emotion, before, alt, after | личный текст | нет | `thoughts.js` |
| `sick` | Период болезни | from, to | здоровье | да | `sick.js` |
| `checkup` | Плановая проверка | name, months, last, createdDate | здоровье | нет | `prevent.js` |
| `emergency` | Данные на экстренный случай | группа крови, аллергии, состояния, лекарства, контакт, телефон, заметка | здоровье | нет | `emergency.js` |

## Профиль

| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |
|---|---|---|---|---|---|
| `profile` | Профиль | name, рост, год рождения, пол, цель сна, целевой вес | здоровье | нет | `events.js` |

## Учёба

| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |
|---|---|---|---|---|---|
| `lesson` | Пройденный урок | lesson, track, date, minutes, revisited | учёба | да | `academy.js` |
| `lessonnote` | Конспект урока | lesson, text, date | личный текст | нет | `academy.js` |
| `srs` | Состояние карточки | card, box, due, first, last, reps, lapses, hist | учёба | да | `srs.js` |
| `speak` | Говорение вслух | date, lang, seconds, minutes, topic | учёба | нет | `speaking.js` |
| `learngoal` | Недельная цель по курсу (минуты) | track, minutes | учёба | нет | `practice.js` |
| `ucard` | Своя карточка | q, a, hint | личный текст | нет | `academy.js` |

## Проверки

| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |
|---|---|---|---|---|---|
| `testrun` | Прохождение проверки | date, mode, tests{metrics, trials}, state, startedAt, durationMs | числа и отметки | да | `bt-core.js` |
| `experiment` | Личный эксперимент | title, change, metric, days, blockDays, startDate, order, cancelled | личный текст | нет | `experiments.js` |

## Люди и цели

| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |
|---|---|---|---|---|---|
| `person` | Человек | name, birthday, birthYear, cadenceDays, lastContact, note | люди | нет | `people.js` |
| `okr` | Цель квартала | title, why, due, krs[text, target, current, unit], status | личный текст | нет | `okr.js` |

## Рефлексия

| Тип | Что это | Поля | Приватность | В выгрузке | Модуль |
|---|---|---|---|---|---|
| `intention` | Намерение дня | date, text | личный текст | нет | `reflect.js` |
| `dayreview` | Вечерний обзор | date, win, miss, learn | личный текст | нет | `reflect.js` |
| `weekreflect` | Итоги недели | week, went, blocked, change | личный текст | нет | `reflect.js` |
| `decision` | Решение | date, title, why, expect, revisit, closed{date, verdict, outcome} | личный текст | нет | `reflect.js` |
| `parked` | Отложенная мысль | date, forDate, text, done, doneDate | личный текст | нет | `parked.js` |
| `ritual` | Вечерний ритуал | date, steps | числа и отметки | нет | `reflect.js` |
| `joy` | Радость | date, text | личный текст | нет | `reflect.js` |
| `charger` | Что заряжает | text | личный текст | нет | `reflect.js` |

