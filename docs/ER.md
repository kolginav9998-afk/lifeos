# Связи между данными (ER-диаграмма)

_Файл создан из `registry.js` (`RELATIONS` и `BY_DAY`) и сверяется с ним тестом: правь реестр, а не этот файл._

Записи не хранят вложенных копий друг друга: связь идёт по идентификатору или по дате. Диаграмма в формате Mermaid (отображается на GitHub).

```mermaid
erDiagram
  habit ||--o{ habit_log : "habitId"
  med ||--o{ medlog : "medId"
  goal ||--o{ goalmove : "goalId"
  lesson ||--o{ lessonnote : "lesson"
  day ||--o{ checkin : "date"
  day ||--o{ diary : "date"
  day ||--o{ measure : "date"
  day ||--o{ workout : "date"
  day ||--o{ focus : "date"
  day ||--o{ thought : "date"
  day ||--o{ intention : "date"
  day ||--o{ dayreview : "date"
  day ||--o{ joy : "date"
  day ||--o{ ritual : "date"
  day ||--o{ speak : "date"
  day ||--o{ breath : "date"
  day ||--o{ testrun : "date"
  day ||--o{ expense : "date"
  day ||--o{ income : "date"
  day ||--o{ medlog : "date"
  day ||--o{ habit_log : "date"
  day ||--o{ lesson : "date"
```

## Связи по идентификатору

| Родитель | Потомок | Поле | Смысл |
|---|---|---|---|
| `habit` | `habit_log` | `habitId` | отметки привычки по дням |
| `med` | `medlog` | `medId` | приёмы лекарства |
| `goal` | `goalmove` | `goalId` | взносы в копилку |
| `lesson` | `lessonnote` | `lesson` | конспект к пройденному уроку |

## Записи по дням

Эти типы привязаны к дню полем `date`: `checkin`, `diary`, `measure`, `workout`, `focus`, `thought`, `intention`, `dayreview`, `joy`, `ritual`, `speak`, `breath`, `testrun`, `expense`, `income`, `medlog`, `habit_log`, `lesson`. Узел «day» условный: отдельной записи «день» нет, день — это просто дата.

## Внутри записи (не отдельные типы)

- `okr` содержит список результатов `krs[]` (текст, цель, текущее значение, единица).
- `workout` содержит упражнения и подходы `exercises[].sets[]`.
- `testrun` содержит результаты тестов и отдельные пробы `tests{}.trials[]`.
- `decision` содержит итог `closed{}` после оценки решения.

