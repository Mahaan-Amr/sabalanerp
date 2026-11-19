import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
const candidate = readFileSync(path.join(migrations, '20261120127000_runtime_partner_inquiry_evidence_locks/migration.sql'), 'utf8');
const fixture = 'inquiry-lock-' + randomBytes(8).toString('hex');
const hash = 'sha256-v1:' + 'a'.repeat(64);
const evidence = [
  'partner_conversion_dispositions',
  'partner_inquiry_approvals',
  'partner_inquiry_assignments',
  'partner_profile_responder_assignments',
  'sales_contract_draft_audits',
  'sales_contract_seller_audits',
];
const evidenceList = evidence.join(', ');
const evidenceArray = evidence.map(relation => "'" + relation + "'").join(', ');

function pricingLock(usageTable) {
  return `SELECT a.id FROM ${usageTable} u
    JOIN partner_inquiry_approvals a ON a.id = u."approvalId"
    JOIN partner_inquiry_rows r ON r.id = a."rowId"
    WHERE u."caseId" = '${fixture}' AND u."caseRevision" = 1
    ORDER BY a.id FOR UPDATE OF a, r`;
}

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
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY[${evidenceArray}] LOOP
    IF has_table_privilege('sabalan_application_runtime', 'public.' || relation, 'UPDATE') THEN
      RAISE EXCEPTION 'Dormant role acquired UPDATE on %', relation;
    END IF;
  END LOOP;
END
$test$;
ROLLBACK TO SAVEPOINT dormant;
RELEASE SAVEPOINT dormant;
ALTER ROLE sabalan_application_runtime LOGIN;
GRANT USAGE ON SCHEMA public TO sabalan_application_runtime;
GRANT SELECT, INSERT ON ${evidenceList} TO sabalan_application_runtime;
GRANT SELECT, INSERT, UPDATE ON partner_inquiry_rows TO sabalan_application_runtime;
GRANT SELECT, INSERT ON partner_inquiry_events, partner_inquiry_usages, partner_material_inquiry_usages
  TO sabalan_application_runtime;

INSERT INTO users (id,email,username,password,"firstName","lastName",role,"updatedAt") VALUES
  ('${fixture}','${fixture}@example.invalid','${fixture}','!disabled','Schema','Fixture','USER',now()),
  ('${fixture}-responder','${fixture}-responder@example.invalid','${fixture}-responder','!disabled','Schema','Responder','USER',now());
INSERT INTO partner_profiles (id,"userId") VALUES ('${fixture}','${fixture}');
INSERT INTO partner_inquiries (id,"profileId") VALUES ('${fixture}','${fixture}');
INSERT INTO partner_inquiry_rows (id,"inquiryId",version,"configurationHash",definition,outcome)
  VALUES ('${fixture}','${fixture}',1,'${hash}','{}','APPROVED');
INSERT INTO partner_inquiry_assignments (id,"inquiryId",revision,"responderId","actorId",reason,"eligibilityEvidence")
  VALUES ('${fixture}','${fixture}',1,'${fixture}-responder','${fixture}','fixture','{}');
INSERT INTO partner_profile_responder_assignments (id,"profileId",revision,"responderId","actorId",reason,"eligibilityEvidence")
  VALUES ('${fixture}','${fixture}',1,'${fixture}-responder','${fixture}','fixture','{}');
INSERT INTO partner_inquiry_approvals (id,"rowId","assignmentId","actorId","commandId","authorizationEvidenceId","wholesaleUnitPrice",currency,"evidenceHash")
  VALUES ('${fixture}','${fixture}','${fixture}','${fixture}-responder','${fixture}','${fixture}',100,'IRT','${hash}');
INSERT INTO partner_conversion_dispositions (id,"profileId","sourceType","sourceId",disposition,"actorId","successorId",evidence)
  VALUES ('${fixture}','${fixture}','INQUIRY_RESPONDER','${fixture}','TRANSFERRED','${fixture}','${fixture}-responder','{}');
INSERT INTO sales_contract_draft_audits (id,"draftId","ownerUserId",action)
  VALUES ('${fixture}','${fixture}','${fixture}','DISCARDED');
INSERT INTO departments (id,name,"namePersian","updatedAt") VALUES ('${fixture}','${fixture}','${fixture}',now());
INSERT INTO crm_customers (id,"firstName","lastName","ownerUserId","updatedAt")
  VALUES ('${fixture}','Schema','Fixture','${fixture}',now());
INSERT INTO sales_contracts
  (id,"contractNumber",title,"titlePersian",content,"customerId","departmentId","createdBy","responsibleSellerId","updatedAt")
  VALUES ('${fixture}','${fixture}','Fixture','Fixture','Fixture','${fixture}','${fixture}','${fixture}-responder','${fixture}-responder',now());
INSERT INTO sales_contract_seller_audits (id,"contractId","changedBy","changeType",reason)
  VALUES ('${fixture}','${fixture}','${fixture}-responder','RESPONSIBILITY_REASSIGNED','fixture');
INSERT INTO partner_sale_cases (id,"caseNumber","profileId","customerId","internalRecordId","customerContractId","headRevision","integrityHash")
  VALUES ('${fixture}','${fixture}','${fixture}','${fixture}','${fixture}-internal','${fixture}-customer',1,'${hash}');
INSERT INTO partner_case_revisions ("caseId",revision,"integrityHash","graphHash",graph,"partySnapshots","wholesaleEnvelope",
  "retailEnvelope","paymentEvidence","customerContent","internalProjection","customerProjection","actorId","commandId")
  VALUES ('${fixture}',1,'${hash}','${hash}','{}','{}','{}','{}','{}','{}','{}','{}','${fixture}','${fixture}');
INSERT INTO partner_product_rows (id,"caseId") VALUES ('${fixture}','${fixture}');
INSERT INTO partner_case_row_bindings ("caseId",revision,"productRowId","configurationHash",quantity,unit,"precisionPolicyVersion")
  VALUES ('${fixture}',1,'${fixture}','${hash}',1,'m','measured-v1');
INSERT INTO partner_inquiry_usages (id,"caseId","caseRevision","productRowId","approvalId","approvalSnapshot","evidenceHash")
  VALUES ('${fixture}','${fixture}',1,'${fixture}','${fixture}','{}','${hash}');
INSERT INTO partner_material_inquiry_usages (id,"caseId","caseRevision","pricingSubjectId","approvalId","approvalSnapshot","evidenceHash")
  VALUES ('${fixture}','${fixture}',1,'${fixture}','${fixture}','{}','${hash}');

SET LOCAL ROLE sabalan_application_runtime;
DO $test$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY[${evidenceArray}] LOOP
    BEGIN
      EXECUTE format('SELECT id FROM public.%I WHERE id = $1 FOR UPDATE', relation) USING '${fixture}';
      RAISE EXCEPTION 'Predecessor unexpectedly admitted the lock on %', relation;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END
$test$;
RESET ROLE;
${candidate}

SET LOCAL ROLE sabalan_application_runtime;
SELECT id FROM partner_conversion_dispositions WHERE id = '${fixture}' FOR UPDATE;
SELECT id FROM partner_profile_responder_assignments WHERE "profileId" = '${fixture}' ORDER BY revision FOR UPDATE;
SELECT id FROM partner_inquiry_assignments WHERE "inquiryId" = '${fixture}' ORDER BY revision FOR UPDATE;
SELECT id FROM sales_contract_draft_audits WHERE "draftId" = '${fixture}' FOR UPDATE;
SELECT id FROM sales_contract_seller_audits WHERE "contractId" = '${fixture}' FOR UPDATE;
${pricingLock('partner_inquiry_usages')};
${pricingLock('partner_material_inquiry_usages')};

DO $test$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['partner_inquiry_events', 'partner_inquiry_usages', 'partner_material_inquiry_usages'] LOOP
    IF has_table_privilege(current_user, 'public.' || relation, 'UPDATE') THEN
      RAISE EXCEPTION 'Unexpected UPDATE on %', relation;
    END IF;
  END LOOP;
  FOREACH relation IN ARRAY ARRAY[${evidenceArray}] LOOP
    IF NOT has_table_privilege(current_user, 'public.' || relation, 'SELECT')
      OR NOT has_table_privilege(current_user, 'public.' || relation, 'INSERT')
      OR has_table_privilege(current_user, 'public.' || relation, 'DELETE')
      OR has_table_privilege(current_user, 'public.' || relation, 'TRUNCATE') THEN
      RAISE EXCEPTION 'Unexpected evidence privileges on %', relation;
    END IF;
    BEGIN
      EXECUTE format('UPDATE public.%I SET id = id WHERE id = $1', relation) USING '${fixture}';
      RAISE EXCEPTION 'Runtime rewrote evidence on %', relation;
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
      IF SQLERRM NOT IN ('Partner evidence is append-only', 'Restricted runtime may lock this reference but may not update it') THEN
        RAISE;
      END IF;
    END;
  END LOOP;
END
$test$;
INSERT INTO sales_contract_draft_audits (id,"draftId","ownerUserId",action)
  VALUES ('${fixture}-fresh','${fixture}','${fixture}','DISCARDED');
RESET ROLE;
UPDATE sales_contract_seller_audits SET reason = 'owner path preserved' WHERE id = '${fixture}';
SELECT rel.relname FROM pg_trigger trigger
  JOIN pg_class rel ON rel.oid = trigger.tgrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public' AND rel.relname IN (${evidenceArray})
    AND trigger.tgname = 'restrict_runtime_reference_update' AND trigger.tgenabled = 'O'
    AND NOT trigger.tgisinternal AND trigger.tgtype = 19
    AND trigger.tgfoid = 'public.protect_runtime_reference_row()'::regprocedure
  ORDER BY rel.relname;
ROLLBACK;
`);
assert.deepEqual(result.trim().split(/\r?\n/), [...Array(7).fill(fixture), ...evidence]);
console.log('PARTNER_INQUIRY_EVIDENCE_RUNTIME_PASS', ...evidence);
