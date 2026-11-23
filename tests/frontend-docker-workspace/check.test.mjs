import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dockerfile = fs.readFileSync(path.join(root, 'frontend/Dockerfile'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.prod.yml'), 'utf8');
function check(composeInput = compose, dockerfileInput = dockerfile) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-workspace-check-'));
  try {
    fs.mkdirSync(path.join(directory, 'frontend'));
    fs.writeFileSync(path.join(directory, 'docker-compose.prod.yml'), composeInput);
    fs.writeFileSync(path.join(directory, 'frontend/Dockerfile'), dockerfileInput);
    fs.copyFileSync(path.join(root, 'frontend/package.json'), path.join(directory, 'frontend/package.json'));
    return spawnSync(process.execPath, [path.join(root, 'deploy/scripts/check-frontend-docker-workspace.mjs')], {
      cwd: directory, encoding: 'utf8',
    });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('the actual production Compose and multistage Dockerfile pass the public checker', () => {
  const result = check();
  assert.equal(result.status, 0, result.stderr);
});

test('valid build settings do not depend on the order of service keys', () => {
  const result = check('services:\n  frontend:\n    restart: unless-stopped\n    image: example\n    build:\n      context: .\n      dockerfile: frontend/Dockerfile\n');
  assert.equal(result.status, 0, result.stderr);
});

test('another service root context cannot hide the incorrect frontend context', () => {
  const result = check('services:\n  backend:\n    build:\n      context: .\n  frontend:\n    build:\n      context: ./frontend\n      dockerfile: frontend/Dockerfile\n  inquiry:\n    build:\n      context: .\n');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /build context must be the repository root/);
});

test('a frontend build using the wrong Dockerfile is rejected', () => {
  const result = check('services:\n  frontend:\n    build:\n      context: .\n      dockerfile: backend/Dockerfile\n');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use frontend\/Dockerfile/);
});

test('an unrelated runtime copy stage is rejected', () => {
  const result = check(compose, dockerfile.replace('COPY --from=production-builder /packages/contract-product-graph', 'COPY --from=unrelated /packages/contract-product-graph'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Runtime image must preserve/);
});

test('a production builder that does not inherit the compiled packages is rejected', () => {
  const result = check(compose, dockerfile.replace('FROM builder AS production-builder', 'FROM node:20-alpine AS production-builder'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production builder must inherit/);
});

test('nested build arguments cannot stand in for frontend build fields', () => {
  const result = check('services:\n  frontend:\n    build:\n      args:\n        context: .\n        dockerfile: frontend/Dockerfile\n');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /build context must be the repository root/);
});

test('a commented-out copy cannot satisfy the runtime package contract', () => {
  const result = check(compose, dockerfile.replace(
    'COPY --from=production-builder /packages/contract-product-graph',
    '# COPY --from=production-builder /packages/contract-product-graph'
  ));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Runtime image must preserve/);
});
