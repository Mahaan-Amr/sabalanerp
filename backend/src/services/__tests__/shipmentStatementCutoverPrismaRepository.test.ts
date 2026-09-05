import assert from 'node:assert/strict';
import { PrismaShipmentStatementCutoverRepository } from '../shipmentStatementCutover/prismaRepository';

const main = async () => {
  const order: string[] = [];
  let control = {
    id: 'customer-shipment-statements', paused: true, incident: false, revision: 0,
    changedAt: new Date('2026-09-05T00:00:00.000Z'), changedBy: null, reason: 'Initial safe pause', createdAt: new Date(),
  };
  const tx = {
    $executeRawUnsafe: async () => { order.push('operations-lock'); },
    $queryRaw: async (parts: TemplateStringsArray) => {
      if (parts.join('').includes('transaction_timestamp')) return [{ now: new Date('2026-09-05T08:00:00.000Z') }];
      order.push('cutover-update');
      return [{ enabled: true, cutoverAt: new Date('2026-09-05T08:00:00.000Z'), activatedAt: new Date('2026-09-05T08:00:00.000Z'),
        activatedBy: 'release-owner', manifestId: 'manifest-1', integrityHash: 'a'.repeat(64) }];
    },
    shipmentStatementOperationsControl: {
      findUniqueOrThrow: async () => control,
      updateMany: async ({ data }: any) => { order.push('control-cas'); control = { ...control, ...data }; return { count: 1 }; },
    },
    shipmentStatementOperationsEvent: {
      findFirst: async () => null,
      create: async ({ data }: any) => { order.push('audit-event'); return { id: 'event-1', ...data }; },
    },
  };
  const client = { $transaction: async (work: (transaction: any) => unknown) => work(tx) } as any;
  const result = await new PrismaShipmentStatementCutoverRepository(client).activate({
    expectedDisabled: true,
    migrationManifestId: 'manifest-1',
    integrityHash: 'a'.repeat(64),
    activatedBy: 'release-owner',
    expiresAt: new Date('2026-09-05T08:05:00.000Z'),
  });
  assert.equal(result.enabled, true);
  assert.deepEqual(order, ['operations-lock', 'cutover-update', 'audit-event', 'control-cas']);
  assert.equal(control.paused, false);
  assert.equal(control.revision, 1);
  console.log('shipment statement cutover atomic operations test passed');
};

void main();
