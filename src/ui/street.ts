import { GROUPS, JAIL_INDEX, TILES } from '../game/board';
import { drawPiece, pieceKind, shade } from './pieces';
import { withTurnCard, type GameScene, type HandoffMode, type SceneView } from './scene';

const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const P2D6: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const vnoise = (x: number, seed: number) => {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i + seed * 97.3) * (1 - u) + hash(i + 1 + seed * 97.3) * u;
};
const fbm = (x: number, seed: number) => {
  let a = 0, amp = 0.5, fr = 1;
  for (let o = 0; o < 4; o++) {
    a += amp * vnoise(x * fr, seed + o * 13);
    fr *= 2.03;
    amp *= 0.5;
  }
  return a;
};
const hexRgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (a: number[]) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, k: number) => { const A = hexRgb(a), B = hexRgb(b); return toHex(A.map((v, i) => v + (B[i] - v) * k)); };
const rgba = (h: string, a: number) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

interface District {
  sky: [string, string];
  far: [string, string];
  hill: [string, string];
  amp: number;
  snow: number;
  water: number;
  city: number;
  trees: string;
  walk: string;
  walls: string[];
  roof: string;
  land: string;
}

// Each colour set is a district with its own sky, landscape and architecture.
const DIST: Record<string, District> = {
  harbor: { sky: ['#2b7fc8', '#ffd9a0'], far: ['#4f6f94', '#8fb0c8'], hill: ['#3f8a5a', '#2c6b46'], amp: 0.35, snow: 0, water: 1, trees: 'palm', city: 0, walk: '#c9a46b', walls: ['#ffcf5c', '#3fc1b0', '#ff7a6b', '#7cc6ff'], roof: 'tin', land: 'lighthouse' },
  andes: { sky: ['#3f86d8', '#d6ecff'], far: ['#5b6f95', '#9fb4d0'], hill: ['#5f8a4a', '#43683a'], amp: 0.95, snow: 0.55, water: 0, trees: 'pine', city: 0, walk: '#9b7d5a', walls: ['#e7c8a0', '#d9b48a'], roof: 'tile', land: 'temple' },
  bazaar: { sky: ['#e38a4a', '#ffe3a8'], far: ['#c98a5a', '#e9b98a'], hill: ['#e8b86a', '#d39a4a'], amp: 0.18, snow: 0, water: 0, trees: 'palm', city: 0.2, walk: '#d9b77a', walls: ['#efd2a0', '#e8c08a', '#f3e1bf'], roof: 'dome', land: 'mosque' },
  tango: { sky: ['#ff7f63', '#ffd6a8'], far: ['#6a6a9a', '#a09ac0'], hill: ['#3f9a5a', '#2c7a46'], amp: 0.6, snow: 0, water: 1, trees: 'palm', city: 0.3, walk: '#e6cf9e', walls: ['#ff9fb2', '#7fd6c9', '#ffd36e', '#a99bff'], roof: 'flat', land: 'deco' },
  riviera: { sky: ['#6d8fd8', '#ffe2c7'], far: ['#7a86a8', '#b8b8c8'], hill: ['#8fae6a', '#6a8f4a'], amp: 0.4, snow: 0, water: 0, trees: 'cypress', city: 0.4, walk: '#b8aa95', walls: ['#efe4d0', '#e7d8bd'], roof: 'mansard', land: 'lattice' },
  pacific: { sky: ['#1a1446', '#7b3fa0'], far: ['#2a2458', '#4a3a78'], hill: ['#2a2a50', '#1e1e3e'], amp: 0.3, snow: 0, water: 1, trees: 'cherry', city: 1, walk: '#3a3460', walls: ['#2a2f5a', '#1f2a4a', '#33295a'], roof: 'neon', land: 'pagoda' },
  alpine: { sky: ['#7fb0e8', '#eef6ff'], far: ['#6a7fa8', '#b0c4e0'], hill: ['#2f6a4a', '#1f4f36'], amp: 1, snow: 0.35, water: 0, trees: 'pine', city: 0, walk: '#eef3fa', walls: ['#8a5a3a', '#9b6a45'], roof: 'chalet', land: 'clock' },
  skyline: { sky: ['#0d1238', '#3b3f9a'], far: ['#1b2056', '#2c2f78'], hill: ['#1b1f4a', '#14183a'], amp: 0.25, snow: 0, water: 1, trees: 'none', city: 1, walk: '#2b2f55', walls: ['#3a4aa8', '#2c3a8f'], roof: 'glass', land: 'spire' },
  special: { sky: ['#5a7ac0', '#ffd8b8'], far: ['#6a7aa0', '#a8b4cc'], hill: ['#5a8a5a', '#406a44'], amp: 0.45, snow: 0.2, water: 0, trees: 'round', city: 0.3, walk: '#8a8fb0', walls: ['#5a6090'], roof: 'flat', land: 'spire' },
};
const tileAt = (i: number) => TILES[((i % 40) + 40) % 40];
const districtOf = (i: number) => DIST[tileAt(i).group ?? 'special'] ?? DIST.special;

function blend(a: District, b: District, f: number) {
  const c = (x: string, y: string) => mix(x, y, f), n = (x: number, y: number) => x + (y - x) * f;
  return {
    sky: [c(a.sky[0], b.sky[0]), c(a.sky[1], b.sky[1])],
    far: [c(a.far[0], b.far[0]), c(a.far[1], b.far[1])],
    hill: [c(a.hill[0], b.hill[0]), c(a.hill[1], b.hill[1])],
    amp: n(a.amp, b.amp),
    snow: n(a.snow, b.snow),
    water: n(a.water, b.water),
    city: n(a.city, b.city),
    trees: f < 0.5 ? a.trees : b.trees,
  };
}
type Look = ReturnType<typeof blend>;

export class StreetScene implements GameScene {
  readonly canvas = document.createElement('canvas');
  speed = 1;
  private g!: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private raf = 0;
  private last = performance.now();
  private cam = { x: 0, z: 1 };
  private hold = false;
  private walkPhase = 0;
  private grows: Record<number, number> = {};
  private flags: Record<number, number> = {};
  private clouds = Array.from({ length: 6 }, (_, k) => ({ x: hash(k) * 2000, y: 0.1 + hash(k + 9) * 0.12, s: 0.35 + hash(k + 3) * 0.4 }));

  constructor(private host: HTMLElement, private view: SceneView) {
    this.canvas.setAttribute('aria-label', 'The street');
    host.prepend(this.canvas);
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX - r.left - this.W / 2) / this.cam.z + this.cam.x;
      this.view.onSelect((((Math.floor(x / this.lot()) % 40) + 40) % 40));
    });
  }

  // ------------------------------------------------------------ public api

  start() {
    this.resize();
    this.cam.x = this.nearest(this.view.disp[this.view.follow] + 0.5);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.W = r.width;
    this.H = r.height;
    this.g = this.canvas.getContext('2d')!;
  }

  /** Screen point above a plot, relative to the host element. */
  pointFor(i: number) {
    return this.toScreen(this.nearest(i + 0.38), this.gy() - this.H * 0.28);
  }

  playerPoint(pid: number) {
    return this.toScreen(this.nearest(this.view.disp[pid] + 0.5), this.gy() + 4);
  }

  grow(i: number) {
    this.grows[i] = 0;
    void this.tween(900, (k) => (this.grows[i] = easeOut(k))).then(() => delete this.grows[i]);
  }

  raiseFlag(i: number) {
    this.flags[i] = 0;
    void this.tween(1000, (k) => (this.flags[i] = easeOut(k))).then(() => delete this.flags[i]);
  }

  /** Drives a piece along the engine's path of tiles. */
  async walk(pid: number, path: number[], stepMs: number) {
    const v = this.view;
    let pos = ((Math.round(v.disp[pid]) % 40) + 40) % 40;
    let delta = 0;
    for (const t of path) {
      const d = (((t - pos) % 40) + 40) % 40;
      delta += d > 20 ? d - 40 : d;
      pos = t;
    }
    if (!delta) return;
    const from = v.disp[pid];
    v.moving = pid;
    this.view.follow = pid;
    await this.tween(250 + Math.abs(delta) * stepMs, (k) => (v.disp[pid] = from + delta * ease(k)));
    v.disp[pid] = from + delta;
    v.moving = null;
  }

  /** Sends a piece straight to a tile (e.g. Lockup) by the shortest way. */
  async jump(pid: number, target: number) {
    const v = this.view;
    const cur = ((Math.round(v.disp[pid]) % 40) + 40) % 40;
    let d = (((target - cur) % 40) + 40) % 40;
    if (d > 20) d -= 40;
    const from = v.disp[pid];
    v.moving = pid;
    await this.tween(900, (k) => (v.disp[pid] = from + d * ease(k)));
    v.disp[pid] = from + d;
    v.moving = null;
  }

  /** Turn hand-off: optionally pull back, glide to the next player with their card, drop back in. */
  async handoff(pid: number, card: HTMLElement | null, mode: HandoffMode) {
    if (pid === this.view.follow) return;
    const to = () => this.nearest(this.view.disp[pid] + 0.5) + this.lot() * 0.15;
    if (mode === 'instant') {
      this.view.follow = pid;
      this.cam.x = to();
      return;
    }
    this.hold = true;
    if (mode === 'zoom') await this.tween(420, (k) => (this.cam.z = 1 - 0.58 * ease(k)));
    await withTurnCard(this.host, card, this.speed, async () => {
      const from = this.cam.x, target = to();
      await this.tween(mode === 'zoom' ? 700 : 550, (k) => (this.cam.x = from + (target - from) * ease(k)));
      this.view.follow = pid;
    });
    if (mode === 'zoom') await this.tween(420, (k) => (this.cam.z = 0.42 + 0.58 * ease(k)));
    this.hold = false;
  }

  /** Coins fly between two players (or to the bank at the top of the scene). */
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
            { left: `${a.x}px`, top: `${a.y - 20}px`, opacity: 0 },
            { left: `${mx}px`, top: `${my}px`, opacity: 1, offset: 0.5 },
            { left: `${b.x}px`, top: `${b.y - 20}px`, opacity: 0.3 },
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

  // ------------------------------------------------------------ geometry

  private lot() {
    return Math.max(150, Math.min(240, this.W * 0.23));
  }

  private gy() {
    return this.H * (this.W < 520 ? 0.68 : 0.71);
  }

  private nearest(u: number) {
    const loop = 40 * this.lot(), x = u * this.lot();
    return x + loop * Math.round((this.cam.x - x) / loop);
  }

  private toScreen(wx: number, wy: number) {
    return { x: (wx - this.cam.x) * this.cam.z + this.W / 2, y: (wy - this.gy()) * this.cam.z + this.gy() };
  }

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

  // ------------------------------------------------------------ frame

  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { g, W, H, dpr, view } = this;
    if (!W) {
      this.raf = requestAnimationFrame((t) => this.frame(t));
      return;
    }
    if (view.moving !== null) this.walkPhase += dt * 9;
    const w = this.lot(), gy = this.gy();
    if (!this.hold) {
      const target = this.nearest(view.disp[view.follow] + 0.5) + w * 0.15;
      this.cam.x += (target - this.cam.x) * Math.min(1, dt * 6);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cu = this.cam.x / w, ci = Math.floor(cu);
    const look = blend(districtOf(ci), districtOf(ci + 1), cu - ci);
    this.sky(look, now);
    this.landscape(look, now);
    // World layer, zoomed around the ground line.
    const z = this.cam.z;
    g.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - this.cam.x * z), dpr * (gy - gy * z));
    const half = W / 2 / z, first = Math.floor((this.cam.x - half) / w) - 1, lastK = Math.ceil((this.cam.x + half) / w) + 1;
    for (let k = first; k <= lastK; k++) {
      g.fillStyle = districtOf(k).walk;
      g.fillRect(k * w, gy, w + 1, 12);
    }
    for (let k = first; k <= lastK; k++) {
      const i = ((k % 40) + 40) % 40, x = k * w;
      if (TILES[i].kind === 'property') this.building(i, x, w, gy, now);
      else this.special(i, x, w, gy, now);
      this.sign(i, x, w, gy);
      this.lamp(x + w - 4, gy, districtOf(i));
      if (i === view.selected) {
        g.strokeStyle = '#ffc23d';
        g.lineWidth = 3;
        g.setLineDash([6, 5]);
        g.strokeRect(x + 4, gy - H * 0.56, w - 8, H * 0.56 + 10);
        g.setLineDash([]);
      }
    }
    g.fillStyle = '#23263f';
    g.fillRect(this.cam.x - half - w, gy + 12, half * 2 + w * 2, H * 3);
    g.fillStyle = '#3a3e5c';
    g.fillRect(this.cam.x - half - w, gy + 12, half * 2 + w * 2, 3);
    g.fillStyle = '#ffc23d';
    for (let x = Math.floor((this.cam.x - half) / 60) * 60 - 60; x < this.cam.x + half + 60; x += 60) g.fillRect(x, gy + 74, 30, 4);
    // Where the current player can land: brighter = likelier.
    const s = view.state;
    if (view.showRange && view.moving === null) {
      const cp = view.disp[s.current];
      for (let d = 2; d <= 12; d++) {
        const xx = this.nearest(Math.round(cp) + d + 0.5), a = P2D6[d] / 6;
        g.fillStyle = `rgba(255,194,61,${a * 0.75})`;
        g.beginPath();
        g.roundRect(xx - w * 0.4, gy + 13, w * 0.8, 6, 3);
        g.fill();
        g.fillStyle = `rgba(255,236,170,${0.35 + a * 0.6})`;
        g.font = '700 11px "DM Sans", sans-serif';
        g.textAlign = 'center';
        g.fillText('+' + d, xx, gy + 32);
      }
    }
    const order = s.players.map((p) => p.id).filter((id) => !s.players[id].bankrupt).sort((a, b) => Number(a === view.follow) - Number(b === view.follow));
    for (const id of order) {
      const p = s.players[id];
      const wx = this.nearest(view.disp[id] + 0.5) + (id - 1.5) * 10, y = gy + 22 + id * 11, active = id === view.follow;
      g.save();
      g.translate(wx, y);
      g.scale(active ? 1 : 0.78, active ? 1 : 0.78);
      drawPiece(g, pieceKind(p.token), p.color, { moving: view.moving === id, phase: this.walkPhase, seat: id, time: now });
      g.restore();
      if (p.inJail && ((Math.round(view.disp[id]) % 40) + 40) % 40 === JAIL_INDEX) {
        g.font = `14px ${EMOJI}`;
        g.textAlign = 'center';
        g.fillText('🔒', wx + 18, y - 34);
      }
      if (active && s.phase !== 'gameover') {
        const bob = Math.abs(Math.sin(now / 300)) * 4;
        g.fillStyle = p.color;
        g.beginPath();
        g.moveTo(wx - 6, y - 52 - bob);
        g.lineTo(wx + 6, y - 52 - bob);
        g.lineTo(wx, y - 44 - bob);
        g.fill();
      }
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.edgeMarkers(gy, w);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private edgeMarkers(gy: number, w: number) {
    const { g, W, view } = this;
    for (const p of view.state.players) {
      if (p.id === view.follow || p.bankrupt) continue;
      const wx = this.nearest(view.disp[p.id] + 0.5), sp = this.toScreen(wx, gy);
      if (sp.x > 0 && sp.x < W) continue;
      const right = sp.x >= W, dist = Math.round(Math.abs(wx - this.cam.x) / w);
      const bx = right ? W - 54 : 8, by = gy + 22 + p.id * 24;
      g.fillStyle = 'rgba(8,10,28,.78)';
      g.beginPath();
      g.roundRect(bx, by, 46, 20, 10);
      g.fill();
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(right ? bx + 12 : bx + 34, by + 10, 6.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '700 10px "DM Sans", sans-serif';
      g.textAlign = 'center';
      g.fillText(String(dist), right ? bx + 28 : bx + 19, by + 14);
      // Arrow pointing towards them.
      const ax = right ? bx + 40 : bx + 6;
      g.beginPath();
      g.moveTo(ax + (right ? 3 : -3), by + 10);
      g.lineTo(ax + (right ? -2 : 2), by + 6);
      g.lineTo(ax + (right ? -2 : 2), by + 14);
      g.fill();
    }
  }

  // ------------------------------------------------------------ landscape

  private sky(d: Look, now: number) {
    const { g, W, H } = this, gy = this.gy();
    const grd = g.createLinearGradient(0, 0, 0, gy);
    grd.addColorStop(0, d.sky[0]);
    grd.addColorStop(1, d.sky[1]);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    const sx = W * 0.8, sy = H * 0.2, sr = Math.min(W, H) * 0.055;
    const glow = g.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 5);
    glow.addColorStop(0, 'rgba(255,240,200,.55)');
    glow.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, gy);
    g.fillStyle = d.city > 0.8 ? '#f4f0ff' : '#fff6d6';
    g.beginPath();
    g.arc(sx, sy, sr, 0, Math.PI * 2);
    g.fill();
    if (d.city > 0.8) {
      g.fillStyle = 'rgba(255,255,255,.7)';
      for (let k = 0; k < 60; k++) g.fillRect(hash(k * 3.1) * W, hash(k * 7.7) * gy * 0.6, 1.5, 1.5);
    }
    const t = now / 1000;
    for (const c of this.clouds) {
      const cx = (((c.x - this.cam.x * 0.04 + t * 8 * c.s) % (W + 300)) + W + 300) % (W + 300) - 150, cy = H * c.y, s = c.s * Math.min(1.2, W / 700 + 0.4);
      g.fillStyle = d.city > 0.8 ? 'rgba(180,170,230,.14)' : 'rgba(255,255,255,.55)';
      for (const [dx, dy, r] of [[0, 0, 26], [22, -8, 22], [44, 0, 24], [20, 8, 22]]) {
        g.beginPath();
        g.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private ridge(par: number, seed: number, amp: number, base: number, scale: number) {
    const pts: [number, number][] = [];
    const off = this.cam.x * par;
    for (let x = -8; x <= this.W + 8; x += 6) pts.push([x, base - fbm((x + off) * scale, seed) * amp]);
    return pts;
  }

  private fillRidge(pts: [number, number][], bottom: number, top: number, c0: string, c1: string) {
    const g = this.g;
    const grd = g.createLinearGradient(0, top, 0, bottom);
    grd.addColorStop(0, c0);
    grd.addColorStop(1, c1);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(pts[0][0], bottom);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(pts[pts.length - 1][0], bottom);
    g.closePath();
    g.fill();
  }

  private landscape(d: Look, now: number) {
    const { g, W, H } = this, gy = this.gy(), haze = d.sky[1];
    // Far range, hazy and snow-capped where the district has peaks.
    const ampFar = H * 0.42 * d.amp + H * 0.04;
    const far = this.ridge(0.06, 1, ampFar, gy - H * 0.04, 0.0042);
    this.fillRidge(far, gy, gy - ampFar, mix(d.far[0], haze, 0.35), mix(d.far[1], haze, 0.55));
    if (d.snow > 0.02) {
      const snowLine = gy - H * 0.04 - ampFar * (1 - d.snow * 0.9);
      g.save();
      g.beginPath();
      g.moveTo(far[0][0], gy);
      for (const [x, y] of far) g.lineTo(x, y);
      g.lineTo(far[far.length - 1][0], gy);
      g.closePath();
      g.clip();
      g.fillStyle = 'rgba(255,255,255,.92)';
      g.beginPath();
      g.moveTo(-8, snowLine);
      for (let x = -8; x <= W + 8; x += 6) g.lineTo(x, snowLine + Math.sin(x * 0.09 + this.cam.x * 0.006) * 6 + vnoise((x + this.cam.x * 0.06) * 0.05, 4) * 12);
      g.lineTo(W + 8, -10);
      g.lineTo(-8, -10);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(80,100,150,.18)';
      for (let k = 1; k < far.length; k++) if (far[k][1] > far[k - 1][1]) g.fillRect(far[k][0], far[k][1], 6, gy - far[k][1]);
      g.restore();
    }
    // Nearer range.
    const ampMid = H * 0.26 * d.amp + H * 0.03;
    const mid = this.ridge(0.12, 7, ampMid, gy - H * 0.02, 0.0065);
    this.fillRidge(mid, gy, gy - ampMid, mix(d.far[0], d.hill[1], 0.45), mix(d.far[1], haze, 0.3));
    const hz = g.createLinearGradient(0, gy - H * 0.2, 0, gy);
    hz.addColorStop(0, rgba(haze, 0));
    hz.addColorStop(1, rgba(haze, 0.45));
    g.fillStyle = hz;
    g.fillRect(0, gy - H * 0.2, W, H * 0.2);
    // City silhouettes in urban districts.
    if (d.city > 0.15) {
      const off = this.cam.x * 0.2;
      for (let k = -1; k < W / 38 + 2; k++) {
        const n = Math.floor(off / 38) + k, x = k * 38 - (off % 38), h = (0.06 + hash(n) * 0.22) * H * d.city;
        g.globalAlpha = 0.85;
        g.fillStyle = mix(d.far[0], '#141a3a', 0.4);
        g.fillRect(x, gy - h - H * 0.02, 32, h + H * 0.02);
        g.fillStyle = d.city > 0.8 ? ['#ff3d81', '#3df5ff', '#ffe23d', '#ffd877'][n & 3] : 'rgba(255,230,150,.7)';
        for (let y = gy - h; y < gy - 6; y += 9) if (hash(n * 13 + y) > 0.55) g.fillRect(x + 4 + (hash(y) > 0.5 ? 12 : 0), y, 8, 3);
        g.globalAlpha = 1;
      }
    }
    // Water.
    if (d.water > 0.2) {
      const top = gy - H * 0.07, a = Math.min(1, d.water);
      const wg = g.createLinearGradient(0, top, 0, gy);
      wg.addColorStop(0, `rgba(58,166,224,${0.85 * a})`);
      wg.addColorStop(1, `rgba(27,95,154,${0.95 * a})`);
      g.fillStyle = wg;
      g.fillRect(0, top, W, gy - top);
      g.fillStyle = `rgba(255,240,200,${0.5 * a})`;
      for (let k = 0; k < 18; k++) {
        const y = top + 4 + (k % 6) * ((gy - top - 6) / 6), x = (((hash(k) * W + now * 0.02 * ((k % 3) + 1) - this.cam.x * 0.3) % W) + W) % W;
        g.fillRect(x, y, 10 + hash(k + 2) * 26, 1.5);
      }
    }
    // Hills with trees along the crest.
    const ampHill = H * (0.09 + d.amp * 0.05);
    const hill = this.ridge(0.32, 21, ampHill, gy + 2, 0.008);
    this.fillRidge(hill, gy + 2, gy - ampHill, d.hill[0], d.hill[1]);
    const off = this.cam.x * 0.32;
    for (let k = -1; k < W / 22 + 2; k++) {
      const n = Math.floor(off / 22) + k;
      if (hash(n * 1.7) < 0.35) continue;
      const x = k * 22 - (off % 22) + hash(n) * 10, y = gy + 2 - fbm((x + off) * 0.008, 21) * ampHill, s = (0.6 + hash(n + 5) * 0.7) * Math.min(1.2, H / 420);
      this.tree(d.trees, x, y + 3, s, shade(d.hill[1], 0.75));
    }
  }

  private tree(kind: string, x: number, y: number, s: number, col: string) {
    const g = this.g;
    if (kind === 'none') return;
    g.fillStyle = col;
    if (kind === 'pine') {
      for (let l = 0; l < 3; l++) {
        g.beginPath();
        g.moveTo(x - (9 - l * 2) * s, y - l * 7 * s);
        g.lineTo(x, y - (14 + l * 7) * s);
        g.lineTo(x + (9 - l * 2) * s, y - l * 7 * s);
        g.fill();
      }
    } else if (kind === 'palm') {
      g.fillRect(x - 1.2 * s, y - 22 * s, 2.4 * s, 22 * s);
      for (let l = 0; l < 5; l++) {
        const a = -Math.PI / 2 + (l - 2) * 0.6;
        g.beginPath();
        g.ellipse(x + Math.cos(a) * 7 * s, y - 22 * s + Math.sin(a) * 4 * s, 9 * s, 2.4 * s, a, 0, Math.PI * 2);
        g.fill();
      }
    } else if (kind === 'cypress') {
      g.beginPath();
      g.ellipse(x, y - 12 * s, 3.5 * s, 13 * s, 0, 0, Math.PI * 2);
      g.fill();
    } else if (kind === 'cherry') {
      g.fillRect(x - 1, y - 10 * s, 2, 10 * s);
      g.fillStyle = 'rgba(255,150,200,.75)';
      g.beginPath();
      g.arc(x, y - 14 * s, 8 * s, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillRect(x - 1, y - 8 * s, 2, 8 * s);
      g.beginPath();
      g.arc(x, y - 12 * s, 7 * s, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ------------------------------------------------------------ plots

  private special(i: number, x: number, w: number, gy: number, now: number) {
    const { g, H } = this, t = TILES[i], bx = x + 12, bw = w * 0.62, cx = bx + bw / 2;
    const box = (h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(bx, gy - h, bw, h);
      g.fillStyle = 'rgba(255,255,255,.15)';
      g.fillRect(bx, gy - h, bw, 6);
    };
    const label = (txt: string, y: number) => {
      g.fillStyle = '#fff';
      g.font = '700 12px Fredoka, sans-serif';
      g.textAlign = 'center';
      g.fillText(txt.toUpperCase(), cx, y);
    };
    g.font = `28px ${EMOJI}`;
    g.textAlign = 'center';
    switch (t.kind) {
      case 'start': {
        g.strokeStyle = '#c9cff5';
        g.lineWidth = 3;
        g.strokeRect(bx + 8, gy - H * 0.45, bw * 0.28, H * 0.45);
        for (let y = gy - H * 0.45; y < gy; y += 14) {
          g.beginPath();
          g.moveTo(bx + 8, y);
          g.lineTo(bx + 8 + bw * 0.28, y + 14);
          g.stroke();
        }
        g.fillStyle = '#fff';
        g.beginPath();
        g.moveTo(cx + 12, gy - H * 0.52);
        g.lineTo(cx + 26, gy - H * 0.42);
        g.lineTo(cx + 26, gy - 20);
        g.lineTo(cx - 2, gy - 20);
        g.lineTo(cx - 2, gy - H * 0.42);
        g.fill();
        g.fillStyle = '#ff3d81';
        g.fillRect(cx - 2, gy - H * 0.3, 28, 8);
        g.fillStyle = 'rgba(255,200,120,.8)';
        g.beginPath();
        g.moveTo(cx - 2, gy - 20);
        g.lineTo(cx + 12, gy - 4 + Math.sin(now / 80) * 3);
        g.lineTo(cx + 26, gy - 20);
        g.fill();
        label(`${t.name} · +$200`, gy - H * 0.54);
        break;
      }
      case 'jail':
        box(H * 0.26, '#5a5f7a');
        g.fillStyle = '#2a2d40';
        for (let s = 0; s < 6; s++) g.fillRect(bx + 8 + (s * (bw - 16)) / 6, gy - H * 0.2, 4, H * 0.17);
        label(t.name, gy - H * 0.21);
        break;
      case 'gotojail':
        box(H * 0.24, '#2a3a8a');
        g.fillStyle = Math.floor(now / 300) % 2 ? '#ff3d4d' : '#3d7bff';
        g.shadowColor = g.fillStyle;
        g.shadowBlur = 16;
        g.fillRect(cx - 14, gy - H * 0.24 - 10, 28, 10);
        g.shadowBlur = 0;
        label('Police', gy - H * 0.17);
        g.fillText('🚨', cx, gy - 16);
        break;
      case 'lounge':
        g.fillStyle = '#3a2a6b';
        g.fillRect(bx, gy - H * 0.2, bw, H * 0.2);
        g.fillStyle = '#ff9fd0';
        g.fillRect(bx - 6, gy - H * 0.2 - 8, bw + 12, 8);
        g.fillText('🍸', cx, gy - H * 0.05);
        label(t.name, gy - H * 0.13);
        if (this.view.state.settings.jackpot && this.view.state.jackpot > 0) {
          g.fillStyle = '#ffc23d';
          g.font = '800 12px "DM Sans", sans-serif';
          g.fillText(`JACKPOT ${money(this.view.state.jackpot)}`, cx, gy - H * 0.22 - 6);
        }
        break;
      case 'transit': {
        box(H * 0.14, '#4a6fa8');
        g.fillStyle = '#c9cff5';
        g.fillRect(bx + bw - 14, gy - H * 0.36, 10, H * 0.22);
        g.fillStyle = '#7fd3f7';
        g.fillRect(bx + bw - 20, gy - H * 0.4, 22, 10);
        const fly = (now / 40) % 160;
        g.fillText('✈️', cx - 20 + fly * 0.4, gy - H * 0.22 - fly * 0.3);
        if (!this.view.state.props[i]) label(t.short, gy - H * 0.05);
        break;
      }
      case 'utility':
        if (t.icon === '☀️') {
          for (let s = 0; s < 3; s++) {
            g.fillStyle = '#1f3a8a';
            g.save();
            g.translate(bx + 10 + s * bw * 0.32, gy - 22);
            g.rotate(-0.4);
            g.fillRect(0, 0, bw * 0.28, 14);
            g.restore();
            g.fillStyle = '#888';
            g.fillRect(bx + 16 + s * bw * 0.32, gy - 14, 3, 14);
          }
        } else {
          g.strokeStyle = '#c9cff5';
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(cx - 20, gy);
          g.lineTo(cx, gy - H * 0.4);
          g.lineTo(cx + 20, gy);
          g.stroke();
          g.fillStyle = '#ff3d81';
          g.beginPath();
          g.arc(cx, gy - H * 0.4, 5 + Math.sin(now / 200) * 2, 0, Math.PI * 2);
          g.fill();
        }
        label(t.name, gy - H * 0.17);
        break;
      case 'tax':
        box(H * 0.22, '#e7e2d6');
        g.fillStyle = '#c9c2b0';
        for (let s = 0; s < 4; s++) g.fillRect(bx + 10 + (s * (bw - 20)) / 4, gy - H * 0.18, 8, H * 0.16);
        g.fillStyle = '#a8a08a';
        g.beginPath();
        g.moveTo(bx - 4, gy - H * 0.22);
        g.lineTo(cx, gy - H * 0.3);
        g.lineTo(bx + bw + 4, gy - H * 0.22);
        g.fill();
        g.fillStyle = '#1d2142';
        g.font = '700 11px Fredoka, sans-serif';
        g.fillText(t.name.toUpperCase(), cx, gy - H * 0.235);
        break;
      case 'fortune':
        g.fillStyle = '#6b2a8f';
        g.beginPath();
        g.moveTo(bx, gy);
        g.lineTo(cx, gy - H * 0.28);
        g.lineTo(bx + bw, gy);
        g.fill();
        g.fillStyle = '#ffd35a';
        for (let s = 0; s < 5; s++) {
          g.beginPath();
          g.arc(bx + 10 + (s * bw) / 5, gy - 12 - hash(s) * H * 0.12, 2, 0, Math.PI * 2);
          g.fill();
        }
        g.fillText('🔮', cx, gy - 8);
        label('Fortune', gy - H * 0.3);
        break;
      case 'treasury':
        box(H * 0.2, '#2f6b5a');
        g.fillStyle = '#e7e2d6';
        for (let s = 0; s < 3; s++) g.fillRect(bx + 12 + (s * (bw - 24)) / 2.5, gy - H * 0.17, 8, H * 0.15);
        g.fillText('💼', cx, gy - H * 0.22);
        label('Treasury', gy - H * 0.26);
        break;
    }
    // Skyports and utilities can be owned too.
    const o = this.view.state.props[i];
    if (o) this.ownerMarks(i, bx, bw, gy, gy - H * (t.kind === 'transit' ? 0.4 : 0.3), o.owner, o.mortgaged);
  }

  private building(i: number, x: number, w: number, gy: number, now: number) {
    const { g, H } = this, t = TILES[i], d = districtOf(i), o = this.view.state.props[i], k = this.grows[i] ?? 1, bx = x + 12, bw = w * 0.62;
    if (!o) {
      g.fillStyle = shade(d.walk, 0.85);
      g.fillRect(bx, gy - 5, bw, 5);
      g.strokeStyle = 'rgba(255,255,255,.6)';
      g.setLineDash([5, 5]);
      g.lineWidth = 1.5;
      g.strokeRect(bx, gy - 30, bw, 30);
      g.setLineDash([]);
      g.fillStyle = '#6b6f8f';
      g.fillRect(bx + bw / 2 - 2, gy - 26, 4, 26);
      g.fillStyle = '#fff';
      g.beginPath();
      g.roundRect(bx + bw / 2 - 38, gy - 70, 76, 44, 6);
      g.fill();
      g.fillStyle = GROUPS[t.group!].color;
      g.beginPath();
      g.roundRect(bx + bw / 2 - 38, gy - 70, 76, 11, [6, 6, 0, 0]);
      g.fill();
      g.fillStyle = '#e8423f';
      g.font = '800 11px "DM Sans", sans-serif';
      g.textAlign = 'center';
      g.fillText('FOR SALE', bx + bw / 2, gy - 46);
      g.fillStyle = '#1d2142';
      g.font = '800 12px "DM Sans", sans-serif';
      g.fillText(money(t.price!), bx + bw / 2, gy - 32);
      return;
    }
    const lv = o.houses, wall = d.walls[i % d.walls.length], fh = Math.max(16, H * 0.042);
    if (o.mortgaged) g.globalAlpha = 0.55;
    let top: number;
    if (lv >= 5) top = this.landmark(d.land, bx, bw, gy, k, GROUPS[t.group!].color);
    else {
      const floors = 1 + lv * 2, h = floors * fh * k, by = gy - h;
      top = by;
      const grd = g.createLinearGradient(bx, 0, bx + bw, 0);
      grd.addColorStop(0, wall);
      grd.addColorStop(1, shade(wall, 0.78));
      g.fillStyle = grd;
      g.fillRect(bx, by, bw, h);
      const glow = d.roof === 'neon' || d.roof === 'glass';
      for (let f = 1; f < floors * k - 0.3; f++)
        for (let c = 0; c < 3; c++) {
          const wx = bx + 8 + c * ((bw - 16) / 3), wy = gy - (f + 1) * fh + 5, ww = (bw - 16) / 3 - 6;
          g.fillStyle = glow ? (hash(i * 31 + f * 7 + c) > 0.4 ? '#ffe08a' : '#3a4a8a') : d.roof === 'chalet' ? '#ffe9b0' : '#4a6a9a';
          if (d.roof === 'dome' || d.roof === 'tile') {
            g.beginPath();
            g.roundRect(wx, wy, ww, fh - 8, [6, 6, 0, 0]);
            g.fill();
          } else g.fillRect(wx, wy, ww, fh - 9);
        }
      this.roof(d, bx, bw, by, k, i);
    }
    g.globalAlpha = 1;
    this.ownerMarks(i, bx, bw, gy, top, o.owner, o.mortgaged, fh);
    void now;
  }

  /** Fence, awning and flag in the owner's colour, so ownership reads at a glance. */
  private ownerMarks(i: number, bx: number, bw: number, gy: number, top: number, owner: number, mortgaged: boolean, fh = 18) {
    const g = this.g, pc = this.view.state.players[owner].color, now = performance.now();
    g.fillStyle = pc;
    g.fillRect(bx - 6, gy - 4, bw + 12, 4);
    for (let p = bx - 6; p <= bx + bw + 6; p += 8) g.fillRect(p, gy - 12, 2.5, 12);
    g.fillRect(bx - 6, gy - 11, bw + 12, 2);
    if (TILES[i].kind === 'property') {
      const aw = Math.min(fh * 0.7, 14);
      g.beginPath();
      g.moveTo(bx - 4, gy - fh + 2);
      g.lineTo(bx + bw + 4, gy - fh + 2);
      g.lineTo(bx + bw + 8, gy - fh + 2 + aw);
      g.lineTo(bx - 8, gy - fh + 2 + aw);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)';
      for (let s = 0; s < bw + 8; s += 12) g.fillRect(bx - 4 + s, gy - fh + 2, 6, aw);
    }
    const rf = this.flags[i] ?? 1, pole = 34, fy = top - pole + (1 - rf) * (pole - 14), wave = Math.sin(now / 200) * 2;
    g.fillStyle = '#e6e8f5';
    g.fillRect(bx + bw - 8, top - pole, 2.5, pole);
    g.fillStyle = pc;
    g.beginPath();
    g.moveTo(bx + bw - 5.5, fy);
    g.quadraticCurveTo(bx + bw + 10, fy + 3 + wave, bx + bw + 22, fy + 2);
    g.lineTo(bx + bw + 22, fy + 16);
    g.quadraticCurveTo(bx + bw + 10, fy + 17 + wave, bx + bw - 5.5, fy + 14);
    g.fill();
    if (mortgaged) {
      g.save();
      g.translate(bx + bw / 2, gy - 40);
      g.rotate(-0.25);
      g.fillStyle = '#ffd23d';
      g.fillRect(-bw * 0.65, -9, bw * 1.3, 18);
      g.fillStyle = '#1d2142';
      g.font = '800 11px "DM Sans", sans-serif';
      g.textAlign = 'center';
      g.fillText('MORTGAGED', 0, 4);
      g.restore();
    }
  }

  private roof(d: District, bx: number, bw: number, by: number, k: number, i: number) {
    const g = this.g;
    switch (d.roof) {
      case 'tin':
        g.fillStyle = '#8a95a8';
        g.beginPath();
        g.moveTo(bx - 6, by);
        g.lineTo(bx + bw + 6, by - 12);
        g.lineTo(bx + bw + 6, by);
        g.fill();
        break;
      case 'tile':
        g.fillStyle = '#c4572f';
        g.beginPath();
        g.moveTo(bx - 8, by);
        g.lineTo(bx + bw / 2, by - 22 * k);
        g.lineTo(bx + bw + 8, by);
        g.fill();
        break;
      case 'dome':
        g.fillStyle = i % 2 ? '#2fa8a0' : '#e0b04a';
        g.beginPath();
        g.arc(bx + bw / 2, by, bw * 0.3, Math.PI, 0);
        g.fill();
        g.fillRect(bx + bw / 2 - 1.5, by - bw * 0.3 - 10, 3, 10);
        break;
      case 'mansard':
        g.fillStyle = '#4a5068';
        g.beginPath();
        g.moveTo(bx - 4, by);
        g.lineTo(bx + 8, by - 20);
        g.lineTo(bx + bw - 8, by - 20);
        g.lineTo(bx + bw + 4, by);
        g.fill();
        break;
      case 'chalet':
        g.fillStyle = '#5a3a28';
        g.beginPath();
        g.moveTo(bx - 12, by + 4);
        g.lineTo(bx + bw / 2, by - 30);
        g.lineTo(bx + bw + 12, by + 4);
        g.fill();
        g.fillStyle = '#fff';
        g.beginPath();
        g.moveTo(bx - 6, by - 2);
        g.lineTo(bx + bw / 2, by - 30);
        g.lineTo(bx + bw + 6, by - 2);
        g.lineTo(bx + bw / 2, by - 22);
        g.fill();
        break;
      case 'neon':
        g.fillStyle = ['#ff3d81', '#3df5ff', '#ffe23d'][i % 3];
        g.shadowColor = g.fillStyle;
        g.shadowBlur = 12;
        g.fillRect(bx + 6, by - 14, bw - 12, 8);
        g.shadowBlur = 0;
        break;
      case 'glass':
        g.fillStyle = 'rgba(160,200,255,.5)';
        g.fillRect(bx, by - 6, bw, 6);
        break;
      default:
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.fillRect(bx - 3, by - 5, bw + 6, 5);
    }
  }

  private landmark(kind: string, bx: number, bw: number, gy: number, k: number, accent: string) {
    const { g, H } = this, h = H * 0.5 * k, cx = bx + bw / 2, top = gy - h;
    if (kind === 'lattice') {
      g.strokeStyle = '#7a5a3a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(bx, gy);
      g.lineTo(cx - 3, top);
      g.lineTo(cx + 3, top);
      g.lineTo(bx + bw, gy);
      for (let y = 0.25; y < 1; y += 0.25) {
        const yy = gy - h * y, half = (bw / 2) * (1 - y);
        g.moveTo(cx - half, yy);
        g.lineTo(cx + half, yy);
      }
      g.stroke();
      g.beginPath();
      g.arc(cx, gy, bw * 0.28, Math.PI, 0);
      g.stroke();
    } else if (kind === 'pagoda') {
      for (let f = 0; f < 6; f++) {
        const fy = gy - (f + 1) * (h / 6), fw = bw * (1 - f * 0.1);
        g.fillStyle = '#2a2f5a';
        g.fillRect(cx - fw / 2 + 6, fy, fw - 12, h / 6);
        g.fillStyle = '#ff3d81';
        g.shadowColor = '#ff3d81';
        g.shadowBlur = 10;
        g.beginPath();
        g.moveTo(cx - fw / 2 - 6, fy + 4);
        g.lineTo(cx + fw / 2 + 6, fy + 4);
        g.lineTo(cx + fw / 2 - 4, fy - 4);
        g.lineTo(cx - fw / 2 + 4, fy - 4);
        g.fill();
        g.shadowBlur = 0;
      }
    } else if (kind === 'mosque') {
      g.fillStyle = '#efd2a0';
      g.fillRect(bx, gy - h * 0.35, bw, h * 0.35);
      g.fillStyle = '#2fa8a0';
      g.beginPath();
      g.arc(cx, gy - h * 0.35, bw * 0.42, Math.PI, 0);
      g.fill();
      for (const mx of [bx - 4, bx + bw - 4]) {
        g.fillStyle = '#efd2a0';
        g.fillRect(mx, top, 8, h);
        g.fillStyle = '#2fa8a0';
        g.beginPath();
        g.moveTo(mx - 2, top);
        g.lineTo(mx + 4, top - 18);
        g.lineTo(mx + 10, top);
        g.fill();
      }
    } else if (kind === 'lighthouse') {
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(cx - bw * 0.25, gy);
      g.lineTo(cx - bw * 0.14, top + 24);
      g.lineTo(cx + bw * 0.14, top + 24);
      g.lineTo(cx + bw * 0.25, gy);
      g.fill();
      g.fillStyle = '#e8423f';
      for (let s = 0; s < 4; s++) g.fillRect(cx - bw * 0.22 + s * 1.5, gy - (s * 2 + 1) * h * 0.11, bw * 0.44 - s * 3, h * 0.1);
      g.fillStyle = '#ffe08a';
      g.shadowColor = '#ffe08a';
      g.shadowBlur = 24;
      g.fillRect(cx - bw * 0.12, top, bw * 0.24, 24);
      g.shadowBlur = 0;
    } else if (kind === 'temple') {
      for (let s = 0; s < 6; s++) {
        const sw = bw * (1.1 - s * 0.15);
        g.fillStyle = s % 2 ? '#c9a46b' : '#b88f55';
        g.fillRect(cx - sw / 2, gy - (s + 1) * (h / 7), sw, h / 7);
      }
      g.fillStyle = '#ffd35a';
      g.fillRect(cx - 8, top, 16, h / 7);
    } else if (kind === 'clock') {
      g.fillStyle = '#9b6a45';
      g.fillRect(cx - bw * 0.22, top + 20, bw * 0.44, h - 20);
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(cx, top + 44, bw * 0.16, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#333';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, top + 44);
      g.lineTo(cx, top + 34);
      g.moveTo(cx, top + 44);
      g.lineTo(cx + 7, top + 44);
      g.stroke();
      g.fillStyle = '#5a3a28';
      g.beginPath();
      g.moveTo(cx - bw * 0.3, top + 22);
      g.lineTo(cx, top - 10);
      g.lineTo(cx + bw * 0.3, top + 22);
      g.fill();
    } else if (kind === 'deco') {
      g.fillStyle = '#ffd36e';
      for (let s = 0; s < 4; s++) {
        const sw = bw * (1 - s * 0.2);
        g.fillRect(cx - sw / 2, gy - (h * (s + 1)) / 4, sw, h / 4);
      }
      g.fillStyle = '#ff7f63';
      g.fillRect(cx - 2, top - 20, 4, 20);
    } else {
      const grd = g.createLinearGradient(bx, 0, bx + bw, 0);
      grd.addColorStop(0, '#8fb0ff');
      grd.addColorStop(0.5, '#3a4aa8');
      grd.addColorStop(1, '#1b2056');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(bx, gy);
      g.lineTo(bx + bw * 0.2, top + 30);
      g.lineTo(cx, top);
      g.lineTo(bx + bw * 0.8, top + 30);
      g.lineTo(bx + bw, gy);
      g.fill();
      g.fillStyle = accent;
      g.fillRect(cx - 1.5, top - 30, 3, 30);
      g.fillStyle = 'rgba(255,230,140,.8)';
      for (let y = top + 40; y < gy - 10; y += 10) g.fillRect(cx - bw * 0.25 + (y % 20 ? 4 : 0), y, bw * 0.5 - 8, 2);
    }
    return top;
  }

  /** Street sign: district colour and name; owner and rent once bought. */
  private sign(i: number, x: number, w: number, gy: number) {
    const g = this.g, t = TILES[i], o = this.view.state.props[i], sx = x + w * 0.72, sw = w * 0.3 + 16;
    g.fillStyle = '#c9cff5';
    g.fillRect(sx + w * 0.11, gy - 54, 3, 54);
    g.fillStyle = t.group ? GROUPS[t.group].color : '#2a6b5a';
    g.beginPath();
    g.roundRect(sx - 8, gy - 74, sw, 22, 5);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '700 11px "DM Sans", sans-serif';
    g.textAlign = 'center';
    g.fillText(t.short.length > 12 ? t.short.slice(0, 11) + '.' : t.short, sx - 8 + sw / 2, gy - 59);
    if (o && t.price) {
      const p = this.view.state.players[o.owner];
      g.fillStyle = p.color;
      g.beginPath();
      g.roundRect(sx - 8, gy - 50, sw, 30, 5);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '800 9px "DM Sans", sans-serif';
      g.fillText(p.name.toUpperCase().slice(0, 10), sx - 8 + sw / 2, gy - 38);
      g.font = '800 10px "DM Sans", sans-serif';
      g.fillText(o.mortgaged ? 'NO RENT' : 'RENT ' + money(this.view.rentOf(i)), sx - 8 + sw / 2, gy - 25);
    }
  }

  private lamp(x: number, gy: number, d: District) {
    const g = this.g;
    if (d.roof === 'neon' || d.roof === 'glass') {
      g.fillStyle = '#3df5ff';
      g.shadowColor = '#3df5ff';
      g.shadowBlur = 10;
      g.fillRect(x - 1, gy - 46, 2, 46);
      g.shadowBlur = 0;
      return;
    }
    g.fillStyle = '#2a2d40';
    g.fillRect(x - 1.5, gy - 44, 3, 44);
    g.beginPath();
    g.arc(x + 6, gy - 44, 6, Math.PI, 0);
    g.fill();
    g.fillStyle = 'rgba(255,230,150,.9)';
    g.fillRect(x + 2, gy - 44, 8, 3);
  }
}
