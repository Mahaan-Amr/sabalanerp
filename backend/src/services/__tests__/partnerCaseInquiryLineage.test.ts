import assert from 'node:assert/strict';
import test from 'node:test';
import { sameCaseInquiryLineage } from '../partnerSales/inquiries/caseInquiryLineage';

const row = { inquiryId: 'case-pricing:2', caseId: 'case-1', caseRevision: 2,
  productRowId: 'product-1', predecessorInquiryId: 'case-pricing:1',
  predecessorCaseId: 'case-1', predecessorCaseRevision: 1, predecessorProductRowId: 'product-1' };

test('correction follows only the same product in an earlier revision of the same Case', () => {
  assert.equal(sameCaseInquiryLineage(row), true);
  assert.equal(sameCaseInquiryLineage({ ...row, predecessorCaseId: 'case-2' }), false);
  assert.equal(sameCaseInquiryLineage({ ...row, predecessorProductRowId: 'product-2' }), false);
  assert.equal(sameCaseInquiryLineage({ ...row, predecessorCaseRevision: 3 }), false);
});
