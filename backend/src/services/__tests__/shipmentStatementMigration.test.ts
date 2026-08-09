import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = [
  '20260809000100_shipment_statement_data_contracts',
  '20260809000110_harden_shipment_statement_data_contracts',
].map((name) => readFileSync(resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`), 'utf8')).join('\n');

for (const destructiveStatement of [
  /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|SEQUENCE)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bUPDATE\s+("?[a-z_]+"?)\s+SET\b/i,
]) {
  assert.equal(destructiveStatement.test(migration), false, `migration contains ${destructiveStatement}`);
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
]) {
  assert.ok(migration.includes(requiredFragment), `migration is missing ${requiredFragment}`);
}

console.log('shipment statement migration tests passed');
