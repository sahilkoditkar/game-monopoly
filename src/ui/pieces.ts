/** Playing pieces: each player picks a piece and a colour instead of an emoji token. */

export type PieceKind = 'car' | 'robot' | 'walker' | 'pin';

export const PIECES: { id: PieceKind; label: string }[] = [
  { id: 'car', label: 'City car' },
  { id: 'robot', label: 'Robot' },
  { id: 'walker', label: 'Walker' },
  { id: 'pin', label: 'Map pin' },
];

export const PIECE_COLORS = ['#ff3d81', '#3a86ff', '#22c3a6', '#ffb000', '#8b5cf6', '#f97316', '#84cc16', '#ef4444'];

const SKIN = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'];

/** Older saves stored an emoji token; treat anything unknown as a car. */
export function pieceKind(token: string): PieceKind {
  return (PIECES.find((p) => p.id === token)?.id ?? 'car') as PieceKind;
}

const hexRgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export function shade(h: string, k: number) {
  return '#' + hexRgb(h).map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join('');
}

export interface PieceOpts {
  moving: boolean;
  phase: number;
  seat: number;
  time: number;
}

/** Draws a piece standing on (0, 22) in the current canvas transform. */
export function drawPiece(g: CanvasRenderingContext2D, kind: PieceKind, color: string, o: PieceOpts) {
  const { moving, phase: ph, time } = o;
  g.fillStyle = 'rgba(0,0,0,.3)';
  g.beginPath();
  g.ellipse(0, 22, 26, 5, 0, 0, Math.PI * 2);
  g.fill();
  if (kind === 'car') {
    g.save();
    g.translate(0, moving ? Math.sin(ph * 2) * 1.2 : 0);
    const body = g.createLinearGradient(0, -14, 0, 14);
    body.addColorStop(0, shade(color, 1.25));
    body.addColorStop(1, shade(color, 0.7));
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-34, 14);
    g.lineTo(-34, 2);
    g.quadraticCurveTo(-33, -4, -24, -6);
    g.lineTo(-14, -18);
    g.quadraticCurveTo(-10, -22, -2, -22);
    g.lineTo(12, -22);
    g.quadraticCurveTo(19, -22, 22, -16);
    g.lineTo(28, -6);
    g.quadraticCurveTo(36, -4, 36, 4);
    g.lineTo(36, 14);
    g.closePath();
    g.fill();
    g.fillStyle = '#cfeaff';
    g.beginPath();
    g.moveTo(-12, -16);
    g.quadraticCurveTo(-9, -19, -3, -19);
    g.lineTo(3, -19);
    g.lineTo(3, -7);
    g.lineTo(-19, -7);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(6, -19);
    g.lineTo(12, -19);
    g.quadraticCurveTo(17, -19, 19, -14);
    g.lineTo(23, -7);
    g.lineTo(6, -7);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.fillRect(-10, -17, 3, 9);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(-32, 6, 66, 2);
    g.fillRect(3, -6, 2, 18);
    g.fillStyle = '#fff3b0';
    g.shadowColor = '#fff3b0';
    g.shadowBlur = 10;
    g.beginPath();
    g.ellipse(33, 0, 3, 2.5, 0, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#ff5a5a';
    g.fillRect(-35, -1, 3, 4);
    for (const wx of [-20, 22]) {
      g.fillStyle = '#16182c';
      g.beginPath();
      g.arc(wx, 14, 8.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c9cff5';
      g.beginPath();
      g.arc(wx, 14, 4.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#6a7090';
      g.lineWidth = 1.2;
      for (let s = 0; s < 5; s++) {
        const a = ph * 3 + (s / 5) * Math.PI * 2;
        g.beginPath();
        g.moveTo(wx, 14);
        g.lineTo(wx + Math.cos(a) * 4.5, 14 + Math.sin(a) * 4.5);
        g.stroke();
      }
    }
    g.restore();
  } else if (kind === 'robot') {
    const step = moving ? Math.sin(ph * 2.2) : 0;
    g.save();
    g.translate(0, -(moving ? Math.abs(Math.cos(ph * 2.2)) * 2 : Math.sin(time / 400)));
    for (const [lx, sw] of [[-6, step], [6, -step]]) {
      g.save();
      g.translate(lx, 6);
      g.rotate(sw * 0.4);
      g.fillStyle = '#3a3f5a';
      g.fillRect(-3, 0, 6, 15);
      g.fillStyle = '#20233a';
      g.fillRect(-4.5, 13, 9, 4);
      g.restore();
    }
    const body = g.createLinearGradient(-12, 0, 12, 0);
    body.addColorStop(0, shade(color, 1.2));
    body.addColorStop(1, shade(color, 0.75));
    g.fillStyle = body;
    g.beginPath();
    g.roundRect(-12, -14, 24, 22, 5);
    g.fill();
    g.fillStyle = '#c9cff5';
    for (const [ax, sw] of [[-15, -step], [15, step]]) {
      g.save();
      g.translate(ax, -10);
      g.rotate(sw * 0.5);
      g.fillRect(-2.5, 0, 5, 14);
      g.restore();
    }
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.beginPath();
    g.arc(0, -3, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8ecff';
    g.beginPath();
    g.roundRect(-10, -32, 20, 16, 6);
    g.fill();
    g.fillStyle = '#1b1f3a';
    g.beginPath();
    g.roundRect(-8, -28, 16, 8, 4);
    g.fill();
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 8;
    g.fillRect(-5 + (moving ? 3 : Math.sin(time / 600) * 3), -26, 6, 4);
    g.shadowBlur = 0;
    g.fillStyle = '#c9cff5';
    g.fillRect(-1, -40, 2, 8);
    g.fillStyle = color;
    g.beginPath();
    g.arc(0, -41, 3, 0, Math.PI * 2);
    g.fill();
    g.restore();
  } else if (kind === 'walker') {
    const step = moving ? Math.sin(ph * 2.4) : 0;
    g.save();
    g.translate(0, -(moving ? Math.abs(Math.cos(ph * 2.4)) * 1.5 : 0));
    g.strokeStyle = '#2a2d48';
    g.lineWidth = 5;
    g.lineCap = 'round';
    for (const sw of [step, -step]) {
      g.beginPath();
      g.moveTo(0, 4);
      g.lineTo(Math.sin(sw * 0.6) * 9, 20);
      g.stroke();
    }
    g.fillStyle = '#20233a';
    g.beginPath();
    g.roundRect(-8, -14, 9, 15, 3);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(-6, -18, 13, 23, 6);
    g.fill();
    g.strokeStyle = shade(color, 0.75);
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(1, -13);
    g.lineTo(1 + Math.sin(-step * 0.7) * 9, 0);
    g.stroke();
    g.fillStyle = SKIN[o.seat % SKIN.length];
    g.beginPath();
    g.arc(1, -26, 7.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a1c14';
    g.beginPath();
    g.arc(1, -28, 7.5, Math.PI, 0);
    g.fill();
    g.fillStyle = color;
    g.fillRect(-7, -31, 16, 3);
    g.fillRect(5, -30, 6, 2);
    g.restore();
  } else {
    g.save();
    g.translate(0, -(moving ? Math.abs(Math.sin(ph * 2)) * 10 : Math.sin(time / 500) * 1.5));
    const grd = g.createRadialGradient(-4, -30, 2, 0, -24, 16);
    grd.addColorStop(0, shade(color, 1.4));
    grd.addColorStop(1, shade(color, 0.7));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, 18);
    g.bezierCurveTo(-6, 4, -15, -8, -15, -22);
    g.arc(0, -22, 15, Math.PI, 0);
    g.bezierCurveTo(15, -8, 6, 4, 0, 18);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, -22, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(0, -22, 3.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

/** Small SVG of a piece for chips, logs and menus. */
export function pieceIcon(kind: PieceKind, color: string, size = 28): string {
  const dark = shade(color, 0.7);
  const shapes: Record<PieceKind, string> = {
    car: `<path d="M3 21v-5q1-3 5-3l4-5q1-1 3-1h6q2 0 3 2l3 4q4 1 4 4v4z" fill="${color}"/><path d="M13 13l3-4h4v4zM22 13V9h1q1 0 2 2l1 2z" fill="#cfeaff"/><circle cx="10" cy="21" r="3.6" fill="#16182c"/><circle cx="26" cy="21" r="3.6" fill="#16182c"/><circle cx="10" cy="21" r="1.6" fill="#c9cff5"/><circle cx="26" cy="21" r="1.6" fill="#c9cff5"/>`,
    robot: `<rect x="11" y="3" width="14" height="10" rx="4" fill="#e8ecff"/><rect x="13" y="6" width="10" height="4" rx="2" fill="#1b1f3a"/><rect x="15" y="7" width="4" height="2" fill="${color}"/><rect x="10" y="14" width="16" height="12" rx="3" fill="${color}"/><rect x="12" y="26" width="4" height="5" fill="${dark}"/><rect x="20" y="26" width="4" height="5" fill="${dark}"/>`,
    walker: `<circle cx="18" cy="8" r="5" fill="#e0ac69"/><path d="M13 6a5 5 0 0 1 10 0z" fill="#2a1c14"/><rect x="13" y="13" width="10" height="12" rx="4" fill="${color}"/><path d="M15 24l-2 7M21 24l2 7" stroke="#2a2d48" stroke-width="3" stroke-linecap="round"/>`,
    pin: `<path d="M18 33C15 26 8 21 8 13a10 10 0 0 1 20 0c0 8-7 13-10 20z" fill="${color}"/><circle cx="18" cy="13" r="4.5" fill="#fff"/>`,
  };
  return `<svg class="piece-icon" width="${size}" height="${size}" viewBox="0 0 36 34" aria-hidden="true">${shapes[kind]}</svg>`;
}
