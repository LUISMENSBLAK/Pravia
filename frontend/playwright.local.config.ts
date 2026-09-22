import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 600_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'test-results/corrections-003v2-007',
});
