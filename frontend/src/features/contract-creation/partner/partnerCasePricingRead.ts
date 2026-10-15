import { partnerError, type PartnerApprovalMatchSet, type PartnerTechnicalSaveReceipt } from '@sabalanerp/partner-sales-contracts';
import type { PartnerInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import { partnerCasePricingInquiryIds } from './partnerWizardEntry';

/** One fresh opening/refresh owns these reads. Published inquiries do not depend
 * on approval matching; binding-only history is added once matches are known. */
export async function readPartnerCasePricingRows(input: {
  saved: Pick<PartnerTechnicalSaveReceipt, 'recoveryId' | 'recoveryRevision'>;
  matches: () => Promise<PartnerApprovalMatchSet>;
  publishedIds: () => Promise<readonly string[]>;
  rows: (ids: readonly string[]) => Promise<PartnerInquiryRow[]>;
}) {
  // Attach both failure handlers immediately, including when the other read fails.
  const published = input.publishedIds().then(ids => {
    const uniqueIds = partnerCasePricingInquiryIds(input.saved.recoveryId, ids, [], true);
    return { ids: uniqueIds, rows: input.rows(uniqueIds) };
  });
  const matched = input.matches();
  const [available, matches] = await Promise.all([published.then(async value => ({ ...value, rows: await value.rows })), matched]);
  if (matches.recoveryId !== input.saved.recoveryId || matches.recoveryRevision !== input.saved.recoveryRevision)
    throw partnerError('INTEGRITY_CONFLICT');
  const missingIds = partnerCasePricingInquiryIds(input.saved.recoveryId, [], matches.rows, true)
    .filter(id => !available.ids.includes(id));
  const additional = missingIds.length ? await input.rows(missingIds) : [];
  const currentRows = [...available.rows, ...additional];
  const retained = matches.rows.filter(match => !currentRows.some(row =>
    row.configurationRef.recoveryId === match.configurationRef.recoveryId &&
    row.configurationRef.recoveryRevision === match.configurationRef.recoveryRevision &&
    row.configurationRef.productRowId === match.configurationRef.productRowId && !row.successor));
  return { matches, rows: [...currentRows, ...retained] };
}
