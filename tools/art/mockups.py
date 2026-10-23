# Art-brief mockups: one PNG per character asset = 3/4 model render + actual-size pixel sprite (x6) + silhouette.
# Proportion/colour guides for outside artists, not final style. Runs inside Blender (reuses tools/blender/build.py):
#   blender -b --factory-startup -P tools/art/mockups.py -- [asset-id ...]     (or: npm run art:mockups)
# Output: docs/art/mockups/<id>.png. Docs: docs/art/brief.md
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'blender'))
import build as B  # noqa: E402

OUT = os.path.join(B.ROOT, 'docs', 'art', 'mockups')
GOLD = '#E3B04B'
SEAL = '#D2412F'

# Looks follow packages/client/src/art.ts (SECT_LOOK / ENEMY_LOOK) and GDD §3 (silhouette, weapon).
# kind: sect | enemy | boss. Sprite size per kind: brief spec v1 (48x64 characters, 128x128 bosses).
ASSETS = {
    'metal': ('sect', {'robe': '#D9E1EA', 'dark': '#8C99A8', 'hair': '#2A2030', 'accent': '#8C99A8', 'weapon': 'sword', 'scale': [1, 1, 1.05]}),
    'wood': ('sect', {'robe': '#5BC46A', 'dark': '#2E7A3C', 'hair': '#1E3A22', 'accent': '#2E7A3C', 'weapon': 'flute', 'scale': [0.88, 0.88, 1.02]}),
    'water': ('sect', {'robe': '#4FB3FF', 'dark': '#22609C', 'hair': '#DDE8F5', 'accent': '#22609C', 'weapon': 'palm'}),
    'fire': ('sect', {'robe': '#FF5A1F', 'dark': '#A02A10', 'hair': '#3A1210', 'accent': '#A02A10', 'weapon': 'fan', 'scale': [1.12, 1.05, 1]}),
    'earth': ('sect', {'robe': '#D98A2B', 'dark': '#8A4F18', 'hair': None, 'accent': GOLD, 'weapon': 'staff', 'scale': [1.22, 1.15, 1]}),
    'yinyang': ('sect', {'robe': '#F2F2F2', 'dark': '#3A3442', 'hair': '#1A1423', 'accent': '#1A1423', 'weapon': 'taiji'}),
    'cultist': ('enemy', {'robe': '#5A1820', 'dark': '#2A0A10', 'hair': '#120A10', 'accent': SEAL}),
    'runner': ('enemy', {'robe': '#3E5A2A', 'dark': '#1E2E14', 'hair': '#120A10', 'accent': SEAL, 'headband': SEAL, 'scale': [0.9, 0.9, 0.95]}),
    'brute': ('enemy', {'robe': '#6E6A78', 'dark': '#3A3642', 'hair': '#120A10', 'accent': SEAL, 'mask': '#3A3642', 'scale': [1.35, 1.25, 1.08]}),
    'leaper': ('enemy', {'robe': '#2E4A3A', 'dark': '#16261C', 'hair': '#120A10', 'accent': '#9BD17A', 'hood': '#16261C', 'scale': [0.9, 0.9, 0.9]}),
    'puppet': ('enemy', {'robe': '#3A5A7A', 'dark': '#1C2E40', 'hair': '#2A2A30', 'accent': '#8FB3D0', 'skin': '#C9D3D8', 'hat': '#1C2E40'}),
    'assassin': ('enemy', {'robe': '#1A1A24', 'dark': '#0A0A10', 'hair': '#0A0A10', 'accent': '#5A5266', 'hood': '#1A1A24', 'mask': '#0A0A10', 'weapon': 'sword'}),
    'healer': ('enemy', {'robe': '#8A2A1A', 'dark': '#4A140C', 'hair': None, 'accent': GOLD, 'weapon': 'staff'}),
    'mimic': ('enemy', {'robe': '#5A6A8A', 'dark': '#2E3648', 'hair': '#1A1423', 'accent': '#BFD0F0', 'weapon': 'sword'}),
    'boss_ch1': ('boss', {'robe': '#3E5A2A', 'dark': '#1E2E14', 'hair': '#120A10', 'accent': GOLD, 'weapon': 'sword', 'arms': 4, 'scale': [1.6, 1.5, 1.5]}),
    'boss_ch1b': ('boss', {'robe': '#8A2A1A', 'dark': '#2A0A10', 'hair': '#120A10', 'accent': SEAL, 'hood': '#5A1820', 'mask': GOLD, 'halo': SEAL, 'weapon': 'fan', 'scale': [1.5, 1.5, 1.6]}),
    'boss_final': ('boss', {'robe': '#F2F2F2', 'dark': '#1A1423', 'hair': '#1A1423', 'accent': SEAL, 'halo': '#1A1423', 'weapon': 'taiji', 'scale': [1.5, 1.5, 1.75]}),
}
SPRITE = {'sect': (48, 64), 'enemy': (48, 64), 'boss': (128, 128)}
BG = (0x2A, 0x2A, 0x33)

# 3x5 bitmap font for labels; each glyph is 5 rows of 3 columns, '#' = pixel.
FONT = {
    'A': '.#. #.# ### #.# #.#', 'B': '##. #.# ##. #.# ##.', 'C': '.## #.. #.. #.. .##', 'D': '##. #.# #.# #.# ##.',
    'E': '### #.. ##. #.. ###', 'F': '### #.. ##. #.. #..', 'G': '.## #.. #.# #.# .##', 'H': '#.# #.# ### #.# #.#',
    'I': '### .#. .#. .#. ###', 'J': '..# ..# ..# #.# .#.', 'K': '#.# #.# ##. #.# #.#', 'L': '#.. #.. #.. #.. ###',
    'M': '#.# ### ### #.# #.#', 'N': '##. #.# #.# #.# #.#', 'O': '.#. #.# #.# #.# .#.', 'P': '##. #.# ##. #.. #..',
    'Q': '.#. #.# #.# ### .##', 'R': '##. #.# ##. #.# #.#', 'S': '.## #.. .#. ..# ##.', 'T': '### .#. .#. .#. .#.',
    'U': '#.# #.# #.# #.# ###', 'V': '#.# #.# #.# #.# .#.', 'W': '#.# #.# ### ### #.#', 'X': '#.# #.# .#. #.# #.#',
    'Y': '#.# #.# .#. .#. .#.', 'Z': '### ..# .#. #.. ###',
    '0': '### #.# #.# #.# ###', '1': '.#. ##. .#. .#. ###', '2': '##. ..# .#. #.. ###', '3': '##. ..# .#. ..# ##.',
    '4': '#.# #.# ### ..# ..#', '5': '### #.. ##. ..# ##.', '6': '.## #.. ### #.# ###', '7': '### ..# .#. .#. .#.',
    '8': '### #.# ### #.# ###', '9': '### #.# ### ..# ##.',
    '/': '..# ..# .#. #.. #..', '-': '... ... ### ... ...', '_': '... ... ... ... ###', '.': '... ... ... ... .#.',
    ':': '... .#. ... .#. ...', '+': '... .#. ### .#. ...', '(': '.#. #.. #.. #.. .#.', ')': '.#. ..# ..# ..# .#.',
    ' ': '... ... ... ... ...',
}


def glyph(ch):
    return np.array([[c == '#' for c in row] for row in FONT.get(ch, FONT[' ']).split()])


def text(canvas, x, y, s, scale=3, colour=(0xE3, 0xB0, 0x4B)):
    for ch in s.upper():
        g = np.kron(glyph(ch), np.ones((scale, scale), dtype=bool))
        h, w = g.shape
        region = canvas[y:y + h, x:x + w, :3]
        region[g[:region.shape[0], :region.shape[1]]] = colour
        x += 4 * scale


def paste(canvas, img, x, y):
    h, w = img.shape[:2]
    a = img[..., 3:4] / 255.0
    canvas[y:y + h, x:x + w, :3] = (img[..., :3] * a + canvas[y:y + h, x:x + w, :3] * (1 - a)).astype(np.int32)


def upscale(img, k):
    return np.kron(img, np.ones((k, k, 1), dtype=np.int32))


def frame_camera(s, look):
    sz = max(look.get('scale', [1, 1, 1]))
    cz = 0.85 * look.get('scale', [1, 1, 1])[2]
    B.camera(s, (0, -6, cz + 6 * math.tan(math.radians(30))), (60, 0, 0), ortho_scale=2.1 * sz)


def render_model(look, w, h):
    s = B.reset(w, h, aa='8')
    s.display.shading.show_cavity = True
    B.figure(look)('idle', 0)
    frame_camera(s, look)
    return B.render_rgba(s)


def render_sprite(look, size, groups, data_pal):
    s = B.reset(*size)
    B.figure(look)('idle', 0)
    frame_camera(s, look)
    return B.pixelize(B.render_rgba(s), B.palette(groups, data_pal), True)


def mockup(asset_id, kind, look, data_pal, element):
    sw, sh = SPRITE[kind]
    k = 384 // sh
    groups = ['shared', element] if kind == 'sect' else ['shared', 'enemy', element]
    model = render_model(look, 384, 512)
    sprite = render_sprite(look, (sw, sh), groups, data_pal)
    sil = sprite.copy()
    sil[..., :3] = np.where(sil[..., 3:4] == 255, 0, sil[..., :3])
    big, bsil = upscale(sprite, k), upscale(sil, k)
    pad, top = 24, 70
    W = pad * 4 + 384 + big.shape[1] * 2
    H = top + 512 + 50
    canvas = np.zeros((H, W, 4), dtype=np.int32)
    canvas[...] = list(BG) + [255]
    text(canvas, pad, 18, f'{asset_id}  mockup: proportion + colour only', 4)
    x = pad
    paste(canvas, model, x, top)
    text(canvas, x, top + 512 + 14, 'model 3/4 view')
    x += 384 + pad
    paste(canvas, big, x, top + 64)
    text(canvas, x, top + 512 + 14, f'sprite {sw}x{sh} x{k}')
    x += big.shape[1] + pad
    sil_bg = np.zeros_like(bsil)
    sil_bg[...] = [0xC8, 0xC4, 0xCC, 255]
    paste(sil_bg, bsil, 0, 0)
    paste(canvas, sil_bg, x, top + 64)
    text(canvas, x, top + 512 + 14, 'silhouette')
    os.makedirs(OUT, exist_ok=True)
    B.save_png(canvas, os.path.join(OUT, asset_id + '.png'))
    print('mockup', asset_id, W, 'x', H)


def element_of(asset_id, kind):
    if kind == 'sect':
        return asset_id
    enemies = json.load(open(os.path.join(B.ROOT, 'docs/data/enemies.json'), encoding='utf-8'))
    return next(e['element'] for e in enemies['enemies'] + enemies['bosses'] if e['id'] == asset_id)


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    data_pal = json.load(open(os.path.join(B.ROOT, 'docs/data/effects.json'), encoding='utf-8'))['render']['palette']
    for asset_id, (kind, look) in ASSETS.items():
        if args and asset_id not in args:
            continue
        mockup(asset_id, kind, look, data_pal, element_of(asset_id, kind))


main()
