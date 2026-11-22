import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashAccountingPeriodEvidence } from '../accountingPeriodEvidence';

test('browser period-end evidence hash matches the posting application hash', async () => {
  const evidence = { sourceVersion: 1, kind: 'ASSET_READY_FOR_USE', sourceId: 'proof-1',
    occurredAt: '2026-09-26T12:00:00.000Z', asset: { id: 'asset-1', costRials: '100',
      components: [{ costRials: '100', titlePersian: 'دستگاه' }], optional: undefined } };
  assert.equal(await hashAccountingPeriodEvidence(evidence), '7895d8b25ff2291dc9acc45cd89a58bee6274b89fd4fccf712739ffeb58830b8');
});
