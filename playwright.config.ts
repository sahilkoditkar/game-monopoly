import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests: real games on a phone, a phone held sideways and a laptop.
 * They guard the layout and the game flow (no page errors, no sideways scrolling,
 * nothing stalls). Run with `npm run e2e` after `npm run build`.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'phone-landscape', use: { ...devices['Pixel 7 landscape'], browserName: 'chromium' } },
    { name: 'laptop', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
