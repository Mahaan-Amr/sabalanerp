import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = [
  '20260809000100_shipment_statement_data_contracts',
  '20260809000110_harden_shipment_statement_data_contracts',
  '20260809000120_review_harden_shipment_statement_contracts',
  '20260809000130_add_stale_dispatch_candidate_status',
].map((name) => readFileSync(resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`), 'utf8')).join('\n');
const migrationWithoutReviewedNewIndexReplacement = migration.replace(
  'ALTER TABLE "dispatch_document_artifacts" DROP CONSTRAINT "dispatch_document_artifacts_sha256_key";',
  '-- reviewed replacement of a new feature-table index',
);

for (const destructiveStatement of [
  /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|SEQUENCE)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bUPDATE\s+("?[a-z_]+"?)\s+SET\b/i,
]) {
  assert.equal(destructiveStatement.test(migrationWithoutReviewedNewIndexReplacement), false, `migration contains ${destructiveStatement}`);
}

for (const requiredFragment of [
  'DECIMAL(18,3)',
  'DECIMAL(38,12)',
  'contract_approved_pricing_versions',
  'dispatch_priced_allocation_events',
  'dispatch_document_artifacts',
  'dispatch_document_print_handoffs',
  'shipment_statement_migration_evidence',
  "VALUES ('customer-shipment-statements', false)",
  'prevent_shipment_statement_evidence_change',
  'pricing row stable product identity differs from contract item',
  'priced event stable product identity differs from approved pricing row',
  'statement adjustment requires a posted correction',
  'dispatch_artifact_one_waybill',
  'DispatchDocumentCommandScope',
  "ADD VALUE IF NOT EXISTS 'STALE_REQUIRES_SUCCESSOR'",
]) {
  assert.ok(migration.includes(requiredFragment), `migration is missing ${requiredFragment}`);
}

console.log('shipment statement migration tests passed');
