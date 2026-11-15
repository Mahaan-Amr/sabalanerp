import assert from 'node:assert/strict';
import test from 'node:test';
import { financialRecordReviewHref, accountingReviewReturn } from '../financialRecordReviewHref';

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
