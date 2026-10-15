import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const checker = path.join(root, 'deploy/scripts/check-frontend-docker-workspace.mjs');
const dockerfile = fs.readFileSync(path.join(root, 'frontend/Dockerfile'), 'utf8');
const valid = 'services:\n  frontend:\n    image: example:immutable\n    build:\n      context: .\n      dockerfile: frontend/Dockerfile\n    restart: unless-stopped\n';
function run(compose, source = dockerfile) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-workspace-gate-'));
  try {
    fs.mkdirSync(path.join(directory, 'frontend'));
    fs.writeFileSync(path.join(directory, 'docker-compose.prod.yml'), compose);
    fs.writeFileSync(path.join(directory, 'frontend/Dockerfile'), source);
    fs.copyFileSync(path.join(root, 'frontend/package.json'), path.join(directory, 'frontend/package.json'));
    return spawnSync(process.execPath, [checker], { cwd: directory, encoding: 'utf8' });
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('sabalan-workspace-gate-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
test('immutable image before build and inherited production builder pass workspace gate', () => {
  const result = run(valid); assert.equal(result.status, 0, result.stderr);
});
test('CRLF Compose and Dockerfile retain the same workspace meaning', () => {
  const result = run(valid.replaceAll('\n', '\r\n'), dockerfile.replace(/\r?\n/g, '\r\n'));
  assert.equal(result.status, 0, result.stderr);
});
test('another service cannot supply a missing frontend build boundary', () => {
  const result = run('services:\n  frontend:\n    image: example:immutable\n  inquiry:\n    build:\n      context: .\n      dockerfile: frontend/Dockerfile\n');
  assert.notEqual(result.status, 0);
});
test('frontend-directory context remains prohibited', () => {
  assert.notEqual(run(valid.replace('context: .', 'context: frontend')).status, 0);
});
test('runtime canonical graph cannot come from an unrelated production stage', () => {
  assert.notEqual(run(valid, dockerfile.replace('FROM builder AS production-builder', 'FROM node:20-alpine AS production-builder')).status, 0);
});
