import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const repositoryRoot = __dirname;
const backendRoot = path.join(repositoryRoot, 'backend');
const frontendRoot = path.join(repositoryRoot, 'frontend');

process.env.JWT_SECRET ??= 'design-system-e2e-secret-with-at-least-32-characters';
process.env.FRONTEND_URL ??= 'http://127.0.0.1:3101';
process.env.PUBLIC_APP_URL ??= 'http://127.0.0.1:3101';
process.env.NEXT_PUBLIC_API_URL ??= '/api';
process.env.BACKEND_API_ORIGIN ??= 'http://127.0.0.1:5101';
process.env.SMS_IR_ENVIRONMENT ??= 'sandbox';

export default defineConfig({
  testDir: './tests/design-system-e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3101',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' }
    }
  ],
  webServer: [
    {
      command: 'npx prisma generate && npx prisma migrate deploy && npm run db:seed && npm run dev',
      cwd: backendRoot,
      url: 'http://127.0.0.1:5101/api/ready',
      env: {
        ...process.env,
        PORT: '5101',
        NODE_ENV: 'test'
      },
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'npm run dev -- --port 3101',
      cwd: frontendRoot,
      url: 'http://127.0.0.1:3101/login',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        BACKEND_API_ORIGIN: 'http://127.0.0.1:5101'
      },
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
