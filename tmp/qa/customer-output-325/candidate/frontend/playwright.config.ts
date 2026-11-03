import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.HR_E2E_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
});
