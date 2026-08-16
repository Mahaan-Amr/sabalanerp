import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertHttpReady, inspectLocalComposeProject } from './design-system-e2e-preflight.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const baseUrl = process.env.DESIGN_SYSTEM_E2E_BASE_URL || 'http://localhost:3000';

inspectLocalComposeProject(repositoryRoot);
await assertHttpReady('http://127.0.0.1:5000/api/ready', 'sabalanerp-local backend');
await assertHttpReady(`${baseUrl}/login`, 'sabalanerp-local frontend');

const result = spawnSync(
  process.execPath,
  [
    path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    '--config=playwright.design-system.config.ts',
    ...process.argv.slice(2)
  ],
  {
    cwd: repositoryRoot,
    env: { ...process.env, DESIGN_SYSTEM_E2E_BASE_URL: baseUrl },
    stdio: 'inherit'
  }
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
