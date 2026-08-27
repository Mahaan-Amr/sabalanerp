import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', outputDir: '../../../test-results/partner-management',
  workers: 1, fullyParallel: false, retries: 0, timeout: 90_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3000', channel: 'chrome', locale: 'fa-IR', timezoneId: 'Asia/Tehran',
    reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  // Only the existing sabalanerp-local services; never starts another server/stack.
});
