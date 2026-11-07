import { expect, test, type Page } from '@playwright/test';

/** Fails the test on any uncaught page error. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Turbo speed and no tips card, so games move fast and nothing covers the board. */
async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('st-speed', 'turbo');
    localStorage.setItem('st-tips', '1');
  });
  await page.goto('/');
  await expect(page.locator('.start-btn')).toBeVisible();
}

/** Seat 1 human, the rest computer players. */
async function startGame(page: Page, players = 3) {
  await page.click(`.count-seg [data-count="${players}"]`);
  await page.locator('.seat [data-ai="0"]').nth(0).click();
  for (let i = 1; i < players; i++) await page.locator('.seat [data-ai="1"]').nth(i).click();
  await page.click('.start-btn');
  await expect(page.locator('.board')).toBeVisible();
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Plays the human's turns (buying everything, dropping out of auctions) until `turns` rolls are done. */
async function playTurns(page: Page, turns: number) {
  let rolls = 0;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const click = (sel: string, text?: RegExp) => page.locator(sel, text ? { hasText: text } : {}).first().click({ timeout: 3000 }).catch(() => {});
    if (await page.$('.card-modal.open .card-ok')) await click('.card-ok');
    else if (await page.$('.trade-modal.open .modal-actions')) await click('.trade-modal button', /Decline/);
    else if (await page.$('.buy-modal.open')) await click('.buy-modal .modal-actions button');
    else if (await page.$('.auction-modal.open .now-bidding.mine')) await click('.auction-modal button', /Drop out/);
    else if (await page.$('.debt-modal.open')) {
      await click('.debt-modal button', /bankruptcy/);
      await click('.confirm-modal button.danger');
    } else if (await page.$('.gameover-modal.open')) return rolls;
    else {
      const roll = page.locator('.controls button', { hasText: /Roll/ });
      const end = page.locator('.controls button', { hasText: /End turn/ });
      if ((await roll.count()) && (await roll.first().isEnabled())) {
        await click('.controls button', /Roll/);
        rolls++;
      } else if (await end.count()) {
        if (rolls >= turns) return rolls;
        await click('.controls button', /End turn/);
      } else await page.waitForTimeout(100);
    }
    expect(await noSidewaysScroll(page)).toBe(true);
  }
  throw new Error(`Game stalled after ${rolls} rolls`);
}

test('a game plays through without errors or sideways scrolling', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  expect(await noSidewaysScroll(page)).toBe(true);
  await startGame(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const rolls = await playTurns(page, 6);
  expect(rolls).toBeGreaterThanOrEqual(6);
  // The main buttons stay big enough to tap.
  const end = page.locator('.controls button', { hasText: /End turn/ });
  const box = await end.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40);
  expect(errors).toEqual([]);
});

test('dialogs open, stay on screen and close', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await startGame(page);
  await playTurns(page, 2);
  const vw = page.viewportSize()!.width;
  for (const [button, dialog] of [
    [/Manage/, '.manage-modal'],
    [/Trade/, '.trade-modal'],
  ] as const) {
    await page.locator('.controls button', { hasText: button }).click();
    const modal = page.locator(`${dialog}.open .modal`);
    await expect(modal).toBeVisible();
    const b = (await modal.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width).toBeLessThanOrEqual(vw + 1);
    await page.keyboard.press('Escape');
    await expect(page.locator(`${dialog}.open`)).toHaveCount(0);
  }
  await page.locator('.tile[data-index="39"]').click();
  await expect(page.locator('.tile-modal.open .deed')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.click('.menu-btn');
  await expect(page.locator('.menu-modal.open')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('ending early shows the summary with standings', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await startGame(page);
  await playTurns(page, 3);
  await page.click('.menu-btn');
  await page.locator('.menu-modal button', { hasText: /End game now/ }).click();
  await page.locator('.confirm-modal button.danger').click();
  await expect(page.locator('.gameover-modal.open .standings li')).toHaveCount(3);
  await expect(page.locator('.gameover-modal .spark')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('the Maharashtra board shows rupees and local names', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.click('.edition-seg [data-edition="maharashtra"]');
  await startGame(page, 2);
  await expect(page.locator('.tile[data-index="39"]')).toContainText('Mumbai');
  await playTurns(page, 2);
  const text = await page.locator('body').innerText();
  expect(text).toContain('₹');
  expect(text).not.toMatch(/\$\d/);
  expect(errors).toEqual([]);
});

test('quick game deals two cities to everyone', async ({ page }) => {
  await open(page);
  await page.click('.mode-seg [data-mode="quick"]');
  await startGame(page, 3);
  await expect(page.locator('.tile.owned')).toHaveCount(6);
  await expect(page.locator('.round-pill')).toContainText('/ 15');
});

for (const L of [
  { lang: 'mr', name: 'Marathi', goal: 'ध्येय', roll: 'फासे', end: 'पाळी संपवा' },
  { lang: 'hi', name: 'Hindi', goal: 'लक्ष्य', roll: 'पासे', end: 'बारी ख़त्म' },
]) test(`${L.name} shows everywhere, with no English left on screen`, async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.click(`.lang-seg [data-lang="${L.lang}"]`);
  await page.click('.edition-seg [data-edition="maharashtra"]');
  await page.click('.rules-btn');
  const rules = page.locator('.rules-modal.open .rules');
  await expect(rules).toContainText(L.goal);
  expect(await rules.innerText()).not.toMatch(/[{}]|[A-Za-z]{3,}/);
  await page.keyboard.press('Escape');
  await page.click(`.count-seg [data-count="3"]`);
  await page.locator('.seat [data-ai="0"]').nth(0).click();
  await page.locator('.seat [data-ai="1"]').nth(1).click();
  await page.locator('.seat [data-ai="1"]').nth(2).click();
  await page.click('.start-btn');
  await expect(page.locator('.tile[data-index="39"]')).toContainText('मुंबई');
  // Play a few turns by the translated button labels.
  for (let i = 0, rolls = 0; i < 400 && rolls < 4; i++) {
    const tap = (sel: string) => page.locator(sel).first().click({ timeout: 3000 }).catch(() => {});
    if (await page.$('.card-modal.open .card-ok')) await tap('.card-ok');
    else if (await page.$('.trade-modal.open .modal-actions')) await tap('.trade-modal .modal-actions button:nth-child(2)');
    else if (await page.$('.buy-modal.open')) await tap('.buy-modal .modal-actions button');
    else if (await page.$('.auction-modal.open .now-bidding.mine')) await tap('.auction-modal .modal-actions button:nth-child(2)');
    else if (await page.$('.debt-modal.open')) break;
    else {
      const main = page.locator('.controls .ctrl-row:not(.small) button.primary').first();
      const label = (await main.count()) ? ((await main.textContent()) ?? '') : '';
      if (label.includes(L.roll) && (await main.isEnabled())) {
        await tap('.controls .ctrl-row:not(.small) button.primary');
        rolls++;
      } else if (label.includes(L.end)) await tap('.controls .ctrl-row:not(.small) button.primary');
      else await page.waitForTimeout(100);
    }
  }
  const latin = await page.evaluate(() => {
    const words = new Set<string>();
    const walk = (n: Node) => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType === 3) (c.textContent ?? '').match(/[A-Za-z]{3,}/g)?.forEach((w) => words.add(w));
        else if (c.nodeType === 1 && !['SCRIPT', 'STYLE'].includes(c.nodeName)) walk(c);
      }
    };
    walk(document.body);
    return [...words].filter((w) => !['SKYLINE', 'TYCOON', 'GPS'].includes(w));
  });
  expect(latin).toEqual([]);
  expect(errors).toEqual([]);
});

test('daily challenge: its own section, fixed rules, and a score at the end', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await expect(page.locator('.daily-card')).toBeVisible();
  await page.click('.daily-btn');
  await expect(page.locator('.board')).toBeVisible();
  await expect(page.locator('.round-pill')).toContainText('📅');
  await expect(page.locator('.round-pill')).toContainText('/ 20');
  await expect(page.locator('.pcard')).toHaveCount(4);
  await playTurns(page, 2);
  await page.click('.menu-btn');
  await page.locator('.menu-modal button', { hasText: /End game now/ }).click();
  await page.locator('.confirm-modal button.danger').click();
  await expect(page.locator('.gameover-modal .daily-result')).toContainText('official score');
  await page.locator('.gameover-modal button', { hasText: /Main menu/ }).click();
  await expect(page.locator('.daily-card')).toContainText('Your score');
  await expect(page.locator('.daily-btn')).toContainText('practice');
  expect(errors).toEqual([]);
});

test('house rules: news, missions and action cards show up in play', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.click('summary');
  for (const rule of ['news', 'missions', 'actionCards']) await page.locator('label.switch', { has: page.locator(`[data-opt="${rule}"]`) }).click();
  await startGame(page, 3);
  await expect(page.locator('.pcard .badge', { hasText: '🎯' })).toHaveCount(3);
  await expect(page.locator('.pcard .badge', { hasText: '🃏' }).first()).toBeVisible();
  await expect(page.locator('.controls .cards-btn')).toBeVisible();
  await page.locator('.controls .cards-btn').click();
  await expect(page.locator('.hand-modal.open .action-card')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.locator('.controls button', { hasText: /Manage/ }).click();
  await expect(page.locator('.manage-modal.open .mission-box')).toContainText('secret mission');
  await page.keyboard.press('Escape');
  await playTurns(page, 6);
  expect(errors).toEqual([]);
});

/** Writes a tweak into the saved game, then continues it. */
async function editSave(page: Page, edit: (state: Record<string, any>) => void) {
  await page.waitForFunction(() => !!localStorage.getItem('st-save'));
  await page.evaluate((src) => {
    const d = JSON.parse(localStorage.getItem('st-save')!);
    new Function('state', src)(d.state);
    localStorage.setItem('st-save', JSON.stringify(d));
  }, `(${edit.toString()})(state)`);
  await page.reload();
  await page.locator('.setup-actions-top button').click();
}

test('auction: short of cash, raise it by mortgaging, then bid', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await startGame(page, 2);
  await playTurns(page, 1);
  await editSave(page, (s) => {
    s.props = { 1: { owner: 0, houses: 0, mortgaged: false } };
    s.players[0].cash = 40;
    s.phase = 'auction';
    s.current = 0;
    s.auction = { tile: 39, bid: 50, bidder: 1, active: [0, 1], turn: 0 };
  });
  const modal = page.locator('.auction-modal.open');
  await expect(modal.locator('.now-bidding.mine')).toBeVisible();
  await expect(modal.locator('.modal-actions button').first()).toBeDisabled();
  await modal.locator('.raise-btn').click();
  await page.locator('.manage-modal.open .mbtns button', { hasText: /Mortgage/ }).first().click();
  await page.keyboard.press('Escape');
  await expect(modal.locator('.modal-actions button').first()).toBeEnabled();
  await modal.locator('.modal-actions button').first().click();
  await expect(page.locator('.log-line').filter({ hasText: 'bids' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('team mode, race mode and early building play through', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.click('.count-seg [data-count="4"]');
  await page.locator('.seat [data-ai="0"]').nth(0).click();
  for (let i = 1; i < 4; i++) await page.locator('.seat [data-ai="1"]').nth(i).click();
  await page.locator('label.switch', { has: page.locator('[data-opt="teams"]') }).click();
  await page.selectOption('[data-opt="goal"]', 'worth5000');
  await page.click('summary');
  await page.locator('label.switch', { has: page.locator('[data-opt="earlyBuild"]') }).click();
  await page.click('.start-btn');
  await expect(page.locator('.pcard .badge.team')).toHaveCount(4);
  await expect(page.locator('.pcard .badge.race')).toHaveCount(4);
  await expect(page.locator('.round-pill')).toContainText('🏁');
  await expect(page.locator('.status-line .who')).toBeVisible();
  await playTurns(page, 4);
  await page.click('.menu-btn');
  await page.locator('.menu-modal button', { hasText: /End game now/ }).click();
  await page.locator('.confirm-modal button.danger').click();
  await expect(page.locator('.gameover-modal .winner')).toContainText('Team');
  expect(errors).toEqual([]);
});
