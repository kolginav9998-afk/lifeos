#!/usr/bin/env python3
"""Разбор выгрузки Life OS: «Развитие → Аналитика → Выгрузка для анализа» (ZIP с таблицами CSV).

Только стандартная библиотека Python 3.9+. Ничего не отправляет в сеть и ничего не меняет.

    python3 analyze.py lifeos-analysis.zip                 # отчёт на экране
    python3 analyze.py lifeos-analysis.zip --out report.md # отчёт в файл

Что делает: смотрит, как результат проверок (composite) связан с сном, настроением, нагрузкой
и привычками; показывает тренд и средние по дням недели. Дни режима болезни исключаются.
Связь — это наблюдение, а не причина: для причины нужен эксперимент (одну вещь меняешь на 1–2 недели).
"""
import argparse
import csv
import datetime as dt
import io
import math
import random
import sys
import zipfile

# Что считаем причиной (фактором) и со сдвигом в днях: вечерние отметки дня D влияют на проверки дня D+1.
FACTORS = [
    ("sleepHours", 0, "Сон, часов"), ("sleepQuality", 0, "Качество сна"), ("moodMorning", 0, "Настроение утром"),
    ("energyMorning", 0, "Энергия утром"), ("stressMorning", 0, "Стресс утром"),
    ("caffeine", 1, "Кофе и чай накануне"), ("alcohol", 1, "Алкоголь накануне"), ("water", 1, "Вода накануне"),
    ("exercise", 1, "Движение накануне"), ("screen", 1, "Экран накануне"), ("outdoors", 1, "Время на улице накануне"),
    ("foodScore", 1, "Питание накануне"), ("habitsDone", 1, "Привычек накануне"), ("focusMin", 1, "Фокус накануне, минут"),
]
OUTCOME = "composite"
WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]


def read_table(zf, name):
    """Таблица из ZIP: список словарей. CSV в UTF-8 с BOM, пустая ячейка = нет значения."""
    try:
        raw = zf.read(name)
    except KeyError:
        return []
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline="")))


def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def ranks(xs):
    """Средние ранги (для Спирмена; равные значения получают общий ранг)."""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    out = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def pearson(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.sqrt(sxx * syy)


def spearman(xs, ys):
    return pearson(ranks(xs), ranks(ys))


def perm_p(xs, ys, rho, n=2000, seed=7):
    """Двусторонняя p-величина перестановочным тестом: как часто случайная перестановка даёт связь не слабее."""
    rng = random.Random(seed)
    rx, ry = ranks(xs), ranks(ys)
    hits = 0
    for _ in range(n):
        rng.shuffle(ry)
        r = pearson(rx, ry)
        if r is not None and abs(r) >= abs(rho) - 1e-12:
            hits += 1
    return (hits + 1) / (n + 1)


def bh_fdr(ps):
    """Поправка Бенджамини — Хохберга: q-значения в исходном порядке."""
    m = len(ps)
    order = sorted(range(m), key=lambda i: ps[i])
    q = [0.0] * m
    prev = 1.0
    for rank in range(m, 0, -1):
        i = order[rank - 1]
        prev = min(prev, ps[i] * m / rank)
        q[i] = prev
    return q


def slope(points):
    n = len(points)
    mx = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    sxx = sum((p[0] - mx) ** 2 for p in points)
    return 0.0 if sxx == 0 else sum((p[0] - mx) * (p[1] - my) for p in points) / sxx


def slope_ci(points, n=1000, seed=7):
    """Наклон прямой и 95% доверительный интервал (бутстреп по точкам)."""
    rng = random.Random(seed)
    base = slope(points)
    sl = sorted(slope([rng.choice(points) for _ in points]) for _ in range(n))
    return base, sl[int(0.025 * n)], sl[int(0.975 * n) - 1]


def daily_rows(zf):
    rows = {}
    for r in read_table(zf, "daily.csv"):
        try:
            d = dt.date.fromisoformat(r["date"])
        except (KeyError, ValueError):
            continue
        rows[d] = r
    return rows


def factor_pairs(rows, col, lag):
    """Пары (фактор, результат): фактор берём за lag дней до дня проверки; больные дни не берём."""
    xs, ys = [], []
    for d, r in rows.items():
        if r.get("sick") == "1":
            continue
        y = num(r.get(OUTCOME))
        src = rows.get(d - dt.timedelta(days=lag))
        x = num(src.get(col)) if src and src.get("sick") != "1" else None
        if x is not None and y is not None:
            xs.append(x)
            ys.append(y)
    return xs, ys


def fmt(x, d=2):
    return "—" if x is None else f"{x:.{d}f}".replace(".", ",")


def fmt_p(p):
    return "< 0,001" if p < 0.001 else "= " + fmt(p, 3)


def report(zf, min_pairs=20):
    rows = daily_rows(zf)
    healthy = {d: r for d, r in rows.items() if r.get("sick") != "1"}
    scored = [(d, num(r.get(OUTCOME))) for d, r in sorted(healthy.items()) if num(r.get(OUTCOME)) is not None]
    out = ["# Разбор выгрузки Life OS", ""]
    out.append(f"Дней в выгрузке: {len(rows)}; без режима болезни: {len(healthy)}; с результатом проверок: {len(scored)}.")
    runs = read_table(zf, "test_runs.csv")
    out.append(f"Прохождений проверок: {len(runs)}.")
    out.append("")
    if len(scored) < 2:
        out.append("Данных пока слишком мало: нужно хотя бы несколько дней с результатом проверок.")
        return "\n".join(out) + "\n"

    # ----- тренд -----
    first = scored[0][0]
    pts = [((d - first).days / 7.0, v) for d, v in scored]
    out += ["## Тренд результата", ""]
    if len(scored) >= 10:
        sl, lo, hi = slope_ci(pts)
        verdict = "растёт" if lo > 0 else "снижается" if hi < 0 else "заметного тренда нет (интервал включает ноль)"
        out.append(f"Наклон: {fmt(sl, 3)} σ в неделю (95% интервал от {fmt(lo, 3)} до {fmt(hi, 3)}): результат {verdict}.")
    else:
        out.append("Для тренда нужно хотя бы 10 дней с результатом.")
    out.append("")

    # ----- дни недели -----
    by_wd = {}
    for d, v in scored:
        by_wd.setdefault(d.weekday(), []).append(v)
    out += ["## По дням недели (средний результат, σ)", ""]
    for wd in range(7):
        vals = by_wd.get(wd, [])
        if len(vals) >= 3:
            out.append(f"- {WEEKDAYS[wd]}: {fmt(sum(vals) / len(vals))} (дней: {len(vals)})")
    out.append("")

    # ----- связи -----
    found = []
    for col, lag, title in FACTORS:
        xs, ys = factor_pairs(rows, col, lag)
        if len(xs) < min_pairs:
            continue
        rho = spearman(xs, ys)
        if rho is None:
            continue
        found.append({"title": title, "n": len(xs), "rho": rho, "p": perm_p(xs, ys, rho)})
    out += ["## Возможные связи с результатом проверок", ""]
    if not found:
        out.append(f"Пока ни для одного фактора нет хотя бы {min_pairs} дней с данными. Продолжай отмечать утро и вечер.")
    else:
        for f, q in zip(found, bh_fdr([f["p"] for f in found])):
            f["q"] = q
        found.sort(key=lambda f: -abs(f["rho"]))
        for f in found:
            mark = "возможная связь" if f["q"] < 0.1 else "связь не доказана"
            sign = "чем больше, тем выше результат" if f["rho"] > 0 else "чем больше, тем ниже результат"
            out.append(f"- {f['title']}: ρ = {fmt(f['rho'])}, дней: {f['n']}, p {fmt_p(f['p'])}, q {fmt_p(f['q'])} — {mark}" + (f" ({sign})" if f["q"] < 0.1 else ""))
        out += ["", "ρ — ранговая корреляция Спирмена; p — перестановочный тест; q — поправка на множество сравнений (чем меньше, тем надёжнее).", ""]
    out += ["Важно: это наблюдения за одним человеком. Они подсказывают, что проверить, но не доказывают причину.",
            "Чтобы проверить связь, измени одну вещь на 1–2 недели и сравни периоды."]
    return "\n".join(out) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description="Разбор выгрузки Life OS (ZIP).")
    ap.add_argument("archive", help="файл ZIP из приложения")
    ap.add_argument("--out", help="сохранить отчёт в файл (Markdown)")
    ap.add_argument("--min-pairs", type=int, default=20, help="минимум дней с данными для связи (по умолчанию 20)")
    a = ap.parse_args(argv)
    try:
        with zipfile.ZipFile(a.archive) as zf:
            bad = zf.testzip()
            if bad:
                print(f"Файл повреждён: {bad}", file=sys.stderr)
                return 2
            text = report(zf, a.min_pairs)
    except (OSError, zipfile.BadZipFile) as e:
        print(f"Не удалось открыть архив: {e}", file=sys.stderr)
        return 1
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"Отчёт сохранён: {a.out}")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
