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
    else if (await page.$('.auction-modal.open .bid-turn')) await click('.auction-modal button', /Drop out/);
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
