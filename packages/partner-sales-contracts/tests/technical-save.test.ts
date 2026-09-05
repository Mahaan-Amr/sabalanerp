import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalSaveSchema, PartnerTechnicalSaveReceiptSchema } from '@sabalanerp/partner-sales-contracts';

test('validated-save wire binds exact recovery references and canonical measures without granting pricing or actor authority', () => {
  const command = { schemaVersion: 1, recoveryId: 'draft', browserSessionId: 'browser', leaseToken: 'lease', baseRevision: 0,
    expectedRecoveryRevision: 0, idempotencyKey: 'save', draft: { schemaVersion: 1, inputRevision: 1, rows: [] } };
  assert.deepEqual(PartnerTechnicalSaveSchema.parse(command), command);
  const receipt = { schemaVersion: 1, recoveryId: 'draft', recoveryRevision: 1, inputRevision: 1,
    graphHash: `sha256-v1:${'a'.repeat(64)}`, updatedAt: '2026-08-28T10:00:00.000Z', replayed: false, rows: [{
      configurationRef: { recoveryId: 'draft', recoveryRevision: 1, productRowId: 'row-a' },
      quantity: '2.5', unit: 'ton', configurationChange: 'NEW',
    }] };
  assert.deepEqual(PartnerTechnicalSaveReceiptSchema.parse(receipt), receipt);
  for (const extension of [{ actorId: 'admin' }, { graph: {} }, { configurationHash: 'private' }, { approved: true }]) {
    assert.equal(PartnerTechnicalSaveSchema.safeParse({ ...command, ...extension }).success, false);
    assert.equal(PartnerTechnicalSaveReceiptSchema.safeParse({ ...receipt, ...extension }).success, false);
  }
  for (const rows of [[], [receipt.rows[0], receipt.rows[0]], [{ ...receipt.rows[0], quantity: '0' }],
    [{ ...receipt.rows[0], unit: 'count', quantity: '2.5' }],
    [{ ...receipt.rows[0], configurationRef: { ...receipt.rows[0].configurationRef, recoveryRevision: 2 } }],
    [{ ...receipt.rows[0], configurationRef: { ...receipt.rows[0].configurationRef, recoveryId: 'other' } }],
    [{ ...receipt.rows[0], wholesalePrice: '12345' }]]) {
    assert.equal(PartnerTechnicalSaveReceiptSchema.safeParse({ ...receipt, rows }).success, false);
  }
});
