import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/design-system-e2e',
  outputDir: './test-results/design-system',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{projectName}/{arg}{ext}',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: Boolean(process.env.CI),
  updateSnapshots: 'none',
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'test-results/design-system-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: process.env.DESIGN_SYSTEM_E2E_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    reducedMotion: 'reduce'
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' }
    }
  ]
});
