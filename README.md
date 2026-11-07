# Skyline Tycoon

An original property-trading board game for **2–4 players** that runs in the browser on phones, tablets and laptops. Play against friends on one device, against AI opponents, or both.

**Play:** https://sahilkoditkar.github.io/game-monopoly/

## Features

- **2–4 players.** Each seat can be a human or an AI. With one human, the rest are AI rivals at **Easy**, **Normal** or **Hard**.
- **The board:**
  - 40 tiles: 22 world cities in 8 colour sets, 4 Skyports and 2 utilities.
  - Fortune and Treasury card decks, City Tax and Yacht Tax.
  - The Lockup and the Sky Lounge jackpot.
- **Daily challenge:** its own tab on the setup screen. Same board, dice and opponents for everyone each day; after 20 rounds your net worth is your score. Your first game of the day counts, replays are practice, and a streak counter keeps track.
- **Setup screen:** three tabs, each showing only what applies: 🎲 Classic (2–4 players, everyone for themselves), 👥 Teams (2 v 2: teammates pay no rent to each other, share colour sets and win together) and 📅 Daily (below).
- **How the game ends:** one choice for every mode: 🏆 last one standing, ⏱️ round limit (15 / 25 / 40 rounds, richest wins) or 🏁 race to ₹5,000 / ₹7,500 net worth or 3 full colour sets.
- **Optional house rules:** ⚡ Head start (2 random cities each), 🏠 Early building (up to 2 houses before owning the whole set), 📰 Breaking news (a round event boosts or crashes rents, or hands out cash), 🎯 Secret missions (a hidden goal worth a bonus) and 🃏 Action cards (Boost, Rent holiday, Half price, Free house; one per turn). Each can be switched on or off; computer players use them too.
- **Languages:** English, हिन्दी (Hindi) or मराठी (Marathi), chosen on the setup screen. Menus, buttons, rules, cards, the game log and every board's city names are translated.
- **Board editions:** pick **World**, **India** or **Maharashtra** on the setup screen. The India and Maharashtra boards use local cities, stations and ₹, with the same prices and rules.
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
npm run e2e      # browser smoke tests on phone, phone-landscape and laptop (after build)
```

The AI win-rate report used for tuning:

```bash
STATS=1 npx vitest run tests/stats.test.ts
```

### Project layout

| Path | What it does |
|---|---|
| `src/game/board.ts`, `cards.ts` | Board tiles, prices, rents and card decks |
| `src/i18n/` | Interface language: `tr()` for UI text, `trText()` for engine sentences, Hindi and Marathi strings and names in `hi.ts` and `mr.ts` |
| `src/game/extras.ts` | News events, secret missions and action cards (the optional house rules) |
| `src/ui/daily.ts` | Daily challenge: date seed, board, opponents, scores and streak |
| `src/game/editions.ts` | India and Maharashtra names and currency (names only) |
| `src/game/engine.ts` | Rules engine: phases, money, jail, building, auctions, trades, bankruptcy. It emits events for the UI. |
| `src/game/ai.ts` | AI players: buying, bidding, building, debt handling and trades |
| `src/ui/app.ts` | Game controller: plays events as animations and runs AI turns |
| `src/ui/board.ts`, `dice.ts`, `fx.ts`, `sound.ts` | Board rendering, 3D dice, effects and audio |
| `src/ui/setup.ts`, `modal.ts`, `styles.css` | Setup screen, dialogs and styling |

## Workflow and deployment

- `main` holds released code. Each feature is built on its own branch and merged through a pull request.
- The **CI** workflow runs the unit tests, a build and the browser smoke tests (`e2e/`) on every pull request. A failing browser test uploads screenshots and traces.
- The **Deploy to GitHub Pages** workflow runs on every push to `main`. It builds the site and publishes `dist/` to the `gh-pages` branch.
- One-time setup: in **Settings → Pages**, set the source to **Deploy from a branch**, branch `gh-pages`, folder `/ (root)`.
