#!/usr/bin/env python3
"""Рисует иконки Life OS: для сайта (icons/) и для Android (assets/android-res/).
Запуск: python3 scripts/make-icons.py   (нужен Pillow). Результат коммитится в репозиторий."""
import os
from PIL import Image, ImageDraw

BG = (15, 17, 21)          # #0f1115
BLUE = (91, 157, 255)      # #5b9dff
SS = 4                     # суперсэмплинг для гладких краёв

def mark(size, scale):
    """Синий круг с белой галочкой на прозрачном фоне. scale — доля холста, занятая кругом."""
    s = size * SS
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = s * scale / 2
    c = s / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill=BLUE + (255,))
    w = max(2, int(r * 0.22))
    pts = [(c - r * 0.42, c + r * 0.02), (c - r * 0.10, c + r * 0.34), (c + r * 0.46, c - r * 0.30)]
    d.line(pts, fill=(255, 255, 255, 255), width=w, joint='curve')
    for x, y in (pts[0], pts[-1]):          # круглые концы линии
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=(255, 255, 255, 255))
    return im.resize((size, size), Image.LANCZOS)

def on_bg(size, scale, shape):
    s = size * SS
    base = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)
    if shape == 'round':
        d.ellipse([0, 0, s - 1, s - 1], fill=BG + (255,))
    elif shape == 'square':      # для maskable/любых: сплошной фон
        d.rectangle([0, 0, s, s], fill=BG + (255,))
    else:                         # скруглённый квадрат (устаревшие лаунчеры)
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG + (255,))
    base = base.resize((size, size), Image.LANCZOS)
    base.alpha_composite(mark(size, scale))
    return base

def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
# Сайт
save(on_bg(192, 0.62, 'rounded'), f'{root}/icons/icon-192.png')
save(on_bg(512, 0.62, 'rounded'), f'{root}/icons/icon-512.png')
save(on_bg(512, 0.50, 'square'), f'{root}/icons/icon-maskable-512.png')   # круг внутри безопасной зоны 80%
# Android: legacy (48dp-сетка) + adaptive foreground (108dp, круг в безопасной зоне 66%)
for dens, legacy, fg in [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216), ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]:
    d = f'{root}/assets/android-res/mipmap-{dens}'
    save(on_bg(legacy, 0.62, 'rounded'), f'{d}/ic_launcher.png')
    save(on_bg(legacy, 0.62, 'round'), f'{d}/ic_launcher_round.png')
    save(mark(fg, 0.50), f'{d}/ic_launcher_foreground.png')
print('ok')
