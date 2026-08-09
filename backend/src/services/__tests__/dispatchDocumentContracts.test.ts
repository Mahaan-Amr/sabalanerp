import assert from 'node:assert/strict';
import {
  CUSTOMER_SHIPMENT_STATEMENTS_GATE,
  isCustomerShipmentStatementsEnabled,
  isPostCutoverFinalization,
  isShipmentStatementFlowActive,
} from '../dispatchDocuments/featureGate';
import { compareMigrationEvidence } from '../dispatchDocuments/migrationManifest';
import { DISPATCH_DOCUMENT_COMMAND_SCOPES } from '../dispatchDocuments/contracts';

assert.equal(CUSTOMER_SHIPMENT_STATEMENTS_GATE, 'CUSTOMER_SHIPMENT_STATEMENTS_ENABLED');
assert.equal(isCustomerShipmentStatementsEnabled({}), false);
assert.equal(isCustomerShipmentStatementsEnabled({ CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'false' }), false);
assert.equal(isCustomerShipmentStatementsEnabled({ CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'TRUE' }), false);
assert.equal(isCustomerShipmentStatementsEnabled({ CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' }), true);
assert.equal(isShipmentStatementFlowActive({}, null), false);
assert.equal(isShipmentStatementFlowActive(
  { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' },
  { enabled: false, cutoverAt: null },
), false);
assert.equal(isShipmentStatementFlowActive(
  { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' },
  { enabled: true, cutoverAt: new Date('2026-08-09T12:00:00.000Z') },
), true);

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

console.log('dispatch document contract tests passed');
