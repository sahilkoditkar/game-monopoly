import type { Difficulty, PlayerConfig, Settings } from '../game/types';
import { el, escapeHtml } from './fx';
import { PIECES, PIECE_COLORS, pieceIcon, pieceKind, type PieceKind } from './pieces';
import { play, unlockAudio } from './sound';

const AI_NAMES = ['Ava', 'Bolt', 'Cleo', 'Dex', 'Echo', 'Fizz'];

interface Seat {
  name: string;
  piece: PieceKind;
  color: string;
  ai: boolean;
  difficulty: Difficulty;
  /** Older saved setups stored an emoji token. */
  token?: string;
}

export interface SetupResult {
  players: PlayerConfig[];
  settings: Partial<Settings>;
}

const STORE = 'st-setup';

function loadSetup(): { count: number; seats: Seat[]; settings: Partial<Settings> } | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function defaultSeats(): Seat[] {
  return [
    { name: 'Player 1', piece: 'car', color: PIECE_COLORS[0], ai: false, difficulty: 'normal' },
    { name: AI_NAMES[0], piece: 'robot', color: PIECE_COLORS[1], ai: true, difficulty: 'normal' },
    { name: AI_NAMES[1], piece: 'walker', color: PIECE_COLORS[2], ai: true, difficulty: 'normal' },
    { name: AI_NAMES[2], piece: 'pin', color: PIECE_COLORS[3], ai: true, difficulty: 'normal' },
  ];
}

function upgradeSeats(seats: Seat[]): Seat[] {
  return seats.map((s, i) => ({ ...s, piece: s.piece ?? pieceKind(s.token ?? ''), color: s.color ?? PIECE_COLORS[i] }));
}

const skylineSvg = `
<svg class="skyline" viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs><linearGradient id="sk" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2b2f77"/><stop offset="1" stop-color="#141852"/></linearGradient></defs>
  <path fill="url(#sk)" d="M0 220V150h40v-30h30v40h25V90h40v70h20v-50h35v110h30V60l25-20 25 20v160h20v-90h45v90h25V120h30v-20h30v120h25V80h50v140h20v-60h40v60h30V30h12V10h6v20h12v190h25v-110h45v110h20v-70h35v70h30V100h40v120h25V140h30v-30h35v110h20V70h45v150h25v-80h40v80h30v-60h35v60h20V110h40v110z"/>
  <g fill="#ffd166" opacity=".8">${Array.from({ length: 70 }, (_, i) => `<rect x="${(i * 157) % 1180 + 10}" y="${100 + ((i * 53) % 100)}" width="5" height="7" rx="1"><animate attributeName="opacity" values="1;.2;1" dur="${3 + (i % 5)}s" begin="${i % 7}s" repeatCount="indefinite"/></rect>`).join('')}</g>
</svg>`;

export function renderSetup(host: HTMLElement, opts: { hasSave: boolean; onStart: (r: SetupResult) => void; onContinue: () => void; onRules: () => void }) {
  const saved = loadSetup();
  let count = saved?.count ?? 2;
  const seats: Seat[] = saved?.seats?.length === 4 ? upgradeSeats(saved.seats) : defaultSeats();
  const settings: Settings = {
    startingCash: 1500,
    salary: 200,
    auctions: true,
    jackpot: true,
    roundLimit: 0,
    ...(saved?.settings ?? {}),
  };

  const root = el('div', 'setup');
  host.innerHTML = '';
  host.appendChild(root);

  const draw = () => {
    root.innerHTML = `
      <div class="setup-bg">${skylineSvg}<div class="stars"></div></div>
      <div class="setup-card">
        <div class="logo"><span class="logo-sky">SKYLINE</span><span class="logo-ty">TYCOON</span></div>
        <p class="tagline">Buy world cities, build skyscrapers, and bankrupt your rivals.</p>
        <div class="setup-actions-top"></div>
        <div class="section-title">Players</div>
        <div class="seg count-seg">${[2, 3, 4].map((n) => `<button class="${n === count ? 'on' : ''}" data-count="${n}">${n}</button>`).join('')}</div>
        <div class="seats"></div>
        <details class="rules-box">
          <summary>House rules</summary>
          <div class="opts">
            <label>Starting cash
              <select data-opt="startingCash">${[1000, 1500, 2000, 2500].map((v) => `<option value="${v}" ${v === settings.startingCash ? 'selected' : ''}>$${v}</option>`).join('')}</select>
            </label>
            <label>Game length
              <select data-opt="roundLimit">${[
                [0, 'Until one player remains'],
                [40, 'Long · 40 rounds'],
                [25, 'Medium · 25 rounds'],
                [15, 'Quick · 15 rounds'],
              ]
                .map(([v, l]) => `<option value="${v}" ${v === settings.roundLimit ? 'selected' : ''}>${l}</option>`)
                .join('')}</select>
            </label>
            <label class="switch"><input type="checkbox" data-opt="auctions" ${settings.auctions ? 'checked' : ''}/><span></span>Auction properties nobody buys</label>
            <label class="switch"><input type="checkbox" data-opt="jackpot" ${settings.jackpot ? 'checked' : ''}/><span></span>Taxes and fines feed the Sky Lounge jackpot</label>
          </div>
        </details>
        <button class="btn primary big start-btn">Start game</button>
        <button class="btn ghost rules-btn">How to play</button>
      </div>`;

    const top = root.querySelector('.setup-actions-top')!;
    if (opts.hasSave) {
      const cont = el('button', 'btn gold big', '▶ Continue saved game');
      cont.addEventListener('click', () => {
        unlockAudio();
        opts.onContinue();
      });
      top.appendChild(cont);
    }

    const seatsEl = root.querySelector('.seats')!;
    for (let i = 0; i < count; i++) {
      const s = seats[i];
      const row = el('div', 'seat');
      row.style.setProperty('--pc', s.color);
      row.innerHTML = `
        <div class="seat-piece">${pieceIcon(s.piece, s.color, 40)}</div>
        <input class="seat-name" maxlength="14" value="${escapeHtml(s.name)}" aria-label="Player ${i + 1} name"/>
        <div class="seg small type-seg">
          <button class="${!s.ai ? 'on' : ''}" data-ai="0">👤 Human</button>
          <button class="${s.ai ? 'on' : ''}" data-ai="1">🤖 AI</button>
        </div>
        ${
          s.ai
            ? `<select class="seat-diff" aria-label="AI difficulty">${(['easy', 'normal', 'hard'] as Difficulty[])
                .map((d) => `<option value="${d}" ${d === s.difficulty ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`)
                .join('')}</select>`
            : ''
        }
        <div class="seat-look">
          <div class="piece-pick" role="group" aria-label="Piece">${PIECES.map((pc) => `<button class="${pc.id === s.piece ? 'on' : ''}" data-piece="${pc.id}" title="${pc.label}" aria-pressed="${pc.id === s.piece}">${pieceIcon(pc.id, s.color, 26)}</button>`).join('')}</div>
          <div class="color-pick" role="group" aria-label="Colour">${PIECE_COLORS.map((c) => `<button class="${c === s.color ? 'on' : ''}" data-color="${c}" style="--sw:${c}" aria-label="Colour ${c}" aria-pressed="${c === s.color}"></button>`).join('')}</div>
        </div>`;
      row.querySelectorAll<HTMLButtonElement>('[data-piece]').forEach((b) =>
        b.addEventListener('click', () => {
          s.piece = b.dataset.piece as PieceKind;
          play('click');
          draw();
        }),
      );
      row.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) =>
        b.addEventListener('click', () => {
          // Colours stay unique: swap with whoever already has it.
          const other = seats.slice(0, count).find((x) => x !== s && x.color === b.dataset.color);
          if (other) other.color = s.color;
          s.color = b.dataset.color!;
          play('click');
          draw();
        }),
      );
      row.querySelector<HTMLInputElement>('.seat-name')!.addEventListener('input', (e) => {
        s.name = (e.target as HTMLInputElement).value;
      });
      row.querySelectorAll<HTMLButtonElement>('.type-seg button').forEach((b) =>
        b.addEventListener('click', () => {
          const ai = b.dataset.ai === '1';
          if (ai !== s.ai) {
            s.ai = ai;
            if (ai && /^Player \d$/.test(s.name)) s.name = AI_NAMES[i];
            if (!ai && AI_NAMES.includes(s.name)) s.name = `Player ${i + 1}`;
          }
          play('click');
          draw();
        }),
      );
      row.querySelector<HTMLSelectElement>('.seat-diff')?.addEventListener('change', (e) => {
        s.difficulty = (e.target as HTMLSelectElement).value as Difficulty;
      });
      seatsEl.appendChild(row);
    }

    root.querySelectorAll<HTMLButtonElement>('.count-seg button').forEach((b) =>
      b.addEventListener('click', () => {
        count = Number(b.dataset.count);
        play('click');
        draw();
      }),
    );
    root.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-opt]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const key = inp.dataset.opt as keyof Settings;
        if (inp instanceof HTMLInputElement && inp.type === 'checkbox') (settings[key] as boolean) = inp.checked;
        else (settings[key] as number) = Number(inp.value);
      }),
    );
    root.querySelector('.rules-btn')!.addEventListener('click', () => opts.onRules());
    root.querySelector('.start-btn')!.addEventListener('click', () => {
      unlockAudio();
      play('click');
      const chosen = seats.slice(0, count);
      const players: PlayerConfig[] = chosen.map((s, i) => ({
        name: s.name.trim() || (s.ai ? AI_NAMES[i] : `Player ${i + 1}`),
        token: s.piece,
        color: s.color,
        ai: s.ai,
        difficulty: s.difficulty,
      }));
      try {
        localStorage.setItem(STORE, JSON.stringify({ count, seats, settings }));
      } catch {
        /* ignore */
      }
      opts.onStart({ players, settings });
    });
  };
  draw();
}

export const RULES_HTML = `
<div class="rules">
  <p><b>Goal:</b> be the last tycoon standing, or the richest when the round limit is reached.</p>
  <ul>
    <li>🎲 <b>Roll</b> two dice and move. Doubles let you roll again, but three doubles in a row send you to <b>Lockup</b>.</li>
    <li>🏙️ Land on an unowned city, Skyport or utility to <b>buy</b> it. If you pass, it goes to <b>auction</b> and anyone can bid.</li>
    <li>💸 Landing on someone else's property means paying <b>rent</b>. Owning a whole colour set doubles the base rent.</li>
    <li>🏗️ With a full set you can <b>build</b>: each level adds floors, and level 5 turns the plot into its district's <b>landmark</b>. Build evenly across the set.</li>
    <li>🚩 Owned plots show the owner's fence, awning and flag; the street sign shows their name and the rent.</li>
    <li>✈️ Skyport rent grows with every Skyport you own. Utility rent is a multiple of the dice roll.</li>
    <li>🔮 <b>Fortune</b> and 💼 <b>Treasury</b> cards can help or hurt you.</li>
    <li>🔒 To leave <b>Lockup</b>, pay $50, use a get-out card, or roll doubles within 3 turns.</li>
    <li>🏦 Short on cash? <b>Mortgage</b> properties or sell buildings back at half price. If you still can't pay, you're bankrupt.</li>
    <li>🤝 On your turn you can <b>trade</b> properties, cash and get-out cards with anyone.</li>
    <li>🍸 With the jackpot house rule, taxes and fines pile up in the <b>Sky Lounge</b>. Land there to collect them.</li>
  </ul>
  <p class="muted">Tip: tap any plot, the map strip or a Next up card to see its rents in the info panel. Your game saves automatically.</p>
</div>`;
