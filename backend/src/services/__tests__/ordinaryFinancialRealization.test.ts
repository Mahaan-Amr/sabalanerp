import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileOrdinaryFinancialRealization, snapshotRealizedSale } from '../salesAttributionService';

test('persisted drafts realize once; last valid record reverses and later creation restores only a delta', async () => {
  const events: any[] = [];
  const contract: any = { id: 'c1', commercialFlowVersion: 1, status: 'SIGNED', totalAmount: 100, responsibleSellerId: 'seller' };
  let valid = 0;
  const tx: any = {
    $queryRaw: async () => [],
    salesContract: { findUnique: async () => ({ ...contract, reportingEvents: events }),
      update: async ({ data }: any) => Object.assign(contract, data) },
    accountingFinancialRecord: { count: async () => valid, findMany: async () => [] },
    salesReportingEvent: { upsert: async ({ where, create }: any) => {
      const existing = events.find(event => event.sourceKey === where.sourceKey);
      if (existing) return existing;
      events.push(create); return create;
    } },
  };
  await snapshotRealizedSale(tx, contract.id, 'seller');
  assert.equal(events.length, 0, 'digital/paper signature must not realize the new flow');
  const reconcile = (sourceKey: string) => reconcileOrdinaryFinancialRealization(tx, { contractId: contract.id, actorId: 'accountant', sourceKey });
  await reconcile('unsaved'); assert.equal(events.length, 0);
  valid = 1; await reconcile('created-draft'); await reconcile('created-draft');
  assert.equal(events.length, 1); assert.equal(events[0].eventType, 'REALIZED');
  valid = 2; await reconcile('created-second'); assert.equal(events.length, 1);
  valid = 1; await reconcile('voided-first'); assert.equal(events.length, 1);
  valid = 0; await reconcile('voided-last'); await reconcile('voided-last');
  assert.equal(String(events[1].amount), '-100');
  valid = 1; await reconcile('restored');
  assert.equal(String(events[2].amount), '100');
  assert.equal(events.filter(event => event.eventType === 'REALIZED').length, 1);
  assert.equal(events.reduce((sum, event) => sum + Number(event.amount), 0), 100);
  contract.commercialFlowVersion = 0; valid = 0;
  await reconcile('legacy'); assert.equal(events.length, 3);
});
