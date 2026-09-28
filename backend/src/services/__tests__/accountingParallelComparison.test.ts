import assert from 'node:assert/strict';
import test from 'node:test';
import { compareAccountingParallelEvents, type ParallelComparisonInput } from '../accountingParallelComparison';
import { assertParallelDifferenceCorrection } from '../accountingParallelDifferences';
import { runAccountingParallelTransaction } from '../accountingParallelComparisonPrisma';
import type { PrismaClient } from '@prisma/client';

const input = (): ParallelComparisonInput => ({
  bookId: 'book', periodId: 'month', snapshotId: 'snapshot', sourcePackageHash: 'a'.repeat(64),
  sources: [{ key: '39', hash: 'b'.repeat(64), day: '2026-03-21', lines: [
    { accountId: 'cash', partyId: null, financialAccountId: 'bank', debit: '12500000', credit: '0' },
    { accountId: 'receivable', partyId: 'customer', financialAccountId: null, debit: '0', credit: '12500000' },
  ] }],
  targets: [{ id: 'receipt', hash: 'c'.repeat(64), sourceType: 'CUSTOMER_RECEIPT', status: 'POSTED', day: '2026-03-21', lines: [
    { accountId: 'receivable', partyId: 'customer', financialAccountId: null, debit: '0', credit: '12500000' },
    { accountId: 'cash', partyId: null, financialAccountId: 'bank', debit: '12500000', credit: '0' },
  ] }], pairs: [{ sourceKey: '39', targetId: 'receipt', reason: 'دریافت یکسان مشتری', actorId: 'accountant' }],
});

test('a real event compares independent posted lines and preserves reproducible evidence', () => {
  const report = compareAccountingParallelEvents(input());
  assert.equal(report.exact, true);
  assert.equal(report.acceptedPeriod, false);
  assert.equal(report.sourceDebitRials, '12500000');
  assert.equal(report.targetDebitRials, '12500000');
  assert.deepEqual(report.differences, []);
  assert.equal(report.outputHash, compareAccountingParallelEvents(input()).outputHash);
});

test('balanced but wrong customer is an item-level difference', () => {
  const evidence = input(); evidence.targets[0].lines[0].partyId = 'another-customer';
  const report = compareAccountingParallelEvents(evidence);
  assert.equal(report.exact, false);
  assert.ok(report.differences.some((item) => item.code === 'LINES_DIFFER'));
  const difference = report.differences.find((item) => item.code === 'LINES_DIFFER')!;
  assert.equal(difference.sourceDebitRials, '12500000');
  assert.equal(difference.targetDebitRials, '12500000');
  assert.equal(difference.amountRials, '0');
  assert.equal(difference.itemCount, 4);
  assert.match(difference.identity, /^[a-f0-9]{64}$/);
});

test('historical copies cannot prove independent parallel work; unmatched events remain explicit', () => {
  const evidence = input(); evidence.targets[0].sourceType = 'SEPIDAR_ACC_VOUCHER';
  assert.ok(compareAccountingParallelEvents(evidence).differences.some((item) => item.code === 'TARGET_NOT_INDEPENDENT'));
  evidence.pairs = []; evidence.targets[0].sourceType = 'CUSTOMER_RECEIPT';
  assert.deepEqual(compareAccountingParallelEvents(evidence).differences.map((item) => item.code).sort(), ['SOURCE_UNMATCHED', 'TARGET_UNMATCHED']);
});

test('no tolerance, invalid amount, duplicate pairing or missing mapping can be hidden', () => {
  const evidence = input(); evidence.targets[0].lines[0].credit = '12499999';
  assert.equal(compareAccountingParallelEvents(evidence).exact, false);
  evidence.sources[0].lines[0].debit = '12.5';
  assert.throws(() => compareAccountingParallelEvents(evidence), /مبلغ/);
  const duplicate = input(); duplicate.pairs.push(duplicate.pairs[0]);
  assert.throws(() => compareAccountingParallelEvents(duplicate), /یکتا/);
  const missing = input(); missing.sources[0].lines[0].accountId = null;
  assert.ok(compareAccountingParallelEvents(missing).differences.some((item) => item.code === 'SOURCE_MAPPING_MISSING'));
});

test('extra accounting dimensions and balanced two-sided lines remain differences', () => {
  const evidence = input(); evidence.targets[0].lines[0].dimensions = ['cost-center:other'];
  assert.ok(compareAccountingParallelEvents(evidence).differences.some((item) => item.code === 'LINES_DIFFER'));
  const twoSided = input(); twoSided.sources[0].lines[0].credit = '1'; twoSided.sources[0].lines[1].debit = '1';
  assert.ok(compareAccountingParallelEvents(twoSided).differences.some((item) => item.code === 'SOURCE_UNBALANCED'));
});

test('storage order cannot change comparison identity', () => {
  const evidence = input(); evidence.pairs = [];
  evidence.sources.push({ ...evidence.sources[0], key: '40' });
  evidence.targets.push({ ...evidence.targets[0], id: 'receipt-2' });
  const hash = compareAccountingParallelEvents(evidence).outputHash;
  evidence.sources.reverse(); evidence.targets.reverse();
  assert.equal(compareAccountingParallelEvents(evidence).outputHash, hash);
  evidence.sources[0].lines.reverse(); evidence.targets[0].lines.reverse();
  assert.equal(compareAccountingParallelEvents(evidence).outputHash, hash);
});

test('a resolution requires the same current real events, not a note or disappeared data', () => {
  const mismatched = input(); mismatched.targets[0].lines[0].partyId = 'other';
  const origin = compareAccountingParallelEvents(mismatched);
  const difference = origin.differences.find((item) => item.code === 'LINES_DIFFER')!;
  assert.throws(() => assertParallelDifferenceCorrection(origin, difference.identity, origin), /رفع نشده/);
  const corrected = compareAccountingParallelEvents(input());
  assert.doesNotThrow(() => assertParallelDifferenceCorrection(origin, difference.identity, corrected));
  const missing = input(); missing.targets = []; missing.pairs = [];
  assert.throws(() => assertParallelDifferenceCorrection(origin, difference.identity, compareAccountingParallelEvents(missing)), /رفع نشده/);
  const wrongScope = { ...corrected, snapshotId: 'another-snapshot' };
  assert.throws(() => assertParallelDifferenceCorrection(origin, difference.identity, wrongScope), /همان اختلاف/);
});

test('pairing alone cannot resolve an existing mapping or independent-target defect', () => {
  const unmapped = input(); unmapped.sources[0].lines[0].accountId = null; unmapped.pairs = [];
  const origin = compareAccountingParallelEvents(unmapped);
  const mapping = origin.differences.find((item) => item.code === 'SOURCE_MAPPING_MISSING')!;
  unmapped.pairs = input().pairs;
  assert.throws(() => assertParallelDifferenceCorrection(origin, mapping.identity, compareAccountingParallelEvents(unmapped)), /رفع نشده/);
  const historical = input(); historical.pairs = []; historical.targets[0].sourceType = 'MIGRATION_COPY';
  const historicalOrigin = compareAccountingParallelEvents(historical);
  const targetDefect = historicalOrigin.differences.find((item) => item.code === 'TARGET_NOT_INDEPENDENT')!;
  historical.pairs = input().pairs;
  assert.throws(() => assertParallelDifferenceCorrection(historicalOrigin, targetDefect.identity, compareAccountingParallelEvents(historical)), /رفع نشده/);
});

test('only rolled-back serialization conflicts retry and retries remain bounded', async () => {
  let attempts = 0;
  const db = { $transaction: async () => { attempts += 1; if (attempts < 3) throw { code: 'P2034' }; return 'committed'; } } as unknown as PrismaClient;
  assert.equal(await runAccountingParallelTransaction(db, async () => 'unused'), 'committed');
  assert.equal(attempts, 3);
  attempts = 0;
  const alwaysConflicts = { $transaction: async () => { attempts += 1; throw { code: 'P2034' }; } } as unknown as PrismaClient;
  await assert.rejects(runAccountingParallelTransaction(alwaysConflicts, async () => 'unused'), /هم‌زمان تغییر/);
  assert.equal(attempts, 3);
  attempts = 0; const businessFailure = new Error('source evidence damaged');
  const fails = { $transaction: async () => { attempts += 1; throw businessFailure; } } as unknown as PrismaClient;
  await assert.rejects(runAccountingParallelTransaction(fails, async () => 'unused'), (error) => error === businessFailure);
  assert.equal(attempts, 1);
});
