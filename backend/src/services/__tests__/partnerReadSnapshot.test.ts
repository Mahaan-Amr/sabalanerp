import assert from 'node:assert/strict';
import test from 'node:test';
import { readPartnerSnapshot } from '../partnerSales/authorization/readSnapshot';

const transactionClient = {
  $queryRaw: async () => [{ id: 'partner-operations' }],
  partnerOperationsControl: { findUnique: async () => ({ cohortId: 'cohort', operationalPaused: false }) },
};

test('Partner read snapshot retries one Prisma-wrapped PostgreSQL deadlock', async () => {
  let attempts = 0;
  const database = { $transaction: async (work: (tx: typeof transactionClient) => Promise<string>) => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('deadlock'), {
      code: 'P2010', meta: { code: '40P01' },
    });
    return work(transactionClient);
  } };

  const result = await readPartnerSnapshot(database as never, async () => 'authorized');
  assert.equal(result, 'authorized');
  assert.equal(attempts, 2);
});

test('Partner read snapshot does not retry unrelated raw-query failures', async () => {
  let attempts = 0;
  const failure = Object.assign(new Error('unrelated'), { code: 'P2010', meta: { code: '23505' } });
  const database = { $transaction: async () => { attempts += 1; throw failure; } };

  await assert.rejects(() => readPartnerSnapshot(database as never, async () => 'unused'), failure);
  assert.equal(attempts, 1);
});
