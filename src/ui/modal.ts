import { GROUPS, TILES, TRANSIT_RENTS, houseCost, mortgageValue, unmortgageCost } from '../game/board';
import type { GameState } from '../game/types';
import { el, escapeHtml, money } from './fx';

export interface ModalHandle {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
  closed: Promise<void>;
}

/**
 * Opens a modal. `dismissable` lets the backdrop and the X button close it.
 * `peek` adds a "View board" button that hides the dialog until the player taps
 * "Back to <peek>", so decisions can be made while looking at the board.
 */
export function openModal(opts: { title?: string; cls?: string; dismissable?: boolean; html?: string; peek?: string } = {}): ModalHandle {
  const root = el('div', `modal-backdrop ${opts.cls ?? ''}`);
  const panel = el('div', 'modal');
  const body = el('div', 'modal-body');
  if (opts.title) {
    const head = el('div', 'modal-head', `<h2>${opts.title}</h2>`);
    if (opts.dismissable !== false) {
      const x = el('button', 'icon-btn modal-x', '✕');
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', () => close());
      head.appendChild(x);
    }
    panel.appendChild(head);
  }
  if (opts.html) body.innerHTML = opts.html;
  panel.appendChild(body);
  let back: HTMLElement | null = null;
  const unpeek = () => {
    root.classList.remove('peeking');
    back?.remove();
    back = null;
  };
  if (opts.peek) {
    const peek = el('button', 'btn ghost small peek-btn', '👀 View board');
    peek.setAttribute('aria-label', 'Hide this dialog to look at the board');
    peek.addEventListener('click', () => {
      root.classList.add('peeking');
      back = el('button', 'btn gold peek-back', `↩ Back to ${escapeHtml(opts.peek!)}`);
      back.addEventListener('click', unpeek);
      document.body.appendChild(back);
      back.focus();
    });
    const head = panel.querySelector('.modal-head');
    if (head) head.insertBefore(peek, head.querySelector('.modal-x'));
    else panel.appendChild(el('div', 'modal-foot')).appendChild(peek);
  }
  root.appendChild(panel);
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('open'));

  let resolve!: () => void;
  const closed = new Promise<void>((r) => (resolve = r));
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    unpeek();
    root.classList.remove('open');
    root.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => root.remove(), 250);
    resolve();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissable !== false && root === lastModal()) close();
  };
  if (opts.dismissable !== false) {
    root.addEventListener('click', (e) => {
      if (e.target === root) close();
    });
    document.addEventListener('keydown', onKey);
  }
  return { root, body, close, closed };
}

function lastModal() {
  const all = document.querySelectorAll('.modal-backdrop.open');
  return all[all.length - 1];
}

export function button(label: string, cls: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, label);
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

/** A title-deed style card for a buyable tile. */
export function deedCard(state: GameState, i: number): HTMLElement {
  const t = TILES[i];
  const own = state.props[i];
  const card = el('div', `deed kind-${t.kind}`);
  const color = t.group ? GROUPS[t.group].color : t.kind === 'transit' ? '#334155' : '#0e7490';
  card.style.setProperty('--deed', color);
  const rows: string[] = [];
  if (t.kind === 'property') {
    const r = t.rents!;
    const h = own?.houses ?? -1;
    const row = (label: string, v: number, k: number) =>
      `<tr class="${h === k ? 'cur' : ''}"><td>${label}</td><td>${money(v)}</td></tr>`;
    rows.push(row('Rent', r[0], 0));
    rows.push(`<tr class="muted"><td>Full set (no houses)</td><td>${money(r[0] * 2)}</td></tr>`);
    for (let k = 1; k <= 4; k++) rows.push(row(`With ${'🏠'.repeat(k)}`, r[k], k));
    rows.push(row('With 🏨 hotel', r[5], 5));
    rows.push(`<tr class="sep"><td>House / hotel cost</td><td>${money(houseCost(i))}</td></tr>`);
  } else if (t.kind === 'transit') {
    TRANSIT_RENTS.forEach((v, k) => rows.push(`<tr><td>${k + 1} Skyport${k ? 's' : ''} owned</td><td>${money(v)}</td></tr>`));
  } else if (t.kind === 'utility') {
    rows.push(`<tr><td>One utility owned</td><td>4× dice</td></tr>`);
    rows.push(`<tr><td>Both utilities owned</td><td>10× dice</td></tr>`);
  }
  rows.push(`<tr class="sep"><td>Mortgage value</td><td>${money(mortgageValue(i))}</td></tr>`);
  rows.push(`<tr><td>Pay off mortgage</td><td>${money(unmortgageCost(i))}</td></tr>`);
  const owner = own ? state.players[own.owner] : null;
  card.innerHTML = `
    <div class="deed-head">
      <div class="deed-icon">${t.icon}</div>
      <div class="deed-kicker">${t.group ? escapeHtml(GROUPS[t.group].name) : t.kind === 'transit' ? 'Skyport' : 'Utility'}</div>
      <div class="deed-title">${escapeHtml(t.name)}</div>
    </div>
    <div class="deed-price">Price <b>${money(t.price!)}</b></div>
    <table class="deed-table">${rows.join('')}</table>
    <div class="deed-owner">${
      owner
        ? `<span class="chip" style="--pc:${owner.color}">${owner.token} ${escapeHtml(owner.name)}</span>${own!.mortgaged ? ' <span class="tag warn">Mortgaged</span>' : ''}`
        : '<span class="tag">For sale</span>'
    }</div>`;
  return card;
}
