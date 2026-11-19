import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use only the local PostgreSQL service. The fixture and role changes roll back together.
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const runtimeRoot = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || repositoryRoot;
assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'Use the local Docker context');
assert.ok(!process.env.COMPOSE_PROJECT_NAME || process.env.COMPOSE_PROJECT_NAME === 'sabalanerp-local');
const compose = ['compose', '-f', path.join(runtimeRoot, 'docker-compose.local.yml')];
const docker = (args, input) => execFileSync('docker', args, {
  cwd: runtimeRoot, input, encoding: 'utf8', timeout: 60_000,
});
const status = docker([...compose, 'ps', 'postgres', '--format', 'json']).trim();
const rows = status.startsWith('[') ? JSON.parse(status) : status.split(/\r?\n/).map(line => JSON.parse(line));
assert.ok(rows.some(row => row.Project === 'sabalanerp-local' && row.Name === 'sabalanerp-local-postgres-1'
  && row.Service === 'postgres' && row.State === 'running' && row.Health === 'healthy'));
const [context] = JSON.parse(docker(['context', 'inspect']));
assert.match(context.Endpoints.docker.Host, /^(?:npipe|unix):\/\//, 'Refuse remote Docker');

const migration = process.argv.includes('--baseline') ? '' : readFileSync(path.join(repositoryRoot,
  'backend/prisma/migrations/20261120125000_runtime_driver_assignment_permissions/migration.sql'), 'utf8');
const fixture = `driver-assignment-acl-${randomBytes(8).toString('hex')}`;
const assignments = ['driver_vehicle_assignments', 'external_driver_vehicle_assignments'];
const verifyAssignment = relation => `
  INSERT INTO public.${relation} (id, "driverId", "vehicleId", "effectiveFrom", reason, "recordedBy")
  VALUES ('${fixture}', '${fixture}', '${fixture}', '2026-01-01', 'fixture', '${fixture}')
  RETURNING id;
  SELECT id FROM public.${relation} WHERE id = '${fixture}' FOR SHARE;
  SELECT id FROM public.${relation} WHERE id = '${fixture}' FOR UPDATE;
  UPDATE public.${relation} SET "effectiveTo" = '2026-01-03' WHERE id = '${fixture}';
  UPDATE public.${relation} SET "effectiveTo" = '2026-01-02' WHERE id = '${fixture}';
  DO $verify$
  BEGIN
    IF NOT EXISTS (SELECT FROM public.${relation}
      WHERE id = '${fixture}' AND "effectiveTo" = '2026-01-02' AND reason = 'fixture') THEN
      RAISE EXCEPTION 'closing the assignment did not persist';
    END IF;
    BEGIN
      UPDATE public.${relation} SET reason = 'rewritten' WHERE id = '${fixture}';
      RAISE EXCEPTION 'runtime rewrote assignment evidence';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM <> 'Restricted runtime may update only the end of a driver assignment' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE public.${relation} SET "effectiveTo" = '2025-12-31' WHERE id = '${fixture}';
      RAISE EXCEPTION 'invalid assignment period was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      DELETE FROM public.${relation} WHERE id = '${fixture}';
      RAISE EXCEPTION 'runtime deleted an assignment';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END;
  $verify$;
`;
const result = docker([...compose, 'exec', '-T', 'postgres',
  'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'sabalanerp'], `
  BEGIN;
  SET LOCAL statement_timeout = '15s';
  SET LOCAL lock_timeout = '2s';
  ALTER ROLE sabalan_application_runtime NOLOGIN;
  GRANT USAGE ON SCHEMA public TO sabalan_application_runtime;
  GRANT SELECT ON public.driver_vehicle_assignments, public.external_driver_vehicle_assignments
    TO sabalan_application_runtime;
  SAVEPOINT dormant;
  ${migration}
  DO $dormant$
  BEGIN
    IF has_table_privilege('sabalan_application_runtime', 'public.driver_vehicle_assignments', 'INSERT, UPDATE')
      OR has_table_privilege('sabalan_application_runtime', 'public.external_driver_vehicle_assignments', 'INSERT, UPDATE') THEN
      RAISE EXCEPTION 'the dormant runtime received assignment writes';
    END IF;
  END;
  $dormant$;
  ROLLBACK TO SAVEPOINT dormant;

  ALTER ROLE sabalan_application_runtime LOGIN;
  SAVEPOINT corrected;
  GRANT INSERT, UPDATE ON public.driver_vehicle_assignments, public.external_driver_vehicle_assignments
    TO sabalan_application_runtime;
  ${migration}
  ROLLBACK TO SAVEPOINT corrected;

  ${migration && `
    SAVEPOINT unsafe_acl;
    GRANT UPDATE ("recordedBy") ON public.external_driver_vehicle_assignments TO sabalan_application_runtime;
    DO $unexpected_acl$
    BEGIN
      EXECUTE $embedded_migration$${migration}$embedded_migration$;
      RAISE EXCEPTION 'the split migration accepted a column grant';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'RUNTIME_DRIVER_ASSIGNMENT_ACL_UNEXPECTED: external_driver_vehicle_assignments' THEN RAISE; END IF;
    END;
    $unexpected_acl$;
    ROLLBACK TO SAVEPOINT unsafe_acl;
  `}
  ${migration}
  INSERT INTO public.personnel (id, "firstName", "lastName", "updatedAt")
    VALUES ('${fixture}', 'Test', 'Driver', CURRENT_TIMESTAMP);
  INSERT INTO public.internal_driver_profiles (id, "personnelId", "licenceNumber", "createdBy")
    VALUES ('${fixture}', '${fixture}', '${fixture}', '${fixture}');
  INSERT INTO public.company_vehicles (id, "fleetCode", "vehicleType", "createdBy")
    VALUES ('${fixture}', '${fixture}', 'TRUCK', '${fixture}');
  INSERT INTO public.external_drivers (id, "firstName", "lastName", "nationalCode", phone, "createdBy")
    VALUES ('${fixture}', 'Test', 'Driver', '${fixture}', '0000000000', '${fixture}');
  INSERT INTO public.external_vehicles (id, "vehicleType", "createdBy")
    VALUES ('${fixture}', 'TRUCK', '${fixture}');
  SET LOCAL ROLE sabalan_application_runtime;
  ${assignments.map(verifyAssignment).join('\n')}
  RESET ROLE;

  SET LOCAL search_path = pg_catalog;
  SELECT encode(sha256(convert_to(pg_get_functiondef(
    'public.protect_runtime_driver_assignment_identity()'::regprocedure), 'UTF8')), 'hex');
  SELECT tgrelid::regclass, tgname, tgtype, tgenabled, tgfoid::regprocedure
    FROM pg_trigger WHERE tgfoid = 'public.protect_runtime_driver_assignment_identity()'::regprocedure
    ORDER BY tgrelid::regclass::text;
  ROLLBACK;
`);
assert.equal(result.match(new RegExp(`^${fixture}$`, 'gm'))?.length, 6);
console.log(result.split(/\r?\n/).filter(line => line && line !== fixture).join('\n'));
console.log('Internal and external runtime assignment permissions verified.');
