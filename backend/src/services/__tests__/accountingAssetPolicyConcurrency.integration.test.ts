import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAssetPolicyWithinTransaction } from '../accountingAssetPolicyIntervals';

const url = new URL(process.env.DATABASE_URL || '');
assert(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432' &&
  url.pathname === '/sabalanerp_asset_policy_test_20261102', 'Refusing non-isolated database');
const db = new PrismaClient();
test('concurrent successors cannot overlap, including after an open-ended first policy', async () => {
  const base = { bookId: 'synthetic', classCode: 'concurrent', titlePersian: 'synthetic',
    capitalizationThresholdRials: '1', bookMethod: 'STRAIGHT_LINE', taxMethod: 'STRAIGHT_LINE', usefulLifeMonths: 12,
    assetAccountId: 'a', cipAccountId: 'a', depreciationExpenseAccountId: 'a', accumulatedDepreciationAccountId: 'a',
    impairmentExpenseAccountId: 'a', impairmentAllowanceAccountId: 'a', disposalGainAccountId: 'a',
    disposalLossAccountId: 'a', createdBy: 'synthetic' };
  try {
    const create = (version: number, from: string, to: string | null) => db.$transaction(tx =>
      createAssetPolicyWithinTransaction(tx, { ...base, version, effectiveFrom: new Date(from), effectiveTo: to ? new Date(to) : null }));
    await create(1, '2026-01-01', '2026-01-31');
    const result = await Promise.allSettled([create(2, '2026-02-01', null), create(2, '2026-02-01', null)]);
    assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(result.filter(item => item.status === 'rejected').length, 1);
    await assert.rejects(create(3, '2026-03-01', null), /هم‌پوشان/);
    assert.equal(await db.accountingAssetClassPolicy.count({ where: { bookId: base.bookId, classCode: base.classCode } }), 2);
  } finally { await db.$disconnect(); }
});
