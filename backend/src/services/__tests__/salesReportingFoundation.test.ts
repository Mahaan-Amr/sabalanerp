import assert from 'node:assert/strict';
import { snapshotRealizedSale, recordRealizedAdjustment, recordContractCancellation } from '../salesAttributionService';
import { resolveSalesReportPeriod } from '../salesReportingService';

const contract: any = {
  id: 'contract-1',
  status: 'SIGNED',
  totalAmount: 100,
  responsibleSellerId: 'seller-1',
  realizedSellerId: null,
  realizedAt: null,
  reportingEvents: []
};
const events: any[] = [];
const updates: any[] = [];
const tx: any = {
  salesContract: {
    findUnique: async ({ include }: any) => ({ ...contract, ...(include ? { reportingEvents: events } : {}) }),
    update: async ({ data }: any) => { Object.assign(contract, data); updates.push(data); return { ...contract }; }
  },
  salesReportingEvent: {
    upsert: async ({ where, create }: any) => {
      const existing = events.find((event) => event.sourceKey === where.sourceKey);
      if (existing) return existing;
      events.push({ id: `event-${events.length + 1}`, ...create });
      return events[events.length - 1];
    }
  }
};

const run = async () => {
  await snapshotRealizedSale(tx, contract.id, 'manager-1', new Date('2026-03-21T08:00:00.000Z'));
  assert.equal(contract.realizedSellerId, 'seller-1', 'realized credit snapshots the responsible seller');
  assert.equal(events.length, 1, 'first realization creates one event');
  await snapshotRealizedSale(tx, contract.id, 'manager-1', new Date('2026-03-22T08:00:00.000Z'));
  assert.equal(events.length, 1, 'repeated realization is idempotent');

  await recordRealizedAdjustment(tx, {
    contractId: contract.id,
    previousAmount: 100,
    nextAmount: 120,
    sourceKey: 'correction-1',
    actorId: 'manager-1',
    reason: 'approved correction',
    effectiveAt: new Date('2026-04-10T08:00:00.000Z')
  });
  assert.equal(String(events[1].amount), '20', 'adjustment records only the delta');

  await recordContractCancellation(tx, contract.id, 'manager-1', new Date('2026-05-01T08:00:00.000Z'));
  assert.equal(String(events[2].amount), '-120', 'cancellation reverses the current net once');
  assert.ok(contract.lostAt, 'cancellation records the lost business date');

  const explicit = resolveSalesReportPeriod({ from: '2026-03-21T00:00:00.000Z', to: '2026-03-27T23:59:59.999Z' });
  const selectedDuration = explicit.to.getTime() - explicit.from.getTime();
  const previousDuration = explicit.previousTo.getTime() - explicit.previousFrom.getTime();
  assert.equal(previousDuration, selectedDuration, 'comparison period has equal duration');

  const defaultPeriod = resolveSalesReportPeriod({ period: 'month' });
  const persianDay = Number(new Intl.DateTimeFormat('en-US-u-ca-persian', { day: 'numeric' }).format(defaultPeriod.from));
  assert.equal(persianDay, 1, 'default report begins on the first day of the current Jalali month');

  console.log('salesReportingFoundation tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
