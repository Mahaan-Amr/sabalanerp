import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
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

function fixture({ settled = closure, status = 0, keepPostgres = true } = {}) {
  const actions = [];
  let stopped = false;
  return {
    actions,
    runDocker(args) {
      if (args[0] === 'compose') {
        assert.deepEqual(args.slice(0, compose.length), compose);
        if (args[compose.length] === 'ps') {
          const service = args.at(-1);
          if (service === 'backend') return backendId;
          if (service === 'postgres') return postgresId;
          return '';
        }
        assert.equal(args[compose.length], 'down');
        actions.push('compose down');
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
            ? { Status: 'exited', ExitCode: status, StartedAt: '2026-11-17T10:00:00Z' }
            : { Status: id === postgresId && stopped && !keepPostgres ? 'exited' : 'running', StartedAt: '2026-11-17T10:00:00Z' },
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

test('local teardown stops the exact backend, proves closure, then brings the remaining project down', () => {
  const runtime = fixture();
  stopLocalDocker(runtime);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend', 'read closure', 'compose down']);
});

test('local teardown refuses a stale closure even when the backend exits successfully', () => {
  const runtime = fixture({ settled: { ...closure, activeClaimSha256: '1'.repeat(64) } });
  assert.throws(() => stopLocalDocker(runtime), /matching, successful QUIESCENT native closure/);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend', 'read closure']);
});

test('local teardown refuses a forced backend exit', () => {
  const runtime = fixture({ status: 137 });
  assert.throws(() => stopLocalDocker(runtime), /did not exit cleanly/);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend']);
});

test('local teardown refuses shutdown if PostgreSQL stops during the backend drain', () => {
  const runtime = fixture({ keepPostgres: false });
  assert.throws(() => stopLocalDocker(runtime), /did not stay running/);
  assert.deepEqual(runtime.actions, ['read ACTIVE', 'stop backend', 'read closure']);
});
