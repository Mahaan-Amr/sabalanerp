import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { switchFirstRoleEnvironment, withFirstRoleRuntimeEnvironment } from './first-role-cutover-host-environment.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const fixtureFile = fileURLToPath(import.meta.url);

async function exercise(root) {
  const environment = path.join(root, 'release.env');
  const reportDir = path.join(root, 'reports');
  mkdirSync(reportDir, { mode: 0o700 });
  const original = Buffer.from('POSTGRES_USER=application_owner\nPOSTGRES_PASSWORD=test_fixture\n');
  writeFileSync(environment, original, { mode: 0o600 });
  const afterBytes = withFirstRoleRuntimeEnvironment(original, Buffer.from(randomBytes(32).toString('base64url')));
  const deploymentId = 'local-first-role';
  const session = path.join(reportDir, 'active-deployment-session.json');
  const setPhase = phase => writeFileSync(session, JSON.stringify({ deploymentId, phase, bootstrap: false,
    purpose: 'first-database-role-cutover' }), { mode: 0o600 });
  const expected = { deploymentId, beforeSha256: sha(original), afterSha256: sha(afterBytes) };
  const params = { root, reportDir, environment, expected, action: 'apply', afterBytes };
  setPhase('MUTATION_STARTED');
  let observations = 0;
  await assert.rejects(switchFirstRoleEnvironment({ ...params, proveBoundary: async () => ++observations === 1 }), /UNPROVEN/);
  assert.deepEqual(readFileSync(environment), original);
  assert.equal(statSync(path.join(reportDir, 'first-role-environment-local-first-role.previous')).mode & 0o777, 0o600);
  const proveBoundary = async () => true;
  assert.deepEqual(await switchFirstRoleEnvironment({ ...params, proveBoundary }), {
    environmentSha256: expected.afterSha256, alreadyApplied: false,
  });
  assert.deepEqual(readFileSync(environment), afterBytes);
  assert.ok((await switchFirstRoleEnvironment({ ...params, proveBoundary })).alreadyApplied);
  setPhase('ROLLBACK_STARTED');
  const restore = { ...params, action: 'restore', proveBoundary };
  const openIntent = path.join(reportDir, 'first-role-cutover-open-intent.json');
  writeFileSync(openIntent, '{}', { mode: 0o600 });
  await assert.rejects(switchFirstRoleEnvironment(restore), /UNPROVEN/);
  assert.deepEqual(readFileSync(environment), afterBytes);
  rmSync(openIntent);
  assert.deepEqual(await switchFirstRoleEnvironment(restore), { environmentSha256: expected.beforeSha256, alreadyApplied: false });
  assert.deepEqual(readFileSync(environment), original);
  assert.ok((await switchFirstRoleEnvironment(restore)).alreadyApplied);
}

if (process.argv[2] === 'exercise') {
  await exercise(process.argv[3]);
} else {
  test('configuration changes only the runtime role credentials and preserves the rest byte for byte', () => {
    const secret = Buffer.from(randomBytes(32).toString('base64url'));
    const original = Buffer.from('POSTGRES_USER=application_owner\r\nUNCHANGED=yes');
    const edited = withFirstRoleRuntimeEnvironment(original, secret);
    assert.deepEqual(edited.subarray(0, original.length), original);
    assert.match(edited.subarray(original.length).toString(), /^\r\nBACKEND_DATABASE_USER=sabalan_application_runtime\r\nBACKEND_DATABASE_PASSWORD=[\w-]{43}\r\n$/);
    assert.throws(() => withFirstRoleRuntimeEnvironment(edited, secret), /UNPROVEN/);
  });

  test('FD9-owned environment survives a lost boundary and restores the exact previous bytes on retry',
    { skip: process.platform !== 'linux' }, () => {
      const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'sabalan-host-environment-'));
      try {
        mkdirSync(path.join(root, '.deploy-state'), { mode: 0o700 });
        const result = spawnSync('sh', ['-eu', '-c', 'umask 077; exec 9>"$1/.deploy-state/deployment.lock"; flock -n 9; exec "$2" "$3" exercise "$1"',
          'fixture', root, process.execPath, fixtureFile], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
