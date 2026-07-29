import { defineConfig, devices } from '@playwright/test';

process.env.SUPPORT_QA_RUN_ID ??= `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

export default defineConfig({
  testDir: './tests/support-notifications',
  globalSetup: './tests/support-notifications/global-setup.ts',
  globalTeardown: './tests/support-notifications/global-teardown.ts',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.SABALAN_LOCAL_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
