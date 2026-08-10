import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/accounting-dispatch-documents-real',
  testMatch: 'authenticated.spec.ts',
  globalSetup: './tests/accounting-dispatch-documents-real/global-setup.ts',
  globalTeardown: './tests/accounting-dispatch-documents-real/global-teardown.ts',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.ACCOUNTING_DISPATCH_DOCUMENTS_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
