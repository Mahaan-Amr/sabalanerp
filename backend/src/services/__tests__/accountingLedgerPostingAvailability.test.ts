import assert from 'node:assert/strict';
import test from 'node:test';
import { listLedgerVouchers, postingBlockReasonForVoucherSource } from '../accountingLedgerPrismaRepository';

test('Sepidar parallel drafts are identified as blocked without exposing source payload', () => {
  assert.match(postingBlockReasonForVoucherSource('SEPIDAR_ACC_VOUCHER', { authority: 'SEPIDAR_UNTIL_CUTOVER' }) ?? '', /سپیدار/);
  assert.equal(postingBlockReasonForVoucherSource('سند دستی', { kind: 'MANUAL_LEDGER_VOUCHER' }), null);
  assert.equal(postingBlockReasonForVoucherSource('SEPIDAR_ACC_VOUCHER', { authority: 'SABALAN_AFTER_CUTOVER' }), null);
});

test('voucher list gives the page a posting decision without returning source evidence', async () => {
  const rows = [
    { id: 'sepidar-draft', status: 'DRAFT', sourceType: 'SEPIDAR_ACC_VOUCHER', sourcePayload: { authority: 'SEPIDAR_UNTIL_CUTOVER', privateEvidence: 'hidden' } },
    { id: 'manual-draft', status: 'DRAFT', sourceType: 'سند دستی', sourcePayload: { privateEvidence: 'hidden' } },
  ];
  const database = { accountingLedgerVoucher: { findMany: async () => rows } } as Parameters<typeof listLedgerVouchers>[0];
  const result = await listLedgerVouchers(database, { bookId: 'book-1', fiscalYearId: 'year-1', status: 'DRAFT' });
  assert.match(result[0].postingBlockedReason ?? '', /سپیدار/);
  assert.equal(result[1].postingBlockedReason, null);
  assert.equal('sourcePayload' in result[0], false);
  assert.equal('sourcePayload' in result[1], false);
});
