#!/usr/bin/env python3
"""Делает иконки Life OS из assets/icon-source.webp: для сайта (icons/) и Android (assets/android-res/), а также заставку (splash).
Запуск: python3 scripts/make-icons.py   (нужен Pillow). Результат коммитится в репозиторий.
Только заставка: python3 scripts/make-icons.py --splash-only"""
import os
import sys
from PIL import Image, ImageDraw, ImageChops, ImageFilter

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SRC = os.path.join(ROOT, 'assets', 'icon-source.webp')
BG = (2, 8, 22)            # #020816 — тёмный фон иконки (совпадает с фоном аватарки)
SS = 4                     # суперсэмплинг для гладких краёв масок

art = Image.open(SRC).convert('RGB')
W = art.size[0]
# У исходника снизу ~12px чёрной кромки. Берём квадрат без неё (4..W-16).
art = art.crop((4, 4, W - 16, W - 16))
W = art.size[0]

def rounded_mask(size, radius_frac):
    s = size * SS
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_frac), fill=255)
    return m.resize((size, size), Image.LANCZOS)

def circle_mask(size, r_frac, feather_frac=0.0):
    """Круг радиуса r_frac*size (0..0.5) с мягким краем шириной feather_frac*size."""
    s = size * SS
    m = Image.new('L', (s, s), 0)
    d = ImageDraw.Draw(m)
    steps = 40 if feather_frac else 1
    for i in range(steps):
        t = i / max(steps - 1, 1)
        r = (r_frac - feather_frac * t) * s
        a = int(255 * (1 - t)) if feather_frac else 255
        # рисуем от внешнего к внутреннему, наращивая непрозрачность
    # проще: градиент по расстоянию
    px = m.load()
    c = s / 2
    r_in = (r_frac - feather_frac) * s
    r_out = r_frac * s
    for y in range(s):
        for x in range(s):
            dist = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
            if dist <= r_in: px[x, y] = 255
            elif dist >= r_out: px[x, y] = 0
            else: px[x, y] = int(255 * (r_out - dist) / (r_out - r_in))
    return m.resize((size, size), Image.LANCZOS)

def art_at(size):
    return art.resize((size, size), Image.LANCZOS)

def rounded_icon(size):                 # аватарка со скруглёнными углами, углы прозрачные
    im = art_at(size).convert('RGBA')
    im.putalpha(rounded_mask(size, 0.25))
    return im

def round_icon(size):                   # круглая версия (Android round)
    im = art_at(size).convert('RGBA')
    im.putalpha(circle_mask(size, 0.5))
    return im

def motif(size, scale=1.0):
    """Центр аватарки (шестигранник + кольцо) с мягким краем на прозрачном фоне."""
    inner = int(size * scale)
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    a = art_at(inner).convert('RGBA')
    a.putalpha(circle_mask(inner, 0.46, 0.10))
    layer.alpha_composite(a, ((size - inner) // 2, (size - inner) // 2))
    return layer

def full_bleed(size, scale=1.0):        # сплошной квадрат для maskable-иконки
    base = Image.new('RGBA', (size, size), BG + (255,))
    base.alpha_composite(motif(size, scale))
    return base

def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)

SPLASH_ONLY = '--splash-only' in sys.argv

# Сайт
if not SPLASH_ONLY:
  save(rounded_icon(192), f'{ROOT}/icons/icon-192.png')
  save(rounded_icon(512), f'{ROOT}/icons/icon-512.png')
  save(full_bleed(512, 0.94), f'{ROOT}/icons/icon-maskable-512.png')
  # Android: legacy + adaptive foreground (108dp, мотив внутри безопасной зоны)
  for dens, legacy, fg in [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216), ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]:
    d = f'{ROOT}/assets/android-res/mipmap-{dens}'
    save(rounded_icon(legacy), f'{d}/ic_launcher.png')
    save(round_icon(legacy), f'{d}/ic_launcher_round.png')
    save(motif(fg, 0.84), f'{d}/ic_launcher_foreground.png')

# Заставка при запуске (Android до 12 показывает этот рисунок; размеры повторяют шаблон Capacitor): тёмный фон со свечением и значком.
def splash(w, h):
    top, bot = (12, 13, 31), (7, 8, 18)
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    cx, cy, r = w // 2, int(h * 0.46), int(min(w, h) * 0.40)
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx - r, cy - r, cx + r, cy + r], fill=(124, 92, 255, 110))
    glow = glow.filter(ImageFilter.GaussianBlur(r * 0.55))
    out = Image.alpha_composite(im.convert('RGBA'), glow)
    size = int(min(w, h) * 0.26)
    out.alpha_composite(rounded_icon(size), (cx - size // 2, cy - size // 2))
    return out.convert('RGB')

for folder, w, h in [('drawable', 480, 320), ('drawable-land-mdpi', 480, 320), ('drawable-land-hdpi', 800, 480), ('drawable-land-xhdpi', 1280, 720), ('drawable-land-xxhdpi', 1600, 960),
                     ('drawable-land-xxxhdpi', 1920, 1280), ('drawable-port-mdpi', 320, 480), ('drawable-port-hdpi', 480, 800), ('drawable-port-xhdpi', 720, 1280),
                     ('drawable-port-xxhdpi', 960, 1600), ('drawable-port-xxxhdpi', 1280, 1920)]:
    save(splash(w, h), f'{ROOT}/assets/android-res/{folder}/splash.png')
print('ok')
