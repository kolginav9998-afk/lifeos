#!/usr/bin/env python3
"""Рисует спокойную иконку «Компаса»: матовый шиферно-синий фон, тонкое кольцо,
стрелка компаса в приглушённом бирюзовом, тёплая точка в центре. Без неона и свечения."""
from PIL import Image, ImageDraw, ImageFilter

S = 4                       # суперсэмплинг
W = 1040                    # исходник; make-icons.py обрежет до (4,4,W-16,W-16)
w = W * S

# Палитра (спокойная, приглушённая)
BG_TOP = (51, 62, 76)       # #333e4c шиферно-синий
BG_BOT = (34, 42, 53)       # #222a35 глубокий графит
RING = (154, 171, 181)      # #9aabb5 приглушённый серо-голубой
TICK = (122, 139, 150)      # #7a8b96
NEEDLE_N = (127, 184, 171)  # #7fb8ab спокойный бирюзово-шалфейный
NEEDLE_S = (96, 111, 125)   # #606f7d мягкий серый
DOT = (216, 185, 138)       # #d8b98a тёплый приглушённый янтарный

im = Image.new('RGB', (w, w))
d = ImageDraw.Draw(im)

# Фон: мягкий вертикальный градиент + едва заметное радиальное высветление сверху
for y in range(w):
    t = y / (w - 1)
    d.line([(0, y), (w, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))

c = w / 2

def polar(angle_deg, r):
    import math
    a = math.radians(angle_deg - 90)   # 0° = вверх
    return (c + r * math.cos(a), c + r * math.sin(a))

# Тонкое кольцо
ring_r = int(w * 0.335)
ring_w = max(2, int(w * 0.012))
d.ellipse([c - ring_r, c - ring_r, c + ring_r, c + ring_r], outline=RING, width=ring_w)

# Кардинальные засечки (N длиннее), промежуточные короче
for k in range(8):
    ang = k * 45
    long = (k % 2 == 0)
    r0 = ring_r - int(w * (0.052 if long else 0.032))
    r1 = ring_r - int(w * 0.012)
    p0, p1 = polar(ang, r0), polar(ang, r1)
    d.line([p0, p1], fill=(RING if k == 0 else TICK), width=(ring_w if long else max(1, ring_w - S)))

# Стрелка компаса: вытянутый ромб, северная половина бирюзовая, южная серая.
# Лёгкий разворот (как настоящий компас), тонкие грани.
import math
rot = -18
L = int(w * 0.25)           # длина половины стрелки
HW = int(w * 0.060)         # полуширина у основания

def rp(angle_deg, r):
    return polar(angle_deg + rot, r)

north = rp(0, L)
south = rp(180, int(L * 0.78))
east = rp(90, HW)
west = rp(270, HW)
center = (c, c)
d.polygon([north, east, center, west], fill=NEEDLE_N)
d.polygon([south, east, center, west], fill=NEEDLE_S)

# Тонкая тёмная кромка между половинами для чёткости
edge = tuple(int((BG_BOT[i] + 20) * 0.6) for i in range(3))
d.line([north, center], fill=edge, width=max(1, S))
d.line([south, center], fill=edge, width=max(1, S))

# Центральная точка: тёплая, с тонким кольцом фона вокруг
dot_r = int(w * 0.030)
d.ellipse([c - dot_r - S * 2, c - dot_r - S * 2, c + dot_r + S * 2, c + dot_r + S * 2], fill=BG_BOT)
d.ellipse([c - dot_r, c - dot_r, c + dot_r, c + dot_r], fill=DOT)

im = im.resize((W, W), Image.LANCZOS)
out = 'assets/icon-source.webp'
im.save(out, 'WEBP', quality=95, method=6)
print('saved', out)
