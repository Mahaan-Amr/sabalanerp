import { PartnerTechnicalSavedViewSchema, type PartnerTechnicalSavedView } from '@sabalanerp/partner-sales-contracts';
import type { PartnerInquiryRow, PartnerInquiryView } from '../../partner-sales/inquiries/inquiryPresentation';
import { isUsableInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import { defaultPartnerRetailRows, partnerRetailIntentRows } from './partnerRetail';
import type { PartnerWizardDraft } from './PartnerContractWizard';
import type { PartnerDraftIntent } from './partnerCaseSubmission';

export const shouldPreferLocalPartnerWizard = (localServerRevision: number | undefined, currentServerRevision: number) =>
  localServerRevision === currentServerRevision;

export function rebasePartnerWizardSnapshot<T extends { serverRevision?: number }>(snapshot: T, serverRevision: number): T {
  return { ...snapshot, serverRevision };
}

export function preservePartnerDeliveriesAcrossProductEdit(
  previous: PartnerDraftIntent['deliveries'],
  defaults: PartnerDraftIntent['deliveries'],
  currentProductRowIds: readonly string[],
): PartnerDraftIntent['deliveries'] {
  const currentIds = new Set(currentProductRowIds);
  const preserved = previous.flatMap(delivery => {
    const items = delivery.items.filter(item => currentIds.has(item.productRowId));
    return items.length > 0 ? [{ ...delivery, items }] : [];
  });
  const represented = new Set(preserved.flatMap(delivery => delivery.items.map(item => item.productRowId)));
  const additions = defaults.flatMap(delivery => {
    const items = delivery.items.filter(item => currentIds.has(item.productRowId) && !represented.has(item.productRowId));
    return items.length > 0 ? [{ ...delivery, items }] : [];
  });
  return [...preserved, ...additions];
}

/** Quantity is supplied by the canonical graph's display projection; it is not
 * an inquiry fingerprint. No catalog-ID or array-position matching is allowed.
 */
export function enterPartnerWizard({ inquiry, inquiryRows, now, base, validated, mismatchedRowIds = [] }: {
  inquiry?: PartnerInquiryView;
  inquiryRows?: readonly PartnerInquiryRow[];
  now: number;
  base: Omit<PartnerDraftIntent, 'rows' | 'belowCostConfirmed' | 'graphHash'>;
  validated: PartnerTechnicalSavedView;
  mismatchedRowIds?: readonly string[];
}): PartnerWizardDraft | null {
  const saved = PartnerTechnicalSavedViewSchema.safeParse(validated);
  if (!saved.success || saved.data.recoveryId !== base.recoveryId ||
      saved.data.recoveryRevision !== base.recoveryRevision) return null;
  const availableRows = inquiryRows ?? inquiry?.rows ?? [];
  const approved = availableRows.filter(row => isUsableInquiryRow(row, now))
    .filter(row => !mismatchedRowIds.includes(row.rowId));
  if (!approved.length) return null;
  const subjects = saved.data.pricingSubjects ?? saved.data.rows.map(row => ({ configurationRef: row.configurationRef,
    role: 'PRIMARY' as const }));
  if (approved.length !== subjects.length || subjects.some(subject => !approved.some(row =>
    row.configurationRef.productRowId === subject.configurationRef.productRowId))) return null;
  const configured = [];
  for (const row of approved.filter(item => subjects.some(subject => subject.role === 'PRIMARY' &&
    subject.configurationRef.productRowId === item.configurationRef.productRowId))) {
    const technical = saved.data.rows.find(item => item.configurationRef.productRowId === row.configurationRef.productRowId);
    if (!technical || technical.configurationRef.recoveryId !== row.configurationRef.recoveryId ||
        technical.configurationRef.recoveryRevision !== row.configurationRef.recoveryRevision) return null;
    configured.push({ productRowId: technical.configurationRef.productRowId,
      quantity: technical.quantity, unit: technical.unit, inquiryRow: row });
  }
  if (configured.length !== saved.data.rows.length || new Set(configured.map(row => row.productRowId)).size !== configured.length) return null;
  const rows = defaultPartnerRetailRows(configured);
  const additionalMaterialApprovals = approved.flatMap(row => subjects.some(subject => subject.role === 'ADDITIONAL_MATERIAL' &&
    subject.configurationRef.productRowId === row.configurationRef.productRowId) && row.approvedRowBinding
    ? [{ pricingSubjectId: row.configurationRef.productRowId, approvedRowBinding: row.approvedRowBinding }] : []);
  const intent = { ...base, graphHash: saved.data.graphHash, belowCostConfirmed: false, additionalMaterialApprovals,
    rows: partnerRetailIntentRows(rows),
  };
  const materialInquiryRows = approved.flatMap(row => subjects.some(subject => subject.role === 'ADDITIONAL_MATERIAL' &&
    subject.configurationRef.productRowId === row.configurationRef.productRowId)
    ? [{ pricingSubjectId: row.configurationRef.productRowId, inquiryRow: row }] : []);
  return { intent, rows, materialInquiryRows, step: 'date' };
}
