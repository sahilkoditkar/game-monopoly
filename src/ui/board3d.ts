import * as THREE from 'three';
import { GROUPS, JAIL_INDEX, TILES } from '../game/board';
import { pieceKind, shade, type PieceKind } from './pieces';
import { withTurnCard, type GameScene, type HandoffMode, type SceneView } from './scene';

const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const P2D6: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Grid cell of each tile on the 11x11 board, 0 = bottom-right corner. */
function cell(i: number): [number, number] {
  if (i <= 10) return [10 - i, 10];
  if (i <= 20) return [0, 10 - (i - 10)];
  if (i <= 30) return [i - 20, 0];
  return [10, i - 30];
}
const tilePos = (i: number) => {
  const [c, r] = cell(((i % 40) + 40) % 40);
  return new THREE.Vector3(c - 5, 0, r - 5);
};
/** Rotation that turns a tile's colour band towards the centre. */
function tileYaw(i: number) {
  if (i % 10 === 0) return [0, -Math.PI / 2, Math.PI, Math.PI / 2][i / 10];
  if (i < 10) return 0;
  if (i < 20) return -Math.PI / 2;
  if (i < 30) return Math.PI;
  return Math.PI / 2;
}
/** Unit vector from a tile towards the board centre. */
function inward(i: number) {
  if (i < 10) return new THREE.Vector3(0, 0, -1);
  if (i < 20) return new THREE.Vector3(1, 0, 0);
  if (i < 30) return new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3(-1, 0, 0);
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra });

/** Builds a 3D version of a playing piece, about 0.45 units tall. */
function makePiece(kind: PieceKind, color: string): THREE.Group {
  const g = new THREE.Group();
  const main = std(color, { roughness: 0.35, metalness: 0.25 });
  const dark = std(shade(color, 0.55));
  const add = (m: THREE.Mesh) => {
    m.castShadow = true;
    g.add(m);
    return m;
  };
  if (kind === 'car') {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.26), main)).position.y = 0.13;
    const cab = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.22), std('#cfeaff', { roughness: 0.1, metalness: 0.4 })));
    cab.position.set(-0.03, 0.26, 0);
    for (const [x, z] of [[-0.15, 0.13], [0.15, 0.13], [-0.15, -0.13], [0.15, -0.13]]) {
      const w = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16), std('#16182c')));
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.07, z);
    }
    const lamp = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.2), std('#fff3b0', { emissive: '#fff3b0', emissiveIntensity: 0.8 })));
    lamp.position.set(0.25, 0.15, 0);
  } else if (kind === 'robot') {
    for (const z of [-0.06, 0.06]) add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.07), dark)).position.set(0, 0.07, z);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.24), main)).position.y = 0.24;
    add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.13, 0.18), std('#e8ecff'))).position.y = 0.42;
    const eye = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.12), std(color, { emissive: color, emissiveIntensity: 1 })));
    eye.position.set(0.1, 0.43, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1), std('#c9cff5'))).position.y = 0.53;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), std(color, { emissive: color, emissiveIntensity: 0.6 }))).position.y = 0.59;
  } else if (kind === 'walker') {
    for (const z of [-0.05, 0.05]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18), std('#2a2d48'))).position.set(0, 0.09, z);
    add(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.14, 4, 12), main)).position.y = 0.3;
    const pack = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.14), std('#20233a')));
    pack.position.set(-0.1, 0.31, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), std('#e0ac69'))).position.y = 0.5;
    const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 16), main));
    cap.position.y = 0.56;
  } else {
    const cone = add(new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 20), main));
    cone.rotation.x = Math.PI;
    cone.position.y = 0.2;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), main)).position.y = 0.4;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), std('#ffffff'))).position.set(0.12, 0.42, 0);
  }
  return g;
}

interface TileView {
  mesh: THREE.Mesh;
  top: THREE.MeshStandardMaterial;
  extra: THREE.Group;
  sig: string;
  tex: THREE.CanvasTexture;
}

export class Board3D implements GameScene {
  speed = 1;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  private tiles: TileView[] = [];
  private pieces: THREE.Group[] = [];
  private pieceKinds: string[] = [];
  private raf = 0;
  private W = 0;
  private H = 0;
  private yaw = 0;
  private pitch = 1.18;
  private dist = 15;
  private zoomOut = 0;
  private hold = false;
  private focus = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private grows: Record<number, number> = {};
  private flags: Record<number, number> = {};
  private hop: Record<number, number> = {};
  private ray = new THREE.Raycaster();
  private dragging = false;
  private dragMoved = 0;
  private lastX = 0;
  private lastY = 0;
  private pointers = new Map<number, PointerEvent>();
  private pinch = 0;
  private towerTex = canvasTexture(64, 128, (g) => {
    g.fillStyle = '#2c3a8f';
    g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 124; y += 10)
      for (let x = 6; x < 60; x += 12) {
        g.fillStyle = Math.sin(x * 7 + y * 13) > -0.2 ? '#ffd877' : 'rgba(255,255,255,0.12)';
        g.fillRect(x, y, 7, 6);
      }
  });

  constructor(private host: HTMLElement, private view: SceneView) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', '3D board');
    host.prepend(canvas);
    this.buildWorld();
    this.bindInput(canvas);
  }

  // ------------------------------------------------------------ world

  private buildWorld() {
    const s = this.scene;
    s.background = new THREE.Color('#0b0f2c');
    s.fog = new THREE.Fog('#0b0f2c', 26, 50);
    s.add(new THREE.HemisphereLight(0xc8d6ff, 0x1a1d3a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(7, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
    sun.shadow.bias = -0.0004;
    s.add(sun);
    const rim = new THREE.PointLight(0xff4d8d, 18, 30);
    rim.position.set(-8, 5, -8);
    s.add(rim);

    const table = new THREE.Mesh(new THREE.CircleGeometry(40, 64), std('#141a44', { roughness: 0.95 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.62;
    table.receiveShadow = true;
    s.add(table);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.5, 11.5), std('#1c2152'));
    slab.position.y = -0.3;
    slab.receiveShadow = true;
    s.add(slab);
    const rim2 = new THREE.Mesh(new THREE.BoxGeometry(11.8, 0.32, 11.8), std('#f5c55a', { metalness: 0.6, roughness: 0.3 }));
    rim2.position.y = -0.5;
    s.add(rim2);

    // Centre artwork.
    const centre = new THREE.Mesh(
      new THREE.PlaneGeometry(8.9, 8.9),
      new THREE.MeshStandardMaterial({
        roughness: 0.8,
        map: canvasTexture(1024, 1024, (g) => {
          const grd = g.createRadialGradient(512, 450, 40, 512, 512, 720);
          grd.addColorStop(0, '#2f3696');
          grd.addColorStop(1, '#10143f');
          g.fillStyle = grd;
          g.fillRect(0, 0, 1024, 1024);
          g.strokeStyle = 'rgba(255,255,255,.05)';
          for (let k = 0; k < 1024; k += 64) {
            g.beginPath();
            g.moveTo(k, 0);
            g.lineTo(k, 1024);
            g.moveTo(0, k);
            g.lineTo(1024, k);
            g.stroke();
          }
          g.save();
          g.translate(512, 470);
          g.rotate(-0.08);
          g.textAlign = 'center';
          g.font = '700 120px Fredoka, sans-serif';
          g.fillStyle = '#ffffff';
          g.fillText('SKYLINE', 0, 0);
          const t = g.createLinearGradient(-260, 0, 260, 0);
          t.addColorStop(0, '#ffc23d');
          t.addColorStop(1, '#ff3d81');
          g.fillStyle = t;
          g.fillText('TYCOON', 0, 120);
          g.restore();
        }),
      }),
    );
    centre.rotation.x = -Math.PI / 2;
    centre.position.y = 0.01;
    centre.receiveShadow = true;
    s.add(centre);
    for (const [x, z, col, ic] of [[-2.6, 2.4, '#7c3aed', '🔮'], [2.6, -2.4, '#0d9488', '💼']] as const) {
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.12, 1),
        [std(col), std(col), std(col, { map: canvasTexture(256, 170, (g) => { g.fillStyle = col; g.fillRect(0, 0, 256, 170); g.font = `90px ${EMOJI}`; g.textAlign = 'center'; g.fillText(ic, 128, 120); }) }), std(col), std(col), std(col)],
      );
      deck.position.set(x, 0.07, z);
      deck.rotation.y = -0.6;
      deck.castShadow = true;
      s.add(deck);
    }

    // Tiles.
    const geo = new THREE.BoxGeometry(0.96, 0.14, 0.96);
    const side = std('#e9dfc8');
    TILES.forEach((t, i) => {
      const tex = canvasTexture(256, 256, (g) => this.paintTile(g, i));
      const top = new THREE.MeshStandardMaterial({ roughness: 0.75, map: tex });
      const mesh = new THREE.Mesh(geo, [side, side, top, side, side, side]);
      mesh.position.copy(tilePos(i)).setY(0.07);
      mesh.rotation.y = tileYaw(i);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.userData.tile = i;
      s.add(mesh);
      const extra = new THREE.Group();
      extra.position.copy(tilePos(i)).setY(0.14);
      s.add(extra);
      this.tiles.push({ mesh, top, extra, sig: '', tex });
      void t;
    });
  }

  /** Tile artwork: big name and price, or the owner's name and current rent once bought. */
  private paintTile(g: CanvasRenderingContext2D, i: number) {
    const t = TILES[i], o = this.view.state.props[i];
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = i % 10 === 0 ? '#ffe7a8' : '#f7f0e1';
    g.fillRect(0, 0, 256, 256);
    if (t.group) {
      g.fillStyle = GROUPS[t.group].color;
      g.fillRect(0, 0, 256, 50);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `64px ${EMOJI}`;
    g.fillText(t.icon, 128, 100);
    g.fillStyle = '#1d2142';
    g.font = '700 40px Fredoka, "DM Sans", sans-serif';
    g.fillText(t.short, 128, 158, 244);
    if (o) {
      const p = this.view.state.players[o.owner];
      g.fillStyle = p.color;
      g.fillRect(0, 186, 256, 70);
      g.fillStyle = '#ffffff';
      g.font = '700 26px "DM Sans", sans-serif';
      g.fillText(p.name.slice(0, 12), 128, 206);
      g.font = '800 30px "DM Sans", sans-serif';
      g.fillText(o.mortgaged ? 'MORTGAGED' : `RENT $${this.view.rentOf(i)}`, 128, 238);
    } else if (t.price || t.tax) {
      g.fillStyle = '#4b5078';
      g.font = '800 34px "DM Sans", sans-serif';
      g.fillText(t.price ? `$${t.price}` : `Pay $${t.tax}`, 128, 214);
    }
  }

  /** Rebuilds the owner frame, flag and buildings on a tile when its state changes. */
  private syncTile(i: number) {
    const tv = this.tiles[i], o = this.view.state.props[i];
    const sig = o ? `${o.owner}:${o.houses}:${o.mortgaged}:${this.view.rentOf(i)}` : '';
    if (sig === tv.sig && this.grows[i] === undefined && this.flags[i] === undefined) return;
    const changed = sig !== tv.sig;
    tv.sig = sig;
    tv.top.color.set(o?.mortgaged ? '#9a9aaa' : '#ffffff');
    if (changed) {
      this.paintTile(tv.tex.image.getContext('2d'), i);
      tv.tex.needsUpdate = true;
      tv.extra.clear();
      if (!o) return;
      const pc = this.view.state.players[o.owner].color;
      const frameMat = std(pc, { emissive: pc, emissiveIntensity: 0.35 });
      for (const [w, d, x, z] of [[1, 0.06, 0, 0.47], [1, 0.06, 0, -0.47], [0.06, 1, 0.47, 0], [0.06, 1, -0.47, 0]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), frameMat);
        bar.position.set(x, 0.0, z);
        tv.extra.add(bar);
      }
      const flag = new THREE.Group();
      flag.name = 'flag';
      const out = inward(i).multiplyScalar(-0.36), across = new THREE.Vector3(inward(i).z, 0, -inward(i).x).multiplyScalar(0.36);
      flag.position.copy(out).add(across);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5), std('#e6e8f5'));
      pole.position.y = 0.25;
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.01), std(pc));
      cloth.name = 'cloth';
      cloth.position.set(0.1, 0.43, 0);
      flag.add(pole, cloth);
      tv.extra.add(flag);
      const t = TILES[i];
      if (t.kind === 'property' && o.houses > 0) {
        const b = new THREE.Group();
        b.name = 'build';
        if (o.houses === 5) {
          const h = 1.6;
          const tower = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.4), new THREE.MeshStandardMaterial({ map: this.towerTex, emissive: '#ffc860', emissiveMap: this.towerTex, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.4 }));
          tower.position.y = h / 2;
          tower.castShadow = true;
          const spire = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 8), std(GROUPS[t.group!].color, { metalness: 0.7, roughness: 0.3, emissive: GROUPS[t.group!].color, emissiveIntensity: 0.4 }));
          spire.position.y = h + 0.2;
          b.add(tower, spire);
        } else {
          const roof = std(GROUPS[t.group!].color), wall = std('#f4f1ea');
          const along = new THREE.Vector3(inward(i).z, 0, -inward(i).x);
          for (let k = 0; k < o.houses; k++) {
            const hs = new THREE.Group();
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), wall);
            body.position.y = 0.07;
            body.castShadow = true;
            const top = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.12, 4), roof);
            top.position.y = 0.2;
            top.rotation.y = Math.PI / 4;
            top.castShadow = true;
            hs.add(body, top);
            hs.position.copy(along.clone().multiplyScalar((k - (o.houses - 1) / 2) * 0.2)).add(inward(i).multiplyScalar(0.28));
            b.add(hs);
          }
        }
        tv.extra.add(b);
      }
    }
    const b = tv.extra.getObjectByName('build');
    if (b) b.scale.set(1, Math.max(0.01, this.grows[i] ?? 1), 1);
    const f = tv.extra.getObjectByName('flag');
    if (f) f.position.y = -0.4 * (1 - (this.flags[i] ?? 1));
  }

  private syncPieces() {
    const s = this.view.state;
    s.players.forEach((p, id) => {
      const kind = pieceKind(p.token) + p.color;
      if (this.pieceKinds[id] !== kind) {
        if (this.pieces[id]) this.scene.remove(this.pieces[id]);
        this.pieces[id] = makePiece(pieceKind(p.token), p.color);
        this.pieceKinds[id] = kind;
        this.scene.add(this.pieces[id]);
      }
      const piece = this.pieces[id];
      piece.visible = !p.bankrupt;
      const u = this.view.disp[id], a = Math.floor(u), f = u - a;
      const pa = tilePos(a), pb = tilePos(a + 1);
      const pos = pa.clone().lerp(pb, f);
      // Fan pieces out so they don't overlap on a shared tile.
      const offset = new THREE.Vector3(((id % 2) - 0.5) * 0.36, 0, (Math.floor(id / 2) - 0.5) * 0.36);
      pos.add(offset);
      pos.y = 0.14 + (this.hop[id] ?? 0);
      if (p.inJail && (((Math.round(u) % 40) + 40) % 40) === JAIL_INDEX) pos.y += 0.02;
      piece.position.copy(pos);
      const dir = pb.clone().sub(pa);
      piece.rotation.y = Math.atan2(-dir.z, dir.x);
      const active = id === this.view.follow && s.phase !== 'gameover';
      piece.scale.setScalar(active ? 1.15 : 0.95);
    });
  }

  // ------------------------------------------------------------ input

  private bindInput(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, e);
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.dragMoved = 0;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, e);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (this.pinch) this.dist = Math.min(24, Math.max(6, this.dist * (this.pinch / d)));
        this.pinch = d;
        this.dragMoved = 99;
        return;
      }
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.006;
      this.pitch = Math.min(1.4, Math.max(0.45, this.pitch - dy * 0.005));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinch = 0;
      if (!this.pointers.size) {
        this.dragging = false;
        if (this.dragMoved < 6) this.pick(e);
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.dist = Math.min(24, Math.max(6, this.dist + e.deltaY * 0.01));
      },
      { passive: false },
    );
  }

  private pick(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hit = this.ray.intersectObjects(this.tiles.map((t) => t.mesh))[0];
    if (hit) this.view.onSelect(hit.object.userData.tile as number);
  }

  // ------------------------------------------------------------ GameScene

  start() {
    this.resize();
    this.focus.copy(this.pieceTarget());
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.frame(dt, now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width) return;
    this.W = r.width;
    this.H = r.height;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.camera.fov = r.width < r.height * 1.1 ? 52 : 40;
    this.camera.updateProjectionMatrix();
  }

  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.W, y: (-p.y * 0.5 + 0.5) * this.H };
  }

  pointFor(i: number) {
    return this.project(tilePos(i).setY(0.6));
  }

  playerPoint(pid: number) {
    const p = this.pieces[pid];
    return p ? this.project(p.position.clone().setY(p.position.y + 0.5)) : { x: this.W / 2, y: this.H / 2 };
  }

  grow(i: number) {
    this.grows[i] = 0.01;
    this.tiles[i].sig = '#';
    void this.tween(800, (k) => (this.grows[i] = Math.max(0.01, easeOut(k)))).then(() => delete this.grows[i]);
  }

  raiseFlag(i: number) {
    this.flags[i] = 0;
    void this.tween(900, (k) => (this.flags[i] = easeOut(k))).then(() => delete this.flags[i]);
  }

  async walk(pid: number, path: number[], stepMs: number) {
    const v = this.view;
    let pos = ((Math.round(v.disp[pid]) % 40) + 40) % 40;
    v.moving = pid;
    v.follow = pid;
    for (const t of path) {
      const d0 = (((t - pos) % 40) + 40) % 40, d = d0 > 20 ? d0 - 40 : d0;
      const from = v.disp[pid];
      await this.tween(stepMs * 1.15, (k) => {
        v.disp[pid] = from + d * k;
        this.hop[pid] = Math.sin(k * Math.PI) * 0.35;
      });
      v.disp[pid] = from + d;
      pos = t;
    }
    this.hop[pid] = 0;
    v.moving = null;
  }

  async jump(pid: number, target: number) {
    const v = this.view;
    const cur = ((Math.round(v.disp[pid]) % 40) + 40) % 40;
    let d = (((target - cur) % 40) + 40) % 40;
    if (d > 20) d -= 40;
    const from = v.disp[pid];
    v.moving = pid;
    await this.tween(900, (k) => {
      v.disp[pid] = from + d * ease(k);
      this.hop[pid] = Math.sin(k * Math.PI) * 2.2;
    });
    v.disp[pid] = from + d;
    this.hop[pid] = 0;
    v.moving = null;
  }

  async handoff(pid: number, card: HTMLElement | null, mode: HandoffMode) {
    if (pid === this.view.follow) return;
    if (mode === 'instant') {
      this.view.follow = pid;
      return;
    }
    this.hold = true;
    if (mode === 'zoom') await this.tween(450, (k) => (this.zoomOut = ease(k)));
    await withTurnCard(this.host, card, this.speed, async () => {
      const from = this.camTarget.clone();
      this.view.follow = pid;
      const to = this.pieceTarget();
      await this.tween(650, (k) => this.camTarget.copy(from.clone().lerp(to, ease(k))));
    });
    if (mode === 'zoom') await this.tween(450, (k) => (this.zoomOut = 1 - ease(k)));
    this.hold = false;
  }

  async coins(from: number, to: number | null) {
    if (reduced()) return;
    const a = this.playerPoint(from);
    const b = to === null ? { x: this.W / 2, y: -20 } : this.playerPoint(to);
    const jobs: Promise<unknown>[] = [];
    for (let k = 0; k < 6; k++) {
      const c = document.createElement('div');
      c.className = 'coin';
      this.host.appendChild(c);
      const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 80;
      jobs.push(
        c.animate(
          [
            { left: `${a.x}px`, top: `${a.y}px`, opacity: 0 },
            { left: `${mx}px`, top: `${my}px`, opacity: 1, offset: 0.5 },
            { left: `${b.x}px`, top: `${b.y}px`, opacity: 0.3 },
          ],
          { duration: 700 * this.speed, delay: k * 60 * this.speed, easing: 'ease-in-out', fill: 'forwards' },
        ).finished.catch(() => {}).then(() => c.remove()),
      );
    }
    await Promise.all(jobs);
  }

  overlay(cls: string, html: string, x: number, y: number, ms: number, style = '') {
    const f = document.createElement('div');
    f.className = cls;
    f.innerHTML = html;
    f.style.cssText = `left:${x}px;top:${y}px;${style}`;
    this.host.appendChild(f);
    setTimeout(() => f.remove(), ms);
  }

  // ------------------------------------------------------------ frame

  private tween(ms: number, fn: (k: number) => void) {
    ms *= this.speed;
    return new Promise<void>((res) => {
      if (reduced() || ms <= 0) {
        fn(1);
        res();
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        fn(k);
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
  }

  /** Where the camera looks: mostly at the followed piece, a little towards the centre. */
  private pieceTarget() {
    const u = this.view.disp[this.view.follow] ?? 0, a = Math.floor(u);
    return tilePos(a).lerp(tilePos(a + 1), u - a).multiplyScalar(0.3);
  }

  private frame(dt: number, now: number) {
    if (!this.W) return;
    for (let i = 0; i < 40; i++) this.syncTile(i);
    this.syncPieces();
    // Highlights: landing range (gold, brighter = likelier) and the selected tile.
    const s = this.view.state, cur = this.view.disp[s.current] ?? 0;
    const range: Record<number, number> = {};
    if (this.view.showRange && this.view.moving === null) for (let d = 2; d <= 12; d++) range[(((Math.round(cur) + d) % 40) + 40) % 40] = P2D6[d] / 6;
    this.tiles.forEach((tv, i) => {
      const glow = range[i] ?? 0;
      tv.top.emissive.set(i === this.view.selected ? '#ffc23d' : glow ? '#ffb000' : '#000000');
      tv.top.emissiveIntensity = i === this.view.selected ? 0.35 : glow * 0.45;
      const cloth = tv.extra.getObjectByName('cloth');
      if (cloth) cloth.rotation.y = Math.sin(now / 300 + i) * 0.3;
    });
    if (!this.hold) this.camTarget.lerp(this.pieceTarget(), 1 - Math.pow(0.02, dt));
    this.focus.copy(this.camTarget);
    const dist = this.dist + this.zoomOut * 8;
    const pitch = this.pitch + this.zoomOut * 0.3;
    const c = this.camera;
    c.position.set(this.focus.x + Math.sin(this.yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, this.focus.z + Math.cos(this.yaw) * Math.cos(pitch) * dist);
    c.lookAt(this.focus);
    this.renderer.render(this.scene, c);
  }
}
