import assert from 'node:assert/strict';
import test from 'node:test';
import {
  financialEvidenceCaseHref,
  financialEvidenceReviewFromConflict,
  isFinancialEvidenceReviewCase,
} from './financialEvidenceReview';

test('conflict response resolves only to an exact case deep-link', () => {
  assert.equal(financialEvidenceReviewFromConflict({
    code: 'FINANCIAL_EVIDENCE_CONFLICT',
    reviewCase: {
      id: 'case-1',
      contractId: 'contract-1',
      actionUrl: '/dashboard/accounting/contracts/contract-1/financial-evidence-reviews/case-1',
    },
  }), '/dashboard/accounting/contracts/contract-1/financial-evidence-reviews/case-1');
  assert.equal(financialEvidenceReviewFromConflict({
    code: 'FINANCIAL_EVIDENCE_CONFLICT',
    actionUrl: '/dashboard/accounting/contracts/contract-1#financial-evidence-review',
  }), null);
});

test('financial evidence case links preserve contract and case identity', () => {
  assert.equal(
    financialEvidenceCaseHref('contract/1', 'case/1'),
    '/dashboard/accounting/contracts/contract%2F1/financial-evidence-reviews/case%2F1',
  );
  assert.equal(isFinancialEvidenceReviewCase({ trackingCode: 'financial-evidence:invoice-1' }), true);
  assert.equal(isFinancialEvidenceReviewCase({ trackingCode: 'ordinary-flag' }), false);
});
