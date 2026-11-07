import type { Difficulty, PlayerConfig, RaceGoal, Settings } from '../game/types';
import { EDITIONS, applyEdition, currentEdition, localize, type EditionId } from '../game/editions';
import { LANGS, allPacks, getLang, pack, setLang, tr, type Lang } from '../i18n';
import { JAIL_FINE, TILES } from '../game/board';
import { DAILY_ROUNDS, dailyEdition, dailyNumber, dailyPlayers, dailyResult, dailySeed, dailySettings, dailyStreak, todayKey } from './daily';
import { el, escapeHtml, money, toast } from './fx';
import { play, unlockAudio } from './sound';

export const TOKENS = ['🚀', '🏎️', '🐱', '🦖', '🎩', '⛵', '👑', '🐶', '🦊', '🐼', '🐸', '🦄', '🐙', '🍕', '⚽', '🎸'];
/**
 * Player colours. Each must (1) read clearly on the cream tiles (contrast at least 3.5:1),
 * (2) look different from all 8 city colours, and (3) look different from the other players
 * (CIEDE2000 colour difference of 22+ for both). The bright hues are taken by the cities,
 * so these are deep tones: burgundy, deep teal, olive, charcoal and forest green.
 */
export const COLORS = ['#8d354b', '#2a6f6b', '#8d8435', '#212529', '#256105'];
const COLOR_NAMES = ['Burgundy', 'Deep teal', 'Olive', 'Charcoal', 'Forest green'];
const AI_NAMES_EN = ['Ava', 'Bolt', 'Cleo', 'Dex', 'Echo', 'Fizz'];
/** Default names for computer players, in the interface language. */
const aiNames = () => pack()?.ai ?? AI_NAMES_EN;
const isDefaultName = (name: string) =>
  /^Player \d$/.test(name) || AI_NAMES_EN.includes(name) || allPacks().some((p) => p.ai.includes(name) || new RegExp(`^${p.player} \\d$`).test(name));

interface Seat {
  name: string;
  token: string;
  color: string;
  ai: boolean;
  difficulty: Difficulty;
  /** Team (0 = A, 1 = B) in team mode. */
  team?: number;
}

export interface SetupResult {
  players: PlayerConfig[];
  settings: Partial<Settings>;
  /** Fixed seed (daily challenge); a random one otherwise. */
  seed?: number;
}

const STORE = 'st-setup';

/** Setups saved by the street version stored a piece name instead of an emoji. */
const PIECE_EMOJI: Record<string, string> = { car: '🏎️', robot: '🤖', walker: '🚶', pin: '📍' };
export function legacyToken(token: string | undefined, seat: number): string {
  if (token && PIECE_EMOJI[token]) return PIECE_EMOJI[token];
  return token || TOKENS[seat % TOKENS.length];
}

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
    { name: tr('Player {n}', { n: 1 }), token: TOKENS[0], color: COLORS[0], ai: false, difficulty: 'normal' },
    { name: aiNames()[0], token: TOKENS[1], color: COLORS[1], ai: true, difficulty: 'normal' },
    { name: aiNames()[1], token: TOKENS[2], color: COLORS[2], ai: true, difficulty: 'normal' },
    { name: aiNames()[2], token: TOKENS[3], color: COLORS[3], ai: true, difficulty: 'normal' },
  ];
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
  const seats: Seat[] = saved?.seats?.length === 4 ? saved.seats.map((x, i) => ({ ...x, token: legacyToken(x.token ?? (x as { piece?: string }).piece, i), color: COLORS.includes(x.color) ? x.color : COLORS[i] })) : defaultSeats();
  // Colours must stay unique, even in setups saved before the picker existed.
  seats.forEach((s, i) => {
    if (seats.slice(0, i).some((o) => o.color === s.color)) s.color = COLORS.find((c) => !seats.some((o) => o.color === c)) ?? s.color;
  });
  const settings: Settings = {
    startingCash: 1500,
    salary: 200,
    auctions: true,
    jackpot: true,
    roundLimit: 0,
    ...(saved?.settings ?? {}),
  };
  if (!(settings.edition && settings.edition in EDITIONS)) settings.edition = 'world';
  applyEdition(settings.edition);

  const root = el('div', 'setup');
  host.innerHTML = '';
  host.appendChild(root);

  const draw = () => {
    const rulesOpen = root.querySelector('details')?.open ?? false;
    root.innerHTML = `
      <div class="setup-bg">${skylineSvg}<div class="stars"></div></div>
      <div class="setup-card">
        <div class="logo"><span class="logo-sky">SKYLINE</span><span class="logo-ty">TYCOON</span></div>
        <p class="tagline">${escapeHtml(tr(currentEdition().blurb))}</p>
        <div class="setup-actions-top"></div>
        ${dailyCard()}
        <div class="section-title">${tr('Players')}</div>
        <div class="seg count-seg">${[2, 3, 4].map((n) => `<button class="${n === count ? 'on' : ''}" data-count="${n}" aria-label="${tr('{n} players', { n })}">${n}</button>`).join('')}</div>
        <div class="seats"></div>
        <div class="section-title">${tr('Board')}</div>
        <div class="seg edition-seg">${Object.values(EDITIONS)
          .map((e) => `<button class="${e.id === settings.edition ? 'on' : ''}" data-edition="${e.id}">${tr(e.label)}</button>`)
          .join('')}</div>
        <p class="edition-note">${tr('Same prices and rules, only the names change')} · ${currentEdition().currency}</p>
        <div class="section-title">Language · भाषा</div>
        <div class="seg edition-seg lang-seg">${LANGS.map(([id, label]) => `<button class="${id === getLang() ? 'on' : ''}" data-lang="${id}" lang="${id}">${label}</button>`)
          .join('')}</div>
        <div class="section-title">${tr('Game mode')}</div>
        <div class="seg edition-seg mode-seg">
          <button class="${settings.quickStart ? '' : 'on'}" data-mode="classic">${tr('🎲 Classic')}</button>
          <button class="${settings.quickStart ? 'on' : ''}" data-mode="quick">${tr('⚡ Quick game')}</button>
        </div>
        <p class="edition-note">${settings.quickStart ? tr('Everyone starts with 2 random cities. After 15 rounds the richest player wins (about 15–20 minutes).') : tr('Play until one player is left, or set a round limit in House rules.')}</p>
        <div class="opts mode-opts">
          <label>${tr('🏁 How to win')}
            <select data-opt="goal">${(
              [
                ['', tr('Last player standing')],
                ['worth5000', tr('Race to {amount} net worth', { amount: money(5000) })],
                ['worth7500', tr('Race to {amount} net worth', { amount: money(7500) })],
                ['sets3', tr('Race to 3 full colour sets')],
              ] as [RaceGoal | '', string][]
            )
              .map(([v, l]) => `<option value="${v}" ${v === (settings.goal ?? '') ? 'selected' : ''}>${l}</option>`)
              .join('')}</select>
          </label>
          <label class="switch rule"><input type="checkbox" data-opt="teams" ${settings.teams ? 'checked' : ''}/><span></span><div><b>${tr('👥 Teams (2 v 2)')}</b><small>${tr('4 players in two teams. Teammates pay no rent to each other, share colour sets, and win together.')}</small></div></label>
        </div>
        <details class="rules-box" ${rulesOpen ? 'open' : ''}>
          <summary>${tr('House rules')}</summary>
          <div class="opts">
            <label>${tr('Starting cash')}
              <select data-opt="startingCash">${[1000, 1500, 2000, 2500].map((v) => `<option value="${v}" ${v === settings.startingCash ? 'selected' : ''}>${money(v)}</option>`).join('')}</select>
            </label>
            <label>${tr('Game length')}
              <select data-opt="roundLimit">${[
                [0, tr('Until one player remains')],
                [40, tr('Long · 40 rounds')],
                [25, tr('Medium · 25 rounds')],
                [15, tr('Quick · 15 rounds')],
              ]
                .map(([v, l]) => `<option value="${v}" ${v === settings.roundLimit ? 'selected' : ''}>${l}</option>`)
                .join('')}</select>
            </label>
            <label class="switch"><input type="checkbox" data-opt="auctions" ${settings.auctions ? 'checked' : ''}/><span></span>${tr('Auction properties nobody buys')}</label>
            <label class="switch"><input type="checkbox" data-opt="jackpot" ${settings.jackpot ? 'checked' : ''}/><span></span>${tr('Taxes and fines feed the {lounge} jackpot', { lounge: escapeHtml(localize('Sky Lounge')) })}</label>
            <label class="switch rule"><input type="checkbox" data-opt="earlyBuild" ${settings.earlyBuild ? 'checked' : ''}/><span></span><div><b>${tr('🏠 Early building')}</b><small>${tr('Build up to 2 houses on a city before owning its whole colour set.')}</small></div></label>
            <label class="switch rule"><input type="checkbox" data-opt="news" ${settings.news ? 'checked' : ''}/><span></span><div><b>${tr('📰 Breaking news')}</b><small>${tr('Each round an event can boost or crash rents, or hand out cash.')}</small></div></label>
            <label class="switch rule"><input type="checkbox" data-opt="missions" ${settings.missions ? 'checked' : ''}/><span></span><div><b>${tr('🎯 Secret missions')}</b><small>${tr('Everyone gets a hidden goal. Complete it for a {amount} bonus.', { amount: money(500) })}</small></div></label>
            <label class="switch rule"><input type="checkbox" data-opt="actionCards" ${settings.actionCards ? 'checked' : ''}/><span></span><div><b>${tr('🃏 Action cards')}</b><small>${tr('Hold up to 3 cards and play one per turn: Boost, Rent holiday, Half price, Free house.')}</small></div></label>
          </div>
        </details>
        <button class="btn primary big start-btn">${tr('Start game')}</button>
        <button class="btn ghost rules-btn">${tr('How to play')}</button>
      </div>`;

    root.querySelector('.daily-btn')!.addEventListener('click', () => {
      unlockAudio();
      play('click');
      const key = todayKey();
      const you = seats[0];
      opts.onStart({ players: dailyPlayers({ name: you.name.trim() || tr('Player {n}', { n: 1 }), token: you.token, color: you.color }), settings: dailySettings(key), seed: dailySeed(key) });
    });
    const top = root.querySelector('.setup-actions-top')!;
    if (opts.hasSave) {
      const cont = el('button', 'btn gold big', tr('▶ Continue saved game'));
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
        <button class="seat-token" title="${tr('Choose token')}" aria-haspopup="true" aria-expanded="false">${s.token}</button>
        <input class="seat-name" maxlength="14" value="${escapeHtml(s.name)}" aria-label="${tr('Player {n} name', { n: i + 1 })}"/>
        <div class="seg small type-seg">
          <button class="${!s.ai ? 'on' : ''}" data-ai="0">${tr('👤 Human')}</button>
          <button class="${s.ai ? 'on' : ''}" data-ai="1">${tr('🤖 AI')}</button>
        </div>
        ${
          settings.teams
            ? `<div class="seg small team-seg" role="group" aria-label="${tr('Team')}">${[0, 1]
                .map((t) => `<button class="team-${t} ${s.team === t ? 'on' : ''}" data-team="${t}">${tr('Team {t}', { t: 'AB'[t] })}</button>`)
                .join('')}</div>`
            : ''
        }
        ${
          s.ai
            ? `<select class="seat-diff" aria-label="${tr('AI difficulty')}">${(['easy', 'normal', 'hard'] as Difficulty[])
                .map((d) => `<option value="${d}" ${d === s.difficulty ? 'selected' : ''}>${tr(d[0].toUpperCase() + d.slice(1))}</option>`)
                .join('')}</select>`
            : ''
        }
        <div class="token-pick" role="group" aria-label="${tr('Player {n} token', { n: i + 1 })}" hidden>${TOKENS.map((t) => {
          const taken = seats.slice(0, count).some((x) => x !== s && x.token === t);
          return `<button data-token="${t}" class="${t === s.token ? 'on' : ''}" ${taken ? `disabled title="${tr('Taken by another player')}"` : ''} aria-pressed="${t === s.token}">${t}</button>`;
        }).join('')}</div>
        <div class="color-pick" role="group" aria-label="${tr('Player {n} colour', { n: i + 1 })}">${COLORS.map((c) => `<button class="${c === s.color ? 'on' : ''}" data-color="${c}" style="--sw:${c}" aria-label="${tr(COLOR_NAMES[COLORS.indexOf(c)])}" aria-pressed="${c === s.color}"></button>`).join('')}</div>`;
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
      row.querySelectorAll<HTMLButtonElement>('[data-team]').forEach((b) =>
        b.addEventListener('click', () => {
          s.team = Number(b.dataset.team);
          play('click');
          draw();
        }),
      );
      // Tapping the token opens a grid of every emoji; ones other players use are greyed out.
      const tokenBtn = row.querySelector<HTMLButtonElement>('.seat-token')!;
      const grid = row.querySelector<HTMLElement>('.token-pick')!;
      tokenBtn.addEventListener('click', () => {
        grid.hidden = !grid.hidden;
        tokenBtn.setAttribute('aria-expanded', String(!grid.hidden));
        play('click');
      });
      grid.querySelectorAll<HTMLButtonElement>('[data-token]').forEach((b) =>
        b.addEventListener('click', () => {
          s.token = b.dataset.token!;
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
            if (ai && isDefaultName(s.name) && !aiNames().includes(s.name)) {
              const used = new Set(seats.slice(0, count).map((x) => x.name));
              s.name = aiNames().find((n) => !used.has(n)) ?? `Bot ${i + 1}`;
            }
            if (!ai && aiNames().includes(s.name)) s.name = tr('Player {n}', { n: i + 1 });
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
        if (count !== 4) settings.teams = false;
        play('click');
        draw();
      }),
    );
    root.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-opt]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const key = inp.dataset.opt as keyof Settings;
        if (key === 'goal') settings.goal = (inp.value || undefined) as RaceGoal | undefined;
        else if (inp instanceof HTMLInputElement && inp.type === 'checkbox') (settings[key] as boolean) = inp.checked;
        else (settings[key] as number) = Number(inp.value);
        if (key === 'teams') {
          // Teams are 2 v 2: four seats, alternating A/B unless already chosen.
          if (settings.teams) {
            count = 4;
            seats.forEach((s, i) => (s.team ??= i % 2));
          }
          draw();
        }
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('.edition-seg button').forEach((b) =>
      b.addEventListener('click', () => {
        settings.edition = b.dataset.edition as EditionId;
        applyEdition(settings.edition);
        play('click');
        draw();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('.mode-seg button').forEach((b) =>
      b.addEventListener('click', () => {
        settings.quickStart = b.dataset.mode === 'quick';
        settings.roundLimit = settings.quickStart ? 15 : 0;
        play('click');
        draw();
      }),
    );
        root.querySelectorAll<HTMLButtonElement>('.lang-seg button').forEach((b) =>
      b.addEventListener('click', () => {
        setLang(b.dataset.lang as Lang);
        applyEdition(settings.edition);
        // Default names follow the language; names people typed stay as they are.
        seats.forEach((s, i) => {
          if (isDefaultName(s.name)) s.name = s.ai ? aiNames()[i === 0 ? 3 : i - 1] : tr('Player {n}', { n: i + 1 });
        });
        play('click');
        draw();
      }),
    );
    root.querySelector('.rules-btn')!.addEventListener('click', () => opts.onRules());
    root.querySelector('.start-btn')!.addEventListener('click', () => {
      unlockAudio();
      play('click');
      const chosen = seats.slice(0, count);
      const players: PlayerConfig[] = chosen.map((s, i) => ({
        name: s.name.trim() || (s.ai ? aiNames()[i] : tr('Player {n}', { n: i + 1 })),
        token: s.token,
        color: s.color,
        ai: s.ai,
        difficulty: s.difficulty,
        ...(settings.teams ? { team: s.team ?? i % 2 } : {}),
      }));
      if (settings.teams && players.filter((p) => p.team === 0).length !== 2) {
        toast(tr('Teams need 2 players each.'), 'bad');
        return;
      }
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

const RULES_HTML = `
<div class="rules">
  <p><b>Goal:</b> be the last tycoon standing, or the richest when the round limit is reached.</p>
  <ul>
    <li>🎲 <b>Roll</b> two dice and move. Doubles let you roll again, but three doubles in a row send you to <b>Lockup</b>.</li>
    <li>🏙️ Land on an unowned city, Skyport or utility to <b>buy</b> it. If you pass, it goes to <b>auction</b> and anyone can bid.</li>
    <li>💸 Landing on someone else's property means paying <b>rent</b>. Owning a whole colour set doubles the base rent.</li>
    <li>🏠 With a full set you can <b>build</b> houses evenly, then a hotel. Rents climb steeply.</li>
    <li>✈️ Skyport rent grows with every Skyport you own. Utility rent is a multiple of the dice roll.</li>
    <li>🔮 <b>Fortune</b> and 💼 <b>Treasury</b> cards can help or hurt you.</li>
    <li>🔒 To leave <b>Lockup</b>, pay $50, use a get-out card, or roll doubles within 3 turns.</li>
    <li>🏦 Short on cash? <b>Mortgage</b> properties or sell buildings back at half price. If you still can't pay, you're bankrupt.</li>
    <li>🤝 On your turn you can <b>trade</b> properties, cash and get-out cards with anyone.</li>
    <li>🍸 With the jackpot house rule, taxes and fines pile up in the <b>Sky Lounge</b>. Land there to collect them.</li>
  </ul>
  <p class="muted">Tip: tap any tile to see its deed. Your game saves automatically, so you can close the tab and continue later.</p>
</div>`;

/** The rules, worded for the current board edition. */
export const rulesHtml = () => {
  const lp = pack();
  if (!lp) return localize(RULES_HTML);
  const ed = currentEdition();
  const fill: Record<string, string> = {
    jail: TILES[10].name,
    lounge: TILES[20].name,
    fortune: ed.decks.fortune,
    treasury: ed.decks.treasury,
    transit: localize('Skyports'),
    fine: money(JAIL_FINE),
  };
  return lp.rules.replace(/\{(\w+)\}/g, (m, k: string) => escapeHtml(fill[k] ?? m));
};

/** The daily challenge: its own section on the setup screen, separate from normal games. */
function dailyCard(): string {
  const key = todayKey();
  const rec = dailyResult(key);
  const streak = dailyStreak(key);
  const board = EDITIONS[dailyEdition(key)].label;
  return `
    <section class="daily-card">
      <div class="daily-head"><b>📅 ${tr('Daily challenge')}</b><small>#${dailyNumber(key)} · ${key}</small></div>
      <p>${tr('Same board, same dice and same opponents for everyone today. After {n} rounds, your net worth is your score.', { n: DAILY_ROUNDS })}</p>
      <div class="daily-meta">
        <span>${tr("Today's board")}: <b>${tr(board)}</b></span>
        ${streak ? `<span>🔥 ${tr('{n}-day streak', { n: streak })}</span>` : ''}
        ${rec ? `<span>${tr('Your score: {first} · best {best}', { first: `<b>${money(rec.first)}</b>`, best: money(rec.best) })}</span>` : ''}
      </div>
      <button class="btn gold daily-btn">${rec ? tr('Play again (practice)') : tr("▶ Play today's challenge")}</button>
    </section>`;
}
