import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopLocalDocker } from '../../scripts/stop-local-docker.mjs';

const backendId = 'a'.repeat(64);
const postgresId = 'b'.repeat(64);
const compose = ['compose', '-p', 'sabalanerp-local', '-f', 'docker-compose.local.yml'];
const claim = {
  format: 'sabalan-runtime-native/v1',
  role: 'standalone',
  phase: 'ACTIVE',
  instanceId: '1234567890abcdef1234567890abcdef1234567890abcdef',
};
const active = Buffer.from(JSON.stringify(claim) + '\n');
const digest = createHash('sha256').update(active).digest('hex');
const closure = {
  ...claim,
  phase: 'QUIESCENT',
  activeClaimSha256: digest,
  nativeReaped: true,
  databaseQuiet: true,
  nativeStatus: 0,
  stoppedBySignal: true,
};

function tempProofDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sabalan-local-shutdown-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fixture({
  settled = closure, status = 0, keepPostgres = true, proofDirectory, downFailures = 0,
  stoppedInitially = false, backendOnly = false, empty = false,
} = {}) {
  const actions = [];
  let stopped = stoppedInitially;
  let backendMissing = false;
  let postgresStartedAt = '2026-11-17T10:00:00Z';
  return {
    actions,
    proofDirectory,
    backendOnly,
    removeBackend() {
      backendMissing = true;
    },
    restartPostgres() {
      postgresStartedAt = '2026-11-17T10:05:00Z';
    },
    runDocker(args) {
      if (args[0] === 'compose') {
        assert.deepEqual(args.slice(0, compose.length), compose);
        if (args[compose.length] === 'ps') {
          const service = args.at(-1);
          if (service === '--quiet') return empty ? '' : postgresId;
          if (service === 'backend') return backendMissing ? '' : backendId;
          if (service === 'postgres') return postgresId;
          return '';
        }
        assert.equal(args[compose.length], 'down');
        actions.push('compose down');
        if (downFailures > 0) {
          downFailures -= 1;
          throw new Error('Compose down interrupted');
        }
        return '';
      }
      if (args[0] === 'inspect') {
        const id = args.at(-1);
        assert.ok([backendId, postgresId].includes(id));
        const service = id === backendId ? 'backend' : 'postgres';
        return JSON.stringify([{
          Id: id,
          Config: { Labels: {
            'com.docker.compose.project': 'sabalanerp-local',
            'com.docker.compose.service': service,
          } },
          State: id === backendId && stopped
            ? {
              Status: 'exited', ExitCode: status, StartedAt: '2026-11-17T10:00:00Z',
              FinishedAt: '2026-11-17T10:01:00Z',
            }
            : {
              Status: id === postgresId && stopped && !keepPostgres ? 'exited' : 'running',
              StartedAt: id === postgresId ? postgresStartedAt : '2026-11-17T10:00:00Z',
            },
        }]);
      }
      assert.deepEqual(args, ['stop', '--time', '300', backendId]);
      assert.deepEqual(actions, ['read ACTIVE']);
      actions.push('stop backend');
      stopped = true;
      return backendId;
    },
    readNativeRecord(id) {
      assert.equal(id, backendId);
      actions.push(stopped ? 'read closure' : 'read ACTIVE');
      return stopped ? Buffer.from(JSON.stringify(settled)) : active;
    },
  };
}

test('local teardown stops the exact backend, proves closure, then brings the remaining project down', (t) => {
  const runtime = fixture({ proofDirectory: tempProofDirectory(t) });
  stopLocalDocker(runtime);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend', 'read closure', 'compose down']);
});

test('local teardown refuses a stale closure even when the backend exits successfully', (t) => {
  const runtime = fixture({ proofDirectory: tempProofDirectory(t), settled: { ...closure, activeClaimSha256: '1'.repeat(64) } });
  assert.throws(() => stopLocalDocker(runtime), /matching, successful QUIESCENT native closure/);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend', 'read closure']);
});

test('local teardown refuses a forced backend exit', (t) => {
  const runtime = fixture({ proofDirectory: tempProofDirectory(t), status: 137 });
  assert.throws(() => stopLocalDocker(runtime), /did not exit cleanly/);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend']);
});

test('local teardown refuses shutdown if PostgreSQL stops during the backend drain', (t) => {
  const runtime = fixture({ proofDirectory: tempProofDirectory(t), keepPostgres: false });
  assert.throws(() => stopLocalDocker(runtime), /did not stay running/);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend', 'read closure']);
});
test('local teardown resumes after a failed Compose down using the exact prior backend claim', (t) => {
  const runtime = fixture({ proofDirectory: tempProofDirectory(t), downFailures: 1 });
  assert.throws(() => stopLocalDocker(runtime), /Compose down interrupted/);
  stopLocalDocker(runtime);
  assert.deepEqual(runtime.actions, [
    'read ACTIVE', 'stop backend', 'read closure', 'compose down', 'read closure', 'compose down',
  ]);
});

test('a retained stopped backend without shutdown proof cannot authorize Compose down', (t) => {
  const runtime = fixture({ proofDirectory: tempProofDirectory(t), stoppedInitially: true });
  assert.throws(() => stopLocalDocker(runtime), /no saved shutdown proof/);
  assert.deepEqual(runtime.actions, []);
});

test('backend-only drains and proves closure without stopping any remaining services', (t) => {
  const runtime = fixture({ proofDirectory: tempProofDirectory(t), backendOnly: true });
  stopLocalDocker(runtime);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend', 'read closure']);
});

test('a retry refuses teardown after the original PostgreSQL container restarts', (t) => {
  const runtime = fixture({ proofDirectory: tempProofDirectory(t), downFailures: 1 });
  assert.throws(() => stopLocalDocker(runtime), /Compose down interrupted/);
  runtime.restartPostgres();
  assert.throws(() => stopLocalDocker(runtime), /different backend or PostgreSQL run/);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend', 'read closure', 'compose down']);
});

test('a retry refuses teardown when the original backend container is missing', (t) => {
  const runtime = fixture({ proofDirectory: tempProofDirectory(t), downFailures: 1 });
  assert.throws(() => stopLocalDocker(runtime), /Compose down interrupted/);
  runtime.removeBackend();
  assert.throws(() => stopLocalDocker(runtime), /exactly one local backend container/);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend', 'read closure', 'compose down']);
});

test('local teardown succeeds without changing Docker when the project is already down', (t) => {
  const runtime = fixture({ proofDirectory: tempProofDirectory(t), empty: true });
  stopLocalDocker(runtime);
  assert.deepEqual(runtime.actions, []);
});
