import { spawnSync } from 'node:child_process';

const composeFile = 'docker-compose.local.yml';
const compose = ['compose', '-f', composeFile];

function runDocker(args) {
  const result = spawnSync('docker', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function expectJson(url, validate, label) {
  let lastError;

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'cache-control': 'no-cache' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const body = await response.json();
      if (!validate(body)) throw new Error(`unexpected response: ${JSON.stringify(body)}`);

      console.log(`✓ ${label}`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw new Error(`${label} failed: ${lastError?.message ?? 'unknown error'}`);
}

async function expectPage(url, expectedText, label) {
  const response = await fetch(url, {
    headers: { 'cache-control': 'no-cache' },
  });
  const body = await response.text();

  if (!response.ok || !body.includes(expectedText)) {
    throw new Error(`${label} failed: HTTP ${response.status}`);
  }

  console.log(`✓ ${label}`);
}

console.log('Building and starting the production-like local Docker stack...');
runDocker([...compose, 'up', '--build', '-d', '--wait']);

await expectJson(
  'http://127.0.0.1:5000/api/health',
  (body) => body.status === 'OK' && body.database === 'OK',
  'backend and database health',
);
await expectJson(
  'http://127.0.0.1:3000/api/health',
  (body) => body.status === 'OK' && body.database === 'OK',
  'frontend API proxy',
);
await expectPage('http://127.0.0.1:3000', 'Sabalan ERP', 'frontend page');
await expectPage('http://127.0.0.1:3001', 'استعلام قیمت سبلان', 'inquiry page');

runDocker([...compose, 'ps']);
console.log('✓ Local Docker verification passed');
