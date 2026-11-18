import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const shell = process.env.SABALAN_TEST_SHELL
  ?? (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh');
const script = fs.readFileSync(
  new URL('../../deploy/scripts/deploy.sh', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

test('maintenance entry publishes unique operation identities that fit PostgreSQL application_name and retain the full source commit', () => {
  // Exercise the normal CLI parser and identity publication. External preflight
  // work between these boundaries is covered by the runner and gate-order tests.
  const entry = script.slice(
    script.indexOf('SYSTEM_RECOVERY_BACKUP_HOST='),
    script.indexOf('\ncd "${REPO_ROOT}"'),
  );
  const before = '  eval "${customer_allocation_predecessor}"\nfi\n';
  assert.ok(script.includes(before));
  const identity = script.slice(
    script.indexOf(before) + before.length,
    script.indexOf('\ndatabase_role_pin="$(database_role_pin_path)"'),
  );
  assert.ok(entry.length > 0 && identity.length > 0);

  const code = [
    'set -eu',
    'SCRIPT_DIR=/operations/deploy/scripts; OPERATIONS_ROOT=/operations; REPO_ROOT=/repository',
    entry,
    'DEPLOYMENT_TARGET_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'date(){ printf 20261118T060030Z; }',
    identity,
    'printf "%s|%s|%s|%s\\n" "$DEPLOYMENT_RELEASE_ID" "$DEPLOYMENT_ID" "$APP_COMMIT" "$DEPLOYMENT_TARGET_COMMIT"',
    '',
  ].join('\n');

  function runEntry(args, environment = {}) {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-identity-'));
    try {
      const entryFile = path.join(temporaryDirectory, 'entry.sh');
      fs.writeFileSync(entryFile, code);
      const result = spawnSync(shell, [entryFile, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...environment },
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim().split('|');
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  const maintenanceArgs = ['--maintenance-images', '/private/env', '/private/plan', 'a'.repeat(64)];
  const deploymentIds = new Set();
  for (let attempt = 0; attempt < 4; attempt++) {
    const [release, deployment, appCommit, targetCommit] = runEntry(maintenanceArgs);
    assert.match(release, /^20261118T060030Z-[a-f0-9]{16}-release$/);
    assert.equal(Buffer.byteLength(release, 'ascii'), 41);
    assert.equal(deployment, 'deploy-' + release);
    assert.equal(Buffer.byteLength(deployment, 'ascii'), 48);

    const applicationName = 'sabalan-lock-' + deployment;
    assert.equal(Buffer.byteLength(applicationName, 'ascii'), 61);
    assert.equal(
      Buffer.from(applicationName).subarray(0, 63).toString(),
      applicationName,
      'PostgreSQL must retain the literal identity used by acquire, observation and release',
    );
    assert.equal(appCommit, 'a'.repeat(40));
    assert.equal(targetCommit, 'a'.repeat(40));
    assert.ok(!deploymentIds.has(deployment), 'operations in the same UTC second must remain distinct');
    deploymentIds.add(deployment);
  }

  // Other modes retain their exact existing published identity format.
  const ordinaryModeCases = [
    {
      name: 'ordinary release',
      args: ['/private/env'],
      environment: {},
      mode: 'release',
    },
    {
      name: 'configuration',
      args: ['/private/env'],
      environment: { DEPLOYMENT_MODE: 'configuration' },
      mode: 'configuration',
    },
    {
      name: 'capture only',
      args: ['--capture-only', '/private/env', '/private/plan'],
      environment: {},
      mode: 'release',
    },
    {
      name: 'scanner repair',
      args: ['/private/env'],
      environment: { DEPLOYMENT_CLAMAV_TARGET_IMAGE: 'sha256:' + 'b'.repeat(64) },
      mode: 'release',
    },
    {
      name: 'customer allocation current data rollback',
      args: ['--customer-allocation-current-data-rollback', '/private/env', '/private/evidence'],
      environment: {
        DEPLOYMENT_CUSTOMER_ALLOCATION_AUTHORITY_DIR: '/private/authority',
        DEPLOYMENT_CUSTOMER_ALLOCATION_APPROVER_SHA256: 'c'.repeat(64),
      },
      mode: 'release',
    },
  ];

  for (const { name, args, environment, mode } of ordinaryModeCases) {
    const [release, deployment, appCommit, targetCommit] = runEntry(args, environment);
    assert.equal(release, '20261118T060030Z-aaaaaaaaaaaa-' + mode, name);
    assert.equal(deployment, 'deploy-' + release, name);
    assert.equal(appCommit, 'a'.repeat(40), name);
    assert.equal(targetCommit, 'a'.repeat(40), name);
  }
});
