import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run with node tests/online-deployment/performance-disclosure-runtime.integration.mjs.
// Reuse the existing local PostgreSQL service and clone its schema without data.
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const runtimeRoot = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || repositoryRoot;
assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'Use the local Docker context');
assert.ok(!process.env.COMPOSE_PROJECT_NAME || process.env.COMPOSE_PROJECT_NAME === 'sabalanerp-local');
const compose = ['compose', '-f', path.join(runtimeRoot, 'docker-compose.local.yml')];
const docker = (args, input) => execFileSync('docker', args, { cwd: runtimeRoot, input,
  encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
const preflight = () => {
  const status = docker([...compose, 'ps', 'postgres', '--format', 'json']).trim();
  const rows = status.startsWith('[') ? JSON.parse(status) : status.split(/\r?\n/).map(line => JSON.parse(line));
  assert.ok(rows.some(row => row.Project === 'sabalanerp-local' && row.Name === 'sabalanerp-local-postgres-1'
    && row.Service === 'postgres' && row.State === 'running' && row.Health === 'healthy'));
};
preflight();
const [context] = JSON.parse(docker(['context', 'inspect']));
assert.match(context.Endpoints.docker.Host, /^(?:npipe|unix):\/\//, 'Refuse remote Docker');
const inPostgres = (args, input) => {
  preflight();
  return docker([...compose, 'exec', '-T', 'postgres', ...args], input);
};
const psql = (database, input) => inPostgres(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], input);
const database = `sabalanerp_disclosure_${randomBytes(8).toString('hex')}`;
const migration = readFileSync(path.join(repositoryRoot, 'backend/prisma/migrations',
  '20261120122000_protect_runtime_disclosure_revision/migration.sql'), 'utf8');
const expectRed = `SELECT pg_temp.expect_error(
  'UPDATE public.users SET "isActive" = false WHERE id = ''fixture-user''',
  '42501', 'permission denied for table performance_disclosure_revision');`;

psql('postgres', `CREATE DATABASE "${database}"`);
try {
  const schema = inPostgres(['pg_dump', '-U', 'postgres', '--schema-only', '--no-owner', '--no-privileges', '-d', 'sabalanerp']);
  psql(database, schema);
  const result = psql(database, `
    BEGIN;
    SET LOCAL statement_timeout = '15s';
    SET LOCAL lock_timeout = '2s';
    INSERT INTO public.performance_disclosure_revision (id, revision) VALUES (1, 10);
    INSERT INTO public.users (id, email, username, password, "firstName", "lastName", "updatedAt")
    VALUES ('fixture-user', 'disclosure-role@example.invalid', 'disclosure-role', 'fixture', 'Test', 'User', CURRENT_TIMESTAMP);
    GRANT USAGE ON SCHEMA public TO sabalan_application_runtime;
    GRANT SELECT, UPDATE ON public.users TO sabalan_application_runtime;
    GRANT SELECT ON public.performance_disclosure_revision TO sabalan_application_runtime;
    GRANT SELECT, INSERT ON public.performance_feature_phase_versions, public.performance_policy_versions TO sabalan_application_runtime;
    GRANT SELECT ON public.performance_safety_pauses, public.performance_cohort_members TO sabalan_application_runtime;
    CREATE TEMP TABLE performance_policy_versions (id text);
    CREATE TRIGGER performance_canonical_write_fence BEFORE INSERT ON pg_temp.performance_policy_versions
      FOR EACH ROW EXECUTE FUNCTION public.performance_guard_canonical_write();
    GRANT INSERT ON pg_temp.performance_policy_versions TO sabalan_application_runtime;
    CREATE FUNCTION pg_temp.expect_error(statement text, code text, detail text) RETURNS void LANGUAGE plpgsql AS $expect$
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'expected error % for %', code, statement;
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE <> code OR position(detail IN SQLERRM) = 0 THEN RAISE; END IF;
    END;
    $expect$;
    ALTER ROLE sabalan_application_runtime NOLOGIN;
    SET LOCAL ROLE sabalan_application_runtime;
    ${expectRed}
    RESET ROLE;
    ${migration}
    SET LOCAL ROLE sabalan_application_runtime;
    ${expectRed}
    RESET ROLE;
    ALTER ROLE sabalan_application_runtime LOGIN;
    ${migration}
    DO $verify_acl$
    BEGIN
      IF has_table_privilege('sabalan_application_runtime', 'public.performance_disclosure_revision', 'INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        OR has_function_privilege('sabalan_application_runtime', 'public.performance_guard_canonical_write()', 'EXECUTE')
        OR has_function_privilege('sabalan_allocation_controller', 'public.performance_guard_canonical_write()', 'EXECUTE') THEN
        RAISE EXCEPTION 'disclosure migration granted additional privileges';
      END IF;
    END;
    $verify_acl$;
    SELECT pg_temp.expect_error('UPDATE public.performance_disclosure_revision SET "firstCanonicalTable" = ''partial''',
      'P0001', 'evidence must be established together');
    SET LOCAL ROLE sabalan_application_runtime;
    DO $verify_write$
    DECLARE active boolean; observed bigint;
    BEGIN
      UPDATE public.users SET "isActive" = false WHERE id = 'fixture-user' RETURNING "isActive" INTO STRICT active;
      IF active THEN RAISE EXCEPTION 'runtime deactivation did not persist'; END IF;
      SELECT revision INTO STRICT observed FROM public.performance_disclosure_revision FOR UPDATE;
      IF observed <> 11 THEN RAISE EXCEPTION 'deactivation did not advance revision once'; END IF;
    END;
    $verify_write$;
    UPDATE public.performance_disclosure_revision SET revision = revision;
    UPDATE public.performance_disclosure_revision SET revision = revision + 1;
    SELECT pg_temp.expect_error('UPDATE public.performance_disclosure_revision SET id = 2', 'P0001', 'singleton is immutable');
    SELECT pg_temp.expect_error('UPDATE public.performance_disclosure_revision SET revision = revision - 1', 'P0001', 'increase by one');
    SELECT pg_temp.expect_error('UPDATE public.performance_disclosure_revision SET revision = revision + 2', 'P0001', 'increase by one');
    SELECT pg_temp.expect_error($forged$UPDATE public.performance_disclosure_revision SET "firstCanonicalWriteAt" = now(),
        "firstCanonicalTable" = 'fabricated', "firstCanonicalIdHash" = repeat('0', 64)$forged$,
      '42501', 'only the disclosure relation owner');
    SELECT pg_temp.expect_error('INSERT INTO pg_temp.performance_policy_versions VALUES (''fabricated'')',
      '42501', 'unexpected canonical trigger');
    SELECT pg_temp.expect_error($insert$
      INSERT INTO public.performance_policy_versions (id, "policyKind", version, "contentHash", "createdByUserId")
        VALUES ('fixture-policy', 'RETENTION', 1, 'fixture', 'fixture-user')
    $insert$, 'P0001', 'PERFORMANCE_RELEASE_DISABLED');
    DO $verify_unestablished$
    BEGIN
      IF NOT EXISTS (SELECT FROM public.performance_disclosure_revision WHERE id = 1 AND revision = 12
        AND "firstCanonicalWriteAt" IS NULL AND "firstCanonicalTable" IS NULL AND "firstCanonicalIdHash" IS NULL) THEN
        RAISE EXCEPTION 'denied writes changed disclosure evidence';
      END IF;
    END;
    $verify_unestablished$;
    INSERT INTO public.performance_feature_phase_versions
      (id, version, phase, "releaseEnabled", reason, "effectiveFrom", "recordedByUserId")
    VALUES ('fixture-phase', 1, 'POLICY_DARK_LAUNCH', true, 'fixture', CURRENT_TIMESTAMP, 'fixture-user');
    INSERT INTO public.performance_policy_versions (id, "policyKind", version, "contentHash", "createdByUserId")
      VALUES ('fixture-policy', 'RETENTION', 1, 'fixture', 'fixture-user');
    DO $verify_evidence$
    BEGIN
      IF NOT EXISTS (SELECT FROM public.performance_disclosure_revision WHERE id = 1 AND "firstCanonicalWriteAt" IS NOT NULL
        AND "firstCanonicalTable" = 'performance_policy_versions'
        AND "firstCanonicalIdHash" = encode(sha256(convert_to('fixture-policy', 'UTF8')), 'hex')) THEN
        RAISE EXCEPTION 'canonical mutation failed to establish first-write evidence';
      END IF;
    END;
    $verify_evidence$;
    SELECT pg_temp.expect_error('UPDATE public.performance_disclosure_revision SET "firstCanonicalWriteAt" = NULL',
      'P0001', 'first-write evidence is immutable');
    SELECT pg_temp.expect_error($disable$
      INSERT INTO public.performance_feature_phase_versions
        (id, version, phase, "releaseEnabled", "predecessorId", reason, "effectiveFrom", "recordedByUserId")
      VALUES ('fixture-disable', 2, 'POLICY_DARK_LAUNCH', false, 'fixture-phase', 'fixture', CURRENT_TIMESTAMP, 'fixture-user')
    $disable$, 'P0001', 'PERFORMANCE_FIX_FORWARD_REQUIRED');
    RESET ROLE;
    INSERT INTO public.performance_safety_pauses (id, "phaseVersionId", scope, "reasonCode", reason)
      VALUES ('fixture-pause', 'fixture-phase', 'ALL', 'INTEGRITY_MISMATCH', 'fixture');
    SET LOCAL ROLE sabalan_application_runtime;
    SELECT pg_temp.expect_error($paused$
      INSERT INTO public.performance_policy_versions (id, "policyKind", version, "contentHash", "createdByUserId")
        VALUES ('fixture-paused-policy', 'RETENTION', 2, 'fixture', 'fixture-user')
    $paused$, 'P0001', 'PERFORMANCE_SAFETY_PAUSED');
    SELECT 'Restricted disclosure regression passed' AS result;
    ROLLBACK;
  `);
  assert.match(result, /Restricted disclosure regression passed/);
  console.log('Restricted disclosure regression passed');
} finally {
  psql('postgres', `DROP DATABASE "${database}"`);
}
