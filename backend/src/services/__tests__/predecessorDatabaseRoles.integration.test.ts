import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import path from 'node:path';
import test from 'node:test';
import { verifyPredecessorDatabaseRoles } from '../predecessorDatabaseRoles';
import { assertSabalanerpLocalPostgresTarget, createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

const source = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
const optIn = process.env.PREDECESSOR_DATABASE_ROLE_TEST_DIRECT_LOGIN === '1';
const role = 'sabalan_application_runtime';

test('the predecessor gate inspects the actual PostgreSQL runtime principal and denies protected grants',
  { skip: !source || !optIn, timeout: 240_000 }, async () => {
    const repositoryRoot = path.resolve(process.cwd(), '..');
    const localRoot = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || repositoryRoot;
    const compose = ['compose', '-f', path.join(localRoot, 'docker-compose.local.yml')];
    assertSabalanerpLocalPostgresTarget(execFileSync('docker', [...compose, 'ps', '--format', 'json', 'postgres'], { encoding: 'utf8' }));
    const fixture = await createTemporaryConcurrencyDatabase({ repositoryRoot, sourceDatabaseUrl: source!, migrateEmptySchema: true });
    const control = fixture.client();
    const lockDatabase = new URL(fixture.databaseUrl);
    lockDatabase.pathname = '/postgres';
    const { Client } = createRequire(path.join(repositoryRoot, 'package.json'))('pg');
    const lockClient = new Client({ connectionString: lockDatabase.href });
    const password = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 90_000).toISOString();
    const dormant = () => control.$queryRaw<Array<{ safe: boolean }>>`
      SELECT NOT (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)
        AND rolpassword IS NULL AND (rolvaliduntil IS NULL OR rolvaliduntil = 'infinity'::timestamptz)
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = r.oid OR member = r.oid) AS safe
      FROM pg_authid r WHERE rolname = ${role}
    `;
    let runtime: ChildProcessWithoutNullStreams | undefined;
    let configured = false;
    try {
      await lockClient.connect();
      const lock = await lockClient.query('SELECT pg_try_advisory_lock(456, 2) AS acquired');
      assert.equal(lock.rows[0].acquired, true);
      assert.deepEqual(await dormant(), [{ safe: true }]);
      await control.$executeRawUnsafe(`ALTER ROLE "${role}" LOGIN PASSWORD '${password}' VALID UNTIL '${expires}'`);
      configured = true;
      runtime = spawn('docker', [...compose, 'exec', '-T', 'postgres', 'sh', '-c',
        'read -r PGPASSWORD; export PGPASSWORD; exec psql -X -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$1" -d "$2"',
        'psql', role, fixture.databaseName]);
      const lines = createInterface({ input: runtime.stdout });
      const answer = new Promise<string>((resolve, reject) => {
        lines.once('line', resolve);
        runtime!.once('exit', () => reject(new Error('Fixture runtime PostgreSQL login failed.')));
      });
      runtime.stdin.write(password + '\nSELECT host(inet_client_addr());\n');
      assert.equal(await answer, '127.0.0.1');
      const gate = () => verifyPredecessorDatabaseRoles(control, 'postgres', '127.0.0.1');
      assert.deepEqual(await gate(), { control: 'owner', controller: 'dormant', runtime: 'restricted', allocation: 'closed' });
      await assert.rejects(verifyPredecessorDatabaseRoles(control, 'postgres', '127.0.0.2'), /PREDECESSOR_DATABASE_ROLES_UNPROVEN/);
      await control.$executeRaw`GRANT SELECT (id) ON public.deployment_operations TO sabalan_application_runtime`;
      await assert.rejects(gate(), /PREDECESSOR_DATABASE_ROLES_UNPROVEN/);
      await control.$executeRaw`REVOKE SELECT (id) ON public.deployment_operations FROM sabalan_application_runtime`;
      assert.equal((await gate()).runtime, 'restricted');
    } finally {
      try {
        if (runtime) {
          const closed = new Promise<void>(resolve => runtime!.once('close', () => resolve()));
          runtime.stdin.end();
          if (runtime.exitCode === null) await closed;
        }
        if (configured) {
          await control.$executeRawUnsafe(`ALTER ROLE "${role}" NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'`);
          assert.deepEqual(await dormant(), [{ safe: true }]);
        }
      } finally {
        await lockClient.end();
        await control.$disconnect();
        await fixture.cleanup();
      }
    }
  });
