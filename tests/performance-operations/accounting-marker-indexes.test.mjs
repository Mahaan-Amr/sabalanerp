import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const migration = new URL('../../backend/prisma/migrations/20260909070000_index_accounting_private_evidence/migration.sql', import.meta.url);
const path = '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")';

test('private-evidence indexes preserve nested markers and avoid repeated JSON scans', () => {
  // Only the existing local Compose database; all fixtures and indexes are TEMP
  // and rolled back. Never read a production URL or alter business tables.
  const state = spawnSync('docker', ['compose', '-f', 'docker-compose.local.yml', 'ps', '--format', 'json'], { cwd: root, encoding: 'utf8' });
  assert.equal(state.status, 0, state.stderr);
  assert.match(state.stdout, /sabalanerp-local-postgres-1/);
  const sql = `BEGIN;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE accounting_financial_records(id text, metadata jsonb, "sourceSnapshot" jsonb);
CREATE TEMP TABLE accounting_audit_logs(id text, "beforeState" jsonb, "afterState" jsonb);
CREATE TEMP TABLE accounting_receivables(id text, metadata jsonb);
CREATE TEMP TABLE accounting_payment_statuses(id text, metadata jsonb);
CREATE TEMP TABLE accounting_tax_records(id text, metadata jsonb);
INSERT INTO accounting_financial_records
SELECT i::text, CASE WHEN i % 7 = 0 THEN '{"partnerFact":false}'::jsonb ELSE '{}'::jsonb END,
jsonb_build_object('history', jsonb_build_array(jsonb_build_object('text', repeat(md5(i::text), 1000))))
FROM generate_series(1,1000) i;
INSERT INTO accounting_financial_records VALUES
('null-marker', NULL, '{"nested":[{"partnerCaseId":null}]}'),
('false-marker', '{"partnerPreparation":false}', NULL),
('array-marker', NULL, '[null,{"deep":{"sourceKind":"PARTNER_INTERNAL_RECORD"}}]'),
('hash-marker', NULL, '{"financialEvidenceHash":""}'),
('both-markers', '{"partnerFact":null}', '{"partnerReceivable":false}'),
('scalar', NULL, '42'), ('null', NULL, NULL);
INSERT INTO accounting_audit_logs SELECT id, metadata, "sourceSnapshot" FROM accounting_financial_records;
INSERT INTO accounting_receivables SELECT id, "sourceSnapshot" FROM accounting_financial_records;
INSERT INTO accounting_payment_statuses SELECT * FROM accounting_receivables;
INSERT INTO accounting_tax_records SELECT * FROM accounting_receivables;
${existsSync(migration) ? readFileSync(migration, 'utf8') : ''}
ANALYZE accounting_financial_records;
ANALYZE accounting_audit_logs;
ANALYZE accounting_receivables;
ANALYZE accounting_payment_statuses;
ANALYZE accounting_tax_records;
DO $test$
DECLARE differences integer; plan json; target record;
BEGIN
  SELECT count(*) INTO differences FROM accounting_financial_records
  WHERE (jsonb_build_array(metadata,"sourceSnapshot") @? '${path}'::jsonpath)
    IS DISTINCT FROM COALESCE((metadata @? '${path}'::jsonpath OR "sourceSnapshot" @? '${path}'::jsonpath), false);
  IF differences <> 0 THEN RAISE EXCEPTION 'Changed private-evidence classification'; END IF;
  IF (SELECT count(*) FROM accounting_financial_records WHERE metadata @? '${path}'::jsonpath OR "sourceSnapshot" @? '${path}'::jsonpath) <> 147
    THEN RAISE EXCEPTION 'Lost a null/false/nested private marker'; END IF;
  EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM accounting_financial_records
    WHERE metadata @? '${path}'::jsonpath OR "sourceSnapshot" @? '${path}'::jsonpath INTO plan;
  RAISE NOTICE 'Financial indexed plan: %', plan;
  IF plan::text NOT LIKE '%accounting_financial_private_evidence_idx%' THEN
    RAISE EXCEPTION 'REGRESSION: financial read still scans JSON documents'; END IF;
  EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM accounting_audit_logs
    WHERE "beforeState" @? '${path}'::jsonpath OR "afterState" @? '${path}'::jsonpath INTO plan;
  RAISE NOTICE 'Audit indexed plan: %', plan;
  IF plan::text NOT LIKE '%accounting_audit_private_evidence_idx%' THEN
    RAISE EXCEPTION 'REGRESSION: audit read still scans JSON documents'; END IF;
  FOR target IN SELECT * FROM (VALUES
    ('accounting_receivables','accounting_receivable_private_evidence_idx'),
    ('accounting_payment_statuses','accounting_payment_private_evidence_idx'),
    ('accounting_tax_records','accounting_tax_private_evidence_idx')) AS targets(table_name,index_name)
  LOOP
    EXECUTE format('EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM %I WHERE metadata @? %L::jsonpath',
      target.table_name, '${path}') INTO plan;
    IF position(target.index_name IN plan::text) = 0 THEN
      RAISE EXCEPTION 'REGRESSION: missing indexed plan for %', target.table_name; END IF;
  END LOOP;
END $test$;
ROLLBACK;`;
  const result = spawnSync('docker', ['exec', '-i', 'sabalanerp-local-postgres-1', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'sabalanerp'], { input: sql, encoding: 'utf8', maxBuffer: 2_000_000 });
  console.log(result.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ROLLBACK/);
});
