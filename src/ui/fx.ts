/** Visual effects: confetti, floating text, flying coins. */

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  html = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// ---------------------------------------------------------------- confetti

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  color: string;
  size: number;
  life: number;
  shape: number;
}

let canvas: HTMLCanvasElement | null = null;
let particles: Particle[] = [];
let running = false;

const COLORS = ['#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff', '#2ec4b6', '#ffffff'];

export function confetti(x = window.innerWidth / 2, y = window.innerHeight / 3, count = 120, colors = COLORS) {
  if (reducedMotion()) return;
  if (!canvas) {
    canvas = el('canvas', 'fx-canvas');
    document.body.appendChild(canvas);
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 4 + Math.random() * 9;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[i % colors.length],
      size: 5 + Math.random() * 6,
      life: 90 + Math.random() * 60,
      shape: Math.random() < 0.3 ? 1 : 0,
    });
  }
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
}

function tick() {
  const c = canvas!;
  const g = c.getContext('2d')!;
  const dpr = c.width / window.innerWidth;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  particles = particles.filter((p) => p.life > 0 && p.y < window.innerHeight + 40);
  for (const p of particles) {
    p.vy += 0.25;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life--;
    g.save();
    g.globalAlpha = Math.min(1, p.life / 30);
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.fillStyle = p.color;
    if (p.shape) {
      g.beginPath();
      g.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    g.restore();
  }
  if (particles.length) requestAnimationFrame(tick);
  else {
    running = false;
    g.clearRect(0, 0, c.width, c.height);
  }
}

// ---------------------------------------------------------------- floating text

export function floatText(x: number, y: number, text: string, cls = '') {
  const f = el('div', `float-text ${cls}`, escapeHtml(text));
  f.style.left = `${x}px`;
  f.style.top = `${y}px`;
  document.body.appendChild(f);
  f.addEventListener('animationend', () => f.remove());
  setTimeout(() => f.remove(), 3000);
}

export function centerOf(e: Element): { x: number; y: number } {
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Coins fly along an arc between two screen points. */
export async function flyCoins(from: { x: number; y: number }, to: { x: number; y: number }, count = 6, duration = 700) {
  if (reducedMotion()) return;
  const jobs: Promise<unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const c = el('div', 'coin', '$');
    document.body.appendChild(c);
    const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * 80;
    const midY = Math.min(from.y, to.y) - 80 - Math.random() * 60;
    const anim = c.animate(
      [
        { transform: `translate(${from.x}px, ${from.y}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${midX}px, ${midY}px) scale(1.1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${to.x}px, ${to.y}px) scale(0.6)`, opacity: 0.2 },
      ],
      { duration, delay: i * 60, easing: 'cubic-bezier(.4,.1,.4,1)', fill: 'both' },
    );
    jobs.push(anim.finished.then(() => c.remove()).catch(() => c.remove()));
  }
  await Promise.all(jobs);
}

/** Smoothly counts a number element from one value to another. */
export function countTo(node: HTMLElement, from: number, to: number, duration = 600) {
  if (from === to || reducedMotion()) {
    node.textContent = money(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    node.textContent = money(from + (to - from) * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function toast(html: string, cls = '', ms = 2600) {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = el('div', 'toasts');
    document.body.appendChild(host);
  }
  const t = el('div', `toast ${cls}`, html);
  host.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 400);
  }, ms);
}
