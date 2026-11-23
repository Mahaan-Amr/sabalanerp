import assert from 'node:assert/strict';
import test from 'node:test';
import { financialRecordReviewHref, financialRecordReviewId, accountingReviewReturn } from '../financialRecordReviewHref';
import { FinancialReviewRequestGuard, loadFinancialReview, canSubmitFinancialReview } from '../financialReviewRequestGuard';

test('contract 900001 review uses its persisted identity for reads, audit and approval', async () => {
  const id = 'partner-accounting:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:replacement:00000000-0000-4000-8000-000000000001';
  const url = new URL(financialRecordReviewHref(id, '/dashboard/accounting/contracts/partner/case-900001'), 'https://example.test');
  const segment = url.pathname.split('/').at(-1)!;
  const recordId = financialRecordReviewId(segment)!;
  const guard = new FinancialReviewRequestGuard(); guard.select('reviewer:900001');
  let auditReads = 0;
  const result = await loadFinancialReview({ owner: 'reviewer:900001', recordId,
    epoch: guard.begin('reviewer:900001')!, guard,
    fetchRecord: async () => {
      const query = new URLSearchParams({ recordId });
      assert(!query.toString().includes('%253A'), 'API request must not encode the colon twice');
      return { data: { success: true, data: { items: query.get('recordId') === id ? [{ id }] : [], actionAvailability: { approve: true } } } };
    },
    fetchAudit: async () => { assert.equal(recordId, id); auditReads++; return { data: { success: true, data: { items: [], total: 0 } } }; },
  });
  assert.equal(result?.kind, 'loaded', 'the real record/audit chain must not report the existing record as missing');
  assert.equal(auditReads, 1);
  assert(canSubmitFinancialReview({ owner: 'reviewer:900001', recordId, payloadId: id, loading: false, busy: false,
    review: { owner: 'reviewer:900001', record: { id }, canApprove: true } }));
  assert(!canSubmitFinancialReview({ owner: 'reviewer:900001', recordId, payloadId: segment, loading: false, busy: false,
    review: { owner: 'reviewer:900001', record: { id }, canApprove: true } }));
});

test('route decoding preserves distinct stored IDs and rejects malformed escapes', () => {
  for (const id of ['ordinary-123', 'partner-accounting:original', 'record/1', 'literal%3Aidentity', 'percent%value', 'شناسه']) {
    assert.equal(financialRecordReviewId(encodeURIComponent(id)), id);
  }
  assert.equal(financialRecordReviewId('literal%253Aidentity'), 'literal%3Aidentity', 'decode once, never recursively');
  for (const invalid of ['', '%', '%GG', '%E0%A4%A']) assert.equal(financialRecordReviewId(invalid), null);
});

test('financial review links preserve the exact record and accounting return query', () => {
  const href = financialRecordReviewHref('record/1', '/dashboard/accounting/contracts?view=reviewable');
  const url = new URL(href, 'https://example.test');
  assert.equal(url.pathname, '/dashboard/accounting/invoice-candidates/record%2F1');
  assert.equal(url.searchParams.get('returnTo'), '/dashboard/accounting/contracts?view=reviewable');
});

test('return target accepts Accounting dashboard and rejects foreign destinations', () => {
  assert.equal(accountingReviewReturn('/dashboard/accounting'), '/dashboard/accounting');
  assert.equal(accountingReviewReturn('/dashboard/accounting?view=one'), '/dashboard/accounting?view=one');
  assert.equal(accountingReviewReturn('//example.test'), '/dashboard/accounting/invoice-candidates');
  assert.equal(accountingReviewReturn('/dashboard/accounting-foreign'), '/dashboard/accounting/invoice-candidates');
});

test('contract detail return falls back to contracts while preserving an Accounting deep link', () => {
  assert.equal(accountingReviewReturn('//outside.test', '/dashboard/accounting/contracts'),
    '/dashboard/accounting/contracts');
  assert.equal(accountingReviewReturn('/dashboard/accounting/payments?page=2', '/dashboard/accounting/contracts'),
    '/dashboard/accounting/payments?page=2');
});
