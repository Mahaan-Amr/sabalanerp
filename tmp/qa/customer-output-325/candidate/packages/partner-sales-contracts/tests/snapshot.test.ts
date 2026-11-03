import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CustomerOutputSnapshotSchema } from '../src';
import { createPartnerFixtures } from '../src/testing';
test('confirmation snapshot binds one revision, recipient, expiry and allowlisted output', () => {
  const fixture = createPartnerFixtures();
  const snapshot = { schemaVersion: 1, snapshotId: 'fixture-313-snapshot', owner: fixture.case.head,
    normalizedRecipient: '+989120000001', createdAt: '2026-08-27T08:00:00.000Z', expiresAt: '2026-08-28T08:00:00.000Z',
    content: fixture.customer };
  assert.equal(CustomerOutputSnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(CustomerOutputSnapshotSchema.safeParse({ ...snapshot, content: { ...snapshot.content, revision: 2 } }).success, false);
  assert.equal(CustomerOutputSnapshotSchema.safeParse({ ...snapshot, expiresAt: snapshot.createdAt }).success, false);
});
