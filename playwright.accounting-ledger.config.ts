import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/accounting-ledger-e2e',
  outputDir: './test-results/accounting-ledger',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.ACCOUNTING_LEDGER_E2E_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'حسابداری-کرومیوم', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
