import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { enqueueContractCancellationNotice, suppressContractCancellationNotices } from '../contractCancellationNotice';

function fixture(input: { verifiedAt?: Date; lastSentAt?: Date; cycleAt?: Date; partner?: boolean; legacy?: boolean } = {}) {
  const intents = new Map<string, { eventKey: string; status: string }>();
  const observed: { where?: { verifiedAt: { gt?: Date; not?: null } } } = {};
  const contract = { id: 'contract', customerId: 'current-customer', contractNumber: '404', partnerCaseId: input.partner ? 'case' : null,
    commercialFlowVersion: input.legacy ? 0 : 1 };
  const tx = {
    salesContract: { findUniqueOrThrow: async () => contract },
    contractConfirmationAuditLog: { findFirst: async () => input.cycleAt && !input.partner
      ? { eventAt: new Date(0), eventPayloadJson: { at: input.cycleAt.toISOString() } } : null },
    partnerCaseEvent: { findFirst: async () => input.cycleAt ? { recordedAt: input.cycleAt } : null },
    contractPublicConfirmation: { findFirst: async (query: { where: { verifiedAt: { gt?: Date; not?: null } } }) => {
      observed.where = query.where;
      return input.verifiedAt && input.lastSentAt && (!query.where.verifiedAt.gt || input.verifiedAt > query.where.verifiedAt.gt)
        ? { verifiedAt: input.verifiedAt, commercialRevision: 1 } : null;
    } },
    contractVerificationCode: { findFirst: async () => input.legacy && input.verifiedAt ? { verifiedAt: input.verifiedAt } : null },
    contractCancellationNotice: {
      upsert: async (query: { where: { eventKey: string }; create: { eventKey: string } }) => {
        const prior = intents.get(query.where.eventKey);
        if (prior) return prior;
        const created = { ...query.create, status: 'PENDING' }; intents.set(created.eventKey, created); return created;
      },
      updateMany: async (query: { where: { status: { in: string[] } }; data: { status: string } }) => {
        for (const notice of intents.values()) if (query.where.status.in.includes(notice.status)) notice.status = query.data.status;
      },
    },
    contractCancellationNoticeAttempt: { updateMany: async () => ({ count: 0 }) },
  } as unknown as Prisma.TransactionClient;
  return { tx, intents, observed };
}
const at = new Date('2026-10-12T10:00:00Z');
const command = { contractId: 'contract', eventKey: 'cancellation-event', at };

test('SMS sent without digital acceptance and paper-only contracts do not enqueue', async () => {
  for (const input of [{ lastSentAt: at }, {}]) {
    const { tx, intents } = fixture(input);
    assert.equal(await enqueueContractCancellationNotice(tx, command), null);
    assert.equal(intents.size, 0);
  }
});
test('accepted earlier commercial versions qualify once per cancellation event in both sales flows', async () => {
  for (const partner of [false, true]) {
    const { tx, intents } = fixture({ verifiedAt: at, lastSentAt: at, partner });
    await enqueueContractCancellationNotice(tx, command);
    await enqueueContractCancellationNotice(tx, command);
    assert.equal(intents.size, 1);
    await enqueueContractCancellationNotice(tx, { ...command, eventKey: 'another-cancellation' });
    assert.equal(intents.size, 2);
  }
});
test('reactivation separates acceptance periods and uses event instant rather than transaction start', async () => {
  const cycleAt = new Date(at.getTime() + 1000);
  for (const partner of [false, true]) {
    const old = fixture({ verifiedAt: at, lastSentAt: at, cycleAt, partner });
    assert.equal(await enqueueContractCancellationNotice(old.tx, command), null);
    assert.equal(old.observed.where?.verifiedAt.gt?.getTime(), cycleAt.getTime());
    const fresh = fixture({ verifiedAt: new Date(at.getTime() + 2000), lastSentAt: at, cycleAt, partner });
    assert.ok(await enqueueContractCancellationNotice(fresh.tx, command));
  }
});
test('reactivation suppresses unsent intents while preserving sent and historical rows', async () => {
  const { tx, intents } = fixture({ verifiedAt: at, lastSentAt: at });
  for (const status of ['PENDING', 'RETRY', 'SENDING', 'UNKNOWN', 'NEEDS_PHONE', 'NEEDS_SELECTION', 'FAILED', 'SENT']) {
    intents.set(status, { eventKey: status, status });
  }
  await suppressContractCancellationNotices(tx, 'contract');
  assert.equal(intents.size, 8);
  for (const [key, row] of intents) assert.equal(row.status, key === 'SENT' ? 'SENT' : 'SUPPRESSED');
});
test('legacy verified OTP evidence qualifies separately from invalidated unused codes', async () => {
  const accepted = fixture({ legacy: true, verifiedAt: at });
  assert.ok(await enqueueContractCancellationNotice(accepted.tx, command));
  const invalidated = fixture({ legacy: true });
  assert.equal(await enqueueContractCancellationNotice(invalidated.tx, command), null);
});
