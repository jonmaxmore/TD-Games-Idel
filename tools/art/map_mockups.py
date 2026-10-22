# Map mockups for docs/art/map-design.md: one PNG per layout in docs/data/maps.json, drawn with the same placeholder
# shapes as packages/client/src/art.ts (props, gates, biome palette). Needs Pillow.
#   python3 tools/art/map_mockups.py        -> docs/art/mockups/map-<layout>.png
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
T, SCALE = 16, 3
OUT_C, SEAL, GOLD = '#1A1423', '#D2412F', '#E3B04B'


class Pen:
    def __init__(self, img, ox, oy):
        self.d, self.ox, self.oy = ImageDraw.Draw(img), ox, oy

    def rect(self, x, y, w, h, c):
        if w > 0 and h > 0:
            self.d.rectangle([self.ox + x, self.oy + y, self.ox + x + w - 1, self.oy + y + h - 1], fill=c)

    def disc(self, cx, cy, r, c):
        for j in range(-r, r + 1):
            for i in range(-r, r + 1):
                if i * i + j * j <= r * r + r:
                    self.rect(cx + i, cy + j, 1, 1, c)


def prop(p, t):
    r, d = p.rect, p.disc
    if t == 'house':
        r(2, 9, 12, 9, '#C9A27A'); r(2, 17, 12, 1, '#7A5A3A'); r(4, 11, 2, 2, '#FFE08A'); r(10, 11, 2, 2, '#FFE08A'); r(7, 13, 2, 5, '#4A2E1E')
        for i in range(6):
            r(1 + i, 8 - i, 14 - 2 * i, 1, OUT_C if i == 0 else '#5A1E28')
    elif t == 'tree':
        r(7, 13, 2, 6, '#4A2E1E'); d(8, 9, 6, '#173F1D'); d(7, 8, 4, '#225F2B'); d(6, 6, 2, '#2F833B')
    elif t == 'shrine':
        r(3, 8, 2, 11, SEAL); r(11, 8, 2, 11, SEAL); r(1, 6, 14, 2, OUT_C); r(2, 5, 12, 1, GOLD); r(6, 10, 4, 3, GOLD)
    elif t == 'bamboo':
        for x in (4, 8, 12):
            r(x, 2 + x % 3, 2, 17 - x % 3, '#4E8A5A')
            for y in range(6, 19, 5):
                r(x, y, 2, 1, '#2A5A3E')
            r(x + 2, 3 + x % 4, 2, 1, '#9FC7B4')
    elif t == 'ice':
        d(8, 14, 5, '#8EC3E8'); r(6, 7, 4, 8, '#C9E6F7'); r(7, 8, 1, 2, '#FFFFFF')
    elif t == 'stall':
        r(2, 12, 12, 7, '#7A2A1E'); r(3, 13, 10, 2, '#F2A23A')
        for i in range(12):
            r(2 + i, 8, 1, 3, '#ECE3CF' if i % 2 else SEAL)
    elif t == 'ruin':
        r(3, 9, 3, 10, '#4A4048'); r(10, 12, 3, 7, '#4A4048'); r(3, 8, 4, 1, '#6E6A78'); r(8, 17, 5, 2, '#3A1622')
    elif t == 'lantern':
        r(7, 12, 1, 7, '#4A2E1E'); d(8, 10, 3, SEAL); r(7, 9, 2, 2, '#FFE08A')
    elif t == 'roof':
        for y in range(6, 19, 3):
            r(0, y, 16, 2, '#7A2A2A' if y % 2 else '#5A1E28')
        r(0, 5, 16, 1, OUT_C)
    elif t == 'rice':
        for y in range(9, 19, 3):
            for x in range(1, 16, 3):
                r(x, y, 1, 1, '#5BC46A'); r(x, y - 1, 1, 1, '#9FDCA7')
    elif t == 'flag':
        r(4, 4, 1, 15, '#4A2E1E'); r(5, 4, 7, 5, SEAL); r(8, 6, 1, 1, GOLD)
    else:  # rock
        d(8, 15, 5, '#4A4048'); d(7, 14, 3, '#6E6A78'); r(6, 12, 1, 1, '#9A92AE')


def gate(p, t, goal):
    r, d = p.rect, p.disc
    if goal:
        pillar = '#7FE0D0' if t == 'jade-gate' else '#5A3A24' if t == 'bandit-camp' else SEAL
        r(3, 8, 3, 18, pillar); r(18, 8, 3, 18, pillar)
        r(0, 4, 24, 3, OUT_C); r(1, 3, 22, 1, GOLD); r(2, 9, 20, 2, OUT_C); r(8, 5, 8, 3, GOLD); r(10, 6, 4, 1, OUT_C)
        if t == 'bandit-camp':
            for x in range(7, 18, 2):
                r(x, 14, 1, 12, '#5A3A24')
    else:
        portal = t == 'demon-portal'
        d(12, 16, 10, '#5A1E28' if portal else '#4A4048'); d(12, 18, 7, SEAL if portal else '#120A10')
        d(12, 19, 5, '#24101A' if portal else '#0A0610'); r(0, 24, 24, 2, '#3A1622' if portal else '#3A3442')


def tiles(path):
    out = set()
    for (x0, y0), (x1, y1) in zip(path, path[1:]):
        sx, sy = (x1 > x0) - (x1 < x0), (y1 > y0) - (y1 < y0)
        x, y = x0, y0
        while True:
            out.add((x, y))
            if (x, y) == (x1, y1):
                break
            x += sx; y += sy
    return out


def board(maps, pal, name):
    l = maps['layouts'][name]
    biome = maps['biomes'][l['biome']]
    gw, gh = maps['grid']
    colours = pal[biome['palette']]
    img = Image.new('RGB', (gw * T, gh * T), colours[0])
    pen = Pen(img, 0, 0)
    for i in range(gw * gh * 3):
        pen.rect((i * 53) % (gw * T), (i * 97) % (gh * T), 2, 1, colours[1] if i % 3 else colours[2])
    routes = [l['path']] if l['kind'] == 'defend' else [l['start'] + l['left'] + l['end'], l['start'] + l['right'] + l['end']]
    path = set().union(*(tiles(r) for r in routes))
    for (x, y) in path:
        pen.rect(x * T, y * T, T, T, colours[3])
        if (x, y - 1) not in path:
            pen.rect(x * T, y * T, T, 1, colours[4])
        pen.rect(x * T + (x * 7 + y * 3) % 12 + 2, y * T + (x * 5 + y * 11) % 12 + 2, 2, 1, colours[4])
    order = sorted(l['props'], key=lambda p: (p['type'] not in ('roof', 'rice'), p['at'][1]))
    for p in order:
        x, y = p['at']
        prop(Pen(img, x * T, (y + 1) * T - 20), p['type'])
    for o in l.get('outposts', []):
        x, y = o['at']
        pen.rect(x * T + 2, y * T + 2, 12, 12, '#5A1820'); pen.rect(x * T + 6, y * T + 5, 4, 5, SEAL)
    sx, sy = routes[0][0]
    ex, ey = routes[0][-1]
    gate(Pen(img, sx * T + T // 2 - 12, (sy + 1) * T + 2 - 26), biome['spawnGate'], False)
    gate(Pen(img, ex * T + T // 2 - 12, (ey + 1) * T + 2 - 26), l.get('goalGate', biome['goalGate']), True)
    return img.resize((gw * T * SCALE, gh * T * SCALE), Image.NEAREST)


def main():
    maps = json.load(open(os.path.join(ROOT, 'docs/data/maps.json'), encoding='utf-8'))
    pal = json.load(open(os.path.join(ROOT, 'docs/data/effects.json'), encoding='utf-8'))['render']['palette']
    out = os.path.join(ROOT, 'docs/art/mockups')
    os.makedirs(out, exist_ok=True)
    for name in maps['layouts']:
        board(maps, pal, name).save(os.path.join(out, f'map-{name}.png'), optimize=True)
        print('map', name)


if __name__ == '__main__':
    main()
