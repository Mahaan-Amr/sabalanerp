import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const runtimeRoot = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || root;
assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT);
assert.ok(!process.env.COMPOSE_PROJECT_NAME || process.env.COMPOSE_PROJECT_NAME === 'sabalanerp-local');
const compose = ['compose', '-f', path.join(runtimeRoot, 'docker-compose.local.yml')];
const docker = (args, input) => execFileSync('docker', args, {
  cwd: runtimeRoot, input, encoding: 'utf8', timeout: 60_000,
});
const status = docker([...compose, 'ps', 'postgres', '--format', 'json']).trim();
const services = status.startsWith('[') ? JSON.parse(status) : status.split(/\r?\n/).map(line => JSON.parse(line));
assert.ok(services.some(row => row.Project === 'sabalanerp-local' && row.Name === 'sabalanerp-local-postgres-1'
  && row.Service === 'postgres' && row.State === 'running' && row.Health === 'healthy'));
const [context] = JSON.parse(docker(['context', 'inspect']));
assert.match(context.Endpoints.docker.Host, /^(?:npipe|unix):\/\//);

const migrations = path.join(root, 'backend/prisma/migrations');
const reference = readFileSync(path.join(migrations, '20261120123000_protect_runtime_reference_row_locks/migration.sql'), 'utf8');
const candidate = readFileSync(path.join(migrations, '20261120126000_runtime_partner_receipt_permissions/migration.sql'), 'utf8');
const fixture = 'retail-receipt-acl-' + randomBytes(8).toString('hex');
const hash = 'sha256-v1:' + 'a'.repeat(64);
const result = docker([...compose, 'exec', '-T', 'postgres',
  'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'sabalanerp'], `
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
ALTER ROLE sabalan_application_runtime NOLOGIN;
${reference}
SAVEPOINT dormant;
${candidate}
DO $test$
BEGIN
  IF has_table_privilege('sabalan_application_runtime','public.partner_retail_receipt_allocations','INSERT')
    OR has_table_privilege('sabalan_application_runtime','public.partner_retail_receipts','UPDATE') THEN
    RAISE EXCEPTION 'Dormant role acquired receipt write grants';
  END IF;
END
$test$;
ROLLBACK TO SAVEPOINT dormant;
RELEASE SAVEPOINT dormant;
ALTER ROLE sabalan_application_runtime LOGIN;
GRANT USAGE ON SCHEMA public TO sabalan_application_runtime;
GRANT SELECT, INSERT ON partner_case_events, partner_payment_installments,
  partner_payment_plans, partner_retail_receipts TO sabalan_application_runtime;
GRANT SELECT ON partner_retail_receipt_allocations TO sabalan_application_runtime;
INSERT INTO users (id,email,username,password,"firstName","lastName",role,"updatedAt")
  VALUES ('${fixture}','${fixture}@example.invalid','${fixture}','!disabled','Schema','Fixture','USER',now());
INSERT INTO partner_profiles (id,"userId") VALUES ('${fixture}','${fixture}');
INSERT INTO partner_commercial_accounts (id,"profileId") VALUES ('${fixture}','${fixture}');
INSERT INTO crm_customers (id,"firstName","lastName","ownerUserId","updatedAt")
  VALUES ('${fixture}','Schema','Fixture','${fixture}',now());
INSERT INTO partner_sale_cases (id,"caseNumber","profileId","customerId","internalRecordId","customerContractId","headRevision","integrityHash")
  VALUES ('${fixture}','${fixture}','${fixture}','${fixture}','${fixture}-internal','${fixture}-customer',1,'${hash}');
INSERT INTO partner_case_revisions ("caseId",revision,"integrityHash","graphHash",graph,"partySnapshots","wholesaleEnvelope",
  "retailEnvelope","paymentEvidence","customerContent","internalProjection","customerProjection","actorId","commandId")
  VALUES ('${fixture}',1,'${hash}','${hash}','{}','{}','{}','{}','{}','{}','{}','{}','${fixture}','${fixture}');
INSERT INTO partner_payment_plans (id,"caseId","caseRevision",purpose,version,"effectiveDate",evidence,"integrityHash")
  VALUES ('${fixture}','${fixture}',1,'RETAIL',1,CURRENT_DATE,'{}','${hash}');
INSERT INTO partner_payment_installments (id,"planId","dueDate",amount,currency,method,evidence)
  VALUES ('${fixture}','${fixture}',CURRENT_DATE,100,'IRT','CASH','{}');
SAVEPOINT earlier_receipt;
INSERT INTO partner_retail_receipts (id,"caseId","planId",kind,amount,currency,"effectiveDate","actorId","commandId",evidence)
  VALUES ('${fixture}-original','${fixture}','${fixture}','RECEIPT',100,'IRT',CURRENT_DATE,'${fixture}','${fixture}-original','{}');
RELEASE SAVEPOINT earlier_receipt;
SET LOCAL ROLE sabalan_application_runtime;
DO $test$
BEGIN
  BEGIN
    SELECT id FROM partner_retail_receipts WHERE id = '${fixture}-original' FOR UPDATE;
    RAISE EXCEPTION 'Predecessor unexpectedly admitted the receipt lock';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;
RESET ROLE;
${candidate}
SET LOCAL ROLE sabalan_application_runtime;
SELECT id FROM partner_retail_receipts WHERE id = '${fixture}-original' FOR UPDATE;
INSERT INTO partner_retail_receipts (id,"caseId","planId",kind,"originalReceiptId",amount,currency,"effectiveDate","actorId","commandId",reason,evidence)
  VALUES ('${fixture}-reversal','${fixture}','${fixture}','REVERSAL','${fixture}-original',10,'IRT',CURRENT_DATE,'${fixture}','${fixture}-reversal','fixture','{}');
INSERT INTO partner_retail_receipt_allocations ("receiptId","planId","installmentId",amount)
  VALUES ('${fixture}-reversal','${fixture}','${fixture}',10);
SELECT amount FROM partner_retail_receipt_allocations WHERE "receiptId" = '${fixture}-reversal' FOR UPDATE;
DO $test$
BEGIN
  BEGIN
    INSERT INTO partner_retail_receipt_allocations ("receiptId","planId","installmentId",amount)
      VALUES ('${fixture}-original','${fixture}','${fixture}',1);
    RAISE EXCEPTION 'Older receipt accepted another allocation';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'Receipt allocations must be assembled in the receipt transaction' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE partner_retail_receipt_allocations SET amount = 9 WHERE "receiptId" = '${fixture}-reversal';
    RAISE EXCEPTION 'Receipt allocation was rewritten';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL;
  END;
END
$test$;
RESET ROLE;
COPY (SELECT pg_get_functiondef('public.protect_runtime_partner_receipt_assembly()'::regprocedure)) TO STDOUT
  WITH (FORMAT csv, FORCE_QUOTE *);
ROLLBACK;
`);
assert.match(result, new RegExp(fixture + '-original'));
assert.match(result, /^10(?:\.0+)?$/m);
const definitionCsv = result.slice(result.indexOf('"CREATE OR REPLACE FUNCTION')).trimEnd();
assert.ok(definitionCsv.startsWith('"CREATE OR REPLACE FUNCTION') && definitionCsv.endsWith('"'));
const definition = definitionCsv.slice(1, -1).replaceAll('""', '"').replace(/\r\n/g, '\n');
console.log('RECEIPT_ALLOCATION_RUNTIME_PASS', createHash('sha256').update(definition).digest('hex'));
