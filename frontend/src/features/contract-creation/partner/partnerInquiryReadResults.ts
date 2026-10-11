import type { Result } from '@sabalanerp/partner-sales-contracts';
import type { PartnerInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';

/** Missing historical inquiries can be absent; infrastructure or permission
 * failures must retain their actual classification rather than inventing
 * corrupt commercial evidence. */
export function partnerInquiryReadRows<T extends { rows: readonly PartnerInquiryRow[] }>(results: readonly Result<T>[]): PartnerInquiryRow[] {
  const rows: PartnerInquiryRow[] = [];
  for (const result of results) {
    if (result.ok) rows.push(...result.value.rows);
    else if (result.error.code !== 'NOT_FOUND') throw result.error;
  }
  return rows;
}
