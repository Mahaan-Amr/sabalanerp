import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalCheckpointSchema, PartnerTechnicalCheckpointReceiptSchema,
  PartnerTechnicalLeaseRequestSchema, PartnerTechnicalLeaseReceiptSchema,
  PartnerTechnicalRecoveryViewSchema } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';

test('recovery returns only public retained catalog evidence for editing a returned row', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const view = PartnerTechnicalRecoveryViewSchema.parse({ schemaVersion: 1, recoveryId: 'returned',
    recoveryRevision: 2, updatedAt: '2026-09-24T00:00:00.000Z', draft: null,
    mandatoryDefaults: { enabled: true, percentage: '25' }, retainedCatalog: catalog });
  assert.equal(view.retainedCatalog?.products[0].catalogSnapshotVersion,
    catalog.products[0].catalogSnapshotVersion);
  assert.equal(PartnerTechnicalRecoveryViewSchema.safeParse({ ...view,
    retainedCatalog: { ...catalog, privateRates: ['secret'] } }).success, false);
});

test('technical recovery wire preserves incomplete input but rejects actor authority, private fields and configuration refs', () => {
  const lease = { schemaVersion: 1 as const, recoveryId: 'draft', browserSessionId: 'browser',
    baseRevision: 0, takeover: false };
  assert.deepEqual(PartnerTechnicalLeaseRequestSchema.parse(lease), lease);
  assert.equal(PartnerTechnicalLeaseRequestSchema.safeParse({ ...lease, purpose: 'PARTNER_TECHNICAL' }).success, false,
    'the browser cannot select trusted session provenance');
  const acquired = { schemaVersion: 1 as const, recoveryId: 'draft', browserSessionId: 'browser',
    leaseToken: 'lease', baseRevision: 0, updatedAt: '2026-08-28T10:00:00.000Z', takenOver: false };
  assert.deepEqual(PartnerTechnicalLeaseReceiptSchema.parse(acquired), acquired);
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
