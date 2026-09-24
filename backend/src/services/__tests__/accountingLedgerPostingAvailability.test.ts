import assert from 'node:assert/strict';
import test from 'node:test';
import { listLedgerVouchers } from '../accountingLedgerPrismaRepository';

test('voucher list gives the page a posting decision without returning source evidence', async () => {
  const rows = [
    { id: 'sepidar-draft', status: 'DRAFT', sourceType: 'SEPIDAR_ACC_VOUCHER', sourcePayload: { authority: 'SEPIDAR_UNTIL_CUTOVER', privateEvidence: 'hidden' } },
    { id: 'manual-draft', status: 'DRAFT', sourceType: 'سند دستی', sourcePayload: { privateEvidence: 'hidden' } },
  ];
  const database = { accountingLedgerVoucher: { findMany: async (query: { select: Record<string, unknown> }) => {
    assert.equal(query.select.sourcePayload, undefined);
    return rows.map(({ sourcePayload: _sourcePayload, ...row }) => row);
  } } } as unknown as Parameters<typeof listLedgerVouchers>[0];
  const result = await listLedgerVouchers(database, { bookId: 'book-1', fiscalYearId: 'year-1', status: 'DRAFT' });
  assert.equal(result[0].postingBlockedReason, null);
  assert.equal(result[1].postingBlockedReason, null);
  assert.equal('sourcePayload' in result[0], false);
  assert.equal('sourcePayload' in result[1], false);
});
