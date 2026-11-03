import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SabalanInternalRecordViewSchema, PartnerCommandSchema, InquiryBatchResultSchema, partnerError } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures, FixturePartnerQueryAdapter } from '@sabalanerp/partner-sales-contracts/testing';

test('compiled Accounting consumer accepts valid source and fails closed on forbidden/stale payloads', async () => {
  const fixture = createPartnerFixtures();
  const adapter = new FixturePartnerQueryAdapter(['ACCOUNTING']);
  const query = { schemaVersion: 1 as const, purpose: 'ACCOUNTING' as const, expected: fixture.case.head };
  const result = await adapter.query(query);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(SabalanInternalRecordViewSchema.parse(result.value).totals.payable, '1600');
  const stale = await adapter.query({ ...query, expected: { ...query.expected, revision: 2 } });
  assert.deepEqual(stale, { ok: false, error: partnerError('ROW_STALE') });
  assert.equal((await adapter.query({ ...query, purpose: 'PARTNER_CASE' })).ok, false);
  assert.equal(SabalanInternalRecordViewSchema.safeParse({ ...fixture.accounting, products: [{ ...fixture.accounting.products[0], retailUnitPrice: '1000' }] }).success, false);
});

test('bulk inquiry keeps valid and stale row outcomes; malformed Case command is rejected as a whole', () => {
  const result = InquiryBatchResultSchema.parse({ schemaVersion: 1, commandId: 'batch-313', outcomes: [
    { ok: true, rowId: 'row-good', outcomeId: 'outcome-313', revision: 2, outcome: 'APPROVED' },
    { ok: false, rowId: 'row-stale', error: partnerError('ROW_STALE') },
  ] });
  assert.equal(result.outcomes.length, 2);
  assert.equal(PartnerCommandSchema.safeParse({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: { rows: [{ approvalId: 'missing-evidence' }] } }).success, false);
});
