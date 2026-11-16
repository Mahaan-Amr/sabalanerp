import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const compose = ['compose', '-f', 'docker-compose.local.yml', 'exec', '-T', 'postgres'];
function psql(sql, user = 'postgres') {
  return spawnSync('docker', [...compose, 'psql', '-U', user, '-d', 'sabalanerp', '-v', 'ON_ERROR_STOP=1', '-A', '-t'], {
    cwd: root, input: sql, encoding: 'utf8', timeout: 30_000,
  });
}

test('control-only role preparation stays passwordless and fails closed after no-ACL restore', { skip: process.env.SABALAN_LOCAL_ROLE_TEST !== '1' }, () => {
  const absent = psql("SELECT count(*) FROM pg_roles WHERE rolname = 'sabalan_application_runtime';");
  assert.equal(absent.status, 0, absent.stderr);
  assert.equal(absent.stdout.trim(), '0', 'test requires a fresh role name and never changes an existing role');
  try {
    const prepare = fs.readFileSync(new URL('../../deploy/sql/prepare-application-runtime-role.sql', import.meta.url), 'utf8');
    for (let n = 0; n < 2; n++) {
      const result = psql(prepare);
      assert.equal(result.status, 0, result.stderr);
    }
    const attributes = psql("SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolpassword IS NULL FROM pg_authid WHERE rolname='sabalan_application_runtime';");
    assert.equal(attributes.status, 0, attributes.stderr);
    assert.equal(attributes.stdout.trim().split('\n').at(-1), 'f|f|f|f|f|f|t');
    const login = psql('SELECT 1;', 'sabalan_application_runtime');
    assert.notEqual(login.status, 0, 'role must reject direct login');
    const audit = psql(fs.readFileSync(new URL('../../deploy/sql/audit-application-runtime-role.sql', import.meta.url), 'utf8'));
    assert.notEqual(audit.status, 0);
    assert.match(audit.stderr, /APPLICATION_RUNTIME_GRANT_MANIFEST_NOT_REVIEWED/);
    assert.match(audit.stdout, /_prisma_migrations/);
    assert.match(audit.stdout, /"business_grants_reviewed": false/);
  } finally {
    const drop = psql('DROP ROLE sabalan_application_runtime;');
    assert.equal(drop.status, 0, drop.stderr);
  }
});
