// The battlefield in three.js: a dark low-poly board drawn at low resolution and scaled up with hard pixels.
// It only reads the sim state; it never changes it.
import * as THREE from 'three';
import { enemies as enemyDefs, grid, sects, TILE, units, type DefendState, type SimEvent } from '@five-sects/sim';

const RENDER_HEIGHT = 480; // pixels tall; CSS scales the canvas up with image-rendering: pixelated
const W = grid.w, H = grid.h;
const FIG = 1.35; // figures a bit larger than a tile's worth so roles read on a phone

// Milli-tiles (sim) to world units: one tile = 1, board centred on the origin.
const wx = (x: number) => x / TILE - W / 2;
const wz = (y: number) => y / TILE - H / 2;

const mats = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string | number, emissive = 0x000000): THREE.MeshLambertMaterial {
  const key = `${color}|${emissive}`;
  let m = mats.get(key);
  if (!m) mats.set(key, (m = new THREE.MeshLambertMaterial({ color, emissive, flatShading: true })));
  return m;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const GEO = {
  tile: box(0.96, 0.2, 0.96), body: new THREE.CylinderGeometry(0.16, 0.22, 0.5, 6), head: new THREE.SphereGeometry(0.13, 6, 4),
  hat: new THREE.ConeGeometry(0.2, 0.2, 6), blade: box(0.05, 0.5, 0.05), orb: new THREE.IcosahedronGeometry(0.11, 0),
  fan: new THREE.CylinderGeometry(0.22, 0.22, 0.03, 6, 1, false, 0, Math.PI), ring: new THREE.TorusGeometry(0.28, 0.03, 4, 12),
  enemy: new THREE.CylinderGeometry(0.14, 0.18, 0.4, 5), hpBg: box(0.5, 0.06, 0.02), hp: box(0.5, 0.06, 0.03),
  shot: box(0.06, 0.06, 1), wing: box(0.6, 0.03, 0.15),
};

// What a role carries, so a player can tell disciples apart at a glance.
function weapon(role: string, color: string): THREE.Object3D {
  const g = new THREE.Group();
  const m = mat(color, 0x111111);
  if (role === 'striker') { const b = new THREE.Mesh(GEO.blade, mat('#E8EEF5', 0x333333)); b.position.set(0.24, 0.45, 0); b.rotation.z = -0.4; g.add(b); }
  else if (role === 'burst') { const f = new THREE.Mesh(GEO.fan, m); f.position.set(0.22, 0.55, 0); f.rotation.x = Math.PI / 2; g.add(f); }
  else if (role === 'control') { const r = new THREE.Mesh(GEO.ring, m); r.position.y = 0.1; r.rotation.x = Math.PI / 2; g.add(r); }
  else if (role === 'stacker') { const o = new THREE.Mesh(GEO.orb, mat('#7CFF6A', 0x225522)); o.position.set(0.25, 0.6, 0); g.add(o); }
  else { const o = new THREE.Mesh(GEO.orb, mat('#FFE9A8', 0x665522)); o.position.set(0, 1.05, 0); g.add(o); }
  return g;
}

function discipleFigure(key: string, level: number): THREE.Group {
  const u = units.get(key);
  const color = u?.color ?? sects.get(key)?.color ?? '#ffffff';
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.body, mat(color)); body.position.y = 0.35; g.add(body);
  const head = new THREE.Mesh(GEO.head, mat('#E9C9A4')); head.position.y = 0.72; g.add(head);
  const hat = new THREE.Mesh(GEO.hat, mat('#1A1418')); hat.position.y = 0.86; g.add(hat);
  g.add(weapon(u?.roleId ?? 'striker', color));
  // Tier: a gold ring per level above 1.
  for (let i = 1; i < level; i++) { const r = new THREE.Mesh(GEO.ring, mat('#FFD34A', 0x664400)); r.rotation.x = Math.PI / 2; r.position.y = 0.04 + i * 0.07; g.add(r); }
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  g.scale.setScalar(FIG);
  return g;
}

const ENEMY_COLOR: Record<string, string> = {
  cultist: '#8A2A2A', runner: '#3E7A3A', brute: '#6E7680', leaper: '#4A6A3A', puppet: '#5A6E8A',
  assassin: '#2A2A38', healer: '#B0302A', mimic: '#4A5AA0',
};

function enemyFigure(type: string): THREE.Group {
  const def = enemyDefs.get(type)!;
  const boss = def.boss != null;
  const g = new THREE.Group();
  const s = boss ? 2 : type === 'brute' ? 1.4 : 1;
  const body = new THREE.Mesh(GEO.enemy, mat(boss ? '#5A0E14' : ENEMY_COLOR[type] ?? '#7A2A2A').clone()); // own material: status tint is per enemy
  body.scale.setScalar(s); body.position.y = 0.2 * s; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(GEO.head, mat('#D8C0A8')); head.scale.setScalar(s * 0.9); head.position.y = 0.48 * s; g.add(head);
  if (def.air) { const w = new THREE.Mesh(GEO.wing, mat('#2A3A2A')); w.position.y = 0.3; g.add(w); }
  const bg = new THREE.Mesh(GEO.hpBg, new THREE.MeshBasicMaterial({ color: '#200808' }));
  const hp = new THREE.Mesh(GEO.hp, new THREE.MeshBasicMaterial({ color: '#E23B2E' }));
  bg.position.y = hp.position.y = 0.75 * s + 0.15;
  hp.name = 'hp';
  g.add(bg, hp);
  g.scale.setScalar(FIG);
  return g;
}

interface Fx { obj: THREE.Object3D; until: number }

export class Board {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  private discs = new Map<number, { g: THREE.Group; key: string }>();
  private foes = new Map<number, THREE.Group>();
  private fx: Fx[] = [];
  private ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 48), new THREE.MeshBasicMaterial({ color: '#FFE9A8', transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  private cursor = new THREE.Mesh(box(1, 0.05, 1), new THREE.MeshBasicMaterial({ color: '#FFE9A8', transparent: true, opacity: 0.35 }));
  private ground: THREE.Mesh;
  private ray = new THREE.Raycaster();

  constructor(private canvas: HTMLCanvasElement, s: DefendState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.shadowMap.enabled = true;
    this.scene.background = new THREE.Color('#0B0910');
    this.scene.fog = new THREE.Fog('#0B0910', 30, 60);
    this.scene.add(new THREE.HemisphereLight('#A898C8', '#2A1A12', 2.2));
    const sun = new THREE.DirectionalLight('#FFD2A0', 3);
    sun.position.set(-6, 14, 6); sun.castShadow = true;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -12; sun.shadow.camera.right = sun.shadow.camera.top = 12;
    this.scene.add(sun);

    // Tiles: path is packed earth, the rest dark grass in two tones; props are stone blocks.
    for (let ty = 0; ty < H; ty++)
      for (let tx = 0; tx < W; tx++) {
        const key = `${tx},${ty}`;
        const onPath = s.pathTiles.has(key);
        const t = new THREE.Mesh(GEO.tile, mat(onPath ? '#8A6A48' : (tx + ty) % 2 ? '#2E4430' : '#355036'));
        t.position.set(tx - W / 2 + 0.5, onPath ? -0.13 : -0.1, ty - H / 2 + 0.5);
        t.receiveShadow = true;
        this.scene.add(t);
        if (s.blocked.has(key)) {
          const rock = new THREE.Mesh(box(0.7, 0.5, 0.7), mat('#3A3540'));
          rock.position.set(t.position.x, 0.2, t.position.z); rock.rotation.y = (tx * 7 + ty) % 3; rock.castShadow = true;
          this.scene.add(rock);
        }
      }
    // Gate at the goal (last path point).
    const goal = s.path[s.path.length - 1]!;
    const gate = new THREE.Mesh(box(1.2, 1.2, 0.3), mat('#7A1A12', 0x220000));
    gate.position.set(wx(goal.x), 0.5, wz(goal.y)); this.scene.add(gate);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ visible: false }));
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.02; this.ring.visible = false;
    this.cursor.visible = false;
    this.scene.add(this.ring, this.cursor);
    this.resize();
  }

  // Fit the whole board into the canvas from a 66-degree pitch.
  resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setPixelRatio(RENDER_HEIGHT / Math.max(1, h));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const pitch = (66 * Math.PI) / 180;
    const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [-W / 2, H / 2], [W / 2, H / 2]].map(([x, z]) => new THREE.Vector3(x, 0, z));
    let lo = 5, hi = 120;
    for (let i = 0; i < 30; i++) {
      const d = (lo + hi) / 2;
      this.place(d, pitch);
      const fits = corners.every((c) => { const p = c.clone().project(this.camera); return Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 0.98; });
      if (fits) hi = d; else lo = d;
    }
    this.place(hi, pitch);
  }

  private place(d: number, pitch: number) {
    this.camera.position.set(0, Math.sin(pitch) * d, Math.cos(pitch) * d);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  // Screen point to tile, or null when off the board.
  tileAt(clientX: number, clientY: number): { tx: number; ty: number } | null {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObject(this.ground)[0];
    if (!hit) return null;
    const tx = Math.floor(hit.point.x + W / 2), ty = Math.floor(hit.point.z + H / 2);
    return tx >= 0 && ty >= 0 && tx < W && ty < H ? { tx, ty } : null;
  }

  // World point (milli-tiles) to CSS pixels inside the canvas, for floating text.
  toScreen(x: number, y: number, lift = 0.9): { x: number; y: number } {
    const p = new THREE.Vector3(wx(x), lift, wz(y)).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - p.y) / 2) * this.canvas.clientHeight };
  }

  showRange(x: number, y: number, range: number | null, tile?: { tx: number; ty: number }, ok = true) {
    this.ring.visible = range != null;
    if (range != null) { this.ring.position.set(wx(x), 0.03, wz(y)); this.ring.scale.setScalar(range / TILE); }
    this.cursor.visible = tile != null;
    if (tile) { this.cursor.position.set(tile.tx - W / 2 + 0.5, 0.03, tile.ty - H / 2 + 0.5); (this.cursor.material as THREE.MeshBasicMaterial).color.set(ok ? '#FFE9A8' : '#FF3B2E'); }
  }

  sync(s: DefendState, now: number): void {
    for (const d of s.disciples) {
      const key = d.unit ?? d.els.join('+');
      const cur = this.discs.get(d.id);
      if (cur && cur.key === `${key}:${d.level}`) continue;
      if (cur) this.scene.remove(cur.g);
      const g = discipleFigure(d.unit ?? d.els[0]!, d.level);
      g.position.set(wx(d.x), 0, wz(d.y));
      this.scene.add(g);
      this.discs.set(d.id, { g, key: `${key}:${d.level}` });
    }
    for (const [id, v] of this.discs) if (!s.disciples.some((d) => d.id === id)) { this.scene.remove(v.g); this.discs.delete(id); }
    // Disciples sealed or disabled by a boss turn grey.
    for (const d of s.disciples) {
      const g = this.discs.get(d.id)!.g;
      const off = d.offT > 0 || (s.sealT > 0 && s.sealEl != null && d.els.includes(s.sealEl));
      g.scale.setScalar(off ? FIG * 0.85 : FIG);
    }

    const alive = new Set<number>();
    for (const e of s.enemies) {
      alive.add(e.id);
      let g = this.foes.get(e.id);
      if (!g) { g = enemyFigure(e.type); g.position.set(wx(e.x), 0, wz(e.y)); this.scene.add(g); this.foes.set(e.id, g); }
      const air = enemyDefs.get(e.type)!.air;
      g.position.lerp(new THREE.Vector3(wx(e.x), air ? 0.8 + Math.sin(now / 200 + e.id) * 0.1 : 0, wz(e.y)), 0.35);
      g.lookAt(this.camera.position.x, g.position.y, this.camera.position.z);
      const hp = g.getObjectByName('hp')!;
      const f = Math.max(0, e.hp / e.maxHp);
      hp.scale.x = Math.max(0.001, f); hp.position.x = -(1 - f) * 0.25;
      // Status tint: burning orange, poisoned green, slowed or stunned blue; a hidden assassin is a shadow.
      const body = g.children[0] as THREE.Mesh;
      const tint = e.burnT > 0 ? 0x662200 : e.poison > 0 ? 0x115511 : e.stunT > 0 || e.slowT > 0 ? 0x113366 : 0;
      (body.material as THREE.MeshLambertMaterial).emissive.setHex(tint);
      g.visible = e.type !== 'assassin' || e.revealed || Math.floor(now / 150) % 4 === 0;
    }
    for (const [id, g] of this.foes) if (!alive.has(id)) { this.scene.remove(g); this.foes.delete(id); }

    this.fx = this.fx.filter((f) => { if (now < f.until) return true; this.scene.remove(f.obj); return false; });
  }

  // Short-lived visuals for sim events: a streak per hit, a flash per art, a sweep for the phoenix.
  events(s: DefendState, ev: SimEvent[], now: number): void {
    for (const e of ev) {
      if (e.e === 'hit') {
        const d = s.disciples.find((x) => x.id === e.from), t = s.enemies.find((x) => x.id === e.to);
        if (!d || !t) continue;
        const a = new THREE.Vector3(wx(d.x), 0.6, wz(d.y)), b = new THREE.Vector3(wx(t.x), 0.3, wz(t.y));
        const color = units.get(d.unit ?? '')?.color ?? sects.get(d.els[0]!)?.color ?? '#fff';
        const m = new THREE.Mesh(GEO.shot, new THREE.MeshBasicMaterial({ color: e.crit ? '#FFFFFF' : color }));
        m.position.copy(a).lerp(b, 0.5); m.lookAt(b); m.scale.z = a.distanceTo(b);
        this.scene.add(m); this.fx.push({ obj: m, until: now + 90 });
      } else if (e.e === 'art' || e.e === 'phoenix') {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.5, 24), new THREE.MeshBasicMaterial({ color: e.e === 'phoenix' ? '#FF7A1F' : '#FFE9A8', side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
        m.rotation.x = -Math.PI / 2; m.position.set(e.e === 'art' && (e.x || e.y) ? wx(e.x!) : 0, 0.1, e.e === 'art' && (e.x || e.y) ? wz(e.y!) : 0);
        m.scale.setScalar(e.e === 'phoenix' ? 18 : 4);
        this.scene.add(m); this.fx.push({ obj: m, until: now + 400 });
      }
    }
  }

  render(): void { this.renderer.render(this.scene, this.camera); }
}
