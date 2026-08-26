import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = __dirname;
const backendRoot = path.join(repositoryRoot, "backend");
const frontendRoot = path.join(repositoryRoot, "frontend");
const frontendPort = process.env.HR_HIRING_E2E_FRONTEND_PORT || "3100";
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;
process.env.HR_HIRING_E2E_BASE_URL = frontendBaseUrl;

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:55432/sabalanerp_e2e?schema=public";
process.env.JWT_SECRET ??= "hr-hiring-e2e-secret-with-at-least-32-characters";
process.env.FRONTEND_URL ??= frontendBaseUrl;
process.env.PUBLIC_APP_URL ??= frontendBaseUrl;
process.env.NEXT_PUBLIC_API_URL ??= "/api";
process.env.BACKEND_API_ORIGIN ??= "http://127.0.0.1:5100";
process.env.SMS_IR_ENVIRONMENT ??= "sandbox";
process.env.HR_HIRING_E2E ??= "true";
process.env.HR_HIRING_SMS_ADAPTER ??= "memory";

// The backend intentionally owns several bounded Prisma clients across route modules.
// Keep the single-worker E2E process below the small CI PostgreSQL connection budget.
const e2eDatabaseUrl = new URL(process.env.DATABASE_URL);
e2eDatabaseUrl.searchParams.set("connection_limit", "1");
process.env.DATABASE_URL = e2eDatabaseUrl.toString();

export default defineConfig({
  testDir: "./tests/hr-hiring",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: frontendBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: [
    {
      command:
        "node node_modules/prisma/build/index.js migrate deploy && node node_modules/tsx/dist/cli.mjs src/prisma/seed-hr-hiring-e2e.ts && npm run dev",
      cwd: backendRoot,
      url: "http://127.0.0.1:5100/api/ready",
      env: {
        ...process.env,
        PORT: "5100",
        NODE_ENV: "test",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --port ${frontendPort}`,
      cwd: frontendRoot,
      url: `${frontendBaseUrl}/login`,
      env: {
        ...process.env,
        NODE_ENV: "test",
        BACKEND_API_ORIGIN: "http://127.0.0.1:5100",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
