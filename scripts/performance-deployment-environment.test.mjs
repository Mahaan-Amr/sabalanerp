import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseEnvironmentKeys, validateReleaseEnvironment } from './performance-deployment-environment.mjs';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const environment = Object.fromEntries(releaseEnvironmentKeys.map((key) => [key,
  key.endsWith('_COMMIT') ? 'a'.repeat(40) : key.endsWith('_IMAGE') ? `sha256:${'b'.repeat(64)}` : 'c'.repeat(64)]));
assert.deepEqual(validateReleaseEnvironment(environment), environment);
assert.throws(() => validateReleaseEnvironment({ ...environment, JWT_SECRET: 'never journal secrets' }));
assert.throws(() => validateReleaseEnvironment({ ...environment, PERFORMANCE_RELEASE_COMMIT: "'; touch /tmp/injected; '" }));
const captured = spawnSync(process.execPath, ['scripts/performance-deployment-environment.mjs', 'capture'], {
  input: JSON.stringify([{ Config: { Env: [...Object.entries(environment).map(([key,value]) => `${key}=${value}`),
    'PERFORMANCE_PROMOTION_ATTESTATION_KEY_BASE64=private-secret', 'JWT_SECRET=another-secret'] } }]), encoding: 'utf8',
});
assert.equal(captured.status, 0, captured.stderr);
assert.deepEqual(JSON.parse(captured.stdout), environment);
assert.ok(!captured.stdout.includes('secret'));
const directory = mkdtempSync(path.join(os.tmpdir(), 'sabalan-runtime-rollback-'));
try {
  const session = path.join(directory, 'session.json');
  writeFileSync(session, JSON.stringify({ rollbackPerformanceEnvironment: environment }));
  const restored = spawnSync(process.execPath, ['scripts/performance-deployment-environment.mjs', 'restore', session], { encoding: 'utf8' });
  assert.equal(restored.status, 0, restored.stderr);
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh';
  const result = spawnSync(bash, ['-c', `${restored.stdout}\nprintf '%s' "$PERFORMANCE_RELEASE_COMMIT:$PERFORMANCE_RELEASE_BACKEND_IMAGE"`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${environment.PERFORMANCE_RELEASE_COMMIT}:${environment.PERFORMANCE_RELEASE_BACKEND_IMAGE}`);
  writeFileSync(session, JSON.stringify({ rollbackPerformanceEnvironment: { PERFORMANCE_RELEASE_COMMIT: 'invalid' } }));
  const rejected = spawnSync(process.execPath, ['scripts/performance-deployment-environment.mjs', 'restore', session], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.equal(rejected.stdout, '');
} finally { rmSync(directory, { recursive: true, force: true }); }
const deploy = readFileSync('deploy/scripts/deploy.sh', 'utf8');
assert.ok(deploy.indexOf('DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT=') < deploy.indexOf('\ncontrol prepare\n'));
assert.match(deploy, /phase RELEASE_STARTED\s+refresh_performance_database_identity\s+remaining=/);
console.log('performance deployment environment tests passed');
