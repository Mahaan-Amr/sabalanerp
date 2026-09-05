import { PartnerTechnicalSavedViewSchema, type PartnerTechnicalSavedView } from '@sabalanerp/partner-sales-contracts';
import type { PartnerInquiryView } from '../../partner-sales/inquiries/inquiryPresentation';
import { usableInquiryRows } from '../../partner-sales/inquiries/inquiryPresentation';
import { defaultPartnerRetailRows, partnerRetailIntentRows } from './partnerRetail';
import type { PartnerWizardDraft } from './PartnerContractWizard';
import type { PartnerDraftIntent } from './partnerCaseSubmission';

/** Quantity is supplied by the canonical graph's display projection; it is not
 * an inquiry fingerprint. No catalog-ID or array-position matching is allowed.
 */
export function enterPartnerWizard({ inquiry, now, base, validated, mismatchedRowIds = [] }: {
  inquiry: PartnerInquiryView;
  now: number;
  base: Omit<PartnerDraftIntent, 'rows' | 'belowCostConfirmed' | 'graphHash'>;
  validated: PartnerTechnicalSavedView;
  mismatchedRowIds?: readonly string[];
}): PartnerWizardDraft | null {
  const saved = PartnerTechnicalSavedViewSchema.safeParse(validated);
  if (!saved.success || saved.data.recoveryId !== base.recoveryId ||
      saved.data.recoveryRevision !== base.recoveryRevision) return null;
  const approved = usableInquiryRows(inquiry, now).filter(row => !mismatchedRowIds.includes(row.rowId));
  if (!approved.length) return null;
  const configured = [];
  for (const row of approved) {
    const technical = saved.data.rows.find(item => item.configurationRef.productRowId === row.configurationRef.productRowId);
    if (!technical || technical.configurationRef.recoveryId !== row.configurationRef.recoveryId ||
        technical.configurationRef.recoveryRevision !== row.configurationRef.recoveryRevision) return null;
    configured.push({ productRowId: technical.configurationRef.productRowId,
      quantity: technical.quantity, unit: technical.unit, inquiryRow: row });
  }
  if (configured.length !== saved.data.rows.length || new Set(configured.map(row => row.productRowId)).size !== configured.length) return null;
  const rows = defaultPartnerRetailRows(configured);
  const intent = { ...base, graphHash: saved.data.graphHash, belowCostConfirmed: false,
    rows: partnerRetailIntentRows(rows),
  };
  return { intent, rows, step: 'customer' };
}
