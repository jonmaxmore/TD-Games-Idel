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
    out = os.path.join(ROOT, 'docs/art/mockups')
    sect_base().save(os.path.join(out, 'sect-base.png'), optimize=True)
    print('world-ch1, sect-base')


if __name__ == '__main__':
    main()
