# Layout mockups (not final art) for docs/art/world-base-design.md:
#   world map of chapter 1 (stage nodes from docs/data/stages.json) and the player's sect base.
#   python3 tools/art/screen_mockups.py   -> docs/art/mockups/world-ch1.png, docs/art/mockups/sect-base.png
import json
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
W, H, S = 360, 640, 2
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
THAI = [p for p in ('/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf', '/usr/share/fonts/opentype/tlwg/Loma-Bold.otf') if os.path.exists(p)]
ICON = {'defend': 'D', 'assault': 'A', 'escort': 'E', 'siege': 'S', 'boss': 'B', 'puzzle': 'P', 'training': 'T', 'secret': '?'}
TYPE_COL = {'defend': '#4FB3FF', 'assault': '#D2412F', 'escort': '#5BC46A', 'siege': '#F2A23A', 'boss': '#8A2A2A', 'puzzle': '#C8C4CC', 'secret': '#E3B04B'}


def font(size, thai=False):
    path = THAI[0] if thai and THAI else FONT
    return ImageFont.truetype(path, size * S)


def world_ch1(stages):
    img = Image.new('RGB', (W * S, H * S), '#16201A')
    d = ImageDraw.Draw(img)
    sc = lambda *v: [x * S for x in v]
    # terrain bands: mountains top, terraces middle, river bottom
    d.rectangle(sc(0, 0, W, 120), fill='#2A1E3A')
    for i in range(6):
        d.polygon(sc(i * 70 - 20, 120, i * 70 + 40, 40 + (i % 3) * 15, i * 70 + 100, 120), fill='#3A3442')
    for y in range(140, 520, 26):
        d.rectangle(sc(0, y, W, y + 3), fill='#1E2B22')
    d.rectangle(sc(0, 560, W, 640), fill='#16324A')
    nodes = [s for s in stages if s['chapter'] == 1]
    # winding route bottom -> top, 4 nodes per row
    pts = []
    for i, _ in enumerate(nodes):
        row, col = divmod(i, 4)
        x = 60 + (col if row % 2 == 0 else 3 - col) * 80
        y = 520 - row * 120
        pts.append((x, y))
    d.line([c for p in pts for c in sc(*p)], fill='#3B2C2A', width=10 * S, joint='curve')
    for (x, y), st in zip(pts, nodes):
        big = st['type'] == 'boss'
        r = 26 if big else 18
        col = TYPE_COL.get(st['type'], '#9A92AE')
        d.ellipse(sc(x - r - 3, y - r - 3, x + r + 3, y + r + 3), fill='#1A1423')
        d.ellipse(sc(x - r, y - r, x + r, y + r), fill=col)
        d.text((x * S, (y - 4) * S), st['id'], fill='#FFFFFF', font=font(10), anchor='mm')
        d.text((x * S, (y + 9) * S), ICON.get(st['type'], '?'), fill='#1A1423', font=font(8), anchor='mm')
        d.text((x * S, (y + r + 9) * S), '***', fill='#E3B04B', font=font(8), anchor='mm')
    # boss landmark + secret stage + star gate to chapter 2
    bx, by = pts[-1]
    d.rectangle(sc(bx - 40, by - 90, bx + 40, by - 40), fill='#5A1E28'); d.polygon(sc(bx - 50, by - 90, bx, by - 120, bx + 50, by - 90), fill='#1A1423')
    d.ellipse(sc(300, 140, 340, 180), fill='#E3B04B'); d.text((320 * S, 160 * S), 'S1', fill='#1A1423', font=font(10), anchor='mm')
    d.text((320 * S, 190 * S), '30*', fill='#E3B04B', font=font(8), anchor='mm')
    d.rectangle(sc(130, 8, 230, 34), fill='#0E0B14'); d.text((180 * S, 21 * S), 'LOCK 2: 25*', fill='#ECE3CF', font=font(9), anchor='mm')
    # HUD frame
    d.rectangle(sc(0, 600, W, 640), fill='#0E0B14')
    for i, lab in enumerate(['MAP', 'BASE', 'PVP', 'SHOP', 'GUILD']):
        d.text(((36 + i * 72) * S, 620 * S), lab, fill='#E3B04B' if i == 0 else '#9A92AE', font=font(9), anchor='mm')
    d.text((8 * S, 128 * S), 'CH1 Foothill Village', fill='#ECE3CF', font=font(11))
    d.text((8 * S, 142 * S), 'D defend  A assault  E escort  S siege  B boss  P puzzle  ? secret', fill='#9A92AE', font=font(6))
    return img


def sect_base():
    img = Image.new('RGB', (W * S, H * S), '#3B2C2A')
    d = ImageDraw.Draw(img)
    sc = lambda *v: [x * S for x in v]
    d.rectangle(sc(12, 70, W - 12, 590), fill='#4A3833', outline='#1A1423', width=3 * S)  # courtyard wall
    d.rectangle(sc(170, 120, 190, 590), fill='#5E4A42')                                  # central avenue
    d.rectangle(sc(40, 250, 320, 268), fill='#5E4A42')
    blocks = [
        ('MAIN HALL', 'ตำหนักหลัก: ขั้นบำเพ็ญ / prestige', 120, 150, 240, 240, '#5A1E28'),
        ('TRAINING HALL', 'หอฝึกยุทธ์: บัฟดาเมจ', 30, 90, 150, 150, '#6B8AAD'),
        ('SCRIPTURE LIB.', 'หอคัมภีร์: research / คัมภีร์', 210, 90, 330, 150, '#2F833B'),
        ('SWORD FORGE', 'โรงหลอมกระบี่: เงินเริ่มต้น', 30, 290, 150, 360, '#B12F00'),
        ('HERB GARDEN', 'สวนสมุนไพร: ยา/ฟื้นชีวิต', 210, 290, 330, 360, '#5BC46A'),
        ('MEDITATION YARD', 'ลานบำเพ็ญ: ปราณออฟไลน์', 30, 390, 150, 470, '#C8C4CC'),
        ('FORTUNE SHRINE', 'ศาลาเสี่ยงเซียมซี (gacha)', 210, 390, 330, 470, '#E3B04B'),
        ('SECT GATE', 'ประตูสำนัก: แผนป้องกัน PvP', 130, 520, 230, 588, '#D2412F'),
    ]
    for name, th, x0, y0, x1, y1, col in blocks:
        d.rectangle(sc(x0, y0, x1, y1), fill=col, outline='#1A1423', width=2 * S)
        d.rectangle(sc(x0 + 4, y1 - 22, x1 - 4, y1 - 4), fill='#0E0B14')
        d.text(((x0 + x1) // 2 * S, (y1 - 13) * S), name, fill='#ECE3CF', font=font(8), anchor='mm')
        d.text(((x0 + x1) // 2 * S, (y0 + 14) * S), th, fill='#ECE3CF' if sum(int(col[i:i + 2], 16) for i in (1, 3, 5)) < 360 else '#1A1423', font=font(7, thai=True), anchor='mm')
    d.rectangle(sc(0, 0, W, 40), fill='#0E0B14')
    d.text((8 * S, 20 * S), 'silver  qi  jade  merit', fill='#E3B04B', font=font(10), anchor='lm')
    d.rectangle(sc(0, 600, W, 640), fill='#0E0B14')
    for i, lab in enumerate(['MAP', 'BASE', 'PVP', 'SHOP', 'GUILD']):
        d.text(((36 + i * 72) * S, 620 * S), lab, fill='#E3B04B' if i == 1 else '#9A92AE', font=font(9), anchor='mm')
    return img


def main():
    stages = json.load(open(os.path.join(ROOT, 'docs/data/stages.json'), encoding='utf-8'))['stages']
    out = os.path.join(ROOT, 'docs/art/mockups')
    world_ch1(stages).save(os.path.join(out, 'world-ch1.png'), optimize=True)
    sect_base().save(os.path.join(out, 'sect-base.png'), optimize=True)
    print('world-ch1, sect-base')


if __name__ == '__main__':
    main()
