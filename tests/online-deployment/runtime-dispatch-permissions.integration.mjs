import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run against the existing seeded, pre-split local Compose PostgreSQL database.
// SQL runs in a single transaction which rolls back all fixtures, ACLs and DDL.
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const runtimeRoot = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || repositoryRoot;
assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'Use the local Docker context');
assert.ok(!process.env.COMPOSE_PROJECT_NAME || process.env.COMPOSE_PROJECT_NAME === 'sabalanerp-local');
const compose = ['compose', '-f', path.join(runtimeRoot, 'docker-compose.local.yml')];
const docker = (args, input) => execFileSync('docker', args, { cwd: runtimeRoot, input, encoding: 'utf8', timeout: 60_000 });
const [context] = JSON.parse(docker(['context', 'inspect']));
assert.match(context.Endpoints.docker.Host, /^(?:npipe|unix):\/\//, 'Refuse remote Docker');
const status = docker([...compose, 'ps', 'postgres', '--format', 'json']).trim();
const rows = status.startsWith('[') ? JSON.parse(status) : status.split(/\r?\n/).map(line => JSON.parse(line));
assert.ok(rows.some(row => row.Project === 'sabalanerp-local' && row.Name === 'sabalanerp-local-postgres-1'
  && row.Service === 'postgres' && row.State === 'running' && row.Health === 'healthy'));

const migration = name => readFileSync(path.join(repositoryRoot, 'backend/prisma/migrations', name, 'migration.sql'), 'utf8');
const referenceMigration = migration('20261120123000_protect_runtime_reference_row_locks');
const dispatchMigration = migration('20261120124000_runtime_dispatch_permissions');

const result = docker([...compose, 'exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'sabalanerp'], `
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='sabalan_application_runtime' AND NOT rolcanlogin)
    OR has_table_privilege('sabalan_application_runtime', 'public.logistics_loading_lines', 'SELECT, INSERT, UPDATE, DELETE')
    OR has_table_privilege('sabalan_application_runtime', 'public.shipment_quantity_evidence', 'SELECT, INSERT, UPDATE, DELETE')
    OR to_regprocedure('public.protect_runtime_reference_row()') IS NOT NULL
    OR NOT EXISTS (SELECT FROM public.project_addresses)
    OR NOT EXISTS (SELECT FROM public.contract_items WHERE "retiredAt" IS NULL) THEN
    RAISE EXCEPTION 'Use the seeded local database with an unsplit runtime and predecessor migrations';
  END IF;
END;
$preflight$;
INSERT INTO public.logistics_loadings (id, "loadingNumber", "customerId", "projectId", "createdBy", "updatedAt")
SELECT 'dispatch-acl-draft', 'dispatch-acl-draft', "customerId", id, 'dispatch-test', now() FROM public.project_addresses LIMIT 1;
INSERT INTO public.logistics_loadings (id, "loadingNumber", "customerId", "projectId", "createdBy", "updatedAt", status)
SELECT 'dispatch-acl-finalized', 'dispatch-acl-finalized', "customerId", id, 'dispatch-test', now(), 'FINALIZED' FROM public.project_addresses LIMIT 1;
GRANT USAGE ON SCHEMA public TO sabalan_application_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_loadings, public.contract_items TO sabalan_application_runtime;
GRANT SELECT, DELETE ON public.logistics_loading_lines TO sabalan_application_runtime;
GRANT SELECT, INSERT, DELETE ON public.shipment_quantity_evidence TO sabalan_application_runtime;
INSERT INTO public.shipment_quantity_evidence (
  id, "contractId", "contractItemId", "productRowId", unit, kind, quantity, "effectiveAt",
  "sourceType", "sourceId", "integrityHash"
)
SELECT 'dispatch-acl-evidence', "contractId", id, coalesce("productRowId", id), 'count', 'CONTRACTED_SET',
  2, now(), 'DISPATCH_ACL_FIXTURE', id, repeat('0', 64)
FROM public.contract_items WHERE "retiredAt" IS NULL LIMIT 1;

CREATE FUNCTION pg_temp.expect_rejection(command text, failure_code text, detail text) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  EXECUTE command;
  RAISE EXCEPTION 'expected rejection for %', command;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> failure_code OR position(detail IN SQLERRM) = 0 THEN RAISE; END IF;
END;
$test$;
${referenceMigration}
SAVEPOINT dormant;
${dispatchMigration}
DO $dormant$
BEGIN
  IF has_table_privilege('sabalan_application_runtime', 'public.logistics_loading_lines', 'INSERT, UPDATE')
    OR has_table_privilege('sabalan_application_runtime', 'public.shipment_quantity_evidence', 'UPDATE') THEN
    RAISE EXCEPTION 'dormant runtime received new privileges';
  END IF;
END;
$dormant$;
ROLLBACK TO SAVEPOINT dormant;
ALTER ROLE sabalan_application_runtime LOGIN;
SET LOCAL ROLE sabalan_application_runtime;
SELECT pg_temp.expect_rejection(
  $sql$INSERT INTO public.logistics_loading_lines (id) VALUES ('rejected-without-insert')$sql$,
  '42501', 'permission denied for table logistics_loading_lines');
SELECT pg_temp.expect_rejection($sql$UPDATE public.logistics_loading_lines SET quantity=0 WHERE false$sql$,
  '42501', 'permission denied for table logistics_loading_lines');
SELECT pg_temp.expect_rejection(
  $sql$SELECT id FROM public.shipment_quantity_evidence WHERE id='dispatch-acl-evidence' FOR UPDATE$sql$,
  '42501', 'permission denied for table shipment_quantity_evidence');
RESET ROLE;
${dispatchMigration}
SET LOCAL ROLE sabalan_application_runtime;
DO $green$
DECLARE inserted text;
DECLARE locked text;
BEGIN
  INSERT INTO public.logistics_loading_lines (id, "loadingId", "sourceContractId", "sourceContractItemId",
    "productId", quantity, unit, "khatRas", "pieceCount", plus, minus, "calculationSnapshot", "updatedAt")
  SELECT 'dispatch-acl-line', 'dispatch-acl-draft', "contractId", id, "productId", 2, 'count',
    1, 1, 1, 1, '{}'::jsonb, now()
  FROM public.contract_items WHERE "retiredAt" IS NULL LIMIT 1 RETURNING id INTO STRICT inserted;
  IF inserted <> 'dispatch-acl-line' THEN RAISE EXCEPTION 'loading line was not inserted'; END IF;

  UPDATE public.logistics_loading_lines
  SET quantity = 0, "khatRas" = NULL, "pieceCount" = NULL, plus = 0, minus = 0, "calculationSnapshot" = NULL, "updatedAt" = now()
  WHERE id = inserted RETURNING id INTO STRICT inserted;
  PERFORM pg_temp.expect_rejection(
    $sql$UPDATE public.logistics_loading_lines SET quantity = 7 WHERE id = 'dispatch-acl-line'$sql$,
    '42501', 'may only reset loading line quantities');
  PERFORM pg_temp.expect_rejection(
    $sql$UPDATE public.logistics_loading_lines SET notes = 'forged' WHERE id = 'dispatch-acl-line'$sql$,
    '42501', 'may only reset loading line quantities');
  PERFORM pg_temp.expect_rejection($sql$
    INSERT INTO public.logistics_loading_lines (id, "loadingId", "sourceContractId", "sourceContractItemId",
      "productId", quantity, unit, "updatedAt")
    SELECT 'denied-line', 'dispatch-acl-finalized', "sourceContractId", "sourceContractItemId", "productId",
      1, unit, now() FROM public.logistics_loading_lines WHERE id = 'dispatch-acl-line'
  $sql$, '42501', 'may only write draft loading lines');
  SELECT id INTO STRICT locked FROM public.shipment_quantity_evidence WHERE id = 'dispatch-acl-evidence' FOR UPDATE;
  PERFORM pg_temp.expect_rejection(format('UPDATE public.shipment_quantity_evidence SET id=id WHERE id=%L', locked),
    '42501', 'may lock this reference but may not update it');
  PERFORM pg_temp.expect_rejection(format('DELETE FROM public.shipment_quantity_evidence WHERE id=%L', locked),
    'P0001', 'append-only and immutable');
END;
$green$;
RESET ROLE;
UPDATE public.logistics_loadings SET status='FINALIZED' WHERE id='dispatch-acl-draft';
SET LOCAL ROLE sabalan_application_runtime;
SELECT pg_temp.expect_rejection(
  $sql$UPDATE public.logistics_loading_lines SET quantity=0 WHERE id='dispatch-acl-line'$sql$,
  '42501', 'may only write draft loading lines');
RESET ROLE;
ROLLBACK;
`);
assert.match(result, /ROLLBACK\s*$/);
console.log('Dispatch runtime permission regression checks passed.');
