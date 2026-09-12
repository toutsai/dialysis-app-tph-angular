import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'output/playwright/results',
  reporter: [['list']],
  // Authentication stays in private fixture memory; do not persist tokens in traces.
  use: { ...devices['Desktop Chrome'], timezoneId: 'Asia/Taipei', locale: 'zh-TW', trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
