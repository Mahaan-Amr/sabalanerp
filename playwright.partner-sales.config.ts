import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateNamespace } from './tests/partner-sales/harness/safety.mjs';

const runId = validateNamespace(process.env.PARTNER_QA_RUN_ID || `partner-qa-${randomUUID()}`);
const evidence = path.join(__dirname, 'test-results/partner-sales', runId);

export default defineConfig({
  testDir: './tests/partner-sales/browser',
  globalSetup: './tests/partner-sales/browser/global-setup.ts',
  outputDir: path.join(evidence, 'browser'),
  reporter: [['list'], ['json', { outputFile: path.join(evidence, 'browser-results.json') }]],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
    browserName: 'chromium',
    channel: 'chrome',
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    trace: 'on',
    screenshot: 'on',
    video: 'off',
    serviceWorkers: 'block',
  },
  projects: (['light', 'dark'] as const).flatMap((colorScheme) => [
    { name: `desktop-${colorScheme}`, use: { colorScheme, viewport: { width: 1440, height: 1000 } } },
    { name: `narrow-${colorScheme}`, use: { colorScheme, viewport: { width: 390, height: 844 } } },
  ]),
  // Never start servers, migrate, seed shared accounts, or launch another Compose project.
});
