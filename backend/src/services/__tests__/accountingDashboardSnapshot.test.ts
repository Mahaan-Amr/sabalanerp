import assert from 'node:assert/strict';
import test from 'node:test';
import { readPartnerSnapshot } from '../partnerSales/authorization/readSnapshot';
import { readAccountingDashboardSnapshot } from '../accountingDashboardSnapshot';

test('retry after Partner authority changes rebuilds the dashboard in the new snapshot', async () => {
  let attempt = 0;
  const seen: string[] = [];
  const database = { $transaction: async (work: (tx: any) => Promise<unknown>) => {
    attempt += 1;
    const tx = { allowed: attempt === 1, $queryRaw: async () => [{ id: 'partner-operations' }],
      partnerOperationsControl: { findUnique: async () => ({ cohortId: 'cohort', operationalPaused: false }) } };
    const result = await work(tx);
    if (attempt === 1) throw Object.assign(new Error('serialization'), { code: 'P2034' });
    return result;
  } };
  const dashboard = await readAccountingDashboardSnapshot<{ allowed: boolean }, { contracts: string[] }, { total: number }>({
    withScope: read => readPartnerSnapshot(database as never, tx => read(tx as unknown as { allowed: boolean })),
    readWorkspace: async scope => { seen.push(scope.allowed ? 'authorized' : 'revoked');
      return { contracts: scope.allowed ? ['private-partner-case'] : [] }; },
    readTrend: async () => ({ total: 0 }),
    retryWorkspace: async () => { throw new Error('unexpected fallback'); },
    onTrendError: () => {}, onTransactionError: () => {},
  });
  assert.deepEqual(seen, ['authorized', 'revoked']);
  assert.deepEqual(dashboard.workspace.contracts, []);
  assert.equal(attempt, 2);
});
