import { el } from './fx';

/** Pip positions on a 3x3 grid for each face value. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Face placement on the cube and the cube rotation that shows each value to the viewer. */
const FACES: { value: number; cls: string }[] = [
  { value: 1, cls: 'front' },
  { value: 6, cls: 'back' },
  { value: 3, cls: 'right' },
  { value: 4, cls: 'left' },
  { value: 5, cls: 'top' },
  { value: 2, cls: 'bottom' },
];
const SHOW: Record<number, [number, number]> = {
  1: [0, 0],
  6: [0, 180],
  3: [0, -90],
  4: [0, 90],
  5: [-90, 0],
  2: [90, 0],
};

class Die {
  root = el('div', 'die');
  cube = el('div', 'cube');
  private spins = 0;

  constructor() {
    for (const f of FACES) {
      const face = el('div', `face ${f.cls}`);
      for (let i = 0; i < 9; i++) face.appendChild(el('span', PIPS[f.value].includes(i) ? 'pip' : 'pip off'));
      this.cube.appendChild(face);
    }
    this.root.appendChild(this.cube);
    this.set(1, false);
  }

  set(value: number, animate: boolean) {
    const [x, y] = SHOW[value];
    if (animate) this.spins += 2;
    const sx = this.spins * 360 + (animate ? 360 * (Math.random() < 0.5 ? 1 : 0) : 0);
    const sy = this.spins * 360;
    const z = animate ? (Math.random() - 0.5) * 40 : 0;
    this.cube.style.transition = animate ? '' : 'none';
    this.cube.style.transform = `rotateX(${x + sx}deg) rotateY(${y + sy}deg) rotateZ(${z}deg)`;
  }
}

export class DicePair {
  root = el('div', 'dice');
  private dice = [new Die(), new Die()];

  constructor() {
    for (const d of this.dice) this.root.appendChild(d.root);
  }

  show(values: [number, number]) {
    this.dice.forEach((d, i) => d.set(values[i], false));
  }

  async roll(values: [number, number], duration: number) {
    this.root.classList.remove('doubles');
    this.root.style.setProperty('--roll-ms', `${duration}ms`);
    this.root.classList.remove('rolling');
    void this.root.offsetWidth;
    this.root.classList.add('rolling');
    this.dice.forEach((d, i) => d.set(values[i], true));
    await new Promise((r) => setTimeout(r, duration));
    this.root.classList.remove('rolling');
    if (values[0] === values[1]) this.root.classList.add('doubles');
  }
}
