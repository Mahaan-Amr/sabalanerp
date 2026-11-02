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

test('detail errors are Persian, traceable and preserve hidden existence', async () => {
  const {partnerSalesContractDetailFailure} = await import('../partnerSales/cases/contractDetail');
  for (const status of [403,404,409,503]) {
    const failure = partnerSalesContractDetailFailure({status,code:status===404?'CUSTOMER_OUT_OF_SCOPE':'FORBIDDEN'},'detail-reference');
    assert.equal(failure.status,status);assert.equal(failure.body.trackingId,'detail-reference');
    assert.match(failure.body.error,/[\u0600-\u06ff]/);assert.doesNotMatch(failure.body.error,/[A-Za-z]/);
    if(status===404)assert.equal(failure.body.code,'NOT_FOUND');
  }
  assert.equal(partnerSalesContractDetailFailure(null,'missing-proof').status,409);
});
