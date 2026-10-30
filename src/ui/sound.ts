/** Tiny synthesized sound effects, so the game ships without audio files. */
type Sfx =
  | 'dice'
  | 'step'
  | 'coin'
  | 'pay'
  | 'buy'
  | 'jail'
  | 'card'
  | 'build'
  | 'win'
  | 'turn'
  | 'gavel'
  | 'bankrupt'
  | 'click'
  | 'error'
  | 'jackpot';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

try {
  muted = localStorage.getItem('st-muted') === '1';
} catch {
  /* storage unavailable */
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('st-muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Must be called from a user gesture before audio can play on mobile. */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, endFreq?: number) {
  const c = ctx!;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(master!);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

let noiseBuffer: AudioBuffer | null = null;
function noise(start: number, dur: number, freq: number, vol = 0.3, q = 1, endFreq?: number) {
  const c = ctx!;
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, start);
  if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(start);
  src.stop(start + dur + 0.05);
}

export function play(name: Sfx) {
  if (muted || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  switch (name) {
    case 'dice':
      for (let i = 0; i < 7; i++) noise(t + i * 0.07 + Math.random() * 0.03, 0.05, 2500 + Math.random() * 2000, 0.5, 3);
      break;
    case 'step':
      tone(520 + Math.random() * 60, t, 0.07, 'triangle', 0.12);
      break;
    case 'coin':
      tone(988, t, 0.08, 'square', 0.08);
      tone(1319, t + 0.07, 0.25, 'square', 0.08);
      break;
    case 'pay':
      tone(660, t, 0.1, 'triangle', 0.15);
      tone(440, t + 0.09, 0.2, 'triangle', 0.15);
      break;
    case 'buy':
      noise(t, 0.05, 3000, 0.3, 2);
      tone(1568, t + 0.05, 0.5, 'sine', 0.2);
      tone(2093, t + 0.1, 0.5, 'sine', 0.15);
      break;
    case 'jail':
      for (let i = 0; i < 3; i++) tone(700, t + i * 0.3, 0.28, 'sawtooth', 0.08, 1000);
      break;
    case 'card':
      noise(t, 0.25, 800, 0.25, 0.8, 4000);
      break;
    case 'build':
      tone(180, t, 0.08, 'triangle', 0.3);
      tone(160, t + 0.12, 0.08, 'triangle', 0.3);
      noise(t, 0.04, 1200, 0.2, 4);
      noise(t + 0.12, 0.04, 1200, 0.2, 4);
      break;
    case 'win':
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, t + i * 0.12, 0.3, 'triangle', 0.18));
      break;
    case 'turn':
      tone(784, t, 0.18, 'sine', 0.1);
      tone(1175, t + 0.08, 0.25, 'sine', 0.08);
      break;
    case 'gavel':
      tone(220, t, 0.06, 'square', 0.15);
      noise(t, 0.06, 900, 0.4, 2);
      break;
    case 'bankrupt':
      [392, 370, 349, 330].forEach((f, i) => tone(f, t + i * 0.3, i === 3 ? 0.8 : 0.28, 'sawtooth', 0.08));
      break;
    case 'click':
      tone(1200, t, 0.03, 'sine', 0.06);
      break;
    case 'error':
      tone(200, t, 0.15, 'square', 0.08);
      break;
    case 'jackpot':
      for (let i = 0; i < 10; i++) tone(1000 + i * 120, t + i * 0.05, 0.15, 'square', 0.05);
      break;
  }
}
