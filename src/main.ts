import './ui/styles.css';
import { applyEdition } from './game/editions';
import { Game } from './game/engine';
import type { PlayerConfig, Settings } from './game/types';
import { GameApp, clearSave, loadSave } from './ui/app';
import { openModal } from './ui/modal';
import { dailySeed } from './ui/daily';
import { renderSetup, rulesHtml, type SetupResult } from './ui/setup';
import { tr } from './i18n';

const host = document.getElementById('app')!;
let app: GameApp | null = null;
let current: Game | null = null;

function rematchConfig(g: Game): SetupResult {
  const players: PlayerConfig[] = g.state.players.map((p) => ({
    name: p.name,
    token: p.token,
    color: p.color,
    ai: p.ai,
    difficulty: p.difficulty,
  }));
  const settings: Partial<Settings> = { ...g.state.settings };
  // A daily challenge rematch replays the same day (as practice).
  return { players, settings, seed: settings.daily ? dailySeed(settings.daily) : undefined };
}

function launch(game: Game, mem: ConstructorParameters<typeof GameApp>[2] = []) {
  app?.destroy();
  current = game;
  applyEdition(game.state.settings.edition);
  app = new GameApp(host, game, mem, (again) => {
    if (again && current) startNew(rematchConfig(current));
    else showSetup();
  });
}

function startNew(r: SetupResult) {
  clearSave();
  launch(Game.create(r.players, r.settings, r.seed));
}

function showSetup() {
  app?.destroy();
  app = null;
  renderSetup(host, {
    hasSave: !!loadSave(),
    onStart: startNew,
    onContinue: () => {
      const save = loadSave();
      if (save) launch(new Game(save.state), save.mem);
      else showSetup();
    },
    onRules: () => openModal({ title: tr('How to play'), html: rulesHtml(), cls: 'rules-modal' }),
  });
}

showSetup();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
