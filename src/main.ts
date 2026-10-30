import './ui/styles.css';
import { Game } from './game/engine';
import type { PlayerConfig, Settings } from './game/types';
import { GameApp, clearSave, loadSave } from './ui/app';
import { openModal } from './ui/modal';
import { RULES_HTML, renderSetup, type SetupResult } from './ui/setup';

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
  return { players, settings };
}

function launch(game: Game, mem: ConstructorParameters<typeof GameApp>[2] = []) {
  app?.destroy();
  current = game;
  app = new GameApp(host, game, mem, (again) => {
    if (again && current) startNew(rematchConfig(current));
    else showSetup();
  });
}

function startNew(r: SetupResult) {
  clearSave();
  launch(Game.create(r.players, r.settings));
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
    onRules: () => openModal({ title: 'How to play', html: RULES_HTML, cls: 'rules-modal' }),
  });
}

showSetup();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
