import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyProtectedDatabaseRoles, captureProtectedDatabaseRoles, promoteProtectedDatabaseStage, verifyPromotedProtectedDatabaseRoles } from '../protectedDatabaseRoleRecovery';

const { Client } = require('pg') as { Client: new (config: { connectionString: string }) => {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, values?: string[]): Promise<{ rows: Array<Record<string, unknown>> }>;
} };

const localUrl = process.env.SABALAN_ROLE_RECOVERY_TEST_DATABASE_URL;

test('protected staging recovers exact ACLs including security-definer revocations', { skip: !localUrl }, async () => {
  const base = new URL(localUrl!);
  assert.equal(base.hostname, '127.0.0.1');
  assert.equal(base.port, '55432');
  assert.equal(base.pathname, '/postgres');
  const suffix = randomBytes(6).toString('hex');
  const source = `sabalan_acl_source_${suffix}`;
  const target = `sabalan_acl_target_${suffix}`;
  const safety = `sabalan_safety_${suffix}`;
  const stage = `sabalan_restore_${suffix}`;
  const roles = { runtime: `sabalan_acl_runtime_${suffix}`, controller: `sabalan_acl_control_${suffix}` };
  const urlFor = (name: string) => new URL(`/${name}`, base).toString();
  const runtimeSecret = randomBytes(24).toString('hex');
  const runtimeUrl = new URL(urlFor(stage));
  runtimeUrl.username = roles.runtime;
  runtimeUrl.password = runtimeSecret;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${roles.runtime} LOGIN NOINHERIT PASSWORD '${runtimeSecret}'; CREATE ROLE ${roles.controller} NOINHERIT`);
    await admin.query(`CREATE DATABASE ${source}`);
    await admin.query(`CREATE DATABASE ${target}`);
    await admin.query(`CREATE DATABASE ${stage} CONNECTION LIMIT 0`);
    const createObjects = `
      CREATE TABLE public.business (id serial PRIMARY KEY);
      CREATE FUNCTION public.authority(text) RETURNS text LANGUAGE sql SECURITY DEFINER AS 'SELECT $1';
      CREATE FUNCTION public.authority(integer) RETURNS integer LANGUAGE sql AS 'SELECT $1';
      CREATE FUNCTION public.disable_public() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
    `;
    const sourceClient = new Client({ connectionString: urlFor(source) });
    await sourceClient.connect();
    try {
      await sourceClient.query(createObjects);
      await sourceClient.query(`
        INSERT INTO public.business DEFAULT VALUES;
        GRANT SELECT, INSERT ON public.business TO ${roles.runtime};
        GRANT USAGE ON SEQUENCE public.business_id_seq TO ${roles.runtime};
        REVOKE CONNECT, TEMPORARY ON DATABASE ${source} FROM PUBLIC;
        GRANT CONNECT ON DATABASE ${source} TO ${roles.runtime}, ${roles.controller};
        REVOKE EXECUTE ON FUNCTION public.authority(text), public.disable_public() FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION public.authority(text) TO ${roles.controller};
        REVOKE USAGE ON SCHEMA public FROM PUBLIC;
        GRANT USAGE ON SCHEMA public TO ${roles.runtime}, ${roles.controller};
      `);
    } finally { await sourceClient.end(); }
    const compose = ['compose', '-f', 'docker-compose.local.yml'];
    const services = execFileSync('docker', [...compose, 'ps'], { encoding: 'utf8' });
    assert.match(services, /sabalanerp-local-postgres-1.+healthy/);
    const captured = await captureProtectedDatabaseRoles(urlFor(source), roles, async snapshot => {
      assert.match(snapshot, /^[0-9A-F-]+$/i);
      // The dump must import the exact authenticated ACL snapshot.
      const concurrent = new Client({ connectionString: urlFor(source) });
      await concurrent.connect();
      try { await concurrent.query('INSERT INTO public.business DEFAULT VALUES'); }
      finally { await concurrent.end(); }
      const postgres = [...compose, 'exec', '-T', 'postgres'];
      const dump = execFileSync('docker', [...postgres, 'pg_dump', '-U', 'postgres', '-d', source,
        '--format=custom', '--no-owner', '--no-privileges', '--snapshot', snapshot]);
      execFileSync('docker', [...postgres, 'pg_restore', '-U', 'postgres', '-d', stage,
        '--no-owner', '--no-privileges', '--exit-on-error'], { input: dump });
    });
    const foreign = structuredClone(captured);
    foreign.objects.find(object => object.kind === 'TABLE')!.grants.push({
      grantee: roles.runtime, privilege: 'EXECUTE', grantable: false, grantor: captured.control,
    });
    await assert.rejects(applyProtectedDatabaseRoles(urlFor(stage), roles, foreign, source), /outside the protected role contract/);
    await assert.rejects(applyProtectedDatabaseRoles(urlFor(stage), roles, captured, 'different_source'), /snapshot identity/);
    await applyProtectedDatabaseRoles(urlFor(stage), roles, captured, source);
    const privateStage = new Client({ connectionString: runtimeUrl.toString() });
    try {
      await assert.rejects(privateStage.connect(), { code: '53300' });
    } finally { await privateStage.end(); }
    const db = new Client({ connectionString: urlFor(stage) });
    await db.connect();
    try {
      const { rows } = await db.query(`
        SELECT (SELECT count(*)::integer FROM public.business) AS exact_snapshot,
               has_schema_privilege($1, 'public', 'USAGE') AS schema_usage,
               has_schema_privilege($1, 'public', 'CREATE') AS schema_create,
               has_table_privilege($1, 'public.business', 'SELECT') AS business_read,
               has_table_privilege($1, 'public.business', 'DELETE') AS business_delete,
               has_sequence_privilege($1, 'public.business_id_seq', 'USAGE') AS sequence_use,
               has_database_privilege($1, current_database(), 'CONNECT') AS connect,
               has_database_privilege($1, current_database(), 'TEMPORARY') AS temp,
               has_function_privilege($1, 'public.authority(text)', 'EXECUTE') AS controller_denied,
               has_function_privilege($2, 'public.authority(text)', 'EXECUTE') AS controller_allowed,
               has_function_privilege($1, 'public.authority(integer)', 'EXECUTE') AS overload_allowed,
               has_function_privilege($2, 'public.disable_public()', 'EXECUTE') AS revoke_only
      `, [roles.runtime, roles.controller]);
      assert.deepEqual(rows, [{ exact_snapshot: 1, schema_usage: true, schema_create: false, business_read: true, business_delete: false, sequence_use: true, connect: true,
        temp: false, controller_denied: false, controller_allowed: true, overload_allowed: true, revoke_only: false }]);
    } finally { await db.end(); }
    await promoteProtectedDatabaseStage(urlFor(target), stage, safety);
    await verifyPromotedProtectedDatabaseRoles(urlFor(target), roles, captured, source);
    const drifted = structuredClone(captured);
    drifted.roles[0].connectionLimit = 5;
    await assert.rejects(verifyPromotedProtectedDatabaseRoles(urlFor(target), roles, drifted, source), /promoted role checkpoint identity/);
    runtimeUrl.pathname = `/${target}`;
    const promoted = new Client({ connectionString: runtimeUrl.toString() });
    await promoted.connect();
    try {
      assert.deepEqual((await promoted.query('SELECT id FROM public.business')).rows, [{ id: 1 }]);
      await assert.rejects(promoted.query("SELECT public.authority('denied'::text)"), { code: '42501' });
    } finally { await promoted.end(); }
    const driftedClient = new Client({ connectionString: urlFor(target) });
    await driftedClient.connect();
    try {
      await driftedClient.query(`GRANT DELETE ON public.business TO ${roles.runtime}`);
      await assert.rejects(verifyPromotedProtectedDatabaseRoles(urlFor(target), roles, captured, source), /promoted ACLs/);
    } finally { await driftedClient.end(); }
    runtimeUrl.pathname = `/${safety}`;
    const privateSafety = new Client({ connectionString: runtimeUrl.toString() });
    try {
      await assert.rejects(privateSafety.connect(), { code: '53300' });
    } finally { await privateSafety.end(); }
  } finally {
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${safety} WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS ${stage} WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS ${target} WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS ${source} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${roles.runtime}, ${roles.controller}`);
    } finally { await admin.end(); }
  }
});
