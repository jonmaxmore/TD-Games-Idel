# Blender art pipeline: art/manifest.json -> pixel sprite sheets + Phaser JSON-hash atlases (+ promo renders).
# Runs inside Blender (needs only Blender; numpy ships with it):
#   blender -b --factory-startup -P tools/blender/build.py -- [art/manifest.json] [asset-id ...]
# Usually called through `npm run art:build` (tools/blender/build.mjs finds Blender). Docs: docs/tools/blender.md
import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUTLINE = '#1A1423'


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def lin(h):
    # Material colours are scene-linear; with the Standard view transform the render shows the sRGB hex again.
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(c(v) for v in hex_rgb(h)) + (1.0,)


# ---------- scene ----------

_mats = {}

def reset(w, h, transparent=True, aa='OFF'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    s = bpy.context.scene
    s.render.engine = 'BLENDER_WORKBENCH'
    s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = w, h, 100
    s.render.film_transparent = transparent
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.display.render_aa = aa
    s.view_settings.view_transform = 'Standard'
    sh = s.display.shading
    sh.light, sh.color_type = 'STUDIO', 'MATERIAL'
    sh.show_specular_highlight = False
    return s


def camera(s, loc, rot_deg, ortho_scale=None, lens=50):
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    s.collection.objects.link(cam)
    cam.location, cam.rotation_euler = loc, [math.radians(a) for a in rot_deg]
    if ortho_scale:
        cam.data.type, cam.data.ortho_scale = 'ORTHO', ortho_scale
    else:
        cam.data.lens = lens
    s.camera = cam


def mat(h):
    if h not in _mats:
        m = bpy.data.materials.new(h)
        m.diffuse_color = lin(h)
        _mats[h] = m
    return _mats[h]


def part(kind, parent, colour, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), **kw):
    add = {'cyl': bpy.ops.mesh.primitive_cylinder_add, 'cone': bpy.ops.mesh.primitive_cone_add,
           'ball': bpy.ops.mesh.primitive_uv_sphere_add, 'box': bpy.ops.mesh.primitive_cube_add}[kind]
    add(location=loc, rotation=[math.radians(a) for a in rot], **kw)
    o = bpy.context.object
    o.scale = scale
    o.data.materials.append(mat(colour))
    o.parent = parent
    return o


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.location, o.parent = loc, parent
    return o


# ---------- proxies (stand-ins until an artist .blend exists) ----------

def figure(look, at=(0, 0, 0), turn=-35):
    """Chibi wuxia figure from primitives, ~1.6 units tall. Returns pose(action, t).
    Optional look keys (absent = the plain figure): weapon sword|flute|palm|fan|staff|taiji, scale [x, y, z],
    hat, hood, mask, headband (colours), arms (extra arm pairs), halo (colour of a disc behind the head)."""
    root = empty('root', at)
    root.rotation_euler[2] = math.radians(turn)
    body = empty('body', parent=root)
    skin, robe, dark, accent = look.get('skin', '#F2C9A0'), look['robe'], look['dark'], look['accent']
    hair = look.get('hair') or skin
    part('cone', body, robe, (0, 0, 0.36), vertices=12, radius1=0.42, radius2=0.24, depth=0.72)
    part('cyl', body, dark, (0, 0, 0.04), vertices=12, radius=0.43, depth=0.08)
    part('cyl', body, accent, (0, 0, 0.62), vertices=12, radius=0.27, depth=0.08)
    part('cyl', body, robe, (0, 0, 0.82), vertices=12, radius=0.25, depth=0.32)
    part('ball', body, skin, (0, 0, 1.2), segments=16, ring_count=10, radius=0.3)
    if look.get('hair', '') is not None:  # hair: None = bald (monk)
        part('ball', body, hair, (0, 0.09, 1.3), (1.04, 1, 0.7), segments=16, ring_count=10, radius=0.31)
        part('ball', body, hair, (0, 0.12, 1.58), segments=10, ring_count=8, radius=0.1)
    for x in (-0.11, 0.11):
        part('box', body, OUTLINE, (x, -0.29, 1.17), (0.05, 0.02, 0.07), size=1)
    arm = empty('arm', (0.27, 0, 0.9), body)
    part('cyl', arm, robe, (0, 0, -0.16), vertices=8, radius=0.08, depth=0.34)
    part('ball', arm, skin, (0, 0, -0.36), segments=8, ring_count=6, radius=0.07)
    part('cyl', body, robe, (-0.27, 0, 0.74), vertices=8, radius=0.08, depth=0.34)
    weapon = look.get('weapon')
    if weapon == 'sword':
        part('box', arm, '#EEF3F8', (0, -0.05, 0.04), (0.035, 0.035, 0.78), size=1)
        part('box', arm, '#E3B04B', (0, -0.05, -0.36), (0.16, 0.05, 0.04), size=1)
    elif weapon == 'flute':
        part('box', arm, '#9BD17A', (-0.18, -0.12, -0.36), (0.56, 0.045, 0.045), size=1)
    elif weapon == 'palm':
        part('ball', arm, '#BFE6FF', (0, -0.14, -0.4), segments=10, ring_count=8, radius=0.11)
        part('ball', body, '#BFE6FF', (-0.27, -0.14, 0.52), segments=10, ring_count=8, radius=0.11)
    elif weapon == 'fan':
        part('cyl', arm, '#FFB347', (0, -0.12, -0.3), (1, 1, 1), (90, 0, 0), vertices=12, radius=0.26, depth=0.03)
    elif weapon == 'staff':
        part('cyl', arm, '#8A5A2B', (0, -0.08, -0.1), vertices=8, radius=0.035, depth=1.7)
        for z in (0.72, -0.92):
            part('cyl', arm, '#E3B04B', (0, -0.08, z), vertices=8, radius=0.05, depth=0.08)
    elif weapon == 'taiji':
        part('box', arm, '#8A5A2B', (0, -0.08, -0.2), (0.03, 0.03, 0.42), size=1)
        part('ball', arm, '#F2F2F2', (0, -0.08, -0.48), (1, 1, 1.6), segments=8, ring_count=6, radius=0.07)
        part('cyl', body, '#F2F2F2', (0.12, 0.25, 1.78), (1, 1, 1), (70, 0, 0), vertices=16, radius=0.17, depth=0.03)
        part('ball', body, '#1A1423', (0.04, 0.22, 1.79), segments=8, ring_count=6, radius=0.07)
    if look.get('hat'):
        part('cone', body, look['hat'], (0, 0.02, 1.48), vertices=16, radius1=0.5, radius2=0.03, depth=0.26)
    if look.get('hood'):
        part('ball', body, look['hood'], (0, 0.06, 1.26), (1.08, 1.05, 1.0), segments=16, ring_count=10, radius=0.33)
    if look.get('mask'):
        part('box', body, look['mask'], (0, -0.27, 1.08), (0.5, 0.08, 0.14), size=1)
    if look.get('headband'):
        part('cyl', body, look['headband'], (0, 0, 1.27), vertices=16, radius=0.31, depth=0.06)
    for i in range(look.get('arms', 0)):
        side = 1 if i % 2 == 0 else -1
        a = empty('xarm', (0.3 * side, 0.05, 0.8 - 0.1 * (i // 2)), body)
        a.rotation_euler[1] = math.radians(40 * side)
        part('cyl', a, robe, (0, 0, -0.16), vertices=8, radius=0.07, depth=0.32)
        part('box', a, '#9FB3CA', (0, -0.05, -0.38), (0.04, 0.04, 0.16), size=1)
    if look.get('halo'):
        part('cyl', body, look['halo'], (0, 0.45, 1.3), (1, 1, 1), (70, 0, 0), vertices=24, radius=0.55, depth=0.02)
    if look.get('scale'):
        body.scale = look['scale']

    def pose(action, t):
        wave = math.sin(2 * math.pi * t)
        body.location = (0, 0, 0)
        body.rotation_euler = (0, 0, 0)
        arm.rotation_euler = (0, 0, 0)
        if action == 'idle':
            body.location[2] = 0.03 * wave
        elif action == 'walk':
            body.location[2] = 0.06 * abs(wave)
            body.rotation_euler[1] = math.radians(6) * wave
        elif action == 'attack':
            arm.rotation_euler[1] = math.radians(-150 + 210 * min(1, t * 1.6))
            body.rotation_euler[1] = math.radians(8) * min(1, t * 1.6)
        elif action == 'die':
            body.rotation_euler[1] = math.radians(90) * min(1, t * 1.4)
            body.location[2] = -0.25 * min(1, t * 1.4)
    return pose


def slash(look):
    curve = bpy.data.curves.new('slash', 'CURVE')
    curve.dimensions = '3D'
    obj = bpy.data.objects.new('slash', curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat(look['core']))

    def pose(action, t):
        curve.splines.clear()
        a0, a1 = -60 + 200 * max(0, t - 0.35), -60 + 200 * min(1, t * 1.6)
        sp = curve.splines.new('POLY')
        n = 16
        sp.points.add(n - 1)
        for i in range(n):
            a = math.radians(a0 + (a1 - a0) * i / (n - 1))
            sp.points[i].co = (0.62 * math.cos(a), 0, 0.75 + 0.62 * math.sin(a), 1)
        curve.bevel_depth = 0.07 * (1 - 0.7 * t)
    return pose


def tile(look, seed):
    bpy.ops.mesh.primitive_plane_add(size=1)
    bpy.context.object.data.materials.append(mat(look['base']))
    for i in range(7):  # deterministic speckles, no RNG
        x, y = ((i * 37 + seed * 11) % 13) / 13 - 0.46, ((i * 53 + seed * 7) % 11) / 11 - 0.46
        bpy.ops.mesh.primitive_cube_add(size=0.07, location=(x, y, 0.02))
        bpy.context.object.data.materials.append(mat(look['speck']))
    return lambda action, t: None


# ---------- pixel pass ----------

def palette(groups, data_pal):
    cols = [hex_rgb(c) for g in groups for c in data_pal[g]]
    return np.array(cols, dtype=np.int32)


def render_rgba(s):
    path = os.path.join(tempfile.gettempdir(), 'fs_frame.png')
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = (np.array(img.pixels[:]).reshape(h, w, 4)[::-1] * 255 + 0.5).astype(np.int32)
    bpy.data.images.remove(img)
    return px


def pixelize(px, pal, outline):
    rgb, a = px[..., :3], px[..., 3]
    d = ((rgb[:, :, None, :] - pal[None, None]) ** 2).sum(-1)
    out = np.zeros_like(px)
    out[..., :3] = pal[d.argmin(-1)]
    out[..., 3] = np.where(a >= 128, 255, 0)
    if outline:
        solid = out[..., 3] == 255
        near = np.zeros_like(solid)
        near[1:] |= solid[:-1]; near[:-1] |= solid[1:]; near[:, 1:] |= solid[:, :-1]; near[:, :-1] |= solid[:, 1:]
        edge = near & ~solid
        out[edge] = list(hex_rgb(OUTLINE)) + [255]
    return out


def save_png(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new('out', w, h, alpha=True)
    img.pixels[:] = (arr[::-1].astype(np.float32) / 255).ravel()
    img.filepath_raw, img.file_format = path, 'PNG'
    img.save()
    bpy.data.images.remove(img)


# ---------- assets ----------

def frame_size(asset, render):
    size = render[asset['size']] if isinstance(asset['size'], str) else asset['size']
    return (size, size) if isinstance(size, int) else tuple(size)


def build_sprite(asset, render, out_dir):
    w, h = frame_size(asset, render)
    s = reset(w, h)
    src, kind = asset['source'], asset['kind']
    if 'blend' in src:
        bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, src['blend']))
        s = bpy.context.scene
        reset_keep = (w, h)  # artist file: keep its objects, force our render settings
        s.render.engine = 'BLENDER_WORKBENCH'
        s.render.resolution_x, s.render.resolution_y = reset_keep
        s.render.film_transparent, s.display.render_aa = True, 'OFF'
        s.view_settings.view_transform = 'Standard'
        obj = bpy.data.objects[src['object']]

        def pose(action, t):
            act = bpy.data.actions[src.get('actions', {}).get(action, action)]
            obj.animation_data.action = act
            f0, f1 = act.frame_range
            s.frame_set(int(round(f0 + (f1 - f0) * t)))
    elif src['proxy'] == 'figure':
        pose = figure(src['look'])
    elif src['proxy'] == 'slash':
        pose = slash(src['look'])
    else:
        pose = tile(src['look'], sum(map(ord, asset['id'])))
    if kind == 'tile':  # flat light so terrain keeps its exact palette colours from straight above
        s.display.shading.light = 'FLAT'
        camera(s, (0, 0, 5), (0, 0, 0), ortho_scale=1)
    else:  # 3/4 view from the front, above
        camera(s, (0, -6, 0.85 + 6 * math.tan(math.radians(30))), (60, 0, 0), ortho_scale=2.1)

    pal = palette(asset['palette'], render['palette'])
    rows, frames = [], {}
    for r, (action, n) in enumerate(asset['actions'].items()):
        row = []
        for i in range(n):
            pose(action, i / n)
            row.append(pixelize(render_rgba(s), pal, asset.get('outline', False)))
            frames[f'{action}/{i}'] = {'frame': {'x': i * w, 'y': r * h, 'w': w, 'h': h}, 'rotated': False, 'trimmed': False,
                                        'spriteSourceSize': {'x': 0, 'y': 0, 'w': w, 'h': h}, 'sourceSize': {'w': w, 'h': h}}
        rows.append(row)
    cols = max(len(r) for r in rows)
    sheet = np.zeros((h * len(rows), w * cols, 4), dtype=np.int32)
    for r, row in enumerate(rows):
        for i, f in enumerate(row):
            sheet[r * h:(r + 1) * h, i * w:(i + 1) * w] = f
    os.makedirs(out_dir, exist_ok=True)
    save_png(sheet, os.path.join(out_dir, asset['id'] + '.png'))
    atlas = {'frames': frames, 'meta': {'image': asset['id'] + '.png', 'size': {'w': w * cols, 'h': h * len(rows)}, 'scale': '1',
                                         'app': 'tools/blender/build.py', 'actions': asset['actions']}}
    with open(os.path.join(out_dir, asset['id'] + '.json'), 'w') as f:
        json.dump(atlas, f, indent=1)
        f.write('\n')
    print('sprite', asset['id'], sheet.shape[1], 'x', sheet.shape[0], len(frames), 'frames')


def build_promo(asset, render):
    w, h = asset['size']
    s = reset(w, h, transparent=False, aa='8')
    s.display.shading.show_cavity = True
    s.world = bpy.data.worlds.new('sky')
    s.display.shading.background_type = 'VIEWPORT'
    s.display.shading.background_color = lin('#2A1E3A')[:3]
    bpy.ops.mesh.primitive_plane_add(size=14)
    bpy.context.object.data.materials.append(mat('#24352A'))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 1, 0.01))
    bpy.context.object.scale = (14, 1.6, 1)
    bpy.context.object.data.materials.append(mat('#3B2C2A'))
    looks = {'metal': ('#D9E1EA', '#8C99A8', '#2A2030', 'sword'), 'wood': ('#5BC46A', '#2E7A3C', '#1E3A22', None),
             'water': ('#4FB3FF', '#22609C', '#DDE8F5', None), 'fire': ('#FF5A1F', '#A02A10', '#3A1210', None),
             'earth': ('#D98A2B', '#8A4F18', None, None), 'yinyang': ('#F2F2F2', '#3A3442', '#1A1423', None)}
    for i, (robe, dark, hair, weapon) in enumerate(looks.values()):
        figure({'robe': robe, 'dark': dark, 'hair': hair, 'accent': dark, 'weapon': weapon}, at=(-2.5 + i, -1 - (i % 2) * 0.6, 0), turn=-20)('idle', 0)
    for i in range(4):
        figure({'robe': '#5A1820', 'dark': '#2A0A10', 'hair': '#120A10', 'accent': '#D2412F'}, at=(-1.5 + i * 1.1, 2.2 + (i % 2) * 0.4, 0), turn=160)('walk', i / 4)
    camera(s, (0, -8.5, 5.2), (62, 0, 0), lens=42)
    out = os.path.join(ROOT, asset.get('out', 'art/promo'))
    os.makedirs(out, exist_ok=True)
    s.render.filepath = os.path.join(out, asset['id'] + '.png')
    bpy.ops.render.render(write_still=True)
    print('promo', asset['id'], w, 'x', h)


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    manifest_path = os.path.join(ROOT, args[0] if args else 'art/manifest.json')
    only = set(args[1:])
    manifest = json.load(open(manifest_path, encoding='utf-8'))
    render = json.load(open(os.path.join(ROOT, 'docs/data/effects.json'), encoding='utf-8'))['render']
    for asset in manifest['assets']:
        if only and asset['id'] not in only:
            continue
        if asset['kind'] == 'promo':
            build_promo(asset, render)
        else:
            build_sprite(asset, render, os.path.join(ROOT, manifest['out']))


if __name__ == '__main__':
    main()
