import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { readPartnerSalesContractDetail } from '../partnerSales/cases/contractDetail';

const contract = { id: 'detail-contract', partnerCaseId: 'detail-case', partnerRevision: 1, partnerIntegrityHash: 'hash' };

test('ordinary Partner contract opening has the bounded Partner transaction budget and never retries failure', async () => {
  const expired = Object.assign(new Error('expired'), { code: 'P2028' });
  const calls: unknown[] = [];
  const database = { async $transaction(_work: unknown, options: unknown) { calls.push(options); throw expired; } } as unknown as PrismaClient;
  await assert.rejects(readPartnerSalesContractDetail(database, { contract, actorId: 'owner', correlationId: 'detail' }),
    error => error === expired);
  assert.deepEqual(calls, [{ maxWait: 5_000, timeout: 15_000 }]);
});

test('detail projection still fails closed for incomplete Case pointers before reading or authorizing', async () => {
  const database = { $transaction: async (work: (tx: unknown) => unknown) => work({}) } as unknown as PrismaClient;
  for (const missing of ['partnerCaseId', 'partnerRevision', 'partnerIntegrityHash']) {
    assert.equal(await readPartnerSalesContractDetail(database, {
      contract: { ...contract, [missing]: null }, actorId: 'owner', correlationId: 'detail',
    }), null);
  }
});
