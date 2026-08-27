import { QuantitySchema } from '@sabalanerp/partner-sales-contracts';
import type { PartnerInquiryView } from '../../partner-sales/inquiries/inquiryPresentation';
import { usableInquiryRows } from '../../partner-sales/inquiries/inquiryPresentation';
import { defaultPartnerRetailRows } from './partnerRetail';
import type { PartnerWizardDraft } from './PartnerContractWizard';
import type { PartnerDraftIntent } from './partnerCaseSubmission';

/** Quantity is supplied by the canonical graph's display projection; it is not
 * an inquiry fingerprint. No catalog-ID or array-position matching is allowed.
 */
export function enterPartnerWizard({ inquiry, now, base, quantities, mismatchedRowIds = [] }: {
  inquiry: PartnerInquiryView;
  now: number;
  base: Omit<PartnerDraftIntent, 'rows' | 'belowCostConfirmed'>;
  quantities: ReadonlyArray<{ productRowId: string; quantity: string; unit: string }>;
  mismatchedRowIds?: readonly string[];
}): PartnerWizardDraft | null {
  const approved = usableInquiryRows(inquiry, now).filter(row => !mismatchedRowIds.includes(row.rowId));
  if (!approved.length || new Set(quantities.map(row => row.productRowId)).size !== quantities.length) return null;
  const configured = [];
  for (const row of approved) {
    const quantity = quantities.find(item => item.productRowId === row.configurationRef.productRowId);
    if (!quantity || !QuantitySchema.safeParse(quantity.quantity).success || row.configurationRef.recoveryId !== base.recoveryId) return null;
    configured.push({ ...quantity, inquiryRow: row });
  }
  if (new Set(configured.map(row => row.productRowId)).size !== configured.length) return null;
  const rows = defaultPartnerRetailRows(configured);
  const intent = { ...base, belowCostConfirmed: false,
    rows: rows.map(row => ({ productRowId: row.productRowId, approvedRowBinding: row.inquiryRow.approvedRowBinding!, retailUnitPrice: row.retailUnitPrice })),
  };
  return { intent, rows, step: 'customer' };
}
