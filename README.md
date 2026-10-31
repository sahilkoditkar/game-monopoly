# Skyline Tycoon

An original property-trading board game for **2–4 players** that runs in the browser on phones, tablets and laptops. Play against friends on one device, against AI opponents, or both.

**Play:** https://sahilkoditkar.github.io/game-monopoly/

## Features

- **2–4 players.** Each seat can be a human or an AI. With one human, the rest are AI rivals at **Easy**, **Normal** or **Hard**.
- **The board:**
  - 40 tiles: 22 world cities in 8 colour sets, 4 Skyports and 2 utilities.
  - Fortune and Treasury card decks, City Tax and Yacht Tax.
  - The Lockup and the Sky Lounge jackpot.
- **Full rules:**
  - Doubles roll again, and three doubles send you to Lockup.
  - Auctions for unbought properties, and a full set doubles rent.
  - Houses and hotels must be built evenly, from a limited bank supply.
  - Mortgages, trades, debts and bankruptcy.
  - Optional round limit: the richest player wins.
- **Graphics and animation:**
  - 3D dice, hopping tokens, flying coins and floating money.
  - Card-flip reveals, "SOLD!" stamps, turn banners and confetti.
  - An optional 3D board tilt.
- **Sound effects,** synthesized in the browser (no audio files).
- **Responsive:** board plus side panel in landscape, and a stacked layout with bottom-sheet dialogs on phones.
- **Autosave and continue.** The game is installable as a home-screen app and works offline after the first visit.

## How to play

1. Choose the number of players, then set each seat to 👤 Human or 🤖 AI.
2. Roll the dice (button, or press <kbd>Space</kbd>) and move around the board.
3. Buy the cities you land on. Collect a full colour set to double rent and unlock building.
4. Build houses, then hotels. Trade with other players to finish your sets.
5. Bankrupt everyone else, or be the richest when the round limit is reached.

Tap any tile to see its deed. Use **🏗️ Manage** to build or mortgage, and **🤝 Trade** to make deals.

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # rules, AI and random-play tests
npm run build    # type-check and build to dist/
```

The AI win-rate report used for tuning:

```bash
STATS=1 npx vitest run tests/stats.test.ts
```

### Project layout

| Path | What it does |
|---|---|
| `src/game/board.ts`, `cards.ts` | Board tiles, prices, rents and card decks |
| `src/game/engine.ts` | Rules engine: phases, money, jail, building, auctions, trades, bankruptcy. It emits events for the UI. |
| `src/game/ai.ts` | AI players: buying, bidding, building, debt handling and trades |
| `src/ui/app.ts` | Game controller: plays events as animations and runs AI turns |
| `src/ui/board.ts`, `dice.ts`, `fx.ts`, `sound.ts` | Board rendering, 3D dice, effects and audio |
| `src/ui/setup.ts`, `modal.ts`, `styles.css` | Setup screen, dialogs and styling |

## Workflow and deployment

- `main` holds released code. Each feature is built on its own branch and merged through a pull request.
- The **CI** workflow runs tests and a build on every pull request.
- The **Deploy to GitHub Pages** workflow runs on every push to `main`. It builds the site and publishes `dist/` to the `gh-pages` branch.
- One-time setup: in **Settings → Pages**, set the source to **Deploy from a branch**, branch `gh-pages`, folder `/ (root)`.
