import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/performance-acceptance-browser',
  outputDir: './test-results/performance-acceptance-browser',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: process.env.DESIGN_SYSTEM_E2E_BASE_URL || 'http://localhost:3000',
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
