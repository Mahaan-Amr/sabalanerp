import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const compose = [
  'compose',
  '-f',
  resolve('docker-compose.local.yml'),
  '-f',
  resolve('docker-compose.dev.yml'),
];

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function waitFor(url, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = spawnSync(
      'curl',
      ['--fail', '--silent', '--show-error', '--max-time', '3', url],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'ignore',
        shell: process.platform === 'win32',
      },
    );

    if (result.status === 0) {
      console.log(`✓ ${label}`);
      return;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }

  throw new Error(`${label} failed: timed out after ${timeoutMs / 1_000}s`);
}

console.log('Building and starting development containers...');
runDocker([...compose, 'up', '--build', '-d']);

console.log('Synchronizing the latest workspace state...');
const copies = [
  ['backend/src/.', 'backend:/app/src'],
  ['backend/prisma/.', 'backend:/app/prisma'],
  ['backend/public/.', 'backend:/app/public'],
  ['backend/scripts/.', 'backend:/app/scripts'],
  ['backend/excel/.', 'backend:/app/excel'],
  ['frontend/src/.', 'frontend:/app/src'],
  ['frontend/public/.', 'frontend:/app/public'],
  ['frontend/next.config.js', 'frontend:/app/next.config.js'],
  ['apps/sabalan-inquiry/app/.', 'inquiry:/app/app'],
  ['apps/sabalan-inquiry/excel/.', 'inquiry:/app/excel'],
  ['apps/sabalan-inquiry/lib/.', 'inquiry:/app/lib'],
  ['apps/sabalan-inquiry/prisma/.', 'inquiry:/app/prisma'],
  ['apps/sabalan-inquiry/public/.', 'inquiry:/app/public'],
  ['apps/sabalan-inquiry/scripts/.', 'inquiry:/app/scripts'],
  ['apps/sabalan-inquiry/next.config.ts', 'inquiry:/app/next.config.ts'],
  ['apps/sabalan-inquiry/postcss.config.mjs', 'inquiry:/app/postcss.config.mjs'],
  ['apps/sabalan-inquiry/proxy.ts', 'inquiry:/app/proxy.ts'],
  ['apps/sabalan-inquiry/tsconfig.json', 'inquiry:/app/tsconfig.json'],
  ['packages/contract-product-graph/src/.', 'backend:/packages/contract-product-graph/src'],
  ['packages/contract-product-graph/src/.', 'frontend:/packages/contract-product-graph/src'],
  ['packages/contract-product-graph/tsconfig.json', 'backend:/packages/contract-product-graph/tsconfig.json'],
  ['packages/contract-product-graph/tsconfig.build.json', 'backend:/packages/contract-product-graph/tsconfig.build.json'],
  ['packages/contract-product-graph/tsconfig.json', 'frontend:/packages/contract-product-graph/tsconfig.json'],
  ['packages/contract-product-graph/tsconfig.build.json', 'frontend:/packages/contract-product-graph/tsconfig.build.json'],
];

for (const [source, destination] of copies) {
  runDocker([...compose, 'cp', source, destination]);
}

runDocker([...compose, 'restart', 'backend', 'frontend', 'inquiry']);
waitFor('http://127.0.0.1:5000/api/ready', 'backend development server');
waitFor('http://127.0.0.1:3000', 'frontend development server');
waitFor('http://127.0.0.1:3001', 'inquiry development server');

console.log('Watching for changes. Press Ctrl+C to stop watching; containers stay running.');
let activeWatcher;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => activeWatcher?.kill(signal));
}

async function watchChanges() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const code = await new Promise((resolveExit, reject) => {
      activeWatcher = spawn('docker', [...compose, 'watch', '--no-up'], {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      activeWatcher.once('error', reject);
      activeWatcher.once('exit', (exitCode) => resolveExit(exitCode ?? 0));
    });

    if (code === 0) return;
    if (attempt === 3) throw new Error(`Docker Compose Watch exited with code ${code}`);

    console.warn(`Watch exited with code ${code}; retrying (${attempt}/3)...`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
}

watchChanges().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
