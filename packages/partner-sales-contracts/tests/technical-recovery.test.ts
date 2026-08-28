import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalCheckpointSchema, PartnerTechnicalCheckpointReceiptSchema,
  PartnerTechnicalRecoveryViewSchema } from '@sabalanerp/partner-sales-contracts';

test('technical recovery wire preserves incomplete input but rejects actor authority, private fields and configuration refs', () => {
  const command = { schemaVersion: 1, recoveryId: 'draft', browserSessionId: 'browser', leaseToken: 'lease', baseRevision: 0,
    expectedRecoveryRevision: 0, idempotencyKey: 'request', draft: { schemaVersion: 1, inputRevision: 1, rows: [],
      editingValues: [{ entityId: 'row', field: 'quantity', text: '۲٫' }] } };
  assert.deepEqual(PartnerTechnicalCheckpointSchema.parse(JSON.parse(JSON.stringify(command))), command);
  for (const extension of [{ actorId: 'admin' }, { permissionContext: {} }, { graphHash: 'private' }, { privateEvidence: {} }]) {
    assert.equal(PartnerTechnicalCheckpointSchema.safeParse({ ...command, ...extension }).success, false);
  }
  const receipt = { schemaVersion: 1, recoveryId: 'draft', recoveryRevision: 1, inputRevision: 1,
    updatedAt: '2026-08-28T10:00:00.000Z', replayed: false };
  assert.deepEqual(PartnerTechnicalCheckpointReceiptSchema.parse(receipt), receipt);
  assert.equal(PartnerTechnicalCheckpointReceiptSchema.safeParse({ ...receipt, configurationRef: {} }).success, false);
  assert.equal(PartnerTechnicalRecoveryViewSchema.safeParse({ schemaVersion: 1, recoveryId: 'draft', recoveryRevision: 1,
    updatedAt: receipt.updatedAt, draft: command.draft, privateEvidence: {} }).success, false);
});
