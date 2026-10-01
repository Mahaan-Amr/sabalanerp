import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const migration = 'backend/prisma/migrations/20261001070000_index_scoped_accounting_private_evidence/migration.sql';
const markerPath = '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")';
// Exercise the composed runtime predicate, including its static literal used by
// generic prepared plans, so a later query/index mismatch fails this test.
const scopeSource = readFileSync('backend/src/services/partnerSales/accounting/readScope.ts', 'utf8');
const predicate = scopeSource.match(/WHERE (metadata @\? \$\{markerPath\} OR CASE[\s\S]*?\bEND)/)?.[1]
  .replaceAll('${markerPath}', `'${markerPath}'::jsonpath`);
assert.ok(predicate, 'Accounting scope marker predicate must be present');

test('current scoped marker predicate preserves ownership exceptions and uses its partial index', () => {
  const state = spawnSync('docker', ['compose', '-f', 'docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' });
  assert.equal(state.status, 0, state.stderr);
  assert.match(state.stdout, /sabalanerp-local-postgres-1/);
  const sql = `BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL plan_cache_mode=force_generic_plan;
CREATE TEMP TABLE accounting_financial_records(id text, metadata jsonb, "sourceSnapshot" jsonb,
  "sourceKind" text, "contractId" text, "sourceId" text);
INSERT INTO accounting_financial_records SELECT i::text, '{}'::jsonb,
  jsonb_build_object('partnerCaseId',NULL,'history',repeat(md5(i::text),1000)), 'SALES_CONTRACT',i::text,i::text
  FROM generate_series(1,1000) i;
INSERT INTO accounting_financial_records VALUES
  ('nested-null','{}','{"partnerCaseId":null,"nested":{"partnerCaseId":null}}','SALES_CONTRACT','c','c'),
  ('nested-false','{}','{"partnerCaseId":null,"nested":{"partnerPreparation":false}}','SALES_CONTRACT','c','c'),
  ('wrong-source','{}','{"partnerCaseId":null}','SALES_CONTRACT','c','different'),
  ('missing-contract','{}','{"partnerCaseId":null}','SALES_CONTRACT',NULL,NULL),
  ('non-null-owner','{}','{"partnerCaseId":"case"}','SALES_CONTRACT','c','c'),
  ('metadata-marker','{"partnerFact":false}','{"partnerCaseId":null}','SALES_CONTRACT','c','c'),
  ('array-marker','{}','[{"partnerCaseId":null}]','SALES_CONTRACT','c','c'),
  ('ordinary-no-owner','{}','{"customer":{}}','SALES_CONTRACT','c','c');
${existsSync(migration) ? readFileSync(migration, 'utf8') : ''}
ANALYZE accounting_financial_records;
PREPARE scoped_markers(text) AS SELECT id FROM accounting_financial_records WHERE (${predicate}) AND id <> $1;
DO $test$
DECLARE observed text[]; plan json;
BEGIN
 SELECT array_agg(id ORDER BY id) INTO observed FROM accounting_financial_records WHERE ${predicate};
 IF observed <> ARRAY['array-marker','metadata-marker','missing-contract','nested-false','nested-null','non-null-owner','wrong-source'] THEN
   RAISE EXCEPTION 'Ownership classification changed: %',observed; END IF;
 EXPLAIN (ANALYZE, FORMAT JSON) EXECUTE scoped_markers('unused') INTO plan;
 RAISE NOTICE 'Scoped marker plan: %',plan;
 IF plan::text NOT LIKE '%accounting_financial_scoped_private_evidence_idx%' THEN
   RAISE EXCEPTION 'REGRESSION: current scoped query still scans snapshots'; END IF;
 UPDATE accounting_financial_records SET metadata='{"nested":{"partnerFact":false}}' WHERE id='ordinary-no-owner';
 IF NOT EXISTS (SELECT 1 FROM accounting_financial_records WHERE (${predicate}) AND id='ordinary-no-owner') THEN
   RAISE EXCEPTION 'New private evidence did not update classification'; END IF;
END $test$;
ROLLBACK;`;
  const result = spawnSync('docker', ['exec', '-i', 'sabalanerp-local-postgres-1', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'sabalanerp'],
    { input: sql, encoding: 'utf8', maxBuffer: 2_000_000 });
  console.log(result.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ROLLBACK/);
});
