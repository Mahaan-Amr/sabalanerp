import type { PartnerCaseRuntimeRow } from '@sabalanerp/partner-sales-contracts';

export function canReviewPartnerInquiry(row: Pick<PartnerCaseRuntimeRow, 'commercial' | 'inquiryResponseComplete'> | undefined) {
  return row?.inquiryResponseComplete === true && row.commercial?.inquiry !== 'ACCEPTED';
}
