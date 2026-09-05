import assert from 'node:assert/strict';
import {
  CUSTOMER_SHIPMENT_STATEMENTS_GATE,
  SHIPMENT_STATEMENT_OPERATIONS_LOCK,
  isCustomerShipmentStatementsEnabled,
  isPostCutoverFinalization,
  isShipmentStatementFlowActive,
} from '../dispatchDocuments/featureGate';
import { compareMigrationEvidence } from '../dispatchDocuments/migrationManifest';
import { DISPATCH_DOCUMENT_COMMAND_SCOPES } from '../dispatchDocuments/contracts';
import { ACCOUNTING_DISPATCH_CANDIDATE_STATUSES } from '../dispatchDocuments/contracts';

assert.equal(CUSTOMER_SHIPMENT_STATEMENTS_GATE, 'CUSTOMER_SHIPMENT_STATEMENTS_ENABLED');
assert.equal(SHIPMENT_STATEMENT_OPERATIONS_LOCK, 'SHIPMENT_STATEMENT_OPERATIONS:customer-shipment-statements');
assert.equal(isCustomerShipmentStatementsEnabled({}), false);
assert.equal(isCustomerShipmentStatementsEnabled({ CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'false' }), false);
assert.equal(isCustomerShipmentStatementsEnabled({ CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'TRUE' }), false);
assert.equal(isCustomerShipmentStatementsEnabled({ CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' }), true);
assert.equal(isShipmentStatementFlowActive({}, null), false);
assert.equal(isShipmentStatementFlowActive(
  { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' },
  { enabled: false, cutoverAt: null, operationalPaused: true },
), false);
assert.equal(isShipmentStatementFlowActive(
  { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' },
  { enabled: true, cutoverAt: new Date('2026-08-09T12:00:00.000Z'), operationalPaused: false },
), true);
assert.equal(isShipmentStatementFlowActive(
  { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' },
  { enabled: true, cutoverAt: new Date('2026-08-09T12:00:00.000Z'), operationalPaused: true },
), false);

const cutoverAt = new Date('2026-08-09T12:00:00.000Z');
assert.equal(isPostCutoverFinalization(new Date('2026-08-09T11:59:59.999Z'), cutoverAt), false);
assert.equal(isPostCutoverFinalization(cutoverAt, cutoverAt), true);
assert.equal(isPostCutoverFinalization(new Date('2026-08-09T12:00:00.001Z'), cutoverAt), true);

const preserved = {
  scope: 'contract_items' as const,
  recordCount: '540',
  identityHash: 'identity-hash',
  quantityTotal: '25694.000',
  amountTotal: '32481345916.230000000000',
  evidenceHash: 'evidence-hash',
};
assert.deepEqual(compareMigrationEvidence(preserved, preserved).differences, []);
assert.deepEqual(compareMigrationEvidence(preserved, {
  ...preserved,
  quantityTotal: '25693.000',
  evidenceHash: 'changed-evidence-hash',
}).differences, ['QUANTITY_TOTAL', 'EVIDENCE_HASH']);
assert.deepEqual(DISPATCH_DOCUMENT_COMMAND_SCOPES, ['CANDIDATE', 'WAYBILL', 'CORRECTION', 'PRINT_HANDOFF']);
assert.deepEqual(ACCOUNTING_DISPATCH_CANDIDATE_STATUSES, [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'RETURNED',
  'WITHDRAWN',
  'STALE_REQUIRES_SUCCESSOR',
  'EVIDENCE_CONFLICT',
]);

console.log('dispatch document contract tests passed');
